#!/usr/bin/env node
/**
 * Builds docs/coverage.md from Atlassian's own OpenAPI specs and the
 * hand-maintained coverage/mapping.json.
 *
 *   npm run coverage              regenerate from the committed spec snapshots
 *   npm run coverage -- --fetch   refresh the snapshots from Atlassian first
 *   npm run coverage -- --check   exit 1 if docs/coverage.md is stale
 *
 * Only --fetch touches the network; everything else, tests and CI included,
 * reads the slim snapshots under coverage/.
 */
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const at = (path) => join(ROOT, path)

export const SPECS = {
  platform: {
    title: "Jira Cloud platform REST API (v3)",
    url: "https://developer.atlassian.com/cloud/jira/platform/swagger-v3.v3.json",
    file: "coverage/spec-platform.json",
  },
  software: {
    title: "Jira Software Cloud REST API (Agile 1.0)",
    url: "https://developer.atlassian.com/cloud/jira/software/swagger.v3.json",
    file: "coverage/spec-software.json",
  },
}

export const DOC = "docs/coverage.md"
const MAPPING = "coverage/mapping.json"
const GREENHOPPER = "src/commands/greenhopper.ts"
const VERBS = ["get", "post", "put", "delete", "patch"]
const UNTAGGED = "(untagged)"

const readJson = (path) => JSON.parse(readFileSync(at(path), "utf8"))

export const loadSnapshot = (name) => readJson(SPECS[name].file)
export const loadMapping = () => readJson(MAPPING)

/** Keeps only what coverage needs, so a spec update shows as a small diff. */
export const slim = (spec, url) => {
  const operations = []
  for (const [path, item] of Object.entries(spec.paths ?? {}))
    for (const verb of VERBS) {
      const op = item[verb]
      if (!op) continue
      operations.push({
        operationId: op.operationId,
        method: verb.toUpperCase(),
        path,
        tags: op.tags ?? [],
        summary: op.summary ?? "",
        deprecated: op.deprecated === true,
      })
    }
  operations.sort(
    (a, b) =>
      tagOf(a).localeCompare(tagOf(b)) ||
      a.path.localeCompare(b.path) ||
      a.method.localeCompare(b.method),
  )
  return { source: url, version: spec.info?.version ?? "", operations }
}

export const tagOf = (op) => op.tags[0] ?? UNTAGGED

/**
 * An entry for the operation wins, then the spec's own deprecated flag, then
 * the tag's default. Undefined means nobody has decided yet, which the test
 * refuses.
 */
export const resolve = (op, section) =>
  section.operations[op.operationId] ??
  (op.deprecated ? { wontDo: "deprecated" } : undefined) ??
  section.tags[tagOf(op)]

export const statusOf = (entry) =>
  entry.command ? "wrapped" : entry.notWrapped ? "notWrapped" : "wontDo"

export const commandsOf = (entry) =>
  entry.command === undefined
    ? []
    : Array.isArray(entry.command)
      ? entry.command
      : [entry.command]

/** Every way the mapping and a snapshot can disagree, as readable lines. */
export const problems = (mapping, snapshots) => {
  const found = []
  const reasons = new Set(Object.keys(mapping.reasons))
  const checkEntry = (where, entry) => {
    const kinds = ["command", "notWrapped", "wontDo"].filter(
      (k) => entry[k] !== undefined,
    )
    if (kinds.length !== 1)
      found.push(`${where}: needs exactly one of command, notWrapped, wontDo`)
    if (entry.wontDo !== undefined && !reasons.has(entry.wontDo))
      found.push(`${where}: unknown wontDo reason "${entry.wontDo}"`)
    if (entry.wontDo === "other" && !entry.note)
      found.push(`${where}: wontDo "other" needs a note`)
  }
  for (const [name, snapshot] of Object.entries(snapshots)) {
    const section = mapping[name]
    const ids = new Set(snapshot.operations.map((op) => op.operationId))
    const tags = new Set(snapshot.operations.map(tagOf))
    for (const op of snapshot.operations)
      if (!resolve(op, section))
        found.push(
          `${name}: ${op.operationId} (${op.method} ${op.path}) has no mapping`,
        )
    for (const [id, entry] of Object.entries(section.operations)) {
      if (!ids.has(id))
        found.push(`${name}: mapping names ${id}, absent from the spec`)
      checkEntry(`${name}: ${id}`, entry)
    }
    for (const [tag, entry] of Object.entries(section.tags)) {
      if (!tags.has(tag))
        found.push(`${name}: mapping names tag "${tag}", absent from the spec`)
      checkEntry(`${name}: tag "${tag}"`, entry)
    }
  }
  return found
}

