import { Command } from "commander"
import { jiraApiError, type JiraClient } from "@kud/jira"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { palette } from "../output/format.js"
import { registerSprintCommands } from "./agile.js"
import { registerIssueCommands } from "./issue.js"
import { pickLink } from "./issue-write.js"
import { registerProjectCommands } from "./project.js"
import { findRole, roleIds } from "./project-roles.js"
import { isoDate } from "./sprint-write.js"
import { registerVersionCommands } from "./version.js"

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

let client: Record<string, ReturnType<typeof vi.fn>>

const stdoutWrite = vi.spyOn(process.stdout, "write")
const stderrWrite = vi.spyOn(process.stderr, "write")
const stdout = () => stdoutWrite.mock.calls.map((c) => String(c[0])).join("")
const stderr = () => stderrWrite.mock.calls.map((c) => String(c[0])).join("")

const forbidden = (path = "/x", method = "POST") =>
  jiraApiError(403, method, path, "")

beforeEach(() => {
  client = {
    request: vi.fn(),
    getIssue: vi.fn(),
    getFields: vi
      .fn()
      .mockResolvedValue([
        {
          id: "customfield_10016",
          name: "Story Points",
          schema: { type: "number" },
        },
      ]),
    searchIssues: vi.fn().mockResolvedValue([]),
    updateIssue: vi.fn(),
    getTransitions: vi.fn(),
    transitionIssue: vi.fn(),
    getSprint: vi.fn(),
    getProjectVersions: vi.fn().mockResolvedValue([]),
    searchAssignableUsers: vi.fn().mockResolvedValue([]),
    searchUsers: vi.fn().mockResolvedValue([]),
  }
  stdoutWrite.mockClear().mockReturnValue(true)
  stderrWrite.mockClear().mockReturnValue(true)
})

const run = (register: (p: Command) => void, args: string[]) => {
  const program = new Command()
  program.exitOverride()
  register(program)
  return program.parseAsync(["node", "jira", ...args])
}

const bodyOf = (call: unknown[]) =>
  JSON.parse((call[1] as RequestInit).body as string)
const callTo = (path: string) =>
  client.request.mock.calls.find((c) => c[0] === path) as unknown[] | undefined

// ── issue link remove ──────────────────────────────────────────────────────

const LINKS = [
  {
    id: "20001",
    type: {
      id: "1",
      name: "Blocks",
      inward: "is blocked by",
      outward: "blocks",
    },
    outwardIssue: { key: "SHOP-2" },
  },
  {
    id: "20002",
    type: {
      id: "2",
      name: "Relates",
      inward: "relates to",
      outward: "relates to",
    },
    outwardIssue: { key: "SHOP-2" },
  },
  {
    id: "20003",
    type: {
      id: "2",
      name: "Relates",
      inward: "relates to",
      outward: "relates to",
    },
    inwardIssue: { key: "SHOP-3" },
  },
] as never[]

describe("pickLink", () => {
  it("takes a link ID as is", () => {
    expect(pickLink(LINKS, "SHOP-1", "20003").id).toBe("20003")
  })

  it("finds the one link to an issue key", () => {
    expect(pickLink(LINKS, "SHOP-1", "shop-3").id).toBe("20003")
  })

  it("needs --type when two links join the same issues", () => {
    expect(() => pickLink(LINKS, "SHOP-1", "SHOP-2")).toThrow(
      /pass --type or the link ID/,
    )
    expect(pickLink(LINKS, "SHOP-1", "SHOP-2", "blocks").id).toBe("20001")
  })

  it("says what links exist when the type is wrong", () => {
    expect(() => pickLink(LINKS, "SHOP-1", "SHOP-3", "Blocks")).toThrow(
      /it has: Relates/,
    )
  })
})

