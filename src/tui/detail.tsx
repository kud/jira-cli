import { MarkdownViewport } from "@kud/ink-markdown"
import {
  Badge,
  FooterHints,
  KeyValue,
  Tabs,
  useTabs,
  type TabItem,
} from "@kud/ink-ui"
import { Box, Text, useInput } from "ink"
import { useState } from "react"
import { truncate } from "../output/format.js"
import type { IssueDetail } from "./data.js"

type Section = "description" | "comments" | "attachments"

const originOf = (a: IssueDetail["attachments"][number]): string =>
  a.origins
    .map((o) =>
      o.kind === "comment"
        ? `comment by ${o.author ?? "unknown"}`
        : o.kind === "description"
          ? "description"
          : "issue",
    )
    .join(", ")

const humanSize = (bytes: number): string => {
  const units = ["B", "KB", "MB", "GB"]
  const e = Math.min(
    units.length - 1,
    Math.floor(Math.log(Math.max(bytes, 1)) / Math.log(1024)),
  )
  const value = bytes / 1024 ** e
  return `${e === 0 ? value : value.toFixed(1)}${units[e]}`
}

/** Comments become one Markdown document so they scroll as a single pane. */
const commentsAsMarkdown = (issue: IssueDetail): string =>
  issue.comments.length === 0
    ? "_No comments._"
    : issue.comments
        .map((c) => `**${c.author}** · ${c.created}\n\n${c.body}`)
        .join("\n\n---\n\n")

const attachmentsAsMarkdown = (issue: IssueDetail): string =>
  issue.attachments.length === 0
    ? "_No attachments._"
    : issue.attachments
        .map(
          (a) =>
            `- \`${a.filename}\` — ${a.mimeType}, ${humanSize(a.size)}\n  from ${originOf(a)}\n  \`jira attachment read ${issue.key} ${a.filename}\``,
        )
        .join("\n")

type Props = {
  issue: IssueDetail
  height: number
  width: number
  onBack: () => void
  onTransition: () => void
  onComment: () => void
  onAssign: () => void
  onOpenBrowser: () => void
}

export const IssueDetailView = ({
  issue,
  height,
  width,
  onBack,
  onTransition,
  onComment,
  onAssign,
  onOpenBrowser,
}: Props) => {
  const tabs: TabItem<Section>[] = [
    { value: "description", label: "Description" },
    { value: "comments", label: "Comments", count: issue.comments.length },
    {
      value: "attachments",
      label: "Attachments",
      count: issue.attachments.length,
    },
  ]
  const { active } = useTabs(tabs, { initial: "description" })
  const [scroll, setScroll] = useState(0)

  useInput((input, key) => {
    if (key.escape || key.leftArrow) return onBack()
    if (input === "t") return onTransition()
    if (input === "c") return onComment()
    if (input === "a") return onAssign()
    if (input === "o") return onOpenBrowser()
    // ←→ belong to useTabs; only vertical movement is ours to handle.
    if (key.downArrow || input === "j") setScroll((s) => s + 1)
    if (key.upArrow || input === "k") setScroll((s) => Math.max(0, s - 1))
  })

  const source =
    active === "comments"
      ? commentsAsMarkdown(issue)
      : active === "attachments"
        ? attachmentsAsMarkdown(issue)
        : issue.description || "_No description._"

  const bodyHeight = Math.max(3, height - 12)

  return (
    <Box flexDirection="column">
      <Text bold>
        {issue.key} {issue.summary}
      </Text>

      <Box marginTop={1} flexDirection="column">
        {issue.parent && (
          <KeyValue
            label="parent"
            value={`${issue.parent.key}  ${truncate(issue.parent.summary, 60)}`}
          />
        )}
        <KeyValue label="status" value={<Badge>{issue.status}</Badge>} />
        <KeyValue label="type" value={issue.type} />
        <KeyValue label="assignee" value={issue.assignee} />
        <KeyValue label="reporter" value={issue.reporter} />
        {issue.labels.length > 0 && (
          <KeyValue label="labels" value={issue.labels.join(", ")} />
        )}
      </Box>

      <Box marginTop={1}>
        <Tabs items={tabs} active={active ?? "description"} />
      </Box>

      <Box marginTop={1}>
        <MarkdownViewport
          source={source}
          width={Math.max(20, width - 2)}
          height={bodyHeight}
          scrollOffset={scroll}
        />
      </Box>

      <Box marginTop={1}>
        <FooterHints
          hints={[
            ["←→", "section"],
            ["↑↓", "scroll"],
            ["t", "transition"],
            ["c", "comment"],
            ["a", "assign to me"],
            ["o", "browser"],
            ["esc", "back"],
          ]}
        />
      </Box>
    </Box>
  )
}
