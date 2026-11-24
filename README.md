<div align="center">

🎫

# Jira CLI

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat-square&logo=node.js&logoColor=white)
![npm](https://img.shields.io/npm/v/@kud/jira-cli?style=flat-square&color=CB3837)
![MIT](https://img.shields.io/badge/licence-MIT-22C55E?style=flat-square)

**Jira on the command line — read issues, comments and attachments as plain text**

<a href="https://kud.io/projects/jira-cli">Website</a> · <a href="https://kud.io/projects/jira-cli/docs">Documentation</a>

</div>

## Features

- **Attachments as text** — list what is attached, with the comment it came from, and print text files straight to stdout or download the rest
- **Plain and pipeable** — black and white output, `--json` on every read, stable exit codes
- **Full issue workflow** — create, edit and transition with any field by name, comment, link and unlink, watch, rank and log work
- **Bulk changes** — edit or transition every issue a JQL query matches, listing them first until `--yes`
- **Projects, boards and sprints** — browse projects, boards, epics and the backlog; create, start and close sprints; create and release versions; manage project roles
- **Automation rules** — list, export, import and switch Jira Automation rules, with secrets redacted on request
- **Workflows** — read statuses, transitions and conditions, and find the workflow an issue type uses; `whoami --permissions` says what the account may administer
- **Interactive board** — bare `jira` opens your issues as tabs, with search and in-place writes; Ink loads only for this view

## Install

```sh
npm install -g @kud/jira-cli
```

## Usage

Only the API token is a secret, so only the token comes from the environment:

```sh
export ATLASSIAN_API_TOKEN=...
jira init --base-url jira.example.com --email you@example.com
```

```console
$ jira attachment list ACME-1234
ID      FILENAME     SIZE   TYPE        FROM
292542  error.log    22.0KB text/plain  comment by Ada Lovelace
292731  screen.png   118KB  image/png   description

$ jira attachment read ACME-1234 error.log | grep -i timeout
$ jira issue view ACME-1234 --fields status,assignee,issuelinks
$ jira issue transition ACME-1234 Done --resolution Fixed
$ jira issue open ACME-1234 --print
$ jira issue watch list ACME-1234
$ jira issue worklog edit ACME-1234 456 --time 3h --started 2026-10-27T09:00:00.000+0000
$ jira issue comment delete ACME-1234 12345
$ jira user search ada --project ACME
$ jira project view ACME
$ jira sprint view 1234
$ jira sprint close 1234 --move-to backlog
$ jira version release 2.4 --project ACME --move-unresolved-to 2.5
$ jira issue bulk edit --jql 'project = ACME AND labels = triage' --field 'Story Points=3'
$ jira search 'project = ACME AND created >= -7d' --json | jq -r '.[].key'
$ jira automation get 0192e5ac-0e25-71de-ba7b-d972e6a2049a --redact
$ jira workflow for Bug --project ACME
$ jira whoami --permissions --project ACME
```

Run `jira` with no arguments in a terminal for the interactive board. Inside an issue, description, comments and attachments sit in one scrolling view. Two flags help when exploring it: `--screen detail:ACME-1234` opens an issue directly (`--screen list` prints the available screens), and `--mock` runs against built-in sample data with no Jira needed.

Exit codes: `0` success, `1` Jira rejected the request or bad usage, `2` environment not set up, `3` `--json` result may be truncated, `4` not authenticated.

Anything not covered has an escape hatch: `jira api /rest/api/3/myself`.

## Development

```sh
git clone https://github.com/kud/jira-cli.git
cd jira-cli
npm install
npm run dev
```

📚 **Full documentation → [jira-cli/docs](https://kud.io/projects/jira-cli/docs)**