describe("jira issue link remove", () => {
  it("deletes the link by its ID after --yes", async () => {
    client.getIssue.mockResolvedValue({
      key: "SHOP-1",
      fields: { issuelinks: LINKS },
    })

    await run(registerIssueCommands, [
      "issue",
      "link",
      "remove",
      "SHOP-1",
      "SHOP-3",
      "--yes",
    ])

    expect(client.request).toHaveBeenCalledWith("/rest/api/3/issueLink/20003", {
      method: "DELETE",
    })
    expect(stderr()).toContain("removed Relates link SHOP-1 ↔ SHOP-3")
  })

  it("names Link issues on a 403", async () => {
    client.getIssue.mockResolvedValue({
      key: "SHOP-1",
      fields: { issuelinks: LINKS },
    })
    client.request.mockRejectedValue(forbidden())

    await expect(
      run(registerIssueCommands, [
        "issue",
        "link",
        "rm",
        "SHOP-1",
        "20003",
        "--yes",
      ]),
    ).rejects.toMatchObject({
      code: 4,
      message: expect.stringMatching(/Link issues/),
    })
  })
})

// ── issue bulk ─────────────────────────────────────────────────────────────

const MATCHES = [
  { key: "SHOP-1", fields: { summary: "One", status: { name: "To Do" } } },
  { key: "SHOP-2", fields: { summary: "Two", status: { name: "Done" } } },
  {
    key: "SHOP-3",
    fields: { summary: "Three", status: { name: "In Review" } },
  },
]

describe("jira issue bulk edit", () => {
  it("only lists the matches without --yes", async () => {
    client.searchIssues.mockResolvedValue(MATCHES)

    await run(registerIssueCommands, [
      "issue",
      "bulk",
      "edit",
      "--jql",
      "project = SHOP AND labels = triage",
      "--field",
      "Story Points=3",
    ])

    expect(client.searchIssues).toHaveBeenCalledWith(
      "project = SHOP AND labels = triage",
      {
        fields: ["summary", "status"],
        limit: 100,
      },
    )
    expect(client.updateIssue).not.toHaveBeenCalled()
    expect(stdout()).toMatch(/SHOP-1\s+To Do\s+One/)
    expect(stderr()).toMatch(/3 issues would be edited; nothing changed/)
  })

  it("edits each issue with --yes and names each failure", async () => {
    client.searchIssues.mockResolvedValue(MATCHES)
    client.updateIssue.mockImplementation(async (key: string) => {
      if (key === "SHOP-2")
        throw jiraApiError(400, "PUT", "/x", '{"errorMessages":["locked"]}')
    })

    const error = await run(registerIssueCommands, [
      "issue",
      "bulk",
      "edit",
      "-q",
      "project = SHOP",
      "-f",
      "Story Points=3",
      "--yes",
    ]).catch((e: unknown) => e)

    expect(client.updateIssue).toHaveBeenCalledTimes(3)
    expect(client.updateIssue).toHaveBeenCalledWith("SHOP-1", {
      customfield_10016: 3,
    })
    expect(error).toMatchObject({
      code: 1,
      message: expect.stringMatching(/1 of 3 failed:\n {2}SHOP-2: locked/),
    })
  })

  it("exits 4 and names Edit issues when every failure is a 403", async () => {
    client.searchIssues.mockResolvedValue(MATCHES.slice(0, 1))
    client.updateIssue.mockRejectedValue(forbidden("/x", "PUT"))

    await expect(
      run(registerIssueCommands, [
        "issue",
        "bulk",
        "edit",
        "-q",
        "x",
        "-f",
        "Story Points=1",
        "--yes",
      ]),
    ).rejects.toMatchObject({
      code: 4,
      message: expect.stringMatching(/need Edit issues/),
    })
  })

  it("refuses with nothing to set", async () => {
    await expect(
      run(registerIssueCommands, ["issue", "bulk", "edit", "-q", "x"]),
    ).rejects.toThrow(/nothing to set/)
    expect(client.searchIssues).not.toHaveBeenCalled()
  })
})

