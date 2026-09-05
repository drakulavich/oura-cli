# Global refactor: collection registry, command runner, contract cleanup

**Date:** 2026-09-05
**Status:** approved design, awaiting implementation plan
**Target release:** 0.5.0 (breaking; see §4)

## 1. Motivation

`oura-cli` is ~2,400 lines of source and ~2,700 lines of tests, with two
runtime dependencies (`citty`, `chalk`). The codebase is small but has
accumulated structural debt that makes routine changes expensive and
error-prone:

- **Per-command boilerplate.** Twelve `run()` bodies repeat the same wrapper:
  `applyNoColor` → `try` → `resolveFormat` → `openDatabase` → `ensureSchema`
  → work → `db.close()` → `catch handleError`. `db.close()` is not in a
  `finally`, so the handle leaks on error.
- **Inconsistent timezone.** `todayDate(args.tz)` honours `OURA_TZ`, but
  `db week`, `getTrends`, `getReport` and `importDaily` compute "today" via
  `new Date().toISOString().slice(0, 10)` (UTC). Near midnight these disagree.
- **Each column is declared in four places.** For every one of 9 collections
  the field list lives in `db/schema.ts` (DDL), `db/import.ts` (positional
  `INSERT … VALUES (?,?,?)`), `db/csv-import.ts` (positional again) and
  `api/types.ts`. A wrong `?` count is a runtime error, not a type error.
- **Manifests drift.** `commands/describe.ts` and `commands/manifest.ts`
  hand-duplicate the command tree from `index.ts` and the `SUBCOMMANDS` set
  in `lib/argv-normalize.ts`. `manifest` already advertises a `--start` flag
  that does not exist.
- **`applyNoColor` races.** It performs a fire-and-forget dynamic import of
  chalk, so the first output may still be coloured. `index.ts` already
  disables colour globally, making it redundant.
- **Personal path in a published package.** `db/csv-import.ts` hardcodes
  `~/Documents/OpenClaw/projects/oura-ring/data/App Data` and throws a bare
  `Error` instead of `CliError`.
- **Duplicated token resolution** between `OuraClient` and
  `commands/doctor.ts` (`resolveTokenLikeClient`).
- **Minor:** double DB wrapper (`lib/db.ts` + `db/database.ts`), version
  declared in two places, stale `docs/ARCHITECTURE.md`, a test
  (`index-flags.test.ts`) that asserts its own setup, a `vo2max` table that
  is created but never written.

The package has ~16 npm downloads/month; the only known consumers are the
author (terminal: `sync`, `db today`, `report`) and their agents (OpenClaw /
MCP via `--format json`, `describe`, `manifest`). The public contract can
therefore be reshaped without a migration period.

## 2. Goals and non-goals

**Goals**

1. Adding an Oura collection touches one new file plus one array entry.
2. Adding a command touches one file plus registration; `describe`,
   `manifest` and `SUBCOMMANDS` cannot drift from the real tree.
3. Every command body is a pure function of `(ctx, args) → Output`, testable
   without spawning a process.
4. One notion of "today", resolved once from the configured timezone.
5. No user-specific paths or dead tables in the shipped package.
6. Documentation (`ARCHITECTURE.md`, `CLAUDE.md`) matches the code.

**Non-goals**

- Changing the SQLite file format or rewriting shipped migrations.
- Replacing `citty` or `chalk`, or adding runtime dependencies.
- An MCP server (`oura-mcp` remains a roadmap item).
- Table/text output for `fetch`, `describe`, `manifest`, `healthcheck`
  (they stay JSON-only, as today).

## 3. Architecture

### 3.1 Layers

Dependencies point strictly downward. `render/` is a new explicit layer that
replaces the root-level `format.ts` / `format-report.ts` exception.

```
src/
  index.ts          wiring only; VERSION imported from package.json
  lib/              errors, time (today/tz), argv-normalize, format-resolve
  api/              client.ts, token.ts, types.ts
  collections/      registry: index.ts + one file per collection
  db/               open.ts, migrations.ts, sync.ts, queries.ts, report.ts
  render/           format.ts, format-report.ts, doctor-table.ts
  commands/         run-command.ts + fetch, sync, db, report, doctor,
                    healthcheck, login, describe, manifest
```

