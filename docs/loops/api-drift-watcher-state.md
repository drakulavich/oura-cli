# api-drift-watcher — state

Memory for the weekly `api-drift-watcher` loop. Each run fetches the current
Oura OpenAPI spec, diffs it against the CLI's dependency surface recorded here,
and updates this file. See the loop task for classification rules.

## Latest run

- **Date:** 2026-07-25 (first run with a real spec to diff against)
- **Spec version checked:** `openapi-1.37.json`, fetched live and confirmed —
  `1.38`+ return 404, so 1.37 is current. The 2026-07-17 baseline guessed 1.35;
  1.35 and 1.36 are both still served.
- **Drift found on the consumed surface: none.** Every field in the table below
  is present in 1.37, with no removals, renames, or type changes.
- **Upstream 1.35 → 1.37 diff:** 0 paths added or removed, 0 schemas added or
  removed, 1 schema changed — `ValidationError` gained `ctx` and `input`
  (Pydantic v2 error shape). Response payloads are untouched.
- **Action:** three code-vs-spec mismatches filed (below); hash recipe repaired.

### Egress limitation — RESOLVED

`cloud.ouraring.com` is reachable again; the `403` on `CONNECT` recorded on
2026-07-17 is gone. No allowlist action is outstanding. Keep this section until
one full run has passed without a regression, then delete it.

### Findings this run

Nothing drifted, but diffing code against a real spec for the first time
surfaced three fields the CLI declared non-null that the spec marks nullable
(none of them in a `required` list):

| Field | Spec (1.37) | Declared |
| --- | --- | --- |
| `daily_stress.day_summary` | `anyOf[PublicDailyStressSummary, null]` | `string` |
| `workout.label` | `anyOf[string, null]` | `string` |
| `sleep.type` | `anyOf[PublicSleepType, null]` | `string` |

Not a break: every backing column is nullable `TEXT` and `importDaily` already
wrote `w.label ?? ''`. Fixed in #23.

Two of the three are enums upstream (`restored|normal|stressful`,
`deleted|sleep|long_sleep|late_nap|rest`) but typed as open `string`. Narrowing
them is unclaimed work, not drift.

## CLI dependency surface (ground truth from code)

What the CLI actually reads. Source: `src/api/types.ts`, `src/db/import.ts`,
`src/db/schema.ts`.

Base URL: `https://api.ouraring.com/v2/usercollection` (`src/api/client.ts`).
Request params per endpoint: `start_date` (required), `end_date` (optional).

**Field hash** = first 12 hex of the SHA-256 of the *Fields read* cell exactly
as printed — already sorted and comma-joined, no spaces, dot notation for
nested paths. Verify any row straight from this file:

```console
$ printf '%s' 'bpm,source,timestamp' | shasum -a 256 | cut -c1-12
f612441464e4
```

> The hashes recorded on 2026-07-17 (`63c05075bfc2`, `c5b01cb3b7fe`, …) could
> not be reproduced by that recipe under any spelling tried, including this
> file's own field lists — so the column could never have signalled drift. The
> field *lists* were correct and still match the code exactly; only the hashes
> were wrong. Recomputed below, and the recipe is now pinned to a copy-pasteable
> command so the next run can actually check it.

| Endpoint (`usercollection/…`) | DB table | Field hash | Fields read |
| --- | --- | --- | --- |
| `daily_sleep` | `daily_sleep` | `363ffbe2d7b3` | `contributors.deep_sleep,contributors.efficiency,contributors.latency,contributors.rem_sleep,contributors.restfulness,contributors.timing,contributors.total_sleep,day,id,score,timestamp` |
| `daily_readiness` | `daily_readiness` | `9b348e18018d` | `contributors,day,id,score,temperature_deviation,temperature_trend_deviation,timestamp` |
| `daily_activity` | `daily_activity` | `8b0e8299254a` | `active_calories,contributors,day,equivalent_walking_distance,high_activity_time,id,low_activity_time,medium_activity_time,score,sedentary_time,steps,target_calories,timestamp,total_calories` |
| `heartrate` | `heartrate` | `f612441464e4` | `bpm,source,timestamp` |
| `daily_spo2` | `daily_spo2` | `5689f2f33eaa` | `breathing_disturbance_index,day,id,spo2_percentage.average` |
| `daily_stress` | `daily_stress` | `f75ca483159a` | `day,day_summary,id,recovery_high,stress_high` |
| `daily_cardiovascular_age` | `cardiovascular_age` | `0cc951caeb9b` | `day,id,vascular_age` |
| `workout` | `workouts` | `c56ed82262a6` | `activity,calories,day,distance,end_datetime,id,intensity,label,source,start_datetime` |
| `sleep` | `sleep_model` | `a0857dcd6e7b` | `average_breath,average_heart_rate,average_hrv,awake_time,bedtime_end,bedtime_start,day,deep_sleep_duration,efficiency,id,latency,light_sleep_duration,lowest_heart_rate,period,rem_sleep_duration,restless_periods,time_in_bed,total_sleep_duration,type` |

`contributors` for `daily_readiness` and `daily_activity` is hashed as one
field: it is stored as an opaque JSON blob, so its inner keys are not part of
the CLI's typed surface.

### Notes for future diffs

- `contributors` for `daily_readiness` and `daily_activity` is stored verbatim
  as a JSON blob (`Record<string, number | null>`), so *added* contributor keys
  there are absorbed silently — safe, note only. `daily_sleep` contributors are
  typed field-by-field, so a renamed/removed key there is a real break.
- Dormant surface (types/DB exist but NOT wired into sync): `OuraVo2Max`
  (`vo2max` table) and `OuraSleepModel` extras. `OuraEndpoint` in
  `src/api/types.ts` has no `daily_vo2_max`, and `src/db/import.ts` never
  fetches it. Treat vo2max drift as low priority until it's wired up. The spec
  serves this endpoint as `vO2_max` (capital O), not `daily_vo2_max`, so wiring
  it up needs the exact casing.
- Endpoints in the spec that the CLI does NOT consume yet (tags, sessions,
  daily_resilience, rest_mode_period, ring_configuration, sleep_time, etc.)
  are product opportunities → file an issue, don't implement.
- Fields present in 1.37 but not read, if a future feature wants them:
  `daily_activity` (12) `average_met_minutes`, `class_5_min`,
  `high_activity_met_minutes`, `inactivity_alerts`, `low_activity_met_minutes`,
  `medium_activity_met_minutes`, `met`, `meters_to_target`, `non_wear_time`,
  `resting_time`, `sedentary_met_minutes`, `target_meters`; `sleep` (13)
  `app_sleep_phase_5_min`, `heart_rate`, `hrv`, `low_battery_alert`,
  `movement_30_sec`, `readiness`, `readiness_score_delta`, `ring_id`,
  `sleep_algorithm_version`, `sleep_analysis_reason`, `sleep_phase_30_sec`,
  `sleep_phase_5_min`, `sleep_score_delta`; plus `heartrate.timestamp_unix` and
  `daily_cardiovascular_age.pulse_wave_velocity`.
- The spec is served per-version at
  `https://cloud.ouraring.com/v2/static/json/openapi-<major>.<minor>.json`.
  Probe upward from the last known version to find the current one; a 404 means
  you have passed it.

## History

| Date | Spec version | Outcome |
| --- | --- | --- |
| 2026-07-17 | unverified (egress blocked) | baseline established from code |
| 2026-07-25 | 1.37 (verified live) | no drift; 3 nullability mismatches → #23; field hashes recomputed after the baseline recipe proved unreproducible |
