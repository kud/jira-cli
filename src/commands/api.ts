import type { Command } from "commander"
import { spawnSync } from "child_process"
import chalk from "chalk"
import { loadConfig } from "../config.js"
import { JiraClient, JiraApiError } from "../client.js"
import { colorizeJson } from "../ui/json.js"

const AGILE_RESOURCES = new Set(["board", "sprint", "epic", "backlog"])

const expandPath = (path: string): string => {
  if (path.startsWith("/rest/") || path.startsWith("http")) return path
  const resource = path.split("/")[0]?.split("?")[0] ?? ""
  return AGILE_RESOURCES.has(resource)
    ? `/rest/agile/1.0/${path}`
    : `/rest/api/3/${path}`
}

const parseFields = (pairs: string[]): Record<string, unknown> =>
  Object.fromEntries(
    pairs.map((pair) => {
      const eq = pair.indexOf("=")
      if (eq === -1)
        throw new Error(`invalid field format "${pair}" — expected key=value`)
      return [pair.slice(0, eq), pair.slice(eq + 1)]
    }),
  )

const applyJq = (json: string, expr: string): string => {
  const result = spawnSync("jq", [expr], {
    input: json,
    encoding: "utf8",
  })
  if (result.error) {
    process.stderr.write(
      `${chalk.red("error:")} jq not found — install it or remove --jq\n`,
    )
    process.exit(1)
  }
  if (result.status !== 0) {
    process.stderr.write(result.stderr)
    process.exit(result.status ?? 1)
  }
  return result.stdout
}

const output = (value: unknown, jq?: string): void => {
  const json = JSON.stringify(value, null, 2)
  const filtered = jq ? applyJq(json, jq) : json

  if (process.stdout.isTTY) {
    try {
      const parsed: unknown = JSON.parse(filtered)
      process.stdout.write(colorizeJson(parsed) + "\n")
    } catch {
      process.stdout.write(filtered)
    }
  } else {
    process.stdout.write(filtered + (filtered.endsWith("\n") ? "" : "\n"))
  }
}

export const registerApiCommand = (program: Command): void => {
  program
    .command("api <path>")
    .description("Make an authenticated request to the Jira REST API")
    .addHelpText(
      "after",
      `
${chalk.dim("Path shorthands (no need for full /rest/api/3/ prefix):")}
  issue/GO-123             → /rest/api/3/issue/GO-123
  search?jql=...           → /rest/api/3/search?jql=...
  myself                   → /rest/api/3/myself
  board                    → /rest/agile/1.0/board
  board/42/sprint          → /rest/agile/1.0/board/42/sprint
  sprint/99                → /rest/agile/1.0/sprint/99
      `,
    )
    .option("-X, --method <method>", "HTTP method", "GET")
    .option(
      "-f, --field <key=value>",
      "add a JSON body field (repeatable)",
      (v, acc: string[]) => [...acc, v],
      [] as string[],
    )
    .option("--jq <expr>", "filter output with a jq expression")
    .option("--paginate", "follow pagination and merge all results")
    .option("--input", "read request body from stdin")
    .action(
      async (
        rawPath: string,
        opts: {
          method: string
          field: string[]
          jq?: string
          paginate: boolean
          input: boolean
        },
      ) => {
        const config = loadConfig()
        const client = new JiraClient(config)
        const path = expandPath(rawPath)
        const method = opts.method.toUpperCase()
        const hasBody = method !== "GET" && method !== "HEAD"

        let body: string | undefined

        if (opts.input) {
          const chunks: Buffer[] = []
          for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
          body = Buffer.concat(chunks).toString("utf8")
        } else if (opts.field.length > 0) {
          body = JSON.stringify(parseFields(opts.field))
        }

        try {
          if (opts.paginate) {
            await paginate(client, path, method, opts.jq)
            return
          }

          const result = await client.request<unknown>(path, {
            method,
            ...(hasBody && body ? { body } : {}),
          })

          output(result, opts.jq)
        } catch (err) {
          if (err instanceof JiraApiError) {
            process.stderr.write(
              `${chalk.red("error:")} ${err.status} ${err.method} ${err.url}\n${err.body}\n`,
            )
            process.exit(1)
          }
          throw err
        }
      },
    )
}

const paginate = async (
  client: JiraClient,
  path: string,
  method: string,
  jq?: string,
): Promise<void> => {
  const hasQuery = path.includes("?")
  let startAt = 0
  const all: unknown[] = []

  while (true) {
    const sep = hasQuery ? "&" : "?"
    const pagePath = `${path}${sep}startAt=${startAt}&maxResults=100`
    const result = await client.request<Record<string, unknown>>(pagePath, {
      method,
    })

    const values =
      (result["issues"] as unknown[]) ??
      (result["values"] as unknown[]) ??
      (result["results"] as unknown[])

    if (!values || values.length === 0) break
    all.push(...values)

    const total = result["total"] as number | undefined
    if (total !== undefined && all.length >= total) break
    startAt += values.length
  }

  output(all, jq)
}
