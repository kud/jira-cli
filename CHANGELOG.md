# Changelog

All notable changes to this project are documented here.

---

## 0.4.0 — 2026-09-02

### Highlights

- **Issue views now show the parent ticket.** `jira issue view <KEY>` and the TUI's detail pane display a `parent` row above `status`, carrying the parent's key and summary, whenever the issue actually has one — a subtask's parent is an ordinary ticket, so this deliberately says `parent` rather than `epic`. Getting the field back required a matching bump in the `@kud/jira` core (0.2.1), which now asks every search for it. ([d7bc8af](https://github.com/kud/jira-cli/commit/d7bc8afe05b018446cca38f5620cf42ac7e68df4))
- **`--screen` now accepts inline `=value` syntax**, alongside the existing spaced form, so `--screen=board` works the same as `--screen board`. The TUI's issue-list header also got a touch more breathing room. ([8105312](https://github.com/kud/jira-cli/commit/810531201e71de0730a19ebdfa0480d498dfca9f))

---

## 0.2.1 — 2026-08-14

### Highlights

- **The CLI works again.** It was built against `POST /rest/api/3/search`, which Atlassian has since removed (the endpoint now returns `410 Gone`), so every list and search command was dead on arrival. It's rebuilt on `/rest/api/3/search/jql` with cursor-based pagination, including a defensive stop condition since that cursor has been known to loop. ([e85c387](https://github.com/kud/jira-cli/commit/e85c38774b69a25f29706cd89e80ed3ca814807e))
- **Attachments are now readable, not just listed.** `jira attachment list` shows each attachment alongside the comment or description it came from; text files print straight to stdout, binaries download with `get`. Getting there meant discovering that ADF media nodes and Jira's own attachment records use different id spaces — the two are joined by matching filename (`attrs.alt`), not id. This closes a real gap in the Atlassian MCP, which can tell you a file exists but never what's in it. ([e85c387](https://github.com/kud/jira-cli/commit/e85c38774b69a25f29706cd89e80ed3ca814807e), [9e441d2](https://github.com/kud/jira-cli/commit/9e441d2a3816118a0f8f986eeb1d4dc42ca3d9e5))
- **Custom fields are configured, not hardcoded.** The old build baked in `customfield_10002`; `jira fields` now discovers each Jira instance's own custom fields, and a config file names the ones you care about. ([e85c387](https://github.com/kud/jira-cli/commit/e85c38774b69a25f29706cd89e80ed3ca814807e))
- **The interface is plain and scriptable.** The Ink/React/opentui terminal UI is gone in favour of monochrome text output, `--json` on every read command, colour that turns off automatically when piped, and stable exit codes (1 for Jira/usage errors, 2 for environment problems, 4 for unauthenticated). ([e85c387](https://github.com/kud/jira-cli/commit/e85c38774b69a25f29706cd89e80ed3ca814807e))
- **Comments and descriptions read and write as Markdown.** ADF (Atlassian's rich-text format) converts to Markdown for reading and back for writing, so you can draft a comment or description in a normal editor rather than fighting Jira's document format. ([e85c387](https://github.com/kud/jira-cli/commit/e85c38774b69a25f29706cd89e80ed3ca814807e), [9e441d2](https://github.com/kud/jira-cli/commit/9e441d2a3816118a0f8f986eeb1d4dc42ca3d9e5))
- **Broad coverage in one tool.** Around 45 commands across issues (including create, edit, assign, comment, link, watch, worklog), attachments, projects, boards, sprints, epics, users, and instance metadata, plus a raw `api` passthrough for anything not yet wrapped. ([9e441d2](https://github.com/kud/jira-cli/commit/9e441d2a3816118a0f8f986eeb1d4dc42ca3d9e5))
- **Setup is one command.** `jira init --base-url ... --email ...` writes `~/.config/jira/config.json`; only the API token comes from the environment (`ATLASSIAN_API_TOKEN`), with `ATLASSIAN_BASE_URL`/`ATLASSIAN_USER_EMAIL` available as overrides for a second instance. ([e85c387](https://github.com/kud/jira-cli/commit/e85c38774b69a25f29706cd89e80ed3ca814807e))

<details>
<summary>Internal (2 commits)</summary>

- Added a CI workflow (typecheck/test/build) and an npm publish workflow triggered on tag push; extracted the Jira API/ADF layer into the standalone `@kud/jira` package, which this CLI now consumes as a dependency with no behavioural change.

</details>

---
