import type { Command } from "commander"
import { table } from "../output/format.js"
import { context, printJson } from "./context.js"

export const registerProjectCommands = (program: Command): void => {
  const project = program
    .command("project")
    .alias("proj")
    .description("projects, their versions and components")

  project
    .command("list")
    .alias("ls")
    .description("list projects you can see")
    .option("--json", "emit JSON")
    .action(async (options: { json?: boolean }) => {
      const ctx = context()
      const projects = await ctx.client.getProjects()
      if (options.json) return printJson(projects)
      process.stdout.write(
        `${table(projects, [
          { header: "KEY", value: (p) => p.key },
          { header: "NAME", value: (p) => p.name },
        ])}\n`,
      )
    })

  project
    .command("view <key>")
    .description("show one project")
    .option("--json", "emit JSON")
    .action(async (key: string, options: { json?: boolean }) => {
      const ctx = context()
      const found = await ctx.client.getProject(key)
      if (options.json) return printJson(found)
      const { dim } = ctx.out
      process.stdout.write(
        `${[`${found.key}  ${found.name}`, `${dim("id")}   ${found.id}`].join(
          "\n",
        )}\n`,
      )
    })

  project
    .command("versions <key>")
    .description("list a project's versions")
    .option("--json", "emit JSON")
    .action(async (key: string, options: { json?: boolean }) => {
      const ctx = context()
      const versions = await ctx.client.getProjectVersions(key)
      if (options.json) return printJson(versions)
      process.stdout.write(
        `${table(versions, [
          { header: "ID", value: (v) => v.id },
          { header: "NAME", value: (v) => v.name },
          {
            header: "STATE",
            value: (v) =>
              v.archived ? "archived" : v.released ? "released" : "open",
          },
          { header: "RELEASE", value: (v) => v.releaseDate ?? "—" },
        ])}\n`,
      )
    })

  project
    .command("components <key>")
    .description("list a project's components")
    .option("--json", "emit JSON")
    .action(async (key: string, options: { json?: boolean }) => {
      const ctx = context()
      const components = await ctx.client.getProjectComponents(key)
      if (options.json) return printJson(components)
      process.stdout.write(
        `${table(components, [
          { header: "ID", value: (c) => c.id },
          { header: "NAME", value: (c) => c.name },
          { header: "LEAD", value: (c) => c.lead?.displayName ?? "—" },
        ])}\n`,
      )
    })

  project
    .command("statuses <key>")
    .description("list the statuses available per issue type")
    .option("--json", "emit JSON")
    .action(async (key: string, options: { json?: boolean }) => {
      const ctx = context()
      const statuses = await ctx.client.getProjectStatuses(key)
      if (options.json) return printJson(statuses)
      process.stdout.write(
        `${statuses
          .map(
            (s) => `${s.name}\n  ${s.statuses.map((x) => x.name).join(", ")}`,
          )
          .join("\n")}\n`,
      )
    })
}
