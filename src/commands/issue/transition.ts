import React from "react"
import { render } from "ink"
import type { Command } from "commander"
import chalk from "chalk"
import { loadConfig } from "../../config.js"
import { JiraClient } from "../../client.js"
import { Select } from "../../ui/select.js"

export const registerIssueTransitionCommand = (issueCmd: Command): void => {
  issueCmd
    .command("transition <key> [status]")
    .description("Transition a Jira issue — omit status for interactive picker")
    .option("--id", "treat [status] as a transition ID directly")
    .action(
      async (
        key: string,
        status: string | undefined,
        opts: { id: boolean },
      ) => {
        const client = new JiraClient(loadConfig())
        const issueKey = key.toUpperCase()

        if (!status) {
          const { transitions } = await client.getTransitions(issueKey)
          let selectedId: string | undefined

          const { waitUntilExit } = render(
            React.createElement(Select<string>, {
              label: `Transition ${issueKey} to:`,
              options: transitions.map((t) => ({
                label: t.name,
                value: t.id,
                hint: `→ ${t.to.name}`,
              })),
              onSelect: (id: string) => {
                selectedId = id
              },
            }),
          )

          await waitUntilExit()
          if (!selectedId) return

          await client.transitionIssue(issueKey, selectedId)
          process.stdout.write(
            `${chalk.green("✓")} Transitioned ${chalk.cyan(issueKey)}\n`,
          )
          return
        }

        let transitionId = status

        if (!opts.id) {
          const { transitions } = await client.getTransitions(issueKey)
          const match = transitions.find(
            (t) =>
              t.name.toLowerCase() === status.toLowerCase() ||
              t.to.name.toLowerCase() === status.toLowerCase(),
          )
          if (!match) {
            const available = transitions
              .map((t) => `  ${t.id}  ${t.name}`)
              .join("\n")
            process.stderr.write(
              `${chalk.red("error:")} no transition matching "${status}"\n\nAvailable:\n${available}\n`,
            )
            process.exit(1)
          }
          transitionId = match.id
        }

        await client.transitionIssue(issueKey, transitionId)
        process.stdout.write(
          `${chalk.green("✓")} Transitioned ${chalk.cyan(issueKey)}\n`,
        )
      },
    )
}
