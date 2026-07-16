import type { Command } from "commander"
import React from "react"
import { render } from "ink"
import { loadConfig } from "../config.js"
import { JiraClient } from "../client.js"
import { IssueList } from "../ui/issue-list.js"

export const registerSearchCommand = (program: Command): void => {
  program
    .command("search <jql>")
    .description("Search issues with a raw JQL query")
    .option("-n, --limit <n>", "max results", "25")
    .option("--json", "output as JSON")
    .action(async (jql: string, opts: { limit: string; json: boolean }) => {
      const client = new JiraClient(loadConfig())
      const result = await client.searchIssues(jql, {
        maxResults: parseInt(opts.limit, 10),
      })

      if (opts.json || !process.stdout.isTTY) {
        process.stdout.write(JSON.stringify(result, null, 2) + "\n")
        return
      }

      render(<IssueList issues={result.issues} total={result.total} />)
    })
}
