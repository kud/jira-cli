import type { JiraIssue } from "@kud/jira"
import {
  issueDetailOf,
  transitionsOf,
  type IssueDetail,
  type Transition,
} from "@kud/jira-ink"
import { context, type Context } from "../commands/context.js"
import { searchJql, type SearchMode } from "../jql.js"

/** Jira's own three, plus `unknown` for a status that arrives without one. */
export type StatusCategory = "new" | "indeterminate" | "done" | "unknown"

export type IssueRow = {
  key: string
  status: string
  category: StatusCategory
  summary: string
  type: string
  priority: string | null
  parent?: { key: string; summary: string }
  assignee: string
  /** ISO timestamp, kept whole so the view can draw a relative age. */
  updated: string
}

export type Viewer = { displayName: string }

// The detail shape and its fetch live in @kud/jira-ink, beside the screen that
// reads them, so cockpit can mount the same view; re-exported here so the rest
// of the TUI keeps one import path for its data types.
export type { IssueDetail, Transition }
export type { SearchMode }

/**
 * Everything the views need, behind one interface. The mock implementation is
 * a peer rather than a flag inside the real one: half-mocking — real issues
 * beside invented comments — is the failure the screenshot contract exists to
 * prevent.
 */
export type DataSource = {
  listIssues: (all: boolean) => Promise<IssueRow[]>
  me: () => Promise<Viewer>
  /**
   * Plain words search within the viewer's own list; JQL replaces it. The
   * mode actually used comes back so the screen can name it.
   */
  search: (
    query: string,
    mode: SearchMode,
  ) => Promise<{ rows: IssueRow[]; mode: "jql" | "text" }>
  getIssue: (key: string) => Promise<IssueDetail>
  getTransitions: (key: string) => Promise<Transition[]>
  transition: (key: string, transitionId: string) => Promise<void>
  comment: (key: string, body: string) => Promise<void>
  assignToMe: (key: string) => Promise<void>
  baseUrl: string
}

// Open work, plus what closed recently — so the Done tab has something to say
// without `a` fetching every ticket ever resolved.
const DEFAULT_SCOPE =
  "(statusCategory != Done OR (statusCategory = Done AND updated >= -14d))"

const CATEGORIES: StatusCategory[] = ["new", "indeterminate", "done"]

const categoryOf = (key: string | undefined): StatusCategory =>
  CATEGORIES.find((c) => c === key) ?? "unknown"

export const toRow = (issue: JiraIssue): IssueRow => ({
  key: issue.key,
  status: issue.fields.status?.name ?? "—",
  category: categoryOf(issue.fields.status?.statusCategory?.key),
  summary: issue.fields.summary ?? "",
  type: issue.fields.issuetype?.name ?? "",
  priority: issue.fields.priority?.name ?? null,
  ...(issue.fields.parent
    ? {
        parent: {
          key: issue.fields.parent.key,
          summary: issue.fields.parent.fields?.summary ?? "",
        },
      }
    : {}),
  assignee: issue.fields.assignee?.displayName ?? "unassigned",
  updated: issue.fields.updated ?? "",
})

export const liveData = (ctx: Context = context()): DataSource => ({
  baseUrl: ctx.config.baseUrl,

  listIssues: async (all) => {
    const jql = `assignee = currentUser()${all ? "" : ` AND ${DEFAULT_SCOPE}`} ORDER BY updated DESC`
    return (await ctx.client.searchIssues(jql, { limit: 200 })).map(toRow)
  },

  me: async () => ({ displayName: (await ctx.client.getMe()).displayName }),

  search: async (query, mode) => {
    const { jql, mode: used } = searchJql(query, {
      mode,
      scope: "assignee = currentUser()",
    })
    const issues = await ctx.client.searchIssues(jql, { limit: 200 })
    return { rows: issues.map(toRow), mode: used }
  },

  getIssue: (key) => issueDetailOf(ctx.client, ctx.config.baseUrl, key),

  getTransitions: (key) => transitionsOf(ctx.client, key),

  transition: (key, transitionId) =>
    ctx.client.transitionIssue(key, transitionId),

  comment: async (key, body) => {
    const { markdownToAdf } = await import("@kud/jira")
    await ctx.client.addComment(key, markdownToAdf(body))
  },

  assignToMe: async (key) => {
    const me = await ctx.client.getMe()
    await ctx.client.assignIssue(key, me.accountId)
  },
})
