import type { Command } from "commander"
import React from "react"
import { render } from "ink"
import { loadConfig } from "../../config.js"
import { JiraClient } from "../../client.js"
import { IssueList } from "../../ui/issue-list.js"

export const registerIssueListCommand = (issueCmd: Command): void => {
  issueCmd
    .command("list")
    .description("List Jira issues")
    .option("-p, --project <key>", "filter by project key")
    .option(
      "-a, --assignee <name>",
      'filter by assignee ("me" for current user)',
    )
    .option("-s, --status <name>", "filter by status name")
    .option("-t, --type <name>", "filter by issue type")
    .option("--jql <query>", "raw JQL query (overrides other filters)")
    .option("-n, --limit <n>", "max results", "25")
    .option("--json", "output as JSON")
    .action(
      async (opts: {
        project?: string
        assignee?: string
        status?: string
        type?: string
        jql?: string
        limit: string
        json: boolean
      }) => {
        const config = loadConfig()
        const client = new JiraClient(config)

        let jql = opts.jql ?? ""

        if (!jql) {
          const clauses: string[] = []
          if (opts.project) clauses.push(`project = "${opts.project}"`)
          if (opts.assignee) {
            const assignee =
              opts.assignee === "me" ? "currentUser()" : `"${opts.assignee}"`
            clauses.push(`assignee = ${assignee}`)
          }
          if (opts.status) clauses.push(`status = "${opts.status}"`)
          if (opts.type) clauses.push(`issuetype = "${opts.type}"`)
          jql =
            clauses.length > 0 ? clauses.join(" AND ") : "ORDER BY updated DESC"
          if (clauses.length > 0) jql += " ORDER BY updated DESC"
        }

        const result = await client.searchIssues(jql, {
          maxResults: parseInt(opts.limit, 10),
        })

        if (opts.json || !process.stdout.isTTY) {
          process.stdout.write(JSON.stringify(result, null, 2) + "\n")
          return
        }

        render(<IssueList issues={result.issues} total={result.total} />)
      },
    )
}
