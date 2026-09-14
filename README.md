<h1 align="center">oura-cli</h1>

<p align="center">
  <a href="https://flakiness.io/Laputa/oura-cli"><img src="https://img.shields.io/endpoint?url=https%3A%2F%2Fflakiness.io%2Fapi%2Fbadge%3Finput%3D%257B%2522badgeToken%2522%253A%2522badge-2qTwJcrJSmhJmKfKklQkKG%2522%257D" alt="Tests"></a>
  <a href="https://www.npmjs.com/package/@drakulavich/oura-cli"><img src="https://img.shields.io/npm/v/@drakulavich/oura-cli" alt="npm version"></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT"></a>
  <a href="https://bun.sh"><img src="https://img.shields.io/badge/runtime-Bun-f9f1e1?logo=bun" alt="Bun"></a>
  <a href="https://github.com/openclaw/openclaw"><img src="https://img.shields.io/badge/OpenClaw-compatible-5b21b6" alt="OpenClaw compatible"></a>
</p>

<p align="center"><b>Own your Oura Ring data.</b> Pull your sleep, readiness, activity, heart rate, SpO₂, stress, and workouts from the Oura Cloud API straight to your terminal. No mobile app. No telemetry. Just SQLite and your data.</p>

<p align="center">
  <img src="https://github.com/drakulavich/oura-cli/raw/main/assets/demo.gif" alt="oura-cli demo: doctor, db today, db week, report, db rows, describe" width="720">
</p>

- **Offline-first.** Everything caches into `~/.oura-cli/oura.db` after one `oura-cli sync`. Reports keep working when your internet doesn't.
- **Real terminal reports.** `oura-cli report` writes a weekly or monthly digest with averages, trend deltas, and "you slept poorly Tuesday" callouts. No dashboards, no logging in.
- **Pipe-friendly.** Output auto-switches to stable JSON when stdout isn't a terminal. Analyse with `jq`, plot with `gnuplot`, or feed it into your own scripts.
- **No build step, MIT, no telemetry.** Runs straight from source on Bun; zero native dependencies.

## Install

```bash
curl -fsSL https://bun.sh/install | bash   # if you don't have Bun yet
bun add -g @drakulavich/oura-cli
```

You'll also need a [Personal Access Token from Oura](https://cloud.ouraring.com/personal-access-tokens). Run `oura-cli login` once — it hides the token as you type (nothing is echoed to the terminal) and saves it to `~/.oura-token` with `0600` perms.

## First five minutes

Five minutes from now you'll have your week of sleep, readiness and activity in a terminal digest like this:

```
  Oura Weekly Report
  2026-08-24 — 2026-08-30

  Last 7 Days:
  ────────────────────────────────────────────────────
  Day         Sleep  Ready  Active    Steps
  ────────────────────────────────────────────────────
  Mon 24/08      87     74      68    9,668
  Tue 25/08      82     79      74   11,204
  ...
```

Four commands get you there:

```bash
oura-cli login    # paste your PAT — input is hidden, nothing echoes to the terminal
oura-cli doctor   # confirm the token works and the local database is ready
oura-cli sync     # first sync fetches the last 30 days; later syncs resume from the last stored day
oura-cli report   # weekly digest in the terminal
```

After the first run, `sync` resumes each collection from its own last stored day. Oura revises recent days, so the overlap is deliberate, and the summary reports rows fetched (+new) per collection.

Heart rate also re-reads the two weeks behind its watermark, because Oura publishes workout samples days after the day they belong to. That re-read happens on the first sync of the day and whenever a sync brings samples newer than the cache, which means the ring has uploaded. A repeat sync on a quiet ring costs about 17 requests instead of 37.

A re-fetched window ends up holding exactly what the API returned for it. A sample Oura reclassified, or a record it re-issued under a new id, replaces the row it supersedes instead of joining it. One exception: when a response drops most of what one request covered, which is what a partial or short answer looks like, `sync` keeps those rows and names the collection and how many it kept. Once you have judged the correction genuine, `oura-cli sync --prune=hr` applies them for that collection, and `--prune=all` does it for every collection in the run.

`oura-cli sync --from 2026-08-01 [--to 2026-08-07]` re-fetches an explicit window for every collection instead, for example after an interrupted sync. A `429 Too Many Requests` is retried with the wait `Retry-After` asks for, up to a minute per wait and three minutes per command, before it becomes an error.

