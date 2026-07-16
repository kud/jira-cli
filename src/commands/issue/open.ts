import type { Command } from "commander"
import { execSync } from "child_process"
import { loadConfig } from "../../config.js"

export const registerIssueOpenCommand = (issueCmd: Command): void => {
  issueCmd
    .command("open <key>")
    .description("Open a Jira issue in the browser")
    .action((key: string) => {
      const { baseUrl } = loadConfig()
      execSync(`open "${baseUrl}/browse/${key.toUpperCase()}"`)
    })
}