describe("jira issue bulk transition", () => {
  it("moves each issue, skipping those already there", async () => {
    client.searchIssues.mockResolvedValue(MATCHES)
    client.getTransitions.mockResolvedValue({
      transitions: [{ id: "31", name: "Done", to: { name: "Done" } }],
    })

    await run(registerIssueCommands, [
      "issue",
      "bulk",
      "transition",
      "-q",
      "sprint = 42",
      "--to",
      "Done",
      "--yes",
    ])

    expect(client.transitionIssue.mock.calls.map((c) => c[0])).toEqual([
      "SHOP-1",
      "SHOP-3",
    ])
    expect(stderr()).toContain("SHOP-2 is already in Done")
    expect(stderr()).toContain("2 of 2 done")
  })

  it("lists without --yes", async () => {
    client.searchIssues.mockResolvedValue(MATCHES)
    await run(registerIssueCommands, [
      "issue",
      "bulk",
      "move",
      "-q",
      "x",
      "--to",
      "Done",
    ])
    expect(client.getTransitions).not.toHaveBeenCalled()
    expect(stderr()).toMatch(/would be moved to Done/)
  })
})

// ── sprints ────────────────────────────────────────────────────────────────

const sprintRun = (args: string[]) =>
  run(registerSprintCommands, ["sprint", ...args])

describe("isoDate", () => {
  it("reads a bare date", () => {
    expect(isoDate("2026-12-01", "--end")).toBe("2026-12-01T00:00:00.000Z")
  })

  it("refuses something that is not a date", () => {
    expect(() => isoDate("soon", "--end")).toThrow(/not a date/)
  })
})

describe("jira sprint create", () => {
  it("posts the board, name, goal and dates", async () => {
    client.request.mockResolvedValue({
      id: 7,
      name: "SHOP Sprint 12",
      state: "future",
    })

    await sprintRun([
      "create",
      "42",
      "--name",
      "SHOP Sprint 12",
      "--goal",
      "Checkout",
      "--end",
      "2026-12-14",
    ])

    const [path, init] = client.request.mock.calls[0] as [string, RequestInit]
    expect(path).toBe("/rest/agile/1.0/sprint")
    expect(JSON.parse(init.body as string)).toEqual({
      name: "SHOP Sprint 12",
      originBoardId: 42,
      goal: "Checkout",
      endDate: "2026-12-14T00:00:00.000Z",
    })
    expect(stdout()).toBe("7  SHOP Sprint 12  future\n")
  })

  it("names Manage sprints on a 403, not board admin", async () => {
    client.request.mockRejectedValue(forbidden())
    await expect(
      sprintRun(["create", "42", "--name", "S"]),
    ).rejects.toMatchObject({
      code: 4,
      message: expect.stringMatching(
        /Manage sprints[\s\S]*Board admin does not include it/,
      ),
    })
  })
})

describe("jira sprint start", () => {
  it("starts a future sprint, defaulting the start to now", async () => {
    client.getSprint.mockResolvedValue({ id: 7, name: "S", state: "future" })
    client.request.mockResolvedValue({ id: 7, name: "S", state: "active" })

    await sprintRun(["start", "7", "--end", "2026-12-14"])

    const body = bodyOf(callTo("/rest/agile/1.0/sprint/7")!)
    expect(body.state).toBe("active")
    expect(body.endDate).toBe("2026-12-14T00:00:00.000Z")
    expect(typeof body.startDate).toBe("string")
  })

  it("asks for an end date rather than inventing one", async () => {
    client.getSprint.mockResolvedValue({ id: 7, name: "S", state: "future" })
    await expect(sprintRun(["start", "7"])).rejects.toThrow(/pass --end/)
    expect(client.request).not.toHaveBeenCalled()
  })

  it("refuses a sprint that is not future", async () => {
    client.getSprint.mockResolvedValue({ id: 7, name: "S", state: "closed" })
    await expect(
      sprintRun(["start", "7", "--end", "2026-12-14"]),
    ).rejects.toThrow(/only a future sprint/)
  })
})

