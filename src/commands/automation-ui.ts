import type { JiraClient } from "@kud/jira"

/**
 * The fields of `GET /rest/api/3/project/{key}` that decide where a project's
 * settings live. `style` is `next-gen` for team-managed and `classic` for
 * company-managed; `simplified` says the same thing as a boolean.
 */
export type ProjectKind = {
  key?: string
  projectTypeKey?: string
  style?: string
  simplified?: boolean
}

const teamManaged = (project: ProjectKind): boolean | undefined => {
  if (project.style === "next-gen" || project.simplified === true) return true
  if (project.style === "classic" || project.simplified === false) return false
  return undefined
}

/**
 * Where the web UI keeps a project's automation rules, built from the project
 * type and style. These shapes follow how Jira routes project settings today;
 * none is documented as a stable URL, so callers print the menu path next to
 * it. Undefined when the project type is one this does not know.
 */
export const projectAutomationUrl = (
  baseUrl: string,
  key: string,
  project: ProjectKind,
): string | undefined => {
  const base = baseUrl.replace(/\/+$/, "")
  const k = encodeURIComponent(key)
  switch (project.projectTypeKey) {
    case "software": {
      const team = teamManaged(project)
      if (team === undefined) return undefined
      return team
        ? `${base}/jira/software/projects/${k}/settings/automate`
        : `${base}/jira/software/c/projects/${k}/settings/automate`
    }
    case "business":
      return `${base}/jira/core/projects/${k}/settings/automate`
    case "service_desk":
      return `${base}/jira/servicedesk/projects/${k}/settings/automate`
    default:
      return undefined
  }
}

/**
 * Reads the project and derives its automation URL. A failed read gives
 * undefined, never an error: the URL is a convenience on top of a message
 * that already stands on its own.
 */
export const readProjectAutomationUrl = async (
  client: JiraClient,
  baseUrl: string,
  key: string,
): Promise<string | undefined> => {
  try {
    const project = await client.request<ProjectKind>(
      `/rest/api/3/project/${encodeURIComponent(key)}`,
    )
    return project ? projectAutomationUrl(baseUrl, key, project) : undefined
  } catch {
    return undefined
  }
}
