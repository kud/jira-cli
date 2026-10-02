import { execFile } from "node:child_process"
import {
  Alert,
  colors,
  ConfirmInput,
  Select,
  Spinner,
  TextInput,
  useAppKeys,
  type Hint,
} from "@kud/ink-ui"
import { Box, Text, useApp, useInput, useWindowSize } from "ink"
import { useCallback, useEffect, useState, type ReactNode } from "react"
import { errorMessagesOf, isJiraApiError } from "@kud/jira"
import type {
  DataSource,
  IssueDetail,
  SearchMode,
  Transition,
} from "./data.js"
import {
  IssueBoard,
  IssueBoardSkeleton,
  IssueDetailView,
  pendingRow,
  settleRow,
  transitionRow,
  type BoardModel,
  type BoardRow,
  type BoardFrame,
  type BoardScope,
  type BoardTabs,
} from "@kud/jira-ink"
import { Frame, FRAME_CHROME } from "./frame.js"

export type Screen = "issues" | "detail"

/**
 * One string union drives which screen is visible, per the house phase-machine
 * pattern. Overlays (transition, comment, confirm) are separate because they
 * sit *on top of* a screen rather than replacing it — collapsing them into the
 * same union would lose which screen to return to.
 */
type Overlay =
  | { kind: "none" }
  | { kind: "transition"; options: Transition[] }
  | { kind: "comment" }
  | { kind: "assign" }

// Inside the frame's chrome, the detail spends: the subtitle line, the blank
// under it, and the hints row.
const DETAIL_CHROME = 3
const MIN_WIDTH = 60
const MIN_HEIGHT = 12

type Props = { data: DataSource; initialScreen: Screen; initialKey?: string }

