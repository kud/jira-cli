import { Command } from "commander"
import { jiraApiError, type JiraClient } from "@kud/jira"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { palette } from "../output/format.js"
import { isExitError } from "./context.js"
import {
  describeWorkflow,
  findIssueType,
  registerWorkflowCommands,
  transitionPath,
  workflowNameFromScheme,
  type Workflow,
  type WorkflowStatus,
} from "./workflow.js"

vi.mock("./context.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./context.js")>()
  return {
    ...actual,
    context: () => ({
      client: client as unknown as JiraClient,
      config: {
        baseUrl: "https://acme.atlassian.net",
        email: "ada@example.com",
        token: "unused",
        customFields: [],
      },
      out: palette(false),
    }),
  }
})

let client: { request: ReturnType<typeof vi.fn> }

const stdoutWrite = vi.spyOn(process.stdout, "write")
const stderrWrite = vi.spyOn(process.stderr, "write")
const stdout = () => stdoutWrite.mock.calls.map((c) => c[0]).join("")

const PROJECT = {
  id: "10001",
  key: "SHOP",
  issueTypes: [
    { id: "10004", name: "Bug" },
    { id: "10002", name: "Task" },
  ],
}

const STATUSES: WorkflowStatus[] = [
  { id: "1", name: "To Do", statusCategory: "TODO", statusReference: "1" },
  {
    id: "3",
    name: "In Progress",
    statusCategory: "IN_PROGRESS",
    statusReference: "3",
  },
  { id: "10", name: "Done", statusCategory: "DONE", statusReference: "10" },
]

const BUG_FLOW: Workflow = {
  id: "b9ff2384-d3b6-4d4e-9509-3ee19f607168",
  name: "SHOP: Bug workflow",
  description: "How bugs move",
  scope: { type: "GLOBAL" },
  statuses: [
    { statusReference: "1" },
    { statusReference: "3" },
    { statusReference: "10" },
  ],
  transitions: [
    {
      id: "1",
      name: "Create",
      type: "INITIAL",
      toStatusReference: "1",
      links: [],
    },
    {
      id: "11",
      name: "Start work",
      type: "DIRECTED",
      toStatusReference: "3",
      links: [{ fromStatusReference: "1" }],
      conditions: {
        operation: "ALL",
        conditions: [
          {
            ruleKey: "system:restrict-issue-transition",
            parameters: { accountIds: "", roleIds: "10002" },
          },
        ],
        conditionGroups: [
          {
            operation: "ANY",
            conditions: [
              {
                ruleKey: "system:check-field-value",
                parameters: { fieldId: "assignee" },
              },
            ],
          },
        ],
      },
      validators: [
        {
          ruleKey: "system:validate-field-value",
          parameters: { fieldIds: "resolution" },
        },
      ],
    },
    {
      id: "21",
      name: "Done",
      type: "GLOBAL",
      toStatusReference: "10",
      links: [],
    },
  ],
}

const byRef = new Map(STATUSES.map((s) => [s.statusReference, s]))

beforeEach(() => {
  client = { request: vi.fn() }
  stdoutWrite.mockClear().mockReturnValue(true)
  stderrWrite.mockClear().mockReturnValue(true)
})

afterEach(() => {
  process.exitCode = undefined
})

const parse = (args: string[]): Promise<unknown> => {
  const program = new Command()
  program.exitOverride()
  registerWorkflowCommands(program)
  return program.parseAsync(["node", "jira", "workflow", ...args])
}

describe("transitionPath", () => {
  it("names the from and to statuses of a directed transition", () => {
    expect(transitionPath(BUG_FLOW.transitions![1]!, byRef)).toBe(
      "To Do → In Progress",
    )
  })

  it("shows a global transition as reachable from any status", () => {
    expect(transitionPath(BUG_FLOW.transitions![2]!, byRef)).toBe(
      "(any) → Done",
    )
  })

  it("shows the initial transition as the create step", () => {
    expect(transitionPath(BUG_FLOW.transitions![0]!, byRef)).toBe(
      "(create) → To Do",
    )
  })
})

describe("describeWorkflow", () => {
  it("prints statuses, transitions, nested conditions and validators as text", () => {
    const text = describeWorkflow(BUG_FLOW, byRef)
    expect(text).toContain("SHOP: Bug workflow")
    expect(text).toContain("  In Progress  [IN_PROGRESS]")
    expect(text).toContain("  Start work  To Do → In Progress")
    expect(text).toContain("      all of:")
    // Empty parameters are noise in a terminal, so they are left out.
    expect(text).toContain(
      "        - system:restrict-issue-transition (roleIds=10002)",
    )
    expect(text).toContain("        any of:")
    expect(text).toContain(
      "          - system:check-field-value (fieldId=assignee)",
    )
    expect(text).toContain(
      "      - system:validate-field-value (fieldIds=resolution)",
    )
  })
})

describe("findIssueType", () => {
  it("matches a name regardless of case", () => {
    expect(findIssueType(PROJECT, "bug").id).toBe("10004")
  })

  it("matches an ID", () => {
    expect(findIssueType(PROJECT, "10002").name).toBe("Task")
  })

  it("lists what the project has when nothing matches", () => {
    expect(() => findIssueType(PROJECT, "Epic")).toThrow(/it has: Bug, Task/)
  })
})