/** Every command name the mapping claims, for checking against the CLI. */
export const claimedCommands = (mapping) => {
  const all = new Set()
  for (const name of Object.keys(SPECS))
    for (const entry of [
      ...Object.values(mapping[name].operations),
      ...Object.values(mapping[name].tags),
    ])
      for (const command of commandsOf(entry)) all.add(command)
  for (const commands of Object.values(mapping.private.commands))
    for (const command of commands) all.add(command)
  return [...all].sort()
}

/**
 * The private board calls, read from the one file allowed to make them, so
 * the doc cannot list a call the CLI no longer makes.
 */
export const privateCalls = (
  source = readFileSync(at(GREENHOPPER), "utf8"),
) => {
  const calls = []
  const fn = /export const (\w+) = \(([\s\S]*?)(?=\nexport const |\n\/\*\*|$)/g
  for (const [, name, body] of source.matchAll(fn)) {
    const path = body.match(/`\$\{BASE\}([^`?]*)/)
    if (!path) continue
    const method = body.match(/method: "(\w+)"/)?.[1] ?? "GET"
    calls.push({
      name,
      method,
      path: `/rest/greenhopper/1.0${path[1].replace(/\$\{[^}]*?(\w+)\)?\}/g, "{$1}")}`,
    })
  }
  return calls
}

const cell = (text) => String(text).replace(/\|/g, "\\|")
const code = (text) => `\`${text}\``

const statusCell = (entry, mapping) => {
  if (entry.command) return commandsOf(entry).map(code).join(", ")
  const note = entry.note ? ` (${entry.note})` : ""
  if (entry.notWrapped) return `not wrapped${note}`
  return `won't do: ${mapping.reasons[entry.wontDo].label.toLowerCase()}${note}`
}

const count = (rows) => {
  const totals = { wrapped: 0, notWrapped: 0, wontDo: {}, all: rows.length }
  for (const { entry } of rows) {
    const status = statusOf(entry)
    if (status === "wontDo")
      totals.wontDo[entry.wontDo] = (totals.wontDo[entry.wontDo] ?? 0) + 1
    else totals[status]++
  }
  return totals
}

const pct = (n, d) => (d === 0 ? "—" : `${Math.round((100 * n) / d)}%`)

