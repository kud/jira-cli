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
 * What one tab draws, in order: an optional header for each parent, then the
 * issues under it. Headers appear only when at least one visible row has a
 * parent — a Jira with no epic structure degrades to a plain list, never to
 * a lone "No epic" rule over everything.
 */
export type Block =
  | { kind: "header"; key: string | null; summary: string }
  | { kind: "issue"; row: IssueRow }

export const blocksFor = (rows: IssueRow[]): Block[] => {
  if (!rows.some((r) => r.parent))
    return rows.map((row) => ({ kind: "issue", row }))

  const groups = new Map<string | null, { summary: string; rows: IssueRow[] }>()
  for (const row of rows) {
    const key = row.parent?.key ?? null
    const group = groups.get(key) ?? {
      summary: row.parent?.summary ?? "",
      rows: [],
    }
    group.rows.push(row)
    groups.set(key, group)
  }

  // Parents in first-seen order (rows arrive newest first, so the liveliest
  // epic leads), orphans last under a plain rule.
  const ordered = [...groups.entries()].sort(([a], [b]) =>
    a === null ? 1 : b === null ? -1 : 0,
  )
  return ordered.flatMap(([key, group]) => [
    { kind: "header" as const, key, summary: key ? group.summary : "No epic" },
    ...group.rows.map((row) => ({ kind: "issue" as const, row })),
  ])
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
