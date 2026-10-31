## Why

Two exploratory sessions on 0.8.4 left two open issues. Re-run on `main` at `b2e03fc` on 2026-10-31:

- [#153](https://github.com/drakulavich/oura-cli/issues/153): on a 60-column terminal, eight lines are wider than the screen and wrap. The six `db trends` rows are 63 characters, the `report` Steps average is 62, and the "Low readiness" recommendation is 63. Quinn reads these in a narrow split pane or on a phone. The `db rows battery` header from the issue fits now.
- [#154](https://github.com/drakulavich/oura-cli/issues/154) item 1: `describe --format table` prints JSON and exits 0. `manifest`, `healthcheck` and `fetch` do the same (`fetch sleep --format table` prints `[]`). The flag is dropped without a word, so Marcus and Aria cannot tell that their request was not honoured.
- #154 item 4: the `import.startDate` that `sync --format json` returns is the oldest resume day across collections. Nothing tells Aria that, and since #132 the terminal header no longer prints this window.

## What Changes

- At 60 columns, `db trends` and the `report` averages and recommendations fit within the Output mode's table width. A trend row's label column is as wide as the widest label. In `report`, an average line wider than the screen moves its `(min, max, days)` part to a line of its own, and a recommendation wraps under its own text.
- `describe`, `manifest`, `healthcheck` and `fetch` refuse `--format table` with a `CliError` of code `BAD_ARGS`, exit 1, and a hint that the command prints JSON only. `--format json` and no `--format` still print JSON.
- The `sync` row of `skills/oura-cli/SKILL.md` says that `import.startDate` is the oldest resume day across collections.

No data changes. No table, column, index or file format changes, so there is nothing to measure for storage.

## Non-goals

These are the decisions from 2026-10-31 that leave the rest of #153 and #154 as they are:
- **`sync` count grid.** It keeps reflowing by the widest count. Pinning the cell width would make it wider on every run and fit fewer columns on a narrow screen.
- **The database path in `doctor`.** It stays unbreakable at any width.
- **Damaged pages (#154 item 2).** There is no `quick_check` in read commands or in `doctor`. SQLite reports damage only on the pages a query reads, and that stays the behaviour.
- **"Data current through" in `doctor` (#154 item 3).** It still reads the daily tables only. VO2 max is measured rarely, so a per-collection date would raise false alarms.
- **No `resumeFrom` per collection (#154 item 4).** The `sync` JSON shape does not change.
- **The valueless `--token` (#154 item 5).** Nothing to do: #148 already made it `BAD_ARGS`.

## Impact

- Code:
  - `src/render/format.ts`: `formatTrends`;
  - `src/render/format-report.ts`: averages, recommendations;
  - the four JSON-only commands under `src/commands/`, or one guard they share.
- Tests: co-located `*.test.ts`. Each new test goes red under a one-line mutation of the line it pins.
- Docs: `skills/oura-cli/SKILL.md`, `CHANGELOG.md` under `[Unreleased]`.
- Personas: Quinn (narrow terminal), Marcus and Aria (the refusal, `startDate`).
