import type { Command } from "commander"
import { registerIssueViewCommand } from "./view.js"
import { registerIssueListCommand } from "./list.js"
import { registerIssueCreateCommand } from "./create.js"
import { registerIssueTransitionCommand } from "./transition.js"
import { registerIssueCommentCommand } from "./comment.js"
import { registerIssueOpenCommand } from "./open.js"

export const registerIssueCommands = (program: Command): void => {
  const issueCmd = program.command("issue").description("Manage Jira issues")

  registerIssueViewCommand(issueCmd)
  registerIssueListCommand(issueCmd)
  registerIssueCreateCommand(issueCmd)
  registerIssueTransitionCommand(issueCmd)
  registerIssueCommentCommand(issueCmd)
  registerIssueOpenCommand(issueCmd)
}
