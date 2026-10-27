import { describe, expect, it } from "vitest"
import { confirmDestructive } from "./confirm.js"
import { isExitError } from "./context.js"
import { rankPosition } from "./issue-write.js"

describe("rankPosition", () => {
  it("keeps --before as the anchor Jira ranks against", () => {
    expect(rankPosition({ before: "SHOP-2" })).toEqual({ before: "SHOP-2" })
  })

  it("keeps --after as the anchor too", () => {
    expect(rankPosition({ after: "SHOP-2" })).toEqual({ after: "SHOP-2" })
  })

  it("refuses both anchors, since two orders compete", () => {
    let error: unknown
    try {
      rankPosition({ before: "SHOP-1", after: "SHOP-2" })
    } catch (e) {
      error = e
    }
    expect(isExitError(error)).toBe(true)
    expect((error as { code: number }).code).toBe(1)
    expect((error as Error).message).toMatch(/not both/)
  })

  it("refuses neither anchor, since there is nothing to rank against", () => {
    let error: unknown
    try {
      rankPosition({})
    } catch (e) {
      error = e
    }
    expect(isExitError(error)).toBe(true)
    expect((error as { code: number }).code).toBe(1)
    expect((error as Error).message).toMatch(/--before <key> or --after <key>/)
  })
})

describe("confirmDestructive", () => {
  it("proceeds without asking when --yes is passed", async () => {
    await expect(
      confirmDestructive("permanently delete SHOP-1", { yes: true }),
    ).resolves.toBeUndefined()
  })

  it("refuses on a non-TTY without --yes, rather than acting on a guess", async () => {
    // The test runner's stdin is piped — exactly the scripted case the guard
    // exists for — so no mocking is needed to reach the refusal.
    expect(process.stdin.isTTY).toBeUndefined()

    let error: unknown
    try {
      await confirmDestructive("permanently delete SHOP-1", {})
    } catch (e) {
      error = e
    }
    expect(isExitError(error)).toBe(true)
    expect((error as { code: number }).code).toBe(1)
    expect((error as Error).message).toMatch(/--yes/)
  })
})