export const App = ({ data, initialScreen, initialKey }: Props) => {
  const { exit } = useApp()
  const { columns: width, rows: height } = useWindowSize()

  const [screen, setScreen] = useState<Screen>(initialScreen)
  const [model, setModel] = useState<BoardModel | null>(null)
  const [viewer, setViewer] = useState("you")
  const [loadedAt, setLoadedAt] = useState(Date.now)
  const [scope, setScope] = useState<BoardScope>({ kind: "mine" })
  const [searchError, setSearchError] = useState<string | null>(null)
  const [inputFocused, setInputFocused] = useState(false)
  const [issue, setIssue] = useState<IssueDetail | null>(null)
  const [overlay, setOverlay] = useState<Overlay>({ kind: "none" })
  const [showingAll, setShowingAll] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [parents, setParents] = useState<BoardRow[]>([])
  /**
   * The board's tabs, known before its rows, so the first load can draw
   * `IssueBoardSkeleton` in the board's own frame rather than a spinner.
   */
  const [tabs, setTabs] = useState<BoardTabs | null>(null)
  /**
   * A refetch over a board already on screen. The rows stay — once anything
   * is known the screen never goes back to a skeleton — and the title says
   * busy instead.
   */
  const [refreshing, setRefreshing] = useState(false)
  /**
   * Transient news that must not replace the screen: a rejected move, mostly.
   * `error` blanks the view and offers a retry, which is right for a load
   * that failed and wrong for a move that did — the board is still true.
   */
  const [flash, setFlash] = useState<string | null>(null)
  /** The key whose move is in flight; the transition key is locked while set. */
  const [moving, setMoving] = useState<string | null>(null)

  const loadList = useCallback(
    async (all: boolean) => {
      setError(null)
      setSearchError(null)
      setRefreshing(true)
      try {
        const next = await data.board(all)
        setModel(next)
        setScope({ kind: "mine" })
        setLoadedAt(Date.now())
        // Second round trip, deliberately not awaited into the paint: the
        // fences say nothing until it lands rather than guessing an owner.
        void data
          .parents(next.rows)
          .then(setParents)
          .catch(() => {})
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setRefreshing(false)
      }
    },
    [data],
  )

  const loadIssue = useCallback(
    async (key: string) => {
      setError(null)
      setIssue(null)
      setScreen("detail")
      try {
        setIssue(await data.getIssue(key))
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    },
    [data],
  )

  /**
   * A bad query is the user's to fix, so it never replaces the screen the
   * way a failed load does: the rows stay, the message sits under the box,
   * and the query is kept for editing. Jira's own words come from the 400
   * body — `e.message` is the URL-prefixed, truncated envelope.
   */
  const runSearch = useCallback(
    async (query: string, mode: SearchMode) => {
      setSearchError(null)
      setRefreshing(true)
      try {
        const result = await data.search(query, mode)
        setModel(result.model)
        void data
          .parents(result.model.rows)
          .then(setParents)
          .catch(() => {})
        setScope({ kind: "search", query, mode: result.mode })
        setLoadedAt(Date.now())
      } catch (e) {
        setSearchError(jiraMessageOf(e))
      } finally {
        setRefreshing(false)
      }
    },
    [data],
  )

  /**
   * The hybrid move: the row keeps its place under a `⋯ → QA` marker while
   * the request is out, and moves only once Jira has said it moved. Nothing
   * is optimistic, and nothing is re-fetched to make it visible — the next
   * refresh is reconciliation.
   *
   * The detail stays mounted throughout. A full-screen spinner here used to
   * take the issue off the screen for the length of a round trip, so the one
   * thing you were reading vanished to tell you a key had been pressed.
   */
  const move = useCallback(
    async (key: string, t: Transition) => {
      setFlash(null)
      setMoving(key)
      setModel((m) => (m ? pendingRow(m, key, t.to) : m))
      try {
        await data.transition(key, t.id)
        setModel((m) => (m ? transitionRow(m, key, t.to) : m))
        setIssue((i) => (i && i.key === key ? { ...i, status: t.to.name } : i))
      } catch (e) {
        setModel((m) => (m ? settleRow(m, key) : m))
        setFlash(jiraMessageOf(e))
      } finally {
        setMoving(null)
      }
    },
    [data],
  )

  useEffect(() => {
    void data
      .me()
      .then((me) => setViewer(me.displayName))
      .catch(() => {})
  }, [data])

  // The tabs alone, ahead of the rows, so the first paint is the board's
  // skeleton. A failure here costs only that: the spinner stands in.
  useEffect(() => {
    let cancelled = false
    data
      .tabs()
      .then((t) => {
        if (!cancelled) setTabs(t)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [data])

  // Opening straight onto a screen must also run that screen's loader —
  // setting the screen alone lands on a view that never fetched, which looks
  // identical to a genuinely empty one.
  useEffect(() => {
    if (initialScreen === "detail" && initialKey) void loadIssue(initialKey)
    else void loadList(false)
  }, [initialScreen, initialKey, loadIssue, loadList])

  // The app's three keys, once. The peel: an overlay on top of a screen, then
  // the detail over the board, then nothing — the board pops its own search
  // box and legend. Off while any text field has focus.
  useAppKeys({
    isActive: overlay.kind !== "comment" && !inputFocused,
    onQuit: exit,
    onBack: () => {
      if (overlay.kind !== "none") {
        setOverlay({ kind: "none" })
        return true
      }
      if (screen === "detail") {
        setScreen("issues")
        return true
      }
      return false
    },
  })
  useInput((input) => {
    if (overlay.kind !== "none") return
    if (error && input === "r") {
      if (screen === "issues") void loadList(showingAll)
      else if (issue) void loadIssue(issue.key)
    }
  })

  if (width < MIN_WIDTH || height < MIN_HEIGHT) {
    return (
      <Text>
        Terminal too small — needs at least {MIN_WIDTH}×{MIN_HEIGHT}, this is{" "}
        {width}×{height}.
      </Text>
    )
  }

  const framed = (
    facts: string,
    body: ReactNode,
    hints?: Hint[],
    page: "root" | "nested" = screen === "detail" ? "nested" : "root",
  ) => (
    <Frame facts={facts} hints={hints} page={page}>
      <Box flexDirection="column" marginTop={1} paddingLeft={2} flexGrow={1}>
        {body}
      </Box>
    </Frame>
  )

  if (error)
    return framed("error", <Alert variant="error">{error}</Alert>, [
      ["r", "retry"],
    ])

  if (busy) return framed("working…", <Spinner label={busy} />)

  if (overlay.kind === "transition") {
    return framed(
      issue?.key ?? "",
      <Box flexDirection="column" gap={1}>
        <Text bold>Move {issue?.key} to…</Text>
        <Select
          options={overlay.options.map((t) => ({
            label: `${t.name} → ${t.to.name}`,
            value: t.id,
          }))}
          onSubmit={(id) => {
            const chosen = overlay.options.find((t) => t.id === id)!
            setOverlay({ kind: "none" })
            void move(issue!.key, chosen)
          }}
        />
        <Text dimColor>esc cancel</Text>
      </Box>,
    )
  }

  if (overlay.kind === "comment") {
    return framed(
      issue?.key ?? "",
      <Box flexDirection="column" gap={1}>
        <Text bold>Comment on {issue?.key}</Text>
        <TextInput
          placeholder="Markdown is supported…"
          onCancel={() => setOverlay({ kind: "none" })}
          onSubmit={(body) => {
            setOverlay({ kind: "none" })
            if (!body.trim()) return
            void (async () => {
              setBusy("Posting…")
              try {
                await data.comment(issue!.key, body)
                await loadIssue(issue!.key)
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e))
              } finally {
                setBusy(null)
              }
            })()
          }}
        />
      </Box>,
    )
  }

  if (overlay.kind === "assign") {
    return framed(
      issue?.key ?? "",
      <Box flexDirection="column" gap={1}>
        <Text>Assign {issue?.key} to yourself?</Text>
        <ConfirmInput
          onCancel={() => setOverlay({ kind: "none" })}
          onConfirm={() => {
            setOverlay({ kind: "none" })
            void (async () => {
              setBusy("Assigning…")
              try {
                await data.assignToMe(issue!.key)
                await loadIssue(issue!.key)
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e))
              } finally {
                setBusy(null)
              }
            })()
          }}
        />
      </Box>,
    )
  }

  if (screen === "detail") {
    if (!issue) return framed("loading…", <Spinner label="Loading issue…" />)
    return (
      <IssueDetailView
        issue={issue}
        width={width}
        height={height - FRAME_CHROME - DETAIL_CHROME}
        frame={({ title, subtitle, hints, body }) => (
          <Frame scope={title} hints={hints.filter(([k]) => k !== "⌫")} page="nested">
            <Box paddingLeft={2}>
              <Text dimColor>{subtitle}</Text>
              {moving === issue.key ? (
                <Text color={colors.accent}>{"  ⋯ moving"}</Text>
              ) : null}
            </Box>
            {flash ? (
              <Box paddingLeft={2}>
                <Text color={colors.error}>{`✗ ${flash}`}</Text>
              </Box>
            ) : null}
            <Box
              flexDirection="column"
              marginTop={1}
              paddingLeft={2}
              flexGrow={1}
            >
              {body}
            </Box>
          </Frame>
        )}
        onBack={() => setScreen("issues")}
        onOpenBrowser={() => execFile(opener(), [issue.url])}
        onAssign={() => setOverlay({ kind: "assign" })}
        onComment={() => setOverlay({ kind: "comment" })}
        onTransition={() => {
          if (moving) return
          void (async () => {
            setBusy("Loading transitions…")
            try {
              const options = await data.getTransitions(issue.key)
              setOverlay({ kind: "transition", options })
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e))
            } finally {
              setBusy(null)
            }
          })()
        }}
      />
    )
  }

  // No gap band here — the board draws that row itself — so one less line of
  // chrome than FRAME_CHROME says, plus the hints row. The skeleton takes the
  // same height so the rows land on the placeholders' lines.
  const boardHeight = height - (FRAME_CHROME - 1) - 1

  // One frame for the skeleton and the board, so the border never moves
  // between the first load and the rows. The skeleton states its own busy
  // status; `refreshing` speaks only over rows already on screen.
  const boardFrame =
    (help?: boolean): BoardFrame =>
    ({ title, hints, body }) => (
      <Frame
        count={title.count ?? undefined}
        user={title.user}
        scope={title.scope}
        status={
          refreshing && model
            ? { text: "↻ refreshing…", tone: "busy" }
            : title.status
        }
        hints={hints}
        gap={false}
        help={help}
      >
        {body}
      </Frame>
    )

  if (!model) {
    if (!tabs) return framed("loading…", <Spinner label="Loading issues…" />)
    // No legend yet, so no `? help` in the tail: the skeleton binds no keys.
    return (
      <IssueBoardSkeleton
        tabs={tabs}
        width={width}
        height={boardHeight}
        frame={boardFrame(false)}
      />
    )
  }

  return (
    <IssueBoard
      model={model}
      parents={parents}
      frame={boardFrame()}
      onInputFocus={setInputFocused}
      viewer={viewer}
      loadedAt={loadedAt}
      scope={scope}
      searchError={searchError}
      width={width}
      height={boardHeight}
      showingAll={showingAll}
      onOpen={(key) => void loadIssue(key)}
      onRefresh={() =>
        void (scope.kind === "search"
          ? runSearch(scope.query, scope.mode)
          : loadList(showingAll))
      }
      onSearch={(query, mode) => void runSearch(query, mode)}
      onClearSearch={() => void loadList(showingAll)}
      onToggleAll={() => {
        const next = !showingAll
        setShowingAll(next)
        void loadList(next)
      }}
    />
  )
}

const jiraMessageOf = (e: unknown): string =>
  isJiraApiError(e) && (e.status === 401 || e.status === 403)
    ? `Jira refused the request (${e.status}) — check your token.`
    : errorMessagesOf(e).join(" ")

const opener = (): string =>
  process.platform === "darwin"
    ? "open"
    : process.platform === "win32"
      ? "start"
      : "xdg-open"