describe("workflowNameFromScheme", () => {
  const scheme = {
    name: "SHOP scheme",
    defaultWorkflow: { name: "jira" },
    workflowsForIssueTypes: [
      { issueTypeIds: ["10004"], workflow: { name: "SHOP: Bug workflow" } },
    ],
  }

  it("uses the issue type's own mapping", () => {
    expect(workflowNameFromScheme(scheme, "10004")).toBe("SHOP: Bug workflow")
  })

  it("falls back to the scheme's default", () => {
    expect(workflowNameFromScheme(scheme, "10002")).toBe("jira")
  })
})

describe("jira workflow list", () => {
  it("filters by the project's ID and pages until isLast", async () => {
    let page = 0
    client.request.mockImplementation(async (path: string) => {
      if (path === "/rest/api/3/project/SHOP") return PROJECT
      page += 1
      return page === 1
        ? { values: [BUG_FLOW], statuses: STATUSES, isLast: false }
        : {
            values: [{ ...BUG_FLOW, id: "2", name: "SHOP: Task workflow" }],
            isLast: true,
          }
    })

    await parse(["list", "--project", "SHOP"])

    const searches = client.request.mock.calls
      .map((c) => c[0] as string)
      .filter((p) => p.startsWith("/rest/api/3/workflows/search"))
    expect(searches).toHaveLength(2)
    const first = new URL(searches[0]!, "https://acme.atlassian.net")
      .searchParams
    expect(first.get("projectId")).toBe("10001")
    expect(
      new URL(searches[1]!, "https://acme.atlassian.net").searchParams.get(
        "startAt",
      ),
    ).toBe("1")
    expect(stdout()).toMatch(/SHOP: Bug workflow\s+GLOBAL\s+3\s+How bugs move/)
    expect(stdout()).toMatch(/SHOP: Task workflow/)
  })
})

describe("jira workflow get", () => {
  it("picks the exact name out of a partial match and expands transitions", async () => {
    client.request.mockResolvedValue({
      values: [{ ...BUG_FLOW, name: "SHOP: Bug workflow (old)" }, BUG_FLOW],
      statuses: STATUSES,
      isLast: true,
    })

    await parse(["get", "SHOP: Bug workflow"])

    const params = new URL(
      client.request.mock.calls[0]![0] as string,
      "https://acme.atlassian.net",
    ).searchParams
    expect(params.get("queryString")).toBe("SHOP: Bug workflow")
    expect(params.get("expand")).toBe("values.transitions")
    expect(stdout()).toMatch(/^SHOP: Bug workflow\n/)
  })

  it("--json carries the statuses the workflow uses", async () => {
    client.request.mockResolvedValue({
      values: [BUG_FLOW],
      statuses: STATUSES,
      isLast: true,
    })

    await parse(["get", "shop: bug workflow", "--json"])

    const json = JSON.parse(stdout())
    expect(json.name).toBe("SHOP: Bug workflow")
    expect(json.statuses.map((s: WorkflowStatus) => s.name)).toEqual([
      "To Do",
      "In Progress",
      "Done",
    ])
  })

  it("offers the near matches when no name is exact", async () => {
    client.request.mockResolvedValue({
      values: [BUG_FLOW],
      statuses: STATUSES,
      isLast: true,
    })

    const error = await parse(["get", "SHOP"]).catch((e: unknown) => e)
    expect(isExitError(error) && error.code).toBe(1)
    expect((error as Error).message).toMatch(
      /did you mean:\n {2}SHOP: Bug workflow/,
    )
  })
})

describe("jira workflow for", () => {
  it("reads the workflow from the project's scheme when it can", async () => {
    client.request.mockImplementation(async (path: string) => {
      if (path === "/rest/api/3/project/SHOP") return PROJECT
      if (path === "/rest/api/3/workflowscheme/read")
        return [
          {
            name: "SHOP scheme",
            defaultWorkflow: { name: "jira" },
            workflowsForIssueTypes: [
              {
                issueTypeIds: ["10004"],
                workflow: { name: "SHOP: Bug workflow" },
              },
            ],
          },
        ]
      throw new Error(`unexpected ${path}`)
    })

    await parse(["for", "Bug", "--project", "SHOP", "--json"])

    expect(JSON.parse(stdout())).toEqual({
      project: "SHOP",
      issueType: "Bug",
      workflow: "SHOP: Bug workflow",
      scheme: "SHOP scheme",
    })
  })

  it("falls back to bulk get by project and issue type when the scheme needs Administer Jira", async () => {
    client.request.mockImplementation(
      async (path: string, init?: RequestInit) => {
        if (path === "/rest/api/3/project/SHOP") return PROJECT
        if (path === "/rest/api/3/workflowscheme/read")
          throw jiraApiError(403, "POST", path, "")
        if (path === "/rest/api/3/workflows") {
          expect(JSON.parse(init?.body as string)).toEqual({
            projectAndIssueTypes: [
              { projectId: "10001", issueTypeId: "10004" },
            ],
          })
          return { workflows: [BUG_FLOW], statuses: STATUSES }
        }
        throw new Error(`unexpected ${path}`)
      },
    )

    await parse(["for", "bug", "--project", "SHOP"])

    expect(stdout()).toBe("SHOP: Bug workflow\nBug in SHOP\n")
  })

  it("lets any other scheme failure through", async () => {
    client.request.mockImplementation(async (path: string) => {
      if (path === "/rest/api/3/project/SHOP") return PROJECT
      throw jiraApiError(500, "POST", path, "")
    })

    const error = await parse(["for", "Bug", "--project", "SHOP"]).catch(
      (e: unknown) => e,
    )
    expect((error as { status?: number }).status).toBe(500)
  })
})
