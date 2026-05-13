# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[0.1.1]: https://github.com/drakulavich/oura-cli/releases/tag/v0.1.1
[0.1.0]: https://github.com/drakulavich/oura-cli/releases/tag/v0.1.0
