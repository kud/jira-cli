import type { Command } from "commander"
import {
  errorMessagesOf,
  isJiraApiError,
  type JiraClient,
  type JiraUser,
} from "@kud/jira"
import { table } from "../output/format.js"
import { confirmDestructive } from "./confirm.js"
import { context, exitError, printJson, type Context } from "./context.js"

type Request = JiraClient["request"]

type ShareTarget = {
  id?: number
  type: string
  project?: { id?: string; key?: string; name?: string }
  role?: { id?: number; name?: string }
  group?: { name?: string; groupId?: string }
  user?: { accountId?: string; displayName?: string }
}

export type Filter = {
  id: string
  name: string
  description?: string
  jql?: string
  owner?: JiraUser
  favourite?: boolean
  viewUrl?: string
  sharePermissions?: ShareTarget[]
  editPermissions?: ShareTarget[]
}

const enc = encodeURIComponent

export const filterPath = (id: string): string =>
  `/rest/api/3/filter/${enc(id)}`

/** One line per share, in the words the web UI uses for it. */
export const describeShare = (s: ShareTarget): string => {
  switch (s.type) {
    case "global":
      return "public (anyone, even anonymous)"
    case "authenticated":
      return "any logged-in user"
    case "loggedin":
      return "any logged-in user"
    case "project":
      return `project ${s.project?.key ?? s.project?.name ?? s.project?.id ?? "?"}`
    case "projectRole":
      return `project ${s.project?.key ?? s.project?.id ?? "?"}, role ${s.role?.name ?? s.role?.id ?? "?"}`
    case "group":
      return `group ${s.group?.name ?? s.group?.groupId ?? "?"}`
    case "user":
      return `user ${s.user?.displayName ?? s.user?.accountId ?? "?"}`
    default:
      return s.type
  }
}

/**
 * The owner is only worth naming when it is someone else: that is the case
 * where a write will be refused, and where "who do I ask" is the question.
 */
export const ownerLabel = (
  owner: JiraUser | undefined,
  myAccountId: string | undefined,
): string => {
  if (!owner) return "—"
  if (myAccountId && owner.accountId === myAccountId) return "you"
  return owner.displayName ?? owner.accountId ?? "—"
}

const myAccountId = async (ctx: Context): Promise<string | undefined> =>
  (await ctx.client.getMe().catch(() => null))?.accountId

const readFilter = async (request: Request, id: string): Promise<Filter> => {
  try {
    return await request<Filter>(filterPath(id))
  } catch (e) {
    if (isJiraApiError(e) && (e.status === 400 || e.status === 404))
      throw exitError(
        1,
        `filter ${id} does not exist, or is not shared with you`,
      )
    throw e
  }
}

/**
 * Only the owner can edit or delete a filter, unless it is shared with them
 * for editing; Jira answers the rest with a 400 or a 403 and a message that
 * never says who the owner is. That is the one fact the caller needs.
 */
const explainWriteRefusal = (
  error: unknown,
  action: string,
  filter: Filter,
  me: string | undefined,
): unknown => {
  if (!isJiraApiError(error) || (error.status !== 400 && error.status !== 403))
    return error
  const owner = ownerLabel(filter.owner, me)
  const reason = errorMessagesOf(error).join(" ")
  return exitError(
    error.status === 403 ? 4 : 1,
    `Jira refused to ${action} filter ${filter.id} (${error.status})${reason ? `: ${reason}` : ""}\n` +
      (owner === "you"
        ? "You own this filter, so the request itself was rejected."
        : `It is owned by ${owner}. Only the owner, someone it is shared with for editing,\n` +
          "or a Jira admin can change it. Ask the owner, or copy it: jira filter create --jql …"),
  )
}

const printFilter = (ctx: Context, f: Filter, me: string | undefined): void => {
  const { bold, dim } = ctx.out
  const shares = f.sharePermissions ?? []
  const editors = f.editPermissions ?? []
  const lines = [
    `${bold(f.name)}  ${dim(`#${f.id}`)}`,
    `${dim("owner")}        ${ownerLabel(f.owner, me)}`,
    `${dim("jql")}          ${f.jql ?? "—"}`,
    ...(f.description ? [`${dim("description")}  ${f.description}`] : []),
    `${dim("favourite")}    ${f.favourite ? "yes" : "no"}`,
    `${dim("shared")}       ${shares.length === 0 ? "private" : ""}`,
    ...shares.map((s) => `  ${dim(String(s.id ?? "—"))}  ${describeShare(s)}`),
    ...(editors.length > 0
      ? [
          `${dim("editable by")}`,
          ...editors.map(
            (s) => `  ${dim(String(s.id ?? "—"))}  ${describeShare(s)}`,
          ),
        ]
      : []),
    ...(f.viewUrl ? [`${dim("url")}          ${f.viewUrl}`] : []),
  ]
  process.stdout.write(`${lines.map((l) => l.trimEnd()).join("\n")}\n`)
}

