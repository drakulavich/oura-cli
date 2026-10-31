# Design

## Technical Notes

- Trend rows: `src/render/format.ts:173`. The label is padded to 15 (`t.label.padEnd(15)`); the labels are `Sleep Score`, `Readiness`, `Activity`, `Steps`, `Active Cal` (`src/db/queries.ts:110-114`) and `SpO2` (`:136`), 11 at most. Padded to 11, a row with `(365 days)` is 60 characters.
- The `db stats` trend rows (`src/render/format.ts:202`) carry no day count and are 54 characters; they stay as they are.
- Report averages: `src/render/format-report.ts:180` and the SpO2 line at `:185`; recommendations at `:223`. `formatReport` already takes `max = screenWidth()` (`:107`), and `wrap()` (`src/lib/wrap.ts:14`) breaks prose with a first-line and a continuation indent.
- Format validation: `assertValidFormat` (`src/lib/format-resolve.ts:16`) runs in `run-command.ts:83` for commands that declare `--format`. Its comment (`:13`) records that the JSON-only commands never resolve a format.
- Measured on a copy of the real Local cache through `script` on a 60-column pty, 2026-10-31: `db trends` 6 lines over (63), `report` 2 lines over (62, 63). `db today`, `db week`, `db stats`, `db date`, `db rows` had none over. `doctor` had 1 over, its database path.

## Open Issues

- #154 item 1 asked whether these commands should refuse "as `fetch` does". `fetch sleep --format table` exits 0 and prints `[]`, so `fetch` does not refuse either. This change makes `fetch` refuse too: it is JSON-only by design (CLAUDE.md). The 2026-10-31 decision was made on the wrong premise and needs the user's confirmation.
