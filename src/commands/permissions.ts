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

const yesNo = (value: boolean): string => (value ? "yes" : "no")

export const formatAdminPermissions = (p: AdminPermissions): string =>
  [
    `global admin (Administer Jira)   ${yesNo(p.globalAdmin)}`,
    p.project
      ? `project admin on ${p.project}${" ".repeat(Math.max(1, 16 - p.project.length))}${yesNo(p.projectAdmin)}`
      : `project admin (any project)      ${yesNo(p.projectAdmin)}`,
  ].join("\n")
