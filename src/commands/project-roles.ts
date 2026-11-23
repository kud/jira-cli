import type { Command } from "commander"
import type { JiraClient } from "@kud/jira"
import { table, truncate } from "../output/format.js"
import { confirmDestructive } from "./confirm.js"
import { context, exitError, printJson } from "./context.js"
import { resolveAccountId } from "./issue-write.js"
import { projectAdminRefusal } from "./refusals.js"

/**
 * Project role membership: who is a Developer, an Administrator, and so on,
 * in one project. Reading and changing both need Administer Projects on the
 * project, or Administer Jira.
 * https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-project-role-actors/
 */

type Actor = {
  id?: number
  displayName?: string
  type?: string
  actorUser?: { accountId?: string }
  actorGroup?: { name?: string; displayName?: string; groupId?: string }
}

type Role = { id: number; name: string; actors?: Actor[] }

/** GET /project/{key}/role answers name → URL; the ID is the URL's tail. */
export const roleIds = (
  map: Record<string, string>,
): { name: string; id: string }[] =>
  Object.entries(map).map(([name, url]) => ({
    name,
    id: url.slice(url.lastIndexOf("/") + 1),
  }))

const listRoles = async (client: JiraClient, project: string) => {
  try {
    return roleIds(
      await client.request<Record<string, string>>(
        `/rest/api/3/project/${encodeURIComponent(project)}/role`,
      ),
    )
  } catch (error) {
    throw await projectAdminRefusal(
      error,
      client,
      project,
      `reading ${project}'s roles`,
    )
  }
}

export const findRole = (
  roles: { name: string; id: string }[],
  wanted: string,
): { name: string; id: string } => {
  const match =
    roles.find((r) => r.id === wanted) ??
    roles.find((r) => r.name.toLowerCase() === wanted.toLowerCase())
  if (!match)
    throw exitError(
      1,
      `no role '${wanted}' — this project has: ${roles.map((r) => r.name).join(", ")}`,
    )
  return match
}

const actorName = (a: Actor): string =>
  a.actorGroup
    ? `${a.actorGroup.displayName ?? a.actorGroup.name ?? a.displayName ?? "?"} (group)`
    : (a.displayName ?? a.actorUser?.accountId ?? "?")

const rolePath = (project: string, id: string): string =>
  `/rest/api/3/project/${encodeURIComponent(project)}/role/${encodeURIComponent(id)}`

export const registerProjectRoleCommands = (project: Command): void => {
  project
    .command("roles <key>")
    .description("a project's roles and who is in each")
    .option("--json", "emit JSON")
    .action(async (key: string, options: { json?: boolean }) => {
      const { client } = context()
      const roles = await listRoles(client, key)
      const full = await Promise.all(
        roles.map((r) => client.request<Role>(rolePath(key, r.id))),
      )
      if (options.json) return printJson(full)
      process.stdout.write(
        `${table(full, [
          { header: "ID", value: (r) => String(r.id) },
          { header: "ROLE", value: (r) => r.name },
          {
            header: "MEMBERS",
            value: (r) =>
              truncate((r.actors ?? []).map(actorName).join(", ") || "—", 80),
          },
        ])}\n`,
      )
    })

  const role = project.command("role").description("add or remove role members")

  role
    .command("add <key> <role> <who...>")
    .description(
      "add people (name, email or account ID) or, with --group, groups",
    )
    .option("--group", "the names are groups, not people")
    .action(
      async (
        key: string,
        wanted: string,
        who: string[],
        options: { group?: boolean },
      ) => {
        const { client } = context()
        const target = findRole(await listRoles(client, key), wanted)
        const body = options.group
          ? { group: who }
          : {
              user: await Promise.all(
                who.map(async (w) => {
                  const id = await resolveAccountId(w)
                  if (!id) throw exitError(1, `'${w}' names nobody`)
                  return id
                }),
              ),
            }
        try {
          await client.request(rolePath(key, target.id), {
            method: "POST",
            body: JSON.stringify(body),
          })
        } catch (error) {
          throw await projectAdminRefusal(
            error,
            client,
            key,
            `adding to ${key}'s ${target.name} role`,
          )
        }
        process.stderr.write(
          `added ${who.join(", ")} to ${key} ${target.name}\n`,
        )
      },
    )

  role
    .command("remove <key> <role> <who>")
    .alias("rm")
    .description("remove a person or, with --group, a group from a role")
    .option("--group", "the name is a group, not a person")
    .option("--yes", "skip the confirmation")
    .action(
      async (
        key: string,
        wanted: string,
        who: string,
        options: { group?: boolean; yes?: boolean },
      ) => {
        const { client } = context()
        const target = findRole(await listRoles(client, key), wanted)
        let query: URLSearchParams
        if (options.group) query = new URLSearchParams({ group: who })
        else {
          const id = await resolveAccountId(who)
          if (!id) throw exitError(1, `'${who}' names nobody`)
          query = new URLSearchParams({ user: id })
        }
        await confirmDestructive(
          `remove ${who} from ${key}'s ${target.name} role`,
          options,
        )
        try {
          await client.request(`${rolePath(key, target.id)}?${query}`, {
            method: "DELETE",
          })
        } catch (error) {
          throw await projectAdminRefusal(
            error,
            client,
            key,
            `removing from ${key}'s ${target.name} role`,
          )
        }
        process.stderr.write(`removed ${who} from ${key} ${target.name}\n`)
      },
    )
}
