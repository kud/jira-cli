import { spawn } from "node:child_process"
import { exitError, type ExitError } from "./context.js"

/**
 * When Jira refuses something, the CLI still leaves a way forward: the web
 * page where a person can do it by hand, and who to ask for the access or the
 * API that is missing. Two kinds of refusal, named in the first line so the
 * reader knows which one they hold:
 *
 * - `permission`: Jira answered 403, or the action is admin-only. A Jira
 *   admin can fix it.
 * - `no-api`: there is no public API for it, or only a private one the user
 *   has not opted into. Only Atlassian can fix it.
 */
export type RefusalKind = "permission" | "no-api"

/** A search on Atlassian's public tracker, jira.atlassian.com. */
export type FeatureSearch = {
  /** JSWCLOUD for Jira Software features (boards), JRACLOUD for the platform. */
  project: "JSWCLOUD" | "JRACLOUD"
  /** Free text for the tracker's `text ~` search. */
  text: string
  /** One line to paste as the summary of a new feature request. */
  summary: string
}

export type Refusal = {
  kind: RefusalKind
  /** What was attempted, as a sentence start: "Reading swimlanes". */
  action: string
  /** What it was attempted on: "board 42", "project SHOP". */
  object: string
  /** The web UI page that does the same thing, when one is known. */
  url?: string
  /** The permission that is missing, for `permission`. */
  permission?: string
  /** Why it is needed, in the request to the admin. */
  why?: string
  /** The command that was refused, quoted in the request to the admin. */
  command?: string
  /** Where to look for, or raise, a feature request, for `no-api`. */
  search?: FeatureSearch
  /** The existing explanation, kept between the headline and the way out. */
  detail?: string
}

const JAC = "https://jira.atlassian.com/issues/?jql="

/** The tracker search for a feature, never a guessed issue key. */
export const jacSearchUrl = (search: Pick<FeatureSearch, "project" | "text">) =>
  JAC +
  encodeURIComponent(
    `project = ${search.project} AND text ~ "${search.text.replace(/"/g, '\\"')}"`,
  )

const LABEL: Record<RefusalKind, string> = {
  permission: "permission refusal",
  "no-api": "no public API",
}

const permissionRequest = (r: Refusal): string => {
  const permission = r.permission ?? "the permission this needs"
  const need = r.why ? `to ${r.why}` : `for ${r.action.toLowerCase()}`
  const command = r.command ? ` (\`${r.command}\`)` : ""
  return (
    `Could you grant my account ${permission}? I need it ${need} on ${r.object}${command}. ` +
    "If you would rather not, could you make the change for me?"
  )
}

/**
 * The text of a refusal, in the same shape everywhere: what failed and which
 * kind, then the page to open, bare on its own line, then who to ask and a
 * request ready to paste.
 */
export const refusalText = (r: Refusal): string => {
  const lines = [`${r.action} for ${r.object} — ${LABEL[r.kind]}.`]
  if (r.detail) lines.push(r.detail)
  if (r.url) lines.push("Open this now:", r.url)
  if (r.kind === "permission") {
    lines.push("Ask for it: a Jira admin", `  ${permissionRequest(r)}`)
  } else {
    lines.push("Ask for it: Atlassian")
    if (r.search)
      lines.push(
        `  Raise a feature request: "${r.search.summary}"`,
        `  Check for an existing one first: ${jacSearchUrl(r.search)}`,
      )
    else lines.push("  Raise a feature request at https://jira.atlassian.com")
  }
  return lines.join("\n")
}

export type Opener = (url: string) => void

type Launch = (
  command: string,
  args: string[],
  options: { detached: boolean; stdio: "ignore"; shell?: boolean },
) => { unref: () => void; on?: (event: "error", fn: () => void) => unknown }

/** The platform's own "open this URL" command. */
export const openCommand = (
  url: string,
  platform: NodeJS.Platform = process.platform,
): { command: string; args: string[] } => {
  if (platform === "darwin") return { command: "open", args: [url] }
  // `start` is a cmd built-in; its first quoted argument is a window title.
  if (platform === "win32")
    return { command: "cmd", args: ["/c", "start", '""', url] }
  return { command: "xdg-open", args: [url] }
}

/**
 * Hands the URL to the system browser and does not wait for it: a browser
 * that stays open must not hold the CLI open too. A failure to launch is
 * swallowed, since the URL is already printed for the person to open.
 */
export const openUrl = (
  url: string,
  platform: NodeJS.Platform = process.platform,
  launch: Launch = spawn as unknown as Launch,
): void => {
  const { command, args } = openCommand(url, platform)
  try {
    const child = launch(command, args, { detached: true, stdio: "ignore" })
    child.on?.("error", () => undefined)
    child.unref()
  } catch {
    // The printed URL is the fallback.
  }
}

let opener: Opener = (url) => openUrl(url)

/** Swaps the opener, for tests; returns the one it replaced. */
export const setOpener = (next: Opener): Opener => {
  const previous = opener
  opener = next
  return previous
}

/**
 * The refusal as the error a command throws, exit code unchanged. With
 * `open`, the page is launched too; without a page to launch, the message
 * says so rather than failing silently.
 */
export const refuse = (
  code: number,
  refusal: Refusal,
  open?: boolean,
): ExitError => {
  if (open && refusal.url) opener(refusal.url)
  const note =
    open && !refusal.url ? "\n(--open: no web page is known for this)" : ""
  return exitError(code, refusalText(refusal) + note)
}
