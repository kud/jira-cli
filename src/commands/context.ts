import { createJiraClient, type JiraClient } from "@kud/jira"
import { loadConfig, type Config } from "../config.js"
import { palette, type Palette } from "../output/format.js"

export type Context = {
  client: JiraClient
  config: Config
  out: Palette
}

export type ExitError = Error & { name: "ExitError"; code: number }

export const exitError = (code: number, message: string): ExitError =>
  Object.assign(new Error(message), { name: "ExitError" as const, code })

export const isExitError = (e: unknown): e is ExitError =>
  e instanceof Error && e.name === "ExitError"

/**
 * The one place credentials are read and the one place we exit on their
 * absence. Keeping it out of the api/ layer is what lets that layer be
 * published as a library and driven from a test with a fake fetch.
 */
export const context = (): Context => {
  const loaded = loadConfig()
  if ("missing" in loaded) {
    throw exitError(
      2,
      `missing environment variables: ${loaded.missing.join(", ")}\n` +
        `\nSet them, then retry:\n` +
        `  export ATLASSIAN_BASE_URL=myorg.atlassian.net\n` +
        `  export ATLASSIAN_USER_EMAIL=you@example.com\n` +
        `  export ATLASSIAN_API_TOKEN=...  # id.atlassian.com/manage-profile/security/api-tokens`,
    )
  }

  const { config } = loaded
  return {
    config,
    client: createJiraClient(config),
    out: palette(process.stdout.isTTY === true),
  }
}

export const printJson = (value: unknown): void => {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

/**
 * Jira's newer /search/jql returns no total, so "50 of 900" is not buildable —
 * only "there is more". A full page is the only evidence of truncation left,
 * which reports a false positive when the result lands exactly on the limit.
 * That is the right side to be wrong on: a caller re-runs with a higher limit
 * and finds nothing new, where the other direction is a silently short answer.
 *
 * The signal stays out of band — stderr and the exit code — because --json's
 * shape is a contract, and a program that only reads stdout must keep parsing
 * exactly as it did. It is not conditioned on --json either: a truncated
 * result is a fact about the query, not about how it was rendered, and the
 * table output is piped through awk as often as the JSON is through jq.
 */
export const TRUNCATED_EXIT_CODE = 3

export const isTruncated = (count: number, limit: number): boolean =>
  Number.isFinite(limit) && limit > 0 && count >= limit

export const warnIfTruncated = (count: number, limit: number): void => {
  if (!isTruncated(count, limit)) return
  process.stderr.write(
    `jira: result may be truncated at --limit ${limit} — there may be more\n`,
  )
  // Not process.exit: stdout is asynchronous when it is a pipe, so exiting
  // here would risk cutting the JSON we just wrote in half.
  process.exitCode = TRUNCATED_EXIT_CODE
}
