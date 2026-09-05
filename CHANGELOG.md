# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.5.0] - 2026-09-05

### Breaking
- Per-collection API commands replaced by `fetch <collection>`; `db reset` and `db import` removed. See "Changed" and "Removed" below.

### Changed
- `sync` fetches heartrate over the same window as every other collection (from the last synced day, or 30 days back on first sync) instead of today only. Days the ring synced while `oura-cli sync` did not run are no longer skipped; the unique `(timestamp, source)` index keeps re-fetched samples from duplicating.
- README "First five minutes" now leads with a concrete report sample,
  documents `login` → `doctor` → `sync` → `report` as the onboarding path,
  states plainly that `login` hides the token as you type, and adds a
  symptom → command recovery table.
- Text formatters moved from the repo root into `src/render/` (internal).
- Every data command runs through one runner that resolves the output format, opens and always closes the database, creates the API client and maps errors to exit codes. `sync` progress lines are printed together with the summary instead of streaming. `--no-color` now takes effect before any output (internal).
- Token resolution lives in `src/api/token.ts` and is shared by the API client and `doctor`; the two SQLite wrappers merged into `src/db/open.ts` (internal). A whitespace-only token is now rejected as missing instead of being sent as an empty bearer token.
- Every Oura collection is described once in `src/collections/`; table DDL, inserts and the sync loop derive from it. A test proves the derived DDL matches the shipped migrations (internal).
- **Breaking:** the seven per-collection commands (`sleep`, `readiness`, `activity`, `hr`, `spo2`, `stress`, `workout` × `today|date|week`) are replaced by `oura-cli fetch <collection> [--day D | --from A --to B | --days N]`. `sleep-periods` and `cv-age` are now fetchable too.
- `describe` and `manifest` are generated from the registered command tree, so they can no longer drift from the CLI; `manifest` examples that referenced a non-existent `--start` flag are gone.
- `docs/schemas/<collection>.json` are generated (`bun run schemas`) and checked by a test; added `sleep-periods.json` and `cv-age.json`.

### Removed
- `db reset` and the CSV importer it relied on (it read a hard-coded personal directory), and the `db import` alias of `sync`.
- `vo2max` no longer appears in `db stats`; the table was never populated. `db stats` now lists tables in registry order (`heartrate` fourth, `cardiovascular_age` last); key by `table`, not position.

### Added
- `oura-cli doctor` diagnoses token resolution (honoring `--token` like every
  other command), live token validity (skippable with `--offline`), local
  database health, and data freshness across sleep/readiness/activity in one
  pass. `ok` is true only when every check is clean — a warning is enough to
  clear "everything looks healthy". `nextStep` is the first non-ok check's
  fix, so it never recommends a command (like `sync`) that would just hit the
  same root cause (like an unreachable API) a check upstream already found.
  Both `table` and `json` output are supported; the JSON shape is published
  as `docs/schemas/doctor.json`.

### Fixed
- `fetch --day/--from/--to` and `db date` reject calendar-invalid dates such as `2026-02-30` with `BAD_ARGS` instead of sending them to the API or querying nothing. `db trends <days>` rejects anything but a positive integer instead of failing with `UNKNOWN` (`abc`) or silently returning nothing (`0`).
- An unknown `--format` is rejected for `fetch` too (it used to be silently accepted); `fetch` errors now render as text on a TTY and as JSON when piped.
- An unknown `--tz` / `OURA_TZ` is reported as `BAD_ARGS` with a hint instead of an `UNKNOWN` error from the date formatter.
- `fetch hr` and the heartrate step of `sync` now send `start_datetime`/`end_datetime` (UTC instants covering the requested local days in `OURA_TZ`), which is what the Oura heartrate endpoint takes; every other collection keeps `start_date`/`end_date`. Previously heartrate was queried with date parameters the endpoint does not define.
- The API client follows `next_token` and returns every page, so ranges longer than one page (heartrate over several days) are no longer silently truncated.
- Local-day boundaries are computed at local midnight instead of noon, so `fetch hr --day` on a DST transition day covers the whole 23- or 25-hour day rather than shifting by an hour (internal `localDateToUtcRange`, previously unused).
- Interactive `oura-cli login` now hides the Personal Access Token while it is
  typed and explains how to use `--token` safely in non-interactive contexts.
- `oura-cli report` now explains when no data is available and directs new
  users to run `oura-cli sync`, instead of showing an all-empty report table.
- Reports containing only sleep-detail data are no longer mistaken for empty
  reports and continue to show the available sleep metrics.
