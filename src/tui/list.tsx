import {
  colors,
  FooterHints,
  Pill,
  pillWidth,
  SelectableRow,
  Tabs,
  TextInput,
  useListCursor,
  useTabs,
  type Hint,
} from "@kud/ink-ui"
import { Box, Text, useInput } from "ink"
import { useEffect, useMemo, useState } from "react"
import { looksLikeJql } from "../jql.js"
import {
  blockIndexOfIssue,
  blocksFor,
  countsFor,
  pillVariantFor,
  priorityGlyph,
  relativeAge,
  TABS,
  tabOf,
  type Block,
  type TabId,
} from "./board.js"
import type { IssueRow, SearchMode } from "./data.js"
import { Frame } from "./frame.js"

/** What the list is showing, named in the title bar. */
export type Scope =
  { kind: "mine" } | { kind: "search"; query: string; mode: "jql" | "text" }

type Props = {
  rows: IssueRow[]
  viewer: string
  loadedAt: number
  scope: Scope
  showingAll: boolean
  searchError: string | null
  width: number
  height: number
  onOpen: (key: string) => void
  onToggleAll: () => void
  onRefresh: () => void
  onSearch: (query: string, mode: SearchMode) => void
  onClearSearch: () => void
}

// Lines the frame spends around the rows: border ×2, title, the blank under
// it, tabs ×2, the blank above and below the rows, the counter and the hints.
const CHROME = 10

const LEGEND: [string, string][] = [
  ["▲", "high priority"],
  ["▼", "low priority"],
  ["── epic ──", "the parent the rows beneath hang under"],
  ["story · bug · task", "issue type"],
  ["2d", "time since last update"],
  [
    "To do · In progress · Done",
    "status category — not any one board's column",
  ],
]

const windowFor = (focus: number, total: number, size: number) => {
  const start = Math.max(
    0,
    Math.min(focus - Math.floor(size / 2), total - size),
  )
  return { start, end: start + size }
}

type SearchBox = { open: boolean; draft: string; mode: SearchMode }

/**
 * Rows are windowed by hand rather than handed to `Table`, which renders every
 * row and has no notion of a cursor. A backlog of two hundred issues would
 * otherwise scroll the selected row off the top of the terminal.
 */