describe("jira sprint close", () => {
  const withOpen = (keys: string[]) =>
    client.request.mockImplementation(async (path: string) => {
      if (path.startsWith("/rest/agile/1.0/sprint/7/issue?"))
        return { issues: keys.map((key) => ({ key })), total: keys.length }
      return { id: 7, name: "S", state: "closed" }
    })

  it("refuses while issues are open and no --move-to is given", async () => {
    withOpen(["SHOP-1", "SHOP-3"])
    await expect(sprintRun(["close", "7"])).rejects.toThrow(
      /still has 2 open issues: SHOP-1, SHOP-3\npass --move-to/,
    )
    expect(callTo("/rest/agile/1.0/sprint/7")).toBeUndefined()
  })

  it("asks only for issues outside the Done category", async () => {
    withOpen([])
    await sprintRun(["close", "7"])
    const query = client.request.mock.calls[0]![0] as string
    expect(
      new URL(query, "https://acme.atlassian.net").searchParams.get("jql"),
    ).toBe("statusCategory != Done")
    expect(bodyOf(callTo("/rest/agile/1.0/sprint/7")!)).toEqual({
      state: "closed",
    })
  })

  it("moves the open issues to the backlog, then closes", async () => {
    withOpen(["SHOP-1"])
    await sprintRun(["close", "7", "--move-to", "backlog"])
    const paths = client.request.mock.calls.map((c) => c[0])
    expect(paths.indexOf("/rest/agile/1.0/backlog/issue")).toBeLessThan(
      paths.indexOf("/rest/agile/1.0/sprint/7"),
    )
    expect(bodyOf(callTo("/rest/agile/1.0/backlog/issue")!)).toEqual({
      issues: ["SHOP-1"],
    })
  })

  it("moves them to another sprint by ID", async () => {
    withOpen(["SHOP-1"])
    await sprintRun(["close", "7", "--move-to", "8"])
    expect(callTo("/rest/agile/1.0/sprint/8/issue")).toBeDefined()
  })
})

describe("jira sprint edit", () => {
  it("sends only what changed", async () => {
    client.request.mockResolvedValue({ id: 7, name: "S", state: "active" })
    await sprintRun(["edit", "7", "--goal", "Ship checkout"])
    expect(bodyOf(callTo("/rest/agile/1.0/sprint/7")!)).toEqual({
      goal: "Ship checkout",
    })
  })

  it("refuses an empty edit", async () => {
    await expect(sprintRun(["edit", "7"])).rejects.toThrow(/nothing to change/)
  })
})

// ── versions ───────────────────────────────────────────────────────────────

const versionRun = (args: string[]) =>
  run(registerVersionCommands, ["version", ...args])

const VERSIONS = [
  {
    id: "10100",
    name: "2.4",
    self: "https://acme.atlassian.net/rest/api/3/version/10100",
  },
  {
    id: "10101",
    name: "2.5",
    self: "https://acme.atlassian.net/rest/api/3/version/10101",
  },
]

describe("jira version create", () => {
  it("creates in the project by its ID", async () => {
    client.request.mockImplementation(async (path: string) =>
      path === "/rest/api/3/project/SHOP"
        ? { id: "10001" }
        : { id: "10102", name: "2.6" },
    )

    await versionRun([
      "create",
      "2.6",
      "--project",
      "SHOP",
      "--release-date",
      "2026-12-15",
    ])

    expect(bodyOf(callTo("/rest/api/3/version")!)).toEqual({
      name: "2.6",
      releaseDate: "2026-12-15",
      projectId: 10001,
    })
  })

  it("on a 403, says whether this account is a project admin", async () => {
    client.request.mockImplementation(async (path: string) => {
      if (path === "/rest/api/3/project/SHOP") return { id: "10001" }
      if (path.startsWith("/rest/api/3/mypermissions"))
        return {
          permissions: {
            ADMINISTER: { havePermission: false },
            ADMINISTER_PROJECTS: { havePermission: false },
          },
        }
      throw forbidden()
    })

    await expect(
      versionRun(["create", "2.6", "-p", "SHOP"]),
    ).rejects.toMatchObject({
      code: 4,
      message: expect.stringMatching(
        /Administer Projects on SHOP[\s\S]*not a project admin on SHOP/,
      ),
    })
  })
})

