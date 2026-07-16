import type { Config } from "./config.js"
import type {
  JiraBoard,
  JiraIssue,
  JiraSearchResult,
  JiraSprint,
  JiraTransition,
  JiraUser,
  JiraProject,
} from "./types.js"

export class JiraClient {
  private readonly authHeader: string

  constructor(private readonly config: Config) {
    this.authHeader = `Basic ${Buffer.from(`${config.email}:${config.token}`).toString("base64")}`
  }

  async request<T>(
    path: string,
    options: RequestInit & { paginate?: boolean } = {},
  ): Promise<T> {
    const url = path.startsWith("http")
      ? path
      : `${this.config.baseUrl}${path.startsWith("/") ? "" : "/"}${path}`

    const res = await fetch(url, {
      ...options,
      headers: {
        Authorization: this.authHeader,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...options.headers,
      },
    })

    if (!res.ok) {
      const body = await res.text()
      throw new JiraApiError(res.status, options.method ?? "GET", url, body)
    }

    if (res.status === 204) return undefined as T
    return res.json() as Promise<T>
  }

  async getIssue(key: string): Promise<JiraIssue> {
    return this.request<JiraIssue>(
      `/rest/api/3/issue/${key}?expand=renderedFields,names,comment`,
    )
  }

  async searchIssues(
    jql: string,
    options: { maxResults?: number; startAt?: number; fields?: string[] } = {},
  ): Promise<JiraSearchResult> {
    const fields = options.fields ?? [
      "summary",
      "status",
      "assignee",
      "issuetype",
      "priority",
      "created",
      "updated",
      "project",
      "customfield_10002",
      "labels",
    ]
    return this.request<JiraSearchResult>("/rest/api/3/search", {
      method: "POST",
      body: JSON.stringify({
        jql,
        maxResults: options.maxResults ?? 50,
        startAt: options.startAt ?? 0,
        fields,
      }),
    })
  }

  async createIssue(
    fields: Record<string, unknown>,
  ): Promise<{ id: string; key: string; self: string }> {
    return this.request("/rest/api/3/issue", {
      method: "POST",
      body: JSON.stringify({ fields }),
    })
  }

  async transitionIssue(key: string, transitionId: string): Promise<void> {
    return this.request(`/rest/api/3/issue/${key}/transitions`, {
      method: "POST",
      body: JSON.stringify({ transition: { id: transitionId } }),
    })
  }

  async getTransitions(
    key: string,
  ): Promise<{ transitions: JiraTransition[] }> {
    return this.request(`/rest/api/3/issue/${key}/transitions`)
  }

  async addComment(key: string, body: unknown): Promise<void> {
    return this.request(`/rest/api/3/issue/${key}/comment`, {
      method: "POST",
      body: JSON.stringify({ body }),
    })
  }

  async getMe(): Promise<JiraUser> {
    return this.request<JiraUser>("/rest/api/3/myself")
  }

  async getProjects(): Promise<JiraProject[]> {
    return this.request<JiraProject[]>("/rest/api/3/project?expand=description")
  }

  async getBoards(): Promise<{ values: JiraBoard[] }> {
    return this.request("/rest/agile/1.0/board")
  }

  async getSprints(
    boardId: number,
    state?: string,
  ): Promise<{ values: JiraSprint[] }> {
    const q = state ? `?state=${state}` : ""
    return this.request(`/rest/agile/1.0/board/${boardId}/sprint${q}`)
  }

  async searchUsers(
    query: string,
    options: { projectKey?: string; maxResults?: number } = {},
  ): Promise<JiraUser[]> {
    const params = new URLSearchParams({
      query,
      maxResults: String(options.maxResults ?? 20),
    })
    if (options.projectKey) {
      params.set("project", options.projectKey)
      return this.request<JiraUser[]>(
        `/rest/api/3/user/assignable/search?${params}`,
      )
    }
    return this.request<JiraUser[]>(`/rest/api/3/user/search?${params}`)
  }
}

export class JiraApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly method: string,
    public readonly url: string,
    public readonly body: string,
  ) {
    super(`Jira API ${status} ${method} ${url}: ${body}`)
    this.name = "JiraApiError"
  }
}
