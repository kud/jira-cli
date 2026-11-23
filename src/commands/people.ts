import type { Command } from "commander"
import { table } from "../output/format.js"
import { context, exitError, printJson } from "./context.js"
import { adminPermissions, formatAdminPermissions } from "./permissions.js"

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
    .option(
      "--permissions",
      "also show whether this account is a global admin and a project admin",
    )
    .option(
      "-p, --project <key>",
      "with --permissions, check project admin on this project",
    )
    .option("--json", "emit JSON")
    .addHelpText(
      "after",
      `
Examples:
  jira whoami --permissions
  jira whoami --permissions --project SHOP
`,
    )
    .action(
      async (options: {
        json?: boolean
        permissions?: boolean
        project?: string
      }) => {
        if (options.project && !options.permissions)
          throw exitError(1, "--project only applies with --permissions")
        const ctx = context()
        const [me, permissions] = await Promise.all([
          ctx.client.getMe(),
          options.permissions
            ? adminPermissions(ctx.client, options.project)
            : undefined,
        ])
        if (options.json)
          return printJson(permissions ? { ...me, permissions } : me)
        process.stdout.write(
          `${me.displayName} <${me.emailAddress ?? "—"}>\n${ctx.out.dim(me.accountId)}\n`,
        )
        if (permissions)
          process.stdout.write(`\n${formatAdminPermissions(permissions)}\n`)
      },
    )
}