| Layer | May import | Knows about |
|---|---|---|
| `lib/` | nothing local | generic helpers |
| `api/` | `lib/` | HTTP, token, upstream row types |
| `collections/` | `lib/`, `api/` (types only) | mapping API rows → SQL columns |
| `db/` | `lib/`, `api/`, `collections/` | SQLite, migrations, queries |
| `render/` | `db/` types, `lib/` | text formatting; no I/O |
| `commands/` | everything below | citty definitions, all stdout writes |

File moves: `db/import.ts` → `db/sync.ts`; `lib/db.ts` + `db/database.ts`
→ `db/open.ts`; `db/schema.ts` → `db/migrations.ts`; `format*.ts` →
`render/`; doctor's table formatter → `render/doctor-table.ts`;
`commands/helpers.ts` dissolves into `api/token.ts` and `lib/time.ts`.

### 3.2 Collection registry

One descriptor per collection in `src/collections/<name>.ts`, exported from
`src/collections/index.ts` as a readonly `COLLECTIONS` array.

```ts
export interface Column<Row> {
  name: string;
  type: 'TEXT' | 'INTEGER' | 'REAL';
  pick: (row: Row) => string | number | null;
  pk?: boolean;
  unique?: boolean;
}

export interface Collection<Row = unknown> {
  /** CLI / manifest name: 'sleep', 'hr', 'sleep-periods', 'cv-age' */
  name: string;
  /** Oura API path segment: 'daily_sleep' */
  endpoint: OuraEndpoint;
  /** SQLite table: 'daily_sleep' */
  table: string;
  description: string;
  columns: readonly Column<Row>[];
  /** INSERT OR REPLACE vs INSERT OR IGNORE */
  conflict: 'replace' | 'ignore';
  /** heartrate is fetched for today only during sync */
  syncWindow: 'range' | 'today-only';
}
```

Collections (name → endpoint → table):

| name | endpoint | table | notes |
|---|---|---|---|
| `sleep` | `daily_sleep` | `daily_sleep` | |
| `readiness` | `daily_readiness` | `daily_readiness` | |
| `activity` | `daily_activity` | `daily_activity` | |
| `hr` | `heartrate` | `heartrate` | no `id`/`day` in API; `day` derived from timestamp; `conflict: 'ignore'`, unique `(timestamp, source)`; `syncWindow: 'today-only'` |
| `spo2` | `daily_spo2` | `daily_spo2` | `spo2_average` picks `spo2_percentage?.average` |
| `stress` | `daily_stress` | `daily_stress` | |
| `workout` | `workout` | `workouts` | `label ?? ''` preserved for compatibility |
| `sleep-periods` | `sleep` | `sleep_model` | 19 columns |
| `cv-age` | `daily_cardiovascular_age` | `cardiovascular_age` | |

Derived from the registry (pure functions in `collections/index.ts`):

- `ddl(c)` — `CREATE TABLE IF NOT EXISTS` plus indexes.
- `insertSql(c)` — named-column `INSERT OR {REPLACE|IGNORE} INTO t (a,b,c) VALUES (?,?,?)`.
- `rowValues(c, row)` — `c.columns.map(col => col.pick(row))`.
- `byName(name)` / `names()` — for the `fetch` enum and manifests.
- `jsonSchema(c)` — JSON Schema for `docs/schemas/<name>.json`.

`api/types.ts` stays hand-written: it is the upstream contract the
`api-drift-watcher` loop diffs against. Because `pick` is typed against it,
an upstream rename fails `tsc` instead of inserting `undefined`.

`vo2max` is not in the registry and is dropped from `db stats`. The frozen v1
migration still creates the table (migrations are append-only, see §5), so it
remains an empty orphan in every database; nothing reads or writes it.
`db/sync.ts` becomes a single loop over `COLLECTIONS`.

