import type { Command } from "commander"
import type {
  JiraBoard,
  JiraBoardConfiguration,
  JiraClient,
  JiraFilter,
  JiraIssue,
} from "@kud/jira"
import { isJiraApiError } from "@kud/jira"
import { table, truncate, type Column } from "../output/format.js"
import { context, printJson } from "./context.js"

const issueRows: Column<JiraIssue>[] = [
  { header: "KEY", value: (i) => i.key },
  { header: "STATUS", value: (i) => i.fields.status?.name ?? "—" },
  { header: "SUMMARY", value: (i) => truncate(i.fields.summary ?? "", 72) },
  {
    header: "ASSIGNEE",
    value: (i) => i.fields.assignee?.displayName ?? "unassigned",
  },
]

const writeIssues = (issues: JiraIssue[], json?: boolean): void => {
  if (json) return printJson(issues)
  if (issues.length === 0) {
    process.stderr.write("no issues\n")
    return
  }
  process.stdout.write(`${table(issues, issueRows)}\n`)
}

/**
 * Scoped boards need the raw endpoint; the unscoped getBoards cannot take a
 * project. Each response carries its own startAt and isLast, so the next
 * page starts at startAt plus the page length. Stop on isLast (or its
 * absence), and on an empty page too: Jira saying isLast: false for a page
 * with no values would otherwise loop forever.
 */
const listProjectBoards = async (
  request: JiraClient["request"],
  project: string,
): Promise<JiraBoard[]> => {
  const base = `/rest/agile/1.0/board?projectKeyOrId=${encodeURIComponent(project)}`
  const boards: JiraBoard[] = []
  let path: string = base
  while (path) {
    const page: {
      values?: JiraBoard[]
      isLast?: boolean
      startAt?: number
    } = await request(path)
    const pageBoards = page.values ?? []
    boards.push(...pageBoards)
    const startAt = (page.startAt ?? 0) + pageBoards.length
    path =
      page.isLast !== false || pageBoards.length === 0
        ? ""
        : `${base}&startAt=${startAt}`
  }
  return boards
}

export const registerBoardCommands = (program: Command): void => {
  const board = program
    .command("board")
    .description("boards, backlogs and epics")

  board
    .command("list")
    .alias("ls")
    .description("list boards")
    .option("--json", "emit JSON")
    .option("--project <key>", "filter boards by project key")
    .action(async (options: { json?: boolean; project?: string }) => {
      const ctx = context()
      const boards = options.project
        ? await listProjectBoards(ctx.client.request, options.project)
        : (await ctx.client.getBoards()).values
      if (options.json) return printJson(boards)
      process.stdout.write(
        `${table(boards, [
          { header: "ID", value: (b) => String(b.id) },
          { header: "NAME", value: (b) => b.name },
          { header: "TYPE", value: (b) => b.type ?? "—" },
        ])}\n`,
      )
    })

  board
    .command("view <id>")
    .description("show a board's configuration and filter")
    .option("--json", "emit JSON")
    .action(async (id: string, options: { json?: boolean }) => {
      const ctx = context()
      // JiraBoardConfiguration does not declare filter, but the real
      // configuration response carries filter: { id, self }, and the filter
      // is the only public way to name a board's JQL.
      const config = (await ctx.client.getBoardConfiguration(
        Number(id),
      )) as JiraBoardConfiguration & { filter?: { id: string; self?: string } }
      let filter: JiraFilter | null = null
      let unavailable = !config.filter?.id
      if (config.filter?.id) {
        try {
          filter = await ctx.client.request<JiraFilter>(
            `/rest/api/3/filter/${config.filter.id}`,
          )
        } catch (e) {
          if (isJiraApiError(e) && (e.status === 403 || e.status === 404))
            unavailable = true
          else throw e
        }
      }

      const statuses = await ctx.client.getStatuses()
      const statusMap = new Map(statuses.map((s) => [s.id, s.name]))

      if (options.json) {
        return printJson({
          ...config,
          filter: filter
            ? { ...config.filter, ...filter }
            : { ...config.filter, unavailable: true },
        })
      }

      const { dim } = ctx.out
      const columns = config.columnConfig?.columns ?? []
      const columnLines = columns.map((col) => {
        const statusNames = col.statuses
          .map((s) => statusMap.get(s.id) ?? s.id)
          .join(", ")
        return `${dim("column")}  ${col.name}  ${dim(statusNames)}`
      })

      process.stdout.write(
        `${[
          config.name,
          `${dim("type")}  ${config.type ?? "—"}`,
          `${dim("filter")}  ${
            filter
              ? `${filter.name}  ${dim(filter.jql ?? "")}`
              : unavailable
                ? "unavailable"
                : "—"
          }`,
          ...columnLines,
        ].join("\n")}\n`,
      )
    })

  board
    .command("issues <id>")
    .description("issues on a board")
    .option("-q, --jql <jql>", "narrow with JQL")
    .option("--json", "emit JSON")
    .action(async (id: string, options: { jql?: string; json?: boolean }) => {
      const ctx = context()
      const { issues } = await ctx.client.getBoardIssues(
        Number(id),
        options.jql,
      )
      writeIssues(issues, options.json)
    })

  board
    .command("backlog <id>")
    .description("the backlog for a board")
    .option("--json", "emit JSON")
    .action(async (id: string, options: { json?: boolean }) => {
      const ctx = context()
      const { issues } = await ctx.client.getBacklog(Number(id))
      writeIssues(issues, options.json)
    })

  board
    .command("epics <id>")
    .description("epics on a board")
    .option("--json", "emit JSON")
    .action(async (id: string, options: { json?: boolean }) => {
      const ctx = context()
      const { values } = await ctx.client.getBoardEpics(Number(id))
      if (options.json) return printJson(values)
      process.stdout.write(
        `${table(values, [
          { header: "KEY", value: (e) => e.key },
          { header: "NAME", value: (e) => e.name },
          { header: "DONE", value: (e) => (e.done ? "yes" : "no") },
        ])}\n`,
      )
    })
}

