# Changelog

All notable changes to this project are documented here.

---

## 0.9.0 — 2026-10-02

### Highlights

- **The board now draws itself straight away instead of behind a full-screen spinner.** On a cold load you get a skeleton in the board's own frame, with the real tabs and `(–)` counts, and the tabs are fetched ahead of the rows so nothing shifts when they arrive. The border never moves, and the spinner stays only as a fallback if the tabs fail to load. ([fc7cab0](https://github.com/kud/jira-cli/commit/fc7cab0e13d510dcb0a540d0abe1368bc53510f2))
- **Refreshing, flipping `a` (all/mine) and searching no longer blank the board.** The rows stay on screen while the title shows `↻ refreshing…`. ([fc7cab0](https://github.com/kud/jira-cli/commit/fc7cab0e13d510dcb0a540d0abe1368bc53510f2))
- **The frame always fills the terminal and follows resizes.** ([fc7cab0](https://github.com/kud/jira-cli/commit/fc7cab0e13d510dcb0a540d0abe1368bc53510f2))
- **Search no longer resets your scope to "mine" too early.** The reset now happens only once the board reload succeeds, so the label doesn't flip prematurely or after a failed reload. ([fc7cab0](https://github.com/kud/jira-cli/commit/fc7cab0e13d510dcb0a540d0abe1368bc53510f2))
- **`@kud/ink-ui` jumps 0.28.2 → 0.32.0 and `@kud/jira-ink` 0.10.0 → 0.11.0**, which supplies the skeleton and tab helpers. The transitive `@kud/ink-markdown` 0.3.2 also drops `markdown-it` from the install tree. ([903a8e2](https://github.com/kud/jira-cli/commit/903a8e2c3b38ea071eae3432f411107b3d1424b2))

---

## 0.8.0 — 2026-09-25

### Highlights

- **`issue list` and `search` now warn when a result may be cut short.** Jira's `/search/jql` endpoint never reports a total, so a page that comes back exactly as full as `--limit` asked for is the only signal there might be more — the warning is printed on stderr and fires on that heuristic by design, including the rare case where the result count genuinely lands on the limit with nothing left. stdout and `--json` output are untouched either way, so anything parsing them sees no difference. ([cb46536](https://github.com/kud/jira-cli/commit/cb465369c6e28b54d22219a7f506e6d0025923d3))
- **`--json` now exits 3 when that truncation warning fires — a new, documented exit code.** Table output still warns but keeps exiting 0, so `jira issue list && …` chains keep working unchanged; only scripts consuming `--json` need to know about the new code. ([089f08d](https://github.com/kud/jira-cli/commit/089f08d84906293afad0482b08d3bced745ae314))

---

## 0.7.0 — 2026-09-22

### Highlights

- **Moving an issue no longer takes it off the screen.** Picking a transition used to drop a full-screen spinner over the view and re-fetch the whole issue, so the ticket you were reading vanished for two round trips. The detail page now stays mounted throughout: a dim `⋯ moving` marks the summary while Jira decides, the new status is written in from the transition's own target the moment it's accepted, and there's no re-fetch at all. A rejected move leaves the issue exactly where it was, with Jira's own first line shown in the frame instead of blanking the view for an error screen with a retry key. ([5ad2d9d](https://github.com/kud/jira-cli/commit/5ad2d9d6693f0dfca471dfa73f8551a065b4e1c4))
- **The board now says where a fenced parent is.** A task whose epic has no row on the current board carries that epic's tab when it's yours, or `@FirstName` / `unassigned` when it isn't — from one extra `key in (…)` search fired after the rows are already on screen, so it never holds up first paint. ([5ad2d9d](https://github.com/kud/jira-cli/commit/5ad2d9d6693f0dfca471dfa73f8551a065b4e1c4))
- **Epics that have fallen behind are now marked `behind`** — parked Off board while a child has started, or still open once every child is Done. ([5ad2d9d](https://github.com/kud/jira-cli/commit/5ad2d9d6693f0dfca471dfa73f8551a065b4e1c4))
- **`@kud/jira-ink` jumps 0.5.0 → 0.10.0**, bringing bottom-up epic placement (an epic is placed by its children, so it heads a group in every tab it has one in, with per-tab counts changing to match), a five-glyph priority column (`⇈ ↑ = ↓ ⇊` replacing the old `▲`/`▼`), the issue detail collapsed into one continuous document instead of three tabs, and a real tree grammar (`├─`/`└─` with stems). ([47e9a81](https://github.com/kud/jira-cli/commit/47e9a81b625d0d7b3d8594e0ac89da0fae3f8376))

---

## 0.6.2 — 2026-09-14

### Highlights

- **The title row is cockpit's.** `🎫 Jira    7 items  ·  @you  updated 2m ago  ╌╌╌╌` — count padded so the header never shuffles, your name plain, freshness dim, a dotted rule to the edge; the detail page carries the issue key in the same row. The frame is now `@kud/ink-ui` 0.28's `Page`, so every `@kud` TUI draws the same one. ([45c9dbc](https://github.com/kud/jira-cli/commit/45c9dbca685235ed77075d9fd1864d628b4ac9a6))

---

## 0.6.1 — 2026-09-14

### Highlights

- **One navigation contract.** `q` quits from anywhere — except while you are typing in the search box or a comment, where it is a letter. `esc` and `⌫` go back exactly one level: a prompt, then the issue, then nothing. Every page ends its footer the same way: `⌫ back` where there is somewhere to go back to, then `? help`, then `q quit`. Built on `@kud/ink-ui` 0.27's `useAppKeys` and `@kud/jira-ink` 0.4, whose views no longer bind keys of their own. ([bc7e63e](https://github.com/kud/jira-cli/commit/bc7e63eb9a541aeafc6f34c2148895c9d8d648cd))

---

## 0.6.0 — 2026-09-14

### Highlights

- **`--board <id>` on the bare `jira` command now shapes the board's tabs around that board's own columns**, matched by status id, with an **Off board** tab catching any status no column claims — instead of the fixed To do/In progress/Done split. `defaultBoard` in the config file does the same without the flag. Hand-written `tabs` in the config file still win over both, for full manual control. ([d78a45c](https://github.com/kud/jira-cli/commit/d78a45c174082be609b2aef08b45db311eb26d0d))
- **The issue detail page's description now fills the available space** instead of being cut up to three lines short, fixed upstream in `@kud/jira-ink` 0.3.1. ([d78a45c](https://github.com/kud/jira-cli/commit/d78a45c174082be609b2aef08b45db311eb26d0d))
- **`x` clears a committed search; `esc` no longer does.** `esc` now consistently pops the current layer instead of also editing filter state underneath it. ([d78a45c](https://github.com/kud/jira-cli/commit/d78a45c174082be609b2aef08b45db311eb26d0d))

<details>
<summary>Internal (1 commit)</summary>

- Board rendering and JQL helpers moved out of this repo and into `@kud/jira-ink` and `@kud/jira` (pinned to 0.3.1 and 0.4.0), with `list.tsx`/`board.ts` and `jql.ts` removed in favour of the shared packages.

</details>

---

## 0.5.3 — 2026-09-14

### Highlights

- **Every screen now sits inside the same frame** — the loading spinner and errors, the transition/comment/assign prompts, and the issue detail all get consistent chrome, where the loader used to float outside the border at startup and the detail page had no frame at all. ([0e03fcd](https://github.com/kud/jira-cli/commit/0e03fcdc168e2e7ad2b1f2b75df7611242f1d02f))
- The detail page keeps the app's title row up top (`🎫 Jira   SHOP-412 · Bug`), matching every other screen instead of standing apart from them. ([0e03fcd](https://github.com/kud/jira-cli/commit/0e03fcdc168e2e7ad2b1f2b75df7611242f1d02f))

---

## 0.5.2 — 2026-09-14

### Highlights

- **`←` and `→` now switch tabs on the board, alongside `⇥`** — the footer hint reads `←→ tab`. ([cefc747](https://github.com/kud/jira-cli/commit/cefc747bf76ec72a98dbcb7f3042a93f80a8291b))

---

## 0.5.1 — 2026-09-14

### Highlights

- **An epic that's itself in the current tab now heads its own group as a selectable row**, with its children hanging underneath it (`└─`) — instead of appearing twice, once as a plain fence line and again as an orphan under "No epic". A fence line is still shown for a parent that isn't in the tab. Groups are separated by a blank line, and the title bar now has a line of air before the tabs. ([016a0cb](https://github.com/kud/jira-cli/commit/016a0cb73953ec24d6ba2f56ecb32cd79ea27bf9))

---

## 0.5.0 — 2026-09-14

### Highlights

- **The issue list is now a board, tabbed by Jira's own status categories** (To do, In progress, Done) rather than by status name — so the same layout works on any instance, no board config required. Rows group under their epic, each carrying a type pill, a priority glyph, and how long it's been sitting there. ([44c798d](https://github.com/kud/jira-cli/commit/44c798d2f3b17820ff2d8056a91030f146c20a88))
- **`/` opens search, and it understands what you typed.** Plain words narrow the current list live as you type (title, summary, comments) and run as a `text ~` search within your issues on enter; anything shaped like JQL is detected automatically and replaces the scope instead. `⇥` flips between the two modes by hand, and a bad JQL query surfaces Jira's own error message rather than failing silently. ([44c798d](https://github.com/kud/jira-cli/commit/44c798d2f3b17820ff2d8056a91030f146c20a88))
- **`a` now toggles the full picture, not just a filter tweak** — off shows open issues plus anything closed in the last 14 days, on shows everything. ([44c798d](https://github.com/kud/jira-cli/commit/44c798d2f3b17820ff2d8056a91030f146c20a88))
- `@kud/jira-ink` bumped to 0.2.1. ([44c798d](https://github.com/kud/jira-cli/commit/44c798d2f3b17820ff2d8056a91030f146c20a88))

---

## 0.4.1 — 2026-09-11

<details>
<summary>Internal (3 commits)</summary>

- Config loading (`loadConfig`, `readFileConfig`, `configPath`) moved out of the CLI and into the `@kud/jira` core (bumped to 0.3.0), with no behavioural change — `src/config.ts` is gone, and the CLI now consumes the shared implementation.
- The TUI's issue detail screen was extracted into a new `@kud/jira-ink` package (0.1.0) — `IssueDetailView`, `IssueDetail`, `Transition`, and the fetch mapping now live there so other apps (cockpit included) can mount the same screen; `src/tui/detail.tsx` is gone and `data.ts` delegates to jira-ink's `issueDetailOf`/`transitionsOf`. `@kud/ink-ui` and `ink` were aligned to 0.25.0/7.1.1 so a host loading both packages holds a single copy.
- Nothing changes for a user of the CLI: same commands, same TUI, same keys.

</details>

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
