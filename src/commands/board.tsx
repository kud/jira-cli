import type { Command } from "commander"
import React from "react"
import { render } from "ink"
import { Box, Text } from "ink"
import { loadConfig } from "../config.js"
import { JiraClient } from "../client.js"
import type { JiraBoard } from "../types.js"

const BoardList = ({ boards }: { boards: JiraBoard[] }) => (
  <Box flexDirection="column" paddingY={1}>
    <Box gap={2} marginBottom={1}>
      <Text dimColor bold>
        {"ID".padEnd(8)}
      </Text>
      <Text dimColor bold>
        {"TYPE".padEnd(10)}
      </Text>
      <Text dimColor bold>
        {"PROJECT".padEnd(12)}
      </Text>
      <Text dimColor bold>
        NAME
      </Text>
    </Box>
    {boards.map((b) => (
      <Box key={b.id} gap={2}>
        <Text color="cyan">{String(b.id).padEnd(8)}</Text>
        <Text color="gray">{b.type.padEnd(10)}</Text>
        <Text color="gray">{(b.location?.projectKey ?? "—").padEnd(12)}</Text>
        <Text>{b.name}</Text>
      </Box>
    ))}
  </Box>
)

export const registerBoardCommands = (program: Command): void => {
  const boardCmd = program.command("board").description("Manage Jira boards")

  boardCmd
    .command("list")
    .description("List boards")
    .option("-p, --project <key>", "filter by project key")
    .option("--json", "output as JSON")
    .action(async (opts: { project?: string; json: boolean }) => {
      const client = new JiraClient(loadConfig())
      const query = opts.project ? `?projectKeyOrId=${opts.project}` : ""
      const result = await client.request<{ values: JiraBoard[] }>(
        `/rest/agile/1.0/board${query}`,
      )

      if (opts.json || !process.stdout.isTTY) {
        process.stdout.write(JSON.stringify(result.values, null, 2) + "\n")
        return
      }

      render(<BoardList boards={result.values} />)
    })
}
