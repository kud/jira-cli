import { createInterface } from "node:readline/promises"
import { exitError } from "./context.js"

/**
 * Jira deletes are permanent and there is no trash to fish out of, so the
 * confirmation is the only undo. A script has to say so twice over — --yes
 * records that a human already decided — and a piped stdin without --yes
 * refuses rather than guessing, because the one thing worse than asking is
 * deleting on behalf of a caller that never meant to.
 */
export const confirmDestructive = async (
  what: string,
  options: { yes?: boolean },
): Promise<void> => {
  if (options.yes) return

  if (!process.stdin.isTTY)
    throw exitError(
      1,
      `${what} is destructive — re-run with --yes to confirm it non-interactively`,
    )

  // The prompt goes to stderr so stdout stays pipeable for whatever comes
  // after a --yes run.
  const rl = createInterface({ input: process.stdin, output: process.stderr })
  try {
    const answer = await rl.question(`${what} — proceed? [y/N] `)
    if (answer.trim().toLowerCase() !== "y") throw exitError(1, "aborted")
  } finally {
    rl.close()
  }
}
