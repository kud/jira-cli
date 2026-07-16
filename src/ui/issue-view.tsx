import React from "react"
import { Box, Text } from "ink"
import type { JiraIssue } from "../types.js"
import { docToText } from "./doc-renderer.js"

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

const priorityColor = (name: string): string => {
  switch (name.toLowerCase()) {
    case "highest":
    case "critical":
      return "red"
    case "high":
    case "major":
      return "yellow"
    case "medium":
      return "cyan"
    default:
      return "gray"
  }
}

const formatDate = (iso: string): string =>
  new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })

interface Props {
  issue: JiraIssue
}

export const IssueView = ({ issue }: Props) => {
  const f = issue.fields
  const description = docToText(f.description)
  const storyPoints = f["customfield_10002"] as number | null | undefined

  return (
    <Box flexDirection="column" gap={1} paddingY={1}>
      <Box flexDirection="column" gap={0}>
        <Box gap={1}>
          <Text color="cyan" bold>
            {issue.key}
          </Text>
          <Text dimColor>·</Text>
          <Text color="gray">{f.issuetype.name}</Text>
          {f.priority && (
            <>
              <Text dimColor>·</Text>
              <Text color={priorityColor(f.priority.name)}>
                {f.priority.name}
              </Text>
            </>
          )}
        </Box>
        <Text bold>{f.summary}</Text>
      </Box>

      <Box gap={3}>
        <Box gap={1}>
          <Text dimColor>Status</Text>
          <Text color={statusColor(f.status.statusCategory.key)} bold>
            {f.status.name}
          </Text>
        </Box>
        <Box gap={1}>
          <Text dimColor>Assignee</Text>
          <Text>{f.assignee?.displayName ?? "Unassigned"}</Text>
        </Box>
        {storyPoints != null && (
          <Box gap={1}>
            <Text dimColor>Points</Text>
            <Text>{storyPoints}</Text>
          </Box>
        )}
      </Box>

      <Box gap={3}>
        <Box gap={1}>
          <Text dimColor>Project</Text>
          <Text>{f.project.name}</Text>
        </Box>
        <Box gap={1}>
          <Text dimColor>Created</Text>
          <Text>{formatDate(f.created)}</Text>
        </Box>
        <Box gap={1}>
          <Text dimColor>Updated</Text>
          <Text>{formatDate(f.updated)}</Text>
        </Box>
      </Box>

      {f.labels && f.labels.length > 0 && (
        <Box gap={1}>
          <Text dimColor>Labels</Text>
          {f.labels.map((l) => (
            <Text key={l} color="magenta">
              {l}
            </Text>
          ))}
        </Box>
      )}

      {description && (
        <Box flexDirection="column" gap={0}>
          <Text dimColor bold>
            Description
          </Text>
          <Text wrap="wrap">{description}</Text>
        </Box>
      )}

      {f.comment && f.comment.comments.length > 0 && (
        <Box flexDirection="column" gap={1}>
          <Text dimColor bold>
            Comments ({f.comment.total})
          </Text>
          {f.comment.comments.slice(-3).map((c) => (
            <Box key={c.id} flexDirection="column" gap={0}>
              <Box gap={1}>
                <Text color="cyan">{c.author.displayName}</Text>
                <Text dimColor>{formatDate(c.created)}</Text>
              </Box>
              <Text wrap="wrap">{docToText(c.body)}</Text>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  )
}
