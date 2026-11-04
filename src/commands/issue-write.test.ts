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

describe("rankPosition with --top", () => {
  it("refuses --top without --jql", () => {
    let error: unknown
    try {
      rankPosition({ top: true })
    } catch (e) {
      error = e
    }
    expect(isExitError(error)).toBe(true)
    expect((error as { code: number }).code).toBe(1)
    expect((error as Error).message).toMatch(/--top requires --jql/)
  })

  it("refuses --top with --before", () => {
    let error: unknown
    try {
      rankPosition({ top: true, jql: "project = ABC", before: "ABC-1" })
    } catch (e) {
      error = e
    }
    expect(isExitError(error)).toBe(true)
    expect((error as { code: number }).code).toBe(1)
    expect((error as Error).message).toMatch(/mutually exclusive with --before and --after/)
  })

  it("refuses --top with --after", () => {
    let error: unknown
    try {
      rankPosition({ top: true, jql: "project = ABC", after: "ABC-1" })
    } catch (e) {
      error = e
    }
    expect(isExitError(error)).toBe(true)
    expect((error as { code: number }).code).toBe(1)
    expect((error as Error).message).toMatch(/mutually exclusive with --before and --after/)
  })

  it("accepts --top with --jql", () => {
    expect(rankPosition({ top: true, jql: "project = ABC" })).toEqual({
      top: true,
      jql: "project = ABC",
    })
  })
})

