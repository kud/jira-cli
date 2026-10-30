import { readFileSync } from "node:fs"
import type { Command } from "commander"
import { adfToMarkdown, flattenIssueLinks, markdownToAdf } from "@kud/jira"
import { table, truncate } from "../output/format.js"
import { confirmDestructive } from "./confirm.js"
import { context, exitError, printJson } from "./context.js"

/**
 * Exactly one anchor: Jira's rank endpoint moves issues relative to a single
 * other issue, so "neither" has nothing to aim at and "both" is two orders
 * competing. Checked here rather than left to Jira so the error says which
 * flag was missing.
 */
export const rankPosition = (options: {
  before?: string
  after?: string
}): { before: string } | { after: string } => {
  const { before, after } = options
  if (before && after) throw exitError(1, "pass --before or --after, not both")
  if (!before && !after)
    throw exitError(1, "pass one of --before <key> or --after <key>")
  if (before) return { before }
  return { after: after as string }
}

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
    .command("delete <key>")
    .description("delete an issue, permanently")
    .option("--yes", "skip the confirmation")
    .action(async (key: string, options: { yes?: boolean }) => {
      await confirmDestructive(`permanently delete ${key}`, options)
      await context().client.deleteIssue(key)
      process.stderr.write(`deleted ${key}\n`)
    })

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

  comment
    .command("edit <key> <commentId> <text>")
    .description("edit a comment; '-' reads stdin")
    .action(async (key: string, commentId: string, text: string) => {
      await context().client.updateComment(
        key,
        commentId,
        markdownToAdf(readBody(text)),
      )
      process.stderr.write(`comment ${commentId} on ${key} updated\n`)
    })

  comment
    .command("delete <key> <commentId>")
    .description("delete a comment")
    .option("--yes", "skip the confirmation")
    .action(
      async (key: string, commentId: string, options: { yes?: boolean }) => {
        await confirmDestructive(
          `delete comment ${commentId} on ${key}`,
          options,
        )
        await context().client.deleteComment(key, commentId)
        process.stderr.write(`deleted comment ${commentId} on ${key}\n`)
      },
    )

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

  worklog
    .command("edit <key> <worklogId>")
    .description("change logged work")
    .option("--time <timeSpent>", "new time spent, e.g. '1h 30m'")
    .option("-b, --body <text>", "what you did; '-' reads stdin")
    .option(
      "--started <datetime>",
      "start time, e.g. 2026-10-27T09:00:00.000+0000",
    )
    .action(
      async (
        key: string,
        worklogId: string,
        options: { time?: string; body?: string; started?: string },
      ) => {
        if (!options.time && !options.body && !options.started)
          throw exitError(2, "nothing to change — pass at least one option")

        await context().client.updateWorklog(key, worklogId, {
          ...(options.time ? { timeSpent: options.time } : {}),
          ...(options.body
            ? { comment: markdownToAdf(readBody(options.body)) }
            : {}),
          ...(options.started ? { started: options.started } : {}),
        })
        process.stderr.write(`worklog ${worklogId} on ${key} updated\n`)
      },
    )

  worklog
    .command("delete <key> <worklogId>")
    .description("delete logged work")
    .option("--yes", "skip the confirmation")
    .action(
      async (key: string, worklogId: string, options: { yes?: boolean }) => {
        await confirmDestructive(
          `delete worklog ${worklogId} on ${key}`,
          options,
        )
        await context().client.deleteWorklog(key, worklogId)
        process.stderr.write(`deleted worklog ${worklogId} on ${key}\n`)
      },
    )

  const remotelink = issue
    .command("remotelink")
    .description("links to pages outside Jira")

  remotelink
    .command("list <key>")
    .alias("ls")
    .description("remote links on an issue")
    .option("--json", "emit JSON")
    .action(async (key: string, options: { json?: boolean }) => {
      const links = await context().client.getRemoteLinks(key)
      if (options.json) return printJson(links)
      if (links.length === 0) {
        process.stderr.write(`${key} has no remote links\n`)
        return
      }
      process.stdout.write(
        `${table(links, [
          { header: "ID", value: (l) => String(l.id) },
          { header: "TITLE", value: (l) => l.object.title },
          { header: "URL", value: (l) => l.object.url },
        ])}\n`,
      )
    })

  remotelink
    .command("add <key> <url>")
    .description("link a url to an issue; re-adding the same url is a no-op")
    .option("--title <text>", "link title, defaulting to the url")
    .action(async (key: string, url: string, options: { title?: string }) => {
      // globalId is the url itself, so Jira treats a re-add of the same
      // url as the same link rather than a growing pile of duplicates.
      await context().client.createRemoteLink(key, {
        url,
        title: options.title ?? url,
        globalId: url,
      })
      process.stderr.write(`linked ${url} to ${key}\n`)
    })

  remotelink
    .command("remove <key> <linkId>")
    .description("remove a remote link")
    .option("--yes", "skip the confirmation")
    .action(async (key: string, linkId: string, options: { yes?: boolean }) => {
      await confirmDestructive(
        `remove remote link ${linkId} from ${key}`,
        options,
      )
      await context().client.deleteRemoteLink(key, linkId)
      process.stderr.write(`removed remote link ${linkId} from ${key}\n`)
    })

  issue
    .command("rank <keys...>")
    .description("order issues before or after another issue")
    .option("--before <key>", "place the issues before this one")
    .option("--after <key>", "place the issues after this one")
    .action(
      async (keys: string[], options: { before?: string; after?: string }) => {
        const position = rankPosition(options)
        await context().client.rankIssues(keys, position)
        const anchor = "before" in position ? position.before : position.after
        process.stderr.write(
          `ranked ${keys.join(", ")} ${
            "before" in position ? "before" : "after"
          } ${anchor}\n`,
        )
      },
    )

  const link = issue
    .command("link")
    .description("link two issues, e.g. jira issue link ABC-1 Blocks ABC-2")

  link
    .command("list <key>")
    .alias("ls")
    .description("links on an issue")
    .option("--json", "emit JSON")
    .action(async (key: string, options: { json?: boolean }) => {
      const ctx = context()
      const found = await ctx.client.getIssue(key)
      const links = flattenIssueLinks(found)
      if (options.json) return printJson(links)
      if (links.length === 0) {
        process.stderr.write(`${key} has no links\n`)
        return
      }
      process.stdout.write(
        `${table(links, [
          { header: "DIR", value: (l) => l.direction },
          { header: "TYPE", value: (l) => l.type },
          { header: "KEY", value: (l) => l.key },
          { header: "STATUS", value: (l) => l.status },
          { header: "SUMMARY", value: (l) => truncate(l.summary, 40) },
        ])}\n`,
      )
    })

  link
    .argument("<inward>")
    .argument("<type>")
    .argument("<outward>")
    .action(async (inward: string, type: string, outward: string) => {
      await context().client.linkIssues(type, inward, outward)
      process.stderr.write(`linked ${inward} ${type} ${outward}\n`)
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
