import { readFileSync } from "node:fs"
import type { Command } from "commander"
import { adfToMarkdown, markdownToAdf } from "@kud/jira"
import { table } from "../output/format.js"
import { context, exitError, printJson } from "./context.js"

/** `-` means stdin, so a comment can be piped in from anything. */
const readBody = (value: string): string =>
  value === "-" ? readFileSync(0, "utf8") : value

const resolveAccountId = async (
  who: string,
  projectKey?: string,
): Promise<string | null> => {
  if (who === "none" || who === "unassigned") return null
  if (who === "me") return (await context().client.getMe()).accountId
  // An account id is already unambiguous; anything else needs a lookup, and a
  // lookup that returns two people must not silently pick one.
  if (/^[0-9a-f]{24}$|:/.test(who)) return who

  const ctx = context()
  const candidates = projectKey
    ? await ctx.client.searchAssignableUsers(who, projectKey)
    : await ctx.client.searchUsers(who)

  if (candidates.length === 0) throw exitError(1, `no user matching '${who}'`)
  if (candidates.length > 1)
    throw exitError(
      1,
      `'${who}' matches ${candidates.length} people: ${candidates
        .map((u) => `${u.displayName} (${u.accountId})`)
        .join(", ")}`,
    )
  return (candidates[0] as { accountId: string }).accountId
}

