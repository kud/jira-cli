import type { Command } from "commander"
import {
  errorMessagesOf,
  isJiraApiError,
  type JiraClient,
  type JiraIssue,
} from "@kud/jira"
import { table, truncate } from "../output/format.js"
import { context, exitError, warnIfTruncated } from "./context.js"
import { collect, listFieldSugar, resolveFields } from "./fields.js"
import { applyTransition, readBody, resolveTransition } from "./issue-write.js"

/**
 * Bulk changes run one issue at a time through the ordinary edit and
 * transition endpoints, not Jira's asynchronous bulk API. The bulk API wants
 * each field sorted into a per-type bucket (labelsFields, numberCustomFields,
 * …) and transitions grouped by workflow, and it needs the global Bulk change
 * permission on top of Edit or Transition issues. The per-issue route takes
 * the same `--field` values as `issue edit`, needs only the permissions a
 * single edit needs, and names each failure by key. The price is one request
 * per issue, which --limit keeps in view.
 */

const DEFAULT_LIMIT = "100"

type Failure = { key: string; message: string; forbidden: boolean }

const failureOf = (key: string, error: unknown): Failure => ({
  key,
  message: isJiraApiError(error)
    ? errorMessagesOf(error).join("; ") || `HTTP ${error.status}`
    : error instanceof Error
      ? error.message
      : String(error),
  forbidden: isJiraApiError(error) && error.status === 403,
})

const matches = async (
  client: JiraClient,
  jql: string,
  limitRaw: string,
): Promise<{ issues: JiraIssue[]; limit: number }> => {
  const limit = Number(limitRaw)
  if (!Number.isInteger(limit) || limit < 1)
    throw exitError(1, "--limit must be a positive whole number")
  const issues = await client.searchIssues(jql, {
    fields: ["summary", "status"],
    limit,
  })
  return { issues, limit }
}

/** The dry run: what would change, and how to make it so. */
const preview = (issues: JiraIssue[], limit: number, verb: string): void => {
  if (issues.length === 0) {
    process.stderr.write("no issues match\n")
    return
  }
  process.stdout.write(
    `${table(issues, [
      { header: "KEY", value: (i) => i.key },
      { header: "STATUS", value: (i) => i.fields.status?.name ?? "—" },
      { header: "SUMMARY", value: (i) => truncate(i.fields.summary ?? "", 60) },
    ])}\n`,
  )
  process.stderr.write(
    `${issues.length} issue${issues.length === 1 ? "" : "s"} would be ${verb}; nothing changed. Re-run with --yes to apply.\n`,
  )
  warnIfTruncated(issues.length, limit, { exitCode: false })
}

const report = (
  done: number,
  total: number,
  failures: Failure[],
  needs: string,
): void => {
  process.stderr.write(`${done} of ${total} done\n`)
  if (failures.length === 0) return
  const lines = failures.map((f) => `  ${f.key}: ${f.message}`).join("\n")
  const hint = failures.some((f) => f.forbidden)
    ? `\nThe 403s need ${needs} on those issues' projects.`
    : ""
  throw exitError(
    failures.every((f) => f.forbidden) ? 4 : 1,
    `${failures.length} of ${total} failed:\n${lines}${hint}`,
  )
}

export const registerBulkCommands = (issue: Command): void => {
  const bulk = issue
    .command("bulk")
    .description("edit or transition every issue a JQL query matches")
    .addHelpText(
      "after",
      `
Lists the matches and changes nothing until --yes is given.

Examples:
  jira issue bulk edit --jql "project = SHOP AND labels = triage" --field "Story Points=3"
  jira issue bulk transition --jql "sprint = 42 AND status = 'In Review'" --to Done --yes
`,
    )

  bulk
    .command("edit")
    .description("set fields on every matching issue")
    .requiredOption("-q, --jql <jql>", "which issues")
    .option(
      "-f, --field <name=value>",
      "field to set, repeatable",
      collect,
      [] as string[],
    )
    .option(
      "--component <name>",
      "replace components, repeatable",
      collect,
      [] as string[],
    )
    .option(
      "--fix-version <name>",
      "replace fix versions, repeatable",
      collect,
      [] as string[],
    )
    .option("-n, --limit <n>", "maximum issues to touch", DEFAULT_LIMIT)
    .option("--yes", "apply the change; without it, only list the matches")
    .action(
      async (options: {
        jql: string
        field: string[]
        component: string[]
        fixVersion: string[]
        limit: string
        yes?: boolean
      }) => {
        const ctx = context()
        // Fields resolve before the search so a typo fails with nothing done.
        const fields = {
          ...(await resolveFields(ctx.client, options.field)),
          ...listFieldSugar(options),
        }
        if (Object.keys(fields).length === 0)
          throw exitError(
            2,
            "nothing to set — pass --field, --component or --fix-version",
          )

        const { issues, limit } = await matches(
          ctx.client,
          options.jql,
          options.limit,
        )
        if (!options.yes) return preview(issues, limit, "edited")

        const failures: Failure[] = []
        for (const found of issues) {
          try {
            await ctx.client.updateIssue(found.key, fields)
            process.stderr.write(`updated ${found.key}\n`)
          } catch (error) {
            failures.push(failureOf(found.key, error))
          }
        }
        warnIfTruncated(issues.length, limit, { exitCode: false })
        report(
          issues.length - failures.length,
          issues.length,
          failures,
          "Edit issues",
        )
      },
    )

  bulk
    .command("transition")
    .alias("move")
    .description("move every matching issue to a status")
    .requiredOption("-q, --jql <jql>", "which issues")
    .requiredOption("--to <status>", "target status or transition name")
    .option("--resolution <name>", "resolution to set as part of the move")
    .option("-c, --comment <text>", "comment to add to each; '-' reads stdin")
    .option(
      "-f, --field <name=value>",
      "field the transition screen asks for, repeatable",
      collect,
      [] as string[],
    )
    .option("-n, --limit <n>", "maximum issues to touch", DEFAULT_LIMIT)
    .option("--yes", "apply the change; without it, only list the matches")
    .action(
      async (options: {
        jql: string
        to: string
        resolution?: string
        comment?: string
        field: string[]
        limit: string
        yes?: boolean
      }) => {
        const ctx = context()
        const fields = await resolveFields(ctx.client, options.field)
        const { issues, limit } = await matches(
          ctx.client,
          options.jql,
          options.limit,
        )
        if (!options.yes)
          return preview(issues, limit, `moved to ${options.to}`)

        // Stdin can only be read once, so a piped comment is read here and
        // the same text goes on every issue.
        const comment = options.comment ? readBody(options.comment) : undefined

        const failures: Failure[] = []
        let skipped = 0
        for (const found of issues) {
          if (
            found.fields.status?.name?.toLowerCase() ===
            options.to.toLowerCase()
          ) {
            skipped += 1
            process.stderr.write(
              `${found.key} is already in ${found.fields.status?.name}\n`,
            )
            continue
          }
          try {
            const { transitions } = await ctx.client.getTransitions(found.key)
            const match = resolveTransition(transitions, found.key, options.to)
            await applyTransition(ctx.client, found.key, match.id, {
              ...(options.resolution ? { resolution: options.resolution } : {}),
              ...(comment ? { comment } : {}),
              fields,
            })
            process.stderr.write(
              `${found.key} → ${match.to?.name ?? match.name}\n`,
            )
          } catch (error) {
            failures.push(failureOf(found.key, error))
          }
        }
        warnIfTruncated(issues.length, limit, { exitCode: false })
        report(
          issues.length - failures.length - skipped,
          issues.length - skipped,
          failures,
          "Transition issues",
        )
      },
    )
}
