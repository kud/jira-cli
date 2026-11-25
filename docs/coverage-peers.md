# Coverage compared with other Jira tools

This page lists what five other public Jira tools wrap, command by command or tool by tool, and ends with the capabilities at least one of them has that `jira` does not. It was read on 2026-11-25, at the commits and pages listed under each section. It is curated by hand, so it will drift as those projects change; treat the shas as the date stamp.

REST operationIds come from Atlassian's published specs: the Jira Cloud platform spec (`swagger-v3.v3.json`) and the Jira Software spec (`swagger.v3.json`). An operationId is given only when the peer's own source makes the endpoint clear, usually a URL in its code. Where a tool calls Jira through a client library method, or its source is not public, the column says "—".

| **Peer**                       | **Kind**          | **Source read**                     | **Date read** |
| ------------------------------ | ----------------- | ----------------------------------- | ------------- |
| ankitpokhrel/jira-cli          | Go CLI (cobra)    | `9b593fd`                           | 2026-11-25    |
| go-jira/jira                   | Go CLI            | `748b7d5`                           | 2026-11-25    |
| Atlassian CLI (`acli`)         | Closed-source CLI | public command reference            | 2026-11-25    |
| atlassian/atlassian-mcp-server | Hosted MCP server | `352a02b` plus supported-tools page | 2026-11-25    |
| sooperset/mcp-atlassian        | Python MCP server | `29518e3`                           | 2026-11-25    |

## ankitpokhrel/jira-cli

