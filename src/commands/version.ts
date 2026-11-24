import type { Command } from "commander"
import type { JiraClient } from "@kud/jira"
import { context, exitError, printJson } from "./context.js"
import { projectAdminRefusal } from "./refusals.js"

/**
 * Project versions (releases). Creating and releasing need Administer
 * Projects on the version's project; reading, counts included, needs Browse.
 * https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-project-versions/
 */

type Version = {
  id: string
  name: string
  self?: string
  description?: string
  released?: boolean
  archived?: boolean
  startDate?: string
  releaseDate?: string
  projectId?: number
  issuesStatusForFixVersion?: {
    toDo?: number
    inProgress?: number
    done?: number
    unmapped?: number
  }
}

type Counts = { issuesFixedCount?: number; issuesAffectedCount?: number }
type Unresolved = { issuesCount?: number; issuesUnresolvedCount?: number }

/** By ID, or by name within the project, ignoring case. */
export const findVersion = async (
  client: JiraClient,
  wanted: string,
  project: string | undefined,
): Promise<Version> => {
  if (/^\d+$/.test(wanted))
    return client.request<Version>(`/rest/api/3/version/${wanted}`)
  if (!project)
    throw exitError(
      1,
      `'${wanted}' is a name, so --project is needed to find it`,
    )
  const versions = (await client.getProjectVersions(project)) as Version[]
  const match = versions.find(
    (v) => v.name.toLowerCase() === wanted.toLowerCase(),
  )
  if (!match)
    throw exitError(
      1,
      `no version '${wanted}' in ${project} — it has: ${versions.map((v) => v.name).join(", ") || "none"}`,
    )
  return match
}

const today = (): string => new Date().toISOString().slice(0, 10)

const plainDate = (value: string, flag: string): string => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw exitError(1, `${flag} '${value}' must be YYYY-MM-DD`)
  return value
}

