import { join } from "node:path"
import { runCli } from "@kud/cli-testing"
import { describe, expect, it } from "vitest"
import { interactiveArgs } from "./index.js"

// runCli's child runs with cwd set to a fresh temp HOME, so both the
// interpreter and the entry script need absolute paths — a relative one
// would resolve against that temp dir instead of the project.
const tsx = join(process.cwd(), "node_modules", ".bin", "tsx")
const entry = join(process.cwd(), "src", "index.ts")
const jira = (args: string[]) => runCli(tsx, [entry, ...args])

describe("interactiveArgs", () => {
  it("treats no arguments at all as a bare, mock-less launch", () => {
    expect(interactiveArgs(["node", "jira"])).toEqual({
      screen: undefined,
      mock: false,
      isBare: true,
    })
  })

  it("recognises --mock on its own as bare", () => {
    expect(interactiveArgs(["node", "jira", "--mock"])).toEqual({
      screen: undefined,
      mock: true,
      isBare: true,
    })
  })

  it("discounts --screen's own value, not just the flag", () => {
    // The named trap: without discounting the value too, `list` reads as a
    // stray positional and isBare goes false, so this falls through to
    // commander as an unknown `list` command instead of the screens list.
    expect(interactiveArgs(["node", "jira", "--screen", "list"])).toEqual({
      screen: "list",
      mock: false,
      isBare: true,
    })
  })

  it("stays bare with both --screen and --mock present, in either order", () => {
    expect(
      interactiveArgs(["node", "jira", "--mock", "--screen", "detail:SHOP-1"]),
    ).toEqual({ screen: "detail:SHOP-1", mock: true, isBare: true })
  })

  it("does not treat a bare positional word as interactive without --screen", () => {
    // Mirror of the trap above: `list` typed on its own is a real subcommand
    // attempt and must reach commander, never the screens list.
    expect(interactiveArgs(["node", "jira", "list"])).toEqual({
      screen: undefined,
      mock: false,
      isBare: false,
    })
  })

  it("stops being bare the moment an unrecognised flag joins --screen", () => {
    expect(
      interactiveArgs(["node", "jira", "--screen", "list", "--verbose"]),
    ).toEqual({ screen: "list", mock: false, isBare: false })
  })

  it("tolerates --screen with no trailing value instead of throwing", () => {
    expect(interactiveArgs(["node", "jira", "--screen"])).toEqual({
      screen: undefined,
      mock: false,
      isBare: true,
    })
  })
})

describe("bare invocation, run for real", () => {
  it("prints the known screens for --screen list, rather than erroring as an unknown command", () => {
    const run = jira(["--screen", "list"])

    expect(run.status).toBe(0)
    expect(run.stdout.trim().split("\n")).toEqual(["issues", "detail"])
  })

  it("prints help instead of opening the TUI when stdout isn't a terminal", () => {
    // runCli's child always has its stdout piped, never a TTY — exactly the
    // `jira | less` / `jira > out.txt` case the guard exists for.
    const run = jira([])

    expect(run.status).toBe(0)
    expect(run.stdout).toContain("Jira on the command line")
    expect(run.stdout).toContain("Usage: jira")
  })

  it("still routes an unrecognised top-level word to commander, not the TUI", () => {
    const run = jira(["frobnicate"])

    expect(run.status).not.toBe(0)
    expect(run.stderr).toMatch(/unknown command 'frobnicate'/)
  })
})
