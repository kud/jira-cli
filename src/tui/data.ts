import type { JiraIssue } from "@kud/jira"
import {
  issueDetailOf,
  transitionsOf,
  type IssueDetail,
  type Transition,
} from "@kud/jira-ink"
import { context, type Context } from "../commands/context.js"

export type IssueRow = {
  key: string
  status: string
  summary: string
  assignee: string
  updated: string
}

// The detail shape and its fetch live in @kud/jira-ink, beside the screen that
// reads them, so cockpit can mount the same view; re-exported here so the rest
// of the TUI keeps one import path for its data types.
export type { IssueDetail, Transition }

/**
 * Everything the views need, behind one interface. The mock implementation is
 * a peer rather than a flag inside the real one: half-mocking — real issues
 * beside invented comments — is the failure the screenshot contract exists to
 * prevent.
 */
export type DataSource = {
  listIssues: (all: boolean) => Promise<IssueRow[]>
  getIssue: (key: string) => Promise<IssueDetail>
  getTransitions: (key: string) => Promise<Transition[]>
  transition: (key: string, transitionId: string) => Promise<void>
  comment: (key: string, body: string) => Promise<void>
  assignToMe: (key: string) => Promise<void>
  baseUrl: string
}

const OPEN_ONLY = "statusCategory != Done"

const toRow = (issue: JiraIssue): IssueRow => ({
  key: issue.key,
  status: issue.fields.status?.name ?? "—",
  summary: issue.fields.summary ?? "",
  assignee: issue.fields.assignee?.displayName ?? "unassigned",
  updated: issue.fields.updated?.slice(0, 10) ?? "",
})

export const liveData = (ctx: Context = context()): DataSource => ({
  baseUrl: ctx.config.baseUrl,

  listIssues: async (all) => {
    const jql = `assignee = currentUser()${all ? "" : ` AND ${OPEN_ONLY}`} ORDER BY updated DESC`
    return (await ctx.client.searchIssues(jql, { limit: 200 })).map(toRow)
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