`oura-cli db today` / `oura-cli db week` read the local cache instantly, no API call.

### If something looks wrong

| What you see | What to run |
|---|---|
| `No Oura data is available for this report yet.` | `oura-cli sync` |
| `No Oura access token at /…/.oura-token` | `oura-cli login` |
| `Oura API 401` | `oura-cli login` with a fresh PAT |
| `Oura API 429` after the automatic retries | Wait a few minutes; a long `fetch hr` window is hundreds of requests. |
| `db today` empty right after a sync | Normal — Oura publishes a day's summary after that night's sleep syncs from the ring. |
| `doctor` still warns that data is stale after a sync | The ring has not uploaded: open the Oura app near the ring, then `oura-cli sync`. `doctor` (without `--offline`) says which side is behind. |
| `Database query failed: database disk image is malformed` | The cache file is damaged. Delete it (`--db` / `OURA_DB_PATH`) and run `oura-cli sync` to rebuild it; `oura-cli doctor` shows what is wrong with it first. |
| Anything else | `oura-cli doctor` |

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

When the cache has nothing for the day, `db date` says where the day sits (before the cache begins, after it ends, or in a gap inside it) and which `sync` call would fill it, instead of printing a row of dashes.

### Last week, at a glance

```bash
oura-cli db week                  # local cache summary, no API hit
oura-cli fetch sleep --days 7     # fresh sleep details direct from Oura
```

### Reports

```bash
oura-cli report                   # weekly (default)
oura-cli report --period month    # 30-day window with weekly buckets
```

Reports cover daily scores, averages, deltas vs the previous window, sleep details, and a short recommendation block. A day whose activity is still accumulating — normally just today — is shown with a `*` and kept out of the activity and steps averages and recommendations (sleep, readiness and SpO2 averages take every day shown, and each average line says how many days it covers); the JSON says so via `days[].partial` and `completeThrough`. `db today`, `db date` and `db week` carry the same `partial` flag and mark the day with the same `*` and note, so the screens cannot disagree. A day is treated as closed once Oura reports a full 24 hours of five-minute activity slots for it, so a ring that stops syncing no longer freezes its last day as unfinished.

### Trends and stats

```bash
oura-cli db trends 30             # score trends across the last 30 days
oura-cli db stats                 # row counts, date range, personal bests
```

### Cached rows of any collection

`db rows` prints what the cache holds for one collection, as stored, in either output mode. It takes the same range flags and defaults as `fetch` (`--day`, `--from/--to`, `--days`; today by default; none for `ring`), so the two are twins: `fetch` reads the API, `db rows` reads the cache. This is how the collections no summary shows — tags, sessions, resilience, VO₂ max, bedtime guidance, rest mode, ring, battery — are read back.

```bash
oura-cli db rows tags --days 30                     # your own annotations for the month
oura-cli db rows battery --day 2026-09-01           # the battery curve for one day
oura-cli db rows ring --format json                 # every ring on the account, as JSON
oura-cli db rows hr --day 2026-09-01 --limit 20     # a day of heart rate is hundreds of rows
```

### Health check

```bash
oura-cli doctor            # token, token accepted by Oura, database, integrity, data freshness
oura-cli doctor --offline  # the same without the live token check
```

`doctor` prints one row per check and a `Next:` line with the first fix to apply. The `integrity` row runs SQLite's `quick_check`. The `data` row warns once the newest cached day ended more than 36 hours ago; online, it also asks Oura whether it holds anything newer, so it can tell "run `oura-cli sync`" apart from "the ring has not uploaded".

### Raw API records

`fetch` returns one collection straight from the Oura API as JSON, without touching the local cache.

```bash
oura-cli fetch sleep                       # today
oura-cli fetch hr --days 7                 # last 7 days
oura-cli fetch workout --from 2026-05-01 --to 2026-05-31
oura-cli fetch sleep-periods --day 2026-06-01 | jq '.[] | {day, type, average_hrv}'
```

Collections: `sleep readiness activity hr spo2 stress workout sleep-periods cv-age resilience vo2max sleep-time session rest-mode tags ring battery`.

`ring` is a snapshot of your ring's hardware, not a day range, so it takes no `--day`/`--from`/`--days`. `battery` is a timeseries like `hr`: keyed by timestamp, fetched in pieces of at most 30 days.

### Piping to other tools

Output auto-switches to JSON the moment you pipe it:

