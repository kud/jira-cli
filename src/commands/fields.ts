import type { JiraClient } from "@kud/jira"
import { exitError } from "./context.js"

/**
 * The field list as GET /rest/api/3/field returns it. `schema.items` is what
 * tells a list of options from a list of versions, so it is typed here even
 * though the core client's type stops at `type`.
 */
export type FieldDef = {
  id: string
  name: string
  custom?: boolean
  schema?: { type?: string; items?: string; custom?: string }
}

/** Commander's collector for repeatable options. */
export const collect = (value: string, prior: string[]): string[] => [
  ...prior,
  value,
]

/** `name=value`, splitting on the first `=` so values may contain more. */
export const parseFieldSpec = (spec: string): { name: string; raw: string } => {
  const at = spec.indexOf("=")
  if (at <= 0)
    throw exitError(
      1,
      `malformed --field '${spec}' — expected name=value, e.g. "Story Points=5"`,
    )
  return { name: spec.slice(0, at).trim(), raw: spec.slice(at + 1) }
}

/**
 * By ID first (`customfield_10016`), then by name ignoring case. Two fields
 * sharing a name is common on large sites, and picking one would write to the
 * wrong field silently, so that refuses with both IDs.
 */
export const findField = (fields: FieldDef[], name: string): FieldDef => {
  const byId = fields.find((f) => f.id === name)
  if (byId) return byId
  const wanted = name.toLowerCase()
  const byName = fields.filter((f) => f.name.toLowerCase() === wanted)
  if (byName.length === 1) return byName[0] as FieldDef
  if (byName.length > 1)
    throw exitError(
      1,
      `'${name}' names ${byName.length} fields: ${byName.map((f) => f.id).join(", ")} — use the ID`,
    )
  throw exitError(1, `no field '${name}' — see: jira fields '${name}'`)
}

const list = (raw: string): string[] =>
  raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)

/**
 * A typed value from text, by the field's schema. The shapes are the ones the
 * issue edit API documents per field type; anything this does not know is
 * sent as given, or as JSON when it looks like JSON, so an unusual field is
 * still reachable without a new release.
 * https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/#api-rest-api-3-issue-issueidorkey-put
 */
export const fieldValue = (field: FieldDef, raw: string): unknown => {
  const trimmed = raw.trim()
  if (trimmed === "" || trimmed.toLowerCase() === "none") return null
  if (/^[[{]/.test(trimmed)) {
    try {
      return JSON.parse(trimmed)
    } catch {
      // Not JSON after all; fall through to the typed reading.
    }
  }
  const type = field.schema?.type
  const items = field.schema?.items
  switch (type) {
    case "number": {
      const n = Number(trimmed)
      if (!Number.isFinite(n))
        throw exitError(1, `${field.name} takes a number, not '${raw}'`)
      return n
    }
    case "option":
      return { value: trimmed }
    case "priority":
    case "resolution":
    case "version":
    case "component":
      return { name: trimmed }
    case "user":
      return { accountId: trimmed }
    case "array":
      if (items === "string") return list(trimmed)
      if (items === "option") return list(trimmed).map((value) => ({ value }))
      if (items === "version" || items === "component")
        return list(trimmed).map((name) => ({ name }))
      if (items === "user")
        return list(trimmed).map((accountId) => ({ accountId }))
      return list(trimmed)
    default:
      return raw
  }
}

/**
 * Resolves every `--field` against this site's fields in one lookup, so a
 * typo fails before anything is written.
 */
export const resolveFields = async (
  client: Pick<JiraClient, "getFields">,
  specs: string[],
): Promise<Record<string, unknown>> => {
  if (specs.length === 0) return {}
  const all = (await client.getFields()) as FieldDef[]
  const out: Record<string, unknown> = {}
  for (const spec of specs) {
    const { name, raw } = parseFieldSpec(spec)
    const field = findField(all, name)
    out[field.id] = fieldValue(field, raw)
  }
  return out
}

/**
 * `--component` and `--fix-version` as sugar over the two list fields a team
 * lead sets most, by name, because names are what people know.
 */
export const listFieldSugar = (options: {
  component?: string[]
  fixVersion?: string[]
}): Record<string, unknown> => ({
  ...(options.component?.length
    ? { components: options.component.map((name) => ({ name })) }
    : {}),
  ...(options.fixVersion?.length
    ? { fixVersions: options.fixVersion.map((name) => ({ name })) }
    : {}),
})