- `oura-cli db today` and `oura-cli db week` now explain when the local cache
  has no data for the requested range and point at `oura-cli sync`, instead of
  showing an all-dash table. JSON output is unchanged.
- `oura-cli sync` now says explicitly when it is a first sync backfilling the
  default 30 days, names the resolved date range for both first and
  incremental syncs, and prints a per-collection import count summary in
  table mode. JSON output gains an additive `import.isFirstSync` boolean.
- `OuraStressDay.day_summary`, `OuraWorkout.label` and `OuraSleepModel.type` are
  now typed `?: string | null`, matching the Oura OpenAPI spec (checked against
  1.37), which marks all three nullable and omits them from `required`. The
  declared types claimed a value is always present, so code reading them could
  assume one that never arrives. `importDaily` now maps an absent value to
  `NULL` explicitly instead of relying on `bun:sqlite` silently coercing
  `undefined`.
- `db week`, `db trends`, `db stats`, `report` and `sync` now compute "today"
  and every window boundary in the configured timezone (`--tz` / `OURA_TZ`);
  previously they used UTC and disagreed with `db today` around midnight.

## [0.4.5] - 2026-07-18

### Removed
- Dropped the unused `@typescript/native-preview` devDependency. The
  type-check now runs on the stable `typescript` compiler again: CI uses
  `bunx tsc --noEmit` in place of `bunx tsgo --noEmit`.

