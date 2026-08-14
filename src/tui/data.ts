import { adfToMarkdown, locateAttachments, type JiraIssue } from "@kud/jira"
import type { LocatedAttachment } from "@kud/jira"
import { context, type Context } from "../commands/context.js"

export type IssueRow = {
  key: string
  status: string
  summary: string
  assignee: string
  updated: string
}

export type IssueDetail = {
  key: string
  summary: string
  status: string
  type: string
  assignee: string
  reporter: string
  labels: string[]
  url: string
  description: string
  comments: { id: string; author: string; created: string; body: string }[]
  attachments: LocatedAttachment[]
}

export type Transition = { id: string; name: string; to: string }

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

  getIssue: async (key) => {
    const issue = await ctx.client.getIssue(key)
    const attachments = locateAttachments(issue)
    const filenameOf = (id: string): string | undefined =>
      attachments.find((a) => a.id === id)?.filename
    const f = issue.fields

    return {
      key: issue.key,
      summary: f.summary ?? "",
      status: f.status?.name ?? "—",
      type: f.issuetype?.name ?? "—",
      assignee: f.assignee?.displayName ?? "unassigned",
      reporter: f.reporter?.displayName ?? "—",
      labels: f.labels ?? [],
      url: `${ctx.config.baseUrl}/browse/${issue.key}`,
      description: adfToMarkdown(f.description, filenameOf),
      comments: (f.comment?.comments ?? []).map((c) => ({
        id: c.id,
        author: c.author?.displayName ?? "unknown",
        created: c.created?.slice(0, 10) ?? "",
        body: adfToMarkdown(c.body, filenameOf),
      })),
      attachments,
    }
  },

  getTransitions: async (key) =>
    (await ctx.client.getTransitions(key)).transitions.map((t) => ({
      id: t.id,
      name: t.name,
      to: t.to?.name ?? t.name,
    })),

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
