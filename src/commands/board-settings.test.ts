import { Command } from "commander"
import { jiraApiError, type JiraClient } from "@kud/jira"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { palette } from "../output/format.js"
import { registerBoardCommands } from "./agile.js"
import { isExitError } from "./context.js"
import { setOpener } from "./fallback.js"
import { PRIVATE_API_HELP, type EditModel } from "./greenhopper.js"

vi.mock("./context.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./context.js")>()
  return {
    ...actual,
    context: () => ({
      client: client as unknown as JiraClient,
      config: {
        baseUrl: "https://acme.atlassian.net",
        email: "user@example.com",
        token: "unused",
        customFields: [],
      },
      out: palette(false),
    }),
  }
})

const EDIT_MODEL =
  "/rest/greenhopper/1.0/rapidviewconfig/editmodel.json?rapidViewId=42"
const CONFIG = "/rest/agile/1.0/board/42/configuration"
const FEATURES = "/rest/agile/1.0/board/42/features"
const QUICKFILTERS = (startAt: number) =>
  `/rest/agile/1.0/board/42/quickfilter?startAt=${startAt}&maxResults=50`

const configuration = {
  id: 42,
  name: "SHOP board",
  type: "kanban",
  filter: { id: "100" },
  subQuery: { query: "resolution = EMPTY" },
  columnConfig: {
    constraintType: "issueCount",
    columns: [
      { name: "To Do", statuses: [{ id: "1" }] },
      { name: "Doing", statuses: [{ id: "2" }], max: 5 },
    ],
  },
  estimation: {
    type: "field",
    field: { fieldId: "customfield_10016", displayName: "Story Points" },
  },
  ranking: { rankCustomFieldId: 10019 },
}

const fullModel = (): EditModel => ({
  canEdit: true,
  cardColorConfig: {
    cardColorStrategy: "issuetype",
    canEdit: true,
    cardColors: [
      { id: 7, value: "Bug", color: "#ff0000", strategy: "issuetype" },
      { id: 8, value: "Story", color: "#00ff00", strategy: "issuetype" },
      { id: 9, value: "priority = Highest", color: "#000", strategy: "custom" },
    ],
  },
  swimlanesConfig: {
    swimlaneStrategy: "custom",
    swimlanes: [
      { id: 1, name: "Expedite", query: "priority = Highest" },
      { id: 2, name: "Everything else", query: "", isDefault: true },
    ],
  },
  cardLayoutConfig: {
    currentFields: [{ fieldId: "assignee", name: "Assignee", mode: "WORK" }],
  },
  workingDaysConfig: {
    weekDays: { monday: true, tuesday: true, saturday: false },
    timeZoneEditModel: { currentTimeZoneId: "Europe/London" },
    nonWorkingDays: [{ iso8601Date: "2026-12-25" }],
  },
  boardAdmins: {
    userKeys: [{ key: "abc", displayName: "Ada Lovelace" }],
    groupKeys: [{ key: "shop-admins", displayName: "shop-admins" }],
  },
  somethingNew: { kept: true },
})

let model: EditModel
let client: {
  request: ReturnType<typeof vi.fn>
  getStatuses: ReturnType<typeof vi.fn>
}

const stdoutWrite = vi.spyOn(process.stdout, "write")
const stderrWrite = vi.spyOn(process.stderr, "write")
const stdout = () => stdoutWrite.mock.calls.map((c) => c[0]).join("")
const stderr = () => stderrWrite.mock.calls.map((c) => c[0]).join("")

const router = (
  writes: (path: string, init: RequestInit) => unknown = () => undefined,
) =>
  vi.fn(async (path: string, init?: RequestInit) => {
    if (init?.method && init.method !== "GET") return writes(path, init)
    if (path === CONFIG) return configuration
    if (path === FEATURES)
      return {
        features: [{ feature: "jsw.agility.backlog", state: "ENABLED" }],
      }
    if (path === QUICKFILTERS(0))
      return {
        startAt: 0,
        isLast: true,
        values: [{ id: 3, name: "Mine", jql: "assignee = currentUser()" }],
      }
    if (path === EDIT_MODEL) return model
    throw new Error(`unexpected GET ${path}`)
  })

