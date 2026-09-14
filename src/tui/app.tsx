import { execFile } from "node:child_process"
import {
  Alert,
  ConfirmInput,
  Select,
  Spinner,
  TextInput,
  useAppKeys,
  type Hint,
} from "@kud/ink-ui"
import { Box, Text, useApp, useInput, useStdout } from "ink"
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
  IssueDetailView,
  type BoardModel,
  type BoardScope,
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

// Inside the frame, the detail spends: the blank under the title, the subtitle
// line, the blank under it, and the hints row.
const DETAIL_CHROME = 4
const MIN_WIDTH = 60
const MIN_HEIGHT = 12

type Props = { data: DataSource; initialScreen: Screen; initialKey?: string }

export const App = ({ data, initialScreen, initialKey }: Props) => {
  const { exit } = useApp()
  const { stdout } = useStdout()
  const width = stdout?.columns ?? 80
  const height = stdout?.rows ?? 24

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

  const loadList = useCallback(
    async (all: boolean) => {
      setError(null)
      setModel(null)
      setScope({ kind: "mine" })
      setSearchError(null)
      try {
        setModel(await data.board(all))
        setLoadedAt(Date.now())
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
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
      try {
        const result = await data.search(query, mode)
        setModel(result.model)
        setScope({ kind: "search", query, mode: result.mode })
        setLoadedAt(Date.now())
      } catch (e) {
        setSearchError(jiraMessageOf(e))
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
    <Frame width={width} height={height} facts={facts} hints={hints} page={page}>
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
            label: `${t.name} → ${t.to}`,
            value: t.id,
          }))}
          onSubmit={(id) => {
            setOverlay({ kind: "none" })
            void (async () => {
              setBusy("Transitioning…")
              try {
                await data.transition(issue!.key, id)
                await loadIssue(issue!.key)
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e))
              } finally {
                setBusy(null)
              }
            })()
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
          <Frame
            width={width}
            height={height}
            facts={title}
            // The view names its back key; the frame's tail draws it.
            hints={hints.filter(([k]) => k !== "⌫")}
            page="nested"
          >
            <Box paddingLeft={2} marginTop={1}>
              <Text dimColor>{subtitle}</Text>
            </Box>
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

  if (!model) return framed("loading…", <Spinner label="Loading issues…" />)

  return (
    <IssueBoard
      model={model}
      frame={({ facts, hints, body }) => (
        <Frame width={width} height={height} facts={facts} hints={hints}>
          {body}
        </Frame>
      )}
      onInputFocus={setInputFocused}
      viewer={viewer}
      loadedAt={loadedAt}
      scope={scope}
      searchError={searchError}
      width={width}
      height={height - FRAME_CHROME - 1}
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
