import { FooterHints, SelectableRow, useListCursor } from "@kud/ink-ui"
import { Box, Text, useInput } from "ink"
import type { IssueRow } from "./data.js"

const pad = (s: string, width: number): string =>
  s.length > width ? `${s.slice(0, width - 1)}…` : s.padEnd(width)

/**
 * Rows are windowed by hand rather than handed to `Table`, which renders every
 * row and has no notion of a cursor. A backlog of two hundred issues would
 * otherwise scroll the selected row off the top of the terminal.
 */
const windowFor = (cursor: number, total: number, size: number) => {
  const start = Math.max(
    0,
    Math.min(cursor - Math.floor(size / 2), total - size),
  )
  return { start: Math.max(0, start), end: Math.max(0, start) + size }
}

type Props = {
  rows: IssueRow[]
  showingAll: boolean
  onOpen: (key: string) => void
  onToggleAll: () => void
  onRefresh: () => void
  height: number
}

export const IssueList = ({
  rows,
  showingAll,
  onOpen,
  onToggleAll,
  onRefresh,
  height,
}: Props) => {
  const { cursor } = useListCursor(rows.length, { vimKeys: true })

  useInput((input, key) => {
    if (key.return && rows[cursor]) onOpen(rows[cursor].key)
    if (input === "a") onToggleAll()
    if (input === "r") onRefresh()
  })

  const hints: [string, string][] = [
    ["↑↓", "move"],
    ["enter", "open"],
    ["a", showingAll ? "open only" : "show all"],
    ["r", "refresh"],
    ["q", "quit"],
  ]

  if (rows.length === 0) {
    return (
      <Box flexDirection="column" gap={1}>
        <Text dimColor>
          {showingAll
            ? "Nothing is assigned to you."
            : "No open issues assigned to you — press a to include closed ones."}
        </Text>
        <FooterHints hints={hints} />
      </Box>
    )
  }

  const size = Math.max(3, height - 5)
  const { start, end } = windowFor(cursor, rows.length, size)
  const visible = rows.slice(start, end)

  return (
    <Box flexDirection="column">
      <Box paddingLeft={4}>
        <Text dimColor>
          {pad("KEY", 11)}
          {pad("STATUS", 17)}
          {pad("SUMMARY", 60)}
          ASSIGNEE
        </Text>
      </Box>

      {visible.map((row, i) => (
        <SelectableRow key={row.key} active={start + i === cursor}>
          <Text>
            {pad(row.key, 11)}
            {pad(row.status, 17)}
            {pad(row.summary, 60)}
            <Text dimColor>{row.assignee}</Text>
          </Text>
        </SelectableRow>
      ))}

      <Box marginTop={1} flexDirection="column">
        <Text dimColor>
          {cursor + 1}/{rows.length}
          {showingAll ? " · all" : " · open only"}
        </Text>
        <FooterHints hints={hints} />
      </Box>
    </Box>
  )
}
