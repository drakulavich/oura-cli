<h1 align="center">oura-cli</h1>

<p align="center">
  <a href="https://github.com/drakulavich/oura-cli/actions/workflows/ci.yml"><img src="https://github.com/drakulavich/oura-cli/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://www.npmjs.com/package/@drakulavich/oura-cli"><img src="https://img.shields.io/npm/v/@drakulavich/oura-cli" alt="npm version"></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT"></a>
  <a href="https://bun.sh"><img src="https://img.shields.io/badge/runtime-Bun-f9f1e1?logo=bun" alt="Bun"></a>
</p>

<p align="center"><b>Own your Oura Ring data.</b> Local CLI that pulls your biometrics from the Oura Cloud API, caches them in SQLite, and serves both your terminal and your AI agent from the same binary.</p>

- **Two audiences, one binary** — pretty tables when you're at a terminal, stable JSON when stdout is piped to a parent process
- **Self-describing** — `oura-cli describe` emits a JSON manifest of every command, argument, and output schema. Agents discover capabilities without scraping `--help`
- **Local-first** — everything lives in `~/.oura-cli/oura.db` after `oura-cli sync`. Query and report offline, no Oura mobile app required
- **Documented contract** — JSON Schemas under `docs/schemas/`, semver-versioned, plus machine-readable errors and exit codes (0–4) for clean error handling in scripts and agents

## Quick Start