const writeCalls = () =>
  client.request.mock.calls.filter(
    (c) => (c[1] as RequestInit | undefined)?.method,
  )

beforeEach(() => {
  model = fullModel()
  client = {
    request: router(),
    getStatuses: vi.fn().mockResolvedValue([
      { id: "1", name: "To Do" },
      { id: "2", name: "In Progress" },
    ]),
  }
  stdoutWrite.mockClear().mockReturnValue(true)
  stderrWrite.mockClear().mockReturnValue(true)
})

afterEach(() => {
  process.exitCode = undefined
})

const parse = (args: string[]): Promise<unknown> => {
  const program = new Command()
  program.exitOverride()
  registerBoardCommands(program)
  return program.parseAsync(["node", "jira", "board", ...args])
}

const failure = (args: string[]) => parse(args).catch((e: unknown) => e)

describe("jira board settings", () => {
  it("shows the public settings without touching the private API", async () => {
    await parse(["settings", "42"])

    const out = stdout()
    expect(out).toContain("SHOP board\n")
    expect(out).toContain("WIP counts issueCount")
    expect(out).toContain("  To Do  To Do\n")
    expect(out).toContain("  Doing  In Progress  WIP max 5\n")
    expect(out).toContain("estimation  Story Points\n")
    expect(out).toContain("ranking  customfield_10019\n")
    expect(out).toContain("sub-filter  resolution = EMPTY\n")
    expect(out).toContain("  jsw.agility.backlog  ENABLED\n")
    expect(out).toContain("  Mine  assignee = currentUser()\n")
    expect(client.request).not.toHaveBeenCalledWith(EDIT_MODEL)
  })

  it("adds the private sections with --private-api", async () => {
    await parse(["settings", "42", "--private-api"])

    const out = stdout()
    expect(out).toContain("private API (unsupported")
    expect(out).toContain("can edit  yes\n")
    expect(out).toContain("swimlanes  custom\n")
    expect(out).toContain("  Expedite  priority = Highest\n")
    expect(out).toContain("card colours  issuetype\n")
    expect(out).toContain("  Bug  #ff0000  id 7\n")
    expect(out).not.toContain("priority = Highest  #000")
    expect(out).toContain("card layout  Assignee (work)\n")
    expect(out).toContain("working days  monday, tuesday  Europe/London\n")
    expect(out).toContain("non-working days  2026-12-25\n")
    expect(out).toContain("board admins  Ada Lovelace, group shop-admins\n")
  })

  it("prints a sparse edit model without inventing anything", async () => {
    model = { canEdit: false }

    await parse(["settings", "42", "--private-api"])

    const out = stdout()
    expect(out).toContain("can edit  no\n")
    expect(out).toContain("swimlanes  —\n")
    expect(out).toContain("card colours  —\n")
    expect(out).not.toContain("working days")
    expect(out).not.toContain("board admins")
  })

  it("keeps the raw edit model in --json, unknown keys included", async () => {
    await parse(["settings", "42", "--private-api", "--json"])

    const json = JSON.parse(stdout())
    expect(json.configuration.name).toBe("SHOP board")
    expect(json.quickFilters).toHaveLength(1)
    expect(json.private.somethingNew).toEqual({ kept: true })
  })

  it("marks features unavailable when Jira refuses them", async () => {
    const base = router()
    client.request = vi.fn(async (path: string, init?: RequestInit) => {
      if (path === FEATURES) throw jiraApiError(403, "GET", path, "")
      return base(path, init)
    })

    await parse(["settings", "42"])

    expect(stdout()).toContain("features  unavailable\n")
  })
})

