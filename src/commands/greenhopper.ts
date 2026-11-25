import { isJiraApiError, type JiraClient } from "@kud/jira"
import { exitError } from "./context.js"

/**
 * Every call to Jira's private board API (GreenHopper, /rest/greenhopper/1.0)
 * lives in this file and nowhere else. Atlassian does not document or support
 * it, and may change it without notice; when it breaks, deleting this file
 * and the commands that import it is the whole clean-up.
 *
 * Reading the board edit model has been tried against Jira Cloud and answers.
 * The card colour writes have NOT: their shapes come from the Jira Server
 * GreenHopper plugin's `cardcolors` resource. The one Cloud probe so far fits
 * it (GET on .../strategy answers 405, so another verb lives there, and GET on
 * the bare .../cardcolors/{id} answers 404), but that is all the evidence
 * there is. Every write is therefore re-read afterwards and reported on.
 */

type Request = JiraClient["request"]

const BASE = "/rest/greenhopper/1.0"

export const PRIVATE_API_FLAG = "--private-api"

export const PRIVATE_API_HELP =
  "use Jira's private API for boards (unsupported by Atlassian, may change without notice)"

/**
 * The private-only commands refuse to run without the flag, so nobody leans
 * on an unsupported API without having said so.
 */
export const requirePrivateApi = (
  enabled: boolean | undefined,
  what: string,
): void => {
  if (enabled) return
  throw exitError(
    2,
    `${what} relies on Jira's private board API, which Atlassian does not support\n` +
      "and may change without notice. Re-run with --private-api to use it anyway.",
  )
}

/**
 * The key names below are what the edit model has been seen to carry, not a
 * documented contract: everything is optional, and the raw object is kept
 * for --json so nothing the types miss is lost.
 */
export type CardColor = {
  id?: number | string
  value?: string
  displayValue?: string
  color?: string
  strategy?: string
}

export type Swimlane = {
  id?: number | string
  name?: string
  query?: string
  description?: string
  isDefault?: boolean
}

export type LayoutField = {
  id?: number | string
  fieldId?: string
  name?: string
  displayName?: string
  mode?: string
}

type Named = { key?: string; name?: string; displayName?: string }

export type EditModel = {
  id?: number
  name?: string
  canEdit?: boolean
  cardColorConfig?: {
    cardColorStrategy?: string | { id?: string }
    cardColors?: CardColor[]
    canEdit?: boolean
  }
  swimlanesConfig?: {
    swimlaneStrategy?: string | { id?: string }
    swimlanes?: Swimlane[]
    canEdit?: boolean
  }
  cardLayoutConfig?: {
    currentFields?: LayoutField[]
    canEdit?: boolean
  }
  workingDaysConfig?: {
    weekDays?: Record<string, boolean | undefined>
    timeZoneEditModel?: { currentTimeZoneId?: string }
    timeZone?: string
    nonWorkingDays?: { iso8601Date?: string }[]
  }
  boardAdmins?: {
    userKeys?: Named[]
    groupKeys?: Named[]
  }
  [key: string]: unknown
}

export const getEditModel = (
  request: Request,
  boardId: number,
): Promise<EditModel> =>
  request<EditModel>(
    `${BASE}/rapidviewconfig/editmodel.json?rapidViewId=${boardId}`,
  )

export const setCardColorStrategy = (
  request: Request,
  boardId: number,
  strategy: string,
): Promise<unknown> =>
  request(`${BASE}/cardcolors/${boardId}/strategy`, {
    method: "PUT",
    body: JSON.stringify({ id: strategy }),
  })

export const addCardColor = (
  request: Request,
  boardId: number,
  color: { value: string; color: string },
): Promise<unknown> =>
  request(`${BASE}/cardcolors/${boardId}/color`, {
    method: "POST",
    body: JSON.stringify(color),
  })

export const updateCardColor = (
  request: Request,
  boardId: number,
  colorId: string,
  color: { value?: string; color: string },
): Promise<unknown> =>
  request(
    `${BASE}/cardcolors/${boardId}/color/${encodeURIComponent(colorId)}`,
    { method: "PUT", body: JSON.stringify(color) },
  )

export const removeCardColor = (
  request: Request,
  boardId: number,
  colorId: string,
): Promise<unknown> =>
  request(
    `${BASE}/cardcolors/${boardId}/color/${encodeURIComponent(colorId)}`,
    { method: "DELETE" },
  )

/**
 * A private API answers its own breakage with 404, 405 or 410, which reads
 * as a bug in the caller unless someone says otherwise. 403 here means the
 * board's settings are closed to this account, which board admin or project
 * admin on the board's location opens.
 */
export const explainPrivateApiFailure = (
  error: unknown,
  boardId: number,
): unknown => {
  if (!isJiraApiError(error)) return error
  if ([404, 405, 410].includes(error.status))
    return exitError(
      1,
      `Jira's private board API did not answer this call (${error.status} on ${error.method}); it may have changed.\n` +
        `Board ${boardId} may also not exist. The supported commands (jira board view, jira board settings) still work.`,
    )
  if (error.status === 403)
    return exitError(
      4,
      `Jira refused board ${boardId}'s settings (403).\n` +
        "It needs board admin on this board, or project admin on the board's location.\n" +
        `Check with: jira whoami --permissions --board ${boardId}`,
    )
  return error
}

export const strategyId = (
  raw: string | { id?: string } | undefined,
): string | undefined => (typeof raw === "string" ? raw : raw?.id)
