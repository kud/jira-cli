import { execFile } from "node:child_process"
import type { Command } from "commander"
import { adfToMarkdown } from "../api/adf.js"
import { locateAttachments } from "../api/attachments.js"
import type { JiraIssue } from "../api/types.js"
import { table, truncate, type Column } from "../output/format.js"
import { context, exitError, printJson, type Context } from "./context.js"
import { registerIssueWriteCommands } from "./issue-write.js"

const jqlEscape = (value: string): string => `"${value.replace(/"/g, '\\"')}"`

type ListOptions = {
  assignee?: string
  mine?: boolean
  status?: string
  project?: string
  sprint?: string
  label?: string
  jql?: string
  limit: string
  json?: boolean
}

/**
 * Flags compose into one JQL string rather than each becoming its own command.
 * `--jql` replaces the generated clauses entirely so there is always an escape
 * hatch for anything the flags cannot express.
 */
const buildJql = (options: ListOptions, defaultProject?: string): string => {
  if (options.jql) return options.jql

  const clauses: string[] = []
  if (options.mine) clauses.push("assignee = currentUser()")
  else if (options.assignee)
    clauses.push(
      options.assignee === "none"
        ? "assignee IS EMPTY"
        : `assignee = ${jqlEscape(options.assignee)}`,
    )

  const project = options.project ?? defaultProject
  if (project) clauses.push(`project = ${jqlEscape(project)}`)
  if (options.status) clauses.push(`status = ${jqlEscape(options.status)}`)
  if (options.label) clauses.push(`labels = ${jqlEscape(options.label)}`)
  if (options.sprint)
    clauses.push(
      options.sprint === "current"
        ? "sprint IN openSprints()"
        : `sprint = ${jqlEscape(options.sprint)}`,
    )

  // Jira rejects an unbounded query outright, so a bare `issue list` has to
  // mean something. Yours is the only defensible default.
  if (clauses.length === 0) clauses.push("assignee = currentUser()")

  return `${clauses.join(" AND ")} ORDER BY updated DESC`
}

const issueColumns = (ctx: Context): Column<JiraIssue>[] => [
  { header: "KEY", value: (i) => i.key },
  { header: "STATUS", value: (i) => i.fields.status?.name ?? "—" },
  { header: "SUMMARY", value: (i) => truncate(i.fields.summary ?? "", 72) },
  {
    header: "ASSIGNEE",
    value: (i) => ctx.out.dim(i.fields.assignee?.displayName ?? "unassigned"),
  },
]

