import { renderFrames } from "@kud/cli-testing"
import { describe, expect, it } from "vitest"
import { App } from "./app.js"
import type { DataSource } from "./data.js"
import { mockData } from "./mock.js"

const never = (): DataSource => ({
  ...mockData(),
  board: () => new Promise<never>(() => {}),
})

describe("the frame is the page, not the list", () => {
  it("draws the loader inside the border with the title row", async () => {
    const r = renderFrames(<App data={never()} initialScreen="issues" />)

    await r.waitFor("Loading issues")

    const frame = r.lastFrame()
    expect(frame).toContain("🎫 Jira   loading…")
    expect(frame.split("\n")[0]).toMatch(/^╭─+╮$/)
    r.unmount()
  })

  it("keeps the app's title row on the detail page", async () => {
    const r = renderFrames(
      <App data={mockData()} initialScreen="detail" initialKey="SHOP-412" />,
    )

    await r.waitFor("Bram Nilsen")

    const frame = r.lastFrame()
    expect(frame).toContain("🎫 Jira  SHOP-412 · Bug  ╌╌╌")
    expect(frame.split("\n").at(-1)).toMatch(/^╰─+╯$/)
    r.unmount()
  })
})