### 3.3 Command runner

`commands/run-command.ts` exports `dataCommand`, which wraps a citty
`defineCommand` and owns every cross-cutting concern:

```ts
export interface Ctx {
  format: OutputFormat;
  tz: string;
  today: string;         // YYYY-MM-DD in tz
  db?: Database;         // opened + ensureSchema'd when needs.db
  client?: OuraClient;   // created when needs.client
}

export interface Output {
  json: unknown;
  text: () => string;    // called only when format === 'table'
  exitCode?: number;     // default 0; doctor uses exitCodeForChecks
}

export function dataCommand<A extends ArgsDef>(def: {
  meta: CommandMeta;
  args: A;
  needs?: { db?: boolean; client?: boolean };
  jsonOnly?: boolean;
  run: (ctx: Ctx, args: ParsedArgs<A>) => Promise<Output> | Output;
}): CommandDef;
```

Runner sequence: set `chalk.level = 0` synchronously if `--no-color` /
`NO_COLOR` → `resolveFormat` → open DB (if needed) → create client (if
needed) → `await run` → print `JSON.stringify(json, null, 2)` or `text()` →
`finally { db?.close() }` → `catch { handleError(err, args) }`.

`db/queries.ts`, `db/report.ts` and `db/sync.ts` receive `today` (and a
`days` window where relevant) as parameters instead of computing UTC dates.
`lib/time.ts` gains `today(tz)` and `daysBack(today, n)`, which returns the
`n` calendar dates ending at and including `today` (so `daysBack(t, 7)` is
`t-6 … t`); `commands/helpers.ts` is removed.

Deliberate exceptions, unchanged: `login` is interactive text with its own
try/catch; `healthcheck` swallows errors into `{ ok: false, error }`;
`describe` and `manifest` are JSON-only and have nothing to catch;
`doctor` runs through `dataCommand` for format and DB lifecycle and returns
`exitCode: exitCodeForChecks(checks)` in its `Output`.

### 3.4 Token and DB helpers

- `api/token.ts`: `resolveToken(explicit?) → { token, source } | { token: null, source }`.
  Used by `OuraClient` (throws `TOKEN_MISSING` when null) and by `doctor`
  (reports the source). Replaces `resolveTokenLikeClient`.
- `db/open.ts`: merges `lib/db.ts` and `db/database.ts`. Exports
  `getDbPath(explicit?)`, `openDatabase(explicit?)` (creates the parent dir,
  applies WAL + foreign keys, runs `ensureSchema`), and `ensureSchema`.

## 4. CLI contract (0.5.0)

```
oura-cli login [--token T] [--path P]
oura-cli fetch <collection> [--day D | --from A --to B | --days N]
oura-cli sync
oura-cli db today | date <day> | week | trends [days] | stats
oura-cli report [--period week|month]
oura-cli doctor [--offline]
oura-cli healthcheck
oura-cli describe
oura-cli manifest
```

Global flags (`--format`, `--token`, `--db`, `--tz`, `--no-color`) and exit
codes (0/1/2/3/4) are unchanged.

**`fetch`** replaces the seven `sleep|readiness|activity|hr|spo2|stress|workout
× today|date|week` commands. `<collection>` is a positional validated against
`names()`; an unknown value is `BAD_ARGS` listing valid names. Range flags
are mutually exclusive; default is `--day <today>`. `--days N` means the
last N days ending today. Output is the raw API `data` array, JSON only.
`sleep-periods` and `cv-age` become reachable without `sync`.

**Removed:** `db import` (alias of `sync`), `db reset` and
`db/csv-import.ts`. Rebuilding from Oura CSV exports is out of scope for the
package; anyone needing it should keep a local script.

**`describe` and `manifest`** are built by `commands/describe.ts` from one
in-memory model: a walk of the citty command tree (`meta`, `args`,
subcommands) merged with the registry (collection enum, `outputSchema`
pointers). `manifest` (the OpenClaw registry shape) is a projection of the
same model. Hand-written command lists and their stale examples are deleted.

