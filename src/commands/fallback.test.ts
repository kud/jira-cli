import { afterEach, describe, expect, it, vi } from "vitest"
import { isExitError } from "./context.js"
import {
  jacSearchUrl,
  openCommand,
  openUrl,
  refuse,
  refusalText,
  setOpener,
  type Opener,
} from "./fallback.js"
import { boardSettingsUrl } from "./greenhopper.js"

const URL = "https://myorg.atlassian.net/secure/RapidView.jspa?rapidView=42"

describe("refusalText", () => {
  it("names a permission refusal, the page and a request for a Jira admin", () => {
    const text = refusalText({
      kind: "permission",
      action: "Changing card colours",
      object: "board 42",
      url: URL,
      permission: "board admin on board 42",
      command: "jira board colours set 42 Bug #f00",
    })

    expect(text.split("\n")).toEqual([
      "Changing card colours for board 42 — permission refusal.",
      "Open this now:",
      URL,
      "Ask for it: a Jira admin",
      "  Could you grant my account board admin on board 42? I need it for changing card colours on board 42 (`jira board colours set 42 Bug #f00`). If you would rather not, could you make the change for me?",
    ])
  })

  it("leaves the page out of a permission refusal when none is known", () => {
    const text = refusalText({
      kind: "permission",
      action: "Managing automation rules",
      object: "project SHOP",
      permission: "the Administer Jira global permission",
      why: "manage automation rules",
    })

    expect(text).not.toMatch(/Open this now/)
    expect(text).not.toMatch(/https?:/)
    expect(text).toContain(
      "Could you grant my account the Administer Jira global permission? I need it to manage automation rules on project SHOP.",
    )
  })

  it("names a missing API, asks Atlassian and links a tracker search", () => {
    const text = refusalText({
      kind: "no-api",
      action: "Reading swimlanes",
      object: "board 42",
      url: `${URL}&tab=swimlanes`,
      search: {
        project: "JSWCLOUD",
        text: "swimlanes REST API",
        summary: "Public REST API to read and change a board's swimlanes",
      },
      detail: "it relies on the private board API",
    })

    const lines = text.split("\n")
    expect(lines.slice(0, 5)).toEqual([
      "Reading swimlanes for board 42 — no public API.",
      "it relies on the private board API",
      "Open this now:",
      `${URL}&tab=swimlanes`,
      "Ask for it: Atlassian",
    ])
    expect(text).toContain(
      `  Raise a feature request: "Public REST API to read and change a board's swimlanes"`,
    )
    expect(text).toContain(
      "https://jira.atlassian.com/issues/?jql=project%20%3D%20JSWCLOUD%20AND%20text%20~%20%22swimlanes%20REST%20API%22",
    )
  })
})

describe("jacSearchUrl", () => {
  it("encodes the JQL and escapes quotes in the text", () => {
    const url = jacSearchUrl({ project: "JRACLOUD", text: 'say "hi"' })
    expect(decodeURIComponent(url)).toBe(
      'https://jira.atlassian.com/issues/?jql=project = JRACLOUD AND text ~ "say \\"hi\\""',
    )
  })
})

describe("boardSettingsUrl", () => {
  it("builds the classic board-config page from the base URL and board ID", () => {
    expect(boardSettingsUrl("https://myorg.atlassian.net/", 42)).toBe(URL)
    expect(
      boardSettingsUrl("https://myorg.atlassian.net", 42, "cardColors"),
    ).toBe(`${URL}&tab=cardColors`)
  })
})

describe("openUrl", () => {
  it.each([
    ["darwin", "open", [URL]],
    ["linux", "xdg-open", [URL]],
    ["win32", "cmd", ["/c", "start", '""', URL]],
  ] as const)("on %s runs %s", (platform, command, args) => {
    expect(openCommand(URL, platform)).toEqual({ command, args })
  })

  it("spawns detached and lets go of the child", () => {
    const unref = vi.fn()
    const launch = vi.fn(() => ({ unref, on: vi.fn() }))

    openUrl(URL, "darwin", launch)

    expect(launch).toHaveBeenCalledWith("open", [URL], {
      detached: true,
      stdio: "ignore",
    })
    expect(unref).toHaveBeenCalled()
  })

  it("swallows a launch that throws, the URL being printed already", () => {
    const launch = vi.fn(() => {
      throw new Error("ENOENT")
    })
    expect(() => openUrl(URL, "linux", launch)).not.toThrow()
  })
})

describe("refuse", () => {
  let previous: Opener | undefined
  afterEach(() => {
    if (previous) setOpener(previous)
    previous = undefined
  })

  const refusal = {
    kind: "no-api" as const,
    action: "Reading card colours",
    object: "board 42",
    url: `${URL}&tab=cardColors`,
  }

  it("keeps the exit code it is given", () => {
    const error = refuse(2, refusal)
    expect(isExitError(error) && error.code).toBe(2)
  })

  it("opens exactly the page with open, and nothing without", () => {
    const opener = vi.fn()
    previous = setOpener(opener)

    refuse(2, refusal)
    expect(opener).not.toHaveBeenCalled()

    refuse(2, refusal, true)
    expect(opener).toHaveBeenCalledExactlyOnceWith(`${URL}&tab=cardColors`)
  })

  it("says so when asked to open with no page known", () => {
    const opener = vi.fn()
    previous = setOpener(opener)

    const error = refuse(4, { ...refusal, url: undefined }, true)

    expect(opener).not.toHaveBeenCalled()
    expect(error.message).toContain("--open: no web page is known")
  })
})
