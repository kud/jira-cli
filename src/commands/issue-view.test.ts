import { Command } from "commander"
import type { JiraClient, JiraIssue } from "@kud/jira"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { palette } from "../output/format.js"
import { registerIssueCommands } from "./issue.js"

/**
 * In-process on a real commander tree, with the context module mocked so
 * `context()` hands back a fake client — the CLI/API seam the design keeps
 * testable.
 */
vi.mock("./context.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./context.js")>()
  return {
    ...actual,
    context: () => ({
      client: client as unknown as JiraClient,
      config: {
        baseUrl: "https://example.atlassian.net",
        email: "user@example.com",
        token: "unused",
        customFields: [],
      },
      out: palette(false),
    }),
  }
})

let client: { getIssue: ReturnType<typeof vi.fn>; customFields: unknown }

const issue = (fields: Record<string, unknown>): JiraIssue =>
  ({
    id: "10001",
    key: "ABC-1",
    self: "https://example.atlassian.net/rest/api/3/issue/10001",
    fields,
  }) as unknown as JiraIssue

const stdoutWrite = vi.spyOn(process.stdout, "write")

beforeEach(() => {
  client = { getIssue: vi.fn(), customFields: [] }
  stdoutWrite.mockClear().mockReturnValue(true)
})

const parse = (args: string[]): Promise<unknown> => {
  const program = new Command()
  registerIssueCommands(program)
  return program.parseAsync(["node", "jira", ...args])
}

describe("issue view --json", () => {
  it("includes flattened issuelinks and shape-reduced subtasks", async () => {
    client.getIssue.mockResolvedValue(
      issue({
        summary: "A sample issue",
        status: { name: "In Progress" },
        issuelinks: [
          {
            id: "10",
            type: {
              id: "10000",
              name: "Relates",
              inward: "relates to",
              outward: "relates to",
            },
            outwardIssue: {
              key: "ABC-2",
              fields: {
                summary: "A related issue",
                status: { name: "To Do" },
              },
            },
          },
        ],
        subtasks: [
          {
            key: "ABC-3",
            fields: { summary: "A subtask", status: { name: "To Do" } },
          },
        ],
      }),
    )

    await parse(["issue", "view", "ABC-1", "--json"])

    const parsed = JSON.parse(String(stdoutWrite.mock.calls[0]?.[0]))
    expect(parsed.fields.issuelinks).toEqual([
      {
        direction: "outward",
        type: "relates to",
        key: "ABC-2",
        summary: "A related issue",
        status: "To Do",
      },
    ])
    expect(parsed.fields.subtasks).toEqual([
      { key: "ABC-3", summary: "A subtask", status: "To Do" },
    ])
  })
})

describe("issue view text", () => {
  const withLinksAndSubtasks = issue({
    summary: "A sample issue",
    status: { name: "In Progress" },
    issuelinks: [
      {
        id: "10",
        type: {
          id: "10000",
          name: "Relates",
          inward: "relates to",
          outward: "relates to",
        },
        outwardIssue: {
          key: "ABC-2",
          fields: { summary: "A related issue", status: { name: "To Do" } },
        },
      },
    ],
    subtasks: [
      {
        key: "ABC-3",
        fields: { summary: "A subtask", status: { name: "To Do" } },
      },
    ],
  })

  it("shows links and subtasks in the section style", async () => {
    client.getIssue.mockResolvedValue(withLinksAndSubtasks)

    await parse(["issue", "view", "ABC-1"])

    const out = String(stdoutWrite.mock.calls[0]?.[0])
    expect(out).toContain("─── links ───")
    expect(out).toContain("outward relates to   ABC-2  To Do        A related issue")
    expect(out).toContain("─── subtasks ───")
    expect(out).toContain("ABC-3  To Do        A subtask")
  })

  it("omits each section when empty", async () => {
    client.getIssue.mockResolvedValue(
      issue({ summary: "A sample issue", status: { name: "In Progress" } }),
    )

    await parse(["issue", "view", "ABC-1"])

    const out = String(stdoutWrite.mock.calls[0]?.[0])
    expect(out).not.toContain("─── links ───")
    expect(out).not.toContain("─── subtasks ───")
  })
})

describe("issue view --fields", () => {
  const rich = issue({
    summary: "A sample issue",
    status: { name: "In Progress" },
    issuetype: { name: "Task" },
    assignee: { displayName: "Ada Lovelace" },
    reporter: { displayName: "Grace Hopper" },
    parent: { key: "ABC-9", fields: { summary: "A parent issue" } },
    labels: ["first pass"],
    issuelinks: [
      {
        id: "10",
        type: {
          id: "10000",
          name: "Relates",
          inward: "relates to",
          outward: "relates to",
        },
        outwardIssue: {
          key: "ABC-2",
          fields: { summary: "A related issue", status: { name: "To Do" } },
        },
      },
    ],
    subtasks: [
      {
        key: "ABC-3",
        fields: { summary: "A subtask", status: { name: "To Do" } },
      },
    ],
  })

  it("keeps only the requested lines in the text output", async () => {
    client.getIssue.mockResolvedValue(rich)

    await parse(["issue", "view", "ABC-1", "--fields", "status,assignee"])

    const out = String(stdoutWrite.mock.calls[0]?.[0])
    expect(out).toContain("status    In Progress")
    expect(out).toContain("assignee  Ada Lovelace")
    expect(out).not.toContain("─── links ───")
    expect(out).not.toContain("─── subtasks ───")
    expect(out).not.toContain("parent")
    expect(out).not.toContain("reporter")
    expect(out).not.toContain("url")
  })

  it("keeps a links section when issuelinks is requested", async () => {
    client.getIssue.mockResolvedValue(rich)

    await parse(["issue", "view", "ABC-1", "--fields", "issuelinks"])

    const out = String(stdoutWrite.mock.calls[0]?.[0])
    expect(out).toContain("─── links ───")
    expect(out).toContain("ABC-2")
    expect(out).not.toContain("─── subtasks ───")
    expect(out).not.toContain("In Progress")
  })

  it("keeps only the requested keys in the JSON output", async () => {
    client.getIssue.mockResolvedValue(rich)

    await parse(["issue", "view", "ABC-1", "--json", "--fields", "status,parent"])

    const parsed = JSON.parse(String(stdoutWrite.mock.calls[0]?.[0]))
    expect(Object.keys(parsed.fields)).toEqual(["status", "parent"])
    expect(parsed.fields.status).toEqual({ name: "In Progress" })
    expect(parsed.fields.parent.key).toBe("ABC-9")
  })

  it("still flattens issuelinks in JSON when requested", async () => {
    client.getIssue.mockResolvedValue(rich)

    await parse(["issue", "view", "ABC-1", "--json", "--fields", "issuelinks"])

    const parsed = JSON.parse(String(stdoutWrite.mock.calls[0]?.[0]))
    expect(Object.keys(parsed.fields)).toEqual(["issuelinks"])
    expect(parsed.fields).toEqual({
      issuelinks: [
        {
          direction: "outward",
          type: "relates to",
          key: "ABC-2",
          summary: "A related issue",
          status: "To Do",
        },
      ],
    })
  })
})
