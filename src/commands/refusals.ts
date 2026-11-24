import { isJiraApiError, type JiraClient } from "@kud/jira"
import { exitError } from "./context.js"
import { adminPermissions } from "./permissions.js"

/**
 * One shape for every 403 a write can meet: what was refused, the permission
 * Jira's spec names for it, and, where the permission is Administer
 * Projects, whether this account holds it. Exit 4, like every other refusal
 * of the credentials, so a script can tell "not allowed" from "bad input".
 * Anything but a 403 goes through untouched.
 */
export const explainRefusal = (
  error: unknown,
  what: string,
  needs: string,
  extra?: string,
): unknown => {
  if (!isJiraApiError(error) || error.status !== 403) return error
  return exitError(
    4,
    `Jira refused ${what} (403).\nIt needs ${needs}.${extra ? `\n${extra}` : ""}`,
  )
}

/**
 * Sprint writes are a project permission, not a board one: Manage sprints,
 * in every project the board's filter can return. Board admin alone gets a
 * 403. The Agile spec states no permission for these endpoints, so this rests
 * on Atlassian's support article for the same refusal in the web UI.
 * https://support.atlassian.com/jira/kb/cant-complete-the-sprint
 */
export const MANAGE_SPRINTS =
  "the Manage sprints project permission, in every project the board's filter can return"

export const sprintRefusal = (error: unknown, what: string): unknown =>
  explainRefusal(
    error,
    what,
    MANAGE_SPRINTS,
    "Board admin does not include it. Check with: jira meta permissions <KEY>",
  )

/**
 * Versions and roles need Administer Projects; the probe says whether this
 * account has it on the project, so the message says whom to ask. A failed
 * probe falls back to the plain message rather than hiding the 403.
 */
export const projectAdminRefusal = async (
  error: unknown,
  client: JiraClient,
  project: string | undefined,
  what: string,
): Promise<unknown> => {
  if (!isJiraApiError(error) || error.status !== 403) return error
  if (!project)
    return explainRefusal(
      error,
      what,
      "Administer Projects on the project, or Administer Jira",
    )
  let extra: string | undefined
  try {
    const p = await adminPermissions(client, project)
    extra = p.projectAdmin
      ? `Jira reports this account as a project admin on ${project}, so check the token belongs to ATLASSIAN_USER_EMAIL.`
      : `This account is not a project admin on ${project}; ask one of its project admins.`
  } catch {
    extra = undefined
  }
  return explainRefusal(
    error,
    what,
    `Administer Projects on ${project}, or Administer Jira`,
    extra,
  )
}
