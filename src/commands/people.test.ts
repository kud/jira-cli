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
      permissions: { globalAdmin: false, projectAdmin: true, project: "SHOP" },
    })
  })

  it("refuses --project without --permissions", async () => {
    await expect(parse(["--project", "SHOP"])).rejects.toThrow(
      /only applies with --permissions/,
    )
  })
})