export const registerIssueCommands = (program: Command): void => {
  const issue = program.command("issue").description("work with issues")

  registerIssueWriteCommands(issue)

  issue
    .command("list")
    .alias("ls")
    .description("list issues matching the given filters")
    .option("-a, --assignee <who>", "assignee account id, email, or 'none'")
    .option("-m, --mine", "issues assigned to you")
    .option("-s, --status <status>", "status name, e.g. 'In Progress'")
    .option("-p, --project <key>", "project key")
    .option("--sprint <name>", "sprint name, or 'current' for open sprints")
    .option("-l, --label <label>", "label")
    .option("-q, --jql <jql>", "raw JQL, replacing all other filters")
    .option("-n, --limit <n>", "maximum issues to return", "50")
    .option("--json", "emit JSON")
    .action(async (options: ListOptions) => {
      const ctx = context()
      const jql = buildJql(options, ctx.config.defaultProject)
      const issues = await ctx.client.searchIssues(jql, {
        limit: Number(options.limit),
      })

      if (options.json) return printJson(issues)
      if (issues.length === 0) {
        // Jira answers a bad token by treating you as anonymous rather than by
        // failing, so `currentUser()` quietly matches nothing. Without this the
        // CLI reports an empty backlog to someone who is simply not logged in.
        const me = await ctx.client.getMe().catch(() => null)
        if (!me?.accountId)
          throw exitError(
            4,
            "not authenticated — check ATLASSIAN_USER_EMAIL and ATLASSIAN_API_TOKEN",
          )
        process.stderr.write(`no issues match: ${jql}\n`)
        return
      }
      process.stdout.write(`${table(issues, issueColumns(ctx))}\n`)
    })

  issue
    .command("view <key>")
    .description("show one issue")
    .option("--json", "emit JSON")
    .option("--comments", "include comments")
    .action(
      async (key: string, options: { json?: boolean; comments?: boolean }) => {
        const ctx = context()
        const found = await ctx.client.getIssue(key)
        if (options.json) return printJson(found)

        const { bold, dim } = ctx.out
        const f = found.fields
        const lines = [
          `${bold(found.key)}  ${f.summary ?? ""}`,
          "",
          `${dim("status")}    ${f.status?.name ?? "—"}`,
          `${dim("type")}      ${f.issuetype?.name ?? "—"}`,
          `${dim("assignee")}  ${f.assignee?.displayName ?? "unassigned"}`,
          `${dim("reporter")}  ${f.reporter?.displayName ?? "—"}`,
          ...(f.labels?.length
            ? [`${dim("labels")}    ${f.labels.join(", ")}`]
            : []),
          ...ctx.client.customFields
            .filter((cf) => f[cf.id] != null)
            .map((cf) => `${dim(cf.label.padEnd(9))} ${formatField(f[cf.id])}`),
          `${dim("url")}       ${issueUrl(ctx, found.key)}`,
        ]

        const attachments = locateAttachments(found)
        const filenameOf = (id: string): string | undefined =>
          attachments.find((a) => a.id === id)?.filename

        if (attachments.length > 0) {
          lines.push(
            "",
            dim("─── attachments ───"),
            "",
            ...attachments.map(
              (a) => `${a.filename}  ${dim(`${a.mimeType}  ${a.id}`)}`,
            ),
            "",
            dim(`read one with: jira attachment read ${found.key} <filename>`),
          )
        }

        const description = adfToMarkdown(f.description, filenameOf)
        if (description)
          lines.push("", dim("─── description ───"), "", description)

        if (options.comments && f.comment?.comments?.length) {
          lines.push("", dim("─── comments ───"))
          for (const c of f.comment.comments) {
            lines.push(
              "",
              `${bold(c.author?.displayName ?? "unknown")} ${dim(c.created?.slice(0, 10) ?? "")}`,
              adfToMarkdown(c.body, filenameOf),
            )
          }
        }

        process.stdout.write(`${lines.join("\n")}\n`)
      },
    )

  issue
    .command("transition <key> [status]")
    .alias("move")
    .description("move an issue, or list available transitions")
    .option("--json", "emit JSON")
    .action(
      async (
        key: string,
        status: string | undefined,
        options: { json?: boolean },
      ) => {
        const ctx = context()
        const { transitions } = await ctx.client.getTransitions(key)

        if (!status) {
          if (options.json) return printJson(transitions)
          process.stdout.write(
            `${table(transitions, [
              { header: "ID", value: (t) => t.id },
              { header: "NAME", value: (t) => t.name },
              { header: "TO", value: (t) => t.to?.name ?? "—" },
            ])}\n`,
          )
          return
        }

        const wanted = status.toLowerCase()
        const match = transitions.find(
          (t) => t.name.toLowerCase() === wanted || t.id === status,
        )
        if (!match) {
          throw exitError(
            1,
            `no transition '${status}' on ${key}. Available: ${transitions
              .map((t) => t.name)
              .join(", ")}`,
          )
        }

        await ctx.client.transitionIssue(key, match.id)
        if (options.json) return printJson({ key, transition: match })
        process.stdout.write(`${key} → ${match.to?.name ?? match.name}\n`)
      },
    )

  issue
    .command("open <key>")
    .description("open an issue in the browser")
    .option("--print", "print the url instead of opening it")
    .action(async (key: string, options: { print?: boolean }) => {
      const ctx = context()
      const url = issueUrl(ctx, key)
      if (options.print) {
        process.stdout.write(`${url}\n`)
        return
      }
      const opener =
        process.platform === "darwin"
          ? "open"
          : process.platform === "win32"
            ? "start"
            : "xdg-open"
      execFile(opener, [url])
    })
}

const issueUrl = (ctx: Context, key: string): string =>
  `${ctx.config.baseUrl.replace(/\/$/, "")}/browse/${key}`

const formatField = (value: unknown): string => {
  if (value == null) return "—"
  if (typeof value === "object") {
    const o = value as Record<string, unknown>
    return String(
      o["value"] ?? o["name"] ?? o["displayName"] ?? JSON.stringify(value),
    )
  }
  return String(value)
}
