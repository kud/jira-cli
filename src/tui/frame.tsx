import { FooterHints, Panel, type Hint } from "@kud/ink-ui"
import { Box, Text } from "ink"
import type { ReactNode } from "react"

type Props = {
  width: number
  height: number
  /** What sits after the app name on the title row — counts, scope, freshness. */
  facts: string
  /** Pinned at the foot when given; a screen that draws its own passes none. */
  hints?: Hint[]
  children: ReactNode
}

/**
 * The one frame every screen sits in — loading, error, prompt, list, detail —
 * so the border and the title row never come and go between states. Owned by
 * the app rather than by a screen: a spinner drawn before the list mounted used
 * to float outside the border, and a screen cannot frame what precedes it.
 */
export const Frame = ({ width, height, facts, hints, children }: Props) => (
  <Panel width={width} height={height}>
    <Box paddingLeft={1}>
      <Text bold>🎫 Jira</Text>
      <Text dimColor>
        {"   "}
        {facts}
      </Text>
    </Box>
    <Box flexDirection="column" flexGrow={1}>
      {children}
    </Box>
    {hints ? (
      <Box paddingLeft={2}>
        <FooterHints hints={hints} />
      </Box>
    ) : null}
  </Panel>
)

/** Lines the frame itself spends: two borders and the title row. */
export const FRAME_CHROME = 3
