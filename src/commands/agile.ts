import type { Command } from "commander"
import type { JiraIssue } from "../api/types.js"
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

export const registerBoardCommands = (program: Command): void => {
  const board = program
    .command("board")
    .description("boards, backlogs and epics")

  board
    .command("list")
    .alias("ls")
    .description("list boards")
    .option("--json", "emit JSON")
    .action(async (options: { json?: boolean }) => {
      const ctx = context()
      const { values } = await ctx.client.getBoards()
      if (options.json) return printJson(values)
      process.stdout.write(
        `${table(values, [
          { header: "ID", value: (b) => String(b.id) },
          { header: "NAME", value: (b) => b.name },
          { header: "TYPE", value: (b) => b.type ?? "—" },
        ])}\n`,
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
