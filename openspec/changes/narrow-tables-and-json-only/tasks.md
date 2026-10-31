## 1. Narrow terminal (#153)

- [ ] 1.1 `formatTrends` pads labels to the widest label; a test with a `(365 days)` row asserts every line ≤ 60 and goes red with `padEnd(15)` restored
- [ ] 1.2 `report` averages: an average line wider than `max` puts its `(min, max, days)` part on the next line; a test at width 60 and one at 80 pin both shapes
- [ ] 1.3 `report` recommendations wrap under the text after `• `; a test at width 60 goes red with the wrap removed
- [ ] 1.4 `CHANGELOG.md` bullet under `[Unreleased]`, Fixed

## 2. JSON-only commands refuse `--format table` (#154 item 1)

- [ ] 2.1 `describe`, `manifest`, `healthcheck`, `fetch` exit 1 with `BAD_ARGS` on `--format table`, hint naming JSON only; `--format json` and no flag are unchanged
- [ ] 2.2 One CLI test per command through the real entry point; red when the guard is removed
- [ ] 2.3 `CHANGELOG.md` bullet under `[Unreleased]`, Changed

## 3. `import.startDate` (#154 item 4)

- [ ] 3.1 `skills/oura-cli/SKILL.md` `sync` row says `startDate` is the oldest resume day across collections

## 4. Close-out

- [ ] 4.1 #154: a comment records the decisions for items 2, 3, 4 and 5 (Non-goals in `proposal.md`)
- [ ] 4.2 `bun run check` passes; `bun test --randomize` passes
- [ ] 4.3 `openspec validate narrow-tables-and-json-only --strict` passes

## Definition of Done

- [ ] On a 60-column pty, `db trends` and `report` against a copy of the real cache print no line over 60 (the `script` probe in `design.md`).
- [ ] `oura-cli describe --format table; echo $?` prints nothing on stdout and `1`; same for `manifest`, `healthcheck`, `fetch sleep`.
- [ ] `grep -n 'oldest resume day' skills/oura-cli/SKILL.md` finds the `sync` row.
- [ ] Each new test is red under its one-line mutation, quoted in the PR.
- [ ] `bun run check` passes.
