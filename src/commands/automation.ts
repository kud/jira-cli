import { readFileSync } from "node:fs"
import type { Command } from "commander"
import { isJiraApiError, type JiraClient } from "@kud/jira"
import { table } from "../output/format.js"
import {
  context,
  exitError,
  printJson,
  warnIfTruncated,
  type Context,
} from "./context.js"

/**
 * Automation lives outside Jira's own REST tree, behind one of two hosts the
 * docs give as equivalent for an API token: the site's gateway, or
 * api.atlassian.com. The site is the default because it needs nothing beyond
 * the base URL already configured; `api` is there for networks that only
 * allow the central host.
 * https://developer.atlassian.com/cloud/automation/api/base-paths/
 */
export type AutomationHost = "site" | "api"

const HOSTS = new Set<AutomationHost>(["site", "api"])

export const automationHost = (
  flag: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): AutomationHost => {
  const raw = (flag ?? env["ATLASSIAN_AUTOMATION_HOST"] ?? "site").toLowerCase()
  if (!HOSTS.has(raw as AutomationHost))
    throw exitError(2, `unknown automation host '${raw}' — use 'site' or 'api'`)
  return raw as AutomationHost
}

export const automationBase = (
  host: AutomationHost,
  baseUrl: string,
  cloudId: string,
): string =>
  host === "api"
    ? `https://api.atlassian.com/automation/public/jira/${cloudId}/rest/v1`
    : `${baseUrl}/gateway/api/automation/public/jira/${cloudId}/rest/v1`

const resolveCloudId = async (
  client: JiraClient,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> => {
  const fromEnv = env["ATLASSIAN_CLOUD_ID"]
  if (fromEnv) return fromEnv
  const tenant = await client.request<{ cloudId?: string }>(
    "/_edge/tenant_info",
  )
  if (!tenant?.cloudId)
    throw exitError(
      1,
      "could not read this site's cloud ID from /_edge/tenant_info — set ATLASSIAN_CLOUD_ID",
    )
  return tenant.cloudId
}

/**
 * Jira answers a missing permission here with a bare 403 and no body, so the
 * raw error says nothing a person can act on. The probe that shaped this: a
 * classic token authenticates on both hosts (manual-rule search answers), yet
 * rule management refuses a project admin even when the search is scoped to
 * that very project. What is missing is the global permission, not the token.
 */
export const explainAuthFailure = (error: unknown): unknown => {
  if (!isJiraApiError(error)) return error
  if (error.status === 401)
    return exitError(
      4,
      "Jira rejected the credentials for the Automation API.\n" +
        "ATLASSIAN_API_TOKEN must be a classic API token (basic auth with ATLASSIAN_USER_EMAIL) —\n" +
        "the rule management API is closed to OAuth 2.0 and Forge apps.\n" +
        "  id.atlassian.com/manage-profile/security/api-tokens",
    )
  if (error.status === 403)
    return exitError(
      4,
      `Automation API refused ${error.method} (403).\n` +
        "Managing automation rules needs the Jira administrator global permission\n" +
        "(Administer Jira) on the account behind ATLASSIAN_API_TOKEN; project admin is not enough,\n" +
        "even for rules scoped to that project. Ask a Jira admin to grant it, or to run the command.\n" +
        "A project admin can still create and edit that project's rules in the Jira web UI.",
    )
  return error
}

type Automation = {
  ctx: Context
  cloudId: string
  call: <T>(path: string, init?: RequestInit) => Promise<T>
}

const automation = async (
  hostFlag: string | undefined,
): Promise<Automation> => {
  const host = automationHost(hostFlag)
  const ctx = context()
  const cloudId = await resolveCloudId(ctx.client)
  const base = automationBase(host, ctx.config.baseUrl, cloudId)
  const call = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    try {
      return await ctx.client.request<T>(`${base}${path}`, init)
    } catch (error) {
      throw explainAuthFailure(error)
    }
  }
  return { ctx, cloudId, call }
}

type RuleState = "ENABLED" | "DISABLED"

type RuleSummary = {
  uuid: string
  name: string
  state: RuleState | string
  ruleScopeARIs?: string[]
  labels?: string[]
  updated?: number
}

type RuleSummaryPage = {
  data?: RuleSummary[]
  links?: { next?: string }
}

/**
 * `links.next` used to be an absolute URL and is now only the query string
 * (changelog, August 2025). Reading the cursor out of either keeps both shapes
 * working without caring which this site returns.
 */
export const nextCursor = (next: string | undefined): string | undefined => {
  if (!next) return undefined
  const query = next.includes("?") ? next.slice(next.indexOf("?")) : next
  return new URLSearchParams(query).get("cursor") ?? undefined
}

export const projectAri = (cloudId: string, projectId: string): string =>
  `ari:cloud:jira:${cloudId}:project/${projectId}`

/** The API wants `{ rule, connections? }`; a bare rule is wrapped. */
export const rulePayload = (raw: unknown, file: string): object => {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw))
    throw exitError(1, `${file}: expected a JSON object holding a rule`)
  return "rule" in raw ? raw : { rule: raw }
}

