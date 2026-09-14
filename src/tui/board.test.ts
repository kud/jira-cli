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

  it("draws one header per parent, orphans last, when any row has a parent", () => {
    const blocks = blocksFor([
      row({ key: "A-1", parent: epic }),
      row({ key: "A-2" }),
      row({ key: "A-3", parent: epic }),
    ])
    expect(blocks.map((b) => (b.kind === "header" ? `H:${b.summary}` : b.row.key))).toEqual([
      "H:Checkout",
      "A-1",
      "A-3",
      "H:No epic",
      "A-2",
    ])
  })

  it("degrades to a plain list when nothing has a parent", () => {
    const blocks = blocksFor([row({ key: "A-1" }), row({ key: "A-2" })])
    expect(blocks.every((b) => b.kind === "issue")).toBe(true)
    expect(blocks).toHaveLength(2)
  })

  it("maps the n-th issue back to its line for the cursor", () => {
    const blocks = blocksFor([row({ key: "A-1", parent: epic }), row({ key: "A-2" })])
    expect(blockIndexOfIssue(blocks, 0)).toBe(1)
    expect(blockIndexOfIssue(blocks, 1)).toBe(3)
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