describe("jira version view", () => {
  it("shows state, dates and counts", async () => {
    client.getProjectVersions.mockResolvedValue(VERSIONS)
    client.request.mockImplementation(async (path: string) => {
      if (path.endsWith("relatedIssueCounts"))
        return { issuesFixedCount: 12, issuesAffectedCount: 2 }
      if (path.endsWith("unresolvedIssueCount"))
        return { issuesCount: 12, issuesUnresolvedCount: 3 }
      return {
        id: "10100",
        name: "2.4",
        released: false,
        releaseDate: "2026-12-01",
        issuesStatusForFixVersion: { toDo: 1, inProgress: 2, done: 9 },
      }
    })

    await versionRun(["view", "2.4", "--project", "SHOP"])

    expect(
      callTo("/rest/api/3/version/10100?expand=issuesstatus"),
    ).toBeDefined()
    expect(stdout()).toMatch(/state\s+unreleased/)
    expect(stdout()).toMatch(/fixed in\s+12/)
    expect(stdout()).toMatch(/unresolved\s+3 of 12/)
    expect(stdout()).toMatch(/to do 1 · in progress 2 · done 9/)
  })

  it("needs --project to find a version by name", async () => {
    await expect(versionRun(["view", "2.4"])).rejects.toThrow(
      /--project is needed/,
    )
  })
})

describe("jira version release", () => {
  it("releases with the target's self URL for unresolved issues", async () => {
    client.getProjectVersions.mockResolvedValue(VERSIONS)
    client.request.mockImplementation(
      async (path: string, init?: RequestInit) => {
        if (path === "/rest/api/3/version/10101") return VERSIONS[1]
        if (init?.method === "PUT") return { ...VERSIONS[0], released: true }
        throw new Error(`unexpected ${path}`)
      },
    )

    await versionRun([
      "release",
      "2.4",
      "--project",
      "SHOP",
      "--date",
      "2026-12-01",
      "--move-unresolved-to",
      "2.5",
    ])

    expect(bodyOf(callTo("/rest/api/3/version/10100")!)).toEqual({
      released: true,
      releaseDate: "2026-12-01",
      moveUnfixedIssuesTo:
        "https://acme.atlassian.net/rest/api/3/version/10101",
    })
    expect(stderr()).toContain(
      "released 2.4 on 2026-12-01, unresolved issues moved to 2.5",
    )
  })

  it("warns when unresolved issues stay behind", async () => {
    client.getProjectVersions.mockResolvedValue(VERSIONS)
    client.request.mockImplementation(async (path: string) =>
      path.endsWith("unresolvedIssueCount")
        ? { issuesUnresolvedCount: 2 }
        : { ...VERSIONS[0] },
    )

    await versionRun(["release", "2.4", "-p", "SHOP"])

    expect(stderr()).toContain("2 unresolved issues stay in 2.4")
  })

  it("refuses an already released version", async () => {
    client.getProjectVersions.mockResolvedValue([
      { ...VERSIONS[0], released: true },
    ])
    await expect(versionRun(["release", "2.4", "-p", "SHOP"])).rejects.toThrow(
      /already released/,
    )
  })
})

// ── project roles ──────────────────────────────────────────────────────────

