# @kud/jira-cli

Jira on the command line — read issues, comments and attachments as plain text.

## Terminal UI

The TUI here is built with [`@kud/ink-ui`](https://github.com/kud/ink-ui), the house Ink design system — pre-styled components, the `useTabs`/`useListCursor` keyboard hooks, and `colors`/`spacing` design tokens.

**Before writing or changing any UI component, read `node_modules/@kud/ink-ui/AGENTS.md`.** It ships with the package and carries what the type definitions cannot express: which components own their own Ink `useInput` versus which are presentational, what to compose for a given screen, and the known traps. The exhaustive component surface is `node_modules/@kud/ink-ui/dist/index.d.ts`.

Never hand-roll a component without checking there first — bordered panes, scrolling viewports, selectable rows, tables, tab bars, spinners, progress bars and key-hint footers are all provided. Colour comes from the `colors` token object, never a string literal.
