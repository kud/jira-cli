import { Command } from "commander"
import { jiraApiError, type JiraClient } from "@kud/jira"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { palette } from "../output/format.js"
import { isExitError } from "./context.js"
import {
  andJql,
  describeShare,
  ownerLabel,
  pickQuickFilter,
  registerBoardFilterCommand,
  registerFilterCommands,
  splitOrderBy,
} from "./filter.js"
import { registerIssueCommands } from "./issue.js"

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
        defaultProject: "SHOP",
      },
      out: palette(false),
    }),
  }
})

const ME = { accountId: "me-1", displayName: "Ada Lovelace" }
const GRACE = { accountId: "grace-2", displayName: "Grace Hopper" }

const FILTER = {
  id: "10200",
  name: "Open bugs",
  jql: "project = SHOP AND type = Bug ORDER BY Rank ASC",
  owner: GRACE,
  favourite: false,
  viewUrl: "https://acme.atlassian.net/issues/?filter=10200",
  sharePermissions: [
    { id: 7, type: "project", project: { id: "10001", key: "SHOP" } },
    { id: 8, type: "group", group: { name: "shop-leads" } },
  ],
}

type Call = [string, RequestInit | undefined]

let client: {
  request: ReturnType<typeof vi.fn>
  getMe: ReturnType<typeof vi.fn>
  searchIssues: ReturnType<typeof vi.fn>
}

const stdoutWrite = vi.spyOn(process.stdout, "write")
const stdout = () => stdoutWrite.mock.calls.map((c) => c[0]).join("")

const routes = (handler: (path: string, init?: RequestInit) => unknown) =>
  vi.fn(async (path: string, init?: RequestInit) => handler(path, init))

const writes = (): Call[] =>
  (client.request.mock.calls as Call[]).filter(
    ([, init]) => init?.method && init.method !== "GET",
  )

beforeEach(() => {
  client = {
    request: routes(() => undefined),
    getMe: vi.fn().mockResolvedValue(ME),
    searchIssues: vi.fn().mockResolvedValue([]),
  }
  stdoutWrite.mockClear().mockReturnValue(true)
})

const parse = (args: string[]): Promise<unknown> => {
  const program = new Command()
  program.exitOverride()
  registerFilterCommands(program)
  registerIssueCommands(program)
  registerBoardFilterCommand(program.command("board"))
  return program.parseAsync(["node", "jira", ...args])
}

const rejection = async (p: Promise<unknown>) => {
  const error = await p.then(
    () => undefined,
    (e: unknown) => e,
  )
  if (!isExitError(error)) throw new Error(`expected an exit error: ${error}`)
  return error
}

describe("jql helpers", () => {
  it("splits ORDER BY off, case-insensitively", () => {
    expect(splitOrderBy("a = 1 order by Rank")).toEqual({
      where: "a = 1",
      order: "order by Rank",
    })
    expect(splitOrderBy("a = 1")).toEqual({ where: "a = 1" })
  })

  it("parenthesises each part so an OR cannot leak, keeping the last ORDER BY", () => {
    expect(
      andJql(["a = 1 OR b = 2 ORDER BY Rank", "c = 3", ""]),
    ).toBe("(a = 1 OR b = 2) AND (c = 3) ORDER BY Rank")
    expect(andJql(["a = 1 ORDER BY Rank", "c = 3 ORDER BY created"])).toBe(
      "(a = 1) AND (c = 3) ORDER BY created",
    )
  })

  it("names the owner only when it is someone else", () => {
    expect(ownerLabel(ME, ME.accountId)).toBe("you")
    expect(ownerLabel(GRACE, ME.accountId)).toBe("Grace Hopper")
    expect(ownerLabel(undefined, ME.accountId)).toBe("—")
  })

  it("describes each share type", () => {
    expect(describeShare({ type: "authenticated" })).toBe("any logged-in user")
    expect(
      describeShare({
        type: "projectRole",
        project: { key: "SHOP" },
        role: { name: "Developers" },
      }),
    ).toBe("project SHOP, role Developers")
  })

  it("picks a quick filter by ID or name, and refuses an ambiguous name", () => {
    const quick = [
      { id: 1, name: "Bugs", jql: "type = Bug" },
      { id: 2, name: "Mine", jql: "assignee = currentUser()" },
      { id: 3, name: "mine", jql: "reporter = currentUser()" },
    ]
    expect(pickQuickFilter(quick, "bugs", "42").id).toBe(1)
    expect(pickQuickFilter(quick, "3", "42").id).toBe(3)
    expect(() => pickQuickFilter(quick, "Mine", "42")).toThrow(/pass its ID: 2, 3/)
    expect(() => pickQuickFilter(quick, "Nope", "42")).toThrow(
      /Quick filters: Bugs \(1\), Mine \(2\), mine \(3\)/,
    )
  })
})