**`docs/schemas/`** is generated by `bun run schemas` from `jsonSchema(c)`
plus static schemas for `describe` and `doctor`. A test regenerates them
in-memory and fails if the checked-in files differ. Per-collection files are
keyed by collection `name` (`sleep.json`, `hr.json`, …, plus new
`sleep-periods.json`, `cv-age.json`). `fetch` in `describe` points to
`docs/schemas/<collection>.json`.

**Version:** `index.ts` does `import pkg from '../package.json'` (Bun
inlines JSON at build time). The `VERSION` constant is removed.

## 5. Database compatibility

Migrations v1 and v2 stay as frozen SQL text in `db/migrations.ts`; the
append-only rule holds. The registry does not replace them, it is checked
against them: a test builds one in-memory database via `MIGRATIONS` and
another via `COLLECTIONS.map(ddl)` and asserts `PRAGMA table_info` and
`PRAGMA index_list` match for every registry table. A future column is added
to the descriptor and to a new `ALTER TABLE … ADD COLUMN` migration; the
same test enforces both halves.

## 6. Error handling

Unchanged surface: every error reaching a user is a `CliError` with a
documented `ErrorCode`, formatted by `emitError` and mapped by
`exitCodeFor`. The runner is now the single place that calls `handleError`
for data-path commands, so a new command cannot forget it. `fetch` argument
validation (unknown collection, conflicting range flags, malformed date)
throws `BAD_ARGS`.

## 7. Testing

Existing tests survive with import-path changes. New coverage:

- **Registry invariants:** unique `name`/`endpoint`/`table`; exactly one
  `pk` or `unique` set per collection; `rowValues` length equals column
  count; `insertSql` placeholder count equals column count.
- **Schema equivalence** (§5) and **schema-file drift** (§4).
- **Snapshots** of `describe`, `manifest` and root `--help` via
  `bun test` snapshots, so any contract change is visible in the diff.
- **Runner:** DB closed on thrown error; error formatted per resolved
  format; `ctx.today` follows `--tz`; `jsonOnly` commands ignore
  `--format table`.
- **Timezone regression:** `db week`, `trends`, `report` and `sync` with
  `--tz` set to a zone on the other side of midnight from UTC.
- Replace `index-flags.test.ts` with a process-level test:
  `NO_COLOR=1 bun run src/index.ts db today --db :memory:` emits no ANSI.

## 8. Implementation sequence

Six PRs; each passes `bunx tsc --noEmit`, `bun test`, `bun run build`, and
carries a `CHANGELOG.md` bullet under `[Unreleased]`. The first three do not
touch the public contract and stand on their own.

1. **`render/` layer and single "today".** Move formatters; add
   `today(tz)` / `daysBack`; thread `today` into `db/` functions. The only
   behaviour change is the UTC fix.
2. **Command runner.** Introduce `dataCommand`; migrate every data-path
   command; delete `applyNoColor`; close DB in `finally`.
3. **Merge helpers.** `api/token.ts` shared by client and doctor;
   `db/open.ts` replaces the two wrappers; `commands/helpers.ts` removed.
4. **Collection registry.** Descriptors, `db/sync.ts` as a loop, schema
   equivalence test, `vo2max` dropped from `stats`. Remove `csv-import.ts`,
   `db reset`, `db import`.
5. **`fetch` and generated manifests.** Replace the seven API commands;
   `describe`/`manifest` from one model; `bun run schemas` + drift test;
   `SUBCOMMANDS` updated; README.
6. **Version and docs.** Version from `package.json`; rewrite
   `docs/ARCHITECTURE.md`; update `CLAUDE.md` (new layer table, new
   "add a collection" recipe, drop the two-places version rule); CHANGELOG
   `## [0.5.0]` with a Breaking section; tag.

## 9. Open items deferred

- `oura-mcp` companion (roadmap).
- Whether `hr` should also cache more than today during `sync`.
- Closing #21 (drift-watcher egress) is unrelated to this refactor.
