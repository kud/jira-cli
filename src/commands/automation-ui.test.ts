import type { JiraClient } from "@kud/jira"
import { jiraApiError } from "@kud/jira"
import { describe, expect, it, vi } from "vitest"
import {
  projectAutomationUrl,
  readProjectAutomationUrl,
} from "./automation-ui.js"

const BASE = "https://acme.atlassian.net"

describe("projectAutomationUrl", () => {
  it.each([
    [
      { projectTypeKey: "software", style: "next-gen" },
      `${BASE}/jira/software/projects/SHOP/settings/automate`,
    ],
    [
      { projectTypeKey: "software", simplified: true },
      `${BASE}/jira/software/projects/SHOP/settings/automate`,
    ],
    [
      { projectTypeKey: "software", style: "classic" },
      `${BASE}/jira/software/c/projects/SHOP/settings/automate`,
    ],
    [
      { projectTypeKey: "software", simplified: false },
      `${BASE}/jira/software/c/projects/SHOP/settings/automate`,
    ],
    [
      { projectTypeKey: "business", style: "classic" },
      `${BASE}/jira/core/projects/SHOP/settings/automate`,
    ],
    [
      { projectTypeKey: "service_desk", style: "next-gen" },
      `${BASE}/jira/servicedesk/projects/SHOP/settings/automate`,
    ],
  ])("derives the page from %o", (project, url) => {
    expect(projectAutomationUrl(BASE, "SHOP", project)).toBe(url)
  })

  it("drops a trailing slash on the base URL", () => {
    expect(
      projectAutomationUrl(`${BASE}/`, "SHOP", { projectTypeKey: "business" }),
    ).toBe(`${BASE}/jira/core/projects/SHOP/settings/automate`)
  })

  it("gives nothing for a software project whose style it cannot tell", () => {
    expect(
      projectAutomationUrl(BASE, "SHOP", { projectTypeKey: "software" }),
    ).toBeUndefined()
  })

  it("gives nothing for an unknown project type", () => {
    expect(
      projectAutomationUrl(BASE, "SHOP", {
        projectTypeKey: "product_discovery",
      }),
    ).toBeUndefined()
  })
})

describe("readProjectAutomationUrl", () => {
  it("reads the project and derives the page", async () => {
    const request = vi
      .fn()
      .mockResolvedValue({
        key: "SHOP",
        projectTypeKey: "software",
        style: "classic",
      })
    const url = await readProjectAutomationUrl(
      { request } as unknown as JiraClient,
      BASE,
      "SHOP",
    )
    expect(request).toHaveBeenCalledWith("/rest/api/3/project/SHOP")
    expect(url).toBe(`${BASE}/jira/software/c/projects/SHOP/settings/automate`)
  })

  it("gives nothing when the project read fails", async () => {
    const request = vi
      .fn()
      .mockRejectedValue(
        jiraApiError(404, "GET", "/rest/api/3/project/SHOP", ""),
      )
    expect(
      await readProjectAutomationUrl(
        { request } as unknown as JiraClient,
        BASE,
        "SHOP",
      ),
    ).toBeUndefined()
  })
})
