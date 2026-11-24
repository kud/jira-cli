import type { Command } from "commander"
import type { JiraClient } from "@kud/jira"
import { context, exitError, printJson } from "./context.js"
import { sprintRefusal } from "./refusals.js"

/**
 * Sprint writes through the Agile API: POST /sprint creates, and a partial
 * POST /sprint/{id} both edits and changes state ("active" starts a future
 * sprint that has both dates; "closed" completes an active one).
 * https://developer.atlassian.com/cloud/jira/software/rest/api-group-sprint/
 */

type Sprint = {
  id: number
  name: string
  state: string
  startDate?: string
  endDate?: string
  goal?: string
  originBoardId?: number
}

/** Jira takes ISO 8601; a bare date is the common thing to type. */
export const isoDate = (value: string, flag: string): string => {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime()))
    throw exitError(
      1,
      `${flag} '${value}' is not a date — use YYYY-MM-DD or ISO 8601`,
    )
  return parsed.toISOString()
}

const positiveId = (raw: string, what: string): number => {
  const id = Number(raw)
  if (!Number.isInteger(id) || id < 1)
    throw exitError(1, `${what} must be a number, not '${raw}'`)
  return id
}

const updateSprint = async (
  client: JiraClient,
  id: number,
  body: Record<string, unknown>,
  what: string,
): Promise<Sprint> => {
  try {
    return await client.request<Sprint>(`/rest/agile/1.0/sprint/${id}`, {
      method: "POST",
      body: JSON.stringify(body),
    })
  } catch (error) {
    throw sprintRefusal(error, what)
  }
}

/** Keys of a sprint's issues whose status is not in the Done category. */
export const openIssueKeys = async (
  client: JiraClient,
  sprintId: number,
): Promise<string[]> => {
  const keys: string[] = []
  for (let startAt = 0; ;) {
    const query = new URLSearchParams({
      jql: "statusCategory != Done",
      fields: "status",
      startAt: String(startAt),
      maxResults: "100",
    })
    const page = await client.request<{
      issues?: { key: string }[]
      total?: number
    }>(`/rest/agile/1.0/sprint/${sprintId}/issue?${query}`)
    const issues = page?.issues ?? []
    keys.push(...issues.map((i) => i.key))
    startAt += issues.length
    if (
      issues.length === 0 ||
      page?.total === undefined ||
      startAt >= page.total
    )
      break
  }
  return keys
}

/** Both move endpoints take at most 50 issues a call. */
const chunks = <T>(items: T[], size = 50): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) =>
    items.slice(i * size, i * size + size),
  )

export const moveOpenIssues = async (
  client: JiraClient,
  keys: string[],
  target: string,
): Promise<void> => {
  const path =
    target.toLowerCase() === "backlog"
      ? "/rest/agile/1.0/backlog/issue"
      : `/rest/agile/1.0/sprint/${positiveId(target, "--move-to")}/issue`
  for (const batch of chunks(keys))
    await client.request(path, {
      method: "POST",
      body: JSON.stringify({ issues: batch }),
    })
}

const printSprint = (sprint: Sprint, json?: boolean): void => {
  if (json) return printJson(sprint)
  process.stdout.write(`${sprint.id}  ${sprint.name}  ${sprint.state}\n`)
}

type DateOptions = { start?: string; end?: string }

const dates = (options: DateOptions): Record<string, string> => ({
  ...(options.start ? { startDate: isoDate(options.start, "--start") } : {}),
  ...(options.end ? { endDate: isoDate(options.end, "--end") } : {}),
})

