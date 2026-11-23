import type { Command } from "commander"
import { isJiraApiError, type JiraClient } from "@kud/jira"
import { table, truncate } from "../output/format.js"
import { context, exitError, printJson, warnIfTruncated } from "./context.js"

/**
 * Read-only on purpose. Workflow writes need Administer Jira for anything a
 * company-managed project uses, while these reads are open to a project admin
 * or anyone with the View (read-only) workflow permission:
 * https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-workflows/
 */

type StatusCategory = "TODO" | "IN_PROGRESS" | "DONE" | string

export type WorkflowStatus = {
  id?: string
  name: string
  statusCategory?: StatusCategory
  statusReference: string
}

export type RuleConfiguration = {
  id?: string
  ruleKey: string
  parameters?: Record<string, unknown>
}

export type ConditionGroup = {
  operation?: "ANY" | "ALL" | string
  conditions?: RuleConfiguration[]
  conditionGroups?: ConditionGroup[]
}

export type Transition = {
  id: string
  name: string
  description?: string
  type?: "INITIAL" | "GLOBAL" | "DIRECTED" | string
  toStatusReference?: string
  links?: { fromStatusReference?: string }[]
  conditions?: ConditionGroup
  validators?: RuleConfiguration[]
  actions?: RuleConfiguration[]
}

export type Workflow = {
  id: string
  name: string
  description?: string
  scope?: { type?: "GLOBAL" | "PROJECT" | string; project?: { id: string } }
  statuses?: { statusReference: string }[]
  transitions?: Transition[]
}

type SearchPage = {
  values?: Workflow[]
  statuses?: WorkflowStatus[]
  isLast?: boolean
}

const PAGE = 50

/**
 * GET /workflows/search, paged on startAt until `isLast` or `limit`. The
 * statuses come back once per page rather than per workflow, so they are
 * merged by reference.
 */
const searchWorkflows = async (
  client: JiraClient,
  params: Record<string, string>,
  limit: number,
): Promise<{
  workflows: Workflow[]
  statuses: Map<string, WorkflowStatus>
}> => {
  const workflows: Workflow[] = []
  const statuses = new Map<string, WorkflowStatus>()
  let startAt = 0
  for (;;) {
    const query = new URLSearchParams({
      ...params,
      startAt: String(startAt),
      maxResults: String(Math.min(PAGE, limit - workflows.length)),
    })
    const page = await client.request<SearchPage>(
      `/rest/api/3/workflows/search?${query}`,
    )
    const values = page?.values ?? []
    workflows.push(...values)
    for (const s of page?.statuses ?? []) statuses.set(s.statusReference, s)
    startAt += values.length
    if (page?.isLast !== false || values.length === 0) break
    if (workflows.length >= limit) break
  }
  return { workflows, statuses }
}

type ProjectWithTypes = {
  id: string
  key: string
  issueTypes?: { id: string; name: string }[]
}

const getProject = (client: JiraClient, key: string) =>
  client.request<ProjectWithTypes>(
    `/rest/api/3/project/${encodeURIComponent(key)}`,
  )

/** By ID, or by name ignoring case, since that is how people type them. */
export const findIssueType = (
  project: ProjectWithTypes,
  wanted: string,
): { id: string; name: string } => {
  const types = project.issueTypes ?? []
  const match =
    types.find((t) => t.id === wanted) ??
    types.find((t) => t.name.toLowerCase() === wanted.toLowerCase())
  if (!match)
    throw exitError(
      1,
      `no issue type '${wanted}' in ${project.key} — it has: ${types.map((t) => t.name).join(", ") || "none"}`,
    )
  return match
}

const statusName = (
  ref: string | undefined,
  statuses: Map<string, WorkflowStatus>,
): string => (ref ? (statuses.get(ref)?.name ?? ref) : "?")

const ruleLine = (rule: RuleConfiguration): string => {
  const params = Object.entries(rule.parameters ?? {})
    .filter(([, v]) => v !== "" && v !== null && v !== undefined)
    .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
  return params.length ? `${rule.ruleKey} (${params.join(", ")})` : rule.ruleKey
}

