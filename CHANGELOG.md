# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[0.1.3]: https://github.com/drakulavich/oura-cli/releases/tag/v0.1.3
[0.1.2]: https://github.com/drakulavich/oura-cli/releases/tag/v0.1.2
[0.1.1]: https://github.com/drakulavich/oura-cli/releases/tag/v0.1.1
[0.1.0]: https://github.com/drakulavich/oura-cli/releases/tag/v0.1.0