type ShareOptions = {
  project?: string
  role?: string
  group?: string
  user?: string
  loggedIn?: boolean
  public?: boolean
  json?: boolean
}

const resolveUser = async (request: Request, who: string): Promise<string> => {
  if (!who.includes("@")) return who
  const found = await request<JiraUser[]>(
    `/rest/api/3/user/search?query=${enc(who)}&maxResults=10`,
  )
  const exact = found.filter(
    (u) => u.emailAddress?.toLowerCase() === who.toLowerCase(),
  )
  const match = exact.length === 1 ? exact : found
  if (match.length !== 1 || !match[0]?.accountId)
    throw exitError(
      1,
      match.length === 0
        ? `no user matches ${who}. Try: jira user search ${who}`
        : `${who} matches ${match.length} users; pass an account ID instead`,
    )
  return match[0].accountId
}

const resolveRole = async (
  request: Request,
  project: string,
  role: string,
): Promise<number> => {
  const roles = await request<Record<string, string>>(
    `/rest/api/3/project/${enc(project)}/role`,
  )
  const hit = Object.entries(roles).find(
    ([name]) => name.toLowerCase() === role.toLowerCase(),
  )
  const id = hit?.[1].split("/").pop()
  if (!id)
    throw exitError(
      1,
      `project ${project} has no role named ${role}. Roles: ${Object.keys(roles).join(", ") || "none"}`,
    )
  return Number(id)
}

/**
 * The body POST /filter/{id}/permission takes. Exactly one target, because
 * the endpoint adds one share per call and a guess at which flag "wins"
 * would share wider than the caller meant.
 */
export const shareBody = async (
  request: Request,
  options: ShareOptions,
): Promise<Record<string, unknown>> => {
  const targets = [
    options.project && !options.role ? "project" : undefined,
    options.role ? "role" : undefined,
    options.group ? "group" : undefined,
    options.user ? "user" : undefined,
    options.loggedIn ? "logged-in" : undefined,
    options.public ? "public" : undefined,
  ].filter(Boolean)
  if (targets.length !== 1)
    throw exitError(
      1,
      targets.length === 0
        ? "say who to share with: --project, --project with --role, --group, --user, --logged-in or --public"
        : `share with one target at a time, not ${targets.join(" and ")}`,
    )
  if (options.role && !options.project)
    throw exitError(1, "--role needs --project <key>")

  if (options.group) return { type: "group", groupname: options.group }
  if (options.user)
    return { type: "user", accountId: await resolveUser(request, options.user) }
  if (options.loggedIn) return { type: "authenticated" }
  if (options.public) return { type: "global" }

  const project = await request<{ id: string }>(
    `/rest/api/3/project/${enc(options.project as string)}`,
  )
  if (options.role)
    return {
      type: "projectRole",
      projectId: project.id,
      projectRoleId: await resolveRole(
        request,
        options.project as string,
        options.role,
      ),
    }
  return { type: "project", projectId: project.id }
}

/** The JQL before ORDER BY, and the ORDER BY clause itself, apart. */
export const splitOrderBy = (jql: string): { where: string; order?: string } => {
  const at = jql.search(/\border\s+by\b/i)
  if (at === -1) return { where: jql.trim() }
  return { where: jql.slice(0, at).trim(), order: jql.slice(at).trim() }
}

/**
 * ANDs JQL fragments together, each in parentheses so an OR inside one
 * cannot leak into the next. The first ORDER BY found, from the last part
 * backwards, wins: a caller's own --jql order beats the board's.
 */
export const andJql = (parts: string[]): string => {
  const split = parts.map(splitOrderBy)
  const where = split
    .map((p) => p.where)
    .filter(Boolean)
    .map((w) => `(${w})`)
    .join(" AND ")
  const order = [...split].reverse().find((p) => p.order)?.order
  return [where, order].filter(Boolean).join(" ")
}

type QuickFilter = { id: number; name: string; jql?: string }