export const registerSprintCommands = (program: Command): void => {
  const sprint = program.command("sprint").description("sprints and their work")

  sprint
    .command("list <boardId>")
    .alias("ls")
    .description("sprints on a board")
    .option(
      "--state <state>",
      "active, future or closed; comma-separate to combine",
    )
    .option("--json", "emit JSON")
    .action(
      async (boardId: string, options: { state?: string; json?: boolean }) => {
        const ctx = context()
        const { values } = await ctx.client.getSprints(
          Number(boardId),
          options.state,
        )
        if (options.json) return printJson(values)
        process.stdout.write(
          `${table(values, [
            { header: "ID", value: (s) => String(s.id) },
            { header: "NAME", value: (s) => s.name },
            { header: "STATE", value: (s) => s.state },
            { header: "ENDS", value: (s) => s.endDate?.slice(0, 10) ?? "—" },
          ])}\n`,
        )
      },
    )

  sprint
    .command("issues <id>")
    .description("issues in a sprint")
    .option("--json", "emit JSON")
    .action(async (id: string, options: { json?: boolean }) => {
      const ctx = context()
      const { issues } = await ctx.client.getSprintIssues(Number(id))
      writeIssues(issues, options.json)
    })

  sprint
    .command("add <sprintId> <keys...>")
    .description("move issues into a sprint")
    .action(async (sprintId: string, keys: string[]) => {
      await context().client.moveIssuesToSprint(Number(sprintId), keys)
      process.stderr.write(`moved ${keys.join(", ")} to sprint ${sprintId}\n`)
    })

  sprint
    .command("view <id>")
    .description("show one sprint")
    .option("--json", "emit JSON")
    .action(async (id: string, options: { json?: boolean }) => {
      const ctx = context()
      const found = await ctx.client.getSprint(Number(id))
      if (options.json) return printJson(found)
      const { dim } = ctx.out
      process.stdout.write(
        `${[
          found.name,
          `${dim("state")}  ${found.state}`,
          `${dim("start")}  ${found.startDate?.slice(0, 10) ?? "—"}`,
          `${dim("end")}    ${found.endDate?.slice(0, 10) ?? "—"}`,
        ].join("\n")}\n`,
      )
    })
}

export const registerEpicCommands = (program: Command): void => {
  program
    .command("epic <key>")
    .description("issues under an epic")
    .option("--json", "emit JSON")
    .action(async (key: string, options: { json?: boolean }) => {
      const ctx = context()
      const { issues } = await ctx.client.getEpicIssues(key)
      writeIssues(issues, options.json)
    })
}

export const registerBacklogCommand = (program: Command): void => {
  const backlog = program.command("backlog").description("backlog management")

  backlog
    .command("add <keys...>")
    .description("move issues to the backlog")
    .action(async (keys: string[]) => {
      await context().client.moveIssuesToBacklog(keys)
      process.stderr.write(`moved ${keys.join(", ")} to the backlog\n`)
    })
}