describe("issue rank --top --jql", () => {
  const searchIssues = vi.fn()
  const rankIssues = vi.fn()

  beforeEach(() => {
    client.searchIssues = searchIssues
    client.rankIssues = rankIssues
    searchIssues.mockReset()
    rankIssues.mockReset()
  })

  it("refuses --top without --jql", async () => {
    await expect(
      parse(["issue", "rank", "ABC-1", "--top"]),
    ).rejects.toMatchObject({
      name: "ExitError",
      code: 1,
      message: expect.stringMatching(/--top requires --jql/),
    })
  })

  it("refuses --jql without --top", async () => {
    await expect(
      parse(["issue", "rank", "ABC-1", "--jql", "project = ABC"]),
    ).rejects.toMatchObject({
      name: "ExitError",
      code: 1,
      message: expect.stringMatching(/--jql needs --top/),
    })
  })

  it("refuses --top with --before", async () => {
    await expect(
      parse(["issue", "rank", "ABC-1", "--top", "--jql", "project = ABC", "--before", "ABC-2"]),
    ).rejects.toMatchObject({
      name: "ExitError",
      code: 1,
      message: expect.stringMatching(/mutually exclusive with --before and --after/),
    })
  })

  it("refuses --top with --after", async () => {
    await expect(
      parse(["issue", "rank", "ABC-1", "--top", "--jql", "project = ABC", "--after", "ABC-2"]),
    ).rejects.toMatchObject({
      name: "ExitError",
      code: 1,
      message: expect.stringMatching(/mutually exclusive with --before and --after/),
    })
  })

  it("refuses JQL with ORDER BY other than Rank ASC", async () => {
    searchIssues.mockResolvedValue([{ key: "ABC-2" }])

    await expect(
      parse(["issue", "rank", "ABC-1", "--top", "--jql", "project = ABC ORDER BY created DESC"]),
    ).rejects.toMatchObject({
      name: "ExitError",
      code: 1,
      message: expect.stringMatching(
        /foreign ORDER BY is not supported with --top: 'created DESC'\. Remove it, or use ORDER BY Rank ASC/,
      ),
    })
  })

  it("exits 1 when JQL returns no issues", async () => {
    searchIssues.mockResolvedValue([])

    await expect(
      parse(["issue", "rank", "ABC-1", "--top", "--jql", "project = ABC"]),
    ).rejects.toMatchObject({
      name: "ExitError",
      code: 1,
      message: expect.stringMatching(/no issues match/),
    })
  })

  it("does nothing when keys already occupy the top in order", async () => {
    searchIssues.mockResolvedValue([{ key: "ABC-1" }, { key: "ABC-2" }, { key: "ABC-3" }])

    await parse(["issue", "rank", "ABC-1", "ABC-2", "--top", "--jql", "project = ABC"])

    expect(rankIssues).not.toHaveBeenCalled()
    const notes = stderrWrite.mock.calls.map((c) => String(c[0]))
    expect(notes.join("")).toContain("already at the top in order")
  })

  it("says so without a rank call when the scope is only the keys", async () => {
    searchIssues.mockResolvedValue([{ key: "ABC-1" }])

    await parse(["issue", "rank", "ABC-1", "--top", "--jql", "project = ABC"])

    expect(rankIssues).not.toHaveBeenCalled()
    expect(stderrWrite.mock.calls.map((c) => String(c[0])).join("")).toContain(
      "already at the top in order",
    )
  })

  it("accepts a bare ORDER BY Rank without appending a second clause", async () => {
    searchIssues.mockResolvedValue([{ key: "ABC-2" }, { key: "ABC-1" }])

    await parse(["issue", "rank", "ABC-1", "--top", "--jql", "project = ABC ORDER BY Rank"])

    expect(searchIssues).toHaveBeenCalledWith(
      "project = ABC ORDER BY Rank",
      { limit: 2 },
    )
    expect(rankIssues).toHaveBeenCalledWith(["ABC-1"], { before: "ABC-2" })
  })

  it("refuses ORDER BY Rank DESC", async () => {
    await expect(
      parse(["issue", "rank", "ABC-1", "--top", "--jql", "project = ABC ORDER BY Rank DESC"]),
    ).rejects.toMatchObject({
      name: "ExitError",
      code: 1,
      message: expect.stringMatching(/foreign ORDER BY is not supported with --top/),
    })
  })

  it("refuses an ORDER BY split by extra spaces instead of appending", async () => {
    await expect(
      parse(["issue", "rank", "ABC-1", "--top", "--jql", "project = ABC ORDER  BY created"]),
    ).rejects.toMatchObject({
      name: "ExitError",
      code: 1,
      message: expect.stringMatching(/foreign ORDER BY is not supported with --top: 'created'/),
    })
    expect(searchIssues).not.toHaveBeenCalled()
  })

  it("compares keys case-insensitively against the scope", async () => {
    searchIssues.mockResolvedValue([{ key: "ABC-1" }, { key: "ABC-2" }, { key: "ABC-3" }])

    await parse(["issue", "rank", "abc-2", "abc-1", "--top", "--jql", "project = ABC"])

    expect(rankIssues).toHaveBeenCalledWith(["abc-2", "abc-1"], { before: "ABC-3" })
    expect(stderrWrite.mock.calls.map((c) => String(c[0])).join("")).toContain(
      "before ABC-3",
    )
  })

  it("ranks keys before first issue not in keys", async () => {
    searchIssues.mockResolvedValue([{ key: "ABC-3" }, { key: "ABC-1" }, { key: "ABC-2" }])

    await parse(["issue", "rank", "ABC-1", "ABC-2", "--top", "--jql", "project = ABC"])

    expect(rankIssues).toHaveBeenCalledWith(["ABC-1", "ABC-2"], { before: "ABC-3" })
    expect(stderrWrite.mock.calls.map((c) => String(c[0])).join("")).toContain("before ABC-3")
  })

  it("ranks keys already in scope but out of order, against the next issue", async () => {
    searchIssues.mockResolvedValue([{ key: "ABC-2" }, { key: "ABC-1" }, { key: "ABC-3" }])

    await parse(["issue", "rank", "ABC-1", "ABC-2", "--top", "--jql", "project = ABC"])

    expect(rankIssues).toHaveBeenCalledWith(["ABC-1", "ABC-2"], { before: "ABC-3" })
  })

  it("says there is nothing to rank against when the scope is the keys out of order", async () => {
    searchIssues.mockResolvedValue([{ key: "ABC-2" }, { key: "ABC-1" }])

    await parse(["issue", "rank", "ABC-1", "ABC-2", "--top", "--jql", "project = ABC"])

    expect(rankIssues).not.toHaveBeenCalled()
    expect(stderrWrite.mock.calls.map((c) => String(c[0])).join("")).toContain(
      "no issue outside the given keys in the scope to rank against",
    )
    expect(stderrWrite.mock.calls.map((c) => String(c[0])).join("")).not.toContain(
      "already at the top in order",
    )
  })

  it("appends ORDER BY Rank ASC to the search when JQL has none", async () => {
    searchIssues.mockResolvedValue([{ key: "ABC-2" }, { key: "ABC-1" }])

    await parse(["issue", "rank", "ABC-1", "--top", "--jql", "project = ABC"])

    expect(searchIssues).toHaveBeenCalledWith("project = ABC ORDER BY Rank ASC", {
      limit: 2,
    })
  })

  it("accepts JQL already ordered by Rank ASC", async () => {
    searchIssues.mockResolvedValue([{ key: "ABC-2" }, { key: "ABC-1" }])

    await parse(["issue", "rank", "ABC-1", "--top", "--jql", "project = ABC ORDER BY Rank ASC"])

    expect(searchIssues).toHaveBeenCalledWith(
      "project = ABC ORDER BY Rank ASC",
      { limit: 2 },
    )
    expect(rankIssues).toHaveBeenCalledWith(["ABC-1"], { before: "ABC-2" })
  })

  it("never ranks an issue before itself, whichever case the key was typed in", async () => {
    // abc-1 is the same issue as ABC-1 in the scope, so it is already at the
    // top and gets the no-op message instead of becoming its own anchor.
    searchIssues.mockResolvedValue([{ key: "ABC-1" }, { key: "ABC-2" }])

    await parse(["issue", "rank", "abc-1", "--top", "--jql", "project = ABC"])

    expect(rankIssues).not.toHaveBeenCalled()
    expect(stderrWrite.mock.calls.map((c) => String(c[0])).join("")).toContain(
      "already at the top in order",
    )
  })
})

