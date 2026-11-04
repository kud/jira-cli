import { Command } from "commander"
import type { JiraClient } from "@kud/jira"
import { jiraApiError } from "@kud/jira"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { palette } from "../output/format.js"
import { registerBoardCommands } from "./agile.js"

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

let client: Record<string, ReturnType<typeof vi.fn>>

const stdoutWrite = vi.spyOn(process.stdout, "write")
const stderrWrite = vi.spyOn(process.stderr, "write")

beforeEach(() => {
  client = {
    getBoards: vi.fn().mockResolvedValue({ values: [] }),
    getBoardConfiguration: vi.fn(),
    request: vi.fn(),
    getStatuses: vi.fn().mockResolvedValue([
      { id: "1", name: "To Do" },
      { id: "2", name: "In Progress" },
      { id: "3", name: "Done" },
    ]),
  }
  stdoutWrite.mockClear().mockReturnValue(true)
  stderrWrite.mockClear().mockReturnValue(true)
})

const parse = (args: string[]): Promise<unknown> => {
  const program = new Command()
  registerBoardCommands(program)
  return program.parseAsync(["node", "jira", ...args])
}

describe("board list", () => {
  it("lists all boards without --project", async () => {
    client.getBoards.mockResolvedValue({
      values: [
        { id: 1, name: "Board 1", type: "scrum" },
        { id: 2, name: "Board 2", type: "kanban" },
      ],
    })

    await parse(["board", "list"])

    expect(client.getBoards).toHaveBeenCalled()
    expect(client.request).not.toHaveBeenCalled()
    const output = String(stdoutWrite.mock.calls[0]?.[0])
    expect(output).toContain("Board 1")
    expect(output).toContain("Board 2")
  })

  it("lists boards for a project with --project", async () => {
    client.request.mockResolvedValue({
      values: [{ id: 1, name: "Project Board", type: "scrum" }],
      isLast: true,
      startAt: 0,
    })

    await parse(["board", "list", "--project", "ABC"])

    expect(client.request).toHaveBeenCalledWith(
      "/rest/agile/1.0/board?projectKeyOrId=ABC",
    )
    const output = String(stdoutWrite.mock.calls[0]?.[0])
    expect(output).toContain("Project Board")
  })

  it("handles pagination for --project", async () => {
    client.request
      .mockResolvedValueOnce({
        values: [{ id: 1, name: "Board 1", type: "scrum" }],
        isLast: false,
        startAt: 0,
      })
      .mockResolvedValueOnce({
        values: [{ id: 2, name: "Board 2", type: "kanban" }],
        isLast: true,
        startAt: 1,
      })

    await parse(["board", "list", "--project", "ABC"])

    expect(client.request).toHaveBeenCalledTimes(2)
    const output = String(stdoutWrite.mock.calls[0]?.[0])
    expect(output).toContain("Board 1")
    expect(output).toContain("Board 2")
  })

  it("encodes project key", async () => {
    client.request.mockResolvedValue({ values: [], isLast: true, startAt: 0 })

    await parse(["board", "list", "--project", "PROJECT WITH SPACES"])

    expect(client.request).toHaveBeenCalledWith(
      "/rest/agile/1.0/board?projectKeyOrId=PROJECT%20WITH%20SPACES",
    )
  })

  it("stops paging when a page comes back empty despite isLast: false", async () => {
    client.request
      .mockResolvedValueOnce({
        values: [{ id: 1, name: "Board 1", type: "scrum" }],
        isLast: false,
        startAt: 0,
      })
      .mockResolvedValue({ values: [], isLast: false, startAt: 1 })

    await parse(["board", "list", "--project", "ABC"])

    expect(client.request).toHaveBeenCalledTimes(2)
    expect(client.request).toHaveBeenLastCalledWith(
      "/rest/agile/1.0/board?projectKeyOrId=ABC&startAt=1",
    )
  })
})

