# Jira Cloud API coverage

What `jira` covers of Jira Cloud's public APIs, what it does not yet, and what it cannot, because Atlassian keeps it for Jira administrators, for apps, or out of the public API altogether.

Sources: the [platform REST v3](https://developer.atlassian.com/cloud/jira/platform/rest/v3/intro/) and [Jira Software (Agile 1.0)](https://developer.atlassian.com/cloud/jira/software/rest/intro/) resource groups, as listed in their references. Checked against the command tree on `main` plus the draft batch-one branch.

`jira api <path> -X <method> -d <json>` reaches any endpoint below, so "gap" means "no command of its own", not "impossible".

## Legend

| Status    | Meaning                                                                                                      |
| --------- | ------------------------------------------------------------------------------------------------------------ |
| covered   | read and write the CLI can usefully do are there                                                             |
| partial   | some of it: usually reads, or one write of several                                                           |
| in flight | built in the batch-one draft, awaiting review                                                                |
| gap       | allowed for an ordinary user or project admin, no command yet                                                |
| admin     | needs the global Administer Jira permission; the CLI should refuse with a clear message rather than build it |
| app       | only callable by Connect or Forge apps, or OAuth integrations; not reachable with a user API token           |
| low       | public and allowed, but rarely needed from a terminal                                                        |

## Headline

| API              | Groups | covered | partial | in flight | gap | low | admin | app |
| ---------------- | -----: | ------: | ------: | --------: | --: | --: | ----: | --: |
| Platform REST v3 |     94 |       9 |      14 |         3 |   9 |  20 |    27 |  12 |
| Agile 1.0        |     13 |       0 |       4 |         0 |   0 |   0 |     0 |   9 |

Of the 107 groups, 48 are closed to a non-admin user token (admin or app). Of the 59 left, the CLI touches 30 (batch one included); the 9 real gaps plus the board settings below are where the work is.

## Platform REST v3

| Group                                                 | CLI today                                                                                                  | Status    |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | --------- |
| Issues                                                | `issue list/view/create/edit/delete/assign/transition/open/history`; custom fields via `--field` in flight | covered   |
| Issue search                                          | `search`, `meta count`, `issue list --jql`                                                                 | covered   |
| Issue comments                                        | `issue comment list/add/edit/delete`                                                                       | covered   |
| Issue watchers                                        | `issue watch list/add/remove`                                                                              | covered   |
| Issue worklogs                                        | `issue worklog list/add/edit/delete`                                                                       | covered   |
| Issue remote links                                    | `issue remotelink list/add/remove`                                                                         | covered   |
| Myself                                                | `whoami`                                                                                                   | covered   |
| Server info                                           | `meta server`                                                                                              | covered   |
| Labels                                                | `meta labels`                                                                                              | covered   |
| Issue attachments                                     | `attachment list/upload/read/get`; no delete                                                               | partial   |
| Issue links                                           | `issue link add/list`; remove in flight                                                                    | partial   |
| Issue fields                                          | `fields`; field create/edit is admin                                                                       | partial   |
| Issue link types                                      | `meta` read; writes are admin                                                                              | partial   |
| Issue priorities                                      | `meta priorities`; writes are admin                                                                        | partial   |
| Issue resolutions                                     | `meta resolutions`; writes are admin                                                                       | partial   |
| Issue types                                           | `meta issuetypes`; writes are admin                                                                        | partial   |
| Workflow statuses                                     | `meta statuses`, `project statuses`; writes are admin                                                      | partial   |
| Filters                                               | `meta filters` (list); no view/create/edit/delete                                                          | partial   |
| Permissions                                           | `meta permissions`, `whoami --permissions`                                                                 | partial   |
| Projects                                              | `project list/view/statuses`; edit is a gap, create/delete admin                                           | partial   |
| Project components                                    | `project components` read; writes are a gap                                                                | partial   |
| Workflows                                             | `workflow list/get/for`; writes are admin                                                                  | partial   |
| Workflow schemes                                      | read through `workflow for`; writes are admin                                                              | partial   |
| Project versions                                      | `project versions` read; create/release/view in flight                                                     | in flight |
| Project roles                                         | `project roles` in flight                                                                                  | in flight |
| Project role actors                                   | `project role add/remove` in flight                                                                        | in flight |
| Filter sharing                                        | —                                                                                                          | gap       |
| Dashboards                                            | — (view, copy; edit needs ownership)                                                                       | gap       |
| Issue bulk operations                                 | — (batch one loops per issue; the native API needs the global Bulk change permission)                      | gap       |
| Issue votes                                           | —                                                                                                          | gap       |
| JQL                                                   | — (validate, autocomplete, sanitise)                                                                       | gap       |
| Users                                                 | `user search`; assignable users for a project is a gap                                                     | gap       |
| Permission schemes                                    | — (read the project's grants; writes are admin)                                                            | gap       |
| Issue notification schemes                            | — (read the project's scheme)                                                                              | gap       |
| Project features                                      | —                                                                                                          | gap       |
| Tasks                                                 | — (polling async tasks; needed only by native bulk)                                                        | low       |
| Avatars                                               | —                                                                                                          | low       |
| Classification levels                                 | —                                                                                                          | low       |
| Group and user picker                                 | —                                                                                                          | low       |
| Issue comment properties                              | —                                                                                                          | low       |
| Issue properties                                      | —                                                                                                          | low       |
| Issue security level                                  | —                                                                                                          | low       |
| Issue type properties                                 | —                                                                                                          | low       |
| Issue worklog properties                              | —                                                                                                          | low       |
| Jira expressions                                      | —                                                                                                          | low       |
| Project avatars                                       | —                                                                                                          | low       |
| Project classification levels                         | —                                                                                                          | low       |
| Project key and name validation                       | —                                                                                                          | low       |
| Project properties                                    | —                                                                                                          | low       |
| Project types                                         | —                                                                                                          | low       |
| User properties                                       | —                                                                                                          | low       |
| User search                                           | covered by `user search`                                                                                   | low       |
| Workflow status categories                            | —                                                                                                          | low       |
| Plans                                                 | — (Premium only)                                                                                           | low       |
| Teams in plan                                         | — (Premium only)                                                                                           | low       |
| Issue redaction                                       | —                                                                                                          | low       |
| Announcement banner                                   | —                                                                                                          | admin     |
| Application roles                                     | —                                                                                                          | admin     |
| Audit records                                         | —                                                                                                          | admin     |
| Groups                                                | — (membership writes; group reads need Browse users)                                                       | admin     |
| Issue custom field associations                       | —                                                                                                          | admin     |
| Issue custom field contexts                           | —                                                                                                          | admin     |
| Issue custom field options                            | —                                                                                                          | admin     |
| Issue field configurations                            | —                                                                                                          | admin     |
| Issue navigator settings                              | —                                                                                                          | admin     |
| Issue security schemes                                | —                                                                                                          | admin     |
| Issue type schemes                                    | —                                                                                                          | admin     |
| Issue type screen schemes                             | —                                                                                                          | admin     |
| Jira settings                                         | —                                                                                                          | admin     |
| License metrics                                       | —                                                                                                          | admin     |
| Priority schemes                                      | —                                                                                                          | admin     |
| Project categories                                    | — (reads are open, writes admin)                                                                           | admin     |
| Project email                                         | —                                                                                                          | admin     |
| Project permission schemes                            | — (assigning a scheme)                                                                                     | admin     |
| Project templates                                     | —                                                                                                          | admin     |
| Screens                                               | —                                                                                                          | admin     |
| Screen tabs                                           | —                                                                                                          | admin     |
| Screen tab fields                                     | —                                                                                                          | admin     |
| Screen schemes                                        | —                                                                                                          | admin     |
| Status                                                | — (bulk status writes)                                                                                     | admin     |
| Time tracking                                         | —                                                                                                          | admin     |
| Workflow scheme drafts                                | —                                                                                                          | admin     |
| Workflow scheme project associations                  | —                                                                                                          | admin     |
| Workflow transition properties                        | — (also deprecated)                                                                                        | admin     |
| App data policies                                     | —                                                                                                          | app       |
| App migration                                         | —                                                                                                          | app       |
| App properties                                        | —                                                                                                          | app       |
| Dynamic modules                                       | —                                                                                                          | app       |
| Issue custom field configuration (apps)               | —                                                                                                          | app       |
| Issue custom field options (apps)                     | —                                                                                                          | app       |
| Issue custom field values (apps)                      | —                                                                                                          | app       |
| JQL functions (apps)                                  | —                                                                                                          | app       |
| Service Registry                                      | —                                                                                                          | app       |
| UI modifications (apps)                               | —                                                                                                          | app       |
| Webhooks                                              | — (dynamic webhooks are for apps; site webhooks are admin, UI only)                                        | app       |
| Workflow transition rules                             | —                                                                                                          | app       |

## Agile 1.0

| Group                   | CLI today                                                                                                               | Status  |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------- |
| Board                   | `board list/view/issues/backlog/epics`; settings reads in this branch; create, delete, features and properties are gaps | partial |
| Sprint                  | `sprint list/view/issues/add`; create/start/close/edit in flight                                                        | partial |
| Backlog                 | `backlog add`                                                                                                           | partial |
| Issue                   | `issue rank`; estimation read/write is a gap                                                                            | partial |
| Epic                    | — (`epic` and `board epics` read issues; the group itself is being replaced by the parent field)                        | app     |
| Builds                  | —                                                                                                                       | app     |
| Deployments             | —                                                                                                                       | app     |
| Development information | —                                                                                                                       | app     |
| DevOps components       | —                                                                                                                       | app     |
| Feature flags           | —                                                                                                                       | app     |
| Operations              | —                                                                                                                       | app     |
| Remote links            | —                                                                                                                       | app     |
| Security information    | —                                                                                                                       | app     |

The integration groups (Builds through Security information) take a Connect JWT or OAuth integration token, not a user API token.

## Board settings

Most of a board's configuration has no public write at all. The public Agile API reads a part of it; the web UI talks to a private API (`/rest/greenhopper/1.0/...`) for the rest. The CLI reaches the private API only behind `--private-api`, whose help says it is unsupported and may break without notice.

| Setting                             | Public API                         | Private API | CLI                                      |
| ----------------------------------- | ---------------------------------- | ----------- | ---------------------------------------- |
| Columns, status mapping, WIP limits | read (`board/{id}/configuration`)  | read/write  | read (`board view`, `board settings`)    |
| Estimation statistic, ranking field | read                               | read/write  | read                                     |
| Kanban sub-filter                   | read                               | read/write  | read                                     |
| Quick filters                       | read (`board/{id}/quickfilter`)    | read/write  | read (`board quickfilters`)              |
| Board features                      | read/write (`board/{id}/features`) | —           | read; toggle is a gap                    |
| Board properties                    | read/write                         | —           | gap                                      |
| Board filter JQL                    | through `filter/{id}`, owner only  | —           | read; edit is a gap                      |
| Swimlanes                           | —                                  | read/write  | read (`--private-api`)                   |
| Card colours                        | —                                  | read/write  | read and guarded write (`--private-api`) |
| Card layout                         | —                                  | read/write  | read (`--private-api`)                   |
| Working days                        | —                                  | read/write  | read (`--private-api`)                   |
| Board admins                        | read (`board?expand=admins`)       | read/write  | read (`whoami --permissions --board`)    |
| Create / delete board               | write                              | —           | gap                                      |

## Outside REST v3

- **Automation** (its own API, `/gateway/api/automation`): `automation list/get/create/update/enable/disable`. Rule management needs Administer Jira, even for a project's own rules; a project admin edits them in the web UI only. The CLI says so up front in `whoami --permissions` and points to the project's automation page on a refusal.
- **Reports** (sprint report, velocity, burndown): not in any public API. Approximate them with JQL.

## Order of work

Slices are sized to ship one at a time, each a draft PR. The project-admin writes are tracked separately in the batch-one plan.

1. **Board settings reads, card colours, automation fallback.** This branch.
2. **Filters.** `filter view/create/edit/share/delete`, `board filter <id>`, and `issue list --board <id> --quickfilter <name>`.
3. **Project-admin batch two.** Component writes, fields per issue type (editmeta, createmeta), permission and notification scheme reads, assignable users, `issue create --from`.
4. **Board writes.** Public first: features toggle, properties, create, delete. Then, behind `--private-api`: quick filters, swimlanes, columns and WIP, working days, card layout, estimation, each with the same dry-run diff as card colours.
5. **Smaller reads and writes.** Dashboards (list, view, copy), votes, notify, project edit and features, attachment delete, `jql validate`.
6. **Native bulk.** `/rest/api/3/bulk/issues/*` with task polling, for sites where the per-issue loop is too slow and the Bulk change permission is granted.

Admin-only and app-only groups stay out: a refusal names the permission, and `jira api` remains the escape hatch.
