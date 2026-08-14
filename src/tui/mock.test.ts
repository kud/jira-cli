import { describe, expect, it } from "vitest"
import { mockData } from "./mock.js"

describe("mockData", () => {
  it("answers every DataSource method end to end, so --mock never falls through to a live call", async () => {
    const data = mockData()

    const rows = await data.listIssues(true)
    expect(rows.length).toBeGreaterThan(0)

    const issue = await data.getIssue(rows[0]!.key)
    expect(issue.key).toBe(rows[0]!.key)

    const transitions = await data.getTransitions(issue.key)
    expect(transitions.length).toBeGreaterThan(0)

    await expect(
      data.transition(issue.key, transitions[0]!.id),
    ).resolves.toBeUndefined()
    await expect(data.comment(issue.key, "test")).resolves.toBeUndefined()
    await expect(data.assignToMe(issue.key)).resolves.toBeUndefined()
    expect(typeof data.baseUrl).toBe("string")
  })

  it("synthesises a detail for a row that has no full fixture, instead of throwing", async () => {
    const data = mockData()
    const rows = await data.listIssues(true)
    const withoutFullFixture = rows.find((r) => r.key !== "SHOP-412")!

    const issue = await data.getIssue(withoutFullFixture.key)

    expect(issue.key).toBe(withoutFullFixture.key)
    expect(issue.comments).toEqual([])
    expect(issue.attachments).toEqual([])
  })
})
