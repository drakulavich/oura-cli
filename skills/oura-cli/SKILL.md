---
name: oura-cli
description: Read the user's Oura Ring sleep, readiness and activity. Also steps, HRV, resting heart rate, SpO2, stress, workouts, temperature, VO2 max and ring battery, through the oura-cli command. Use when the user asks how they slept, how ready or recovered they are, what their scores, trends or weekly report look like, or wants raw Oura records for a day or range. Data is cached in a local SQLite file; nothing leaves the machine except calls to the Oura API.
license: MIT
compatibility: Requires Bun and the oura-cli binary on PATH (bun add -g @drakulavich/oura-cli). Network access only for `sync` and `fetch`; every other command reads the local cache.
# The Agent Skills spec types `metadata` as string → string. The two harnesses this file targets
# read nested objects under their own key instead (OpenClaw JSON5-parses the whole block and
# ignores `openclaw` unless it is an object; Hermes documents `hermes.tags` as a list), so the
# vendor keys below are objects by design. Every other key stays a string; skills/oura-cli.test.ts
# holds the contract.
metadata:
  openclaw:
    emoji: "💍"
    homepage: https://github.com/drakulavich/oura-cli
    requires:
      bins:
        - oura-cli
    install:
      - id: bun
        kind: node
        package: "@drakulavich/oura-cli"
        bins:
          - oura-cli
        label: Install oura-cli (bun add -g)
  hermes:
    tags:
      - oura
      - health
      - sleep
      - readiness
      - wearable
    category: health
---

# oura-cli

`oura-cli` downloads the user's Oura Ring data into `~/.oura-cli/oura.db` and prints it. After one `oura-cli sync`, every report and summary is answered from that file without a network call.

## Rules

1. **Always pass `--format json`.** Output format is otherwise guessed from whether stdout is a terminal, and an agent's shell is often neither reliably one nor the other.
2. **Cache first.** Answer from `db today`, `db date`, `db week`, `db trends`, `db rows` or `report`. Run `sync` when `doctor` says the data is stale or the user asks for the latest. Use `fetch` only when the cache cannot answer (the user wants the exact API record, or a range older than the cache).
3. **Never ask for or print the token.** `oura-cli login` is interactive and hides the input. If there is no token, tell the user to run `oura-cli login` themselves, or to export `OURA_TOKEN` in the environment the agent runs in. Do not echo `~/.oura-token`, `OURA_TOKEN`, or the `--token` flag into a transcript.
4. **This is personal health data.** Keep it on the machine. Do not paste rows into a third-party service or file outside the user's request without saying so first.
5. **Gate on `.ok`, not the exit code.** `doctor` and `healthcheck` exit 0 with `"ok": false` whenever the probe itself ran.

## Preflight

```bash
oura-cli doctor --offline --format json
```

Returns `{ok, checks[], nextStep}`. Each check is `{id, status: "ok"|"warn"|"fail"|"skip", detail}`; `nextStep` is the first fix to apply, or `null`. What each `id` means when it is not `ok`:

| `id` | Meaning | What to do |
|---|---|---|
| `token` | no token found | user runs `oura-cli login`, or sets `OURA_TOKEN` |
| `token-valid` | Oura rejected the token (only without `--offline`) | user needs a fresh PAT from cloud.ouraring.com |
| `database` | cache missing or cannot open | `oura-cli sync` creates it; a corrupt file must be deleted first |
| `integrity` | SQLite `quick_check` failed | delete the file, then `oura-cli sync` |
| `data` | newest cached day ended more than 36 h ago | `oura-cli sync`; if still stale, the ring has not uploaded (user opens the Oura app near the ring) |

Drop `--offline` when you also want to know whether Oura has newer data than the cache; it costs one API call.

## Which command answers which question

| The user asks about | Run | Shape |
|---|---|---|
| today / how did I sleep last night | `oura-cli db today --format json` | one object, see below |
| a specific day | `oura-cli db date 2026-09-01 --format json` | same object; every field `null` when the day is not cached |
| the last 7 days | `oura-cli db week --format json` | array of 7 day objects |
| a weekly or monthly digest, deltas, recommendations | `oura-cli report --format json` or `oura-cli report --period month --format json` | `{period, weekStart, weekEnd, days[], completeThrough, averages[], spo2, patterns, sleepDetails, recommendations[]}` |
| a trend over N days | `oura-cli db trends 30 --format json` | array of `{label, avg, min, max, count}` |
| how much data there is, personal bests | `oura-cli db stats --format json` | `{tables[], dateRange, trends[], records}` |
| detail no summary shows (workouts, tags, sessions, HRV samples, battery, ring hardware) | `oura-cli db rows <collection> [range] --format json` | array of Oura records as cached |
| the exact record straight from Oura | `oura-cli fetch <collection> [range]` | array of Oura records; always JSON |
| refresh the cache | `oura-cli sync --format json` | `{import: {startDate, endDate, fetched, added}, today}` |