/** Every quick filter on a board; the endpoint pages like the board list. */
export const listQuickFilters = async (
  request: Request,
  board: string,
): Promise<QuickFilter[]> => {
  const base = `/rest/agile/1.0/board/${enc(board)}/quickfilter`
  const all: QuickFilter[] = []
  let startAt = 0
  for (;;) {
    const page = await request<{ values?: QuickFilter[]; isLast?: boolean }>(
      `${base}?startAt=${startAt}`,
    )
    const values = page.values ?? []
    all.push(...values)
    if (page.isLast !== false || values.length === 0) return all
    startAt += values.length
  }
}

export const pickQuickFilter = (
  filters: QuickFilter[],
  name: string,
  board: string,
): QuickFilter => {
  const byId = filters.find((q) => String(q.id) === name)
  if (byId) return byId
  const hits = filters.filter((q) => q.name.toLowerCase() === name.toLowerCase())
  if (hits.length === 1) return hits[0] as QuickFilter
  const known = filters.map((q) => `${q.name} (${q.id})`).join(", ") || "none"
  throw exitError(
    1,
    hits.length === 0
      ? `board ${board} has no quick filter named ${name}. Quick filters: ${known}`
      : `${hits.length} quick filters on board ${board} are named ${name}; pass its ID: ${hits.map((q) => q.id).join(", ")}`,
  )
}

/** A board's saved filter, as the board's configuration points to it. */
export const boardFilter = async (
  request: Request,
  board: string,
): Promise<Filter> => {
  const config = await request<{ filter?: { id?: string | number } }>(
    `/rest/agile/1.0/board/${enc(board)}/configuration`,
  )
  const id = config.filter?.id
  if (id === undefined)
    throw exitError(1, `board ${board} reports no saved filter`)
  try {
    return await request<Filter>(filterPath(String(id)))
  } catch (e) {
    if (isJiraApiError(e) && (e.status === 403 || e.status === 404))
      throw exitError(
        4,
        `board ${board} uses filter ${id}, which is not shared with you, so its JQL cannot be read`,
      )
    throw e
  }
}

/**
 * What `issue list --board` searches: the board's own filter, narrowed by a
 * quick filter when one is named. The caller ANDs its own narrowing on.
 */
export const boardScope = async (
  request: Request,
  board: string,
  quickFilter: string | undefined,
): Promise<string[]> => {
  const filter = await boardFilter(request, board)
  const parts = [filter.jql ?? ""]
  if (quickFilter) {
    const quick = pickQuickFilter(
      await listQuickFilters(request, board),
      quickFilter,
      board,
    )
    parts.push(quick.jql ?? "")
  }
  return parts
}

export const registerBoardFilterCommand = (board: Command): void => {
  board
    .command("filter <id>")
    .description("the saved filter behind a board, and who owns it")
    .option("--json", "emit JSON")
    .action(async (id: string, options: { json?: boolean }) => {
      const ctx = context()
      const filter = await boardFilter(ctx.client.request, id)
      if (options.json) return printJson(filter)
      printFilter(ctx, filter, await myAccountId(ctx))
    })
}