describe("jira board quickfilters", () => {
  it("follows pages and stops on an empty one even if isLast says otherwise", async () => {
    client.request = vi.fn(async (path: string) => {
      if (path === QUICKFILTERS(0))
        return {
          startAt: 0,
          isLast: false,
          values: [
            { id: 1, name: "Mine", jql: "assignee = currentUser()" },
            {
              id: 2,
              name: "Bugs",
              jql: "type = Bug",
              description: "only bugs",
            },
          ],
        }
      if (path === QUICKFILTERS(2))
        return { startAt: 2, isLast: false, values: [] }
      throw new Error(`unexpected ${path}`)
    })

    await parse(["quickfilters", "42", "--json"])

    expect(client.request).toHaveBeenCalledTimes(2)
    expect(JSON.parse(stdout()).map((q: { name: string }) => q.name)).toEqual([
      "Mine",
      "Bugs",
    ])
  })

  it("prints a table", async () => {
    await parse(["quickfilters", "42"])
    expect(stdout()).toMatch(/ID\s+NAME\s+JQL\s+DESCRIPTION/)
    expect(stdout()).toContain("assignee = currentUser()")
  })
})

describe("the --private-api gate", () => {
  it("says so in the flag's help", () => {
    expect(PRIVATE_API_HELP).toContain("private API")
    expect(PRIVATE_API_HELP).toContain("unsupported")
  })

  it.each([
    [["swimlanes", "42"]],
    [["colours", "42"]],
    [["colors", "42"]],
    [["colours", "strategy", "42", "priority"]],
    [["colours", "set", "42", "Bug", "#fff"]],
    [["colours", "remove", "42", "7"]],
  ])("refuses %o without the flag, before any call", async (args) => {
    const error = await failure(args)

    expect(isExitError(error) && error.code).toBe(2)
    expect((error as Error).message).toMatch(/private board API/)
    expect((error as Error).message).toMatch(/--private-api/)
    expect(client.request).not.toHaveBeenCalled()
  })

  it("points at the board's settings tab and asks Atlassian", async () => {
    const error = await failure(["swimlanes", "42"])
    const message = (error as Error).message

    expect(message).toMatch(/^Reading swimlanes for board 42 — no public API\./)
    expect(message).toContain(
      "\nOpen this now:\nhttps://acme.atlassian.net/secure/RapidView.jspa?rapidView=42&tab=swimlanes\n",
    )
    expect(message).toContain("Ask for it: Atlassian")
    expect(message).toContain("https://jira.atlassian.com/issues/?jql=")
  })

  it("with --open, launches that tab and nothing without it", async () => {
    const opener = vi.fn()
    const previous = setOpener(opener)
    try {
      await failure(["colours", "set", "42", "Bug", "#fff"])
      expect(opener).not.toHaveBeenCalled()

      const error = await failure([
        "colours",
        "set",
        "42",
        "Bug",
        "#fff",
        "--open",
      ])
      expect(isExitError(error) && error.code).toBe(2)
      expect(opener).toHaveBeenCalledExactlyOnceWith(
        "https://acme.atlassian.net/secure/RapidView.jspa?rapidView=42&tab=cardColors",
      )
      expect(client.request).not.toHaveBeenCalled()
    } finally {
      setOpener(previous)
    }
  })

  it("lists swimlanes with the flag", async () => {
    await parse(["swimlanes", "42", "--private-api"])
    expect(stdout()).toContain("  Expedite  priority = Highest\n")
  })

  it("lists colours with the flag, under the colors alias too", async () => {
    await parse(["colors", "42", "--private-api"])
    expect(stdout()).toContain("card colours  issuetype\n")
  })
})