```bash
oura-cli fetch sleep --days 7 | jq '.[] | {day, score, deep: .contributors.deep_sleep}'
oura-cli db trends 90 > trends.json
```

## Configuration

| Setting          | Flag        | Env var            | Default                     |
|------------------|-------------|--------------------|-----------------------------|
| Token            | `--token`   | `OURA_TOKEN`       | (file)                      |
| Token file path  | `--path` (`login` only) | `OURA_TOKEN_PATH` | `~/.oura-token`      |
| Database path    | `--db`      | `OURA_DB_PATH`     | `~/.oura-cli/oura.db`       |
| Timezone         | `--tz`      | `OURA_TZ`          | system timezone, else `UTC` |
| Output format    | `--format`  |                    | auto-detect (TTY → table)   |
| Colour           | `--no-color`| `NO_COLOR`         | on for a terminal, off when piped |

These are global: they may appear anywhere on the command line, before the command, between a command and its subcommand, or at the end. `oura-cli --format json db today`, `oura-cli db --format json today` and `oura-cli db today --format json` are the same command.

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
| Resilience | Oura V2 `daily_resilience`          | `daily_resilience`    |
| VO₂ max    | Oura V2 `vO2_max`                   | `vo2max`              |
| Sleep time | Oura V2 `sleep_time`                | `sleep_time`          |
| Sessions   | Oura V2 `session`                   | `sessions`            |
| Rest mode  | Oura V2 `rest_mode_period`          | `rest_mode_periods`   |
| Tags       | Oura V2 `enhanced_tag`              | `enhanced_tags`       |
| Ring       | Oura V2 `ring_configuration`        | `ring_configuration`  |
| Battery    | Oura V2 `ring_battery_level`        | `ring_battery_level`  |

Runtime: [Bun](https://bun.sh). Storage: built-in `bun:sqlite`. CLI parsing: [citty](https://github.com/unjs/citty). Output styling: [chalk](https://github.com/chalk/chalk). No build step: the CLI runs from `src/` on Bun, no native deps.

## Automation (LLM agents, scripts, MCP)

If you're driving the CLI from a script or LLM harness:

- `oura-cli describe` — JSON manifest of every command, argument, and output schema. Agents discover capabilities without scraping `--help`.
- `oura-cli healthcheck` — `{ok, version, latencyMs}` JSON for liveness probes, plus `error` when `ok` is false. It proves the database opens and answers a query; it does not inspect the contents. `oura-cli doctor` runs SQLite's `quick_check` for that.
- Gate on `.ok`, not on the exit code: `doctor` exits 0 with `ok: false` for any warning-level check (no data yet, stale data, Oura API unreachable), and `healthcheck` exits 0 with `ok: false` for an unusable database (the probe itself ran). `doctor --offline` skips the token-validation call, and a skipped check still counts towards `ok`.
- Errors emit a stable JSON envelope on stderr: `{"error":{"code":"…","message":"…","hint":"…"}}`.
- Documented exit codes: `0` success, `1` user error, `2` auth, `3` API, `4` storage.
- JSON Schemas under [`docs/schemas/`](docs/schemas/) cover `fetch <collection>`, `doctor` and the `describe` manifest itself, semver-stable; `describe` names the schema next to each command. Per-collection schemas pin each collection's identity fields (`id` and `day` for the daily summaries, `timestamp` for the heart-rate and battery series, `id` and `start_day` for rest-mode and tags, `id` alone for ring) and allow the rest of the Oura record through unchanged, so new upstream fields never break validation. The local-data commands (`sync`, `db *`, `report`) have no schema files yet; their shapes are versioned through the CHANGELOG.
- Two contract quirks, kept for compatibility: `report --period month` returns its window as `weekStart`/`weekEnd`, and `heartrate.day` (likewise `ring_battery_level.day`) in the cache is the date written in Oura's timestamp (UTC in practice) while every `--day`/`--tz` argument is local.

Plays cleanly with [OpenClaw](https://github.com/openclaw/openclaw) — `oura-cli manifest` returns the tool-registry shape. A first-party `oura-mcp` companion is on the roadmap.

## Requirements

- [Bun](https://bun.sh) >= 1.0
- macOS, Linux, or Windows (WSL)
- An [Oura Personal Access Token](https://cloud.ouraring.com/personal-access-tokens)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Bug reports and pull requests welcome at [drakulavich/oura-cli/issues](https://github.com/drakulavich/oura-cli/issues).

## License

Made with 💍🤖 under MIT License.
