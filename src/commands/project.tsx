import type { Command } from "commander"
import React from "react"
import { render } from "ink"
import { Box, Text } from "ink"
import { loadConfig } from "../config.js"
import { JiraClient } from "../client.js"
import type { JiraProject } from "../types.js"

const ProjectList = ({ projects }: { projects: JiraProject[] }) => (
  <Box flexDirection="column" paddingY={1}>
    <Box gap={2} marginBottom={1}>
      <Text dimColor bold>
        {"KEY".padEnd(12)}
      </Text>
      <Text dimColor bold>
        {"TYPE".padEnd(12)}
      </Text>
      <Text dimColor bold>
        NAME
      </Text>
    </Box>
    {projects.map((p) => (
      <Box key={p.id} gap={2}>
        <Text color="cyan">{p.key.padEnd(12)}</Text>
        <Text color="gray">{p.projectTypeKey.padEnd(12)}</Text>
        <Text>{p.name}</Text>
      </Box>
    ))}
  </Box>
)

export const registerProjectCommands = (program: Command): void => {
  const projectCmd = program
    .command("project")
    .description("Manage Jira projects")

  projectCmd
    .command("list")
    .description("List accessible Jira projects")
    .option("--json", "output as JSON")
    .action(async (opts: { json: boolean }) => {
      const client = new JiraClient(loadConfig())
      const projects = await client.getProjects()

      if (opts.json || !process.stdout.isTTY) {
        process.stdout.write(JSON.stringify(projects, null, 2) + "\n")
        return
      }

      render(<ProjectList projects={projects} />)
    })
}
