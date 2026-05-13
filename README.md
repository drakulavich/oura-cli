<h1 align="center">oura-cli</h1>

<p align="center">
  <a href="https://github.com/drakulavich/oura-cli/actions/workflows/ci.yml"><img src="https://github.com/drakulavich/oura-cli/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://www.npmjs.com/package/@drakulavich/oura-cli"><img src="https://img.shields.io/npm/v/@drakulavich/oura-cli" alt="npm version"></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT"></a>
  <a href="https://bun.sh"><img src="https://img.shields.io/badge/runtime-Bun-f9f1e1?logo=bun" alt="Bun"></a>
  <a href="https://github.com/openclaw/openclaw"><img src="https://img.shields.io/badge/OpenClaw-compatible-5b21b6" alt="OpenClaw compatible"></a>
</p>

<p align="center"><b>Own your Oura Ring data.</b> Pull your sleep, readiness, activity, heart rate, SpO₂, stress, and workouts from the Oura Cloud API straight to your terminal. No mobile app. No telemetry. Just SQLite and your data.</p>

<p align="center">
  <img src="https://github.com/drakulavich/oura-cli/raw/main/assets/demo.svg" alt="oura-cli demo: --version, db today, db week, report, describe" width="720">
</p>

- **Offline-first.** Everything caches into `~/.oura-cli/oura.db` after one `oura-cli sync`. Reports keep working when your internet doesn't.
- **Real terminal reports.** `oura-cli report` writes a weekly or monthly digest with averages, trend deltas, and "you slept poorly Tuesday" callouts. No dashboards, no logging in.
- **Pipe-friendly.** Output auto-switches to stable JSON when stdout isn't a terminal. Analyse with `jq`, plot with `gnuplot`, or feed it into your own scripts.
- **Single 142 kB binary, MIT, no telemetry.** Built on Bun; zero native dependencies.

## Install

```bash
curl -fsSL https://bun.sh/install | bash   # if you don't have Bun yet
bun add -g @drakulavich/oura-cli
```

You'll also need a [Personal Access Token from Oura](https://cloud.ouraring.com/personal-access-tokens). Paste it into `oura-cli login` once — it lands at `~/.oura-token` with `0600` perms.

## First five minutes

```bash
oura-cli login          # paste your PAT, one time
oura-cli sync           # backfill recent days into ~/.oura-cli/oura.db
oura-cli report         # weekly digest in the terminal
```

That's it. Subsequent `oura-cli sync` pulls only new days.

## Daily use

### Today

```bash
oura-cli db today
```

Today's scores from the local cache. If you forgot to sync, run `oura-cli sync` first.

### A specific day

```bash
oura-cli db date 2026-05-10
```

### Last week, at a glance

```bash
oura-cli db week                  # local cache summary, no API hit
oura-cli sleep week               # fresh sleep details direct from Oura
```

### Reports

```bash
oura-cli report                   # weekly (default)
oura-cli report --period month    # 30-day window with weekly buckets
```

Reports cover daily scores, averages, deltas vs the previous window, sleep details, and a short recommendation block.

### Trends and stats

```bash
oura-cli db trends 30             # score trends across the last 30 days
oura-cli db stats                 # row counts, date range, personal bests
```

### Per-endpoint detail

When you want raw Oura V2 data, every endpoint shares the same shape — `today | date <day> | week`:

```bash
oura-cli sleep today
oura-cli readiness date 2026-05-10
oura-cli activity week
oura-cli hr week
oura-cli spo2 week
oura-cli stress week
oura-cli workout week
```

### Piping to other tools

Output auto-switches to JSON the moment you pipe it:

```bash
oura-cli sleep week | jq '.[] | {day, score, hrv: .contributors.hrv_balance}'
oura-cli db trends 90 > trends.json
```

## Configuration

| Setting          | Flag        | Env var            | Default                     |
|------------------|-------------|--------------------|-----------------------------|
| Token            | `--token`   | `OURA_TOKEN`       | (file)                      |
| Token file path  |             | `OURA_TOKEN_PATH`  | `~/.oura-token`             |
| Database path    | `--db`      | `OURA_DB_PATH`     | `~/.oura-cli/oura.db`       |
| Timezone         | `--tz`      | `OURA_TZ`          | system timezone, else `UTC` |
| Output format    | `--format`  |                    | auto-detect (TTY → table)   |

## Security

This tool reads your personal health data — handle the token with care.

- `~/.oura-token` is written with `0600` permissions on POSIX (`oura-cli login` does it for you). On Windows the file is written but ACL hardening is left to you.
- `OURA_TOKEN` as an env var is convenient for scripts and CI, but it shows up in `ps auxe`, heap dumps, and core dumps. Prefer the file for interactive use.
- `--token <pat>` is the least safe option: the value lands in shell history. Avoid it outside throw-away scripts.
- Revoke a token at [cloud.ouraring.com/personal-access-tokens](https://cloud.ouraring.com/personal-access-tokens), not via this CLI.
- API error messages truncate response bodies to 200 chars and redact `Bearer` tokens and `"token":"…"` patterns before printing.

**oura-cli performs no telemetry.** The only outbound network traffic is your authenticated Oura Cloud API calls.

## What's inside

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

Runtime: [Bun](https://bun.sh). Storage: built-in `bun:sqlite`. CLI parsing: [Commander](https://github.com/tj/commander.js). Output styling: [chalk](https://github.com/chalk/chalk). One 142 kB `dist/index.js`, no native deps.

## Automation (LLM agents, scripts, MCP)

If you're driving the CLI from a script or LLM harness:

- `oura-cli describe` — JSON manifest of every command, argument, and output schema. Agents discover capabilities without scraping `--help`.
- `oura-cli healthcheck` — `{ok, version, latencyMs}` JSON for liveness probes.
- Errors emit a stable JSON envelope on stderr: `{"error":{"code":"…","message":"…","hint":"…"}}`.
- Documented exit codes: `0` success, `1` user error, `2` auth, `3` API, `4` storage.
- JSON Schemas under [`docs/schemas/`](docs/schemas/) describe every output shape, semver-stable.

Plays cleanly with [OpenClaw](https://github.com/openclaw/openclaw) — `oura-cli manifest` returns the tool-registry shape. A first-party `oura-mcp` companion is on the roadmap.

## Requirements

- [Bun](https://bun.sh) >= 1.0
- macOS, Linux, or Windows (WSL)
- An [Oura Personal Access Token](https://cloud.ouraring.com/personal-access-tokens)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Bug reports and pull requests welcome at [drakulavich/oura-cli/issues](https://github.com/drakulavich/oura-cli/issues).

## License

Made with 💍🤖 under MIT License.
