import { looksLikeJql } from "@kud/jira"
import { MOCK_BOARD_ROWS, mockBoard } from "@kud/jira-ink"
import type { DataSource, IssueDetail } from "./data.js"

const ROWS = MOCK_BOARD_ROWS

/**
 * Fixtures for `--mock`. Every field is invented — no key, name or hostname
 * here belongs to a real instance, because these frames end up in screenshots
 * and READMEs. All-or-nothing by design: the mock source answers every call,
 * so a screenshot can never mix invented comments with real issues.
 */
const DETAIL: Record<string, IssueDetail> = {
  "SHOP-412": {
    key: "SHOP-412",
    summary: "Checkout total ignores the discount on the last item",
    status: "In Progress",
    type: "Bug",
    assignee: "Ada Okafor",
    reporter: "Bram Nilsen",
    labels: ["checkout", "regression"],
    parent: { key: "SHOP-300", summary: "Basket and checkout correctness" },
    url: "https://example.atlassian.net/browse/SHOP-412",
    description: [
      "## What happens",
      "",
      "The basket total is correct until the **last** line item, whose discount is",
      "dropped from the sum.",
      "",
      "```js",
      "const total = items.slice(0, -1).reduce(withDiscount, 0)",
      "```",
      "",
      "1. Add three items",
      "2. Apply `SUMMER20`",
      "3. Compare the total against the line items",
      "",
      "[attachment: basket.png]",
    ].join("\n"),
    comments: [
      {
        id: "c1",
        author: "Bram Nilsen",
        created: "2026-08-13",
        body: "Reproduced on staging. Screenshot attached.\n\n[attachment: basket.png]",
      },
      {
        id: "c2",
        author: "Ada Okafor",
        created: "2026-08-14",
        body: "Off-by-one in `slice(0, -1)`. Fix and a regression test on the way.",
      },
    ],
    attachments: [
      {
        id: "9001",
        filename: "basket.png",
        mimeType: "image/png",
        size: 48213,
        origins: [{ kind: "comment", commentId: "c1", author: "Bram Nilsen" }],
      },
      {
        id: "9002",
        filename: "checkout.log",
        mimeType: "text/plain",
        size: 2044,
        origins: [{ kind: "issue" }],
      },
    ],
  },
}

const fallbackDetail = (key: string): IssueDetail => {
  const row = ROWS.find((r) => r.key === key) ?? ROWS[0]!
  return {
    key: row.key,
    summary: row.summary,
    status: row.status,
    type: row.type,
    assignee: row.assignee,
    reporter: "Bram Nilsen",
    labels: [],
    url: `https://example.atlassian.net/browse/${row.key}`,
    description: "_No description._",
    comments: [],
    attachments: [],
  }
}

export const mockData = (): DataSource => ({
  baseUrl: "https://example.atlassian.net",
  board: async () => mockBoard(),
  me: async () => ({ displayName: "Ada Okafor" }),
  search: async (query, mode) => {
    const used = mode === "jql" || (mode === "auto" && looksLikeJql(query)) ? "jql" : "text"
    const words = query.toLowerCase()
    const model = mockBoard()
    return {
      mode: used,
      model:
        used === "jql"
          ? model
          : {
              ...model,
              rows: ROWS.filter((r) =>
                `${r.key} ${r.summary}`.toLowerCase().includes(words),
              ),
            },
    }
  },
  getIssue: async (key) => DETAIL[key] ?? fallbackDetail(key),
  getTransitions: async () => [
    { id: "11", name: "Start progress", to: "In Progress" },
    { id: "21", name: "Ready for review", to: "In Review" },
    { id: "31", name: "Done", to: "Done" },
  ],
  transition: async () => {},
  comment: async () => {},
  assignToMe: async () => {},
})
