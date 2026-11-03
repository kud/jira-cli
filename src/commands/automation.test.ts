import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Command } from "commander"
import { jiraApiError, type JiraClient } from "@kud/jira"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { palette } from "../output/format.js"
import {
  automationBase,
  automationHost,
  explainAuthFailure,
  nextCursor,
  projectAri,
  registerAutomationCommands,
  rulePayload,
} from "./automation.js"
import { isExitError } from "./context.js"

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

const CLOUD_ID = "11111111-2222-3333-4444-555555555555"
const UUID = "0192e5ac-0e25-71de-ba7b-d972e6a2049a"
const SITE = `https://acme.atlassian.net/gateway/api/automation/public/jira/${CLOUD_ID}/rest/v1`

let client: { request: ReturnType<typeof vi.fn> }

const stdoutWrite = vi.spyOn(process.stdout, "write")
const stderrWrite = vi.spyOn(process.stderr, "write")

const routes = (handler: (path: string, init?: RequestInit) => unknown) =>
  vi.fn(async (path: string, init?: RequestInit) => {
    if (path === "/_edge/tenant_info") return { cloudId: CLOUD_ID }
    if (path === "/rest/api/3/project/SHOP") return { id: "10001", key: "SHOP" }
    return handler(path, init)
  })

beforeEach(() => {
  client = { request: routes(() => undefined) }
  stdoutWrite.mockClear().mockReturnValue(true)
  stderrWrite.mockClear().mockReturnValue(true)
  delete process.env["ATLASSIAN_AUTOMATION_HOST"]
  delete process.env["ATLASSIAN_CLOUD_ID"]
})

afterEach(() => {
  process.exitCode = undefined
})

const parse = (args: string[]): Promise<unknown> => {
  const program = new Command()
  program.exitOverride()
  registerAutomationCommands(program)
  return program.parseAsync(["node", "jira", "automation", ...args])
}

const bodyOf = (call: unknown[]): unknown =>
  JSON.parse(((call[1] as RequestInit).body as string) ?? "null")

const stdout = () => stdoutWrite.mock.calls.map((c) => c[0]).join("")

describe("automationHost", () => {
  it("defaults to the site gateway", () => {
    expect(automationHost(undefined, {})).toBe("site")
  })

  it("lets the flag win over the environment", () => {
    expect(automationHost("api", { ATLASSIAN_AUTOMATION_HOST: "site" })).toBe(
      "api",
    )
  })

  it("reads the environment when no flag is given", () => {
    expect(
      automationHost(undefined, { ATLASSIAN_AUTOMATION_HOST: "API" }),
    ).toBe("api")
  })

  it("refuses anything else as a broken environment", () => {
    let error: unknown
    try {
      automationHost("gateway", {})
    } catch (e) {
      error = e
    }
    expect(isExitError(error) && error.code).toBe(2)
  })
})

describe("automationBase", () => {
  it("builds the site gateway path", () => {
    expect(automationBase("site", "https://acme.atlassian.net", CLOUD_ID)).toBe(
      SITE,
    )
  })

  it("builds the api.atlassian.com path", () => {
    expect(automationBase("api", "https://acme.atlassian.net", CLOUD_ID)).toBe(
      `https://api.atlassian.com/automation/public/jira/${CLOUD_ID}/rest/v1`,
    )
  })
})

describe("nextCursor", () => {
  it("reads the cursor from the query-only form", () => {
    expect(nextCursor("?cursor=bbbbbb&limit=100")).toBe("bbbbbb")
  })

  it("still reads it from the older absolute form", () => {
    expect(
      nextCursor("https://example.com/public/search/?cursor=cc&limit=2"),
    ).toBe("cc")
  })

  it("stops when there is no next page", () => {
    expect(nextCursor(undefined)).toBeUndefined()
  })
})

describe("rulePayload", () => {
  it("wraps a bare rule", () => {
    expect(rulePayload({ name: "r" }, "rule.json")).toEqual({
      rule: { name: "r" },
    })
  })

  it("keeps a payload that already holds a rule, connections included", () => {
    const payload = { rule: { name: "r" }, connections: [] }
    expect(rulePayload(payload, "rule.json")).toBe(payload)
  })

  it("refuses an array", () => {
    expect(() => rulePayload([], "rule.json")).toThrow(/JSON object/)
  })
})

describe("explainAuthFailure", () => {
  it("turns an empty 403 into the permission that is missing, exit 4", () => {
    const error = explainAuthFailure(
      jiraApiError(403, "POST", `${SITE}/rule/summary`, ""),
    )
    expect(isExitError(error) && error.code).toBe(4)
    expect((error as Error).message).toMatch(/Jira administrator/)
    expect((error as Error).message).toMatch(/project admin is not enough/)
  })

  it("turns a 401 into the token kind that is expected, exit 4", () => {
    const error = explainAuthFailure(
      jiraApiError(401, "GET", `${SITE}/rule/${UUID}`, ""),
    )
    expect(isExitError(error) && error.code).toBe(4)
    expect((error as Error).message).toMatch(/classic API token/)
  })

  it("leaves other failures alone", () => {
    const original = jiraApiError(400, "POST", `${SITE}/rule`, "{}")
    expect(explainAuthFailure(original)).toBe(original)
  })
})

