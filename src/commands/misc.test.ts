import { Command } from "commander"
import type { JiraClient } from "@kud/jira"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { palette } from "../output/format.js"
import { registerApiCommand } from "./misc.js"

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

let client: { request: ReturnType<typeof vi.fn> }

const stdoutWrite = vi.spyOn(process.stdout, "write")
const stderrWrite = vi.spyOn(process.stderr, "write")

beforeEach(() => {
  client = { request: vi.fn() }
  stdoutWrite.mockClear().mockReturnValue(true)
  stderrWrite.mockClear().mockReturnValue(true)
})

const parse = (args: string[]): Promise<unknown> => {
  const program = new Command()
  registerApiCommand(program)
  return program.parseAsync(["node", "jira", ...args])
}

describe("jira api", () => {
  it("prints nothing on an empty 2xx body — 'null' would claim data that is not there", async () => {
    // request() resolves to undefined on an empty 2xx body, as link and
    // watcher POSTs return; earlier versions threw "Unexpected end of JSON
    // input".
    client.request.mockResolvedValue(undefined)

    await expect(
      parse(["api", "/rest/api/3/issue/ABC-1/watchers", "-X", "POST"]),
    ).resolves.not.toThrow()

    expect(client.request).toHaveBeenCalledWith(
      "/rest/api/3/issue/ABC-1/watchers",
      { method: "POST" },
    )
    expect(stdoutWrite).not.toHaveBeenCalled()
    expect(stderrWrite).not.toHaveBeenCalled()
  })
})