const readRuleFile = (file: string): object => {
  const text =
    file === "-" ? readFileSync(0, "utf8") : readFileSync(file, "utf8")
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw exitError(
      1,
      `${file}: not valid JSON — ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  return rulePayload(parsed, file)
}

const STATES = new Set(["ENABLED", "DISABLED"])

type HostOption = { host?: string }

const hostOption = (command: Command): Command =>
  command.option(
    "--host <site|api>",
    "where to reach the Automation API: the site gateway, or api.atlassian.com (env: ATLASSIAN_AUTOMATION_HOST)",
  )

const setState = (
  automationCommand: Command,
  name: "enable" | "disable",
  state: RuleState,
): void => {
  hostOption(
    automationCommand.command(`${name} <uuid>`).description(`${name} a rule`),
  ).action(async (uuid: string, options: HostOption) => {
    const { call } = await automation(options.host)
    await call(`/rule/${encodeURIComponent(uuid)}/state`, {
      method: "PUT",
      body: JSON.stringify({ value: state }),
    })
    process.stderr.write(`${name}d ${uuid}\n`)
  })
}

export const registerAutomationCommands = (program: Command): void => {
  const automationCommand = program
    .command("automation")
    .description("list, read, create and switch Jira Automation rules")
    .addHelpText(
      "after",
      `
Needs the Jira administrator global permission on the account behind
ATLASSIAN_API_TOKEN (a classic API token). Project admin is not enough.

Examples:
  jira automation list --project SHOP
  jira automation get 0192e5ac-0e25-71de-ba7b-d972e6a2049a > rule.json
  jira automation update 0192e5ac-0e25-71de-ba7b-d972e6a2049a --file rule.json
  jira automation disable 0192e5ac-0e25-71de-ba7b-d972e6a2049a
`,
    )

  hostOption(
    automationCommand
      .command("list")
      .description("list rules, optionally only those scoped to a project")
      .option("-p, --project <key>", "only rules scoped to this project")
      .option("--state <state>", "ENABLED or DISABLED")
      .option("-n, --limit <n>", "maximum rules to return", "100")
      .option("--json", "emit JSON"),
  ).action(
    async (
      options: HostOption & {
        project?: string
        state?: string
        limit: string
        json?: boolean
      },
    ) => {
      const limit = Number(options.limit)
      if (!Number.isInteger(limit) || limit < 1)
        throw exitError(1, `--limit must be a positive whole number`)
      const state = options.state?.toUpperCase()
      if (state && !STATES.has(state))
        throw exitError(1, `--state must be ENABLED or DISABLED`)

      const { ctx, cloudId, call } = await automation(options.host)

      let scope: string | undefined
      if (options.project) {
        const project = await ctx.client.request<{ id: string }>(
          `/rest/api/3/project/${encodeURIComponent(options.project)}`,
        )
        scope = projectAri(cloudId, project.id)
      }

      const rules: RuleSummary[] = []
      let cursor: string | undefined
      do {
        // Pages of 100 at most, and only the remainder on the last one, so
        // the result never overshoots --limit.
        const page = await call<RuleSummaryPage>("/rule/summary", {
          method: "POST",
          body: JSON.stringify({
            limit: Math.min(100, limit - rules.length),
            ...(scope ? { scope } : {}),
            ...(state ? { state } : {}),
            ...(cursor ? { cursor } : {}),
          }),
        })
        rules.push(...(page?.data ?? []))
        cursor = nextCursor(page?.links?.next)
      } while (cursor && rules.length < limit)

      if (options.json) {
        printJson(rules)
        warnIfTruncated(rules.length, limit, { exitCode: true })
        return
      }
      if (rules.length === 0) {
        process.stderr.write("no rules match\n")
        return
      }
      process.stdout.write(
        `${table(rules, [
          { header: "UUID", value: (r) => r.uuid },
          { header: "STATE", value: (r) => r.state },
          { header: "NAME", value: (r) => r.name },
        ])}\n`,
      )
      warnIfTruncated(rules.length, limit, { exitCode: false })
    },
  )

  hostOption(
    automationCommand
      .command("get <uuid>")
      .description("print a rule's full configuration as JSON")
      .option(
        "--redact",
        "redact sensitive fields such as secrets in web requests",
      ),
  ).action(async (uuid: string, options: HostOption & { redact?: boolean }) => {
    const { call } = await automation(options.host)
    const query = options.redact ? "?redactSensitiveFields=true" : ""
    printJson(await call(`/rule/${encodeURIComponent(uuid)}${query}`))
  })

  hostOption(
    automationCommand
      .command("create")
      .description("create a rule from a JSON file (the shape `get` prints)")
      .requiredOption("-f, --file <path>", "rule JSON, or - for stdin"),
  ).action(async (options: HostOption & { file: string }) => {
    const body = readRuleFile(options.file)
    const { call } = await automation(options.host)
    const created = await call<{ ruleUuid?: string }>("/rule", {
      method: "POST",
      body: JSON.stringify(body),
    })
    process.stdout.write(`${created?.ruleUuid ?? ""}\n`)
  })

  hostOption(
    automationCommand
      .command("update <uuid>")
      .description(
        "replace a rule with the JSON in a file (the shape `get` prints)",
      )
      .requiredOption("-f, --file <path>", "rule JSON, or - for stdin"),
  ).action(async (uuid: string, options: HostOption & { file: string }) => {
    const body = readRuleFile(options.file)
    const { call } = await automation(options.host)
    await call(`/rule/${encodeURIComponent(uuid)}`, {
      method: "PUT",
      body: JSON.stringify(body),
    })
    process.stderr.write(`updated ${uuid}\n`)
  })

  setState(automationCommand, "enable", "ENABLED")
  setState(automationCommand, "disable", "DISABLED")
}
