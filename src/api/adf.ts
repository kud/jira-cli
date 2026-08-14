type AdfNode = {
  type?: string
  text?: string
  content?: AdfNode[]
  attrs?: Record<string, unknown>
  marks?: { type: string; attrs?: Record<string, unknown> }[]
}

const markUp = (text: string, marks: AdfNode["marks"]): string =>
  (marks ?? []).reduce((acc, mark) => {
    if (mark.type === "code") return `\`${acc}\``
    if (mark.type === "strong") return `**${acc}**`
    if (mark.type === "em") return `_${acc}_`
    if (mark.type === "strike") return `~~${acc}~~`
    if (mark.type === "link") return `[${acc}](${mark.attrs?.["href"] ?? ""})`
    return acc
  }, text)

export type MediaResolver = (id: string) => string | undefined

let resolveMedia: MediaResolver = () => undefined

const children = (node: AdfNode, sep = ""): string =>
  (node.content ?? []).map(render).join(sep)

const listItems = (node: AdfNode, bullet: (i: number) => string): string =>
  (node.content ?? [])
    .map((item, i) => {
      const body = children(item, "\n\n").trim()
      const [first = "", ...rest] = body.split("\n")
      const marker = bullet(i)
      const indent = " ".repeat(marker.length)
      return [
        `${marker}${first}`,
        ...rest.map((l) => (l ? `${indent}${l}` : l)),
      ].join("\n")
    })
    .join("\n")

/** A table row rendered as a pipe row; the header separator is added by the caller. */
const row = (node: AdfNode): string =>
  `| ${(node.content ?? []).map((cell) => children(cell, " ").trim().replace(/\n+/g, " ")).join(" | ")} |`

const renderTable = (node: AdfNode): string => {
  const rows = node.content ?? []
  if (rows.length === 0) return ""
  const isHeader = (r: AdfNode): boolean =>
    (r.content ?? []).some((c) => c.type === "tableHeader")
  const [first] = rows
  const rendered = rows.map(row)
  if (first && isHeader(first)) {
    const columns = (first.content ?? []).length
    rendered.splice(1, 0, `|${" --- |".repeat(columns)}`)
  }
  return rendered.join("\n")
}

const render = (node: AdfNode): string => {
  switch (node.type) {
    case "doc":
      return children(node, "\n\n")
    case "paragraph":
      return children(node)
    case "text":
      return markUp(node.text ?? "", node.marks)
    case "hardBreak":
      return "\n"
    case "heading":
      return `${"#".repeat(Number(node.attrs?.["level"] ?? 1))} ${children(node)}`
    case "bulletList":
      return listItems(node, () => "- ")
    case "orderedList":
      return listItems(
        node,
        (i) => `${Number(node.attrs?.["order"] ?? 1) + i}. `,
      )
    case "codeBlock":
      return `\`\`\`${node.attrs?.["language"] ?? ""}\n${children(node)}\n\`\`\``
    case "blockquote":
      return children(node, "\n\n")
        .split("\n")
        .map((l) => `> ${l}`)
        .join("\n")
    case "panel":
      return `> [!${String(node.attrs?.["panelType"] ?? "note").toUpperCase()}]\n${children(
        node,
        "\n\n",
      )
        .split("\n")
        .map((l) => `> ${l}`)
        .join("\n")}`
    case "rule":
      return "---"
    case "table":
      return renderTable(node)
    case "mediaSingle":
    case "mediaGroup":
      return children(node, "\n")
    case "media": {
      const id = String(node.attrs?.["id"] ?? "")
      const name = resolveMedia(id)
      return name ? `[attachment: ${name}]` : `[attachment: ${id || "unknown"}]`
    }
    case "mention":
      return `@${node.attrs?.["text"] ?? node.attrs?.["id"] ?? ""}`
    case "emoji":
      return String(node.attrs?.["text"] ?? node.attrs?.["shortName"] ?? "")
    case "date":
      return String(node.attrs?.["timestamp"] ?? "")
    case "status":
      return `[${String(node.attrs?.["text"] ?? "").toUpperCase()}]`
    case "inlineCard":
      return String(node.attrs?.["url"] ?? "")
    default:
      return children(node, "\n\n")
  }
}

/**
 * Atlassian Document Format to Markdown. Deliberately stops at Markdown rather
 * than emitting ANSI: rendering is the surface's job, so a TUI, a pager and a
 * `--json` consumer all get the same text and only one of them styles it.
 */
export const adfToMarkdown = (
  doc: unknown,
  media?: MediaResolver,
): string => {
  if (typeof doc === "string") return doc
  if (!doc || typeof doc !== "object") return ""
  const previous = resolveMedia
  resolveMedia = media ?? (() => undefined)
  try {
    return render(doc as AdfNode)
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  } finally {
    resolveMedia = previous
  }
}