describe("private API failures", () => {
  it.each([404, 405, 410])(
    "explains a %i as the private API changing",
    async (status) => {
      client.request = vi.fn(async (path: string) => {
        throw jiraApiError(status, "GET", path, "")
      })

      const error = await failure(["swimlanes", "42", "--private-api"])

      expect(isExitError(error) && error.code).toBe(1)
      expect((error as Error).message).toMatch(
        /private board API did not answer this call.*it may have changed/,
      )
    },
  )

  it("explains a 405 on a write the same way", async () => {
    client.request = router((path, init) => {
      throw jiraApiError(405, init.method ?? "PUT", path, "")
    })

    const error = await failure([
      "colours",
      "strategy",
      "42",
      "priority",
      "--private-api",
      "--yes",
    ])

    expect((error as Error).message).toMatch(/did not answer this call/)
  })

  it("explains a 403 with the board admin check", async () => {
    client.request = vi.fn(async (path: string) => {
      throw jiraApiError(403, "GET", path, "")
    })

    const error = await failure(["colours", "42", "--private-api"])

    expect(isExitError(error) && error.code).toBe(4)
    expect((error as Error).message).toMatch(/board admin/)
    expect((error as Error).message).toContain(
      "jira whoami --permissions --board 42",
    )
    expect((error as Error).message).toMatch(
      /^Reading card colours for board 42 — permission refusal\./,
    )
    expect((error as Error).message).toContain("Ask for it: a Jira admin")
  })

  it("with --open, launches the card colours tab on a 403", async () => {
    const opener = vi.fn()
    const previous = setOpener(opener)
    client.request = vi.fn(async (path: string) => {
      throw jiraApiError(403, "GET", path, "")
    })
    try {
      await failure(["colours", "42", "--private-api", "--open"])
      expect(opener).toHaveBeenCalledExactlyOnceWith(
        "https://acme.atlassian.net/secure/RapidView.jspa?rapidView=42&tab=cardColors",
      )
    } finally {
      setOpener(previous)
    }
  })

  it("names a 404 as no public API, with the page", async () => {
    const reads = router()
    client.request = vi.fn(async (path: string) => {
      if (path === EDIT_MODEL) throw jiraApiError(404, "GET", path, "")
      return reads(path)
    })

    const error = await failure(["settings", "42", "--private-api"])

    expect(isExitError(error) && error.code).toBe(1)
    expect((error as Error).message).toMatch(/— no public API\./)
    expect((error as Error).message).toContain(
      "\nhttps://acme.atlassian.net/secure/RapidView.jspa?rapidView=42\n",
    )
  })
})

describe("jira board colours strategy", () => {
  it("validates the strategy before any call", async () => {
    const error = await failure([
      "colours",
      "strategy",
      "42",
      "rainbow",
      "--private-api",
    ])
    expect(isExitError(error) && error.code).toBe(2)
    expect(client.request).not.toHaveBeenCalled()
  })

  it("is a dry run without --yes: shows the diff, writes nothing", async () => {
    await parse(["colours", "strategy", "42", "priority", "--private-api"])

    expect(stdout()).toBe("card colour strategy: issuetype → priority\n")
    expect(stderr()).toContain("dry run — re-run with --yes to apply")
    expect(writeCalls()).toHaveLength(0)
    expect(process.exitCode).toBeUndefined()
  })

  it("prints the planned diff as JSON", async () => {
    await parse([
      "colours",
      "strategy",
      "42",
      "queries",
      "--private-api",
      "--json",
    ])

    expect(JSON.parse(stdout())).toEqual({
      board: 42,
      dryRun: true,
      changes: [
        {
          what: "card colour strategy",
          before: "issuetype",
          after: "queries (custom)",
        },
      ],
    })
  })

  it("applies with --yes, then re-reads to confirm", async () => {
    client.request = router((path, init) => {
      model = {
        ...model,
        cardColorConfig: {
          ...model.cardColorConfig,
          cardColorStrategy: JSON.parse(init.body as string).id,
        },
      }
    })

    await parse([
      "colours",
      "strategy",
      "42",
      "queries",
      "--private-api",
      "--yes",
    ])

    expect(writeCalls()).toEqual([
      [
        "/rest/greenhopper/1.0/cardcolors/42/strategy",
        { method: "PUT", body: JSON.stringify({ id: "custom" }) },
      ],
    ])
    const reads = client.request.mock.calls.filter((c) => c[0] === EDIT_MODEL)
    expect(reads).toHaveLength(2)
    expect(stderr()).toContain("applied")
    expect(process.exitCode).toBeUndefined()
  })

  it("says so, and exits 1, when the re-read does not show the change", async () => {
    await parse([
      "colours",
      "strategy",
      "42",
      "priority",
      "--private-api",
      "--yes",
    ])

    expect(writeCalls()).toHaveLength(1)
    expect(stderr()).toContain("does not show the change")
    expect(process.exitCode).toBe(1)
  })

  it("refuses before writing when the board says canEdit: false", async () => {
    model = { ...model, canEdit: false }

    const error = await failure([
      "colours",
      "strategy",
      "42",
      "priority",
      "--private-api",
      "--yes",
    ])

    expect(isExitError(error) && error.code).toBe(4)
    expect((error as Error).message).toContain(
      "jira whoami --permissions --board 42",
    )
    expect(writeCalls()).toHaveLength(0)
  })

  it("has nothing to do when the strategy is already in force", async () => {
    await parse(["colours", "strategy", "42", "issuetype", "--private-api"])
    expect(stderr()).toContain("nothing to change")
  })
})

