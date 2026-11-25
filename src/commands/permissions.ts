import type { JiraClient } from "@kud/jira"

/**
 * Jira's global admin and project admin, as `mypermissions` reports them.
 * Without a project, `projectAdmin` means "in at least one project": that is
 * how Jira answers a project permission asked in the global context.
 * https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-permissions/#api-rest-api-3-mypermissions-get
 */
export type AdminPermissions = {
  globalAdmin: boolean
  projectAdmin: boolean
  project?: string
  board?: BoardAdmin
  automation?: AutomationAccess
}

/**
 * The Automation REST API takes Administer Jira and nothing less, so `api`
 * is the global admin flag under another name. `uiUrl` is the project's
 * automation page, given when a project was asked about and this account
 * administers it: the web UI is the route left to a project admin.
 */
export type AutomationAccess = { api: boolean; uiUrl?: string }

/**
 * Board admin is its own role, held by a user or through a group, and has
 * nothing to do with project permissions. `boardAdmin` is undefined when the
 * board is not in the list this account can see, so it cannot be told.
 * `canEdit` is kept apart because Jira also sets it for project and Jira
 * admins, which would make it a false "yes" here.
 */
export type BoardAdmin = {
  id: number
  name?: string
  boardAdmin?: boolean
  canEdit?: boolean
}

type MyPermissions = {
  permissions?: Record<string, { havePermission?: boolean } | undefined>
}

export const adminPermissions = async (
  client: JiraClient,
  project?: string,
): Promise<AdminPermissions> => {
  const query = new URLSearchParams({
    permissions: "ADMINISTER,ADMINISTER_PROJECTS",
  })
  if (project) query.set("projectKey", project)
  const mine = await client.request<MyPermissions>(
    `/rest/api/3/mypermissions?${query}`,
  )
  return {
    globalAdmin: mine?.permissions?.["ADMINISTER"]?.havePermission === true,
    projectAdmin:
      mine?.permissions?.["ADMINISTER_PROJECTS"]?.havePermission === true,
    ...(project ? { project } : {}),
  }
}

type BoardWithAdmins = {
  id: number
  name: string
  canEdit?: boolean
  admins?: {
    users?: { accountId?: string }[]
    groups?: { name?: string }[]
  }
}

type BoardPage = { values?: BoardWithAdmins[]; isLast?: boolean }

/**
 * `expand=admins` is only offered on the board list, not on a single board,
 * so the board's name narrows the list and its ID picks it out. The groups
 * come from /myself?expand=groups, nested ones included, since a board admin
 * group can hold the account indirectly.
 * https://developer.atlassian.com/cloud/jira/software/rest/api-group-board/#api-rest-agile-1-0-board-get
 */
export const boardAdmin = async (
  client: JiraClient,
  boardId: number,
): Promise<BoardAdmin> => {
  const [board, me] = await Promise.all([
    client.request<{ id: number; name: string }>(
      `/rest/agile/1.0/board/${boardId}`,
    ),
    client.request<{
      accountId: string
      groups?: { items?: { name?: string }[] }
    }>("/rest/api/3/myself?expand=groups"),
  ])

  let found: BoardWithAdmins | undefined
  for (let startAt = 0; !found;) {
    const query = new URLSearchParams({
      name: board.name,
      expand: "admins,permissions",
      startAt: String(startAt),
      maxResults: "50",
    })
    const page = await client.request<BoardPage>(
      `/rest/agile/1.0/board?${query}`,
    )
    const values = page?.values ?? []
    found = values.find((b) => b.id === boardId)
    startAt += values.length
    if (page?.isLast !== false || values.length === 0) break
  }
  if (!found) return { id: boardId, name: board.name }

  const groups = new Set(
    (me.groups?.items ?? []).map((g) => g.name).filter(Boolean),
  )
  const isAdmin =
    (found.admins?.users ?? []).some((u) => u.accountId === me.accountId) ||
    (found.admins?.groups ?? []).some((g) => !!g.name && groups.has(g.name))
  return {
    id: boardId,
    name: found.name,
    boardAdmin: isAdmin,
    ...(found.canEdit !== undefined ? { canEdit: found.canEdit } : {}),
  }
}

const yesNo = (value: boolean | undefined): string =>
  value === undefined ? "unknown" : value ? "yes" : "no"

export const formatAdminPermissions = (p: AdminPermissions): string => {
  const rows: [string, string][] = [
    ["global admin (Administer Jira)", yesNo(p.globalAdmin)],
    [
      p.project
        ? `project admin on ${p.project}`
        : "project admin (any project)",
      yesNo(p.projectAdmin),
    ],
  ]
  if (p.automation) {
    rows.push([
      "automation rules (REST API)",
      p.automation.api ? "yes" : "no — needs Administer Jira",
    ])
    if (p.automation.uiUrl)
      rows.push([
        "automation rules (web UI)",
        `open: ${p.automation.uiUrl}  (Project settings > Automation)`,
      ])
  }
  if (p.board)
    rows.push([
      `board admin on ${p.board.name ?? "board"} (${p.board.id})`,
      p.board.boardAdmin === undefined
        ? "unknown (board not in the list this account can see)"
        : yesNo(p.board.boardAdmin),
    ])
  const width = Math.max(...rows.map(([label]) => label.length))
  return rows
    .map(([label, value]) => `${label.padEnd(width)}   ${value}`)
    .join("\n")
}