Runtime: **[Bun](https://bun.sh)** >= 1.0.

```bash
curl -fsSL https://bun.sh/install | bash   # skip if Bun is already installed

bun add -g @drakulavich/oura-cli
oura-cli login          # paste your Personal Access Token (one-time)
oura-cli sync           # backfill recent days into ~/.oura-cli/oura.db
oura-cli report weekly  # weekly summary with trends and recommendations
```

Get a Personal Access Token at <https://cloud.ouraring.com/personal-access-tokens>.

## For humans

Output format auto-detects: tables in your terminal, JSON when piped.

```bash
oura-cli sync                       # pull the latest from Oura Cloud
oura-cli db today                   # today's summary
oura-cli db date 2026-05-10         # any specific day
oura-cli db week                    # last 7 days
oura-cli db trends 30               # score trends across last 30 days
oura-cli db stats                   # row counts, date range, personal bests
oura-cli report weekly              # narrative weekly summary
```

Pipe a result to your favourite JSON tool — `--format` is auto-detected, no flag needed:

```bash
oura-cli sleep week | jq '.[] | {day, score, hrv: .contributors.hrv_balance}'
```

Per-endpoint fetches mirror Oura's V2 API one-to-one and share the same subcommand shape:

```bash
oura-cli sleep today                # daily_sleep, today
oura-cli readiness date 2026-05-10  # daily_readiness, specific day
oura-cli activity week              # daily_activity, last 7 days
oura-cli hr week                    # heartrate samples
oura-cli spo2 week                  # daily_spo2
oura-cli stress week                # daily_stress
oura-cli workout week               # workouts
```

## For agents

Designed for child-process invocation by LLM harnesses (Claude Code, Codex, generic MCP wrappers).

```bash
export OURA_TOKEN="…"          # no file or interactive flow needed
oura-cli describe              # JSON manifest of commands, args, schemas
oura-cli sleep today           # JSON (stdout is non-TTY for child processes)
oura-cli healthcheck           # JSON: {ok, version, latencyMs}
```

**Stable JSON I/O contract.** Output shapes are versioned with the package; breaking changes are major semver bumps. Schemas live in `docs/schemas/`.

**Machine-readable errors.** When format resolves to `json`, every error emits a single line to stderr:

```json
{"error":{"code":"TOKEN_MISSING","message":"…","hint":"Run `oura-cli login` or set OURA_TOKEN."}}
```

**Exit codes:**

| Code | Meaning |
|------|---------|
| 0    | success |
| 1    | user error (bad arguments) |
| 2    | auth error (missing or invalid token) |
| 3    | API or network error |
| 4    | database or local storage error |

## Manifest formats

Two manifest commands, two audiences:

- **`oura-cli describe`** — neutral, agent-friendly. Lists every command, its
  args, output schema refs, and exit-code semantics. Use this when integrating
  with generic LLM harnesses, MCP wrappers, or your own custom scripts.
- **`oura-cli manifest`** — [OpenClaw](https://github.com/openclaw/openclaw)
  `tool-registry` shape. Strictly smaller, optimised for OpenClaw's skill
  discovery and health-aggregation flow. Use this only if you're plugging
  oura-cli into an OpenClaw gateway.

Both return JSON. `describe` references `manifest` via the
`compatManifestCommand` field so an agent can discover the second format
without prior knowledge.

## What's Inside

| Endpoint   | Source                              | Cached table          |
|------------|-------------------------------------|-----------------------|
| Sleep      | Oura V2 `daily_sleep`               | `daily_sleep`         |
| Readiness  | Oura V2 `daily_readiness`           | `daily_readiness`     |
| Activity   | Oura V2 `daily_activity`            | `daily_activity`      |
| Heart rate | Oura V2 `heartrate`                 | `heartrate`           |
| SpO₂       | Oura V2 `daily_spo2`                | `daily_spo2`          |
| Stress     | Oura V2 `daily_stress`              | `daily_stress`        |
| Workouts   | Oura V2 `workout`                   | `workouts`            |
| Sleep model      | Oura V2 `sleep`               | `sleep_model`         |
| Cardiovascular age | Oura V2 `cardiovascular_age` | `cardiovascular_age`  |

Runtime: [Bun](https://bun.sh). Storage: built-in `bun:sqlite`. CLI parsing: [Commander](https://github.com/tj/commander.js). Output styling: [chalk](https://github.com/chalk/chalk). Zero native dependencies, single 142 kB `dist/index.js`.

## Configuration

| Setting          | Flag        | Env var            | Default                     |
|------------------|-------------|--------------------|-----------------------------|
| Token            | `--token`   | `OURA_TOKEN`       | (file)                      |
| Token file path  |             | `OURA_TOKEN_PATH`  | `~/.oura-token`             |
| Database path    | `--db`      | `OURA_DB_PATH`     | `~/.oura-cli/oura.db`       |
| Timezone         | `--tz`      | `OURA_TZ`          | system timezone, else `UTC` |
| Output format    | `--format`  |                    | auto-detect (TTY → table)   |

## Security

This tool reads your personal health data — handle the access token with care.

- `~/.oura-token` is written with `0600` permissions on POSIX (`chmod 0600` in `oura-cli login`). On Windows the file is written but ACL hardening is left to you.
- `OURA_TOKEN` as an environment variable is convenient for CI and containers, but it appears in `ps auxe`, heap dumps, and core dumps. Prefer the file-based path for interactive use.
- `--token <pat>` is the least safe option: the value lands in your shell history. Avoid it outside of throw-away scripts.
- Token revocation is done at <https://cloud.ouraring.com/personal-access-tokens>, not via this CLI.
- API responses are truncated to 200 chars and `Bearer`/`"token":"…"` patterns are redacted before being printed in error messages.

oura-cli performs **no telemetry**. The only outbound network traffic is your authenticated Oura Cloud API calls.

## Integrations

- **OpenClaw** — drop into your LLM agent as an [OpenClaw skill](https://github.com/openclaw/openclaw). `oura-cli manifest` and `oura-cli healthcheck` report back in the tool-registry shape, so the agent can discover the binary and audit its DB health automatically.
- **MCP** — `oura-cli describe` returns enough metadata to autogenerate an MCP server wrapper. A first-party `oura-mcp` companion is on the roadmap.

## Requirements

- [Bun](https://bun.sh) >= 1.0
- macOS, Linux, or Windows (WSL)
- An [Oura Personal Access Token](https://cloud.ouraring.com/personal-access-tokens)

## Contributing

Bug reports and pull requests welcome at [drakulavich/oura-cli/issues](https://github.com/drakulavich/oura-cli/issues).

## License

Made with 💍🤖 under MIT License.