describe("jira board colours set", () => {
  it("validates the hex colour before any call", async () => {
    const error = await failure([
      "colours",
      "set",
      "42",
      "Bug",
      "red",
      "--private-api",
    ])
    expect(isExitError(error) && error.code).toBe(2)
    expect(client.request).not.toHaveBeenCalled()
  })

  it("dry-runs a colour change for the current strategy", async () => {
    await parse(["colours", "set", "42", "bug", "#0f0", "--private-api"])

    expect(stdout()).toBe("colour Bug: #ff0000 → #0f0\n")
    expect(writeCalls()).toHaveLength(0)
  })

  it("updates the colour with --yes", async () => {
    client.request = router((_path, init) => {
      const body = JSON.parse(init.body as string)
      model.cardColorConfig!.cardColors![0] = {
        ...model.cardColorConfig!.cardColors![0],
        ...body,
      }
    })

    await parse([
      "colours",
      "set",
      "42",
      "Bug",
      "#00FF00",
      "--private-api",
      "--yes",
    ])

    expect(writeCalls()).toEqual([
      [
        "/rest/greenhopper/1.0/cardcolors/42/color/7",
        {
          method: "PUT",
          body: JSON.stringify({ value: "Bug", color: "#00ff00" }),
        },
      ],
    ])
    expect(stderr()).toContain("applied")
  })

  it("names the known values when one is missing", async () => {
    const error = await failure([
      "colours",
      "set",
      "42",
      "Epic",
      "#fff",
      "--private-api",
    ])
    expect((error as Error).message).toMatch(/known: Bug, Story/)
  })

  it("refuses --add outside the queries strategy", async () => {
    const error = await failure([
      "colours",
      "set",
      "42",
      "type = Bug",
      "#fff",
      "--add",
      "--private-api",
    ])
    expect(isExitError(error) && error.code).toBe(2)
    expect(writeCalls()).toHaveLength(0)
  })

  it("adds a query colour under the queries strategy", async () => {
    model.cardColorConfig!.cardColorStrategy = "custom"
    client.request = router((_path, init) => {
      model.cardColorConfig!.cardColors!.push({
        id: 10,
        strategy: "custom",
        ...JSON.parse(init.body as string),
      })
    })

    await parse([
      "colours",
      "set",
      "42",
      "type = Bug",
      "#abc",
      "--add",
      "--private-api",
      "--yes",
    ])

    expect(writeCalls()).toEqual([
      [
        "/rest/greenhopper/1.0/cardcolors/42/color",
        {
          method: "POST",
          body: JSON.stringify({ value: "type = Bug", color: "#abc" }),
        },
      ],
    ])
    expect(stderr()).toContain("applied")
  })
})

describe("jira board colours remove", () => {
  it("deletes with --yes and checks it is gone", async () => {
    client.request = router(() => {
      model.cardColorConfig!.cardColors =
        model.cardColorConfig!.cardColors!.filter((c) => c.id !== 7)
    })

    await parse(["colours", "remove", "42", "7", "--private-api", "--yes"])

    expect(writeCalls()).toEqual([
      ["/rest/greenhopper/1.0/cardcolors/42/color/7", { method: "DELETE" }],
    ])
    expect(stderr()).toContain("applied")
  })

  it("is a dry run without --yes", async () => {
    await parse(["colours", "remove", "42", "7", "--private-api"])

    expect(stdout()).toBe("colour Bug (id 7): #ff0000 → (removed)\n")
    expect(writeCalls()).toHaveLength(0)
  })
})
