import { renderFrames } from "@kud/cli-testing"
import { describe, expect, it, vi } from "vitest"
import { App } from "./app.js"
import type { DataSource, IssueDetail } from "./data.js"
import { mockData } from "./mock.js"

/** Frame history, never the last frame — a view that unmounts leaves it empty. */
const seen = (r: { output: () => string }, needle: string): boolean =>
  r.output().includes(needle)

/**
 * Two races `write` alone doesn't wait out: `waitFor` can resolve the very
 * tick a screen's text first appears, before Ink's passive effect has wired
 * up that screen's `useInput` listener; and consecutive writes can outrun
 * the state update the first one queued, so the second reads stale state
 * (a keystroke landing before the character before it has been applied).
 * One empty tick before the next `write` clears both.
 */
const settle = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0))

const failing = (message: string): DataSource => ({
  ...mockData(),
  listIssues: async () => {
    throw new Error(message)
  },
})

const empty = (): DataSource => ({ ...mockData(), listIssues: async () => [] })

describe("issue list screen", () => {
  it("shows the issues once they load", async () => {
    const r = renderFrames(<App data={mockData()} initialScreen="issues" />)

    await r.waitFor("SHOP-412")

    expect(seen(r, "Checkout total ignores the discount")).toBe(true)
    r.unmount()
  })

  it("offers the toggle rather than looking broken when nothing is open", async () => {
    const r = renderFrames(<App data={empty()} initialScreen="issues" />)

    await r.waitFor("No open issues")

    expect(seen(r, "press a to include closed ones")).toBe(true)
    r.unmount()
  })

  it("surfaces a load failure with a way out", async () => {
    const r = renderFrames(
      <App data={failing("Jira API 500")} initialScreen="issues" />,
    )

    await r.waitFor("Jira API 500")

    expect(seen(r, "retry")).toBe(true)
    r.unmount()
  })
})

describe("detail screen", () => {
  it("opens straight onto an issue and loads it", async () => {
    // Guards the trap where setting the initial screen skips its data loader,
    // which renders an empty view indistinguishable from a genuinely empty one.
    const r = renderFrames(
      <App data={mockData()} initialScreen="detail" initialKey="SHOP-412" />,
    )

    await r.waitFor("SHOP-412")

    expect(seen(r, "Bram Nilsen")).toBe(true)
    r.unmount()
  })

  it("renders the description as markdown, not raw source", async () => {
    const r = renderFrames(
      <App data={mockData()} initialScreen="detail" initialKey="SHOP-412" />,
    )

    await r.waitFor("What happens")

    expect(seen(r, "## What happens")).toBe(false)
    r.unmount()
  })

  it("names the parent an issue hangs under", async () => {
    const r = renderFrames(
      <App data={mockData()} initialScreen="detail" initialKey="SHOP-412" />,
    )

    await r.waitFor("SHOP-300")

    expect(seen(r, "Basket and checkout correctness")).toBe(true)
    r.unmount()
  })

  it("leaves the line out entirely for an issue with no parent", async () => {
    const r = renderFrames(
      <App data={mockData()} initialScreen="detail" initialKey="SHOP-408" />,
    )

    await r.waitFor("SHOP-408")

    expect(seen(r, "parent")).toBe(false)
    r.unmount()
  })

  it("names the attachment tab with its count", async () => {
    const r = renderFrames(
      <App data={mockData()} initialScreen="detail" initialKey="SHOP-412" />,
    )

    await r.waitFor("Attachments")

    expect(seen(r, "Description")).toBe(true)
    r.unmount()
  })
})

describe("write flows", () => {
  const detailFixture = (): Promise<IssueDetail> =>
    mockData().getIssue("SHOP-412")

  /**
   * `getIssue` answers once with the starting fixture, then with a copy
   * carrying a marker in its summary — so a test can wait for that marker to
   * prove the reload after a write actually ran, rather than assuming a
   * spy's promise has settled by now.
   */
  const withReloadMarker = async (marker: string): Promise<IssueDetail[]> => {
    const detail = await detailFixture()
    return [detail, { ...detail, summary: marker }]
  }

  it("transitions the issue after picking an option from the menu", async () => {
    const [detail, reloaded] = await withReloadMarker(
      "Reloaded after transition",
    )
    const transition = vi.fn().mockResolvedValue(undefined)
    const data: DataSource = {
      ...mockData(),
      transition,
      getIssue: vi
        .fn()
        .mockResolvedValueOnce(detail)
        .mockResolvedValue(reloaded),
    }

    const r = renderFrames(
      <App data={data} initialScreen="detail" initialKey="SHOP-412" />,
    )
    await r.waitFor("SHOP-412")
    await settle()

    r.write("t")
    await r.waitFor("Move SHOP-412 to…")
    await settle()
    r.write("\r")
    await r.waitFor("Reloaded after transition")

    expect(transition).toHaveBeenCalledWith("SHOP-412", "11")
    r.unmount()
  })

  it("posts a typed comment and reloads the issue", async () => {
    const [detail, reloaded] = await withReloadMarker("Reloaded after comment")
    const comment = vi.fn().mockResolvedValue(undefined)
    const data: DataSource = {
      ...mockData(),
      comment,
      getIssue: vi
        .fn()
        .mockResolvedValueOnce(detail)
        .mockResolvedValue(reloaded),
    }

    const r = renderFrames(
      <App data={data} initialScreen="detail" initialKey="SHOP-412" />,
    )
    await r.waitFor("SHOP-412")
    await settle()

    r.write("c")
    await r.waitFor("Comment on SHOP-412")
    await settle()
    r.write("Looks fixed now")
    await settle()
    r.write("\r")
    await r.waitFor("Reloaded after comment")

    expect(comment).toHaveBeenCalledWith("SHOP-412", "Looks fixed now")
    r.unmount()
  })

  it("assigns the issue to the current user on confirmation", async () => {
    const [detail, reloaded] = await withReloadMarker("Reloaded after assign")
    const assignToMe = vi.fn().mockResolvedValue(undefined)
    const data: DataSource = {
      ...mockData(),
      assignToMe,
      getIssue: vi
        .fn()
        .mockResolvedValueOnce(detail)
        .mockResolvedValue(reloaded),
    }

    const r = renderFrames(
      <App data={data} initialScreen="detail" initialKey="SHOP-412" />,
    )
    await r.waitFor("SHOP-412")
    await settle()

    r.write("a")
    await r.waitFor("Assign SHOP-412 to yourself?")
    await settle()
    r.write("y")
    await r.waitFor("Reloaded after assign")

    expect(assignToMe).toHaveBeenCalledWith("SHOP-412")
    r.unmount()
  })

  it("declining the assign prompt never assigns the issue", async () => {
    const assignToMe = vi.fn()
    const data: DataSource = { ...mockData(), assignToMe }

    const r = renderFrames(
      <App data={data} initialScreen="detail" initialKey="SHOP-412" />,
    )
    await r.waitFor("SHOP-412")
    await settle()

    r.write("a")
    await r.waitFor("Assign SHOP-412 to yourself?")
    await settle()
    r.write("n")

    expect(assignToMe).not.toHaveBeenCalled()
    r.unmount()
  })
})
