# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
