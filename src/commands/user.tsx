import type { Command } from "commander"
import React from "react"
import { render } from "ink"
import { Box, Text } from "ink"
import { loadConfig } from "../config.js"
import { JiraClient } from "../client.js"
import type { JiraUser } from "../types.js"

const UserList = ({ users }: { users: JiraUser[] }) => (
  <Box flexDirection="column" paddingY={1}>
    <Box gap={2} marginBottom={1}>
      <Text dimColor bold>
        {"ACCOUNT ID".padEnd(28)}
      </Text>
      <Text dimColor bold>
        {"NAME".padEnd(24)}
      </Text>
      <Text dimColor bold>
        EMAIL
      </Text>
    </Box>
    {users.map((u) => (
      <Box key={u.accountId} gap={2}>
        <Text color="cyan">{u.accountId.padEnd(28)}</Text>
        <Text>{u.displayName.padEnd(24)}</Text>
        <Text color="gray">{u.emailAddress ?? "—"}</Text>
      </Box>
    ))}
  </Box>
)

export const registerUserCommands = (program: Command): void => {
  const userCmd = program.command("user").description("Search Jira users")

  userCmd
    .command("search <query>")
    .description("Search users by name or email")
    .option("-p, --project <key>", "limit to users assignable to a project")
    .option("-n, --limit <n>", "max results", "20")
    .option("--json", "output as JSON")
    .action(
      async (
        query: string,
        opts: { project?: string; limit: string; json: boolean },
      ) => {
        const client = new JiraClient(loadConfig())
        const users = await client.searchUsers(query, {
          projectKey: opts.project,
          maxResults: parseInt(opts.limit, 10),
        })

        if (opts.json || !process.stdout.isTTY) {
          process.stdout.write(JSON.stringify(users, null, 2) + "\n")
          return
        }

        render(<UserList users={users} />)
      },
    )
}