describe("jira filter view", () => {
  it("shows JQL, the owner by name, and each share with its ID", async () => {
    client.request = routes((p) => (p === "/rest/api/3/filter/10200" ? FILTER : undefined))

    await parse(["filter", "view", "10200"])

    const out = stdout()
    expect(out).toContain("Open bugs  #10200")
    expect(out).toContain("owner        Grace Hopper")
    expect(out).toContain("  7  project SHOP")
    expect(out).toContain("  8  group shop-leads")
  })

  it("says a missing filter may just not be shared", async () => {
    client.request = routes(() => {
      throw jiraApiError(404, "GET", "/rest/api/3/filter/1", "")
    })

    const error = await rejection(parse(["filter", "view", "1"]))
    expect(error.message).toBe("filter 1 does not exist, or is not shared with you")
  })
})

describe("jira filter create", () => {
  it("posts name, JQL, description and favourite", async () => {
    client.request = routes(() => ({ id: "10300", name: "Mine" }))

    await parse([
      "filter",
      "create",
      "--name",
      "Mine",
      "--jql",
      "assignee = currentUser()",
      "--description",
      "my work",
      "--favourite",
    ])

    const [[path, init]] = writes() as [Call]
    expect(path).toBe("/rest/api/3/filter")
    expect(init?.method).toBe("POST")
    expect(JSON.parse(String(init?.body))).toEqual({
      name: "Mine",
      jql: "assignee = currentUser()",
      description: "my work",
      favourite: true,
    })
    expect(stdout()).toBe("created filter 10300  Mine\n")
  })
})

describe("jira filter edit", () => {
  it("sends the current name back when only the JQL changes", async () => {
    client.request = routes((p, init) =>
      init?.method === "PUT"
        ? { ...FILTER, jql: "type = Bug" }
        : p === "/rest/api/3/filter/10200"
          ? FILTER
          : undefined,
    )

    await parse(["filter", "edit", "10200", "--jql", "type = Bug"])

    const [[, init]] = writes() as [Call]
    expect(JSON.parse(String(init?.body))).toEqual({
      name: "Open bugs",
      jql: "type = Bug",
    })
    expect(stdout()).toContain(`jql: ${FILTER.jql} → type = Bug`)
  })

  it("refuses an empty edit before calling Jira", async () => {
    const error = await rejection(parse(["filter", "edit", "10200"]))
    expect(error.message).toMatch(/nothing to change/)
    expect(client.request).not.toHaveBeenCalled()
  })

  it("names the owner when Jira refuses the edit", async () => {
    client.request = routes((p, init) => {
      if (init?.method === "PUT")
        throw jiraApiError(
          400,
          "PUT",
          p,
          JSON.stringify({ errorMessages: ["You must be the owner."] }),
        )
      return FILTER
    })

    const error = await rejection(
      parse(["filter", "edit", "10200", "--name", "x"]),
    )
    expect(error.code).toBe(1)
    expect(error.message).toContain("You must be the owner.")
    expect(error.message).toContain("It is owned by Grace Hopper.")
  })
})

describe("jira filter share", () => {
  it("resolves a project key to its ID", async () => {
    client.request = routes((p) =>
      p === "/rest/api/3/project/SHOP" ? { id: "10001" } : [FILTER.sharePermissions[0]],
    )

    await parse(["filter", "share", "10200", "--project", "SHOP"])

    const [[path, init]] = writes() as [Call]
    expect(path).toBe("/rest/api/3/filter/10200/permission")
    expect(JSON.parse(String(init?.body))).toEqual({
      type: "project",
      projectId: "10001",
    })
    expect(stdout()).toContain("project SHOP")
  })

  it("resolves a role name on the project to its ID", async () => {
    client.request = routes((p) => {
      if (p === "/rest/api/3/project/SHOP") return { id: "10001" }
      if (p === "/rest/api/3/project/SHOP/role")
        return {
          Developers: "https://acme.atlassian.net/rest/api/3/project/10001/role/10100",
        }
      return []
    })

    await parse([
      "filter",
      "share",
      "10200",
      "--project",
      "SHOP",
      "--role",
      "developers",
    ])

    const [[, init]] = writes() as [Call]
    expect(JSON.parse(String(init?.body))).toEqual({
      type: "projectRole",
      projectId: "10001",
      projectRoleId: 10100,
    })
  })

  it("resolves an email to the one matching account", async () => {
    client.request = routes((p) =>
      p.startsWith("/rest/api/3/user/search")
        ? [{ ...GRACE, emailAddress: "grace@example.com" }]
        : [],
    )

    await parse(["filter", "share", "10200", "--user", "grace@example.com"])

    const [[, init]] = writes() as [Call]
    expect(JSON.parse(String(init?.body))).toEqual({
      type: "user",
      accountId: "grace-2",
    })
  })

  it("maps --logged-in and --public to Jira's share types", async () => {
    client.request = routes(() => [])
    await parse(["filter", "share", "10200", "--logged-in"])
    await parse(["filter", "share", "10200", "--public"])

    expect(writes().map(([, i]) => JSON.parse(String(i?.body)))).toEqual([
      { type: "authenticated" },
      { type: "global" },
    ])
  })

  it("wants exactly one target", async () => {
    const none = await rejection(parse(["filter", "share", "10200"]))
    expect(none.message).toMatch(/say who to share with/)
    const two = await rejection(
      parse(["filter", "share", "10200", "--group", "a", "--logged-in"]),
    )
    expect(two.message).toMatch(/one target at a time, not group and logged-in/)
    const role = await rejection(
      parse(["filter", "share", "10200", "--role", "Developers"]),
    )
    expect(role.message).toBe("--role needs --project <key>")
    expect(writes()).toEqual([])
  })

  it("names the sharing permission on a refusal", async () => {
    client.request = routes((p) => {
      throw jiraApiError(403, "POST", p, "")
    })

    const error = await rejection(
      parse(["filter", "share", "10200", "--group", "shop-leads"]),
    )
    expect(error.code).toBe(4)
    expect(error.message).toContain("'Share dashboards and filters'")
  })
})