export const IssueList = ({
  rows,
  viewer,
  loadedAt,
  scope,
  showingAll,
  searchError,
  width,
  height,
  onOpen,
  onToggleAll,
  onRefresh,
  onSearch,
  onClearSearch,
}: Props) => {
  const [legend, setLegend] = useState(false)
  const [search, setSearch] = useState<SearchBox>({
    open: false,
    draft: "",
    mode: "auto",
  })
  const [now, setNow] = useState(Date.now)

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(tick)
  }, [])

  // Plain words narrow the loaded rows as they are typed; the server search
  // on enter only ever widens that (it also reads comments), so nothing
  // jumps away under the cursor.
  const narrowed = useMemo(() => {
    if (!search.open || modeOf(search) === "jql" || !search.draft.trim())
      return rows
    const words = search.draft.trim().toLowerCase()
    return rows.filter((r) =>
      `${r.key} ${r.summary}`.toLowerCase().includes(words),
    )
  }, [rows, search])

  const counts = countsFor(narrowed)
  const tabItems = TABS.map((t) => ({ ...t, count: counts[t.value] }))
  const listFocused = !search.open && !legend
  const { active, setActive } = useTabs<TabId>(tabItems, {
    initial: "doing",
    isActive: listFocused,
  })
  const tab = active ?? "doing"

  const blocks = useMemo(
    () => blocksFor(narrowed.filter((r) => tabOf(r.category) === tab)),
    [narrowed, tab],
  )
  const issues = blocks.filter(
    (b): b is Extract<Block, { kind: "issue" }> => b.kind === "issue",
  )
  const { cursor, setCursor } = useListCursor(issues.length, {
    vimKeys: true,
    isActive: listFocused,
  })
  useEffect(() => setCursor(0), [tab, setCursor])

  useInput((input, key) => {
    if (search.open) {
      if (key.escape) setSearch((s) => ({ ...s, open: false }))
      if (key.tab)
        setSearch((s) => ({
          ...s,
          mode: modeOf(s) === "jql" ? "text" : "jql",
        }))
      return
    }
    if (legend) {
      if (input === "?" || key.escape) setLegend(false)
      return
    }
    if (key.return && issues[cursor]) onOpen(issues[cursor].row.key)
    // ←→ have no other job on this screen, so they move the tab as well as ⇥
    // — the ring is still the hook's; this only asks it to step.
    if (key.leftArrow || key.rightArrow) {
      const at = TABS.findIndex((t) => t.value === tab)
      const next = (at + (key.leftArrow ? -1 : 1) + TABS.length) % TABS.length
      setActive(TABS[next]!.value)
    }
    if (input === "/")
      setSearch((s) => ({
        ...s,
        open: true,
        draft: scope.kind === "search" ? scope.query : s.draft,
      }))
    if (input === "?") setLegend(true)
    if (input === "a") onToggleAll()
    if (input === "r") onRefresh()
    if (key.escape && scope.kind === "search") onClearSearch()
  })

  const searching = search.open || scope.kind === "search"
  const chrome = CHROME + (searching ? 1 : 0) + (searchError ? 1 : 0)
  const size = Math.max(3, height - chrome)
  const focus = blockIndexOfIssue(blocks, cursor)
  const { start, end } = windowFor(focus, blocks.length, size)
  const keyWidth = Math.max(8, ...narrowed.map((r) => r.key.length))
  const typeWidth = Math.max(
    0,
    ...narrowed.map((r) => pillWidth(r.type.toLowerCase())),
  )

  const scopeLabel =
    scope.kind === "mine"
      ? `@${viewer}`
      : scope.mode === "jql"
        ? "jql"
        : `“${scope.query}”`
  const countLabel =
    search.open && narrowed.length !== rows.length
      ? `${narrowed.length} of ${rows.length}`
      : `${rows.length} ${rows.length === 1 ? "item" : "items"}`

  const hints: Hint[] = search.open
    ? [
        ["enter", "run"],
        ["⇥", modeOf(search) === "jql" ? "as plain words" : "as jql"],
        ["esc", "cancel"],
      ]
    : legend
      ? [["?", "close"]]
      : [
          ["↑↓", "move"],
          ["←→", "tab"],
          ["enter", "open"],
          ["/", scope.kind === "search" ? "edit" : "search"],
          ...(scope.kind === "search"
            ? [["esc", "clear"] as Hint]
            : [["a", showingAll ? "recent only" : "everything"] as Hint]),
          ["r", "refresh"],
          ["?", "legend"],
          ["q", "quit"],
        ]

  return (
    <Frame
      width={width}
      height={height}
      facts={`${countLabel} · ${scopeLabel} · updated ${relativeAge(new Date(loadedAt).toISOString(), now)} ago`}
    >

      {search.open ? (
        <Box paddingRight={1}>
          <Box flexShrink={0}>
            <Text color={colors.accent}>{"  / "}</Text>
          </Box>
          <Box flexGrow={1}>
            <TextInput
              defaultValue={search.draft}
              placeholder="words, or JQL"
              onChange={(draft) => setSearch((s) => ({ ...s, draft }))}
              onSubmit={(query) => {
                setSearch((s) => ({ ...s, open: false, draft: query }))
                if (query.trim()) onSearch(query, search.mode)
                else onClearSearch()
              }}
            />
          </Box>
          <Box flexShrink={0}>
            <Text dimColor>{modeOf(search) === "jql" ? "JQL" : "plain"}</Text>
          </Box>
        </Box>
      ) : scope.kind === "search" ? (
        <Box paddingRight={1}>
          <Box flexShrink={0}>
            <Text color={colors.accent}>{"  / "}</Text>
          </Box>
          <Box flexGrow={1}>
            <Text wrap="truncate-end">{scope.query}</Text>
          </Box>
          <Box flexShrink={0}>
            <Text dimColor>{scope.mode === "jql" ? "JQL" : "plain"}</Text>
          </Box>
        </Box>
      ) : null}

      {searchError ? (
        <Text color={colors.error}>
          {"  ✗ "}
          {searchError}
        </Text>
      ) : null}

      <Box paddingLeft={2} marginTop={1}>
        <Tabs active={tab} items={tabItems} />
      </Box>

      <Box
        flexDirection="column"
        marginTop={1}
        height={size}
        paddingRight={1}
      >
        {legend ? (
          LEGEND.map(([glyph, meaning]) => (
            <Box key={glyph} paddingLeft={4}>
              <Box width={28} flexShrink={0}>
                <Text color={colors.accent}>{glyph}</Text>
              </Box>
              <Text dimColor>{meaning}</Text>
            </Box>
          ))
        ) : issues.length === 0 ? (
          <Box paddingLeft={4}>
            <Text dimColor>{emptyHint(tab, counts, showingAll, scope)}</Text>
          </Box>
        ) : (
          blocks.slice(start, end).map((block, i) =>
            block.kind === "gap" ? (
              <Text key={`gap:${start + i}`}> </Text>
            ) : block.kind === "fence" ? (
              <Box key={`f:${block.key ?? "none"}`} paddingLeft={4}>
                <Text dimColor>
                  {rule(
                    block.key
                      ? `${block.summary} · ${block.key}`
                      : block.summary,
                    width - 7,
                  )}
                </Text>
              </Box>
            ) : (
              <SelectableRow key={block.row.key} active={start + i === focus}>
                {block.depth === 1 ? (
                  <Box flexShrink={0} width={3}>
                    <Text dimColor>└─ </Text>
                  </Box>
                ) : null}
                <Box flexShrink={0} width={2}>
                  <Text
                    color={
                      priorityGlyph(block.row.priority) === "▲"
                        ? colors.warning
                        : colors.muted
                    }
                  >
                    {priorityGlyph(block.row.priority)}
                  </Text>
                </Box>
                <Box flexShrink={0} width={keyWidth + 2}>
                  <Text color={colors.accent} bold={start + i === focus}>
                    {block.row.key}
                  </Text>
                </Box>
                <Box flexShrink={0} width={typeWidth + 2}>
                  <Pill tone="soft" variant={pillVariantFor(block.row.type)}>
                    {block.row.type.toLowerCase()}
                  </Pill>
                </Box>
                <Box flexGrow={1}>
                  <Text wrap="truncate-end" bold={start + i === focus}>
                    {block.row.summary}
                  </Text>
                </Box>
                <Box flexShrink={0} width={5} justifyContent="flex-end">
                  <Text dimColor>{relativeAge(block.row.updated, now)}</Text>
                </Box>
              </SelectableRow>
            ),
          )
        )}
      </Box>

      <Box marginTop={1} paddingLeft={2} flexDirection="column">
        <Text dimColor>
          {issues.length ? `${cursor + 1}/${issues.length}` : " "}
        </Text>
        <FooterHints hints={hints} />
      </Box>
    </Frame>
  )
}

const modeOf = (s: SearchBox): "jql" | "text" =>
  s.mode === "auto" ? (looksLikeJql(s.draft) ? "jql" : "text") : s.mode

const rule = (label: string, width: number): string => {
  const head = `── ${label} `
  return head + "─".repeat(Math.max(0, width - [...head].length))
}

const emptyHint = (
  tab: TabId,
  counts: Record<TabId, number>,
  showingAll: boolean,
  scope: Scope,
): string => {
  const total = counts.todo + counts.doing + counts.done
  if (total === 0) {
    if (scope.kind === "search")
      return "Nothing matches — / to edit, esc to clear."
    return showingAll
      ? "Nothing is assigned to you."
      : "No open issues assigned to you — press a to include everything."
  }
  const elsewhere = TABS.filter((t) => t.value !== tab && counts[t.value] > 0)
    .map((t) => `${t.label} (${counts[t.value]})`)
    .join(", ")
  const closed =
    tab === "done" && !showingAll
      ? " Only the last 14 days of closed work is loaded — press a for everything."
      : ""
  return `Nothing here — ⇥ to ${elsewhere}.${closed}`
}