describe("jira automation list", () => {
  it("scopes the search to the project's ARI", async () => {
    client.request = routes(() => ({
      data: [{ uuid: UUID, name: "Close stale", state: "ENABLED" }],
      links: {},
    }))

    await parse(["list", "--project", "SHOP"])

    const search = client.request.mock.calls.find(
      (c) => c[0] === `${SITE}/rule/summary`,
    )!
    expect((search[1] as RequestInit).method).toBe("POST")
    expect(bodyOf(search)).toEqual({
      limit: 100,
      scope: projectAri(CLOUD_ID, "10001"),
    })
    expect(stdout()).toMatch(/Close stale/)
  })

  it("follows the cursor until --limit is met", async () => {
    let page = 0
    client.request = routes(() => {
      page += 1
      return page === 1
        ? {
            data: [{ uuid: "a", name: "one", state: "ENABLED" }],
            links: { next: "?cursor=next1&limit=1" },
          }
        : {
            data: [{ uuid: "b", name: "two", state: "DISABLED" }],
            links: { next: "?cursor=next2&limit=1" },
          }
    })

    await parse(["list", "--limit", "2", "--json"])

    const searches = client.request.mock.calls.filter(
      (c) => c[0] === `${SITE}/rule/summary`,
    )
    expect(searches).toHaveLength(2)
    expect(bodyOf(searches[1]!)).toEqual({ limit: 1, cursor: "next1" })
    expect(JSON.parse(stdout())).toHaveLength(2)
  })

  it("uses api.atlassian.com and a given cloud ID without asking the site", async () => {
    process.env["ATLASSIAN_CLOUD_ID"] = CLOUD_ID
    client.request = routes(() => ({ data: [], links: {} }))

    await parse(["list", "--host", "api"])

    expect(client.request.mock.calls.map((c) => c[0])).toEqual([
      `https://api.atlassian.com/automation/public/jira/${CLOUD_ID}/rest/v1/rule/summary`,
    ])
  })

  it("explains a bare 403 instead of printing an empty body", async () => {
    client.request = routes((path, init) => {
      throw jiraApiError(403, init?.method ?? "GET", path, "")
    })

    const error = await parse(["list"]).catch((e: unknown) => e)
    expect(isExitError(error) && error.code).toBe(4)
    expect((error as Error).message).toMatch(/Administer Jira/)
  })

  it("rejects an unknown --state before calling anything", async () => {
    await expect(parse(["list", "--state", "paused"])).rejects.toThrow(
      /ENABLED or DISABLED/,
    )
    expect(client.request).not.toHaveBeenCalled()
  })
})

describe("jira automation get", () => {
  it("prints the rule and passes --redact through", async () => {
    client.request = routes(() => ({
      rule: { uuid: UUID, name: "Close stale" },
    }))

    await parse(["get", UUID, "--redact"])

    expect(client.request).toHaveBeenCalledWith(
      `${SITE}/rule/${UUID}?redactSensitiveFields=true`,
      {},
    )
    expect(JSON.parse(stdout())).toEqual({
      rule: { uuid: UUID, name: "Close stale" },
    })
  })
})

describe("jira automation create and update", () => {
  const ruleFile = (content: string): string => {
    const path = join(
      mkdtempSync(join(tmpdir(), "jira-automation-")),
      "rule.json",
    )
    writeFileSync(path, content)
    return path
  }

  it("creates from a bare rule and prints the new UUID", async () => {
    client.request = routes(() => ({ ruleUuid: UUID }))
    const file = ruleFile(JSON.stringify({ name: "Close stale" }))

    await parse(["create", "--file", file])

    const create = client.request.mock.calls.find(
      (c) => c[0] === `${SITE}/rule`,
    )!
    expect((create[1] as RequestInit).method).toBe("POST")
    expect(bodyOf(create)).toEqual({ rule: { name: "Close stale" } })
    expect(stdout()).toBe(`${UUID}\n`)
  })

  it("updates with PUT on the rule's path", async () => {
    const file = ruleFile(JSON.stringify({ rule: { name: "Close stale" } }))

    await parse(["update", UUID, "--file", file])

    const update = client.request.mock.calls.find(
      (c) => c[0] === `${SITE}/rule/${UUID}`,
    )!
    expect((update[1] as RequestInit).method).toBe("PUT")
    expect(bodyOf(update)).toEqual({ rule: { name: "Close stale" } })
  })

  it("refuses invalid JSON before calling anything", async () => {
    const file = ruleFile("{ not json")
    await expect(parse(["create", "--file", file])).rejects.toThrow(
      /not valid JSON/,
    )
    expect(client.request).not.toHaveBeenCalled()
  })
})

describe("jira automation enable and disable", () => {
  it.each([
    ["enable", "ENABLED"],
    ["disable", "DISABLED"],
  ])("%s sends the state", async (command, value) => {
    await parse([command, UUID])

    const call = client.request.mock.calls.find(
      (c) => c[0] === `${SITE}/rule/${UUID}/state`,
    )!
    expect((call[1] as RequestInit).method).toBe("PUT")
    expect(bodyOf(call)).toEqual({ value })
  })
})
