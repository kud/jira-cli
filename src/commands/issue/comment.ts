import type { Command } from "commander"
import chalk from "chalk"
import { loadConfig } from "../../config.js"
import { JiraClient } from "../../client.js"

const textDoc = (text: string) => ({
  version: 1,
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [{ type: "text", text }],
    },
  ],
})

export const registerIssueCommentCommand = (issueCmd: Command): void => {
  issueCmd
    .command("comment <key> <body>")
    .description("Add a comment to a Jira issue")
    .action(async (key: string, body: string) => {
      const client = new JiraClient(loadConfig())
      await client.addComment(key.toUpperCase(), textDoc(body))
      process.stdout.write(
        `${chalk.green("✓")} Comment added to ${chalk.cyan(key.toUpperCase())}\n`,
      )
    })
}