describe("issue edit --prepend-description and --append-description", () => {
  const getIssue = vi.fn()
  const updateIssue = vi.fn()

  beforeEach(() => {
    client.getIssue = getIssue
    client.updateIssue = updateIssue
    getIssue.mockReset()
    updateIssue.mockReset()
  })

  it("prepends markdown to existing description", async () => {
    getIssue.mockResolvedValue({
      fields: {
        description: {
          type: "doc",
          version: 1,
          content: [{ type: "paragraph", content: [{ type: "text", text: "existing" }] }],
        },
      },
    })

    await parse(["issue", "edit", "ABC-5", "--prepend-description", "new "])

    expect(updateIssue).toHaveBeenCalledWith(
      "ABC-5",
      expect.objectContaining({
        description: expect.objectContaining({
          content: expect.arrayContaining([
            expect.objectContaining({ content: expect.arrayContaining([expect.objectContaining({ text: "new" })]) }),
            expect.objectContaining({ content: expect.arrayContaining([expect.objectContaining({ text: "existing" })]) }),
          ]),
        }),
      }),
    )
  })

  it("appends markdown to existing description", async () => {
    getIssue.mockResolvedValue({
      fields: {
        description: {
          type: "doc",
          version: 1,
          content: [{ type: "paragraph", content: [{ type: "text", text: "existing" }] }],
        },
      },
    })

    await parse(["issue", "edit", "ABC-5", "--append-description", " appended"])

    expect(updateIssue).toHaveBeenCalledWith(
      "ABC-5",
      expect.objectContaining({
        description: expect.objectContaining({
          content: expect.arrayContaining([
            expect.objectContaining({ content: expect.arrayContaining([expect.objectContaining({ text: "existing" })]) }),
            expect.objectContaining({ content: expect.arrayContaining([expect.objectContaining({ text: "appended" })]) }),
          ]),
        }),
      }),
    )
  })

  it("both prepend and append together", async () => {
    getIssue.mockResolvedValue({
      fields: {
        description: {
          type: "doc",
          version: 1,
          content: [{ type: "paragraph", content: [{ type: "text", text: "middle" }] }],
        },
      },
    })

    await parse(["issue", "edit", "ABC-5", "--prepend-description", "first ", "--append-description", " last"])

    const call = updateIssue.mock.calls[0][1] as { description: { content: unknown[] } }
    const texts = call.description.content.flatMap((c: unknown) =>
      (c as { content: { text: string }[] }).content?.map((x) => x.text) ?? [],
    )
    expect(texts).toEqual(["first", "middle", "last"])
  })

  it("handles null description as empty", async () => {
    getIssue.mockResolvedValue({ fields: { description: null } })

    await parse(["issue", "edit", "ABC-5", "--prepend-description", "new"])

    expect(updateIssue).toHaveBeenCalledWith(
      "ABC-5",
      expect.objectContaining({
        description: expect.objectContaining({
          content: expect.arrayContaining([
            expect.objectContaining({ content: expect.arrayContaining([expect.objectContaining({ text: "new" })]) }),
          ]),
        }),
      }),
    )
  })

  it("exits 2 when prepend and append both read stdin", async () => {
    // A single invocation would read fd 0 twice, the second read silently
    // empty; request two edits instead.
    await expect(
      parse([
        "issue", "edit", "ABC-5",
        "--prepend-description", "-",
        "--append-description", "-",
      ]),
    ).rejects.toMatchObject({
      name: "ExitError",
      code: 2,
      message: expect.stringMatching(/both read stdin; run two edits instead/),
    })
    expect(getIssue).not.toHaveBeenCalled()
  })

  it("exits 2 when combined with --body", async () => {
    await expect(
      parse(["issue", "edit", "ABC-5", "--body", "new", "--prepend-description", "prepend"]),
    ).rejects.toMatchObject({
      name: "ExitError",
      code: 2,
      message: expect.stringMatching(/mutually exclusive with --body/),
    })
    expect(getIssue).not.toHaveBeenCalled()
  })

  it("does not fetch issue when flags not present", async () => {
    await parse(["issue", "edit", "ABC-5", "--summary", "new summary"])

    expect(getIssue).not.toHaveBeenCalled()
  })
})

