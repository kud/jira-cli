import { Command } from "commander"
import type { JiraClient } from "@kud/jira"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { palette } from "../output/format.js"
import { confirmDestructive } from "./confirm.js"
import { isExitError } from "./context.js"
import { rankPosition, registerIssueWriteCommands } from "./issue-write.js"

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

const created = { id: "10001", key: "ABC-1", self: "https://example.atlassian.net/rest/api/3/issue/10001" }

const linkTypes = [
  { id: "10000", name: "Relates", inward: "relates to", outward: "relates to" },
  { id: "10001", name: "Duplicate", inward: "duplicates", outward: "is duplicated by" },
]

let client: Record<string, ReturnType<typeof vi.fn>>

const stdoutWrite = vi.spyOn(process.stdout, "write")
const stderrWrite = vi.spyOn(process.stderr, "write")

beforeEach(() => {
  client = {
    getMe: vi.fn(),
    searchAssignableUsers: vi.fn().mockResolvedValue([]),
    searchUsers: vi.fn().mockResolvedValue([]),
    getIssueLinkTypes: vi.fn().mockResolvedValue({ issueLinkTypes: linkTypes }),
    createIssue: vi.fn().mockResolvedValue(created),
    updateIssue: vi.fn(),
    assignIssue: vi.fn(),
    linkIssues: vi.fn(),
  }
  stdoutWrite.mockClear().mockReturnValue(true)
  stderrWrite.mockClear().mockReturnValue(true)
})

const parse = (args: string[]): Promise<unknown> => {
  const program = new Command()
  registerIssueWriteCommands(program.command("issue"))
  return program.parseAsync(["node", "jira", ...args])
}

describe("rankPosition", () => {
  it("keeps --before as the anchor Jira ranks against", () => {
    expect(rankPosition({ before: "SHOP-2" })).toEqual({ before: "SHOP-2" })
  })

  it("keeps --after as the anchor too", () => {
    expect(rankPosition({ after: "SHOP-2" })).toEqual({ after: "SHOP-2" })
  })

  it("refuses both anchors, since two orders compete", () => {
    let error: unknown
    try {
      rankPosition({ before: "SHOP-1", after: "SHOP-2" })
    } catch (e) {
      error = e
    }
    expect(isExitError(error)).toBe(true)
    expect((error as { code: number }).code).toBe(1)
    expect((error as Error).message).toMatch(/not both/)
  })

  it("refuses neither anchor, since there is nothing to rank against", () => {
    let error: unknown
    try {
      rankPosition({})
    } catch (e) {
      error = e
    }
    expect(isExitError(error)).toBe(true)
    expect((error as { code: number }).code).toBe(1)
    expect((error as Error).message).toMatch(/--before <key> or --after <key>/)
  })
})

describe("issue create --parent", () => {
  it("sends the parent as { key }", async () => {
    await parse([
      "issue", "create", "-p", "ABC", "-t", "Task", "-s", "First draft",
      "--parent", "ABC-2",
    ])

    expect(client.createIssue).toHaveBeenCalledWith(
      expect.objectContaining({ parent: { key: "ABC-2" } }),
    )
  })
})

