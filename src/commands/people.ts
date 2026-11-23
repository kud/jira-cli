import type { Command } from "commander"
import { table } from "../output/format.js"
import { context, exitError, printJson } from "./context.js"
import {
  adminPermissions,
  boardAdmin,
  formatAdminPermissions,
} from "./permissions.js"

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
    .option(
      "-b, --board <id>",
      "with --permissions, also check board admin on this board",
    )
    .option("--json", "emit JSON")
    .addHelpText(
      "after",
      `
Board admin is a role of its own: it grants board settings, not project
permissions, so moving issues into a sprint still needs Schedule issues and
Edit issues on their project.

Examples:
  jira whoami --permissions
  jira whoami --permissions --project SHOP --board 42
`,
    )
    .action(
      async (options: {
        json?: boolean
        permissions?: boolean
        project?: string
        board?: string
      }) => {
        if ((options.project || options.board) && !options.permissions)
          throw exitError(
            1,
            "--project and --board only apply with --permissions",
          )
        const boardId =
          options.board === undefined ? undefined : Number(options.board)
        if (
          boardId !== undefined &&
          (!Number.isInteger(boardId) || boardId < 1)
        )
          throw exitError(1, "--board must be a board ID, a positive number")
        const ctx = context()
        const [me, admin, board] = await Promise.all([
          ctx.client.getMe(),
          options.permissions
            ? adminPermissions(ctx.client, options.project)
            : undefined,
          boardId !== undefined ? boardAdmin(ctx.client, boardId) : undefined,
        ])
        const permissions = admin && (board ? { ...admin, board } : admin)
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
