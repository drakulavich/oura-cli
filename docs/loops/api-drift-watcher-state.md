# api-drift-watcher — state

Memory for the weekly `api-drift-watcher` loop. Each run fetches the current
Oura OpenAPI spec, diffs it against the CLI's dependency surface recorded here,
and updates this file. See the loop task for classification rules.

## Latest run

- **Date:** 2026-07-17 (baseline / first run)
- **Spec version checked:** _UNVERIFIED this run_ — the live spec host
  `cloud.ouraring.com` is blocked by this session's egress policy (proxy
  returned `403` to `CONNECT cloud.ouraring.com:443`). The routine hint puts
  the current spec at ~`openapi-1.35.json` as of 2026-07, but that was not
  confirmed against the live spec.
- **Drift found:** none assessable (no spec to diff against).
- **Action:** baseline only. Recorded the CLI's Oura API dependency surface
  below so future runs can diff a fetched spec against it.

### Egress limitation (action for a human)

For this watcher to do its job, the runtime must be able to reach the Oura
docs/spec host. Add `cloud.ouraring.com` to the environment's outbound
network allowlist. Until then, each run can only re-verify the code-side
surface, not detect real API drift.

## CLI dependency surface (ground truth from code)

What the CLI actually reads. Field hash = first 12 hex of
`sha256(sorted, comma-joined field paths)` — recompute the same way each run
and compare. Source: `src/api/types.ts`, `src/db/import.ts`, `src/db/schema.ts`.

Base URL: `https://api.ouraring.com/v2/usercollection` (`src/api/client.ts`).
Request params per endpoint: `start_date` (required), `end_date` (optional).

| Endpoint (`usercollection/…`) | DB table | Field hash | Fields read |
| --- | --- | --- | --- |
| `daily_sleep` | `daily_sleep` | `63c05075bfc2` | id, day, score, contributors{deep_sleep, efficiency, latency, rem_sleep, restfulness, timing, total_sleep}, timestamp |
| `daily_readiness` | `daily_readiness` | `3098cdb3a1f6` | id, day, score, contributors (whole object, stored as JSON), temperature_deviation, temperature_trend_deviation, timestamp |
| `daily_activity` | `daily_activity` | `16f25eb2e74a` | id, day, score, active_calories, steps, equivalent_walking_distance, high_activity_time, medium_activity_time, low_activity_time, sedentary_time, total_calories, target_calories, contributors (JSON), timestamp |
| `heartrate` | `heartrate` | `0c1268d8f31d` | bpm, source, timestamp |
| `daily_spo2` | `daily_spo2` | `12e7024f8b9d` | id, day, spo2_percentage.average, breathing_disturbance_index |
| `daily_stress` | `daily_stress` | `14521a448529` | id, day, day_summary, recovery_high, stress_high |
| `daily_cardiovascular_age` | `cardiovascular_age` | `c8c26b57ed17` | id, day, vascular_age |
| `workout` | `workouts` | `c5b01cb3b7fe` | id, day, activity, calories, distance, start_datetime, end_datetime, intensity, label, source |
| `sleep` | `sleep_model` | `0d7676c321f5` | id, day, average_breath, average_heart_rate, average_hrv, awake_time, bedtime_end, bedtime_start, deep_sleep_duration, efficiency, latency, light_sleep_duration, lowest_heart_rate, period, rem_sleep_duration, restless_periods, time_in_bed, total_sleep_duration, type |

### Notes for future diffs

- `contributors` for `daily_readiness` and `daily_activity` is stored verbatim
  as a JSON blob (`Record<string, number | null>`), so *added* contributor keys
  there are absorbed silently — safe, note only. `daily_sleep` contributors are
  typed field-by-field, so a renamed/removed key there is a real break.
- Dormant surface (types/DB exist but NOT wired into sync): `OuraVo2Max`
  (`vo2max` table) and `OuraSleepModel` extras. `OuraEndpoint` in
  `src/api/types.ts` has no `daily_vo2_max`, and `src/db/import.ts` never
  fetches it. Treat vo2max drift as low priority until it's wired up.
- Endpoints in the spec that the CLI does NOT consume yet (tags, sessions,
  daily_resilience, rest_mode_period, ring_configuration, sleep_time, etc.)
  are product opportunities → file an issue, don't implement.

## History

| Date | Spec version | Outcome |
| --- | --- | --- |
| 2026-07-17 | unverified (egress blocked) | baseline established from code |