A day object from `db today`, `db date` and `db week`:

```json
{
  "day": "2026-09-01", "partial": false,
  "sleep_score": 84, "readiness_score": 79, "activity_score": 71, "steps": 9412,
  "stress": "normal", "spo2": 97.4, "temp_deviation": -0.1,
  "sleep_hours": 7.3, "deep_hours": 1.6, "rem_hours": 1.5,
  "avg_hrv": 52, "lowest_hr": 48, "efficiency": 91
}
```

Every field except `day` and `partial` can be `null`. Today is often all `null` until the morning, because Oura publishes a day's summary only after that night's sleep syncs from the ring. A past day that is all `null` is not cached: run `oura-cli db date <day>` without `--format json` once and it says whether the day is before the cache begins, after it ends, or in a gap, and which `sync` call would fill it. Pass that hint on rather than guessing.

### Collections

`sleep readiness activity hr spo2 stress workout sleep-periods cv-age resilience vo2max sleep-time session rest-mode tags ring battery`

Range flags for `db rows` and `fetch`: `--day YYYY-MM-DD` (default: today), `--from YYYY-MM-DD --to YYYY-MM-DD` (both required), or `--days N`. `ring` is a hardware snapshot and takes no range. `hr` and `battery` are timeseries keyed by timestamp: a single day of `hr` is hundreds of rows, so add `--limit N` on `db rows` or narrow the day before reading it into context.

```bash
oura-cli db rows workout --days 7 --format json          # last week's workouts
oura-cli db rows tags --from 2026-08-01 --to 2026-08-31 --format json
oura-cli db rows hr --day 2026-09-01 --limit 50 --format json
oura-cli db rows ring --format json                        # ring model, size, firmware
oura-cli fetch sleep-periods --day 2026-09-01               # bedtime, HRV, per-period detail
```

## Reading the numbers

- Scores are 0–100. Oura's own bands: 85+ optimal, 70–84 good, under 70 pay attention. `report` flags days with sleep or readiness under 70 and activity at 90 or above.
- `partial: true` marks a day whose activity is still accumulating (normally today). Do not compare its activity score or steps with closed days; `report` already leaves such days out of the activity averages and out of the recommendations, and says so in `completeThrough`.
- `temp_deviation` is degrees Celsius against the user's baseline; a sustained rise with a readiness drop is what Oura itself reads as a possible illness signal. Report it, do not diagnose.
- `stress` is Oura's day summary (`restored`, `normal`, `stressful`) or `null`.
- `--tz Europe/Helsinki` (or `OURA_TZ`) sets the timezone `--day` and `today` are interpreted in; default is the system timezone. One quirk: `day` on cached `hr` and `battery` rows is the date in Oura's UTC timestamp, not the local day.

## Errors and exit codes

Errors are a single JSON object on **stderr**:

```json
{"error":{"code":"BAD_ARGS","message":"<day> must be a real YYYY-MM-DD date, got \"tomorrow\".","hint":"..."}}
```

| Exit | Meaning | Typical code | Usually means |
|---|---|---|---|
| 0 | success (check `.ok` on `doctor` / `healthcheck`) | | |
| 1 | user error | `BAD_ARGS` | fix the arguments |
| 2 | auth | `TOKEN_MISSING`, `TOKEN_INVALID` | user runs `oura-cli login` |
| 3 | API or network | `API_ERROR` | a `429` was already retried for up to three minutes; wait before retrying a long `fetch hr` |
| 4 | local storage | `DB_ERROR` | see `doctor` |

## Discovering the rest

- `oura-cli describe` prints a JSON manifest of every command, argument, enum value, exit code and the JSON Schema file for each output. Read it instead of scraping `--help`.
- `oura-cli healthcheck` is a liveness probe: `{ok, version, latencyMs}`.
- Global flags `--format`, `--db`, `--tz`, `--token`, `--no-color` may appear anywhere on the line.
- JSON Schemas for `fetch <collection>`, `doctor` and `describe` ship in the package under `docs/schemas/`.