### Added
- CI now ships test runs to [flakiness.io](https://flakiness.io). `bun test`
  emits JUnit XML, the [official `flakiness` CLI](https://github.com/flakiness/flakiness-report)
  converts it to a Flakiness JSON Report (`--category bun`) and uploads to the
  `Laputa/oura-cli` project. Auth via GitHub OIDC — no
  `FLAKINESS_ACCESS_TOKEN` secret needed; the workflow grants `id-token: write`
  permission for the upload. Zero new runtime/dev deps; the CLI is installed
  ad-hoc via `curl https://cli.flakiness.io/install.sh | sh`.

## [0.4.4] - 2026-05-13

### Added
- README screencast (`assets/demo.webm`, ~270 KB) showing `--version`,
  `db today`, `db week`, the narrative `report`, and the agent-discoverable
  `describe` manifest. Generated reproducibly from `assets/demo.tape` via
  [VHS](https://github.com/charmbracelet/vhs); see CONTRIBUTING.md for the
  regeneration command. The `<video>` element renders inline on GitHub; the
  fallback link survives on npmjs.com where `<video>` is stripped.
- CONTRIBUTING.md "Regenerating the demo" subsection.

## [0.4.3] - 2026-05-13

### Changed
- Type-checker upgraded to TypeScript 7 via `@typescript/native-preview` (the
  Go-based `tsgo` binary). `typescript` devDep bumped to `^6.0.3` (current
  stable). CI now runs `bunx tsgo --noEmit` instead of `bunx tsc --noEmit`.
- `tsconfig.json` declares `types: ["bun", "node"]` explicitly so `tsgo`
  resolves ambient globals (`process`, `import.meta.dir`, `bun:test`).

## [0.4.2] - 2026-05-13

### Added
- `OpenClaw compatible` badge in the README and a matching `openclaw` keyword
  in `package.json`. Surfaces the existing `manifest`/`healthcheck` shapes that
  already integrate with the OpenClaw tool-registry.

## [0.4.1] - 2026-05-13

### Fixed
- Global flags (`--format`, `--token`, `--db`, `--tz`, `--no-color`) placed
  BEFORE the subcommand name are now hoisted to AFTER it before citty parses
  argv. Restores the v0.3.x flag-first form like
  `oura-cli --format json sleep today`. Regression introduced by the citty
  migration in v0.4.0.

## [0.4.0] - 2026-05-13

### Changed
- **Internal:** migrated CLI parsing from `commander` to `citty`. No CLI
  surface changes — same commands, flags, outputs, exit codes, and error
  envelope. Bundle size drops from ~153 KB to ~99 KB.
- Help text formatting differs slightly (citty's auto-generated help has
  a slightly different layout than commander's). All commands, flags, and
  positional args are described the same way.

### Removed
- `commander` dependency.
- `getGlobalOpts(command)` helper in `src/commands/helpers.ts` (no longer
  needed — citty passes args directly to each `run` function).

### Added
- `citty` dependency (already used by the sibling `kesha-voice-kit` project).
- `src/commands/common.ts` — shared `commonArgs` spec, `handleError`, and
  `applyNoColor` helpers spread into every leaf command.
- `src/commands/healthcheck.ts` and `src/commands/manifest.ts` — extracted
  from the inline definitions in `src/index.ts` for symmetry.

## [0.3.4] - 2026-05-13

### Fixed
- `oura-cli report` daily table: Sleep / Readiness / Activity / Steps
  columns now align under their headers. Previously, `chalk` ANSI codes
  inflated the byte count of coloured score strings, so `.padStart(...)`
  produced near-zero padding and adjacent scores ran together (e.g.
  `87 85 90` instead of separate right-aligned columns). The same bug
  affected the monthly bucket view.

## [0.3.3] - 2026-05-13

### Changed
- README refocused on the human reader: tagline, bullets, and "First five
  minutes" address terminal users first; automation/agents/MCP content moved
  to a single short section near the end.

### Build
- `release.yml` workflow re-enables `npm publish --provenance` now that the
  repository is public.

## [0.3.2] - 2026-05-13

### Changed
- All tests rewritten in a behavior-first style (Kent C. Dodds /
  Luca Rossi influence). No new behavioral coverage; the rewrite
  improves readability, drops internal-state peeks, and reorganises
  scenarios into nested describes. First release published via the
  tag-driven `release.yml` workflow.

## [0.3.1] - 2026-05-13

### Added
- `docs/ARCHITECTURE.md` documents the four-layer structure
  (`commands → api/db → lib`) and how to extend each layer. (#1, item 14)
- `.github/workflows/release.yml` — tag-triggered npm publish with provenance,
  GitHub Release creation with CHANGELOG-derived notes. Requires `NPM_TOKEN`
  repo secret. (#1, items 15 & 17)
- CI workflow gained a `tsc --noEmit` type-check step and an informational
  `npm audit --audit-level=high` step. (#1, item 16)
- CONTRIBUTING.md "Releasing" subsection documents the tag-driven flow.

### Removed
- Internal back-compat aliases `getWeeklyReport` / `formatWeeklyReport` /
  `WeeklyReportData` left over from v0.3.0. The package exports nothing
  internal, so these were dead code.

## [0.3.0] - 2026-05-13

### Changed (CLI surface)
- `oura-cli report weekly` is now `oura-cli report --period week` (default).
  `--period month` adds a 30-day report with weekly-bucket display.
  (#1, item 9). The old `weekly` subcommand is removed.
- `oura-cli db import` is now an alias of `oura-cli sync` — both run the same
  handler. (#1, item 8)
- Empty `200` response from the Oura API now throws `CliError('API_ERROR',
  'Empty response body from Oura API.')` instead of a raw JSON parse error.

### Added
- AJV-based test coverage for every `docs/schemas/*.json` file: validates
  JSON syntax, compiles against JSON Schema 2020-12, and asserts the
  describe-manifest shape against `describe.json`. (#1, item 10)
- Fixture-based tests for `OuraClient.fetch` error paths (401, 403, 429, 500,
  empty body, Bearer redaction). (#1, item 11)

### Renamed (internal API)
- `getWeeklyReport(db)` → `getReport(db, days)` in `src/db/report.ts`.
- `formatWeeklyReport(data, format)` → `formatReport(data, format, period)` in
  `src/format-report.ts`.
- Type `WeeklyReportData` → `ReportData`.

## [0.2.1] - 2026-05-13

### Added
- `CONTRIBUTING.md` — local setup, PR expectations, release flow (#1, item 13).
- `README.md` "Security" section — token storage, env exposure, telemetry
  statement (#1, items 19 & 20).

### Changed
- `describe.test.ts` — replaced per-element `.toContain` loops with sorted
  `.toEqual` for clearer diff on failure (#1, item 12).

## [0.2.0] - 2026-05-13

### Changed
- **BREAKING (typescript only):** `ErrorCode` is now a closed union of the
  documented codes (`BAD_ARGS`, `TOKEN_MISSING`, `TOKEN_INVALID`, `API_ERROR`,
  `DB_ERROR`, `UNKNOWN`). External code constructing `CliError` with a custom
  string code will fail to compile. Runtime behaviour for already-built code
  is unchanged. (#1, item 5)
- `exitCodeFor` is now an exhaustive `switch` over the closed union; future
  additions to `ErrorCode` require a corresponding branch.

### Added
- `describe` manifest now includes `compatManifestCommand: "oura-cli manifest"`
  so agents can discover the OpenClaw-compatible second manifest. (#1, item 6)
- README documents the two-manifest split under "Manifest formats".
- `getGlobalOpts(command)` helper in `src/commands/helpers.ts` walks the
  commander parent chain to the root program; api-command.ts and others now
  use it instead of `command.parent!.parent!.opts()`. (#1, item 7)

### Security
- API error messages now redact `Bearer <token>` and `"token":"<value>"`
  patterns and truncate bodies past 200 chars before printing. (#1, item 18)

## [0.1.3] - 2026-05-13

### Fixed
- `--token <pat>` global flag now uses the value as an inline token instead of
  trying to read it as a file path (#1, item 1).
- `--no-color` is now wired through to chalk and honors the `NO_COLOR` env
  variable; it was previously advertised in the `describe` manifest but never
  took effect (#1, item 2).
- `todayDate()` and `dateRange()` now use the configured/system timezone via
  `todayLocal(resolveDefaultTimezone())` instead of UTC-only `.toISOString()`,
  so users in non-UTC timezones get the correct "today" near midnight (#1,
  item 3).
- Single-day `start == end` API calls verified safe: `oura-cli sleep today`
  (which calls `client.fetch(endpoint, today, today)`) returns data correctly.
  No change needed to `api-command.ts` (#1, item 4).

### Note
- Several smells covered in the audit issue (#1) remain open for v0.2+:
  closed `ErrorCode` union, manifest documentation, commander chain helper,
  schema-validated test fixtures.

## [0.1.2] - 2026-05-13

### Fixed
- `oura-cli describe` now reports the real CLI surface. Data commands
  (sleep, readiness, activity, hr, spo2, stress, workout) advertise their
  `today | date <day> | week` subcommands instead of fictional `--start/--end`
  flags. `db` and `report` likewise list their real subcommands.

### Added
- `ManifestCommand.subcommands` field in the describe manifest, with a sibling
  `$def` in `docs/schemas/describe.json`.

## [0.1.1] - 2026-05-13

### Added
- `oura-cli healthcheck` — emits `{ok, version, latencyMs}` JSON for openclaw
  tool-registry compatibility.
- `oura-cli manifest` — emits openclaw-tool-registry-compatible package
  manifest (separate from `oura-cli describe` which targets generic agents).

### Fixed
- Restored compatibility with `tool-registry healthcheck` aggregator that
  expects `oura-cli healthcheck` to return parseable JSON.

## [0.1.0] - 2026-05-12

### Added
- Initial public release.
- Commands: `login`, `describe`, `sleep`, `readiness`, `activity`, `hr`,
  `spo2`, `stress`, `workout`, `sync`, `db`, `report`.
- TTY auto-detect for `--format` (table when interactive, JSON otherwise).
- Machine-readable error envelope with stable exit codes (0–4).
- JSON schemas for the `describe` manifest and all data-fetch outputs.
- Local SQLite cache at `~/.oura-cli/oura.db`.
- Auth via `oura-cli login`, `OURA_TOKEN`, `OURA_TOKEN_PATH`, or `~/.oura-token`.

[0.4.4]: https://github.com/drakulavich/oura-cli/releases/tag/v0.4.4
[0.4.3]: https://github.com/drakulavich/oura-cli/releases/tag/v0.4.3
[0.4.2]: https://github.com/drakulavich/oura-cli/releases/tag/v0.4.2
[0.4.1]: https://github.com/drakulavich/oura-cli/releases/tag/v0.4.1
[0.4.0]: https://github.com/drakulavich/oura-cli/releases/tag/v0.4.0
[0.3.4]: https://github.com/drakulavich/oura-cli/releases/tag/v0.3.4
[0.3.3]: https://github.com/drakulavich/oura-cli/releases/tag/v0.3.3
[0.3.2]: https://github.com/drakulavich/oura-cli/releases/tag/v0.3.2
[0.3.1]: https://github.com/drakulavich/oura-cli/releases/tag/v0.3.1
[0.3.0]: https://github.com/drakulavich/oura-cli/releases/tag/v0.3.0
[0.2.1]: https://github.com/drakulavich/oura-cli/releases/tag/v0.2.1
[0.2.0]: https://github.com/drakulavich/oura-cli/releases/tag/v0.2.0
[0.1.3]: https://github.com/drakulavich/oura-cli/releases/tag/v0.1.3
[0.1.2]: https://github.com/drakulavich/oura-cli/releases/tag/v0.1.2
[0.1.1]: https://github.com/drakulavich/oura-cli/releases/tag/v0.1.1
[0.1.0]: https://github.com/drakulavich/oura-cli/releases/tag/v0.1.0
