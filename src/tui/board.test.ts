import { describe, expect, it } from "vitest"
import {
  blockIndexOfIssue,
  blocksFor,
  countsFor,
  priorityGlyph,
  relativeAge,
  tabOf,
} from "./board.js"
import type { IssueRow } from "./data.js"

const row = (over: Partial<IssueRow>): IssueRow => ({
  key: "SHOP-1",
  status: "Anything",
  category: "indeterminate",
  summary: "a summary",
  type: "Task",
  priority: null,
  assignee: "Ada Okafor",
  updated: "2026-08-14T09:12:00.000Z",
  ...over,
})

describe("tabs come from the status category, never the status name", () => {
  it("files every category, and an unknown one somewhere visible", () => {
    expect(tabOf("new")).toBe("todo")
    expect(tabOf("indeterminate")).toBe("doing")
    expect(tabOf("done")).toBe("done")
    expect(tabOf("unknown")).toBe("doing")
  })

  it("counts sum to the rows given", () => {
    const rows = [
      row({ key: "A-1", category: "new" }),
      row({ key: "A-2", status: "Weird Custom Status", category: "indeterminate" }),
      row({ key: "A-3", category: "done" }),
      row({ key: "A-4", category: "unknown" }),
    ]
    const counts = countsFor(rows)
    expect(counts).toEqual({ todo: 1, doing: 2, done: 1 })
    expect(counts.todo + counts.doing + counts.done).toBe(rows.length)
  })
})

describe("grouping by parent", () => {
  const epic = { key: "SHOP-300", summary: "Checkout" }
  const shape = (blocks: ReturnType<typeof blocksFor>): string[] =>
    blocks.map((b) =>
      b.kind === "gap"
        ? "·"
        : b.kind === "fence"
          ? `F:${b.summary}`
          : `${b.depth ? "└" : ""}${b.row.key}`,
    )

  it("heads a group with the epic row itself when the epic is in the tab", () => {
    const blocks = blocksFor([
      row({ key: "A-1", parent: epic }),
      row({ key: "SHOP-300", type: "Epic", summary: "Checkout" }),
      row({ key: "A-2" }),
    ])
    expect(shape(blocks)).toEqual(["SHOP-300", "└A-1", "·", "F:No epic", "A-2"])
  })

  it("fences a parent that is not in the tab, with a gap between groups", () => {
    const other = { key: "SHOP-350", summary: "Storefront" }
    const blocks = blocksFor([
      row({ key: "A-1", parent: epic }),
      row({ key: "A-2", parent: other }),
      row({ key: "A-3", parent: epic }),
    ])
    expect(shape(blocks)).toEqual([
      "F:Checkout",
      "└A-1",
      "└A-3",
      "·",
      "F:Storefront",
      "└A-2",
    ])
  })

  it("puts a childless epic at the top as a plain row, never under No epic", () => {
    const blocks = blocksFor([
      row({ key: "A-1" }),
      row({ key: "SHOP-300", type: "Epic" }),
    ])
    expect(shape(blocks)).toEqual(["SHOP-300", "·", "F:No epic", "A-1"])
  })

  it("degrades to a plain list when nothing has a parent and nothing is an epic", () => {
    const blocks = blocksFor([row({ key: "A-1" }), row({ key: "A-2" })])
    expect(shape(blocks)).toEqual(["A-1", "A-2"])
  })

  it("maps the n-th issue back to its line for the cursor, skipping gaps and fences", () => {
    const blocks = blocksFor([row({ key: "A-1", parent: epic }), row({ key: "A-2" })])
    expect(blockIndexOfIssue(blocks, 0)).toBe(1)
    expect(blockIndexOfIssue(blocks, 1)).toBe(4)
  })
})

describe("row glyphs", () => {
  it("marks only the two ends of priority", () => {
    expect(priorityGlyph("Highest")).toBe("▲")
    expect(priorityGlyph("High")).toBe("▲")
    expect(priorityGlyph("Medium")).toBe(" ")
    expect(priorityGlyph("Low")).toBe("▼")
    expect(priorityGlyph(null)).toBe(" ")
    expect(priorityGlyph("P1")).toBe("▲")
    expect(priorityGlyph("P2")).toBe(" ")
    expect(priorityGlyph("P4")).toBe("▼")
  })

  it("renders age in the largest whole unit", () => {
    const now = Date.parse("2026-08-14T12:00:00.000Z")
    expect(relativeAge("2026-08-14T11:58:00.000Z", now)).toBe("2m")
    expect(relativeAge("2026-08-14T07:00:00.000Z", now)).toBe("5h")
    expect(relativeAge("2026-08-11T12:00:00.000Z", now)).toBe("3d")
    expect(relativeAge("2026-07-10T12:00:00.000Z", now)).toBe("5w")
    expect(relativeAge("not a date", now)).toBe("")
  })
})
