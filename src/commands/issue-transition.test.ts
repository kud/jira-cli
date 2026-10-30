import { Command } from "commander"
import type { JiraClient } from "@kud/jira"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { palette } from "../output/format.js"
import { registerIssueCommands } from "./issue.js"

/**
 * In-process on a real commander tree, with the context module mocked so
 * `context()` hands back a fake client — the CLI/API seam the design keeps
 * testable.
 */
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

const transitions = [
  { id: "10", name: "To Do", to: { id: "1", name: "To Do" } },
  { id: "20", name: "Start Progress", to: { id: "2", name: "In Progress" } },
  { id: "30", name: "Finish", to: { id: "3", name: "Done" } },
  { id: "40", name: "Reopen", to: { id: "1", name: "To Do" } },
]

let client: Record<string, ReturnType<typeof vi.fn>>

const stdoutWrite = vi.spyOn(process.stdout, "write")
const stderrWrite = vi.spyOn(process.stderr, "write")

beforeEach(() => {
  client = {
    getTransitions: vi.fn().mockResolvedValue({ transitions }),
    transitionIssue: vi.fn(),
  }
  stdoutWrite.mockClear().mockReturnValue(true)
  stderrWrite.mockClear().mockReturnValue(true)
})

const parse = (args: string[]): Promise<unknown> => {
  const program = new Command()
  registerIssueCommands(program)
  return program.parseAsync(["node", "jira", ...args])
}

describe("issue transition <key> [status]", () => {
  it("a transition name wins, and matches case-insensitively", async () => {
    await parse(["issue", "transition", "ABC-1", "start progress"])

    expect(client.transitionIssue).toHaveBeenCalledWith(
      "ABC-1",
      "20",
      undefined,
    )
  })

  it("a target status name reaches the transition that moves it there", async () => {
    await parse(["issue", "transition", "ABC-1", "In Progress"])

    expect(client.transitionIssue).toHaveBeenCalledWith(
      "ABC-1",
      "20",
      undefined,
    )
  })

  it("still moves by raw transition id, as it always has", async () => {
    await parse(["issue", "transition", "ABC-1", "10"])

    expect(client.transitionIssue).toHaveBeenCalledWith(
      "ABC-1",
      "10",
      undefined,
    )
  })

  it("a named transition settles the move even when other transitions reach the same status", async () => {
    // The real-world case: a transition is named for its status while a
    // second one reaches it too. The name wins; the status path is never
    // consulted, so this is not an ambiguity to refuse.
    client.getTransitions.mockResolvedValue({
      transitions: [
        { id: "10", name: "Done", to: { id: "3", name: "Done" } },
        { id: "20", name: "Resolve", to: { id: "3", name: "Done" } },
      ],
    })

    await parse(["issue", "transition", "ABC-1", "Done"])

    expect(client.transitionIssue).toHaveBeenCalledWith("ABC-1", "10", undefined)
  })

  it("refuses a status several transitions reach, without moving anything", async () => {
    // "To Do" is reachable by both "To Do" and "Reopen"; a transition name
    // matching the argument wins over the status reading, so the genuinely
    // ambiguous case is the one no transition is named for.
    client.getTransitions.mockResolvedValue({
      transitions: [
        { id: "10", name: "Finish", to: { id: "3", name: "Done" } },
        { id: "20", name: "Done here", to: { id: "3", name: "Done" } },
      ],
    })

    await expect(
      parse(["issue", "transition", "ABC-1", "Done"]),
    ).rejects.toMatchObject({ name: "ExitError", code: 1 })

    expect(client.transitionIssue).not.toHaveBeenCalled()
    const message = await parse(["issue", "transition", "ABC-1", "Done"]).catch(
      (e) => String((e as Error).message),
    )
    expect(message).toMatch(
      /2 transitions reach 'Done' on ABC-1.*Finish → Done; Done here → Done/s,
    )
    expect(message).toMatch(/Use a transition name instead/)
  })

  it("reports a duplicate transition name rather than guessing", async () => {
    client.getTransitions.mockResolvedValue({
      transitions: [
        { id: "10", name: "Done", to: { id: "3", name: "Done" } },
        { id: "20", name: "done", to: { id: "1", name: "To Do" } },
      ],
    })

    await expect(
      parse(["issue", "transition", "ABC-1", "Done"]),
    ).rejects.toMatchObject({ name: "ExitError", code: 1 })

    expect(client.transitionIssue).not.toHaveBeenCalled()
  })

  it("errors with every option when nothing matches", async () => {
    await expect(
      parse(["issue", "transition", "ABC-1", "Nope"]),
    ).rejects.toMatchObject({ name: "ExitError", code: 1 })

    expect(client.transitionIssue).not.toHaveBeenCalled()
    const message = await parse(["issue", "transition", "ABC-1", "Nope"]).catch(
      (e) => String((e as Error).message),
    )
    expect(message).toMatch(/no transition or status 'Nope' on ABC-1/)
    expect(message).toMatch(/Start Progress → In Progress/)
    expect(message).toMatch(/transition name or its target status/)
  })

  it("lists transitions as name → target status, with the hint on stderr", async () => {
    await parse(["issue", "transition", "ABC-1"])

    const out = String(stdoutWrite.mock.calls[0]?.[0])
    expect(out).toContain("Start Progress → In Progress")
    expect(stderrWrite.mock.calls.map((c) => String(c[0])).join("")).toMatch(
      /the argument may be either the transition name or its target status/,
    )
  })

  it("keeps --json as the raw transitions, unchanged", async () => {
    await parse(["issue", "transition", "ABC-1", "--json"])

    const parsed = JSON.parse(String(stdoutWrite.mock.calls[0]?.[0]))
    expect(parsed).toEqual(transitions)
    expect(stderrWrite).not.toHaveBeenCalled()
  })

  it("the move alias shares the same resolution", async () => {
    await parse(["issue", "move", "ABC-1", "Done"])

    expect(client.transitionIssue).toHaveBeenCalledWith(
      "ABC-1",
      "30",
      undefined,
    )
  })
})
