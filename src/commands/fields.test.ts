import { Command } from "commander"
import { jiraApiError, type JiraClient } from "@kud/jira"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { palette } from "../output/format.js"
import {
  fieldValue,
  findField,
  listFieldSugar,
  parseFieldSpec,
  resolveFields,
  type FieldDef,
} from "./fields.js"
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
      },
      out: palette(false),
    }),
  }
})

const FIELDS: FieldDef[] = [
  { id: "summary", name: "Summary", schema: { type: "string" } },
  {
    id: "customfield_10016",
    name: "Story Points",
    custom: true,
    schema: { type: "number" },
  },
  {
    id: "customfield_10020",
    name: "Team",
    custom: true,
    schema: { type: "option" },
  },
  {
    id: "customfield_10030",
    name: "Platforms",
    custom: true,
    schema: { type: "array", items: "option" },
  },
  { id: "labels", name: "Labels", schema: { type: "array", items: "string" } },
  {
    id: "customfield_10040",
    name: "Reviewer",
    custom: true,
    schema: { type: "user" },
  },
  {
    id: "customfield_10050",
    name: "Notes",
    custom: true,
    schema: { type: "string" },
  },
  {
    id: "customfield_10051",
    name: "Notes",
    custom: true,
    schema: { type: "string" },
  },
]

let client: Record<string, ReturnType<typeof vi.fn>>

const stdoutWrite = vi.spyOn(process.stdout, "write")
const stderrWrite = vi.spyOn(process.stderr, "write")

beforeEach(() => {
  client = {
    getFields: vi.fn().mockResolvedValue(FIELDS),
    createIssue: vi
      .fn()
      .mockResolvedValue({ id: "1", key: "SHOP-9", self: "" }),
    updateIssue: vi.fn(),
    getTransitions: vi.fn().mockResolvedValue({
      transitions: [{ id: "31", name: "Done", to: { name: "Done" } }],
    }),
    transitionIssue: vi.fn(),
    request: vi.fn(),
  }
  stdoutWrite.mockClear().mockReturnValue(true)
  stderrWrite.mockClear().mockReturnValue(true)
})

const parse = (args: string[]): Promise<unknown> => {
  const program = new Command()
  program.exitOverride()
  registerIssueCommands(program)
  return program.parseAsync(["node", "jira", "issue", ...args])
}

describe("parseFieldSpec", () => {
  it("splits on the first = only", () => {
    expect(parseFieldSpec("Notes=a=b")).toEqual({ name: "Notes", raw: "a=b" })
  })

  it("refuses a spec with no name or no =", () => {
    expect(() => parseFieldSpec("Story Points")).toThrow(/name=value/)
    expect(() => parseFieldSpec("=5")).toThrow(/name=value/)
  })
})

describe("findField", () => {
  it("finds by ID or by name ignoring case", () => {
    expect(findField(FIELDS, "customfield_10016").name).toBe("Story Points")
    expect(findField(FIELDS, "story points").id).toBe("customfield_10016")
  })

  it("refuses a name two fields share, naming both IDs", () => {
    expect(() => findField(FIELDS, "Notes")).toThrow(
      /customfield_10050, customfield_10051 — use the ID/,
    )
  })

  it("points at jira fields when nothing matches", () => {
    expect(() => findField(FIELDS, "Velocity")).toThrow(/jira fields/)
  })
})

describe("fieldValue", () => {
  const field = (name: string) => findField(FIELDS, name)

  it.each([
    ["Story Points", "5", 5],
    ["Team", "Payments", { value: "Payments" }],
    ["Platforms", "iOS, Android", [{ value: "iOS" }, { value: "Android" }]],
    ["Labels", "triage,backend", ["triage", "backend"]],
    [
      "Reviewer",
      "5b10a2844c20165700ede21g",
      { accountId: "5b10a2844c20165700ede21g" },
    ],
    ["Summary", "Fix checkout", "Fix checkout"],
    ["Story Points", "none", null],
  ])("%s=%s", (name, raw, expected) => {
    expect(fieldValue(field(name), raw)).toEqual(expected)
  })

  it("passes JSON through for shapes it does not know", () => {
    expect(fieldValue(field("Summary"), '{"a":1}')).toEqual({ a: 1 })
  })

  it("refuses text in a number field", () => {
    expect(() => fieldValue(field("Story Points"), "five")).toThrow(
      /takes a number/,
    )
  })
})

