import { writeFileSync } from "node:fs"
import { basename, resolve } from "node:path"
import type { Command } from "commander"
import {
  downloadAttachment,
  isTextual,
  locateAttachments,
  type LocatedAttachment,
} from "../api/attachments.js"
import { table } from "../output/format.js"
import { context, exitError, printJson } from "./context.js"

const humanSize = (bytes: number): string => {
  const units = ["B", "KB", "MB", "GB"]
  const exponent = Math.min(
    units.length - 1,
    Math.floor(Math.log(Math.max(bytes, 1)) / Math.log(1024)),
  )
  const value = bytes / 1024 ** exponent
  return `${exponent === 0 ? value : value.toFixed(1)}${units[exponent]}`
}

const describeOrigin = (a: LocatedAttachment): string =>
  a.origins
    .map((o) =>
      o.kind === "comment"
        ? `comment by ${o.author ?? "unknown"}`
        : o.kind === "description"
          ? "description"
          : "issue",
    )
    .join(", ")

/** Resolve a user-supplied selector to exactly one attachment, or fail loudly. */
const pick = (
  attachments: LocatedAttachment[],
  selector: string,
): LocatedAttachment => {
  const byId = attachments.find((a) => a.id === selector)
  if (byId) return byId

  const matches = attachments.filter(
    (a) =>
      a.filename === selector ||
      a.filename.toLowerCase().includes(selector.toLowerCase()),
  )
  if (matches.length === 1) return matches[0] as LocatedAttachment
  if (matches.length === 0)
    throw exitError(
      1,
      `no attachment matching '${selector}'. Available: ${
        attachments.map((a) => a.filename).join(", ") || "none"
      }`,
    )
  throw exitError(
    1,
    `'${selector}' matches ${matches.length} attachments: ${matches
      .map((a) => `${a.filename} (${a.id})`)
      .join(", ")}. Use the id.`,
  )
}

export const registerAttachmentCommands = (program: Command): void => {
  const attachment = program
    .command("attachment")
    .alias("attach")
    .description("list and read files attached to an issue")

  attachment
    .command("list <key>")
    .alias("ls")
    .description("list the files attached to an issue")
    .option("--json", "emit JSON")
    .action(async (key: string, options: { json?: boolean }) => {
      const ctx = context()
      const attachments = locateAttachments(await ctx.client.getIssue(key))

      if (options.json) return printJson(attachments)
      if (attachments.length === 0) {
        process.stderr.write(`${key} has no attachments\n`)
        return
      }

      process.stdout.write(
        `${table(attachments, [
          { header: "ID", value: (a) => a.id },
          { header: "FILENAME", value: (a) => a.filename },
          { header: "SIZE", value: (a) => humanSize(a.size), align: "right" },
          { header: "TYPE", value: (a) => a.mimeType },
          { header: "FROM", value: (a) => describeOrigin(a) },
        ])}\n`,
      )
    })

  attachment
    .command("read <key> <selector>")
    .alias("cat")
    .description("print a text attachment to stdout")
    .action(async (key: string, selector: string) => {
      const ctx = context()
      const attachments = locateAttachments(await ctx.client.getIssue(key))
      const target = pick(attachments, selector)

      const { bytes, mimeType } = await downloadAttachment(
        ctx.client,
        target.id,
      )

      if (!isTextual(target) && !mimeType?.startsWith("text/")) {
        throw exitError(
          1,
          `${target.filename} is ${target.mimeType}, not text. ` +
            `Use: jira attachment get ${key} ${selector} --output <path>`,
        )
      }
      process.stdout.write(new TextDecoder().decode(bytes))
    })

  attachment
    .command("get <key> <selector>")
    .alias("download")
    .description("download an attachment to a file")
    .option("-o, --output <path>", "destination path, or '-' for stdout")
    .action(
      async (key: string, selector: string, options: { output?: string }) => {
        const ctx = context()
        const attachments = locateAttachments(await ctx.client.getIssue(key))
        const target = pick(attachments, selector)
        const { bytes } = await downloadAttachment(ctx.client, target.id)

        if (options.output === "-") {
          process.stdout.write(bytes)
          return
        }

        // Never trust the server-supplied filename as a path: basename() keeps a
        // crafted "../../.ssh/authorized_keys" inside the directory we chose.
        const destination = resolve(
          options.output ?? basename(target.filename) ?? target.id,
        )
        writeFileSync(destination, bytes)
        process.stderr.write(
          `${target.filename} → ${destination} (${humanSize(bytes.length)})\n`,
        )
      },
    )
}
