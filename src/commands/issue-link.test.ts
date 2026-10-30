import { Command } from "commander"
import type { JiraClient, JiraIssue } from "@kud/jira"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { palette } from "../output/format.js"
import { registerIssueWriteCommands } from "./issue-write.js"

/**
 * The commands are exercised in-process on a real commander tree with the
 * context module mocked so `context()` hands back a fake client — the same
 * cut between CLI and API layer the design uses for testing.
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

let client: {
  getIssue: ReturnType<typeof vi.fn>
  linkIssues: ReturnType<typeof vi.fn>
}

const issue = (issuelinks: unknown): JiraIssue =>
  ({
    id: "10001",
    key: "ABC-1",
    self: "https://example.atlassian.net/rest/api/3/issue/10001",
    fields: {
      summary: "A sample issue",
      status: { name: "In Progress" },
      issuelinks,
      description: undefined,
    },
  }) as unknown as JiraIssue

const stdoutWrite = vi.spyOn(process.stdout, "write")
const stderrWrite = vi.spyOn(process.stderr, "write")

beforeEach(() => {
  client = { getIssue: vi.fn(), linkIssues: vi.fn() }
  stdoutWrite.mockClear().mockReturnValue(true)
  stderrWrite.mockClear().mockReturnValue(true)
})

const parse = (args: string[]): Promise<unknown> => {
  const program = new Command()
  registerIssueWriteCommands(program.command("issue"))
  return program.parseAsync(["node", "jira", ...args])
}

describe("issue link", () => {
  it("confirms the link on stderr, in the remotelink add style", async () => {
    await expect(
      parse(["issue", "link", "ABC-1", "Relates", "ABC-2"]),
    ).resolves.not.toThrow()

    expect(client.linkIssues).toHaveBeenCalledWith("Relates", "ABC-1", "ABC-2")
    expect(stderrWrite).toHaveBeenCalledOnce()
    expect(String(stderrWrite.mock.calls[0]?.[0])).toBe(
      "linked ABC-1 Relates ABC-2\n",
    )
    expect(stdoutWrite).not.toHaveBeenCalled()
  })

  it("parses both forms: the three-argument link and `link list <key>`", async () => {
    client.getIssue.mockResolvedValue(issue([]))

    await parse(["issue", "link", "ABC-1", "Relates", "ABC-2"])
    expect(client.linkIssues).toHaveBeenCalledTimes(1)

    await parse(["issue", "link", "list", "ABC-1"])
    expect(client.getIssue).toHaveBeenCalledWith("ABC-1")
    expect(client.linkIssues).toHaveBeenCalledTimes(1)
  })

  it("describes the links on an issue as a table", async () => {
    client.getIssue.mockResolvedValue(
      issue([
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
        {
          id: "11",
          type: {
            id: "10001",
            name: "Blocks",
            inward: "is blocked by",
            outward: "blocks",
          },
          inwardIssue: {
            key: "ABC-3",
            fields: { summary: "A blocking issue", status: { name: "Done" } },
          },
        },
      ]),
    )

    await parse(["issue", "link", "list", "ABC-1"])

    expect(stdoutWrite).toHaveBeenCalledOnce()
    const out = String(stdoutWrite.mock.calls[0]?.[0])
    // Flat rows, two-space columns, `awk '{print $1}'`-safe, like remotelink.
    expect(out.trim().split("\n")).toEqual([
      "DIR      TYPE           KEY    STATUS  SUMMARY",
      "outward  relates to     ABC-2  To Do   A related issue",
      "inward   is blocked by  ABC-3  Done    A blocking issue",
    ])
  })

  it("emits the flattened links with --json", async () => {
    client.getIssue.mockResolvedValue(
      issue([
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
      ]),
    )

    await parse(["issue", "link", "list", "ABC-1", "--json"])

    expect(JSON.parse(String(stdoutWrite.mock.calls[0]?.[0]))).toEqual([
      {
        direction: "outward",
        type: "relates to",
        key: "ABC-2",
        summary: "A related issue",
        status: "To Do",
      },
    ])
  })

  it("says so on stderr rather than printing an empty table", async () => {
    client.getIssue.mockResolvedValue(issue([]))

    await parse(["issue", "link", "list", "ABC-1"])

    expect(stderrWrite).toHaveBeenCalledOnce()
    expect(String(stderrWrite.mock.calls[0]?.[0])).toBe(
      "ABC-1 has no links\n",
    )
    expect(stdoutWrite).not.toHaveBeenCalled()
  })
})