describe("resolveFields", () => {
  it("does not fetch fields when none are given", async () => {
    expect(await resolveFields(client as unknown as JiraClient, [])).toEqual({})
    expect(client.getFields).not.toHaveBeenCalled()
  })
})

describe("listFieldSugar", () => {
  it("turns names into the list shapes", () => {
    expect(
      listFieldSugar({ component: ["API"], fixVersion: ["2.4", "2.5"] }),
    ).toEqual({
      components: [{ name: "API" }],
      fixVersions: [{ name: "2.4" }, { name: "2.5" }],
    })
  })
})

describe("issue create and edit --field --component --fix-version", () => {
  it("create sends resolved custom fields and the list sugar", async () => {
    await parse([
      "create",
      "-p",
      "SHOP",
      "-t",
      "Story",
      "-s",
      "Checkout",
      "--field",
      "Story Points=5",
      "--component",
      "API",
      "--fix-version",
      "2.4",
    ])

    expect(client.createIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        customfield_10016: 5,
        components: [{ name: "API" }],
        fixVersions: [{ name: "2.4" }],
      }),
    )
  })

  it("edit fails on an unknown field before writing anything", async () => {
    await expect(
      parse(["edit", "SHOP-1", "--field", "Velocity=3"]),
    ).rejects.toThrow(/no field 'Velocity'/)
    expect(client.updateIssue).not.toHaveBeenCalled()
  })

  it("edit counts --field alone as something to change", async () => {
    await parse(["edit", "SHOP-1", "-f", "Team=Payments"])
    expect(client.updateIssue).toHaveBeenCalledWith("SHOP-1", {
      customfield_10020: { value: "Payments" },
    })
  })
})

describe("issue transition --comment --field", () => {
  it("sends the comment in update and the fields alongside", async () => {
    await parse([
      "transition",
      "SHOP-1",
      "Done",
      "--comment",
      "Shipped in 2.4",
      "--field",
      "Story Points=3",
      "--resolution",
      "Fixed",
    ])

    expect(client.transitionIssue).not.toHaveBeenCalled()
    const [path, init] = client.request.mock.calls[0] as [string, RequestInit]
    expect(path).toBe("/rest/api/3/issue/SHOP-1/transitions")
    const body = JSON.parse(init.body as string)
    expect(body.transition).toEqual({ id: "31" })
    expect(body.fields).toEqual({
      resolution: { name: "Fixed" },
      customfield_10016: 3,
    })
    expect(body.update.comment[0].add.body.type).toBe("doc")
  })

  it("links a bare issue key in the comment to the configured site", async () => {
    await parse([
      "transition",
      "SHOP-1",
      "Done",
      "--comment",
      "Unblocked by SHOP-9",
    ])

    const [, init] = client.request.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.update.comment[0].add.body.content[0].content).toContainEqual({
      type: "text",
      text: "SHOP-9",
      marks: [
        {
          type: "link",
          attrs: { href: "https://acme.atlassian.net/browse/SHOP-9" },
        },
      ],
    })
  })

  it("keeps the plain path when there is no comment", async () => {
    await parse(["transition", "SHOP-1", "Done", "-f", "Story Points=3"])
    expect(client.transitionIssue).toHaveBeenCalledWith("SHOP-1", "31", {
      customfield_10016: 3,
    })
  })

  it("lets Jira's own refusal through", async () => {
    client.request.mockRejectedValue(jiraApiError(400, "POST", "/x", ""))
    await expect(
      parse(["transition", "SHOP-1", "Done", "--comment", "x"]),
    ).rejects.toMatchObject({ status: 400 })
  })
})
