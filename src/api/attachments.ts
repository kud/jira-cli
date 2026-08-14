import type { JiraClient } from "./client.js"
import type { JiraIssue } from "./types.js"

export type JiraAttachment = {
  id: string
  filename: string
  mimeType: string
  size: number
  created?: string
  author?: { displayName: string }
  content?: string
}

/** Where an attachment was referenced from, so `issue view` can say so. */
export type AttachmentOrigin =
  | { kind: "issue" }
  | { kind: "description" }
  | { kind: "comment"; commentId: string; author?: string }

export type LocatedAttachment = JiraAttachment & { origins: AttachmentOrigin[] }

type AdfNode = {
  type?: string
  attrs?: Record<string, unknown>
  content?: AdfNode[]
}

/** Every media node id reachable from an ADF document, in document order. */
const mediaIds = (node: unknown): string[] => {
  if (!node || typeof node !== "object") return []
  const n = node as AdfNode
  const here =
    n.type === "media" && typeof n.attrs?.["id"] === "string"
      ? [n.attrs["id"] as string]
      : []
  return [...here, ...(n.content ?? []).flatMap(mediaIds)]
}

/**
 * Jira reports attachments once, on the issue, while ADF media nodes reference
 * them by the same id from inside the description and from inside individual
 * comments. Walking both and joining on id is the only way to answer "which
 * comment did this file come from", which the raw API never states.
 */
export const locateAttachments = (issue: JiraIssue): LocatedAttachment[] => {
  const attachments = (issue.fields["attachment"] as JiraAttachment[]) ?? []
  const byId = new Map<string, AttachmentOrigin[]>()

  const note = (id: string, origin: AttachmentOrigin): void => {
    byId.set(id, [...(byId.get(id) ?? []), origin])
  }

  for (const id of mediaIds(issue.fields.description))
    note(id, { kind: "description" })

  for (const comment of issue.fields.comment?.comments ?? [])
    for (const id of mediaIds(comment.body))
      note(id, {
        kind: "comment",
        commentId: comment.id,
        author: comment.author?.displayName,
      })

  return attachments.map((a) => ({
    ...a,
    origins: byId.get(a.id) ?? [{ kind: "issue" as const }],
  }))
}

const TEXTUAL =
  /^(text\/|application\/(json|xml|x-yaml|yaml|javascript|sql|x-sh))/

/** Extensions Jira commonly mislabels as application/octet-stream. */
const TEXTUAL_EXTENSIONS =
  /\.(txt|md|markdown|log|json|ya?ml|csv|tsv|xml|html?|css|jsx?|tsx?|py|rb|go|rs|java|kt|sh|zsh|bash|sql|ini|toml|conf|env|diff|patch)$/i

export const isTextual = (attachment: JiraAttachment): boolean =>
  TEXTUAL.test(attachment.mimeType) ||
  TEXTUAL_EXTENSIONS.test(attachment.filename)

/**
 * Fetches attachment bytes. The documented content endpoint 302s to a
 * short-lived media host, and the auth header must NOT follow: it is a Jira
 * credential and the redirect target is a different origin that neither needs
 * nor should see it. Hence manual redirect handling rather than fetch's default.
 */
export const downloadAttachment = async (
  client: JiraClient,
  id: string,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): Promise<{ bytes: Uint8Array; mimeType: string | null }> => {
  const res = await client.request<Response>(
    `/rest/api/3/attachment/content/${encodeURIComponent(id)}`,
    { redirect: "manual", raw: true },
  )

  const location = res.headers.get("location")
  const final =
    res.status >= 300 && res.status < 400 && location
      ? await fetchImpl(location)
      : res

  if (!final.ok) {
    throw new Error(
      `could not download attachment ${id}: ${final.status} ${final.statusText}`,
    )
  }

  return {
    bytes: new Uint8Array(await final.arrayBuffer()),
    mimeType: final.headers.get("content-type"),
  }
}
