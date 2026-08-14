import type { Command } from "commander"
import { table } from "../output/format.js"
import { context, printJson } from "./context.js"

export const registerUserCommands = (program: Command): void => {
  const user = program.command("user").description("find people")

  user
    .command("search <query>")
    .description("search users by name or email")
    .option("-p, --project <key>", "only users assignable on this project")
    .option("-n, --limit <n>", "maximum users to return", "20")
    .action(
      async (query: string, options: { project?: string; limit: string }) => {
        const ctx = context()
        const users = options.project
          ? await ctx.client.searchAssignableUsers(
              query,
              options.project,
              Number(options.limit),
            )
          : await ctx.client.searchUsers(query, Number(options.limit))

        process.stdout.write(
          `${table(users, [
            { header: "ACCOUNT ID", value: (u) => u.accountId },
            { header: "NAME", value: (u) => u.displayName },
            { header: "EMAIL", value: (u) => u.emailAddress ?? "—" },
          ])}\n`,
        )
      },
    )

  program
    .command("whoami")
    .description("show the account these credentials belong to")
    .option("--json", "emit JSON")
    .action(async (options: { json?: boolean }) => {
      const ctx = context()
      const me = await ctx.client.getMe()
      if (options.json) return printJson(me)
      process.stdout.write(
        `${me.displayName} <${me.emailAddress ?? "—"}>\n${ctx.out.dim(me.accountId)}\n`,
      )
    })
}
