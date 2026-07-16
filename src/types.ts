export interface JiraUser {
  accountId: string
  displayName: string
  emailAddress?: string
  avatarUrls?: Record<string, string>
  active: boolean
}

export interface JiraStatus {
  id: string
  name: string
  statusCategory: {
    key: string
    colorName: string
    name: string
  }
}

export interface JiraIssueType {
  id: string
  name: string
  iconUrl?: string
}

export interface JiraPriority {
  id: string
  name: string
  iconUrl?: string
}

export interface JiraProject {
  id: string
  key: string
  name: string
  projectTypeKey: string
}

export interface JiraComment {
  id: string
  author: JiraUser
  body: JiraDocNode
  created: string
  updated: string
}

export interface JiraDocNode {
  type: string
  content?: JiraDocNode[]
  text?: string
  attrs?: Record<string, unknown>
}

export interface JiraIssueFields {
  summary: string
  description?: JiraDocNode | null
  status: JiraStatus
  assignee?: JiraUser | null
  reporter?: JiraUser
  issuetype: JiraIssueType
  priority?: JiraPriority
  project: JiraProject
  created: string
  updated: string
  comment?: {
    comments: JiraComment[]
    total: number
  }
  customfield_10002?: number | null
  labels?: string[]
  [key: string]: unknown
}

export interface JiraIssue {
  id: string
  key: string
  self: string
  fields: JiraIssueFields
}

export interface JiraSearchResult {
  issues: JiraIssue[]
  total: number
  startAt: number
  maxResults: number
}

export interface JiraBoard {
  id: number
  name: string
  type: string
  location?: {
    projectKey: string
    projectName: string
  }
}

export interface JiraSprint {
  id: number
  name: string
  state: "active" | "closed" | "future"
  startDate?: string
  endDate?: string
  goal?: string
}

export interface JiraTransition {
  id: string
  name: string
  to: JiraStatus
}