describe("issue create --link", () => {
  it("links each spec after the issue exists, new issue on the outward side", async () => {
    await parse([
      "issue", "create", "-p", "ABC", "-t", "Task", "-s", "First draft",
      "--link", "Relates:ABC-2", "--link", "duplicate:ABC-3",
    ])

    expect(client.getIssueLinkTypes).toHaveBeenCalled()
    expect(client.createIssue).toHaveBeenCalledWith(
      expect.not.objectContaining({ link: expect.anything() }),
    )
    expect(client.linkIssues).toHaveBeenCalledTimes(2)
    expect(client.linkIssues).toHaveBeenNthCalledWith(1, "Relates", "ABC-1", "ABC-2")
    expect(client.linkIssues).toHaveBeenNthCalledWith(2, "Duplicate", "ABC-1", "ABC-3")
    expect(String(stdoutWrite.mock.calls[0]?.[0])).toBe("ABC-1\n")
    const notes = stderrWrite.mock.calls.map((c) => String(c[0]))
    expect(notes).toContain("linked ABC-1 Relates ABC-2\n")
    expect(notes).toContain("linked ABC-1 Duplicate ABC-3\n")
  })

  it("makes no link-types call, and no link call, on a plain create", async () => {
    await parse(["issue", "create", "-p", "ABC", "-t", "Task", "-s", "First draft"])

    expect(client.getIssueLinkTypes).not.toHaveBeenCalled()
    expect(client.createIssue).toHaveBeenCalledOnce()
    expect(client.linkIssues).not.toHaveBeenCalled()
  })

  it("refuses an unknown type before creating anything", async () => {
    await expect(
      parse([
        "issue", "create", "-p", "ABC", "-t", "Task", "-s", "First draft",
        "--link", "Bonds:ABC-2",
      ]),
    ).rejects.toMatchObject({
      name: "ExitError",
      code: 1,
      message: expect.stringMatching(
        /no link type 'Bonds'\. Valid: Relates, Duplicate/,
      ),
    })

    expect(client.createIssue).not.toHaveBeenCalled()
  })

  it("refuses a value without a key before creating anything", async () => {
    await expect(
      parse([
        "issue", "create", "-p", "ABC", "-t", "Task", "-s", "First draft",
        "--link", "Relates",
      ]),
    ).rejects.toMatchObject({
      name: "ExitError",
      code: 1,
      message: expect.stringMatching(/<type>:<KEY>/),
    })

    expect(client.createIssue).not.toHaveBeenCalled()
  })

  it("reports the new key when creation succeeds but a link fails, and exits non-zero", async () => {
    client.linkIssues.mockRejectedValue(new Error("Jira rejected the link"))

    await expect(
      parse([
        "issue", "create", "-p", "ABC", "-t", "Task", "-s", "First draft",
        "--link", "Relates:ABC-2",
      ]),
    ).rejects.toMatchObject({
      name: "ExitError",
      code: 1,
      message: expect.stringMatching(
        /created ABC-1, but the Relates link to ABC-2 failed: Jira rejected the link/,
      ),
    })

    expect(client.createIssue).toHaveBeenCalled()
    expect(String(stdoutWrite.mock.calls[0]?.[0])).toBe("ABC-1\n")
  })
})

