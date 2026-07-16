#!/usr/bin/env node
import { Command } from "commander"
import chalk from "chalk"
import { registerIssueCommands } from "./commands/issue/index.js"
import { registerProjectCommands } from "./commands/project.js"
import { registerSprintCommands } from "./commands/sprint.js"
import { registerBoardCommands } from "./commands/board.js"
import { registerUserCommands } from "./commands/user.js"
import { registerSearchCommand } from "./commands/search.js"
import { registerMeCommand } from "./commands/me.js"
import { registerApiCommand } from "./commands/api.js"

const program = new Command()

program
  .name("jira")
  .description("Jira on the command line")
  .version("0.1.0")
  .addHelpText(
    "after",
    `
${chalk.dim("Environment variables:")}
  ATLASSIAN_BASE_URL      Jira instance URL (e.g. https://myorg.atlassian.net)
  ATLASSIAN_USER_EMAIL    Your Atlassian account email
  ATLASSIAN_API_TOKEN     API token from https://id.atlassian.com/manage-profile/security/api-tokens
    `,
  )

registerIssueCommands(program)
registerProjectCommands(program)
registerSprintCommands(program)
registerBoardCommands(program)
registerUserCommands(program)
registerSearchCommand(program)
registerMeCommand(program)
registerApiCommand(program)

program.parseAsync(process.argv).catch((err: unknown) => {
  process.stderr.write(
    `${chalk.red("error:")} ${err instanceof Error ? err.message : String(err)}\n`,
  )
  process.exit(1)
})
