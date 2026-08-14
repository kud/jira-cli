import type { Command } from "commander"
import { table } from "../output/format.js"
import { context, printJson } from "./context.js"

/**
 * Instance metadata: the vocabularies you need in order to write anything.
 * Grouped under one command because they share a shape — a flat list of named
 * things — and because nobody remembers which of them Jira calls what.
 */
export const registerMetaCommands = (program: Command): void => {
  const meta = program
    .command("meta")
    .description("what this instance supports: types, priorities, statuses")

  const named = (
    name: string,
    description: string,
    fetch: () => Promise<{ id: string; name: string }[]>,
  ): void => {
    meta
      .command(name)
      .description(description)
      .option("--json", "emit JSON")
      .action(async (options: { json?: boolean }) => {
        const values = await fetch()
        if (options.json) return printJson(values)
        process.stdout.write(
          `${table(values, [
            { header: "ID", value: (v) => v.id },
            { header: "NAME", value: (v) => v.name },
          ])}\n`,
        )
      })
  }

  named("issuetypes", "issue types on this instance", async () =>
    context().client.getIssueTypes(),
  )
  named("priorities", "priorities on this instance", async () =>
    context().client.getPriorities(),
  )
  named("statuses", "statuses on this instance", async () =>
    context().client.getStatuses(),
  )
  named("resolutions", "resolutions on this instance", async () =>
    context().client.getResolutions(),
  )
  named(
    "linktypes",
    "issue link types",
    async () => (await context().client.getIssueLinkTypes()).issueLinkTypes,
  )

  meta
    .command("labels")
    .description("every label in use")
    .option("--json", "emit JSON")
    .action(async (options: { json?: boolean }) => {
      const { values } = await context().client.getLabels()
      if (options.json) return printJson(values)
      process.stdout.write(`${values.join("\n")}\n`)
    })

  meta
    .command("filters")
    .description("saved filters you can see")
    .option("--json", "emit JSON")
    .action(async (options: { json?: boolean }) => {
      const { values } = await context().client.getFilters()
      if (options.json) return printJson(values)
      process.stdout.write(
        `${table(values, [
          { header: "ID", value: (f) => f.id },
          { header: "NAME", value: (f) => f.name },
          { header: "JQL", value: (f) => f.jql ?? "—" },
        ])}\n`,
      )
    })

  meta
    .command("permissions [projectKey]")
    .description("what you are allowed to do")
    .action(async (projectKey: string | undefined) => {
      printJson(await context().client.getMyPermissions(projectKey))
    })

  meta
    .command("server")
    .description("instance version and deployment details")
    .action(async () => {
      printJson(await context().client.getServerInfo())
    })
}

export const registerCountCommand = (program: Command): void => {
  program
    .command("count <jql>")
    .description("approximate number of issues matching a query")
    .action(async (jql: string) => {
      const { count } = await context().client.approximateCount(jql)
      process.stdout.write(`${count}\n`)
    })
}