export const render = (mapping, snapshots, calls = privateCalls()) => {
  const reasonKeys = Object.keys(mapping.reasons)
  const per = Object.fromEntries(
    Object.entries(snapshots).map(([name, snapshot]) => [
      name,
      snapshot.operations.map((op) => ({
        op,
        entry: resolve(op, mapping[name]),
      })),
    ]),
  )

  const out = [
    "<!-- Generated by scripts/coverage.mjs from coverage/mapping.json and coverage/spec-*.json. Do not edit by hand: change the mapping, then run `npm run coverage`. -->",
    "",
    "# Jira Cloud API coverage",
    "",
    "Every operation in Atlassian's published OpenAPI specs for Jira Cloud, and what `jira` does with it. Generated: edit `coverage/mapping.json`, then run `npm run coverage` (add `-- --fetch` to pull the latest specs first). A test fails when the specs and the mapping disagree.",
    "",
    "- **Wrapped**: a command calls this operation.",
    "- **Not wrapped**: allowed with an ordinary API token, no command yet. `jira api <path> -X <method>` still reaches it.",
    "- **Won't do**: closed to an ordinary user token, or not worth a command, for the reason given.",
    "",
    "## Headline",
    "",
    `| **Spec** | **Operations** | **Wrapped** | **Not wrapped** | ${reasonKeys.map((k) => `**${mapping.reasons[k].label}**`).join(" | ")} | **Wrapped of reachable** |`,
    `| --- | ---: | ---: | ---: | ${reasonKeys.map(() => "---:").join(" | ")} | ---: |`,
  ]
  for (const [name, rows] of Object.entries(per)) {
    const t = count(rows)
    out.push(
      `| ${SPECS[name].title} | ${t.all} | ${t.wrapped} | ${t.notWrapped} | ${reasonKeys.map((k) => t.wontDo[k] ?? 0).join(" | ")} | ${pct(t.wrapped, t.wrapped + t.notWrapped)} |`,
    )
  }
  out.push(
    "",
    '"Reachable" is wrapped plus not wrapped: what an ordinary API token can call at all.',
    "",
    "## Won't-do reasons",
    "",
    "| **Reason** | **Why** | **Fallback** |",
    "| --- | --- | --- |",
    ...reasonKeys.map((k) => {
      const r = mapping.reasons[k]
      return `| ${r.label} | ${cell(r.why)} | ${cell(r.fallback)} |`
    }),
    "",
    "## Sources",
    "",
    ...Object.entries(snapshots).map(
      ([name, s]) =>
        `- ${SPECS[name].title}: <${s.source}>, version \`${s.version}\`.`,
    ),
  )

  for (const [name, rows] of Object.entries(per)) {
    out.push("", `## ${SPECS[name].title}`)
    const byTag = new Map()
    for (const row of rows) {
      const tag = tagOf(row.op)
      if (!byTag.has(tag)) byTag.set(tag, [])
      byTag.get(tag).push(row)
    }
    for (const [tag, tagRows] of byTag) {
      const t = count(tagRows)
      out.push(
        "",
        `### ${tag}`,
        "",
        `${t.all} ${t.all === 1 ? "operation" : "operations"}: ${t.wrapped} wrapped, ${t.notWrapped} not wrapped, ${t.all - t.wrapped - t.notWrapped} won't do.`,
        "",
        "| **Method** | **Path** | **Operation** | **Status** |",
        "| --- | --- | --- | --- |",
        ...tagRows.map(
          ({ op, entry }) =>
            `| ${op.method} | ${code(op.path)} | ${code(op.operationId)}${op.deprecated ? " (deprecated)" : ""} | ${cell(statusCell(entry, mapping))} |`,
        ),
      )
    }
  }

  out.push(
    "",
    "## Private board API (not counted)",
    "",
    "Most board configuration has no public write. Jira's web UI uses a private API, `/rest/greenhopper/1.0`, that Atlassian does not document or support. The CLI reaches it only behind `--private-api`, from `src/commands/greenhopper.ts`, and none of it counts as coverage above.",
    "",
    "| **Method** | **Path** | **Function** | **Commands** |",
    "| --- | --- | --- | --- |",
    ...calls.map(
      (c) =>
        `| ${c.method} | ${code(c.path)} | ${code(c.name)} | ${(mapping.private.commands[c.name] ?? []).map(code).join(", ") || "—"} |`,
    ),
    "",
    "The edit model read carries card colours, swimlanes, card layout, working days and board admins.",
    "",
    "Board settings only the private API can change, and nothing wraps yet:",
    "",
    "| **Setting** | **Note** |",
    "| --- | --- |",
    ...mapping.private.unwrapped.map(
      (u) => `| ${cell(u.capability)} | ${cell(u.note)} |`,
    ),
    "",
    "## Outside these specs",
    "",
    "- **Automation** has its own API (`/gateway/api/automation/public/jira/{cloudId}/rest/v1`), outside both specs: `jira automation list/get/create/update/enable/disable` wrap it. Managing rules needs Administer Jira.",
    "- **Reports** (sprint report, velocity, burndown) are in no public API.",
    "",
    "What other Jira tools wrap, for comparison: [coverage-peers.md](./coverage-peers.md).",
    "",
  )
  return out.join("\n")
}

const fetchSpecs = async () => {
  for (const [name, spec] of Object.entries(SPECS)) {
    const res = await fetch(spec.url, {
      headers: { "user-agent": "spec-fetch/1.0" },
    })
    if (!res.ok) throw new Error(`${spec.url} answered ${res.status}`)
    writeFileSync(
      at(spec.file),
      `${JSON.stringify(slim(await res.json(), spec.url), null, 2)}\n`,
    )
    process.stderr.write(`fetched ${name}\n`)
  }
}

const main = async (args) => {
  if (args.includes("--fetch")) await fetchSpecs()
  const mapping = loadMapping()
  const snapshots = Object.fromEntries(
    Object.keys(SPECS).map((n) => [n, loadSnapshot(n)]),
  )
  const found = problems(mapping, snapshots)
  if (found.length > 0) {
    process.stderr.write(
      `coverage: the mapping and the specs disagree:\n  ${found.join("\n  ")}\n`,
    )
    process.exit(1)
  }
  const doc = render(mapping, snapshots)
  if (args.includes("--check")) {
    let current = ""
    try {
      current = readFileSync(at(DOC), "utf8")
    } catch {}
    if (current !== doc) {
      process.stderr.write(`coverage: ${DOC} is stale; run npm run coverage\n`)
      process.exit(1)
    }
    return
  }
  writeFileSync(at(DOC), doc)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`coverage: ${error.message}\n`)
    process.exit(1)
  })
