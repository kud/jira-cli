import { render } from "ink"
import { App, type Screen } from "./app.js"
import { context } from "../commands/context.js"
import { liveData } from "./data.js"
import { mockData } from "./mock.js"

export const SCREENS: Screen[] = ["issues", "detail"]

export type TuiOptions = {
  screen: Screen
  mock: boolean
  issueKey?: string
  /** A board whose columns become the tabs; beats `defaultBoard` in the config. */
  board?: number
}

export const runTui = async ({
  screen,
  mock,
  issueKey,
  board,
}: TuiOptions): Promise<void> => {
  const data = mock ? mockData() : liveData({ ...context(), board })
  const key = issueKey ?? (mock ? "SHOP-412" : undefined)

  const { waitUntilExit } = render(
    <App data={data} initialScreen={screen} initialKey={key} />,
  )
  await waitUntilExit()
}
