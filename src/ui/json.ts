import chalk from "chalk"

const indent = (depth: number): string => "  ".repeat(depth)

const colorizeValue = (value: unknown, depth: number): string => {
  if (value === null) return chalk.dim("null")
  if (typeof value === "boolean") return chalk.yellow(String(value))
  if (typeof value === "number") return chalk.cyan(String(value))
  if (typeof value === "string") return chalk.green(JSON.stringify(value))
  if (Array.isArray(value)) return colorizeArray(value, depth)
  if (typeof value === "object")
    return colorizeObject(value as Record<string, unknown>, depth)
  return String(value)
}

const colorizeArray = (arr: unknown[], depth: number): string => {
  if (arr.length === 0) return "[]"
  const items = arr.map(
    (v) => `${indent(depth + 1)}${colorizeValue(v, depth + 1)}`,
  )
  return `[\n${items.join(",\n")}\n${indent(depth)}]`
}

const colorizeObject = (
  obj: Record<string, unknown>,
  depth: number,
): string => {
  const keys = Object.keys(obj)
  if (keys.length === 0) return "{}"
  const entries = keys.map(
    (k) =>
      `${indent(depth + 1)}${chalk.blue(JSON.stringify(k))}: ${colorizeValue(obj[k], depth + 1)}`,
  )
  return `{\n${entries.join(",\n")}\n${indent(depth)}}`
}

export const colorizeJson = (value: unknown): string => colorizeValue(value, 0)