const conditionLines = (group: ConditionGroup, indent: string): string[] => {
  const rules = group.conditions ?? []
  const groups = group.conditionGroups ?? []
  if (rules.length === 0 && groups.length === 0) return []
  const lines = [`${indent}${group.operation === "ANY" ? "any of" : "all of"}:`]
  for (const rule of rules) lines.push(`${indent}  - ${ruleLine(rule)}`)
  for (const nested of groups)
    lines.push(...conditionLines(nested, `${indent}  `))
  return lines
}

/**
 * "From → To", where a global transition has no from — it is offered from
 * every status — and an initial one runs when the issue is created.
 */
export const transitionPath = (
  t: Transition,
  statuses: Map<string, WorkflowStatus>,
): string => {
  const to = statusName(t.toStatusReference, statuses)
  if (t.type === "INITIAL") return `(create) → ${to}`
  const from = (t.links ?? [])
    .map((l) => l.fromStatusReference)
    .filter((r): r is string => !!r)
  if (t.type === "GLOBAL" || from.length === 0) return `(any) → ${to}`
  return `${from.map((r) => statusName(r, statuses)).join(", ")} → ${to}`
}

export const describeWorkflow = (
  workflow: Workflow,
  statuses: Map<string, WorkflowStatus>,
): string => {
  const lines: string[] = [workflow.name]
  if (workflow.description) lines.push(workflow.description)
  lines.push(`scope: ${workflow.scope?.type ?? "?"}`)

  const used = (workflow.statuses ?? []).map((s) => s.statusReference)
  lines.push("", "Statuses")
  for (const ref of used) {
    const s = statuses.get(ref)
    lines.push(
      `  ${s?.name ?? ref}${s?.statusCategory ? `  [${s.statusCategory}]` : ""}`,
    )
  }

  lines.push("", "Transitions")
  for (const t of workflow.transitions ?? []) {
    lines.push(`  ${t.name}  ${transitionPath(t, statuses)}`)
    const conditions = t.conditions
      ? conditionLines(t.conditions, "      ")
      : []
    if (conditions.length) lines.push("    conditions", ...conditions)
    if (t.validators?.length)
      lines.push(
        "    validators",
        ...t.validators.map((v) => `      - ${ruleLine(v)}`),
      )
    if (t.actions?.length)
      lines.push(
        "    post functions",
        ...t.actions.map((a) => `      - ${ruleLine(a)}`),
      )
  }
  return lines.join("\n")
}

/** The statuses a workflow references, for --json to stay self-contained. */
const statusesOf = (
  workflow: Workflow,
  statuses: Map<string, WorkflowStatus>,
): WorkflowStatus[] =>
  (workflow.statuses ?? [])
    .map((s) => statuses.get(s.statusReference))
    .filter((s): s is WorkflowStatus => !!s)

type SchemeRead = {
  id?: string
  name?: string
  defaultWorkflow?: { name?: string }
  workflowsForIssueTypes?: {
    issueTypeIds?: string[]
    workflow?: { name?: string }
  }[]
}

/**
 * The scheme names the workflow directly, but reading a company-managed
 * project's scheme needs Administer Jira. Bulk get workflows by project and
 * issue type resolves the same mapping on Jira's side and is open to a
 * project admin, so it is the fallback when the scheme is out of reach.
 * https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-workflow-schemes/#api-rest-api-3-workflowscheme-read-post
 * https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-workflows/#api-rest-api-3-workflows-post
 */
const readScheme = async (
  client: JiraClient,
  projectId: string,
): Promise<SchemeRead | undefined> => {
  try {
    const schemes = await client.request<SchemeRead[]>(
      "/rest/api/3/workflowscheme/read",
      { method: "POST", body: JSON.stringify({ projectIds: [projectId] }) },
    )
    return schemes?.[0]
  } catch (error) {
    if (isJiraApiError(error) && (error.status === 403 || error.status === 401))
      return undefined
    throw error
  }
}

export const workflowNameFromScheme = (
  scheme: SchemeRead,
  issueTypeId: string,
): string | undefined =>
  scheme.workflowsForIssueTypes?.find((m) =>
    m.issueTypeIds?.includes(issueTypeId),
  )?.workflow?.name ?? scheme.defaultWorkflow?.name

const positiveLimit = (raw: string): number => {
  const limit = Number(raw)
  if (!Number.isInteger(limit) || limit < 1)
    throw exitError(1, "--limit must be a positive whole number")
  return limit
}

