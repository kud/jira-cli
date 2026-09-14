import { searchJql, type SearchMode } from "@kud/jira"
import {
  boardOf,
  issueDetailOf,
  transitionsOf,
  type BoardModel,
  type IssueDetail,
  type Transition,
} from "@kud/jira-ink"
import { context, type Context } from "../commands/context.js"

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
  board: (all: boolean) => Promise<BoardModel>
  me: () => Promise<Viewer>
  /**
   * Plain words search within the viewer's own list; JQL replaces it. The
   * mode actually used comes back so the screen can name it.
   */
  search: (
    query: string,
    mode: SearchMode,
  ) => Promise<{ model: BoardModel; mode: "jql" | "text" }>
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

/**
 * Where the tabs come from: `--board` on the command line beats
 * `defaultBoard` in the config file; hand-written `tabs` there beat both.
 * Nothing is auto-detected — a guessed board is a guess wearing a feature's
 * clothes.
 */
const boardOptions = (ctx: Context & { board?: number }) => ({
  ...(ctx.config.tabs ? { tabs: ctx.config.tabs } : {}),
  ...(ctx.board ?? ctx.config.defaultBoard !== undefined
    ? { board: ctx.board ?? ctx.config.defaultBoard }
    : {}),
})

export const liveData = (
  ctx: Context & { board?: number } = context(),
): DataSource => ({
  baseUrl: ctx.config.baseUrl,

  board: (all) =>
    boardOf(
      ctx.client,
      `assignee = currentUser()${all ? "" : ` AND ${DEFAULT_SCOPE}`} ORDER BY updated DESC`,
      boardOptions(ctx),
    ),

  me: async () => ({ displayName: (await ctx.client.getMe()).displayName }),

  search: async (query, mode) => {
    const { jql, mode: used } = searchJql(query, {
      mode,
      scope: "assignee = currentUser()",
    })
    return { model: await boardOf(ctx.client, jql, boardOptions(ctx)), mode: used }
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