export const registerIssueWriteCommands = (issue: Command): void => {
  issue
    .command("create")
    .description("create an issue")
    .requiredOption("-p, --project <key>", "project key")
    .requiredOption("-t, --type <type>", "issue type, e.g. Task")
    .requiredOption("-s, --summary <text>", "summary")
    .option("-b, --body <text>", "description; '-' reads stdin")
    .option("-a, --assignee <who>", "assignee, or 'me'")
    .option("-l, --label <label...>", "labels")
    .option("--priority <name>", "priority name")
    .option("--json", "emit JSON")
    .action(
      async (options: {
        project: string
        type: string
        summary: string
        body?: string
        assignee?: string
        label?: string[]
        priority?: string
        json?: boolean
      }) => {
        const ctx = context()
        const fields: Record<string, unknown> = {
          project: { key: options.project },
          issuetype: { name: options.type },
          summary: options.summary,
        }
        if (options.body)
          fields["description"] = markdownToAdf(readBody(options.body))
        if (options.label) fields["labels"] = options.label
        if (options.priority) fields["priority"] = { name: options.priority }
        if (options.assignee)
          fields["assignee"] = {
            accountId: await resolveAccountId(
              options.assignee,
              options.project,
            ),
          }

        const created = await ctx.client.createIssue(fields)
        if (options.json) return printJson(created)
        process.stdout.write(`${created.key}\n`)
      },
    )

  issue
    .command("edit <key>")
    .description("change an issue's fields")
    .option("-s, --summary <text>", "new summary")
    .option("-b, --body <text>", "new description; '-' reads stdin")
    .option("-l, --label <label...>", "replace labels")
    .option("--priority <name>", "priority name")
    .action(
      async (
        key: string,
        options: {
          summary?: string
          body?: string
          label?: string[]
          priority?: string
        },
      ) => {
        const fields: Record<string, unknown> = {}
        if (options.summary) fields["summary"] = options.summary
        if (options.body)
          fields["description"] = markdownToAdf(readBody(options.body))
        if (options.label) fields["labels"] = options.label
        if (options.priority) fields["priority"] = { name: options.priority }

        if (Object.keys(fields).length === 0)
          throw exitError(2, "nothing to change — pass at least one option")

        await context().client.updateIssue(key, fields)
        process.stderr.write(`${key} updated\n`)
      },
    )

  issue
    .command("assign <key> <who>")
    .description("assign an issue; 'me' or 'none' both work")
    .action(async (key: string, who: string) => {
      const accountId = await resolveAccountId(who)
      await context().client.assignIssue(key, accountId)
      process.stderr.write(`${key} assigned to ${accountId ? who : "nobody"}\n`)
    })

  const comment = issue
    .command("comment")
    .description("read and write comments")

  comment
    .command("list <key>")
    .alias("ls")
    .description("comments on an issue")
    .option("--json", "emit JSON")
    .action(async (key: string, options: { json?: boolean }) => {
      const ctx = context()
      const { comments } = await ctx.client.getComments(key)
      if (options.json) return printJson(comments)
      process.stdout.write(
        `${comments
          .map((c) =>
            [
              `${ctx.out.bold(c.author?.displayName ?? "unknown")} ${ctx.out.dim(
                `${c.created?.slice(0, 10) ?? ""}  ${c.id}`,
              )}`,
              adfToMarkdown(c.body),
            ].join("\n"),
          )
          .join("\n\n")}\n`,
      )
    })

  comment
    .command("add <key> <body>")
    .description("comment on an issue; '-' reads stdin")
    .action(async (key: string, body: string) => {
      await context().client.addComment(key, markdownToAdf(readBody(body)))
      process.stderr.write(`commented on ${key}\n`)
    })

  const watch = issue.command("watch").description("watchers")

  watch
    .command("list <key>")
    .alias("ls")
    .description("who is watching an issue")
    .action(async (key: string) => {
      const { watchers } = await context().client.getWatchers(key)
      process.stdout.write(
        `${table(watchers, [
          { header: "ACCOUNT ID", value: (w) => w.accountId },
          { header: "NAME", value: (w) => w.displayName },
        ])}\n`,
      )
    })

  watch
    .command("add <key> [who]")
    .description("watch an issue, yourself by default")
    .action(async (key: string, who = "me") => {
      const accountId = await resolveAccountId(who)
      if (!accountId) throw exitError(2, "cannot add 'none' as a watcher")
      await context().client.addWatcher(key, accountId)
      process.stderr.write(`watching ${key}\n`)
    })

  watch
    .command("remove <key> [who]")
    .description("stop watching an issue")
    .action(async (key: string, who = "me") => {
      const accountId = await resolveAccountId(who)
      if (!accountId) throw exitError(2, "cannot remove 'none' as a watcher")
      await context().client.removeWatcher(key, accountId)
      process.stderr.write(`no longer watching ${key}\n`)
    })

  const worklog = issue.command("worklog").description("time tracking")

  worklog
    .command("list <key>")
    .alias("ls")
    .description("work logged on an issue")
    .option("--json", "emit JSON")
    .action(async (key: string, options: { json?: boolean }) => {
      const { worklogs } = await context().client.getWorklogs(key)
      if (options.json) return printJson(worklogs)
      process.stdout.write(
        `${table(worklogs, [
          { header: "WHEN", value: (w) => w.started?.slice(0, 10) ?? "—" },
          { header: "WHO", value: (w) => w.author?.displayName ?? "—" },
          { header: "SPENT", value: (w) => w.timeSpent ?? "—" },
        ])}\n`,
      )
    })

  worklog
    .command("add <key> <timeSpent>")
    .description("log work, e.g. '2h 30m'")
    .option("-b, --body <text>", "what you did")
    .action(
      async (key: string, timeSpent: string, options: { body?: string }) => {
        await context().client.addWorklog(key, {
          timeSpent,
          ...(options.body ? { comment: markdownToAdf(options.body) } : {}),
        })
        process.stderr.write(`logged ${timeSpent} on ${key}\n`)
      },
    )

  issue
    .command("link <inward> <type> <outward>")
    .description("link two issues, e.g. ABC-1 Blocks ABC-2")
    .action(async (inward: string, type: string, outward: string) => {
      await context().client.linkIssues(type, inward, outward)
      process.stderr.write(`${inward} ${type} ${outward}\n`)
    })

  issue
    .command("history <key>")
    .description("what changed on an issue and when")
    .option("--json", "emit JSON")
    .action(async (key: string, options: { json?: boolean }) => {
      const ctx = context()
      const { values } = await ctx.client.getChangelog(key)
      if (options.json) return printJson(values)
      process.stdout.write(
        `${values
          .flatMap((entry) =>
            (entry.items ?? []).map(
              (item) =>
                `${ctx.out.dim(entry.created?.slice(0, 10) ?? "—")}  ${
                  entry.author?.displayName ?? "unknown"
                }  ${item.field}: ${item.fromString ?? "—"} → ${item.toString ?? "—"}`,
            ),
          )
          .join("\n")}\n`,
      )
    })
}