export const registerWorkflowCommands = (program: Command): void => {
  const workflow = program
    .command("workflow")
    .description("read workflows: statuses, transitions and conditions")
    .addHelpText(
      "after",
      `
Read-only. Needs Administer Jira, or Administer projects (or View read-only
workflow) on the project the workflow is used in.

Examples:
  jira workflow list --project SHOP
  jira workflow get 'Software Simplified Workflow for Project SHOP'
  jira workflow for Bug --project SHOP
`,
    )

  workflow
    .command("list")
    .description("list workflows, optionally only those a project uses")
    .option("-p, --project <key>", "only workflows used by this project")
    .option("-n, --limit <n>", "maximum workflows to return", "100")
    .option("--json", "emit JSON")
    .action(
      async (options: { project?: string; limit: string; json?: boolean }) => {
        const limit = positiveLimit(options.limit)
        const ctx = context()
        const params: Record<string, string> = { orderBy: "name" }
        if (options.project)
          params["projectId"] = (
            await getProject(ctx.client, options.project)
          ).id
        const { workflows } = await searchWorkflows(ctx.client, params, limit)

        if (options.json) {
          printJson(workflows)
          warnIfTruncated(workflows.length, limit, { exitCode: true })
          return
        }
        if (workflows.length === 0) {
          process.stderr.write("no workflows match\n")
          return
        }
        process.stdout.write(
          `${table(workflows, [
            { header: "NAME", value: (w) => w.name },
            { header: "SCOPE", value: (w) => w.scope?.type ?? "—" },
            {
              header: "STATUSES",
              value: (w) => String(w.statuses?.length ?? 0),
              align: "right",
            },
            {
              header: "DESCRIPTION",
              value: (w) => truncate(w.description ?? "", 60),
            },
          ])}\n`,
        )
        warnIfTruncated(workflows.length, limit, { exitCode: false })
      },
    )

  workflow
    .command("get <name>")
    .description("show a workflow's statuses, transitions and conditions")
    .option("--json", "emit JSON")
    .action(async (name: string, options: { json?: boolean }) => {
      const ctx = context()
      // queryString is a partial, case-insensitive match, so the exact name
      // is picked out here; "Bug" must not answer with "Bug triage".
      const { workflows, statuses } = await searchWorkflows(
        ctx.client,
        { queryString: name, expand: "values.transitions" },
        Number.POSITIVE_INFINITY,
      )
      const found =
        workflows.find((w) => w.name === name) ??
        workflows.find((w) => w.name.toLowerCase() === name.toLowerCase())
      if (!found) {
        const near = workflows.map((w) => `  ${w.name}`).join("\n")
        throw exitError(
          1,
          `no workflow named '${name}'${near ? `\ndid you mean:\n${near}` : ""}`,
        )
      }
      if (options.json)
        return printJson({ ...found, statuses: statusesOf(found, statuses) })
      process.stdout.write(`${describeWorkflow(found, statuses)}\n`)
    })

  workflow
    .command("for <issue-type>")
    .description("which workflow an issue type uses in a project")
    .requiredOption("-p, --project <key>", "the project")
    .option("--json", "emit JSON")
    .action(
      async (
        issueTypeArg: string,
        options: { project: string; json?: boolean },
      ) => {
        const ctx = context()
        const project = await getProject(ctx.client, options.project)
        const issueType = findIssueType(project, issueTypeArg)

        const scheme = await readScheme(ctx.client, project.id)
        let name = scheme
          ? workflowNameFromScheme(scheme, issueType.id)
          : undefined
        if (!name) {
          const read = await ctx.client.request<{ workflows?: Workflow[] }>(
            "/rest/api/3/workflows",
            {
              method: "POST",
              body: JSON.stringify({
                projectAndIssueTypes: [
                  { projectId: project.id, issueTypeId: issueType.id },
                ],
              }),
            },
          )
          name = read?.workflows?.[0]?.name
        }
        if (!name)
          throw exitError(
            1,
            `Jira returned no workflow for ${issueType.name} in ${project.key}`,
          )

        const result = {
          project: project.key,
          issueType: issueType.name,
          workflow: name,
          ...(scheme?.name ? { scheme: scheme.name } : {}),
        }
        if (options.json) return printJson(result)
        process.stdout.write(
          `${name}\n${ctx.out.dim(
            `${issueType.name} in ${project.key}${scheme?.name ? ` · scheme: ${scheme.name}` : ""}`,
          )}\n`,
        )
      },
    )
}
