import { afterEach, describe, expect, it, vi } from "vitest"
import { isTruncated, TRUNCATED_EXIT_CODE, warnIfTruncated } from "./context.js"

describe("isTruncated", () => {
  it("calls a short page complete, since the limit was never reached", () => {
    expect(isTruncated(12, 50)).toBe(false)
  })

  it("calls a full page truncated, because no total is available to say otherwise", () => {
    // Jira's /search/jql returns no total, so "there is more" is the only
    // claim the data supports — and a result landing exactly on the limit is
    // indistinguishable from one cut short. False-positive by design.
    expect(isTruncated(50, 50)).toBe(true)
  })

  it("treats an over-full page as truncated too, rather than trusting the slice", () => {
    expect(isTruncated(51, 50)).toBe(true)
  })

  it("stays quiet on a limit that never parsed, instead of warning about NaN", () => {
    expect(isTruncated(0, Number.NaN)).toBe(false)
  })

  it("stays quiet on an empty result with a zero limit", () => {
    expect(isTruncated(0, 0)).toBe(false)
  })
})

describe("warnIfTruncated", () => {
  const originalExitCode = process.exitCode

  afterEach(() => {
    process.exitCode = originalExitCode
    vi.restoreAllMocks()
  })

  it("leaves the exit code and stderr alone when nothing was cut off", () => {
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true)

    warnIfTruncated(12, 50)

    expect(stderr).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(originalExitCode)
  })

  it("warns on stderr and sets the exit code, never touching stdout", () => {
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true)
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true)

    warnIfTruncated(50, 50)

    expect(stdout).not.toHaveBeenCalled()
    expect(stderr).toHaveBeenCalledOnce()
    expect(String(stderr.mock.calls[0]?.[0])).toMatch(/truncated at --limit 50/)
    expect(process.exitCode).toBe(TRUNCATED_EXIT_CODE)
  })

  it("keeps the truncated code distinct from every failure code the CLI already uses", () => {
    // 1 usage/Jira, 2 environment, 4 credentials. A caller has to be able to
    // tell "your answer is short" from "your answer is wrong".
    expect([1, 2, 4]).not.toContain(TRUNCATED_EXIT_CODE)
  })
})
