import type { Command } from "commander"
import React from "react"
import { render } from "ink"
import chalk from "chalk"
import { loadConfig } from "../../config.js"
import { JiraClient } from "../../client.js"
import { IssueView } from "../../ui/issue-view.js"
import { docToText } from "../../ui/doc-renderer.js"

export const registerIssueViewCommand = (issueCmd: Command): void => {
  issueCmd
    .command("view <key>")
    .description("View a Jira issue")
    .option("--json", "output as JSON")
    .option("--web", "open in browser")
    .action(async (key: string, opts: { json: boolean; web: boolean }) => {
      const config = loadConfig()

      if (opts.web) {
        const url = `${config.baseUrl}/browse/${key.toUpperCase()}`
        const { execSync } = await import("child_process")
        execSync(`open "${url}"`)
        return
      }

      const client = new JiraClient(config)
      const issue = await client.getIssue(key.toUpperCase())

      if (opts.json || !process.stdout.isTTY) {
        process.stdout.write(JSON.stringify(issue, null, 2) + "\n")
        return
      }

      render(<IssueView issue={issue} />)
    })

  issueCmd
    .command("<key>", { hidden: true })
    .description("Shorthand for issue view <key>")

  // Also register bare `jira issue <key>` by hooking the default action
  issueCmd.addHelpText(
    "after",
    `\n  ${chalk.dim("Tip:")} ${chalk.cyan("jira issue <KEY>")} is shorthand for ${chalk.cyan("jira issue view <KEY>")}`,
  )
}

export const resolveIssueShorthand = async (
  key: string,
  opts: { json: boolean },
): Promise<void> => {
  const config = loadConfig()
  const client = new JiraClient(config)
  const issue = await client.getIssue(key.toUpperCase())

  if (opts.json || !process.stdout.isTTY) {
    process.stdout.write(JSON.stringify(issue, null, 2) + "\n")
    return
  }

  render(<IssueView issue={issue} />)
}
