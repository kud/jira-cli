import type { Command } from "commander"
import { isJiraApiError, type JiraClient } from "@kud/jira"
import { table, truncate } from "../output/format.js"
import { context, exitError, printJson, type Context } from "./context.js"
import {
  addCardColor,
  boardSettingsUrl,
  explainPrivateApiFailure,
  getEditModel,
  PRIVATE_API_HELP,
  removeCardColor,
  requirePrivateApi,
  setCardColorStrategy,
  strategyId,
  updateCardColor,
  type BoardFallback,
  type CardColor,
  type EditModel,
} from "./greenhopper.js"
import { refuse } from "./fallback.js"

type Fallback = Omit<BoardFallback, "boardId">

const OPEN_HELP = "if Jira refuses, open the board's settings page in a browser"

/**
 * The site's base URL for a refusal's link. Reading it must not turn a
 * refusal into a missing-environment error, so a broken config gives none.
 */
const siteUrl = (): string | undefined => {
  try {
    return context().config.baseUrl
  } catch {
    return undefined
  }
}

type Request = JiraClient["request"]

/**
 * The public board configuration, wider than JiraBoardConfiguration: WIP
 * limits, estimation, ranking and the Kanban sub-filter are all in the same
 * response, just not in the core type.
 * https://developer.atlassian.com/cloud/jira/software/rest/api-group-board/#api-rest-agile-1-0-board-boardid-configuration-get
 */
export type BoardSettingsConfiguration = {
  id?: number
  name?: string
  type?: string
  filter?: { id?: string }
  subQuery?: { query?: string }
  columnConfig?: {
    columns?: {
      name: string
      statuses?: { id: string }[]
      min?: number
      max?: number
    }[]
    constraintType?: string
  }
  estimation?: {
    type?: string
    field?: { fieldId?: string; displayName?: string }
  }
  ranking?: { rankCustomFieldId?: number }
}

export type QuickFilter = {
  id: number | string
  name: string
  jql?: string
  description?: string
}

export type BoardFeature = { feature?: string; state?: string }

export const getBoardSettingsConfiguration = (
  request: Request,
  boardId: number,
): Promise<BoardSettingsConfiguration> =>
  request<BoardSettingsConfiguration>(
    `/rest/agile/1.0/board/${boardId}/configuration`,
  )

/**
 * Paged like the board list: follow startAt until isLast, and stop on an
 * empty page too, so a page that says isLast: false with nothing in it
 * cannot loop forever.
 * https://developer.atlassian.com/cloud/jira/software/rest/api-group-board/#api-rest-agile-1-0-board-boardid-quickfilter-get
 */
export const listQuickFilters = async (
  request: Request,
  boardId: number,
): Promise<QuickFilter[]> => {
  const filters: QuickFilter[] = []
  for (let startAt = 0; ;) {
    const page = await request<{
      values?: QuickFilter[]
      isLast?: boolean
      startAt?: number
    }>(
      `/rest/agile/1.0/board/${boardId}/quickfilter?startAt=${startAt}&maxResults=50`,
    )
    const values = page?.values ?? []
    filters.push(...values)
    if (page?.isLast !== false || values.length === 0) return filters
    startAt = (page.startAt ?? startAt) + values.length
  }
}

export const getBoardFeatures = async (
  request: Request,
  boardId: number,
): Promise<BoardFeature[]> => {
  const result = await request<{ features?: BoardFeature[] }>(
    `/rest/agile/1.0/board/${boardId}/features`,
  )
  return result?.features ?? []
}

const boardIdOf = (raw: string): number => {
  const id = Number(raw)
  if (!Number.isInteger(id) || id < 1)
    throw exitError(2, `board ID must be a positive number, got '${raw}'`)
  return id
}

const readEditModel = async (
  ctx: Context,
  boardId: number,
  fallback?: Fallback,
): Promise<EditModel> => {
  try {
    return await getEditModel(ctx.client.request, boardId)
  } catch (error) {
    throw explainPrivateApiFailure(error, boardId, {
      baseUrl: ctx.config.baseUrl,
      ...fallback,
    })
  }
}

/** A refused optional section prints as unavailable rather than failing the screen. */
const orUnavailable = async <T>(read: Promise<T>): Promise<T | undefined> => {
  try {
    return await read
  } catch (error) {
    if (isJiraApiError(error) && error.status >= 400 && error.status < 500)
      return undefined
    throw error
  }
}