describe("issue comment list --last", () => {
  const request = vi.fn()
  const getComments = vi.fn()

  beforeEach(() => {
    client.request = request
    client.getComments = getComments
    request.mockReset()
    getComments.mockReset()
  })

  it("defaults to 1 when --last is bare", async () => {
    request.mockResolvedValue({
      comments: [{ id: "1", author: { displayName: "A" }, created: "2024-01-01T00:00:00.000+0000", body: { type: "doc", version: 1, content: [] } }],
    })

    await parse(["issue", "comment", "list", "ABC-1", "--last"])

    expect(request).toHaveBeenCalledWith(
      "/rest/api/3/issue/ABC-1/comment?orderBy=-created&maxResults=1",
    )
  })

  it("uses specified number", async () => {
    request.mockResolvedValue({
      comments: [
        { id: "1", author: { displayName: "A" }, created: "2024-01-01T00:00:00.000+0000", body: { type: "doc", version: 1, content: [] } },
        { id: "2", author: { displayName: "B" }, created: "2024-01-02T00:00:00.000+0000", body: { type: "doc", version: 1, content: [] } },
      ],
    })

    await parse(["issue", "comment", "list", "ABC-1", "--last", "2"])

    expect(request).toHaveBeenCalledWith(
      "/rest/api/3/issue/ABC-1/comment?orderBy=-created&maxResults=2",
    )
  })

  it("exits 2 for non-positive n", async () => {
    await expect(
      parse(["issue", "comment", "list", "ABC-1", "--last", "0"]),
    ).rejects.toMatchObject({ name: "ExitError", code: 2 })
  })

  it("exits 2 for negative n", async () => {
    await expect(
      parse(["issue", "comment", "list", "ABC-1", "--last", "-1"]),
    ).rejects.toMatchObject({ name: "ExitError", code: 2 })
  })

  it("exits 2 for non-numeric n", async () => {
    await expect(
      parse(["issue", "comment", "list", "ABC-1", "--last", "abc"]),
    ).rejects.toMatchObject({ name: "ExitError", code: 2 })
  })

  it("exits 2 for values Number() would accept but Jira would not", async () => {
    await expect(
      parse(["issue", "comment", "list", "ABC-1", "--last", "1e1"]),
    ).rejects.toMatchObject({
      name: "ExitError",
      code: 2,
      message: expect.stringMatching(/--last requires a positive integer/),
    })

    await expect(
      parse(["issue", "comment", "list", "ABC-1", "--last", "0x10"]),
    ).rejects.toMatchObject({
      name: "ExitError",
      code: 2,
      message: expect.stringMatching(/--last requires a positive integer/),
    })
  })

  it("returns comments oldest-to-newest", async () => {
    request.mockResolvedValue({
      comments: [
        { id: "3", author: { displayName: "C" }, created: "2024-01-03T00:00:00.000+0000", body: { type: "doc", version: 1, content: [] } },
        { id: "2", author: { displayName: "B" }, created: "2024-01-02T00:00:00.000+0000", body: { type: "doc", version: 1, content: [] } },
        { id: "1", author: { displayName: "A" }, created: "2024-01-01T00:00:00.000+0000", body: { type: "doc", version: 1, content: [] } },
      ],
    })

    await parse(["issue", "comment", "list", "ABC-1", "--last", "3"])

    const output = String(stdoutWrite.mock.calls[0]?.[0])
    const firstIdx = output.indexOf("A")
    const lastIdx = output.indexOf("C")
    expect(firstIdx).toBeLessThan(lastIdx)
  })

  it("JSON output is an array", async () => {
    request.mockResolvedValue({
      comments: [
        { id: "1", author: { displayName: "A" }, created: "2024-01-01T00:00:00.000+0000", body: { type: "doc", version: 1, content: [] } },
      ],
    })

    await parse(["issue", "comment", "list", "ABC-1", "--last", "1", "--json"])

    const parsed = JSON.parse(String(stdoutWrite.mock.calls[0]?.[0]))
    expect(Array.isArray(parsed)).toBe(true)
  })

  it("unchanged behaviour without --last", async () => {
    getComments.mockResolvedValue({
      comments: [
        { id: "1", author: { displayName: "A" }, created: "2024-01-01T00:00:00.000+0000", body: { type: "doc", version: 1, content: [] } },
      ],
    })

    await parse(["issue", "comment", "list", "ABC-1"])

    expect(getComments).toHaveBeenCalledWith("ABC-1")
    expect(request).not.toHaveBeenCalled()
  })
})

