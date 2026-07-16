import React from "react"
import { render } from "ink"
import type { Command } from "commander"
import chalk from "chalk"
import { loadConfig } from "../../config.js"
import { JiraClient } from "../../client.js"
import { CreateForm, type CreateFormFields } from "../../ui/create-form.js"

const textDoc = (text: string) => ({
  version: 1,
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
})

const submitCreate = async (
  fields: {
    project: string
    summary: string
    type: string
    priority?: string
    body?: string
    assignee?: string
    label?: string[]
    points?: string
  },
  asJson: boolean,
): Promise<void> => {
  const client = new JiraClient(loadConfig())

  const issueFields: Record<string, unknown> = {
    project: { key: fields.project.toUpperCase() },
    summary: fields.summary,
    issuetype: { name: fields.type === "Spike" ? "Task" : fields.type },
  }

  if (fields.body) issueFields["description"] = textDoc(fields.body)
  if (fields.assignee) issueFields["assignee"] = { accountId: fields.assignee }
  if (fields.priority) issueFields["priority"] = { name: fields.priority }
  if (fields.label && fields.label.length > 0)
    issueFields["labels"] = fields.label
  if (fields.points)
    issueFields["customfield_10002"] = parseFloat(fields.points)

  const created = await client.createIssue(issueFields)

  if (asJson || !process.stdout.isTTY) {
    process.stdout.write(JSON.stringify(created, null, 2) + "\n")
    return
  }

  process.stdout.write(
    `${chalk.green("✓")} Created ${chalk.cyan(created.key)}\n`,
  )
}

export const registerIssueCreateCommand = (issueCmd: Command): void => {
  issueCmd
    .command("create")
    .description("Create a Jira issue — omit flags for interactive form")
    .option("-p, --project <key>", "project key")
    .option("-s, --summary <text>", "issue summary")
    .option("-t, --type <name>", "issue type")
    .option("-b, --body <text>", "issue description")
    .option("-a, --assignee <accountId>", "assignee account ID")
    .option("-y, --priority <name>", "priority name")
    .option(
      "-l, --label <label>",
      "add a label (repeatable)",
      (v, acc: string[]) => [...acc, v],
      [] as string[],
    )
    .option("--points <n>", "story points")
    .option("--json", "output created issue as JSON")
    .action(
      async (opts: {
        project?: string
        summary?: string
        type?: string
        body?: string
        assignee?: string
        priority?: string
        label: string[]
        points?: string
        json: boolean
      }) => {
        const isInteractive = !opts.project || !opts.summary

        if (isInteractive && !process.stdout.isTTY) {
          process.stderr.write(
            `${chalk.red("error:")} --project and --summary are required in non-interactive mode\n`,
          )
          process.exit(1)
        }

        if (isInteractive) {
          let formResult: CreateFormFields | undefined

          const { waitUntilExit } = render(
            <CreateForm
              defaults={{
                project: opts.project,
                summary: opts.summary,
                type: opts.type,
                priority: opts.priority,
              }}
              onSubmit={(fields) => {
                formResult = fields
              }}
            />,
          )

          await waitUntilExit()
          if (!formResult) return

          await submitCreate(
            {
              ...formResult,
              body: opts.body,
              assignee: opts.assignee,
              label: opts.label,
              points: opts.points,
            },
            opts.json,
          )
          return
        }

        await submitCreate(
          {
            project: opts.project!,
            summary: opts.summary!,
            type: opts.type ?? "Task",
            body: opts.body,
            assignee: opts.assignee,
            priority: opts.priority,
            label: opts.label,
            points: opts.points,
          },
          opts.json,
        )
      },
    )
}
