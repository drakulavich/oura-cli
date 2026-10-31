# Design

## Technical Notes

- Trend rows: `src/render/format.ts:173`. The label is padded to 15 (`t.label.padEnd(15)`); the labels are `Sleep Score`, `Readiness`, `Activity`, `Steps`, `Active Cal` (`src/db/queries.ts:110-114`) and `SpO2` (`:136`), 11 at most. Padded to 11, a row with `(365 days)` is 60 characters.
- The `db stats` trend rows (`src/render/format.ts:202`) carry no day count and are 54 characters; they stay as they are.
- Report averages: `src/render/format-report.ts:180` and the SpO2 line at `:185`; recommendations at `:223`. `formatReport` already takes `max = screenWidth()` (`:107`), and `wrap()` (`src/lib/wrap.ts:14`) breaks prose with a first-line and a continuation indent.
- Format validation: `describe`, `manifest` and `healthcheck` never enter `execute`; they call `assertKnownArgs` (`src/commands/describe.ts:153`, `manifest.ts:64`, `healthcheck.ts:12`), which runs `assertValidFormat` (`src/lib/format-resolve.ts:16`). `fetch` goes through `execute`, which forces JSON for a `jsonOnly` command (`src/commands/run-command.ts:121`), and builds `OuraClient` inside `run` (`src/commands/fetch.ts:71`), whose constructor throws `TOKEN_MISSING` (`src/api/client.ts:97-99`). One refusal shared by the three direct runs and by `execute` for a `jsonOnly` command, ahead of `run`, covers all four; refusing `table` inside `assertValidFormat` would also take the table mode from `db` and `report`.
- Trend rows that cannot fit: `--days` accepts any positive integer (`src/lib/validate.ts:13`), and `padStart` does not truncate, so a four-digit day count or a six-digit value widens its row. Today's data has neither: steps max `23700`, 28 days.
- Measured on a copy of the real Local cache through `script` on a 60-column pty, 2026-10-31: `db trends` 6 lines over (63), `report` 2 lines over (62, 63). `db today`, `db week`, `db stats`, `db date`, `db rows` had none over. `doctor` had 1 over, its database path.

## Decisions

- #154 item 1 asked whether these commands should refuse "as `fetch` does", but `fetch sleep --format table` exited 0 with `[]`. On 2026-10-31 the user confirmed that `fetch` refuses as well.
