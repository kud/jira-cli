import type { Command } from "commander"
import chalk from "chalk"
import { loadConfig } from "../config.js"
import { JiraClient } from "../client.js"

export const registerMeCommand = (program: Command): void => {
  program
    .command("me")
    .description("Show the authenticated Jira user")
    .option("--json", "output as JSON")
    .action(async (opts: { json: boolean }) => {
      const client = new JiraClient(loadConfig())
      const user = await client.getMe()

      if (opts.json || !process.stdout.isTTY) {
        process.stdout.write(JSON.stringify(user, null, 2) + "\n")
        return
      }

      process.stdout.write(
        [
          `${chalk.bold(user.displayName)}`,
          `${chalk.dim("email")}   ${user.emailAddress ?? "—"}`,
          `${chalk.dim("account")} ${user.accountId}`,
          `${chalk.dim("active")}  ${user.active ? chalk.green("yes") : chalk.red("no")}`,
        ].join("\n") + "\n",
      )
    })
}