export const registerSprintWriteCommands = (sprint: Command): void => {
  sprint
    .command("create <boardId>")
    .description("create a future sprint on a board")
    .requiredOption("--name <name>", "sprint name")
    .option("--goal <text>", "sprint goal")
    .option("--start <date>", "start date")
    .option("--end <date>", "end date")
    .option("--json", "emit JSON")
    .action(
      async (
        boardId: string,
        options: DateOptions & { name: string; goal?: string; json?: boolean },
      ) => {
        const body = {
          name: options.name,
          originBoardId: positiveId(boardId, "board ID"),
          ...(options.goal ? { goal: options.goal } : {}),
          ...dates(options),
        }
        const { client } = context()
        let created: Sprint
        try {
          created = await client.request<Sprint>("/rest/agile/1.0/sprint", {
            method: "POST",
            body: JSON.stringify(body),
          })
        } catch (error) {
          throw sprintRefusal(error, `creating a sprint on board ${boardId}`)
        }
        printSprint(created, options.json)
      },
    )

  sprint
    .command("start <id>")
    .description("start a future sprint")
    .option(
      "--start <date>",
      "start date (default: now, if the sprint has none)",
    )
    .option("--end <date>", "end date (required if the sprint has none)")
    .option("--json", "emit JSON")
    .action(async (raw: string, options: DateOptions & { json?: boolean }) => {
      const id = positiveId(raw, "sprint ID")
      const { client } = context()
      const current = await client.getSprint(id)
      if (current.state !== "future")
        throw exitError(
          1,
          `sprint ${id} is ${current.state}; only a future sprint can start`,
        )
      // Jira only starts a sprint that has both dates, and the UI's "last
      // sprint's length" default is not in the API, so a missing end is
      // asked for rather than invented.
      if (!options.end && !current.endDate)
        throw exitError(1, `sprint ${id} has no end date — pass --end <date>`)
      const body = {
        state: "active",
        ...(!options.start && !current.startDate
          ? { startDate: new Date().toISOString() }
          : {}),
        ...dates(options),
      }
      printSprint(
        await updateSprint(client, id, body, `starting sprint ${id}`),
        options.json,
      )
    })

  sprint
    .command("close <id>")
    .alias("complete")
    .description("complete an active sprint")
    .option(
      "--move-to <sprint|backlog>",
      "where the issues not in Done go, a sprint ID or 'backlog'",
    )
    .option("--json", "emit JSON")
    .action(
      async (raw: string, options: { moveTo?: string; json?: boolean }) => {
        const id = positiveId(raw, "sprint ID")
        const { client } = context()
        const open = await openIssueKeys(client, id)
        // Completing through the API leaves unfinished issues wherever Jira
        // puts them, with no say in it; the UI asks. So this asks too, by
        // refusing until a destination is named.
        if (open.length > 0 && !options.moveTo)
          throw exitError(
            1,
            `sprint ${id} still has ${open.length} open issue${open.length === 1 ? "" : "s"}: ${open.join(", ")}\n` +
              "pass --move-to <sprint ID> or --move-to backlog",
          )
        if (open.length > 0 && options.moveTo) {
          try {
            await moveOpenIssues(client, open, options.moveTo)
          } catch (error) {
            throw sprintRefusal(
              error,
              `moving sprint ${id}'s open issues to ${options.moveTo}`,
            )
          }
          process.stderr.write(
            `moved ${open.length} open issue${open.length === 1 ? "" : "s"} to ${options.moveTo}\n`,
          )
        }
        printSprint(
          await updateSprint(
            client,
            id,
            { state: "closed" },
            `closing sprint ${id}`,
          ),
          options.json,
        )
      },
    )

  sprint
    .command("edit <id>")
    .description("change a sprint's name, goal or dates")
    .option("--name <name>", "new name")
    .option("--goal <text>", "new goal; '' clears it")
    .option("--start <date>", "new start date")
    .option("--end <date>", "new end date")
    .option("--json", "emit JSON")
    .action(
      async (
        raw: string,
        options: DateOptions & { name?: string; goal?: string; json?: boolean },
      ) => {
        const id = positiveId(raw, "sprint ID")
        const body = {
          ...(options.name ? { name: options.name } : {}),
          ...(options.goal !== undefined ? { goal: options.goal } : {}),
          ...dates(options),
        }
        if (Object.keys(body).length === 0)
          throw exitError(
            2,
            "nothing to change — pass --name, --goal, --start or --end",
          )
        const { client } = context()
        printSprint(
          await updateSprint(client, id, body, `editing sprint ${id}`),
          options.json,
        )
      },
    )
}
