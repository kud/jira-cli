import { renderFrames } from "@kud/cli-testing"
import { jiraApiError } from "@kud/jira"
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

    expect(seen(r, "press a to include everything")).toBe(true)
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

describe("board", () => {
  const last = (r: { lastFrame: () => string }): string => r.lastFrame()

  it("tabs by status category, with counts that sum to the rows", async () => {
    const r = renderFrames(<App data={mockData()} initialScreen="issues" />)

    await r.waitFor("SHOP-412")

    const frame = last(r)
    expect(frame).toContain("To do (2)")
    expect(frame).toContain("In progress (4)")
    expect(frame).toContain("Done (1)")
    // The status NAME never reaches the screen — "Blocked" is filed by its
    // category, which is the whole point of a board that knows no workflow.
    expect(frame).not.toContain("Blocked")
    r.unmount()
  })

  it("hangs rows under their epic and orphans under a plain rule", async () => {
    const r = renderFrames(<App data={mockData()} initialScreen="issues" />)

    await r.waitFor("SHOP-412")

    const frame = last(r)
    expect(frame).toContain("── Basket and checkout correctness · SHOP-300")
    expect(frame).toContain("── No epic")
    expect(frame.indexOf("SHOP-300")).toBeLessThan(frame.indexOf("SHOP-412"))
    r.unmount()
  })

  it("heads a group with the epic's own row when the epic is in the tab", async () => {
    const r = renderFrames(<App data={mockData()} initialScreen="issues" />)
    await r.waitFor("SHOP-412")
    await settle()

    // ← from In progress wraps to To do — arrows step the tab exactly as ⇥ does.
    r.write("\u001b[D")
    await r.waitFor("SHOP-397")

    const lines = last(r).split("\n")
    const epic = lines.findIndex((l) => l.includes("SHOP-300"))
    const child = lines.findIndex((l) => l.includes("SHOP-397"))
    expect(lines[epic]).toContain("epic")
    expect(lines[epic]).not.toContain("──")
    expect(lines[child]).toContain("└─")
    expect(child).toBe(epic + 1)
    expect(last(r)).not.toContain("No epic")
    r.unmount()
  })

  it("degrades to a flat list when no row has a parent", async () => {
    const flat = (): DataSource => ({
      ...mockData(),
      listIssues: async () =>
        (await mockData().listIssues(false))
          .filter((r) => r.type !== "Epic")
          .map(({ parent: _, ...row }) => row),
    })
    const r = renderFrames(<App data={flat()} initialScreen="issues" />)

    await r.waitFor("SHOP-412")

    expect(last(r)).not.toMatch(/── [A-Za-z]/)
    expect(last(r)).not.toContain("No epic")
    r.unmount()
  })

  it("draws a type pill, a priority glyph and an age on each row", async () => {
    const r = renderFrames(<App data={mockData()} initialScreen="issues" />)

    await r.waitFor("SHOP-412")

    const row = last(r).split("\n").find((l) => l.includes("SHOP-412")) ?? ""
    expect(row).toContain("▲")
    expect(row).toContain("bug")
    expect(row).toMatch(/\d+[mhdw] │$/)
    r.unmount()
  })

  it("names the viewer once, in the title bar, not on every row", async () => {
    const r = renderFrames(<App data={mockData()} initialScreen="issues" />)

    await r.waitFor("SHOP-412")

    const frame = last(r)
    expect(frame).toContain("@Ada Okafor")
    expect(frame.split("Ada Okafor").length - 1).toBe(1)
    r.unmount()
  })

  it("points an empty tab at the ones that have rows", async () => {
    const todoOnly = (): DataSource => ({
      ...mockData(),
      listIssues: async () =>
        (await mockData().listIssues(false)).filter((r) => r.category === "new"),
    })
    const r = renderFrames(<App data={todoOnly()} initialScreen="issues" />)

    await r.waitFor("Nothing here")

    expect(last(r)).toContain("To do (2)")
    r.unmount()
  })

  it("toggles a legend that names every glyph on screen", async () => {
    const r = renderFrames(<App data={mockData()} initialScreen="issues" />)
    await r.waitFor("SHOP-412")
    await settle()

    r.write("?")
    await r.waitFor("high priority")

    expect(last(r)).toContain("status category")
    r.write("?")
    await settle()
    expect(last(r)).not.toContain("high priority")
    r.unmount()
  })
})

describe("search", () => {
  const last = (r: { lastFrame: () => string }): string => r.lastFrame()

  it("narrows the loaded rows live as plain words are typed", async () => {
    const r = renderFrames(<App data={mockData()} initialScreen="issues" />)
    await r.waitFor("SHOP-412")
    await settle()

    r.write("/")
    await settle()
    r.write("coupon")
    await r.waitFor("1 of 7")

    const frame = last(r)
    expect(frame).toContain("plain")
    expect(frame).toContain("SHOP-401")
    expect(frame).not.toContain("SHOP-412")
    r.unmount()
  })

  it("recognises JQL by its shape and says so", async () => {
    const r = renderFrames(<App data={mockData()} initialScreen="issues" />)
    await r.waitFor("SHOP-412")
    await settle()

    r.write("/")
    await settle()
    r.write("status = Done")
    await r.waitFor("JQL")

    // JQL never narrows live — it runs on enter, so the list is untouched.
    expect(last(r)).toContain("7 items")
    r.unmount()
  })

  it("runs the query on enter and names it as the scope", async () => {
    const data = mockData()
    const search = vi.spyOn(data, "search")
    const r = renderFrames(<App data={data} initialScreen="issues" />)
    await r.waitFor("SHOP-412")
    await settle()

    r.write("/")
    await settle()
    r.write("coupon")
    await settle()
    r.write("\r")
    await r.waitFor("“coupon”")

    expect(search).toHaveBeenCalledWith("coupon", "auto")
    expect(last(r)).not.toContain("@Ada Okafor")
    r.write("\u001b")
    await r.waitFor("@Ada Okafor")
    r.unmount()
  })

  it("shows Jira's own words for a bad query and keeps it for editing", async () => {
    const rejecting = (): DataSource => ({
      ...mockData(),
      search: async () => {
        throw jiraApiError(
          400,
          "POST",
          "https://example.atlassian.net/rest/api/3/search/jql",
          JSON.stringify({
            errorMessages: ["Field 'statsu' does not exist or you do not have permission to view it."],
            errors: {},
          }),
        )
      },
    })
    const r = renderFrames(<App data={rejecting()} initialScreen="issues" />)
    await r.waitFor("SHOP-412")
    await settle()

    r.write("/")
    await settle()
    r.write("statsu = Done")
    await settle()
    r.write("\r")
    await r.waitFor("Field 'statsu' does not exist")

    const frame = last(r)
    expect(frame).toContain("SHOP-412")
    expect(frame).not.toContain("search/jql")
    r.write("/")
    await settle()
    expect(last(r)).toContain("statsu = Done")
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
