import { render } from "ink"
import { App, type Screen } from "./app.js"
import { liveData } from "./data.js"
import { mockData } from "./mock.js"

export const SCREENS: Screen[] = ["issues", "detail"]

export type TuiOptions = {
  screen: Screen
  mock: boolean
  issueKey?: string
}

export const runTui = async ({
  screen,
  mock,
  issueKey,
}: TuiOptions): Promise<void> => {
  const data = mock ? mockData() : liveData()
  const key = issueKey ?? (mock ? "SHOP-412" : undefined)

  const { waitUntilExit } = render(
    <App data={data} initialScreen={screen} initialKey={key} />,
  )
  await waitUntilExit()
}