export const registerFilterCommands = (program: Command): void => {
  const filter = program
    .command("filter")
    .description("saved filters: view, create, edit, share and delete")

  filter
    .command("view <id>")
    .description("one filter: JQL, owner and who it is shared with")
    .option("--json", "emit JSON")
    .action(async (id: string, options: { json?: boolean }) => {
      const ctx = context()
      const found = await readFilter(ctx.client.request, id)
      if (options.json) return printJson(found)
      printFilter(ctx, found, await myAccountId(ctx))
    })

  filter
    .command("create")
    .description("save a JQL query as a filter (private until shared)")
    .requiredOption("--name <name>", "filter name, unique among yours")
    .requiredOption("-q, --jql <jql>", "the query")
    .option("--description <text>", "description")
    .option("--favourite", "star it")
    .option("--json", "emit JSON")
    .action(
      async (options: {
        name: string
        jql: string
        description?: string
        favourite?: boolean
        json?: boolean
      }) => {
        const ctx = context()
        const created = await ctx.client.request<Filter>("/rest/api/3/filter", {
          method: "POST",
          body: JSON.stringify({
            name: options.name,
            jql: options.jql,
            ...(options.description !== undefined
              ? { description: options.description }
              : {}),
            ...(options.favourite ? { favourite: true } : {}),
          }),
        })
        if (options.json) return printJson(created)
        process.stdout.write(`created filter ${created.id}  ${created.name}\n`)
      },
    )

  filter
    .command("edit <id>")
    .description("rename a filter, or change its JQL or description")
    .option("--name <name>", "new name")
    .option("-q, --jql <jql>", "new query")
    .option("--description <text>", "new description ('' clears it)")
    .option("--json", "emit JSON")
    .action(
      async (
        id: string,
        options: {
          name?: string
          jql?: string
          description?: string
          json?: boolean
        },
      ) => {
        if (
          options.name === undefined &&
          options.jql === undefined &&
          options.description === undefined
        )
          throw exitError(1, "nothing to change: pass --name, --jql or --description")
        const ctx = context()
        const before = await readFilter(ctx.client.request, id)
        // PUT requires the name even when only the JQL changes, so the
        // current one is sent back unchanged.
        const body = {
          name: options.name ?? before.name,
          ...(options.jql !== undefined ? { jql: options.jql } : {}),
          ...(options.description !== undefined
            ? { description: options.description }
            : {}),
        }
        let after: Filter
        try {
          after = await ctx.client.request<Filter>(filterPath(id), {
            method: "PUT",
            body: JSON.stringify(body),
          })
        } catch (e) {
          throw explainWriteRefusal(e, "edit", before, await myAccountId(ctx))
        }
        if (options.json) return printJson(after)
        const changes = (["name", "jql", "description"] as const)
          .filter((k) => options[k] !== undefined && before[k] !== after[k])
          .map((k) => `  ${k}: ${before[k] ?? "—"} → ${after[k] ?? "—"}`)
        process.stdout.write(
          `updated filter ${id}${changes.length ? `\n${changes.join("\n")}` : " (no change)"}\n`,
        )
      },
    )

  filter
    .command("share <id>")
    .description("share a filter for viewing (one target per call)")
    .option("--project <key>", "everyone who can browse this project")
    .option("--role <name>", "only this role on --project")
    .option("--group <name>", "a group")
    .option("--user <who>", "a user, by account ID or email")
    .option("--logged-in", "any logged-in user on the site")
    .option("--public", "anyone, without logging in, if the site allows it")
    .option("--json", "emit JSON")
    .action(async (id: string, options: ShareOptions) => {
      const ctx = context()
      const body = await shareBody(ctx.client.request, options)
      let shares: ShareTarget[]
      try {
        shares = await ctx.client.request<ShareTarget[]>(
          `${filterPath(id)}/permission`,
          { method: "POST", body: JSON.stringify(body) },
        )
      } catch (e) {
        if (isJiraApiError(e) && (e.status === 400 || e.status === 403)) {
          const reason = errorMessagesOf(e).join(" ")
          throw exitError(
            e.status === 403 ? 4 : 1,
            `Jira refused to share filter ${id} (${e.status})${reason ? `: ${reason}` : ""}\n` +
              "Sharing needs the global 'Share dashboards and filters' permission and ownership\n" +
              "of the filter, and only with projects, groups and roles you belong to.\n" +
              "Public sharing is off on many sites; --logged-in is the usual alternative.",
          )
        }
        throw e
      }
      if (options.json) return printJson(shares)
      process.stdout.write(
        `filter ${id} is now shared with:\n${table(shares ?? [], [
          { header: "ID", value: (s) => String(s.id ?? "—") },
          { header: "WITH", value: describeShare },
        ])}\n`,
      )
    })

  filter
    .command("unshare <id> <shareId>")
    .description("remove one share (IDs from: jira filter view <id>)")
    .action(async (id: string, shareId: string) => {
      const ctx = context()
      await ctx.client.request(`${filterPath(id)}/permission/${enc(shareId)}`, {
        method: "DELETE",
      })
      process.stdout.write(`removed share ${shareId} from filter ${id}\n`)
    })

  filter
    .command("delete <id>")
    .description("delete a filter (boards using it stop working)")
    .option("-y, --yes", "skip the confirmation")
    .action(async (id: string, options: { yes?: boolean }) => {
      const ctx = context()
      const found = await readFilter(ctx.client.request, id)
      await confirmDestructive(`delete filter ${id} (${found.name})`, options)
      try {
        await ctx.client.request(filterPath(id), { method: "DELETE" })
      } catch (e) {
        throw explainWriteRefusal(e, "delete", found, await myAccountId(ctx))
      }
      process.stdout.write(`deleted filter ${id}  ${found.name}\n`)
    })
}