describe("issue create --status", () => {
  const getTransitions = vi.fn()
  const transitionIssue = vi.fn()
  const getIssue = vi.fn()

  beforeEach(() => {
    client.getTransitions = getTransitions
    client.transitionIssue = transitionIssue
    client.getIssue = getIssue
    getTransitions.mockReset()
    transitionIssue.mockReset()
    getIssue.mockReset()
  })

  it("moves issue to status after creation and links", async () => {
    getTransitions.mockResolvedValue({
      transitions: [{ id: "20", name: "Start Progress", to: { id: "2", name: "In Progress" } }],
    })
    getIssue.mockResolvedValue({
      key: "ABC-1",
      fields: { status: { name: "To Do" } },
    })

    await parse([
      "issue", "create", "-p", "ABC", "-t", "Task", "-s", "First draft",
      "--link", "Relates:ABC-2", "--status", "In Progress",
    ])

    expect(client.createIssue).toHaveBeenCalled()
    expect(client.linkIssues).toHaveBeenCalled()
    expect(getTransitions).toHaveBeenCalledWith("ABC-1")
    expect(transitionIssue).toHaveBeenCalledWith("ABC-1", "20")
    // Key printed before the move is attempted
    expect(String(stdoutWrite.mock.calls[0]?.[0])).toBe("ABC-1\n")
    const notes = stderrWrite.mock.calls.map((c) => String(c[0]))
    expect(notes).toContain("moved ABC-1 to In Progress\n")
  })

  it("skips transition when already in that status (case-insensitive)", async () => {
    getIssue.mockResolvedValue({
      key: "ABC-1",
      fields: { status: { name: "in progress" } },
    })

    await parse([
      "issue", "create", "-p", "ABC", "-t", "Task", "-s", "First draft",
      "--status", "In Progress",
    ])

    expect(getTransitions).not.toHaveBeenCalled()
    expect(transitionIssue).not.toHaveBeenCalled()
    expect(stderrWrite.mock.calls.map((c) => String(c[0])).join("")).toContain(
      "already in 'in progress'",
    )
  })

  it("reports failure with key already printed", async () => {
    getTransitions.mockResolvedValue({
      transitions: [{ id: "20", name: "Start Progress", to: { id: "2", name: "In Progress" } }],
    })
    getIssue.mockResolvedValue({
      key: "ABC-1",
      fields: { status: { name: "To Do" } },
    })
    transitionIssue.mockRejectedValue(new Error("permission denied"))

    await expect(
      parse([
        "issue", "create", "-p", "ABC", "-t", "Task", "-s", "First draft",
        "--status", "In Progress",
      ]),
    ).rejects.toMatchObject({
      name: "ExitError",
      code: 1,
      message: expect.stringMatching(/created ABC-1, but moving it to In Progress failed: permission denied/),
    })

    expect(String(stdoutWrite.mock.calls[0]?.[0])).toBe("ABC-1\n")
  })

  it("uses shared resolveTransition logic (ambiguity refused)", async () => {
    getTransitions.mockResolvedValue({
      transitions: [
        { id: "10", name: "Finish", to: { id: "3", name: "Done" } },
        { id: "20", name: "Done here", to: { id: "3", name: "Done" } },
      ],
    })
    getIssue.mockResolvedValue({
      key: "ABC-1",
      fields: { status: { name: "To Do" } },
    })

    await expect(
      parse([
        "issue", "create", "-p", "ABC", "-t", "Task", "-s", "First draft",
        "--status", "Done",
      ]),
    ).rejects.toMatchObject({
      name: "ExitError",
      code: 1,
      message: expect.stringMatching(/Use a transition name instead/),
    })
  })
})
