import { Command } from "commander"
import type { JiraClient } from "@kud/jira"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { palette } from "../output/format.js"
import { registerUserCommands } from "./people.js"

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

const ME = {
  accountId: "5b10a2844c20165700ede21g",
  displayName: "Ada Lovelace",
  emailAddress: "ada@example.com",
}

let client: {
  request: ReturnType<typeof vi.fn>
  getMe: ReturnType<typeof vi.fn>
}

const stdoutWrite = vi.spyOn(process.stdout, "write")
const stdout = () => stdoutWrite.mock.calls.map((c) => c[0]).join("")

const permissions = (administer: boolean, projects: boolean) => ({
  permissions: {
    ADMINISTER: { key: "ADMINISTER", havePermission: administer },
    ADMINISTER_PROJECTS: {
      key: "ADMINISTER_PROJECTS",
      havePermission: projects,
    },
  },
})

beforeEach(() => {
  client = { request: vi.fn(), getMe: vi.fn().mockResolvedValue(ME) }
  stdoutWrite.mockClear().mockReturnValue(true)
})

const parse = (args: string[]): Promise<unknown> => {
  const program = new Command()
  program.exitOverride()
  registerUserCommands(program)
  return program.parseAsync(["node", "jira", "whoami", ...args])
}

describe("jira whoami --permissions --board", () => {
  const board = (admins: object, extra: object = {}) =>
    vi.fn(async (path: string) => {
      if (path.startsWith("/rest/api/3/mypermissions"))
        return permissions(false, true)
      if (path === "/rest/agile/1.0/board/42")
        return { id: 42, name: "SHOP board" }
      if (path === "/rest/api/3/myself?expand=groups")
        return { ...ME, groups: { items: [{ name: "shop-leads" }] } }
      if (path.startsWith("/rest/agile/1.0/board?"))
        return {
          isLast: true,
          values: [
            {
              id: 41,
              name: "SHOP board (old)",
              admins: { users: [{ accountId: ME.accountId }] },
            },
            { id: 42, name: "SHOP board", canEdit: true, admins, ...extra },
          ],
        }
      throw new Error(`unexpected ${path}`)
    })

  it("finds the board in the expanded list by name, then by ID", async () => {
    client.request = board({ users: [{ accountId: ME.accountId }] })

    await parse(["--permissions", "--board", "42"])

    const list = client.request.mock.calls
      .map((c) => c[0] as string)
      .find((p) => p.startsWith("/rest/agile/1.0/board?"))!
    const params = new URL(list, "https://acme.atlassian.net").searchParams
    expect(params.get("name")).toBe("SHOP board")
    expect(params.get("expand")).toBe("admins,permissions")
    expect(stdout()).toContain("board admin on SHOP board (42)   yes\n")
  })

  it("counts a board admin group the account belongs to", async () => {
    client.request = board({ users: [], groups: [{ name: "shop-leads" }] })

    await parse(["--permissions", "--board", "42", "--json"])

    expect(JSON.parse(stdout()).permissions.board).toEqual({
      id: 42,
      name: "SHOP board",
      boardAdmin: true,
      canEdit: true,
    })
  })

  it("does not read canEdit as board admin, since project admins get it too", async () => {
    client.request = board({
      users: [{ accountId: "someone-else" }],
      groups: [],
    })

    await parse(["--permissions", "--board", "42"])

    expect(stdout()).toContain("board admin on SHOP board (42)   no\n")
  })

  it("refuses a board ID that is not a number", async () => {
    await expect(parse(["--permissions", "--board", "SHOP"])).rejects.toThrow(
      /board ID/,
    )
  })
})

describe("jira whoami", () => {
  it("asks nothing about permissions unless told to", async () => {
    await parse([])
    expect(client.request).not.toHaveBeenCalled()
    expect(stdout()).toBe(`Ada Lovelace <ada@example.com>\n${ME.accountId}\n`)
  })

  it("--permissions --project shows global and project admin up front", async () => {
    client.request.mockResolvedValue(permissions(false, true))

    await parse(["--permissions", "--project", "SHOP"])

    expect(client.request).toHaveBeenCalledWith(
      "/rest/api/3/mypermissions?permissions=ADMINISTER%2CADMINISTER_PROJECTS&projectKey=SHOP",
    )
    expect(stdout()).toContain("global admin (Administer Jira)   no\n")
    expect(stdout()).toContain("project admin on SHOP            yes\n")
  })

  it("without a project, reports project admin in any project", async () => {
    client.request.mockResolvedValue(permissions(true, true))

    await parse(["--permissions"])

    expect(client.request.mock.calls[0]![0]).not.toMatch(/projectKey/)
    expect(stdout()).toContain("global admin (Administer Jira)   yes\n")
    expect(stdout()).toContain("project admin (any project)      yes\n")
  })

  it("--json adds a permissions object to the account", async () => {
    client.request.mockResolvedValue(permissions(false, true))

    await parse(["--permissions", "--project", "SHOP", "--json"])

    expect(JSON.parse(stdout())).toEqual({
      ...ME,
      permissions: {
        globalAdmin: false,
        projectAdmin: true,
        project: "SHOP",
        automation: { api: false },
      },
    })
  })

  it("refuses --project without --permissions", async () => {
    await expect(parse(["--project", "SHOP"])).rejects.toThrow(
      /only apply with --permissions/,
    )
  })
})

describe("jira whoami --permissions automation row", () => {
  const routed = (administer: boolean, projects: boolean) =>
    vi.fn(async (path: string) => {
      if (path.startsWith("/rest/api/3/mypermissions"))
        return permissions(administer, projects)
      if (path === "/rest/api/3/project/SHOP")
        return { key: "SHOP", projectTypeKey: "software", style: "next-gen" }
      throw new Error(`unexpected ${path}`)
    })

  it("says yes for a Jira admin", async () => {
    client.request = routed(true, true)

    await parse(["--permissions"])

    expect(stdout()).toContain("automation rules (REST API)      yes\n")
  })

  it("gives a project admin the web UI page for that project", async () => {
    client.request = routed(false, true)

    await parse(["--permissions", "--project", "SHOP"])

    expect(stdout()).toContain(
      "automation rules (REST API)      no — needs Administer Jira\n",
    )
    expect(stdout()).toContain(
      "open: https://acme.atlassian.net/jira/software/projects/SHOP/settings/automate  (Project settings > Automation)",
    )
  })

  it("puts the page in --json", async () => {
    client.request = routed(false, true)

    await parse(["--permissions", "--project", "SHOP", "--json"])

    expect(JSON.parse(stdout()).permissions.automation).toEqual({
      api: false,
      uiUrl: "https://acme.atlassian.net/jira/software/projects/SHOP/settings/automate",
    })
  })

  it("gives neither the API nor a page to an account that is neither admin", async () => {
    client.request = routed(false, false)

    await parse(["--permissions", "--project", "SHOP"])

    expect(stdout()).toContain("no — needs Administer Jira")
    expect(stdout()).not.toMatch(/web UI|open:/)
    expect(client.request).not.toHaveBeenCalledWith("/rest/api/3/project/SHOP")
  })
})
