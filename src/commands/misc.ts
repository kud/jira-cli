import { mkdirSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import type { Command } from "commander"
import type { JiraField } from "@kud/jira"
import { configPath, readFileConfig } from "../config.js"
import { table } from "../output/format.js"
import { context, exitError, printJson } from "./context.js"

export const registerSearchCommand = (program: Command): void => {
  program
    .command("search <jql>")
    .description("run a raw JQL query")
    .option("-n, --limit <n>", "maximum issues to return", "50")
    .option("--json", "emit JSON")
    .action(async (jql: string, options: { limit: string; json?: boolean }) => {
      const ctx = context()
      const issues = await ctx.client.searchIssues(jql, {
        limit: Number(options.limit),
      })
      if (options.json) return printJson(issues)
      if (issues.length === 0) {
        process.stderr.write("no issues match\n")
        return
      }
      process.stdout.write(
        `${table(issues, [
          { header: "KEY", value: (i) => i.key },
          { header: "STATUS", value: (i) => i.fields.status?.name ?? "—" },
          { header: "SUMMARY", value: (i) => i.fields.summary ?? "" },
        ])}\n`,
      )
    })
}

export const registerFieldsCommand = (program: Command): void => {
  program
    .command("fields [filter]")
    .description("list this instance's fields, to fill in your config")
    .option("--all", "include built-in fields, not just custom ones")
    .option("--json", "emit JSON")
    .action(
      async (
        filter: string | undefined,
        options: { all?: boolean; json?: boolean },
      ) => {
        const ctx = context()
        const all = await ctx.client.getFields()
        const needle = filter?.toLowerCase()

        const fields = all
          .filter((f: JiraField) => options.all || f.custom)
          .filter(
            (f: JiraField) =>
              !needle ||
              f.name.toLowerCase().includes(needle) ||
              f.id.toLowerCase().includes(needle),
          )
          .sort((a, b) => a.name.localeCompare(b.name))

        if (options.json) return printJson(fields)
        if (fields.length === 0) {
          process.stderr.write(
            `no fields match '${filter ?? ""}'. Try: jira fields --all\n`,
          )
          return
        }

        process.stdout.write(
          `${table(fields, [
            { header: "ID", value: (f) => f.id },
            { header: "NAME", value: (f) => f.name },
            { header: "TYPE", value: (f) => f.schema?.type ?? "—" },
          ])}\n`,
        )
        process.stderr.write(
          `\n${ctx.out.dim(
            `${fields.length} fields — add the ones you use to ${configPath()}:\n` +
              `  { "customFields": [{ "id": "customfield_10002", "label": "points" }] }`,
          )}\n`,
        )
      },
    )
}

const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"])

export const registerApiCommand = (program: Command): void => {
  program
    .command("api <path>")
    .description("call any Jira REST endpoint directly")
    .option("-X, --method <method>", "HTTP method", "GET")
    .option("-d, --data <json>", "request body as JSON")
    .action(
      async (path: string, options: { method: string; data?: string }) => {
        const ctx = context()
        const method = options.method.toUpperCase()
        if (!METHODS.has(method))
          throw exitError(2, `unsupported method '${options.method}'`)

        const result = await ctx.client.request<unknown>(path, {
          method,
          ...(options.data ? { body: options.data } : {}),
        })
        printJson(result ?? null)
      },
    )
}

export const registerInitCommand = (program: Command): void => {
  program
    .command("init")
    .description("write a starter config file")
    .option("--base-url <url>", "your Jira instance, e.g. myorg.atlassian.net")
    .option("--email <email>", "your Atlassian account email")
    .option("--force", "overwrite an existing config")
    .action(
      async (options: {
        baseUrl?: string
        email?: string
        force?: boolean
      }) => {
        const path = configPath()
        const existing = readFileConfig(path)

        if (Object.keys(existing).length > 0 && !options.force)
          throw exitError(1, `${path} already exists — pass --force to replace it`)

        const config = {
          baseUrl: options.baseUrl ?? process.env["ATLASSIAN_BASE_URL"] ?? "",
          email: options.email ?? process.env["ATLASSIAN_USER_EMAIL"] ?? "",
          customFields: [] as { id: string; label: string }[],
        }

        mkdirSync(dirname(path), { recursive: true })
        writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`)

        process.stderr.write(
          `wrote ${path}\n\n` +
            `Set your token, which never goes in this file:\n` +
            `  export ATLASSIAN_API_TOKEN=...\n\n` +
            `Then add the custom fields you care about:\n` +
            `  jira fields points\n`,
        )
      },
    )
}
