# oura-cli

[![npm](https://img.shields.io/npm/v/@drakulavich/oura-cli.svg)](https://www.npmjs.com/package/@drakulavich/oura-cli)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A command-line tool for **Oura Ring** users to query and analyze their own health data locally. Designed for two audiences: people in a terminal, and AI agents driving the CLI programmatically.

- Fetches sleep, readiness, activity, heart rate, SpO₂, stress, and workouts from the Oura Cloud API.
- Caches everything in a local SQLite database (`~/.oura-cli/oura.db`) so you can query and report offline.
- Outputs human-friendly tables when run interactively; emits stable JSON when piped or invoked by a parent process.
- Self-describes via `oura-cli describe` so agents can discover commands, arguments, and output schemas.

## Install

```bash
npm install -g @drakulavich/oura-cli
```

Requires [Bun](https://bun.sh/) at runtime (the binary uses `#!/usr/bin/env bun`).

## For humans

```bash
oura-cli login           # paste your Personal Access Token (one-time)
oura-cli sync            # pull the last 90 days into ~/.oura-cli/oura.db
oura-cli report --week   # render a weekly summary in the terminal
```

Get a Personal Access Token at <https://cloud.ouraring.com/personal-access-tokens>.

By default, output formatting auto-detects: pretty tables in your terminal, JSON when piped.

## For agents

```bash
export OURA_TOKEN="…"             # no file or interactive flow needed
oura-cli describe                  # JSON manifest of commands, args, output schemas
oura-cli sleep --start 2026-05-01  # JSON (since stdout is non-TTY for child processes)
```

- **Stable JSON I/O contract.** Output shapes are versioned with the package; breaking changes are major semver bumps. Schemas live in `docs/schemas/`.
- **Machine-readable errors.** When `--format json` (or auto-detected), all errors emit a single `{"error": {"code": "...", "message": "...", "hint": "..."}}` line on stderr.
- **Documented exit codes.**

  | Code | Meaning                                        |
  |------|------------------------------------------------|
  | 0    | success                                        |
  | 1    | user error (bad arguments)                     |
  | 2    | auth error (missing or invalid token)          |
  | 3    | API or network error                           |
  | 4    | database or local storage error                |

## Configuration

| Setting          | Flag        | Env var            | Default                     |
|------------------|-------------|--------------------|-----------------------------|
| Token            | `--token`   | `OURA_TOKEN`       | (file)                      |
| Token file path  |             | `OURA_TOKEN_PATH`  | `~/.oura-token`             |
| Database path    | `--db`      | `OURA_DB_PATH`     | `~/.oura-cli/oura.db`       |
| Timezone         | `--tz`      | `OURA_TZ`          | system timezone, else `UTC` |
| Output format    | `--format`  |                    | auto-detect (TTY → table)   |

## Commands

Run `oura-cli --help` for the live list, or `oura-cli describe` for a machine-readable manifest.

- `login` — interactively save a Personal Access Token to `~/.oura-token`
- `describe` — emit JSON manifest (for agents)
- `sleep | readiness | activity | hr | spo2 | stress | workout [--start YYYY-MM-DD] [--end YYYY-MM-DD]` — fetch from Oura API
- `sync` — sync all collections into the local SQLite cache
- `db <subcommand>` — query the local cache
- `report --week | --month` — render a summary

## Development

```bash
git clone https://github.com/drakulavich/oura-cli
cd oura-cli
bun install
bun test
bun run dev describe   # run from source
```

## License

MIT © Anton Yakutovich
