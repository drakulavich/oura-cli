# Glossary

Canonical terms for the oura-cli spec corpus. Specs use these terms verbatim; if
you need a new term, add it here first.

| Term | Definition |
|---|---|
| **oura-cli** | This project: a Bun-native CLI for Oura Ring data, published as `@drakulavich/oura-cli`. |
| **Oura Cloud API** | The upstream Oura v2 HTTP API (`cloud.ouraring.com`) that `sync` reads from (`src/api/client.ts`). |
| **PAT (Personal Access Token)** | The Oura credential. `login` stores it at `~/.oura-token` with `0600` permissions; it never appears in output (`src/commands/login.ts`). |
| **Local cache** | The SQLite database at `~/.oura-cli/oura.db` that holds synced data for offline reads (`src/db/database.ts`, schema in `src/db/schema.ts`). |
| **Data type** | One category of Oura metric: **sleep**, **readiness**, **activity**, **heart-rate**, **SpO2**, **stress**, or **workouts**. |
| **login** | The command that prompts for and persists the PAT (`src/commands/login.ts`). |
| **sync** | The command that backfills new days of each Data type from the Oura Cloud API into the Local cache; incremental on re-run (`src/commands/sync.ts`). |
| **db** | The command group that reads the Local cache offline (e.g. `db today`, `db week`, `db trends`); its `db import` subcommand is an alias of `sync` that **does** fetch from the Oura Cloud API (`src/commands/db.ts`, `src/db/queries.ts`). |
| **report** | The command that renders a weekly or monthly digest — averages, trend deltas, and callouts — from the Local cache (`src/commands/report.ts`, `src/db/report.ts`). |
| **Output mode** | How a command formats results: **table/text** on a TTY, **JSON** when stdout is not a TTY, overridable with `--format <json\|table>` (`src/commands/common.ts`, resolved in `src/lib/format-resolve.ts`, rendered in `src/format.ts`). |
| **CliError** | The error type for failures that reach the CLI surface; carries a documented `ErrorCode` (`src/lib/errors.ts`). |
| **ErrorCode** | The stable identifier on a `CliError` that maps to an exit code and a documented failure mode (`src/lib/errors.ts`). |
| **manifest** | The agent-facing command that emits a machine-readable description of the CLI's commands and flags (`src/commands/manifest.ts`). |
| **healthcheck** | The agent-facing command that runs a quick local SQLite probe (open DB, `SELECT 1`) and returns `{ok, version, latencyMs}` as JSON; it does **not** check the token or Oura API reachability (`src/commands/healthcheck.ts`). |
| **describe** | The agent-facing command that documents a command's contract for an LLM caller (`src/commands/describe.ts`). |
| **api-command** | The command that issues a direct, lightly-typed call to an Oura Cloud API endpoint (`src/commands/api-command.ts`). |
| **OpenClaw compatibility** | oura-cli plays cleanly with OpenClaw: `oura-cli manifest` returns the tool-registry shape an OpenClaw / Claude agent consumes (`src/commands/manifest.ts`; README "OpenClaw"). |
| **CSV import** | Loading externally exported data into the Local cache (`src/db/csv-import.ts`). |
