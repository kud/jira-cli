# jira-cli

Jira on the command line. Reads issues, comments and **attachments** as plain text, so you can pipe them into anything.

Black and white output, `--json` on every read, stable exit codes. No interactive prompts.

## Install

```sh
npm install -g @kud/jira-cli
```

## Setup

Only the token is a secret, so only the token comes from the environment:

```sh
export ATLASSIAN_API_TOKEN=...   # id.atlassian.com/manage-profile/security/api-tokens
jira init --base-url myorg.atlassian.net --email you@example.com
```

That writes `~/.config/jira/config.json`. `ATLASSIAN_BASE_URL` and `ATLASSIAN_USER_EMAIL` override it when you need a second instance.

## Attachments

The thing most Jira CLIs skip. Attachments are listed with the comment they came from, and text ones print straight to stdout:

```sh
jira attachment list ABC-123
# ID      FILENAME     SIZE   TYPE        FROM
# 292542  error.log    22.0KB text/plain  comment by Ada Lovelace
# 292731  screen.png   118KB  image/png   description

jira attachment read ABC-123 error.log | grep -i timeout
jira attachment get ABC-123 screen.png --output ~/Desktop/
```

Descriptions and comments render as Markdown, with embedded files named rather than left as opaque ids:

```sh
jira issue view ABC-123 --comments
```

## Issues

```sh
jira issue list                            # yours, most recently updated first
jira issue list --status 'In Progress'
jira issue list --project ABC --sprint current
jira issue view ABC-123
jira issue transition ABC-123              # list what's available
jira issue transition ABC-123 'In Review'
jira issue open ABC-123
```

## Scripting

Every read command takes `--json`:

```sh
jira issue list --mine --json | jq -r '.[].key'
jira search 'project = ABC AND created >= -7d' --json
```

Exit codes:

| Code | Means                                   |
| ---- | --------------------------------------- |
| `0`  | success                                 |
| `1`  | Jira rejected the request, or bad usage |
| `2`  | the environment is not set up           |
| `4`  | not authenticated                       |

Colour is disabled automatically when stdout is not a TTY, and when `NO_COLOR` is set.

## Custom fields

Jira instances differ. Find yours, then name the ones you care about:

```sh
jira fields points
# ID                 NAME                   TYPE
# customfield_10784  Offshore Story Points  string
# customfield_10002  Story Points           number
```

```json
{
  "baseUrl": "myorg.atlassian.net",
  "email": "you@example.com",
  "customFields": [{ "id": "customfield_10002", "label": "points" }],
  "sprintField": "customfield_10020",
  "defaultProject": "ABC"
}
```

Named fields are requested on every search and shown in `issue view`.

## Escape hatch

Anything not covered:

```sh
jira api /rest/api/3/myself
jira api /rest/api/3/issue/ABC-123/watchers -X POST -d '{"accountId":"..."}'
```

## Licence

MIT
