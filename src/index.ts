#!/usr/bin/env node
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
  .version("0.2.0")
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

program.parseAsync(process.argv).catch((error: unknown) => {
  process.stderr.write(
    `jira: ${error instanceof Error ? error.message : String(error)}\n`,
  )
  process.exit(exitCodeFor(error))
})
