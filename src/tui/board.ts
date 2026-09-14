import type { IssueRow, StatusCategory } from "./data.js"

/**
 * Tabs come from Jira's status CATEGORY, never from a status name. Every
 * status on every instance carries one of these three keys, so the board
 * needs no configuration and can never hardcode one workflow's vocabulary —
 * which is the knowledge a public tool must not carry. A status arriving
 * without a category is filed under In progress rather than dropped: a row
 * that vanishes is the one failure a board must not have.
 */
export type TabId = "todo" | "doing" | "done"

export const TABS: { value: TabId; label: string }[] = [
  { value: "todo", label: "To do" },
  { value: "doing", label: "In progress" },
  { value: "done", label: "Done" },
]

export const tabOf = (category: StatusCategory): TabId =>
  category === "new" ? "todo" : category === "done" ? "done" : "doing"

export const countsFor = (rows: IssueRow[]): Record<TabId, number> =>
  rows.reduce(
    (acc, row) => ({
      ...acc,
      [tabOf(row.category)]: acc[tabOf(row.category)] + 1,
    }),
    { todo: 0, doing: 0, done: 0 } as Record<TabId, number>,
  )

/**
 * What one tab draws, in order. An epic that is itself in the tab HEADS its
 * group as a selectable row, its children hanging beneath it the way
 * cockpit's tree does; a parent that is not in the tab gets a dim fence
 * instead, because there is no row to select. Epic-headed groups come first,
 * then fenced ones, then rows with no parent — and each group after the
 * first is preceded by a blank line. A tab where nothing has a parent and
 * nothing is an epic degrades to a plain list, never to a lone fence.
 */
export type Block =
  | { kind: "gap" }
  | { kind: "fence"; key: string | null; summary: string }
  | { kind: "issue"; row: IssueRow; depth: 0 | 1 }

const isEpic = (row: IssueRow): boolean => row.type.toLowerCase() === "epic"

export const blocksFor = (rows: IssueRow[]): Block[] => {
  const hasStructure = rows.some((r) => r.parent || isEpic(r))
  if (!hasStructure)
    return rows.map((row) => ({ kind: "issue", row, depth: 0 }))

  const heads = new Map(rows.filter(isEpic).map((r) => [r.key, r]))
  const children = new Map<string, IssueRow[]>()
  const orphans: IssueRow[] = []
  for (const row of rows) {
    if (isEpic(row)) continue
    const key = row.parent?.key
    if (!key) {
      orphans.push(row)
      continue
    }
    children.set(key, [...(children.get(key) ?? []), row])
  }

  const groups: Block[][] = []
  for (const [key, head] of heads)
    groups.push([
      { kind: "issue", row: head, depth: 0 },
      ...(children.get(key) ?? []).map(
        (row): Block => ({ kind: "issue", row, depth: 1 }),
      ),
    ])
  for (const [key, kids] of children) {
    if (heads.has(key)) continue
    groups.push([
      { kind: "fence", key, summary: kids[0]!.parent?.summary ?? "" },
      ...kids.map((row): Block => ({ kind: "issue", row, depth: 1 })),
    ])
  }
  if (orphans.length)
    groups.push([
      ...(groups.length ? [{ kind: "fence", key: null, summary: "No epic" } as Block] : []),
      ...orphans.map((row): Block => ({ kind: "issue", row, depth: 0 })),
    ])

  return groups.flatMap((group, i) =>
    i === 0 ? group : [{ kind: "gap" } as Block, ...group],
  )
}

/** Index into `blocks` of the n-th issue, so a cursor over issues maps to a line. */
export const blockIndexOfIssue = (
  blocks: Block[],
  issueIndex: number,
): number => {
  let seen = -1
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i]!.kind === "issue" && ++seen === issueIndex) return i
  }
  return 0
}

/**
 * Priority names are per-instance, so this matches the default scheme, the
 * common renames and the P0–P4 ladder rather than an exact list. Medium — or
 * anything unrecognised — draws nothing: the glyph column marks the two ends
 * only.
 */
export const priorityGlyph = (name: string | null): "▲" | "▼" | " " => {
  const n = (name ?? "").trim().toLowerCase()
  if (/highest|high|critical|blocker|urgent|^p[01]$/.test(n)) return "▲"
  if (/lowest|low|minor|trivial|^p[3-5]$/.test(n)) return "▼"
  return " "
}

const UNITS: [number, string][] = [
  [60, "m"],
  [60, "h"],
  [24, "d"],
  [7, "w"],
]

export const relativeAge = (iso: string, now: number = Date.now()): string => {
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return ""
  let value = Math.max(0, Math.round((now - then) / 1000))
  let unit = "s"
  for (const [size, next] of UNITS) {
    if (value < size) break
    value = Math.round(value / size)
    unit = next
  }
  return `${value}${unit}`
}

export const pillVariantFor = (
  type: string,
): "group" | "info" | "error" | "muted" => {
  const t = type.toLowerCase()
  if (t === "epic") return "group"
  if (t === "bug") return "error"
  if (t === "story") return "info"
  return "muted"
}
