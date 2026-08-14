import { describe, expect, it } from "vitest"
import { adfToMarkdown } from "./adf.js"
import { isTextual, locateAttachments } from "./attachments.js"
import type { JiraIssue } from "./types.js"

const mediaDoc = (id: string) => ({
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "see this:" }] },
    {
      type: "mediaSingle",
      content: [{ type: "media", attrs: { id, type: "file" } }],
    },
  ],
})

const attachment = (id: string, filename: string, mimeType = "text/plain") => ({
  id,
  filename,
  mimeType,
  size: 10,
})

const issueWith = (fields: Partial<JiraIssue["fields"]>): JiraIssue => ({
  id: "1",
  key: "ABC-1",
  self: "",
  fields: { summary: "s", ...fields },
})

describe("locateAttachments", () => {
  it("reports an attachment nobody references as belonging to the issue", () => {
    const [found] = locateAttachments(
      issueWith({ attachment: [attachment("10", "notes.txt")] }),
    )

    expect(found?.origins).toEqual([{ kind: "issue" }])
  })

  it("attributes an attachment embedded in the description", () => {
    const [found] = locateAttachments(
      issueWith({
        attachment: [attachment("10", "notes.txt")],
        description: mediaDoc("10"),
      }),
    )

    expect(found?.origins).toEqual([{ kind: "description" }])
  })

  it("attributes an attachment to the comment that embedded it", () => {
    const [found] = locateAttachments(
      issueWith({
        attachment: [attachment("10", "trace.log")],
        comment: {
          comments: [
            {
              id: "c1",
              author: { accountId: "a", displayName: "Ada" },
              body: mediaDoc("10"),
            },
          ],
        },
      }),
    )

    expect(found?.origins).toEqual([
      { kind: "comment", commentId: "c1", author: "Ada" },
    ])
  })

  it("records every place a single file was embedded", () => {
    const [found] = locateAttachments(
      issueWith({
        attachment: [attachment("10", "shared.png")],
        description: mediaDoc("10"),
        comment: {
          comments: [{ id: "c1", body: mediaDoc("10") }],
        },
      }),
    )

    expect(found?.origins).toHaveLength(2)
  })
})

describe("isTextual", () => {
  it("accepts declared text types", () => {
    expect(isTextual(attachment("1", "a.txt", "text/plain"))).toBe(true)
    expect(isTextual(attachment("1", "a.json", "application/json"))).toBe(true)
  })

  it("falls back to the extension, since Jira mislabels uploads", () => {
    expect(
      isTextual(attachment("1", "server.log", "application/octet-stream")),
    ).toBe(true)
  })

  it("rejects binaries", () => {
    expect(isTextual(attachment("1", "shot.png", "image/png"))).toBe(false)
  })
})

describe("adfToMarkdown media resolution", () => {
  it("names the file when the resolver knows it", () => {
    expect(adfToMarkdown(mediaDoc("10"), () => "trace.log")).toContain(
      "[attachment: trace.log]",
    )
  })

  it("falls back to the id rather than dropping the reference", () => {
    expect(adfToMarkdown(mediaDoc("10"))).toContain("[attachment: 10]")
  })
})

describe("adfToMarkdown structure", () => {
  it("renders a table, which the previous renderer silently dropped", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                {
                  type: "tableHeader",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "h" }],
                    },
                  ],
                },
              ],
            },
            {
              type: "tableRow",
              content: [
                {
                  type: "tableCell",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "v" }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    }

    expect(adfToMarkdown(doc)).toBe("| h |\n| --- |\n| v |")
  })

  it("renders a panel as a callout rather than losing it", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "panel",
          attrs: { panelType: "warning" },
          content: [
            { type: "paragraph", content: [{ type: "text", text: "careful" }] },
          ],
        },
      ],
    }

    expect(adfToMarkdown(doc)).toBe("> [!WARNING]\n> careful")
  })

  it("keeps link and code marks", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "docs",
              marks: [{ type: "link", attrs: { href: "https://x.test" } }],
            },
            { type: "text", text: " and " },
            { type: "text", text: "code", marks: [{ type: "code" }] },
          ],
        },
      ],
    }

    expect(adfToMarkdown(doc)).toBe("[docs](https://x.test) and `code`")
  })
})
