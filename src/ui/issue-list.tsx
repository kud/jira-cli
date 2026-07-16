import React from "react"
import { Box, Text } from "ink"
import type { JiraIssue } from "../types.js"

const statusColor = (category: string): string => {
  switch (category) {
    case "done":
      return "green"
    case "indeterminate":
      return "blue"
    default:
      return "yellow"
  }
}

const truncate = (s: string, max: number): string =>
  s.length > max ? s.slice(0, max - 1) + "…" : s

interface Props {
  issues: JiraIssue[]
  total: number
}

export const IssueList = ({ issues, total }: Props) => (
  <Box flexDirection="column" paddingY={1}>
    <Box gap={2} marginBottom={1}>
      <Text dimColor bold>
        {"KEY".padEnd(12)}
      </Text>
      <Text dimColor bold>
        {"TYPE".padEnd(10)}
      </Text>
      <Text dimColor bold>
        {"STATUS".padEnd(18)}
      </Text>
      <Text dimColor bold>
        {"ASSIGNEE".padEnd(20)}
      </Text>
      <Text dimColor bold>
        SUMMARY
      </Text>
    </Box>
    {issues.map((issue) => {
      const f = issue.fields
      return (
        <Box key={issue.key} gap={2}>
          <Text color="cyan">{issue.key.padEnd(12)}</Text>
          <Text color="gray">{truncate(f.issuetype.name, 10).padEnd(10)}</Text>
          <Text color={statusColor(f.status.statusCategory.key)}>
            {truncate(f.status.name, 18).padEnd(18)}
          </Text>
          <Text>{truncate(f.assignee?.displayName ?? "—", 20).padEnd(20)}</Text>
          <Text>{truncate(f.summary, 60)}</Text>
        </Box>
      )
    })}
    <Box marginTop={1}>
      <Text dimColor>
        Showing {issues.length} of {total} issues
      </Text>
    </Box>
  </Box>
)
