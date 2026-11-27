import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Command } from "commander"
import { createJiraClient, jiraApiError, type JiraClient } from "@kud/jira"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { palette } from "../output/format.js"
import {
  automationBase,
  automationHost,
  explainAuthFailure,
  nextCursor,
  projectAri,
  registerAutomationCommands,
  resolveRuleUuid,
  rulePayload,
  stableJson,
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

  it.each([
    [
      { globalAdmin: false, projectAdmin: false, project: "SHOP" },
      /not a project admin on SHOP either/,
    ],
    [
      { globalAdmin: false, projectAdmin: true },
      /project admin on at least one project[\s\S]*jira whoami --permissions --project/,
    ],
    [
      { globalAdmin: false, projectAdmin: false },
      /not a project admin anywhere/,
    ],
    [
      { globalAdmin: true, projectAdmin: true },
      /token is the likelier problem/,
    ],
  ])("adds what the account can do instead (%o)", (permissions, expected) => {
    const error = explainAuthFailure(
      jiraApiError(403, "PUT", `${SITE}/rule/${UUID}/state`, ""),
      permissions,
    )
    expect((error as Error).message).toMatch(expected)
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

  it("on a 403, says whether this account could do it in the web UI as a project admin", async () => {
    client.request = routes((path, init) => {
      if (path.startsWith("/rest/api/3/mypermissions"))
        return {
          permissions: {
            ADMINISTER: { havePermission: false },
            ADMINISTER_PROJECTS: { havePermission: true },
          },
        }
      throw jiraApiError(403, init?.method ?? "GET", path, "")
    })

    const error = await parse(["list", "--project", "SHOP"]).catch(
      (e: unknown) => e,
    )

    expect(client.request).toHaveBeenCalledWith(
      "/rest/api/3/mypermissions?permissions=ADMINISTER%2CADMINISTER_PROJECTS&projectKey=SHOP",
    )
    expect(isExitError(error) && error.code).toBe(4)
    const message = (error as Error).message
    expect(message).toMatch(/Administer Jira/)
    expect(message).toMatch(/is a project admin on SHOP/)
    expect(message).toMatch(/Project settings > Automation/)
    expect(message).not.toMatch(/https?:\/\//)
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

/**
 * These drive the real client with a fake fetch, so method, URL, query,
 * headers and status handling are the ones that would go over the wire.
 */
type Exchange = { method: string; url: string; body: unknown }

const wire = (
  respond: (exchange: Exchange) => { status?: number; json?: unknown },
) => {
  const exchanges: Exchange[] = []
  const fetch = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
      const exchange = {
        method: init?.method ?? "GET",
        url: String(input),
        body: init?.body ? JSON.parse(init.body as string) : undefined,
      }
      exchanges.push(exchange)
      if (exchange.url.endsWith("/_edge/tenant_info"))
        return new Response(JSON.stringify({ cloudId: CLOUD_ID }))
      if (exchange.url.includes("/rest/api/3/mypermissions"))
        return new Response(
          JSON.stringify({
            permissions: {
              ADMINISTER: { havePermission: false },
              ADMINISTER_PROJECTS: { havePermission: false },
            },
          }),
        )
      const { status = 200, json } = respond(exchange)
      return new Response(json === undefined ? "" : JSON.stringify(json), {
        status,
      })
    },
  )
  client = createJiraClient({
    baseUrl: "https://acme.atlassian.net",
    email: "user@example.com",
    token: "unused",
    fetch: fetch as unknown as typeof globalThis.fetch,
  }) as unknown as typeof client
  return exchanges
}

const RULE = {
  rule: {
    uuid: UUID,
    name: "Close stale ACME issues",
    state: "ENABLED",
    trigger: {
      type: "jira.issue.event.trigger:created",
      value: { b: 2, a: 1 },
    },
    components: [
      { type: "jira.issue.transition", value: { z: true, m: [3, 1, 2] } },
      { type: "jira.issue.comment", value: { body: "stale" } },
    ],
  },
  connections: [],
}

/** The same rule with every object's keys in another order. */
const RULE_SHUFFLED = {
  connections: [],
  rule: {
    components: [
      { value: { m: [3, 1, 2], z: true }, type: "jira.issue.transition" },
      { value: { body: "stale" }, type: "jira.issue.comment" },
    ],
    trigger: {
      value: { a: 1, b: 2 },
      type: "jira.issue.event.trigger:created",
    },
    state: "ENABLED",
    name: "Close stale ACME issues",
    uuid: UUID,
  },
}

describe("stableJson", () => {
  it("sorts keys at every depth and keeps array order", () => {
    expect(stableJson({ b: { y: 1, x: [2, 1] }, a: null })).toBe(
      '{\n  "a": null,\n  "b": {\n    "x": [\n      2,\n      1\n    ],\n    "y": 1\n  }\n}\n',
    )
  })

  it("is the same text whatever order the keys came in", () => {
    expect(stableJson(RULE_SHUFFLED)).toBe(stableJson(RULE))
  })
})

describe("resolveRuleUuid", () => {
  it("passes a UUID through without a call", async () => {
    const call = vi.fn()
    expect(await resolveRuleUuid(call, UUID)).toBe(UUID)
    expect(call).not.toHaveBeenCalled()
  })

  it("refuses something that is neither", async () => {
    await expect(resolveRuleUuid(vi.fn(), "close-stale")).rejects.toThrow(
      /neither a rule UUID nor a numeric rule ID/,
    )
  })
})

describe("over the wire", () => {
  it("list: POSTs the summary search, lower-case --state, and follows pages", async () => {
    const exchanges = wire(({ url, body }) => {
      if (!url.endsWith("/rule/summary")) return { status: 404 }
      return (body as { cursor?: string }).cursor
        ? {
            json: {
              data: [{ uuid: "b", name: "two", state: "DISABLED" }],
              links: {},
            },
          }
        : {
            json: {
              data: [{ uuid: "a", name: "one", state: "DISABLED" }],
              links: { next: "?cursor=page2" },
            },
          }
    })

    await parse(["list", "--state", "disabled", "--json"])

    const searches = exchanges.filter((e) => e.url === `${SITE}/rule/summary`)
    expect(searches.map((e) => [e.method, e.body])).toEqual([
      ["POST", { limit: 100, state: "DISABLED" }],
      ["POST", { limit: 99, state: "DISABLED", cursor: "page2" }],
    ])
    expect(JSON.parse(stdout())).toEqual([
      { uuid: "a", name: "one", state: "DISABLED" },
      { uuid: "b", name: "two", state: "DISABLED" },
    ])
  })

  it("get: GETs the rule by UUID and prints it with --json", async () => {
    const exchanges = wire(({ url }) =>
      url === `${SITE}/rule/${UUID}` ? { json: RULE } : { status: 404 },
    )

    await parse(["get", UUID, "--json"])

    expect(exchanges.at(-1)).toMatchObject({
      method: "GET",
      url: `${SITE}/rule/${UUID}`,
    })
    expect(JSON.parse(stdout())).toEqual(RULE)
  })

  it("get: resolves a numeric rule ID through the summaries, across pages", async () => {
    const exchanges = wire(({ url, body }) => {
      if (url === `${SITE}/rule/${UUID}`) return { json: RULE }
      if (!url.endsWith("/rule/summary")) return { status: 404 }
      return (body as { cursor?: string }).cursor
        ? {
            json: {
              data: [{ id: 4242, uuid: UUID, name: "x", state: "ENABLED" }],
              links: {},
            },
          }
        : {
            json: {
              data: [{ id: 1, uuid: "other", name: "y", state: "ENABLED" }],
              links: { next: "?cursor=p2" },
            },
          }
    })

    await parse(["get", "4242"])

    expect(exchanges.map((e) => `${e.method} ${e.url}`)).toEqual([
      "GET https://acme.atlassian.net/_edge/tenant_info",
      `POST ${SITE}/rule/summary`,
      `POST ${SITE}/rule/summary`,
      `GET ${SITE}/rule/${UUID}`,
    ])
  })

  it("get: says so when no rule has that numeric ID", async () => {
    wire(() => ({ json: { data: [], links: {} } }))
    await expect(parse(["get", "999"])).rejects.toThrow(
      /no automation rule with ID 999/,
    )
  })

  it("export: writes the same bytes for the same rule in any key order", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jira-automation-export-"))
    let body: unknown = RULE
    wire(({ url }) =>
      url.startsWith(`${SITE}/rule/${UUID}`) ? { json: body } : { status: 404 },
    )

    await parse(["export", UUID, "-o", join(dir, "a.json")])
    body = RULE_SHUFFLED
    await parse(["export", UUID, "-o", join(dir, "b.json")])

    const a = readFileSync(join(dir, "a.json"), "utf8")
    expect(readFileSync(join(dir, "b.json"), "utf8")).toBe(a)
    expect(a).toBe(stableJson(RULE))
    expect(a.indexOf('"connections"')).toBeLessThan(a.indexOf('"rule"'))
    expect(stdout()).toBe("")
  })

  it("export: prints to stdout without -o and passes --redact through", async () => {
    const exchanges = wire(() => ({ json: RULE }))

    await parse(["export", UUID, "--redact"])

    expect(exchanges.at(-1)?.url).toBe(
      `${SITE}/rule/${UUID}?redactSensitiveFields=true`,
    )
    expect(stdout()).toBe(stableJson(RULE))
  })

  it("export: a 403 names the missing permission, exit 4", async () => {
    wire(() => ({ status: 403 }))

    const error = await parse(["export", UUID]).catch((e: unknown) => e)

    expect(isExitError(error) && error.code).toBe(4)
    expect((error as Error).message).toMatch(/Administer Jira/)
    expect((error as Error).message).toMatch(/project admin is not enough/)
  })
})
