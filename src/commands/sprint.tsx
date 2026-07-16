import type { Command } from "commander"
import React from "react"
import { render } from "ink"
import { Box, Text } from "ink"
import chalk from "chalk"
import { loadConfig } from "../config.js"
import { JiraClient } from "../client.js"
import type { JiraSprint } from "../types.js"

const stateColor = (state: string): string => {
  switch (state) {
    case "active":
      return "green"
    case "future":
      return "cyan"
    default:
      return "gray"
  }
}

const SprintList = ({ sprints }: { sprints: JiraSprint[] }) => (
  <Box flexDirection="column" paddingY={1}>
    <Box gap={2} marginBottom={1}>
      <Text dimColor bold>
        {"ID".padEnd(8)}
      </Text>
      <Text dimColor bold>
        {"STATE".padEnd(10)}
      </Text>
      <Text dimColor bold>
        NAME
      </Text>
    </Box>
    {sprints.map((s) => (
      <Box key={s.id} gap={2}>
        <Text color="gray">{String(s.id).padEnd(8)}</Text>
        <Text color={stateColor(s.state)}>{s.state.padEnd(10)}</Text>
        <Text>{s.name}</Text>
      </Box>
    ))}
  </Box>
)

export const registerSprintCommands = (program: Command): void => {
  const sprintCmd = program.command("sprint").description("Manage Jira sprints")

  sprintCmd
    .command("list")
    .description("List sprints for a board")
    .requiredOption("-b, --board <id>", "board ID")
    .option("-s, --state <state>", "filter by state: active, future, closed")
    .option("--json", "output as JSON")
    .action(async (opts: { board: string; state?: string; json: boolean }) => {
      const client = new JiraClient(loadConfig())
      const result = await client.getSprints(
        parseInt(opts.board, 10),
        opts.state,
      )

      if (opts.json || !process.stdout.isTTY) {
        process.stdout.write(JSON.stringify(result.values, null, 2) + "\n")
        return
      }

      render(<SprintList sprints={result.values} />)
    })
}
