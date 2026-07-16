import type { JiraDocNode } from "../types.js"

const renderNode = (
  node: JiraDocNode,
  indent = 0,
  orderedIndex?: number,
): string => {
  switch (node.type) {
    case "text":
      return node.text ?? ""
    case "paragraph":
      return (node.content?.map((n) => renderNode(n)).join("") ?? "") + "\n"
    case "hardBreak":
      return "\n"
    case "heading": {
      const level = (node.attrs?.["level"] as number) ?? 1
      const text = node.content?.map((n) => renderNode(n)).join("") ?? ""
      return `${"#".repeat(level)} ${text}\n`
    }
    case "bulletList":
      return (
        (node.content?.map((n) => renderNode(n, indent)).join("") ?? "") + "\n"
      )
    case "orderedList":
      return (
        (node.content?.map((n, i) => renderNode(n, indent, i + 1)).join("") ??
          "") + "\n"
      )
    case "listItem": {
      const prefix =
        " ".repeat(indent * 2) +
        (orderedIndex !== undefined ? `${orderedIndex}. ` : "• ")
      const body =
        node.content?.map((n) => renderNode(n, indent + 1)).join("") ?? ""
      return prefix + body.trimStart()
    }
    case "codeBlock": {
      const code = node.content?.map((n) => renderNode(n)).join("") ?? ""
      return "```\n" + code + "\n```\n"
    }
    case "inlineCard":
      return (node.attrs?.["url"] as string) ?? ""
    case "mention":
      return `@${(node.attrs?.["text"] as string) ?? "someone"}`
    case "doc":
      return node.content?.map((n) => renderNode(n)).join("") ?? ""
    default:
      return node.content?.map((n) => renderNode(n)).join("") ?? ""
  }
}

export const docToText = (doc: JiraDocNode | null | undefined): string => {
  if (!doc) return ""
  return renderNode(doc)
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}
