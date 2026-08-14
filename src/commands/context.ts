import { createJiraClient, type JiraClient } from "../api/client.js"
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