describe("board view", () => {
  it("shows board configuration with columns and statuses", async () => {
    client.getBoardConfiguration.mockResolvedValue({
      id: 1,
      name: "Test Board",
      type: "scrum",
      filter: { id: "100", self: "https://example.atlassian.net/filter/100" },
      columnConfig: {
        columns: [
          { name: "Backlog", statuses: [{ id: "1" }] },
          { name: "In Progress", statuses: [{ id: "2" }] },
          { name: "Done", statuses: [{ id: "3" }] },
        ],
      },
    })
    client.request.mockResolvedValue({
      id: "100",
      name: "Test Filter",
      jql: "project = ABC",
    })

    await parse(["board", "view", "1"])

    expect(client.request).toHaveBeenCalledWith("/rest/api/3/filter/100")
    const output = String(stdoutWrite.mock.calls[0]?.[0])
    expect(output).toContain("Test Board")
    expect(output).toContain("scrum")
    expect(output).toContain("Test Filter")
    expect(output).toContain("project = ABC")
    expect(output).toContain("Backlog")
    expect(output).toContain("To Do")
    expect(output).toContain("In Progress")
    expect(output).toContain("Done")
  })

  it("resolves status IDs to names", async () => {
    client.getBoardConfiguration.mockResolvedValue({
      id: 1,
      name: "Test Board",
      type: "scrum",
      filter: { id: "100" },
      columnConfig: {
        columns: [{ name: "Todo", statuses: [{ id: "1" }] }],
      },
    })
    client.request.mockResolvedValue({ id: "100", name: "Filter", jql: "project = ABC" })

    await parse(["board", "view", "1"])

    const output = String(stdoutWrite.mock.calls[0]?.[0])
    expect(output).toContain("To Do")
  })

  it("falls back to status ID when not resolved", async () => {
    client.getBoardConfiguration.mockResolvedValue({
      id: 1,
      name: "Test Board",
      type: "scrum",
      filter: { id: "100" },
      columnConfig: {
        columns: [{ name: "Unknown", statuses: [{ id: "999" }] }],
      },
    })
    client.request.mockResolvedValue({ id: "100", name: "Filter", jql: "project = ABC" })

    await parse(["board", "view", "1"])

    const output = String(stdoutWrite.mock.calls[0]?.[0])
    expect(output).toContain("999")
  })

  it("shows the filter as unavailable when the configuration names none", async () => {
    client.getBoardConfiguration.mockResolvedValue({
      id: 1,
      name: "Test Board",
      type: "scrum",
      columnConfig: { columns: [] },
    })

    await parse(["board", "view", "1"])

    expect(client.request).not.toHaveBeenCalled()
    const output = String(stdoutWrite.mock.calls[0]?.[0])
    expect(output).toContain("unavailable")
  })

  it("shows filter as unavailable on 403", async () => {
    client.getBoardConfiguration.mockResolvedValue({
      id: 1,
      name: "Test Board",
      type: "scrum",
      filter: { id: "100" },
      columnConfig: { columns: [] },
    })
    client.request.mockRejectedValueOnce(
      jiraApiError(403, "GET", "/rest/api/3/filter/100", ""),
    )

    await parse(["board", "view", "1"])

    const output = String(stdoutWrite.mock.calls[0]?.[0])
    expect(output).toContain("unavailable")
  })

  it("shows filter as unavailable on 404", async () => {
    client.getBoardConfiguration.mockResolvedValue({
      id: 1,
      name: "Test Board",
      type: "scrum",
      filter: { id: "100" },
      columnConfig: { columns: [] },
    })
    client.request.mockRejectedValueOnce(
      jiraApiError(404, "GET", "/rest/api/3/filter/100", ""),
    )

    await parse(["board", "view", "1"])

    const output = String(stdoutWrite.mock.calls[0]?.[0])
    expect(output).toContain("unavailable")
  })

  it("rethrows other errors, including 404 lookalikes in the message", async () => {
    client.getBoardConfiguration.mockResolvedValue({
      id: 1,
      name: "Test Board",
      type: "scrum",
      filter: { id: "100" },
      columnConfig: { columns: [] },
    })
    client.request
      .mockRejectedValueOnce(jiraApiError(500, "GET", "/rest/api/3/filter/100", ""))
      .mockRejectedValueOnce(new Error("GET /filter/abc — returned 404 aliases, nothing else"))

    await expect(parse(["board", "view", "1"])).rejects.toThrow("Jira API 500")

    await expect(parse(["board", "view", "1"])).rejects.toThrow(
      "returned 404 aliases",
    )
  })

  it("emits JSON with the fetched filter merged over the configuration", async () => {
    client.getBoardConfiguration.mockResolvedValue({
      id: 1,
      name: "Test Board",
      type: "scrum",
      filter: { id: "100" },
      columnConfig: {
        columns: [{ name: "Backlog", statuses: [{ id: "1" }] }],
      },
    })
    client.request.mockResolvedValue({
      id: "100",
      name: "Test Filter",
      jql: "project = ABC",
    })

    await parse(["board", "view", "1", "--json"])

    const parsed = JSON.parse(String(stdoutWrite.mock.calls[0]?.[0]))
    expect(parsed.id).toBe(1)
    expect(parsed.name).toBe("Test Board")
    expect(parsed.filter).toEqual({ id: "100", name: "Test Filter", jql: "project = ABC" })
  })

  it("emits JSON with the filter marked unavailable, keeping one type", async () => {
    client.getBoardConfiguration.mockResolvedValue({
      id: 1,
      name: "Test Board",
      type: "scrum",
      filter: { id: "100" },
      columnConfig: { columns: [] },
    })
    client.request.mockRejectedValueOnce(
      jiraApiError(403, "GET", "/rest/api/3/filter/100", ""),
    )

    await parse(["board", "view", "1", "--json"])

    const parsed = JSON.parse(String(stdoutWrite.mock.calls[0]?.[0]))
    expect(parsed.filter).toEqual({ id: "100", unavailable: true })
  })
})