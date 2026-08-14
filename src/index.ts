#!/usr/bin/env node
import { realpathSync } from "node:fs"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { Command } from "commander"
import { isJiraApiError } from "@kud/jira"
import { registerAttachmentCommands } from "./commands/attachment.js"
import { isExitError } from "./commands/context.js"
import {
  registerBoardCommands,
  registerEpicCommands,
  registerSprintCommands,
} from "./commands/agile.js"
import { registerIssueCommands } from "./commands/issue.js"
import { registerCountCommand, registerMetaCommands } from "./commands/meta.js"
import { registerUserCommands } from "./commands/people.js"
import { registerProjectCommands } from "./commands/project.js"
import {
  registerApiCommand,
  registerFieldsCommand,
  registerInitCommand,
  registerSearchCommand,
} from "./commands/misc.js"
import { configPath } from "./config.js"

const program = new Command()

program
  .name("jira")
  .description("Jira on the command line")
  .version(
    (createRequire(import.meta.url)("../package.json") as { version: string })
      .version,
  )
  .addHelpText(
    "after",
    `
Setup:
  export ATLASSIAN_API_TOKEN=...    the only secret, env only
                                    id.atlassian.com/manage-profile/security/api-tokens
  jira init --base-url myorg.atlassian.net --email you@example.com

  Everything else lives in ${configPath()}, and any of it can be
  overridden with ATLASSIAN_BASE_URL / ATLASSIAN_USER_EMAIL.

Examples:
  jira issue list --mine --status 'In Progress'
  jira issue view ABC-123 --comments
  jira attachment list ABC-123
  jira attachment read ABC-123 error.log | grep -i timeout
  jira search 'project = ABC AND created >= -7d' --json | jq '.[].key'
`,
  )

registerIssueCommands(program)
registerAttachmentCommands(program)
registerSearchCommand(program)
registerFieldsCommand(program)
registerInitCommand(program)
registerProjectCommands(program)
registerBoardCommands(program)
registerSprintCommands(program)
registerEpicCommands(program)
registerUserCommands(program)
registerMetaCommands(program)
registerCountCommand(program)
registerApiCommand(program)

/**
 * Exit codes are part of the contract, since this is meant to be scripted:
 * 1 for a Jira-side or usage failure, 2 for a broken environment, and 4 when
 * Jira rejected the credentials — a caller can retry the first, but never the
 * last two.
 */
const exitCodeFor = (error: unknown): number => {
  if (isExitError(error)) return error.code
  if (isJiraApiError(error))
    return error.status === 401 || error.status === 403 ? 4 : 1
  return 1
}

const fail = (error: unknown): never => {
  process.stderr.write(
    `jira: ${error instanceof Error ? error.message : String(error)}\n`,
  )
  process.exit(exitCodeFor(error))
}

/**
 * Commander never sees the bare form, so the interactive flags are read from
 * argv directly. `--screen`'s *value* has to be discounted too, or
 * `jira --screen list` falls through as an unknown `list` command.
 */
export const interactiveArgs = (argv: string[]) => {
  const rest = argv.slice(2)
  const screenAt = rest.indexOf("--screen")
  const screen = screenAt === -1 ? undefined : rest[screenAt + 1]
  const consumed = new Set(
    screenAt === -1 ? ["--mock"] : ["--mock", "--screen", screen ?? ""],
  )
  return {
    screen,
    mock: rest.includes("--mock"),
    isBare: rest.every((a) => consumed.has(a)),
  }
}

const main = async (): Promise<void> => {
  const { screen, mock, isBare } = interactiveArgs(process.argv)

  if (screen === "list" && isBare) {
    const { SCREENS } = await import("./tui/index.js")
    process.stdout.write(`${SCREENS.join("\n")}\n`)
    return
  }

  // The TUI is only imported here, so no scriptable command ever pays for
  // loading React and Ink.
  if (isBare) {
    if (!process.stdout.isTTY) {
      program.outputHelp()
      return
    }
    const { runTui } = await import("./tui/index.js")
    const [, key] = (screen ?? "").split(":")
    await runTui({
      screen: screen?.startsWith("detail") ? "detail" : "issues",
      mock,
      ...(key ? { issueKey: key } : {}),
    })
    return
  }

  await program.parseAsync(process.argv)
}

// Guarded so a test can import this module for `interactiveArgs` without
// also running the CLI against the test runner's own argv.
const entry = process.argv[1]
if (entry && fileURLToPath(import.meta.url) === realpathSync(entry)) {
  main().catch(fail)
}