const ROLE_MAP = {
  Administrators:
    "https://acme.atlassian.net/rest/api/3/project/SHOP/role/10002",
  Developers: "https://acme.atlassian.net/rest/api/3/project/SHOP/role/10000",
}

describe("roleIds and findRole", () => {
  it("reads role IDs from the URLs", () => {
    expect(roleIds(ROLE_MAP)).toEqual([
      { name: "Administrators", id: "10002" },
      { name: "Developers", id: "10000" },
    ])
  })

  it("finds by name or ID and lists the roles when nothing matches", () => {
    const roles = roleIds(ROLE_MAP)
    expect(findRole(roles, "developers").id).toBe("10000")
    expect(findRole(roles, "10002").name).toBe("Administrators")
    expect(() => findRole(roles, "Testers")).toThrow(
      /Administrators, Developers/,
    )
  })
})

describe("jira project roles and role add/remove", () => {
  const projectRun = (args: string[]) =>
    run(registerProjectCommands, ["project", ...args])

  beforeEach(() => {
    client.request.mockImplementation(async (path: string) => {
      if (path === "/rest/api/3/project/SHOP/role") return ROLE_MAP
      if (path === "/rest/api/3/project/SHOP/role/10000")
        return {
          id: 10000,
          name: "Developers",
          actors: [
            { displayName: "Ada Lovelace", actorUser: { accountId: "acc-1" } },
            {
              displayName: "shop-devs",
              actorGroup: { name: "shop-devs", displayName: "shop-devs" },
            },
          ],
        }
      if (path === "/rest/api/3/project/SHOP/role/10002")
        return { id: 10002, name: "Administrators", actors: [] }
      return undefined
    })
    client.searchUsers.mockResolvedValue([
      {
        accountId: "acc-2",
        displayName: "Grace Hopper",
        emailAddress: "grace@example.com",
      },
    ])
  })

  it("lists each role with its members", async () => {
    await projectRun(["roles", "SHOP"])
    expect(stdout()).toMatch(
      /10000\s+Developers\s+Ada Lovelace, shop-devs \(group\)/,
    )
    expect(stdout()).toMatch(/10002\s+Administrators\s+—/)
  })

  it("adds a person by email, resolved to an account ID", async () => {
    await projectRun(["role", "add", "SHOP", "Developers", "grace@example.com"])
    const add = client.request.mock.calls.find(
      (c) =>
        c[0] === "/rest/api/3/project/SHOP/role/10000" &&
        (c[1] as RequestInit)?.method === "POST",
    )!
    expect(bodyOf(add)).toEqual({ user: ["acc-2"] })
  })

  it("adds groups by name with --group", async () => {
    await projectRun([
      "role",
      "add",
      "SHOP",
      "developers",
      "shop-devs",
      "--group",
    ])
    const add = client.request.mock.calls.find(
      (c) => (c[1] as RequestInit)?.method === "POST",
    )!
    expect(bodyOf(add)).toEqual({ group: ["shop-devs"] })
  })

  it("removes a person after --yes", async () => {
    await projectRun([
      "role",
      "remove",
      "SHOP",
      "Developers",
      "grace@example.com",
      "--yes",
    ])
    expect(client.request).toHaveBeenCalledWith(
      "/rest/api/3/project/SHOP/role/10000?user=acc-2",
      { method: "DELETE" },
    )
  })

  it("explains a 403 on the role list with the project admin check", async () => {
    client.request.mockImplementation(async (path: string) => {
      if (path.startsWith("/rest/api/3/mypermissions"))
        return {
          permissions: {
            ADMINISTER: { havePermission: false },
            ADMINISTER_PROJECTS: { havePermission: false },
          },
        }
      throw forbidden(path, "GET")
    })
    await expect(projectRun(["roles", "SHOP"])).rejects.toMatchObject({
      code: 4,
      message: expect.stringMatching(/not a project admin on SHOP/),
    })
  })
})
