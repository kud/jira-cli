import { Page, type Hint, type PageStatus } from "@kud/ink-ui"
import type { ReactNode } from "react"

type Props = {
  width: number
  height: number
  /** Free text after the name, for a state with nothing structured to say — `loading…`, `error`. */
  facts?: string
  /** Structured segments, the way the board hands them over. */
  count?: number
  user?: string
  scope?: string
  status?: PageStatus
  /** Pinned at the foot when given; a screen that draws its own passes none. */
  hints?: Hint[]
  /** Root or nested — decides whether the tail carries `⌫ back`. */
  page?: "root" | "nested"
  /** False when the body draws the blank under the title itself — the board's search row lives there. */
  gap?: boolean
  children: ReactNode
}

/**
 * The one frame every screen sits in — loading, error, prompt, list, detail —
 * so the border and the title row never come and go between states. Owned by
 * the app rather than by a screen: a spinner drawn before the list mounted used
 * to float outside the border, and a screen cannot frame what precedes it.
 *
 * It is ink-ui's `Page` with this app's mark and name filled in, so the title
 * row is the same one every `@kud` TUI draws.
 */
export const Frame = ({
  width,
  height,
  facts,
  count,
  user,
  scope,
  status,
  hints,
  page = "root",
  gap = true,
  children,
}: Props) => (
  <Page
    icon="🎫"
    title="Jira"
    facts={facts}
    count={count}
    user={user}
    scope={scope}
    status={status}
    hints={hints}
    page={page}
    gap={gap}
    width={width}
    height={height}
  >
    {children}
  </Page>
)

/** Lines the frame itself spends: two borders, the title row, the blank under it. */
export const FRAME_CHROME = 4
