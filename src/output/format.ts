export type Colour = (s: string) => string

const identity: Colour = (s) => s

const wrap =
  (open: string, close: string): Colour =>
  (s) =>
    `\u001b[${open}m${s}\u001b[${close}m`

/**
 * Colour is decided once, from the stream we actually write to. A pipe gets
 * plain text so `jira issue list | grep` matches what the user sees, and
 * NO_COLOR is honoured because this output is meant to be machine-read.
 */
/**
 * Monochrome by design: weight and dimming carry structure, never hue. Colour
 * would be the only thing separating two states for a colourblind reader, and
 * this output is meant to be piped as often as it is read.
 */
export const palette = (
  isTty: boolean,
  env: NodeJS.ProcessEnv = process.env,
) => {
  const on = isTty && !env["NO_COLOR"] && env["TERM"] !== "dumb"
  const c = (open: string, close: string): Colour =>
    on ? wrap(open, close) : identity
  return {
    on,
    dim: c("2", "22"),
    bold: c("1", "22"),
  }
}

export type Palette = ReturnType<typeof palette>

const ANSI = /\u001b\[[0-9;]*m/g

const width = (s: string): number => s.replace(ANSI, "").length

const pad = (s: string, to: number): string =>
  s + " ".repeat(Math.max(0, to - width(s)))

export type Column<T> = {
  header: string
  value: (row: T) => string
  align?: "left" | "right"
}

/**
 * Two spaces between columns rather than box drawing: the output is meant to
 * survive `awk '{print $1}'`, and a border character would become field one.
 */
export const table = <T>(rows: T[], columns: Column<T>[]): string => {
  if (rows.length === 0) return ""
  const cells = rows.map((r) => columns.map((c) => c.value(r)))
  const widths = columns.map((c, i) =>
    Math.max(width(c.header), ...cells.map((row) => width(row[i] as string))),
  )

  const line = (values: string[]): string =>
    values
      .map((v, i) => {
        const w = widths[i] as number
        return columns[i]?.align === "right"
          ? " ".repeat(Math.max(0, w - width(v))) + v
          : pad(v, w)
      })
      .join("  ")
      .trimEnd()

  return [line(columns.map((c) => c.header)), ...cells.map(line)].join("\n")
}

export const truncate = (s: string, max: number): string =>
  s.length <= max ? s : `${s.slice(0, Math.max(0, max - 1))}…`
