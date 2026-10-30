import { execFile } from "node:child_process"
import type { Command } from "commander"
import { adfToMarkdown, flattenIssueLinks, locateAttachments, type JiraIssue } from "@kud/jira"
import { table, truncate, type Column } from "../output/format.js"
import {
  context,
  exitError,
  printJson,
  warnIfTruncated,
  type Context,
} from "./context.js"
import { registerIssueWriteCommands } from "./issue-write.js"

import { buildJql, jqlEscape, type ListOptions as JqlOptions } from "@kud/jira"

type ListOptions = JqlOptions & { limit: string; json?: boolean }

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
      const limit = Number(options.limit)
      const issues = await ctx.client.searchIssues(jql, { limit })

      if (options.json) {
        printJson(issues)
        warnIfTruncated(issues.length, limit, { exitCode: true })
        return
      }
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
      warnIfTruncated(issues.length, limit, { exitCode: false })
    })

  issue
    .command("view <key>")
    .description("show one issue")
    .option("--json", "emit JSON")
    .option("--comments", "include comments")
    .option(
      "--fields <list>",
      "restrict the output to these fields, comma-separated",
    )
    .action(
      async (
        key: string,
        options: {
          json?: boolean
          comments?: boolean
          fields?: string
        },
      ) => {
        const ctx = context()
        const found = await ctx.client.getIssue(key)
        // Field names are Jira's own (`issuetype`, `issuelinks`), matched
        // case-insensitively; identity — key, summary, url — is not a field
        // and stays either way.
        const fields = options.fields
          ?.split(",")
          .map((f) => f.trim().toLowerCase())
          .filter(Boolean)
        const show = (field: string): boolean =>
          !fields || fields.includes(field.toLowerCase())

        if (options.json) {
          const chosen: Record<string, unknown> = fields
            ? Object.fromEntries(
                Object.entries(found.fields).filter(([k]) =>
                  fields.includes(k.toLowerCase()),
                ),
              )
            : { ...found.fields }
          if (show("issuelinks")) chosen["issuelinks"] = flattenIssueLinks(found)
          if (show("subtasks"))
            chosen["subtasks"] = found.fields.subtasks?.map((s) => ({
              key: s.key,
              summary: s.fields.summary,
              status: s.fields.status.name,
            }))
          return printJson({ ...found, fields: chosen })
        }

        const { bold, dim } = ctx.out
        const f = found.fields
        const lines = [
          `${bold(found.key)}  ${f.summary ?? ""}`,
          "",
          ...(show("parent") && f.parent
            ? [
                `${dim("parent")}    ${f.parent.key}  ${truncate(f.parent.fields?.summary ?? "", 60)}`,
              ]
            : []),
          ...(show("status")
            ? [`${dim("status")}    ${f.status?.name ?? "—"}`]
            : []),
          ...(show("issuetype")
            ? [`${dim("type")}      ${f.issuetype?.name ?? "—"}`]
            : []),
          ...(show("assignee")
            ? [`${dim("assignee")}  ${f.assignee?.displayName ?? "unassigned"}`]
            : []),
          ...(show("reporter")
            ? [`${dim("reporter")}  ${f.reporter?.displayName ?? "—"}`]
            : []),
          ...(show("labels") && f.labels?.length
            ? [`${dim("labels")}    ${f.labels.join(", ")}`]
            : []),
          ...ctx.client.customFields
            .filter((cf) => f[cf.id] != null && show(cf.id))
            .map((cf) => `${dim(cf.label.padEnd(9))} ${formatField(f[cf.id])}`),
          ...(fields
            ? []
            : [`${dim("url")}       ${issueUrl(ctx, found.key)}`]),
        ]

        const links = flattenIssueLinks(found)
        if (show("issuelinks") && links.length > 0) {
          lines.push(
            "",
            dim("─── links ───"),
            "",
            ...links.map(
              (l) =>
                `${l.direction.padEnd(7)} ${l.type.padEnd(12)} ${l.key}  ${dim(l.status.padEnd(12))} ${truncate(l.summary, 60)}`,
            ),
          )
        }

        const subtasks = f.subtasks
        if (show("subtasks") && subtasks?.length) {
          lines.push(
            "",
            dim("─── subtasks ───"),
            "",
            ...subtasks.map(
              (s) =>
                `${s.key}  ${dim(s.fields.status.name.padEnd(12))} ${truncate(s.fields.summary, 60)}`,
            ),
          )
        }

        const attachments = locateAttachments(found)
        const filenameOf = (id: string): string | undefined =>
          attachments.find((a) => a.id === id)?.filename

        if (!fields && attachments.length > 0) {
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
        if (show("description") && description)
          lines.push("", dim("─── description ───"), "", description)

        if (options.comments && show("comment") && f.comment?.comments?.length) {
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
    .option("--resolution <name>", "resolution to set as part of the move")
    .option("--json", "emit JSON")
    .action(
      async (
        key: string,
        status: string | undefined,
        options: { json?: boolean; resolution?: string },
      ) => {
        const ctx = context()
        const { transitions } = await ctx.client.getTransitions(key)

        if (!status) {
          if (options.json) return printJson(transitions)
          process.stdout.write(
            `${table(transitions, [
              { header: "ID", value: (t) => t.id },
              { header: "NAME → TO", value: (t) => `${t.name} → ${t.to?.name ?? "—"}` },
            ])}\n`,
          )
          process.stderr.write(TRANSITION_HINT + "\n")
          return
        }

        const wanted = status.toLowerCase()
        const byName = transitions.filter(
          (t) => t.name.toLowerCase() === wanted || t.id === status,
        )
        const byTarget = transitions.filter(
          (t) => t.to?.name.toLowerCase() === wanted,
        )
        // A transition name always wins over a status name, ids keep working
        // as they always have, and a status that several transitions reach is
        // refused rather than resolved to whichever came first. Only the
        // status reading is ambiguous-checkable: a named transition settles
        // the move even when other transitions reach the same status.
        const match =
          byName.length > 0
            ? byName.length === 1
              ? byName[0]
              : undefined
            : byTarget.length === 1
              ? byTarget[0]
              : undefined
        if (byName.length > 1) {
          throw exitError(
            1,
            `'${status}' matches ${byName.length} transitions on ${key}: ${byName
              .map((t) => `${t.name} → ${t.to?.name ?? "—"}`)
              .join("; ")}`,
          )
        }
        if (byName.length === 0 && byTarget.length > 1) {
          throw exitError(
            1,
            `${byTarget.length} transitions reach '${status}' on ${key}: ${byTarget
              .map((t) => `${t.name} → ${t.to?.name ?? "—"}`)
              .join("; ")}\nUse a transition name instead`,
          )
        }
        if (!match) {
          throw exitError(
            1,
            `no transition or status '${status}' on ${key}. Available:\n${transitions
              .map((t) => `  ${t.name} → ${t.to?.name ?? "—"}`)
              .join("\n")}\n${TRANSITION_HINT}`,
          )
        }

        await ctx.client.transitionIssue(
          key,
          match.id,
          options.resolution
            ? { resolution: { name: options.resolution } }
            : undefined,
        )
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

const TRANSITION_HINT =
  "the argument may be either the transition name or its target status"

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