export const registerVersionCommands = (program: Command): void => {
  const version = program
    .command("version")
    .description("create, inspect and release project versions")
    .addHelpText(
      "after",
      `
Creating and releasing need Administer Projects on the project.

Examples:
  jira version create 2.5 --project SHOP --release-date 2026-12-15
  jira version view 2.4 --project SHOP
  jira version release 2.4 --project SHOP --move-unresolved-to 2.5
`,
    )

  version
    .command("create <name>")
    .description("create a version in a project")
    .requiredOption("-p, --project <key>", "project key")
    .option("-d, --description <text>", "description")
    .option("--start <date>", "start date, YYYY-MM-DD")
    .option("--release-date <date>", "planned release date, YYYY-MM-DD")
    .option("--json", "emit JSON")
    .action(
      async (
        name: string,
        options: {
          project: string
          description?: string
          start?: string
          releaseDate?: string
          json?: boolean
        },
      ) => {
        const body = {
          name,
          ...(options.description ? { description: options.description } : {}),
          ...(options.start
            ? { startDate: plainDate(options.start, "--start") }
            : {}),
          ...(options.releaseDate
            ? { releaseDate: plainDate(options.releaseDate, "--release-date") }
            : {}),
        }
        const { client } = context()
        const project = await client.request<{ id: string }>(
          `/rest/api/3/project/${encodeURIComponent(options.project)}`,
        )
        let created: Version
        try {
          created = await client.request<Version>("/rest/api/3/version", {
            method: "POST",
            body: JSON.stringify({ ...body, projectId: Number(project.id) }),
          })
        } catch (error) {
          throw await projectAdminRefusal(
            error,
            client,
            options.project,
            `creating version ${name}`,
          )
        }
        if (options.json) return printJson(created)
        process.stdout.write(`${created.id}  ${created.name}\n`)
      },
    )

  version
    .command("view <version>")
    .description("a version's dates, state and issue counts")
    .option(
      "-p, --project <key>",
      "project key, needed to find a version by name",
    )
    .option("--json", "emit JSON")
    .action(
      async (wanted: string, options: { project?: string; json?: boolean }) => {
        const ctx = context()
        const { client } = ctx
        const found = await findVersion(client, wanted, options.project)
        const [full, counts, unresolved] = await Promise.all([
          client.request<Version>(
            `/rest/api/3/version/${found.id}?expand=issuesstatus`,
          ),
          client.request<Counts>(
            `/rest/api/3/version/${found.id}/relatedIssueCounts`,
          ),
          client.request<Unresolved>(
            `/rest/api/3/version/${found.id}/unresolvedIssueCount`,
          ),
        ])
        if (options.json) return printJson({ ...full, counts, unresolved })
        const { dim } = ctx.out
        const status = full.issuesStatusForFixVersion
        const state = full.released
          ? "released"
          : full.archived
            ? "archived"
            : "unreleased"
        process.stdout.write(
          `${[
            full.name,
            ...(full.description ? [full.description] : []),
            `${dim("state")}       ${state}`,
            `${dim("start")}       ${full.startDate ?? "—"}`,
            `${dim("release")}     ${full.releaseDate ?? "—"}`,
            `${dim("fixed in")}    ${counts.issuesFixedCount ?? 0}`,
            `${dim("affects")}     ${counts.issuesAffectedCount ?? 0}`,
            `${dim("unresolved")}  ${unresolved.issuesUnresolvedCount ?? 0} of ${unresolved.issuesCount ?? 0}`,
            ...(status
              ? [
                  `${dim("by status")}   to do ${status.toDo ?? 0} · in progress ${status.inProgress ?? 0} · done ${status.done ?? 0}${status.unmapped ? ` · other ${status.unmapped}` : ""}`,
                ]
              : []),
          ].join("\n")}\n`,
        )
      },
    )

  version
    .command("release <version>")
    .description("mark a version released")
    .option(
      "-p, --project <key>",
      "project key, needed to find versions by name",
    )
    .option("--date <date>", "release date, YYYY-MM-DD (default: today)")
    .option(
      "--move-unresolved-to <version>",
      "move the version's unresolved issues to this version first",
    )
    .option("--json", "emit JSON")
    .action(
      async (
        wanted: string,
        options: {
          project?: string
          date?: string
          moveUnresolvedTo?: string
          json?: boolean
        },
      ) => {
        const { client } = context()
        const found = await findVersion(client, wanted, options.project)
        if (found.released)
          throw exitError(1, `${found.name} is already released`)

        // moveUnfixedIssuesTo wants the target's self URL, which only the
        // version itself reports, so the target is read in full.
        let moveTo: Version | undefined
        if (options.moveUnresolvedTo) {
          const target = await findVersion(
            client,
            options.moveUnresolvedTo,
            options.project,
          )
          if (target.id === found.id)
            throw exitError(
              1,
              "--move-unresolved-to names the version being released",
            )
          moveTo = await client.request<Version>(
            `/rest/api/3/version/${target.id}`,
          )
        }

        const body = {
          released: true,
          releaseDate: options.date
            ? plainDate(options.date, "--date")
            : today(),
          ...(moveTo?.self ? { moveUnfixedIssuesTo: moveTo.self } : {}),
        }
        let released: Version
        try {
          released = await client.request<Version>(
            `/rest/api/3/version/${found.id}`,
            {
              method: "PUT",
              body: JSON.stringify(body),
            },
          )
        } catch (error) {
          throw await projectAdminRefusal(
            error,
            client,
            options.project,
            `releasing ${found.name}`,
          )
        }
        if (!moveTo) {
          const left = await client.request<Unresolved>(
            `/rest/api/3/version/${found.id}/unresolvedIssueCount`,
          )
          if (left.issuesUnresolvedCount)
            process.stderr.write(
              `${left.issuesUnresolvedCount} unresolved issue${left.issuesUnresolvedCount === 1 ? "" : "s"} stay in ${found.name}; --move-unresolved-to moves them\n`,
            )
        }
        if (options.json) return printJson(released)
        process.stderr.write(
          `released ${found.name} on ${body.releaseDate}${moveTo ? `, unresolved issues moved to ${moveTo.name}` : ""}\n`,
        )
      },
    )
}