describe("issue assign by name", () => {
  it("searches assignable users for the issue's project and assigns the one match", async () => {
    client.searchAssignableUsers.mockResolvedValue([
      {
        accountId: "acc-1",
        displayName: "Ada Lovelace",
        emailAddress: "ada@example.com",
      },
    ])

    await parse(["issue", "assign", "ABC-1", "ada@example.com"])

    expect(client.searchAssignableUsers).toHaveBeenCalledWith("ada@example.com", "ABC")
    expect(client.searchUsers).not.toHaveBeenCalled()
    expect(client.assignIssue).toHaveBeenCalledWith("ABC-1", "acc-1")
  })

  it("falls back to a global search when the project names nobody assignable", async () => {
    client.searchUsers.mockResolvedValue([
      {
        accountId: "acc-1",
        displayName: "Ada Lovelace",
        emailAddress: "ada@example.com",
      },
    ])

    await parse(["issue", "assign", "ABC-1", "ada@example.com"])

    expect(client.assignIssue).toHaveBeenCalledWith("ABC-1", "acc-1")
  })

  it("prints every match on stderr and assigns nobody when the name is ambiguous", async () => {
    client.searchAssignableUsers.mockResolvedValue([
      {
        accountId: "acc-1",
        displayName: "Ada Lovelace",
        emailAddress: "ada@example.com",
      },
      {
        accountId: "acc-2",
        displayName: "Grace Hopper",
        emailAddress: "grace@example.com",
      },
    ])

    await expect(
      parse(["issue", "assign", "ABC-1", "Ada Lovelace"]),
    ).rejects.toMatchObject({ name: "ExitError", code: 1 })

    expect(client.assignIssue).not.toHaveBeenCalled()
    expect(client.searchUsers).not.toHaveBeenCalled()
    const out = stderrWrite.mock.calls.map((c) => String(c[0])).join("")
    expect(out).toContain("Ada Lovelace  ada@example.com  acc-1\n")
    expect(out).toContain("Grace Hopper  grace@example.com  acc-2\n")
  })

  it("errors without assigning when nobody matches", async () => {
    await expect(
      parse(["issue", "assign", "ABC-1", "nobody@example.com"]),
    ).rejects.toMatchObject({
      name: "ExitError",
      code: 1,
      message: expect.stringMatching(/no user matching 'nobody@example\.com'/),
    })
    expect(client.assignIssue).not.toHaveBeenCalled()
  })

  it("keeps 'me' and 'none' working as today", async () => {
    client.getMe.mockResolvedValue({ accountId: "acc-me" })
    await parse(["issue", "assign", "ABC-1", "me"])
    expect(client.assignIssue).toHaveBeenCalledWith("ABC-1", "acc-me")

    await parse(["issue", "assign", "ABC-1", "none"])
    expect(client.assignIssue).toHaveBeenLastCalledWith("ABC-1", null)
  })
})

describe("issue edit --parent and --assignee", () => {
  it("sets the parent as { key }", async () => {
    await parse(["issue", "edit", "ABC-5", "--parent", "ABC-2"])

    expect(client.updateIssue).toHaveBeenCalledWith(
      "ABC-5",
      expect.objectContaining({ parent: { key: "ABC-2" } }),
    )
  })

  it("clears the parent with --parent none, sending parent: null", async () => {
    await parse(["issue", "edit", "ABC-5", "--parent", "none"])

    expect(client.updateIssue).toHaveBeenCalledWith(
      "ABC-5",
      expect.objectContaining({ parent: null }),
    )
  })

  it("resolves --assignee by name for the issue's project", async () => {
    client.searchAssignableUsers.mockResolvedValue([
      {
        accountId: "acc-1",
        displayName: "Ada Lovelace",
        emailAddress: "ada@example.com",
      },
    ])

    await parse(["issue", "edit", "ABC-5", "--assignee", "Ada"])

    expect(client.searchAssignableUsers).toHaveBeenCalledWith("Ada", "ABC")
    expect(client.updateIssue).toHaveBeenCalledWith(
      "ABC-5",
      expect.objectContaining({ assignee: { accountId: "acc-1" } }),
    )
  })

  it("unassigns with --assignee none", async () => {
    await parse(["issue", "edit", "ABC-5", "--assignee", "none"])

    expect(client.searchAssignableUsers).not.toHaveBeenCalled()
    expect(client.updateIssue).toHaveBeenCalledWith(
      "ABC-5",
      expect.objectContaining({ assignee: null }),
    )
  })
})

describe("confirmDestructive", () => {
  it("proceeds without asking when --yes is passed", async () => {
    await expect(
      confirmDestructive("permanently delete SHOP-1", { yes: true }),
    ).resolves.toBeUndefined()
  })

  it("refuses on a non-TTY without --yes, rather than acting on a guess", async () => {
    // The test runner's stdin is piped — exactly the scripted case the guard
    // exists for — so no mocking is needed to reach the refusal.
    expect(process.stdin.isTTY).toBeUndefined()

    let error: unknown
    try {
      await confirmDestructive("permanently delete SHOP-1", {})
    } catch (e) {
      error = e
    }
    expect(isExitError(error)).toBe(true)
    expect((error as { code: number }).code).toBe(1)
    expect((error as Error).message).toMatch(/--yes/)
  })
})