describe("jira filter unshare and delete", () => {
  it("deletes one share by ID", async () => {
    await parse(["filter", "unshare", "10200", "8"])

    const [[path, init]] = writes() as [Call]
    expect(path).toBe("/rest/api/3/filter/10200/permission/8")
    expect(init?.method).toBe("DELETE")
  })

  it("deletes with --yes, naming the filter", async () => {
    client.request = routes(() => FILTER)

    await parse(["filter", "delete", "10200", "--yes"])

    const [[path, init]] = writes() as [Call]
    expect(path).toBe("/rest/api/3/filter/10200")
    expect(init?.method).toBe("DELETE")
    expect(stdout()).toBe("deleted filter 10200  Open bugs\n")
  })

  it("refuses without --yes when stdin is not a terminal", async () => {
    client.request = routes(() => FILTER)
    const tty = process.stdin.isTTY
    process.stdin.isTTY = false as never
    try {
      const error = await rejection(parse(["filter", "delete", "10200"]))
      expect(error.message).toMatch(/re-run with --yes/)
    } finally {
      process.stdin.isTTY = tty as never
    }
    expect(writes()).toEqual([])
  })
})

const boardRoutes = (quick: object[] = []) =>
  routes((p) => {
    if (p === "/rest/agile/1.0/board/42/configuration")
      return { filter: { id: "10200" } }
    if (p === "/rest/api/3/filter/10200") return FILTER
    if (p.startsWith("/rest/agile/1.0/board/42/quickfilter"))
      return { isLast: true, values: quick }
    throw new Error(`unexpected ${p}`)
  })

describe("jira board filter", () => {
  it("shows the board's filter with its owner named", async () => {
    client.request = boardRoutes()

    await parse(["board", "filter", "42"])

    expect(stdout()).toContain("Open bugs  #10200")
    expect(stdout()).toContain("owner        Grace Hopper")
  })

  it("says so when the board's filter is not shared with you", async () => {
    client.request = routes((p) => {
      if (p.endsWith("/configuration")) return { filter: { id: "10200" } }
      throw jiraApiError(403, "GET", p, "")
    })

    const error = await rejection(parse(["board", "filter", "42"]))
    expect(error.code).toBe(4)
    expect(error.message).toMatch(/uses filter 10200, which is not shared with you/)
  })
})

describe("jira issue list --board", () => {
  const searched = () => client.searchIssues.mock.calls[0]?.[0] as string

  it("searches the board's filter, not the default project or 'mine'", async () => {
    client.request = boardRoutes()

    await parse(["issue", "list", "--board", "42"])

    expect(searched()).toBe(
      "(project = SHOP AND type = Bug) ORDER BY Rank ASC",
    )
  })

  it("narrows by a quick filter, matched by name", async () => {
    client.request = boardRoutes([
      { id: 5, name: "Only mine", jql: "assignee = currentUser()" },
    ])

    await parse(["issue", "list", "--board", "42", "--quickfilter", "only mine"])

    expect(searched()).toBe(
      "(project = SHOP AND type = Bug) AND (assignee = currentUser()) ORDER BY Rank ASC",
    )
  })

  it("narrows by the usual flags, keeping the board's order", async () => {
    client.request = boardRoutes()

    await parse(["issue", "list", "--board", "42", "--status", "Done"])

    expect(searched()).toBe(
      '(project = SHOP AND type = Bug) AND (status = "Done") ORDER BY Rank ASC',
    )
  })

  it("refuses --quickfilter without --board", async () => {
    const error = await rejection(
      parse(["issue", "list", "--quickfilter", "Bugs"]),
    )
    expect(error.message).toBe("--quickfilter needs --board <id>")
  })
})
