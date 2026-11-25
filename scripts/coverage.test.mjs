import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { program } from "../src/index.ts"
import {
  DOC,
  ROOT,
  SPECS,
  claimedCommands,
  loadMapping,
  loadSnapshot,
  privateCalls,
  problems,
  render,
} from "./coverage.mjs"

const mapping = loadMapping()
const snapshots = Object.fromEntries(
  Object.keys(SPECS).map((name) => [name, loadSnapshot(name)]),
)

const commandNames = (command, prefix = "jira") =>
  command.commands.flatMap((sub) => {
    const name = `${prefix} ${sub.name()}`
    return [name, ...commandNames(sub, name)]
  })

describe("API coverage mapping", () => {
  it("maps every spec operation, and only operations the spec has", () => {
    expect(problems(mapping, snapshots)).toEqual([])
  })

  it("flags an operation with no mapping", () => {
    const extra = {
      ...snapshots.software,
      operations: [
        ...snapshots.software.operations,
        {
          operationId: "madeUpOperation",
          method: "GET",
          path: "/rest/agile/1.0/made-up",
          tags: ["Made up"],
          summary: "",
          deprecated: false,
        },
      ],
    }
    expect(problems(mapping, { ...snapshots, software: extra })).toContain(
      "software: madeUpOperation (GET /rest/agile/1.0/made-up) has no mapping",
    )
  })

  it("flags a mapping for an operation the spec dropped", () => {
    const stale = {
      ...mapping,
      software: {
        ...mapping.software,
        operations: {
          ...mapping.software.operations,
          goneOperation: { notWrapped: true },
        },
      },
    }
    expect(problems(stale, snapshots)).toContain(
      "software: mapping names goneOperation, absent from the spec",
    )
  })

  it("names only commands the CLI registers", () => {
    const registered = new Set(commandNames(program))
    expect(claimedCommands(mapping).filter((c) => !registered.has(c))).toEqual(
      [],
    )
  })

  it("lists the private board calls greenhopper.ts makes", () => {
    const names = privateCalls().map((c) => c.name)
    expect(names).toEqual(
      expect.arrayContaining([
        "getEditModel",
        "setCardColorStrategy",
        "removeCardColor",
      ]),
    )
    for (const name of names)
      expect(mapping.private.commands[name]).toBeDefined()
  })

  it("keeps docs/coverage.md in step with the mapping", () => {
    expect(readFileSync(join(ROOT, DOC), "utf8")).toBe(
      render(mapping, snapshots),
    )
  })
})