Source: [ankitpokhrel/jira-cli@9b593fd47518d207897878cc31ac3000231151f1](https://github.com/ankitpokhrel/jira-cli/tree/9b593fd47518d207897878cc31ac3000231151f1/internal/cmd), `internal/cmd` (command tree) and `pkg/jira` (HTTP calls). Read 2026-11-25.

| **Command**                                   | **What it does**                     | **operationId(s)**                            |
| --------------------------------------------- | ------------------------------------ | --------------------------------------------- |
| `jira init`                                   | Write the config file                | —                                             |
| `jira issue list`                             | Search issues                        | `searchAndReconsileIssuesUsingJql`            |
| `jira issue view`                             | Show one issue                       | `getIssue`                                    |
| `jira issue create`                           | Create an issue                      | `createIssue`, `getCreateIssueMetaIssueTypes` |
| `jira issue edit`                             | Edit an issue                        | `editIssue`                                   |
| `jira issue delete`                           | Delete an issue                      | `deleteIssue`                                 |
| `jira issue assign`                           | Assign an issue                      | `assignIssue`, `findAssignableUsers`          |
| `jira issue move`                             | Transition an issue                  | `getTransitions`, `doTransition`              |
| `jira issue clone`                            | Copy an issue                        | `getIssue`, `createIssue`                     |
| `jira issue link`                             | Link two issues                      | `linkIssues`, `getIssueLinkTypes`             |
| `jira issue link remote`                      | Add a web link                       | `createOrUpdateRemoteIssueLink`               |
| `jira issue unlink`                           | Remove a link                        | `getIssue`, `deleteIssueLink`                 |
| `jira issue comment add`                      | Add a comment                        | `addComment`                                  |
| `jira issue worklog add`                      | Log time                             | `addWorklog`                                  |
| `jira issue watch`                            | Add a watcher                        | `addWatcher`                                  |
| `jira epic list`                              | List epics or an epic's issues       | `getIssuesForEpic`                            |
| `jira epic create`                            | Create an epic                       | `createIssue`                                 |
| `jira epic add`                               | Add issues to an epic                | `moveIssuesToEpic`                            |
| `jira epic remove`                            | Remove issues from an epic           | `removeIssuesFromEpic`                        |
| `jira sprint list`                            | List sprints or a sprint's issues    | `getAllSprints`, `getIssuesForSprint`         |
| `jira sprint add`                             | Add issues to a sprint               | `moveIssuesToSprintAndRank`                   |
| `jira sprint close`                           | Close a sprint                       | `updateSprint`                                |
| `jira board list`                             | List boards                          | `getAllBoards`                                |
| `jira project list`                           | List projects                        | `getAllProjects`                              |
| `jira release list`                           | List project versions                | `getProjectVersions`                          |
| `jira open`                                   | Open in the browser                  | —                                             |
| `jira me`                                     | Current user                         | `getCurrentUser`                              |
| `jira serverinfo`                             | Server details                       | `getServerInfo`                               |
| `jira completion`, `jira man`, `jira version` | Shell completion, man pages, version | — (local)                                     |

## go-jira/jira

Source: [go-jira/jira@748b7d552f8b3ad993b05810b93f0f2ed39822d1](https://github.com/go-jira/jira/tree/748b7d552f8b3ad993b05810b93f0f2ed39822d1/jiracmd), `jiracmd/registry.go` (command list) and the root package (HTTP calls). Read 2026-11-25. The last commit at that sha is dated 2025-11-11. Commands are top-level (`jira <command>`).

| **Command**                                                                                                                    | **What it does**             | **operationId(s)**                  |
| ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------- | ----------------------------------- |
| `jira list`                                                                                                                    | Search issues                | `searchAndReconsileIssuesUsingJql`  |
| `jira view`                                                                                                                    | Show one issue               | `getIssue`                          |
| `jira create`                                                                                                                  | Create an issue              | `createIssue`, `getCreateIssueMeta` |
| `jira subtask`                                                                                                                 | Create a sub-task            | `createIssue`                       |
| `jira edit`                                                                                                                    | Edit an issue                | `editIssue`, `getEditIssueMeta`     |
| `jira createmeta`                                                                                                              | Show create metadata         | `getCreateIssueMeta`                |
| `jira editmeta`                                                                                                                | Show edit metadata           | `getEditIssueMeta`                  |
| `jira issuetypes`                                                                                                              | List issue types             | —                                   |
| `jira fields`                                                                                                                  | List fields                  | `getFields`                         |
| `jira assign`, `jira take`, `jira unassign`                                                                                    | Set or clear the assignee    | `assignIssue`                       |
| `jira transition`, plus `acknowledge`, `backlog`, `close`, `done`, `in-progress`, `reopen`, `resolve`, `start`, `stop`, `todo` | Transition an issue          | `getTransitions`, `doTransition`    |
| `jira transitions`, `jira transmeta`                                                                                           | List transitions             | `getTransitions`                    |
| `jira comment`                                                                                                                 | Add a comment                | `addComment`                        |
| `jira labels add`, `labels remove`, `labels set`                                                                               | Change labels                | `editIssue`                         |
| `jira issuelink`                                                                                                               | Link two issues              | `linkIssues`                        |
| `jira block`, `jira dup`                                                                                                       | Link as blocker or duplicate | `linkIssues`                        |
| `jira issuelinktypes`                                                                                                          | List link types              | `getIssueLinkTypes`                 |
| `jira components`                                                                                                              | List project components      | `getProjectComponents`              |
| `jira component add`                                                                                                           | Create a component           | `createComponent`                   |
| `jira attach create`                                                                                                           | Upload an attachment         | `addAttachment`                     |
| `jira attach list`                                                                                                             | List attachments             | —                                   |
| `jira attach get`                                                                                                              | Download an attachment       | —                                   |
| `jira attach remove`                                                                                                           | Delete an attachment         | `removeAttachment`                  |
| `jira epic list`                                                                                                               | List an epic's issues        | `getIssuesForEpic`                  |
| `jira epic create`                                                                                                             | Create an epic               | `createIssue`                       |
| `jira epic add`                                                                                                                | Add issues to an epic        | `moveIssuesToEpic`                  |
| `jira epic remove`                                                                                                             | Remove issues from an epic   | `removeIssuesFromEpic`              |
| `jira rank`                                                                                                                    | Rank issues                  | `rankIssues`                        |
| `jira vote`                                                                                                                    | Vote or unvote               | `addVote`, `removeVote`             |
| `jira watch`                                                                                                                   | Add or remove a watcher      | `addWatcher`, `removeWatcher`       |
| `jira worklog list`                                                                                                            | List worklogs                | `getIssueWorklog`                   |
| `jira worklog add`                                                                                                             | Log time                     | `addWorklog`                        |
| `jira browse`                                                                                                                  | Open in the browser          | —                                   |
| `jira request`                                                                                                                 | Raw REST request             | — (passthrough)                     |
| `jira login`, `jira logout`, `jira session`                                                                                    | Session cookie handling      | —                                   |
| `jira export-templates`, `jira unexport-templates`                                                                             | Manage local templates       | — (local)                           |

## Atlassian CLI (`acli jira`)

Source: the public command reference at [developer.atlassian.com/cloud/acli/reference/commands/](https://developer.atlassian.com/cloud/acli/reference/commands/) and its `jira-*` subpages, fetched 2026-11-25. The CLI's source is not public, so no operationIds are given.

| **Command**                                                     | **What it does**                     | **operationId(s)** |
| --------------------------------------------------------------- | ------------------------------------ | ------------------ |
| `acli jira auth login`, `logout`, `status`, `switch`            | Authenticate, switch account         | —                  |
| `acli jira workitem search`                                     | Search work items                    | —                  |
| `acli jira workitem view`                                       | Show one work item                   | —                  |
| `acli jira workitem create`                                     | Create a work item                   | —                  |
| `acli jira workitem create-bulk`                                | Create many work items               | —                  |
| `acli jira workitem edit`                                       | Edit a work item                     | —                  |
| `acli jira workitem delete`                                     | Delete a work item                   | —                  |
| `acli jira workitem assign`                                     | Assign a work item                   | —                  |
| `acli jira workitem transition`                                 | Transition a work item               | —                  |
| `acli jira workitem clone`                                      | Copy a work item                     | —                  |
| `acli jira workitem archive`, `unarchive`                       | Archive or restore work items        | —                  |
| `acli jira workitem comment create`, `list`, `update`, `delete` | Manage comments                      | —                  |
| `acli jira workitem comment visibility`                         | Restrict comment visibility          | —                  |
| `acli jira workitem attachment list`, `delete`                  | List or delete attachments           | —                  |
| `acli jira workitem link create`, `list`, `delete`, `type`      | Manage links and list link types     | —                  |
| `acli jira workitem watcher remove`                             | Remove a watcher                     | —                  |
| `acli jira project list`, `view`                                | List or show projects                | —                  |
| `acli jira project create`, `update`, `delete`                  | Create, change, delete projects      | —                  |
| `acli jira project archive`, `restore`                          | Archive or restore projects          | —                  |
| `acli jira board search`                                        | Find boards                          | —                  |
| `acli jira board list-sprints`                                  | List a board's sprints               | —                  |
| `acli jira sprint list-workitems`                               | List a sprint's work items           | —                  |
| `acli jira filter list`, `search`                               | List or find filters                 | —                  |
| `acli jira filter add-favourite`                                | Favourite a filter                   | —                  |
| `acli jira filter change-owner`                                 | Change a filter's owner              | —                  |
| `acli jira dashboard search`                                    | Find dashboards                      | —                  |
| `acli jira field create`, `delete`, `cancel-delete`             | Create, trash, restore custom fields | —                  |

## atlassian/atlassian-mcp-server

Source: [atlassian/atlassian-mcp-server@352a02b05189e2a958a973867cc6eca365cb8fc3](https://github.com/atlassian/atlassian-mcp-server/tree/352a02b05189e2a958a973867cc6eca365cb8fc3). The repository holds configuration and docs, not the server; its README points to the [supported tools](https://support.atlassian.com/atlassian-rovo-mcp-server/docs/supported-tools/) page, from which the Jira tools below were taken on 2026-11-25. The server is hosted and closed, so no operationIds are given. Jira Service Management and Jira Align tools are left out. `delete_jira` and `manage_jira` tools are off by default and need an admin to enable them.

| **Tool**                                          | **What it does**                                | **operationId(s)** |
| ------------------------------------------------- | ----------------------------------------------- | ------------------ |
| `getJiraIssue`                                    | Show one issue                                  | —                  |
| `searchJiraIssuesUsingJql`                        | Search issues                                   | —                  |
| `createJiraIssue`                                 | Create an issue                                 | —                  |
| `editJiraIssue`                                   | Edit an issue                                   | —                  |
| `transitionJiraIssue`                             | Transition, or move to sprint or backlog        | —                  |
| `convertJiraIssueHierarchy`                       | Issue to sub-task and back                      | —                  |
| `listJiraIssueTransitions`                        | List transitions                                | —                  |
| `listJiraIssueChangelogs`                         | Field-change history                            | —                  |
| `listJiraIssueComments`                           | List comments                                   | —                  |
| `addOrEditJiraIssueComment`                       | Add or edit a comment                           | —                  |
| `listJiraIssueWorklogs`                           | List worklogs                                   | —                  |
| `addOrEditJiraIssueWorklog`                       | Log or edit time                                | —                  |
| `listJiraIssueLinkTypes`                          | List link types                                 | —                  |
| `createJiraIssueLink`                             | Link two issues                                 | —                  |
| `listJiraIssueRemoteIssueLinks`                   | List web links                                  | —                  |
| `createJiraIssueRemoteIssueLink`                  | Add a web link                                  | —                  |
| `watchJiraIssue`                                  | Watch or unwatch                                | —                  |
| `uploadAttachmentToJiraIssue`                     | Upload an attachment                            | —                  |
| `downloadJiraIssueAttachment`                     | Download URL for an attachment                  | —                  |
| `listJiraIssueAssignableUsers`                    | Assignable users                                | —                  |
| `lookupJiraAccountId`                             | Find account id by name or email                | —                  |
| `getJiraCurrentUser`                              | Current user                                    | —                  |
| `getJiraUser`                                     | User profile by account id                      | —                  |
| `listJiraProjects`                                | List projects                                   | —                  |
| `listJiraProjectIssueTypesMetadata`               | Project issue types                             | —                  |
| `getJiraIssueTypeMetaWithFields`                  | Field metadata for one issue type               | —                  |
| `listJiraStatuses`                                | List statuses                                   | —                  |
| `listJiraProjectComponents`                       | List components                                 | —                  |
| `getJiraProjectVersions`                          | List or show versions                           | —                  |
| `manageJiraProjectVersion`                        | Create, update, release, archive a version      | —                  |
| `getJiraProjectVersionRelatedWork`                | Read a version's related work                   | —                  |
| `manageJiraProjectVersionRelatedWork`             | Add or change related work                      | —                  |
| `listJiraBoards`                                  | List boards                                     | —                  |
| `getJiraBoardConfig`                              | Board filter and columns                        | —                  |
| `getJiraBoardIssueData`                           | Board or backlog issues                         | —                  |
| `getJiraBoardSprintData`                          | Board plus sprint data                          | —                  |
| `listJiraBoardSprints`                            | List a board's sprints                          | —                  |
| `manageJiraSprint`                                | Create, populate, start, update, close a sprint | —                  |
| `createJiraBoard`                                 | Create a board from a filter                    | —                  |
| `listJiraFilters`                                 | Search saved filters                            | —                  |
| `listJiraDashboards`                              | List dashboards                                 | —                  |
| `getJiraEntityProperty`, `editJiraEntityProperty` | Read or set entity properties                   | —                  |
| `deleteJiraIssue`                                 | Delete an issue                                 | —                  |
| `deleteJiraComment`                               | Delete a comment                                | —                  |
| `deleteJiraIssueAttachment`                       | Delete an attachment                            | —                  |
| `createJiraProject`, `updateJiraProject`          | Create or change a project                      | —                  |
| `getJiraWorkflows`                                | Read a project's workflows                      | —                  |
| `getJiraWorkflowEditorLink`                       | Pre-filled workflow-editor link                 | —                  |
| `getJiraScreen`, `updateJiraScreen`               | Inspect or change a screen                      | —                  |

## sooperset/mcp-atlassian

Source: [sooperset/mcp-atlassian@29518e3a438c1f92ad71bd78e7f02bdd0d3ee06c](https://github.com/sooperset/mcp-atlassian/blob/29518e3a438c1f92ad71bd78e7f02bdd0d3ee06c/src/mcp_atlassian/servers/jira.py), `src/mcp_atlassian/servers/jira.py` (63 `@jira_mcp.tool` functions) and `src/mcp_atlassian/jira/` (HTTP calls). Read 2026-11-25. The Jira server is mounted under the `jira` namespace, so each function is exposed as `jira_<name>` (for example `jira_get_issue`). Most calls go through a client library; operationIds are given only where the code builds the URL itself.

| **Tool**                                                                                               | **What it does**                     | **operationId(s)**                                     |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------ | ------------------------------------------------------ |
| `jira_get_issue`                                                                                       | Show one issue                       | `getIssue`                                             |
| `jira_search`                                                                                          | Search issues                        | `searchAndReconsileIssuesUsingJql`                     |
| `jira_get_project_issues`                                                                              | A project's issues                   | —                                                      |
| `jira_create_issue`                                                                                    | Create an issue                      | —                                                      |
| `jira_batch_create_issues`                                                                             | Create many issues                   | —                                                      |
| `jira_update_issue`                                                                                    | Edit an issue                        | —                                                      |
| `jira_delete_issue`                                                                                    | Delete an issue                      | —                                                      |
| `jira_assign_issue`                                                                                    | Assign an issue                      | `assignIssue`                                          |
| `jira_move_issue`                                                                                      | Move to another project              | `submitBulkMove`                                       |
| `jira_get_transitions`                                                                                 | List transitions                     | —                                                      |
| `jira_transition_issue`                                                                                | Transition an issue                  | —                                                      |
| `jira_batch_get_changelogs`                                                                            | Changelogs for many issues           | `getBulkChangelogs`                                    |
| `jira_get_issue_dates`                                                                                 | Dates and status history             | —                                                      |
| `jira_get_issue_sla`                                                                                   | SLA metrics computed from history    | —                                                      |
| `jira_add_comment`                                                                                     | Add a comment                        | —                                                      |
| `jira_edit_comment`                                                                                    | Edit a comment                       | —                                                      |
| `jira_get_worklog`                                                                                     | List worklogs                        | —                                                      |
| `jira_add_worklog`                                                                                     | Log time                             | —                                                      |
| `jira_get_issue_watchers`                                                                              | List watchers                        | —                                                      |
| `jira_add_watcher`, `jira_remove_watcher`                                                              | Add or remove a watcher              | —                                                      |
| `jira_download_attachments`                                                                            | Download attachments                 | —                                                      |
| `jira_get_issue_images`                                                                                | Attached images as inline content    | —                                                      |
| `jira_get_link_types`                                                                                  | List link types                      | `getIssueLinkTypes`                                    |
| `jira_create_issue_link`                                                                               | Link two issues                      | —                                                      |
| `jira_remove_issue_link`                                                                               | Remove a link                        | —                                                      |
| `jira_create_remote_issue_link`                                                                        | Add a web link                       | `createOrUpdateRemoteIssueLink`                        |
| `jira_link_to_epic`                                                                                    | Put an issue under an epic           | —                                                      |
| `jira_get_project_epic_hierarchy`                                                                      | Group epics under parents            | —                                                      |
| `jira_get_cross_project_dependencies`                                                                  | Cross-project links                  | —                                                      |
| `jira_search_fields`                                                                                   | Find fields                          | —                                                      |
| `jira_get_field_options`                                                                               | Allowed values of a custom field     | `getContextsForField`, `getOptionsForContext`          |
| `jira_get_create_fields`                                                                               | Create fields for an issue type      | `getCreateIssueMetaIssueTypeId`                        |
| `jira_get_project_fields`                                                                              | Fields used across a project's types | —                                                      |
| `jira_get_project_issue_types`                                                                         | Project issue types                  | —                                                      |
| `jira_get_user_profile`                                                                                | User profile                         | `getUser`                                              |
| `jira_search_assignable_users`                                                                         | Assignable users                     | `findAssignableUsers`                                  |
| `jira_get_all_projects`                                                                                | List projects                        | —                                                      |
| `jira_search_projects`                                                                                 | Search projects                      | `searchProjects`                                       |
| `jira_get_project_versions`                                                                            | List versions                        | —                                                      |
| `jira_create_version`, `jira_batch_create_versions`                                                    | Create versions                      | —                                                      |
| `jira_update_version`                                                                                  | Update or release a version          | —                                                      |
| `jira_get_project_components`                                                                          | List components                      | —                                                      |
| `jira_get_agile_boards`                                                                                | List boards                          | —                                                      |
| `jira_get_board_issues`                                                                                | A board's issues                     | —                                                      |
| `jira_get_sprints_from_board`                                                                          | A board's sprints                    | —                                                      |
| `jira_get_sprint_issues`                                                                               | A sprint's issues                    | `getIssuesForSprint`                                   |
| `jira_create_sprint`                                                                                   | Create a sprint                      | —                                                      |
| `jira_update_sprint`                                                                                   | Update, start, close a sprint        | —                                                      |
| `jira_add_issues_to_sprint`                                                                            | Add issues to a sprint               | `moveIssuesToSprintAndRank`                            |
| `jira_move_issues_to_backlog`                                                                          | Move issues to the backlog           | `moveIssuesToBacklog`                                  |
| `jira_get_issue_development_info`, `jira_get_issues_development_info`                                  | Linked PRs, commits, branches        | — (`/rest/dev-status/1.0`, not in the published specs) |
| `jira_get_service_desk_for_project`, `jira_get_service_desk_queues`, `jira_get_queue_issues`           | Service desk queues                  | — (`/rest/servicedeskapi`, not in these specs)         |
| `jira_get_request_types`, `jira_get_request_type_fields`, `jira_create_customer_request`               | Service desk requests                | — (`/rest/servicedeskapi`, not in these specs)         |
| `jira_get_issue_proforma_forms`, `jira_get_proforma_form_details`, `jira_update_proforma_form_answers` | Read and answer forms                | — (Forms API, not in these specs)                      |

## They have, we lack

Capabilities at least one peer has and `jira` does not, ranked by how many peers have them. Same-capability items are merged across peers. Items marked "(in kud/jira-cli#5)" are in an open draft PR and not yet released.

Peers: **A** ankitpokhrel/jira-cli, **G** go-jira/jira, **C** `acli`, **M** atlassian-mcp-server, **S** sooperset/mcp-atlassian.

| **Capability**                                                       | **Count** | **Peers** | **operationId(s)**                                    |
| -------------------------------------------------------------------- | --------- | --------- | ----------------------------------------------------- |
| Start, close or update a sprint (in kud/jira-cli#5: start and close) | 3         | A, M, S   | `updateSprint`                                        |
| Remove an issue link (in kud/jira-cli#5)                             | 3         | A, C, S   | `deleteIssueLink`                                     |
| Delete an attachment                                                 | 3         | G, C, M   | `removeAttachment`                                    |
| Create-screen field metadata for an issue type                       | 3         | G, M, S   | `getCreateIssueMeta`, `getCreateIssueMetaIssueTypeId` |
| Create a sprint (in kud/jira-cli#5)                                  | 2         | M, S      | —                                                     |
| Create a version (in kud/jira-cli#5)                                 | 2         | M, S      | —                                                     |
| Update, release or archive a version (in kud/jira-cli#5: release)    | 2         | M, S      | —                                                     |
| Clone an issue                                                       | 2         | A, C      | `getIssue`, `createIssue`                             |
| Create issues in bulk                                                | 2         | C, S      | —                                                     |
| Create or update a project                                           | 2         | C, M      | —                                                     |
| List or search dashboards                                            | 2         | C, M      | —                                                     |
| User profile by account id                                           | 2         | M, S      | `getUser`                                             |
| Vote or unvote on an issue                                           | 1         | G         | `addVote`, `removeVote`                               |
| Create a component                                                   | 1         | G         | `createComponent`                                     |
| Edit-screen metadata for an issue                                    | 1         | G         | `getEditIssueMeta`                                    |
| Add or remove single labels without replacing the set                | 1         | G         | `editIssue`                                           |
| Allowed values of a custom field                                     | 1         | S         | `getContextsForField`, `getOptionsForContext`         |
| Move an issue to another project                                     | 1         | S         | `submitBulkMove`                                      |
| Changelogs for many issues at once                                   | 1         | S         | `getBulkChangelogs`                                   |
| Status dates and SLA figures from history                            | 1         | S         | —                                                     |
| Epic hierarchy and cross-project dependency reports                  | 1         | S         | —                                                     |
| Development info (PRs, commits, branches)                            | 1         | S         | — (`/rest/dev-status/1.0`)                            |
| Service desk queues and customer requests                            | 1         | S         | — (`/rest/servicedeskapi`)                            |
| ProForma forms                                                       | 1         | S         | — (Forms API)                                         |
| Archive or unarchive issues                                          | 1         | C         | —                                                     |
| Comment visibility restrictions                                      | 1         | C         | —                                                     |
| Delete, archive or restore a project                                 | 1         | C         | —                                                     |
| Favourite a filter, change a filter's owner                          | 1         | C         | —                                                     |
| Create, trash or restore a custom field                              | 1         | C         | —                                                     |
| Create a board                                                       | 1         | M         | —                                                     |
| Convert an issue to a sub-task and back                              | 1         | M         | —                                                     |
| Read or set entity properties                                        | 1         | M         | —                                                     |
| Version related work                                                 | 1         | M         | —                                                     |
| Inspect or change a screen                                           | 1         | M         | —                                                     |
| Pre-filled workflow-editor link                                      | 1         | M         | —                                                     |

### Treated as covered

These peer capabilities map onto existing `jira` commands and are not listed above:

- Epic create, add and remove, and linking an issue to an epic: `jira issue create` and `jira issue edit --parent`.
- Sub-task creation and `take`/`unassign`: `jira issue create --parent`, `jira issue assign`, `jira issue edit --assignee none`.
- Transition shortcuts and transition listing: `jira issue transition`.
- Version and release lists: `jira project versions`. Board and sprint search: `jira board list`, `jira sprint list`. Filter lists: `jira meta filters`.
- Assignable-user search: `jira user search --project`. Server info: `jira meta server`.
- Raw requests (`jira request` in go-jira): `jira api`.

Local CLI concerns (shell completion, man pages, templates, login sessions, account switching) are not Jira capabilities and are left out of the ranking.