// ---------------------------------------------------------------- strategies

/**
 * The CLI's names for the card colour strategies, against what the edit
 * model calls them. `queries` is the JQL strategy, which the edit model has
 * been seen to call `custom`.
 */
export const COLOUR_STRATEGIES: Record<string, string> = {
  none: "none",
  issuetype: "issuetype",
  priority: "priority",
  assignee: "assignee",
  queries: "custom",
}

const strategyLabel = (id: string | undefined): string => {
  if (!id) return "—"
  const name = Object.entries(COLOUR_STRATEGIES).find(([, v]) => v === id)?.[0]
  return name && name !== id ? `${name} (${id})` : id
}

export const parseStrategy = (raw: string): string => {
  const id = COLOUR_STRATEGIES[raw.toLowerCase()]
  if (!id)
    throw exitError(
      2,
      `unknown colour strategy '${raw}' — use one of ${Object.keys(COLOUR_STRATEGIES).join(", ")}`,
    )
  return id
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

export const parseHex = (raw: string): string => {
  if (!HEX.test(raw))
    throw exitError(2, `'${raw}' is not a hex colour — use #rgb or #rrggbb`)
  return raw.toLowerCase()
}

const sameColour = (a: string | undefined, b: string): boolean => {
  const expand = (c: string): string =>
    c.length === 4
      ? `#${[...c.slice(1)].map((x) => x + x).join("")}`
      : c.toLowerCase()
  return !!a && HEX.test(a) && expand(a.toLowerCase()) === expand(b)
}

const currentStrategy = (model: EditModel): string | undefined =>
  strategyId(model.cardColorConfig?.cardColorStrategy)

/** Colours that belong to the strategy in force; an untagged colour counts. */
const coloursFor = (model: EditModel, strategy?: string): CardColor[] =>
  (model.cardColorConfig?.cardColors ?? []).filter(
    (c) => !c.strategy || !strategy || c.strategy === strategy,
  )

const colourName = (c: CardColor): string =>
  c.displayValue ?? c.value ?? String(c.id ?? "?")

// ---------------------------------------------------------------- writes

export type Change = { what: string; before?: string; after?: string }

export const formatChange = (c: Change): string =>
  `${c.what}: ${c.before ?? "(none)"} → ${c.after ?? "(removed)"}`

/**
 * Board edits are refused up front when the edit model already says this
 * account cannot make them; a write that would only answer 403 is not worth
 * sending.
 */
const assertCanEdit = (
  model: EditModel,
  boardId: number,
  fallback: Fallback,
): void => {
  if (model.canEdit === false || model.cardColorConfig?.canEdit === false)
    throw refuse(
      4,
      {
        kind: "permission",
        action: fallback.action,
        object: `board ${boardId}`,
        url: fallback.baseUrl
          ? boardSettingsUrl(fallback.baseUrl, boardId, fallback.tab)
          : undefined,
        permission: `board admin on board ${boardId} (or project admin on the board's location)`,
        command: fallback.command,
        detail:
          `Jira says this account cannot edit board ${boardId}'s settings (canEdit: false).\n` +
          "It needs board admin on this board, or project admin on the board's location.\n" +
          `Check with: jira whoami --permissions --board ${boardId}`,
      },
      fallback.open,
    )
}

type WriteOptions = {
  yes?: boolean
  json?: boolean
  privateApi?: boolean
  open?: boolean
}

/**
 * Every colour write is a dry run unless --yes says otherwise: print what
 * would change, change nothing. With --yes, apply, re-read the edit model and
 * say whether the change shows, since these calls are not known to work on
 * every site.
 */
const runWrite = async (
  ctx: Context,
  boardId: number,
  changes: Change[],
  options: WriteOptions,
  apply: () => Promise<unknown>,
  took: (after: EditModel) => boolean,
  fallback: Fallback,
): Promise<void> => {
  if (changes.length === 0) {
    if (options.json)
      return printJson({ board: boardId, dryRun: !options.yes, changes })
    process.stderr.write("nothing to change\n")
    return
  }
  if (!options.yes) {
    if (options.json)
      return printJson({ board: boardId, dryRun: true, changes })
    process.stdout.write(`${changes.map(formatChange).join("\n")}\n`)
    process.stderr.write("dry run — re-run with --yes to apply\n")
    return
  }
  try {
    await apply()
  } catch (error) {
    throw explainPrivateApiFailure(error, boardId, fallback)
  }
  const applied = took(await readEditModel(ctx, boardId, fallback))
  if (!applied) process.exitCode = 1
  if (options.json)
    return printJson({ board: boardId, dryRun: false, changes, applied })
  process.stdout.write(`${changes.map(formatChange).join("\n")}\n`)
  process.stderr.write(
    applied
      ? "applied — the board now shows the change\n"
      : "Jira accepted the call, but the board does not show the change on a re-read\n",
  )
}

// ---------------------------------------------------------------- rendering

const yesNo = (v: boolean | undefined): string =>
  v === undefined ? "—" : v ? "yes" : "no"

const renderPublic = (
  ctx: Context,
  config: BoardSettingsConfiguration,
  statusNames: Map<string, string>,
  features: BoardFeature[] | undefined,
  quickFilters: QuickFilter[] | undefined,
): string[] => {
  const { dim } = ctx.out
  const lines: string[] = [
    config.name ?? "board",
    `${dim("type")}  ${config.type ?? "—"}`,
  ]
  const constraint = config.columnConfig?.constraintType
  lines.push(
    `${dim("columns")}${constraint && constraint !== "none" ? `  ${dim(`WIP counts ${constraint}`)}` : ""}`,
  )
  for (const col of config.columnConfig?.columns ?? []) {
    const statuses = (col.statuses ?? [])
      .map((s) => statusNames.get(s.id) ?? s.id)
      .join(", ")
    const wip = [
      col.min !== undefined ? `min ${col.min}` : "",
      col.max !== undefined ? `max ${col.max}` : "",
    ]
      .filter(Boolean)
      .join(" ")
    lines.push(
      `  ${col.name}  ${dim(statuses || "—")}${wip ? `  WIP ${wip}` : ""}`,
    )
  }
  lines.push(
    `${dim("estimation")}  ${config.estimation?.field?.displayName ?? config.estimation?.type ?? "—"}`,
    `${dim("ranking")}  ${
      config.ranking?.rankCustomFieldId !== undefined
        ? `customfield_${config.ranking.rankCustomFieldId}`
        : "—"
    }`,
  )
  if (config.subQuery?.query !== undefined)
    lines.push(`${dim("sub-filter")}  ${config.subQuery.query || "—"}`)
  lines.push(`${dim("features")}${features ? "" : "  unavailable"}`)
  for (const f of features ?? [])
    lines.push(`  ${f.feature ?? "?"}  ${dim(f.state ?? "—")}`)
  lines.push(
    `${dim("quick filters")}${
      quickFilters ? (quickFilters.length ? "" : "  none") : "  unavailable"
    }`,
  )
  for (const q of quickFilters ?? [])
    lines.push(`  ${q.name}  ${dim(q.jql ?? "")}`)
  return lines
}

const renderPrivate = (ctx: Context, model: EditModel): string[] => {
  const { dim } = ctx.out
  const lines = [
    "",
    dim("private API (unsupported, may change without notice)"),
    `${dim("can edit")}  ${yesNo(model.canEdit)}`,
    ...renderSwimlanes(ctx, model),
    ...renderColours(ctx, model),
  ]
  const fields = model.cardLayoutConfig?.currentFields
  if (fields)
    lines.push(
      `${dim("card layout")}  ${
        fields
          .map(
            (f) =>
              `${f.displayName ?? f.name ?? f.fieldId ?? "?"}${f.mode ? ` (${f.mode.toLowerCase()})` : ""}`,
          )
          .join(", ") || "—"
      }`,
    )
  const days = model.workingDaysConfig
  if (days) {
    const week = Object.entries(days.weekDays ?? {})
      .filter(([, on]) => on)
      .map(([day]) => day)
    const tz = days.timeZoneEditModel?.currentTimeZoneId ?? days.timeZone
    const off = (days.nonWorkingDays ?? [])
      .map((d) => d.iso8601Date)
      .filter(Boolean)
    lines.push(
      `${dim("working days")}  ${week.join(", ") || "—"}${tz ? `  ${dim(tz)}` : ""}`,
    )
    if (off.length) lines.push(`${dim("non-working days")}  ${off.join(", ")}`)
  }
  const admins = model.boardAdmins
  if (admins) {
    const names = (
      xs?: { key?: string; name?: string; displayName?: string }[],
    ) => (xs ?? []).map((x) => x.displayName ?? x.name ?? x.key ?? "?")
    const users = names(admins.userKeys)
    const groups = names(admins.groupKeys)
    lines.push(
      `${dim("board admins")}  ${[...users, ...groups.map((g) => `group ${g}`)].join(", ") || "—"}`,
    )
  }
  return lines
}

const renderSwimlanes = (ctx: Context, model: EditModel): string[] => {
  const { dim } = ctx.out
  const config = model.swimlanesConfig
  if (!config) return [`${dim("swimlanes")}  —`]
  return [
    `${dim("swimlanes")}  ${strategyId(config.swimlaneStrategy) ?? "—"}`,
    ...(config.swimlanes ?? []).map(
      (s) =>
        `  ${s.name ?? "?"}  ${dim(s.query || (s.isDefault ? "(everything else)" : ""))}`,
    ),
  ]
}

const renderColours = (ctx: Context, model: EditModel): string[] => {
  const { dim } = ctx.out
  if (!model.cardColorConfig) return [`${dim("card colours")}  —`]
  const strategy = currentStrategy(model)
  return [
    `${dim("card colours")}  ${strategyLabel(strategy)}`,
    ...coloursFor(model, strategy).map(
      (c) =>
        `  ${colourName(c)}  ${c.color ?? "—"}  ${dim(`id ${c.id ?? "?"}`)}`,
    ),
  ]
}

const colourFallback = (
  action: string,
  command: string,
  open: boolean | undefined,
): Fallback => ({ action, tab: "cardColors", command, open })

// ---------------------------------------------------------------- commands

/**
 * Hangs the settings commands off the existing `board` command, so agile.ts
 * only needs the one call to pick them up.
 */
export const registerBoardSettingsCommands = (board: Command): void => {
  board
    .command("settings <id>")
    .description(
      "a board's settings on one screen: columns, WIP, estimation, quick filters",
    )
    .option("--private-api", PRIVATE_API_HELP)
    .option("--json", "emit JSON")
    .option("--open", OPEN_HELP)
    .addHelpText(
      "after",
      `
The public Agile API gives columns, WIP limits, estimation, ranking, the
Kanban sub-filter, features and quick filters. --private-api adds swimlanes,
card colours, card layout, working days and board admins from Jira's private
board API, which Atlassian does not support.

Examples:
  jira board settings 42
  jira board settings 42 --private-api --json
`,
    )
    .action(
      async (
        raw: string,
        options: { privateApi?: boolean; json?: boolean; open?: boolean },
      ) => {
        const boardId = boardIdOf(raw)
        const ctx = context()
        const request = ctx.client.request
        const fallback: Fallback = {
          action: "Reading the board's private settings",
          baseUrl: ctx.config.baseUrl,
          command: `jira board settings ${boardId} --private-api`,
          open: options.open,
        }
        const [config, features, quickFilters, statuses, model] =
          await Promise.all([
            getBoardSettingsConfiguration(request, boardId),
            orUnavailable(getBoardFeatures(request, boardId)),
            orUnavailable(listQuickFilters(request, boardId)),
            ctx.client.getStatuses(),
            options.privateApi
              ? readEditModel(ctx, boardId, fallback)
              : undefined,
          ])
        if (options.json)
          return printJson({
            configuration: config,
            features: features ?? null,
            quickFilters: quickFilters ?? null,
            ...(model ? { private: model } : {}),
          })
        const statusNames = new Map(statuses.map((s) => [s.id, s.name]))
        const lines = renderPublic(
          ctx,
          config,
          statusNames,
          features,
          quickFilters,
        )
        if (model) lines.push(...renderPrivate(ctx, model))
        process.stdout.write(`${lines.join("\n")}\n`)
      },
    )

  board
    .command("quickfilters <id>")
    .description("a board's quick filters")
    .option("--json", "emit JSON")
    .action(async (raw: string, options: { json?: boolean }) => {
      const boardId = boardIdOf(raw)
      const filters = await listQuickFilters(context().client.request, boardId)
      if (options.json) return printJson(filters)
      if (filters.length === 0) {
        process.stderr.write("no quick filters\n")
        return
      }
      process.stdout.write(
        `${table(filters, [
          { header: "ID", value: (q) => String(q.id) },
          { header: "NAME", value: (q) => q.name },
          { header: "JQL", value: (q) => q.jql ?? "" },
          {
            header: "DESCRIPTION",
            value: (q) => truncate(q.description ?? "", 40),
          },
        ])}\n`,
      )
    })

  board
    .command("swimlanes <id>")
    .description("a board's swimlanes (private API)")
    .option("--private-api", PRIVATE_API_HELP)
    .option("--json", "emit JSON")
    .option("--open", OPEN_HELP)
    .action(
      async (
        raw: string,
        options: { privateApi?: boolean; json?: boolean; open?: boolean },
      ) => {
        const boardId = boardIdOf(raw)
        const fallback: Fallback = {
          action: "Reading swimlanes",
          tab: "swimlanes",
          command: `jira board swimlanes ${boardId}`,
          open: options.open,
        }
        requirePrivateApi(options.privateApi, "jira board swimlanes", {
          ...fallback,
          boardId,
          baseUrl: siteUrl(),
        })
        const ctx = context()
        const model = await readEditModel(ctx, boardId, fallback)
        if (options.json) return printJson(model.swimlanesConfig ?? null)
        process.stdout.write(`${renderSwimlanes(ctx, model).join("\n")}\n`)
      },
    )

  const colours = board
    .command("colours")
    .alias("colors")
    .description("a board's card colours, and changing them (private API)")
    .argument("[id]", "board ID")
    .option("--private-api", PRIVATE_API_HELP)
    .option("--json", "emit JSON")
    .option("--open", OPEN_HELP)
    .addHelpText(
      "after",
      `
Every change is a dry run until --yes: it prints what would change, as
before → after, and changes nothing. With --yes it applies the change, then
re-reads the board and says whether it took. The write calls are not
documented by Atlassian and have not been verified on every site.

Examples:
  jira board colours 42 --private-api
  jira board colours strategy 42 priority --private-api
  jira board colours set 42 Bug '#d04437' --private-api --yes
  jira board colours set 42 'priority = Highest' '#f00' --add --private-api
  jira board colours remove 42 7 --private-api --yes
`,
    )
    .action(
      async (
        raw: string | undefined,
        options: { privateApi?: boolean; json?: boolean; open?: boolean },
      ) => {
        if (raw === undefined) return colours.help()
        const boardId = boardIdOf(raw)
        const fallback = colourFallback(
          "Reading card colours",
          `jira board colours ${boardId}`,
          options.open,
        )
        requirePrivateApi(options.privateApi, "jira board colours", {
          ...fallback,
          boardId,
          baseUrl: siteUrl(),
        })
        const ctx = context()
        const model = await readEditModel(ctx, boardId, fallback)
        if (options.json) return printJson(model.cardColorConfig ?? null)
        process.stdout.write(`${renderColours(ctx, model).join("\n")}\n`)
      },
    )

  // Commander hands an option the parent also declares to the parent, even
  // when it is typed after the subcommand, so the two are merged here.
  const withParent = <T extends WriteOptions>(own: T): T => ({
    ...(colours.opts() as WriteOptions),
    ...own,
  })

  const writeOptions = (command: Command): Command =>
    command
      .option("--private-api", PRIVATE_API_HELP)
      .option("--yes", "apply the change; without it, only show the diff")
      .option("--json", "emit the planned or applied change as JSON")
      .option("--open", OPEN_HELP)

  writeOptions(
    colours
      .command("strategy <id> <strategy>")
      .description(
        "colour cards by none, issuetype, priority, assignee or queries",
      ),
  ).action(async (raw: string, name: string, own: WriteOptions) => {
    const options = withParent(own)
    const boardId = boardIdOf(raw)
    const target = parseStrategy(name)
    const fallback = colourFallback(
      "Changing card colours",
      `jira board colours strategy ${boardId} ${name}`,
      options.open,
    )
    requirePrivateApi(options.privateApi, "jira board colours strategy", {
      ...fallback,
      boardId,
      baseUrl: siteUrl(),
    })
    const ctx = context()
    const model = await readEditModel(ctx, boardId, fallback)
    assertCanEdit(model, boardId, { baseUrl: ctx.config.baseUrl, ...fallback })
    const before = currentStrategy(model)
    const changes: Change[] =
      before === target
        ? []
        : [
            {
              what: "card colour strategy",
              before: strategyLabel(before),
              after: strategyLabel(target),
            },
          ]
    await runWrite(
      ctx,
      boardId,
      changes,
      options,
      () => setCardColorStrategy(ctx.client.request, boardId, target),
      (after) => currentStrategy(after) === target,
      fallback,
    )
  })

  writeOptions(
    colours
      .command("set <id> <value> <hex>")
      .description(
        "set the colour for an issue type, priority or assignee, or a query's colour under the queries strategy",
      )
      .option("--add", "add a new query colour (queries strategy only)"),
  ).action(
    async (
      raw: string,
      value: string,
      hexRaw: string,
      own: WriteOptions & { add?: boolean },
    ) => {
      const options = withParent(own)
      const boardId = boardIdOf(raw)
      const hex = parseHex(hexRaw)
      const fallback = colourFallback(
        "Changing card colours",
        `jira board colours set ${boardId} '${value}' ${hex}`,
        options.open,
      )
      requirePrivateApi(options.privateApi, "jira board colours set", {
        ...fallback,
        boardId,
        baseUrl: siteUrl(),
      })
      const ctx = context()
      const model = await readEditModel(ctx, boardId, fallback)
      assertCanEdit(model, boardId, {
        baseUrl: ctx.config.baseUrl,
        ...fallback,
      })
      const strategy = currentStrategy(model)
      const known = coloursFor(model, strategy)

      if (options.add) {
        if (strategy !== COLOUR_STRATEGIES["queries"])
          throw exitError(
            2,
            `--add only applies to the queries strategy; board ${boardId} colours by ${strategyLabel(strategy)}`,
          )
        const changes: Change[] = [
          { what: `query colour "${value}"`, after: hex },
        ]
        return runWrite(
          ctx,
          boardId,
          changes,
          options,
          () =>
            addCardColor(ctx.client.request, boardId, { value, color: hex }),
          (after) =>
            coloursFor(after, strategy).some(
              (c) => c.value === value && sameColour(c.color, hex),
            ),
          fallback,
        )
      }

      const wanted = value.toLowerCase()
      const found = known.find(
        (c) =>
          c.value?.toLowerCase() === wanted ||
          c.displayValue?.toLowerCase() === wanted,
      )
      if (!found || found.id === undefined)
        throw exitError(
          1,
          `no ${strategyLabel(strategy)} colour for '${value}' on board ${boardId}` +
            (strategy === COLOUR_STRATEGIES["queries"]
              ? " — use --add to add a query colour"
              : `; known: ${known.map(colourName).join(", ") || "none"}`),
        )
      const colorId = String(found.id)
      const changes: Change[] = sameColour(found.color, hex)
        ? []
        : [
            {
              what: `colour ${colourName(found)}`,
              before: found.color,
              after: hex,
            },
          ]
      await runWrite(
        ctx,
        boardId,
        changes,
        options,
        () =>
          updateCardColor(ctx.client.request, boardId, colorId, {
            ...(found.value !== undefined ? { value: found.value } : {}),
            color: hex,
          }),
        (after) =>
          (after.cardColorConfig?.cardColors ?? []).some(
            (c) => String(c.id) === colorId && sameColour(c.color, hex),
          ),
        fallback,
      )
    },
  )

  writeOptions(
    colours
      .command("remove <id> <colorId>")
      .description("remove a card colour by its ID (as `colours` lists it)"),
  ).action(async (raw: string, colorId: string, own: WriteOptions) => {
    const options = withParent(own)
    const boardId = boardIdOf(raw)
    const fallback = colourFallback(
      "Changing card colours",
      `jira board colours remove ${boardId} ${colorId}`,
      options.open,
    )
    requirePrivateApi(options.privateApi, "jira board colours remove", {
      ...fallback,
      boardId,
      baseUrl: siteUrl(),
    })
    const ctx = context()
    const model = await readEditModel(ctx, boardId, fallback)
    assertCanEdit(model, boardId, { baseUrl: ctx.config.baseUrl, ...fallback })
    const found = (model.cardColorConfig?.cardColors ?? []).find(
      (c) => String(c.id) === colorId,
    )
    if (!found)
      throw exitError(
        1,
        `board ${boardId} has no card colour with ID ${colorId}`,
      )
    await runWrite(
      ctx,
      boardId,
      [
        {
          what: `colour ${colourName(found)} (id ${colorId})`,
          before: found.color,
        },
      ],
      options,
      () => removeCardColor(ctx.client.request, boardId, colorId),
      (after) =>
        !(after.cardColorConfig?.cardColors ?? []).some(
          (c) => String(c.id) === colorId,
        ),
      fallback,
    )
  })
}
