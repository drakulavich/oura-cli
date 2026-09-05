# Global Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace per-command boilerplate, hand-duplicated column lists and hand-written manifests with a command runner, a collection registry and generated manifests, shipping as six sequential PRs and one 0.5.0 release.

**Architecture:** Layers stay one-directional and gain an explicit `render/` layer: `lib → api → collections → db → render → commands → index`. A `dataCommand` runner owns colour, format, DB lifecycle, client creation and error handling, so command bodies become `(ctx, args) → Output`. A `COLLECTIONS` registry (one descriptor per Oura collection) derives DDL, named-column inserts, the sync loop, the `fetch` enum, `describe`/`manifest` entries and `docs/schemas/*.json`.

**Tech Stack:** Bun (`bun:sqlite`, `bun test`, `bun build`), TypeScript 7 strict, `citty` 0.2, `chalk` 6. No new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-09-05-global-refactor-design.md`

## Global Constraints

- Runtime dependencies stay exactly `citty` and `chalk`. `bun.lock` is committed with any `package.json` change.
- Every PR passes `bunx tsc --noEmit`, `bun test`, `bun run build`, and adds a bullet under `## [Unreleased]` in `CHANGELOG.md`. Six PRs in order; each new branch starts from `main` after the previous PR merged.
- Layers import only downward: `lib/` → `api/` → `collections/` → `db/` → `render/` → `commands/` → `index.ts`. `lib/` imports nothing local; `render/` performs no I/O; every stdout write lives in `commands/`.
- Migrations are append-only. `MIGRATIONS[0]` and `MIGRATIONS[1]` SQL text is never edited.
- Errors that reach the user are `CliError` with an existing `ErrorCode`; exit codes 0/1/2/3/4 and their meanings are unchanged.
- Global flags `--format --token --db --tz --no-color` are unchanged. `fetch`, `describe`, `manifest`, `healthcheck` are JSON-only; `login` is interactive text.
- Local imports use the `.js` suffix. Named exports only. Tests are co-located `*.test.ts`.
- Never hand-edit `dist/`. Never re-tag; the release tag `v0.5.0` is pushed exactly once, and only after the user confirms.
- Commit messages end with:
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_016WjL92YiWyJrKDheoX8R54
  ```
  PR bodies end with `🤖 Generated with [Claude Code](https://claude.com/claude-code)` followed by the session URL above.

**Refinements over the spec** (decided while planning, do not re-litigate): the `Collection` descriptor gains `indexes` (heartrate's three named indexes must reproduce the v1 schema exactly) and `identity` (the API fields that drive each JSON Schema's `required` list). The version is read from `package.json` at runtime with `readFileSync(new URL('../package.json', import.meta.url))` instead of a JSON import, because `tsconfig.rootDir` is `src` and a JSON import outside it fails `tsc`.

## File Map

| Path | Fate | Responsibility |
|---|---|---|
| `src/lib/time.ts` | modify | add `today(tz?)`, `shiftDay`, `daysBack` |
| `src/render/format.ts` | move from `src/format.ts` | day/week/trends/stats text |
| `src/render/format-report.ts` | move from `src/format-report.ts` | report text |
| `src/render/doctor-table.ts` | create (from `commands/doctor.ts`) | doctor text |
| `src/commands/run-command.ts` | create | `Ctx`, `Output`, `execute`, `dataCommand` |
| `src/commands/common.ts` | modify | keep `commonArgs`; drop `handleError`, `applyNoColor` |
| `src/commands/helpers.ts` | delete (PR3) | replaced by `api/token.ts`, `lib/time.ts` |
| `src/api/token.ts` | create | `resolveToken(explicit?)` |
| `src/db/open.ts` | create (merge `lib/db.ts` + `db/database.ts`) | open, path, `ensureSchema` |
| `src/db/migrations.ts` | move from `db/schema.ts` | frozen `MIGRATIONS` |
| `src/collections/types.ts` | create | `Column`, `Collection`, `defineCollection` |
| `src/collections/index.ts` | create | `COLLECTIONS`, `ddl`, `insertSql`, `rowValues`, `names`, `byName`, `jsonSchema` |
| `src/collections/<name>.ts` ×9 | create | one descriptor each |
| `src/db/sync.ts` | move from `db/import.ts` | `importDaily` as a registry loop |
| `src/db/csv-import.ts` | delete (PR4) | personal path, out of scope |
| `src/commands/fetch.ts` | create (PR5) | `fetch <collection>` + `resolveRange` |
| `src/commands/api-command.ts` | delete (PR5) | replaced by `fetch` |
| `src/commands/describe.ts` | rewrite (PR5) | `buildManifest(version, commands)` from the citty tree |
| `src/commands/manifest.ts` | rewrite (PR5) | `buildOpenclawManifest` projection |
| `scripts/generate-schemas.ts` | create (PR5) | writes `docs/schemas/<collection>.json` |
| `src/index.ts` | modify | registration, version from `package.json` |
| `docs/ARCHITECTURE.md`, `CLAUDE.md`, `README.md`, `CHANGELOG.md` | modify | documentation |

---

# PR 1 — `render/` layer and a single "today"

Branch: `refactor/render-and-today`. Behaviour change: only the UTC→timezone fix.

### Task 1.1: Date helpers in `lib/time.ts`

**Files:**
- Modify: `src/lib/time.ts`
- Test: `src/lib/time.test.ts`

**Interfaces:**
- Produces: `today(timezone?: string): string`, `shiftDay(day: string, delta: number): string`, `daysBack(endDay: string, n: number): string[]` (ascending, `n` items, last item is `endDay`).

- [ ] **Step 1: Write the failing tests** (append to `src/lib/time.test.ts`)

```ts
import { shiftDay, daysBack, today } from './time.js';

describe('shiftDay', () => {
  it('moves a YYYY-MM-DD date by whole days across a month boundary', () => {
    expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28');
    expect(shiftDay('2026-02-28', 2)).toBe('2026-03-02');
  });
});

describe('daysBack', () => {
  it('returns n ascending dates ending at and including endDay', () => {
    expect(daysBack('2026-06-15', 3)).toEqual(['2026-06-13', '2026-06-14', '2026-06-15']);
  });
  it('returns an empty list for n = 0', () => {
    expect(daysBack('2026-06-15', 0)).toEqual([]);
  });
});

describe('today', () => {
  it('uses OURA_TZ when no timezone is passed', () => {
    const prev = process.env.OURA_TZ;
    process.env.OURA_TZ = 'Pacific/Kiritimati'; // UTC+14: at 20:00Z it is already tomorrow there
    setSystemTime(new Date('2026-06-15T20:00:00Z'));
    try {
      expect(today()).toBe('2026-06-16');
    } finally {
      setSystemTime();
      if (prev === undefined) delete process.env.OURA_TZ; else process.env.OURA_TZ = prev;
    }
  });
});
```

Add `setSystemTime` to the existing `bun:test` import at the top of the file.

- [ ] **Step 2: Run to verify failure**

Run: `bun test src/lib/time.test.ts`
Expected: FAIL, `shiftDay`/`daysBack`/`today` are not exported.

- [ ] **Step 3: Implement** (append to `src/lib/time.ts`)

```ts
/** YYYY-MM-DD for "now" in `timezone` (default: OURA_TZ or the system zone). */
export function today(timezone?: string): string {
  return todayLocal(timezone ?? resolveDefaultTimezone());
}

/** Shift a YYYY-MM-DD date by `delta` whole days. */
export function shiftDay(day: string, delta: number): string {
  const ms = new Date(`${day}T00:00:00Z`).getTime() + delta * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

/** The `n` calendar dates ending at and including `endDay`, ascending. */
export function daysBack(endDay: string, n: number): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(shiftDay(endDay, -i));
  return out;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `bun test src/lib/time.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/time.ts src/lib/time.test.ts
git commit -m "feat(time): add today, shiftDay and daysBack helpers"
```

### Task 1.2: Thread `today` into `db/` functions

**Files:**
- Modify: `src/db/queries.ts` (`getTrends`, `getStats`), `src/db/report.ts` (`getReport`), `src/db/import.ts` (`importDaily`)
- Modify callers: `src/commands/db.ts`, `src/commands/sync.ts`, `src/commands/report.ts`, `src/commands/helpers.ts`
- Test: `src/db/queries.test.ts`, `src/db/report.test.ts`, `src/commands/report.test.ts`, `src/db/import.test.ts`, `src/commands/sync.test.ts`

**Interfaces:**
- Produces: `getTrends(db, days, today)`, `getStats(db, today)`, `getReport(db, days, today)`, `importDaily(db, client, today, log?)`. Every `today` is `YYYY-MM-DD`.

- [ ] **Step 1: Write a failing regression test** in `src/db/report.test.ts`

```ts
it('anchors the window on the today it is given, not on the UTC clock', () => {
  const db = new Database(':memory:');
  ensureSchema(db);
  db.query('INSERT INTO daily_sleep VALUES (?,?,?,?,?)').run('a', '2026-06-15', 80, '{}', 't');
  const r = getReport(db, 7, '2026-06-15');
  expect(r.weekEnd).toBe('2026-06-15');
  expect(r.weekStart).toBe('2026-06-09');
  expect(r.days.at(-1)?.sleep).toBe(80);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test src/db/report.test.ts`
Expected: FAIL (TypeScript: expected 2 arguments; or `weekEnd` equals the real date).

- [ ] **Step 3: Change the signatures**

`src/db/report.ts`, replace the first lines of `getReport`:

```ts
import { shiftDay } from '../lib/time.js';

export function getReport(db: Database, days: number, today: string): ReportData {
  const period: 'week' | 'month' = days <= 7 ? 'week' : 'month';
  const weekEnd = today;
  const weekStart = shiftDay(today, -(days - 1));
  const prevWeekEnd = shiftDay(today, -days);
  const prevWeekStart = shiftDay(today, -(days * 2 - 1));

  const dailyRows: ReportData['days'] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = shiftDay(today, -i);
    // ...rest of the loop body unchanged
```

Delete the old `const today = new Date();` line and every `toISOString().slice(0, 10)` in this file.

`src/db/queries.ts`:

```ts
import { shiftDay } from '../lib/time.js';

export function getTrends(db: Database, days: number, today: string): TrendRow[] {
  const start = shiftDay(today, -days);
  // ...unchanged, using `start` and `today`

export function getStats(db: Database, today: string): DbStats {
  // ...unchanged except:
  const trends = getTrends(db, 99999, today);
```

`src/db/import.ts`:

```ts
import { shiftDay } from '../lib/time.js';

export async function importDaily(
  db: Database, client: OuraClient, today: string, log?: (msg: string) => void,
): Promise<ImportResult> {
  const _log = log ?? (() => {});
  // delete: const today = new Date().toISOString().slice(0, 10);
  // ...
  const startDate = isFirstSync ? shiftDay(today, -BACKFILL_DAYS) : lastDates.sort()[0];
```

Callers:

- `src/commands/sync.ts`: `const day = todayDate(opts.tz); const importResult = await importDaily(db, client, day, log); const today = getDaySummary(db, day);`
- `src/commands/report.ts`: `getReport(db, days, todayDate(args.tz))` (import `todayDate` from `./helpers.js`).
- `src/commands/db.ts` `trends`: `getTrends(db, n, todayDate(args.tz))`; `stats`: `getStats(db, todayDate(args.tz))`; `week`: replace the `for` loop with
  ```ts
  import { daysBack } from '../lib/time.js';
  const days = daysBack(todayDate(args.tz), 7).map(d => getDaySummary(db, d));
  ```
- `src/commands/helpers.ts` `dateRange`: add `shiftDay` to the `../lib/time.js` import; body becomes
  ```ts
  const end = todayLocal(timezone ?? resolveDefaultTimezone());
  return { start: shiftDay(end, -(days - 1)), end };
  ```

- [ ] **Step 4: Fix the existing tests to pass the new argument**

In `src/db/queries.test.ts`, `src/db/report.test.ts`, `src/commands/report.test.ts` pass a literal today such as `'2026-06-15'` wherever `getTrends`, `getStats`, `getReport` are called. In `src/db/import.test.ts` and `src/commands/sync.test.ts` pass the existing `TODAY` constant to `importDaily` (sync tests go through `runSync`, which now derives it from `tz: 'UTC'` and the frozen clock, so they need no change unless they call `importDaily` directly).

Run: `bunx tsc --noEmit && bun test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/db src/commands
git commit -m "fix(time): derive every day boundary from the configured timezone"
```

### Task 1.3: Move formatters into `src/render/`

**Files:**
- Move: `src/format.ts` → `src/render/format.ts`; `src/format.test.ts` → `src/render/format.test.ts`; `src/format-report.ts` → `src/render/format-report.ts`; `src/format-report.test.ts` → `src/render/format-report.test.ts`
- Create: `src/render/doctor-table.ts`
- Modify: `src/commands/doctor.ts`, `src/commands/db.ts`, `src/commands/sync.ts`, `src/commands/report.ts`, `src/commands/sync.test.ts`, `src/commands/doctor.test.ts`, `CLAUDE.md`

**Interfaces:**
- Produces: `render/doctor-table.ts` exports `formatDoctorTable(result: DoctorResult): string` and imports `DoctorResult`, `CheckStatus` as types from `../commands/doctor.js`. That is a type-only import going upward and the single tolerated exception; PR2 removes it by moving the types.

- [ ] **Step 1: Move files**

```bash
mkdir -p src/render
git mv src/format.ts src/render/format.ts
git mv src/format.test.ts src/render/format.test.ts
git mv src/format-report.ts src/render/format-report.ts
git mv src/format-report.test.ts src/render/format-report.test.ts
```

Fix relative imports inside the moved files: `./db/queries.js` → `../db/queries.js`, `./db/import.js` → `../db/import.js`, `./db/report.js` → `../db/report.js`, `./lib/format-resolve.js` → `../lib/format-resolve.js`. Test files: `./format.js` stays `./format.js`.

Fix callers: in `src/commands/db.ts` and `src/commands/sync.ts` change `'../format.js'` → `'../render/format.js'`; in `src/commands/report.ts` change `'../format-report.js'` → `'../render/format-report.js'`; in `src/commands/sync.test.ts` change `'../format.js'` → `'../render/format.js'`.

- [ ] **Step 2: Extract the doctor table**

Create `src/render/doctor-table.ts` with `statusSymbol` and `formatDoctorTable` cut verbatim from `src/commands/doctor.ts`:

```ts
import chalk from 'chalk';
import type { CheckStatus, DoctorResult } from '../commands/doctor.js';

function statusSymbol(status: CheckStatus): string {
  if (status === 'ok') return chalk.green('✓');
  if (status === 'warn') return chalk.yellow('!');
  return chalk.red('✗');
}

export function formatDoctorTable(result: DoctorResult): string {
  const lines = ['', chalk.bold('  Doctor'), chalk.gray('─'.repeat(50))];
  for (const c of result.checks) {
    lines.push(`  ${statusSymbol(c.status)} ${c.id.padEnd(12)} ${c.detail}`);
  }
  lines.push('');
  const next = result.nextStep ?? (result.ok ? 'nothing — everything looks healthy.' : 'see the failing checks above.');
  lines.push(`  Next: ${next}`);
  return lines.join('\n');
}
```

In `src/commands/doctor.ts` delete both functions and add `import { formatDoctorTable } from '../render/doctor-table.js';`. Drop the now-unused `chalk` import. In `src/commands/doctor.test.ts` import `formatDoctorTable` from `'../render/doctor-table.js'`.

- [ ] **Step 3: Verify**

Run: `bunx tsc --noEmit && bun test && bun run build`
Expected: all PASS.

- [ ] **Step 4: Update CLAUDE.md** — in the "LAYERS DEPEND ONLY DOWNWARD" section replace the sentence beginning "Table formatters are the exception" with:

```
Text formatters live in `src/render/` (between `db/` and `commands/`): they import `db` types and write nothing to stdout.
```

- [ ] **Step 5: CHANGELOG and commit**

Under `## [Unreleased]` add:

```
### Fixed
- `db week`, `db trends`, `db stats`, `report` and `sync` now compute "today" and every window boundary in the configured timezone (`--tz` / `OURA_TZ`); previously they used UTC and disagreed with `db today` around midnight.

### Changed
- Text formatters moved from the repo root into `src/render/` (internal).
```

```bash
git add -A
git commit -m "refactor: move formatters into src/render"
git push -u origin refactor/render-and-today
gh pr create --title "refactor: render layer and single today" --body "$(cat <<'EOF'
PR 1 of 6 from docs/superpowers/specs/2026-09-05-global-refactor-design.md.

- Adds today/shiftDay/daysBack to lib/time and threads today into db/ functions (fixes UTC day boundaries).
- Moves formatters into src/render/.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_016WjL92YiWyJrKDheoX8R54
EOF
)"
```

Stop here and ask the user to review and merge before starting PR 2.

---

# PR 2 — Command runner

Branch: `refactor/command-runner`.

### Task 2.1: `dataCommand` runner

**Files:**
- Create: `src/commands/run-command.ts`
- Test: `src/commands/run-command.test.ts`

**Interfaces:**
- Consumes: `openDatabase`, `ensureSchema` from `../db/database.js`; `OuraClient` from `../api/client.js`; `formatError`, `exitCodeFor` from `../lib/errors.js`; `resolveFormat` from `../lib/format-resolve.js`; `today`, `resolveDefaultTimezone` from `../lib/time.js`; `commonArgs` from `./common.js`.
- Produces:
  ```ts
  export interface Ctx { format: OutputFormat; tz: string; today: string; db?: Database; client?: OuraClient }
  export interface Output { json: unknown; text: () => string; exitCode?: number }
  export interface RunnerIo { stdout(s: string): void; stderr(s: string): void; exit(code: number): void; isTty: boolean }
  export interface DataCommandDef<A extends ArgsDef> {
    meta: CommandMeta; args?: A; needs?: { db?: boolean; client?: boolean }; jsonOnly?: boolean;
    run: (ctx: Ctx, args: ParsedArgs<A & CommonArgsDef>) => Output | Promise<Output>;
  }
  export async function execute<A extends ArgsDef>(def: DataCommandDef<A>, args: ParsedArgs<A & CommonArgsDef>, io?: RunnerIo): Promise<void>
  export function dataCommand<A extends ArgsDef>(def: DataCommandDef<A>): CommandDef<A & CommonArgsDef>
  ```
  where `CommonArgsDef = typeof commonArgs`.

- [ ] **Step 1: Write the failing tests** `src/commands/run-command.test.ts`

```ts
import { describe, it, expect } from 'bun:test';
import { execute, type RunnerIo, type DataCommandDef, type Ctx } from './run-command.js';
import { CliError } from '../lib/errors.js';

function fakeIo(isTty = false) {
  const out: string[] = []; const err: string[] = []; const exits: number[] = [];
  const io: RunnerIo = {
    stdout: s => out.push(s), stderr: s => err.push(s), exit: c => exits.push(c), isTty,
  };
  return { io, out, err, exits };
}

const baseArgs = { _: [] as string[], format: undefined, token: undefined, db: ':memory:', tz: 'UTC', 'no-color': true } as any;

describe('execute', () => {
  it('prints JSON when stdout is not a TTY', async () => {
    const def: DataCommandDef<{}> = { meta: { name: 'x' }, run: () => ({ json: { a: 1 }, text: () => 'table' }) };
    const { io, out } = fakeIo(false);
    await execute(def, baseArgs, io);
    expect(JSON.parse(out[0])).toEqual({ a: 1 });
  });

  it('prints text when stdout is a TTY', async () => {
    const def: DataCommandDef<{}> = { meta: { name: 'x' }, run: () => ({ json: {}, text: () => 'table' }) };
    const { io, out } = fakeIo(true);
    await execute(def, baseArgs, io);
    expect(out[0]).toBe('table');
  });

  it('forces JSON for jsonOnly commands even on a TTY with --format table', async () => {
    const def: DataCommandDef<{}> = { meta: { name: 'x' }, jsonOnly: true, run: () => ({ json: [1], text: () => 'no' }) };
    const { io, out } = fakeIo(true);
    await execute(def, { ...baseArgs, format: 'table' }, io);
    expect(out[0]).toBe(JSON.stringify([1], null, 2));
  });

  it('opens a schema-ready database when needs.db is set and closes it afterwards', async () => {
    let captured: Ctx['db'];
    const def: DataCommandDef<{}> = {
      meta: { name: 'x' }, needs: { db: true },
      run: ctx => {
        captured = ctx.db;
        const row = ctx.db!.query('SELECT COUNT(*) AS n FROM daily_sleep').get() as { n: number };
        return { json: row, text: () => '' };
      },
    };
    const { io, out } = fakeIo();
    await execute(def, baseArgs, io);
    expect(JSON.parse(out[0])).toEqual({ n: 0 });
    expect(() => captured!.query('SELECT 1').get()).toThrow(); // closed handles reject new statements
  });

  it('closes the database and emits a formatted error with the mapped exit code when run throws', async () => {
    const def: DataCommandDef<{}> = {
      meta: { name: 'x' }, needs: { db: true },
      run: () => { throw new CliError('DB_ERROR', 'boom'); },
    };
    const { io, err, exits } = fakeIo(false);
    await execute(def, baseArgs, io);
    expect(JSON.parse(err[0])).toEqual({ error: { code: 'DB_ERROR', message: 'boom' } });
    expect(exits).toEqual([4]);
  });

  it('resolves ctx.today in the requested timezone', async () => {
    const { setSystemTime } = await import('bun:test');
    setSystemTime(new Date('2026-06-15T20:00:00Z'));
    try {
      const def: DataCommandDef<{}> = { meta: { name: 'x' }, run: ctx => ({ json: ctx.today, text: () => ctx.today }) };
      const { io, out } = fakeIo(false);
      await execute(def, { ...baseArgs, tz: 'Pacific/Kiritimati' }, io);
      expect(JSON.parse(out[0])).toBe('2026-06-16');
    } finally { setSystemTime(); }
  });

  it('exits with the Output exitCode when it is non-zero', async () => {
    const def: DataCommandDef<{}> = { meta: { name: 'x' }, run: () => ({ json: 1, text: () => '1', exitCode: 2 }) };
    const { io, exits } = fakeIo(false);
    await execute(def, baseArgs, io);
    expect(exits).toEqual([2]);
  });

  it('rejects an unknown --format with BAD_ARGS', async () => {
    const def: DataCommandDef<{}> = { meta: { name: 'x' }, run: () => ({ json: 1, text: () => '1' }) };
    const { io, err, exits } = fakeIo(false);
    await execute(def, { ...baseArgs, format: 'yaml' }, io);
    expect(JSON.parse(err[0]).error.code).toBe('BAD_ARGS');
    expect(exits).toEqual([1]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test src/commands/run-command.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement** `src/commands/run-command.ts`

```ts
import chalk from 'chalk';
import { defineCommand } from 'citty';
import type { ArgsDef, CommandDef, CommandMeta, ParsedArgs } from 'citty';
import type { Database } from '../lib/db.js';
import { openDatabase, ensureSchema } from '../db/database.js';
import { OuraClient } from '../api/client.js';
import { formatError, exitCodeFor } from '../lib/errors.js';
import { resolveFormat, type OutputFormat } from '../lib/format-resolve.js';
import { today, resolveDefaultTimezone } from '../lib/time.js';
import { commonArgs } from './common.js';

export type CommonArgsDef = typeof commonArgs;

export interface Ctx {
  format: OutputFormat;
  tz: string;
  /** YYYY-MM-DD in `tz` */
  today: string;
  db?: Database;
  client?: OuraClient;
}

export interface Output {
  json: unknown;
  /** Rendered only when format === 'table' */
  text: () => string;
  /** Defaults to 0 */
  exitCode?: number;
}

export interface RunnerIo {
  stdout(s: string): void;
  stderr(s: string): void;
  exit(code: number): void;
  isTty: boolean;
}

export interface DataCommandDef<A extends ArgsDef> {
  meta: CommandMeta;
  args?: A;
  needs?: { db?: boolean; client?: boolean };
  jsonOnly?: boolean;
  run: (ctx: Ctx, args: ParsedArgs<A & CommonArgsDef>) => Output | Promise<Output>;
}

export const processIo: RunnerIo = {
  stdout: s => { process.stdout.write(s + '\n'); },
  stderr: s => { process.stderr.write(s + '\n'); },
  exit: code => process.exit(code),
  isTty: process.stdout.isTTY === true,
};

export async function execute<A extends ArgsDef>(
  def: DataCommandDef<A>,
  args: ParsedArgs<A & CommonArgsDef>,
  io: RunnerIo = processIo,
): Promise<void> {
  if (args['no-color'] || process.env.NO_COLOR) chalk.level = 0;
  let db: Database | undefined;
  let format: OutputFormat = io.isTty ? 'table' : 'json';
  try {
    format = def.jsonOnly
      ? 'json'
      : resolveFormat({ explicit: args.format as string | undefined, isTty: io.isTty });
    const tz = (args.tz as string | undefined) ?? resolveDefaultTimezone();
    const ctx: Ctx = { format, tz, today: today(tz) };
    if (def.needs?.db) {
      db = openDatabase({ dbPath: args.db as string | undefined });
      ensureSchema(db);
      ctx.db = db;
    }
    if (def.needs?.client) {
      ctx.client = new OuraClient(args.token ? { token: args.token as string } : {});
    }
    const out = await def.run(ctx, args);
    io.stdout(format === 'json' ? JSON.stringify(out.json, null, 2) : out.text());
    if (out.exitCode) io.exit(out.exitCode);
  } catch (err) {
    io.stderr(formatError(err, format).text);
    io.exit(exitCodeFor(err));
  } finally {
    db?.close();
  }
}

export function dataCommand<A extends ArgsDef>(def: DataCommandDef<A>): CommandDef<A & CommonArgsDef> {
  return defineCommand({
    meta: def.meta,
    args: { ...commonArgs, ...(def.args ?? {}) } as A & CommonArgsDef,
    run: ({ args }) => execute(def, args as ParsedArgs<A & CommonArgsDef>, processIo),
  }) as CommandDef<A & CommonArgsDef>;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `bun test src/commands/run-command.test.ts && bunx tsc --noEmit`
Expected: PASS. If `tsc` complains about the `args` spread type, keep the `as A & CommonArgsDef` cast; do not loosen `strict`.

- [ ] **Step 5: Commit**

```bash
git add src/commands/run-command.ts src/commands/run-command.test.ts
git commit -m "feat(commands): add dataCommand runner owning format, db, client and errors"
```

### Task 2.2: Migrate `sync`, `report` and `db` to the runner

**Files:**
- Modify: `src/commands/sync.ts`, `src/commands/report.ts`, `src/commands/db.ts`
- Test: `src/commands/sync.test.ts`

**Interfaces:**
- Produces: `export async function runSync(ctx: Ctx): Promise<Output>` in `src/commands/sync.ts` (requires `ctx.db` and `ctx.client`); `export const syncCommand`, `reportCommand`, `dbCommand`.

- [ ] **Step 1: Rewrite `src/commands/sync.ts`**

```ts
import { importDaily } from '../db/import.js';
import { getDaySummary } from '../db/queries.js';
import { formatDaySummary, formatImportSummary } from '../render/format.js';
import { dataCommand, type Ctx, type Output } from './run-command.js';

export async function runSync(ctx: Ctx): Promise<Output> {
  const lines: string[] = [];
  const log = ctx.format === 'table' ? (m: string) => lines.push(m) : undefined;
  const importResult = await importDaily(ctx.db!, ctx.client!, ctx.today, log);
  const today = getDaySummary(ctx.db!, ctx.today);
  return {
    json: { import: importResult, today },
    text: () => [...lines, formatImportSummary(importResult), formatDaySummary(today, 'table')].join('\n'),
  };
}

export const syncCommand = dataCommand({
  meta: { name: 'sync', description: "Import latest data from Oura API and return today's summary" },
  needs: { db: true, client: true },
  run: runSync,
});
```

Progress lines that were previously printed live are now buffered into the text output; `json` output is byte-identical to before.

- [ ] **Step 2: Rewrite `src/commands/report.ts`**

```ts
import { getReport } from '../db/report.js';
import { formatReport } from '../render/format-report.js';
import { CliError } from '../lib/errors.js';
import { dataCommand } from './run-command.js';

export const reportCommand = dataCommand({
  meta: { name: 'report', description: 'Generate a narrative health report from local data.' },
  args: { period: { type: 'string', description: 'Report window: week | month', default: 'week' } },
  needs: { db: true },
  run(ctx, args) {
    const period = args.period;
    if (period !== 'week' && period !== 'month') {
      throw new CliError('BAD_ARGS', `--period must be "week" or "month", got "${period}".`);
    }
    const data = getReport(ctx.db!, period === 'week' ? 7 : 30, ctx.today);
    return { json: data, text: () => formatReport(data, 'table', period) };
  },
});
```

Check `formatReport`'s signature in `src/render/format-report.ts`: if it returns JSON itself when `format === 'json'`, keep passing `'table'` here so the runner owns JSON.

- [ ] **Step 3: Rewrite `src/commands/db.ts`**

```ts
import { defineCommand } from 'citty';
import { mkdirSync, unlinkSync } from 'fs';
import { dirname } from 'path';
import { openDatabase, ensureSchema, getDbPath } from '../db/database.js';
import { importFromCSV } from '../db/csv-import.js';
import { getDaySummary, getTrends, getStats } from '../db/queries.js';
import { formatDaySummary, formatWeekTable, formatTrends, formatStats } from '../render/format.js';
import { daysBack } from '../lib/time.js';
import { resolveFormat } from '../lib/format-resolve.js';
import { emitError, exitCodeFor } from '../lib/errors.js';
import { commonArgs } from './common.js';
import { dataCommand } from './run-command.js';
import { runSync } from './sync.js';

const SYNC_HINT = 'Run `oura-cli sync` to download your data. Oura publishes a day\'s summary after that night\'s sleep syncs from the ring.';

export const dbCommand = defineCommand({
  meta: { name: 'db', description: 'Query and manage the local SQLite database' },
  subCommands: {
    import: dataCommand({
      meta: { name: 'import', description: 'Sync new data from Oura API into local database (alias of sync)' },
      needs: { db: true, client: true },
      run: runSync,
    }),

    today: dataCommand({
      meta: { name: 'today', description: "Today's summary from local database" },
      needs: { db: true },
      run(ctx) {
        const summary = getDaySummary(ctx.db!, ctx.today);
        return { json: summary, text: () => formatDaySummary(summary, 'table', SYNC_HINT) };
      },
    }),

    date: dataCommand({
      meta: { name: 'date', description: 'Summary for specific date from local database' },
      args: { day: { type: 'positional', required: true, description: 'Target date (YYYY-MM-DD)' } },
      needs: { db: true },
      run(ctx, args) {
        const summary = getDaySummary(ctx.db!, args.day);
        return { json: summary, text: () => formatDaySummary(summary, 'table') };
      },
    }),

    week: dataCommand({
      meta: { name: 'week', description: 'Last 7 days from local database' },
      needs: { db: true },
      run(ctx) {
        const days = daysBack(ctx.today, 7).map(d => getDaySummary(ctx.db!, d));
        return { json: days, text: () => formatWeekTable(days, 'table', 'Run `oura-cli sync`, then `oura-cli db week` again.') };
      },
    }),

    trends: dataCommand({
      meta: { name: 'trends', description: 'Score and metric trends over N days (default: 30)' },
      args: { days: { type: 'positional', required: false, description: 'Window size in days (default: 30)' } },
      needs: { db: true },
      run(ctx, args) {
        const n = args.days ? parseInt(String(args.days), 10) : 30;
        const trends = getTrends(ctx.db!, n, ctx.today);
        return { json: trends, text: () => formatTrends(trends, n, 'table') };
      },
    }),

    stats: dataCommand({
      meta: { name: 'stats', description: 'Row counts, date range, and record highs from local database' },
      needs: { db: true },
      run(ctx) {
        const stats = getStats(ctx.db!, ctx.today);
        return { json: stats, text: () => formatStats(stats, 'table') };
      },
    }),

    // Deleted in PR 4; kept on the old style until then so this PR stays mechanical.
    reset: defineCommand({
      meta: { name: 'reset', description: 'Destroy and rebuild database from exported CSV files' },
      args: { ...commonArgs, force: { type: 'boolean', default: false, description: 'Confirm destructive reset' } },
      run({ args }) {
        const format = resolveFormat({ explicit: args.format, isTty: process.stdout.isTTY === true });
        try {
          if (!args.force) {
            console.log(JSON.stringify({ error: 'Use --force to confirm destructive reset.' }));
            process.exit(1);
          }
          const dbPath = getDbPath({ dbPath: args.db });
          for (const suffix of ['', '-wal', '-shm']) { try { unlinkSync(dbPath + suffix); } catch { /* absent */ } }
          const log = format === 'table' ? console.log : () => {};
          log('Database deleted.');
          mkdirSync(dirname(dbPath), { recursive: true });
          const db = openDatabase({ dbPath: args.db });
          ensureSchema(db);
          importFromCSV(db, log);
          if (format === 'json') console.log(JSON.stringify({ status: 'reset complete' }));
          db.close();
        } catch (err) {
          emitError(err, format);
          process.exit(exitCodeFor(err));
        }
      },
    }),
  },
});
```

The `formatDaySummary`, `formatWeekTable`, `formatTrends`, `formatStats` helpers still accept a `format` argument and return JSON when given `'json'`; we always pass `'table'` now. Leave their signatures alone in this PR.

- [ ] **Step 4: Rewrite `src/commands/sync.test.ts` to drive `runSync(ctx)`**

Replace the `runSync({ format, db, token, tz })` calls and `console.log` capture with a helper placed after the fixtures:

```ts
import { Database } from 'bun:sqlite';
import { ensureSchema } from '../db/database.js';
import { OuraClient } from '../api/client.js';
import type { Ctx, Output } from './run-command.js';

async function runSyncFor(format: 'json' | 'table', dbPath = TEST_DB): Promise<{ out: Output; db: Database }> {
  const db = new Database(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  ensureSchema(db);
  const ctx: Ctx = { format, tz: 'UTC', today: TODAY, db, client: new OuraClient({ token: 'test-token' }) };
  const out = await runSync(ctx);
  return { out, db };
}
```

Then, in each test: `const { out, db } = await runSyncFor('json');` and assert on `out.json` (typed as `{ import: ImportResult; today: DaySummary }`) instead of `JSON.parse(logs[0])`, or on `out.text()` instead of joined `logs`. Close `db` at the end of each test. Delete the `realLog` / `console.log` stubbing. Tests that previously asserted a thrown `CliError` from `runSync` still `expect(runSyncFor('json')).rejects…` because `runSync` no longer catches.

Run: `bunx tsc --noEmit && bun test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/commands
git commit -m "refactor(commands): run sync, report and db through dataCommand"
```

### Task 2.3: Migrate `doctor` and the API commands; delete `handleError`/`applyNoColor`

**Files:**
- Modify: `src/commands/doctor.ts`, `src/commands/api-command.ts`, `src/commands/common.ts`, `src/render/doctor-table.ts`
- Create: `src/render/doctor-types.ts` (moves the exported types so `render/` no longer imports upward)
- Delete: `src/index-flags.test.ts`
- Create: `src/no-color.test.ts`

- [ ] **Step 1: Move doctor types down into `render/`**

Create `src/render/doctor-types.ts` containing, verbatim from `commands/doctor.ts`: `CheckId`, `CheckStatus`, `DoctorCheck`, `DoctorResult`, `TokenResolution`, `DoctorDeps` (`DoctorDeps` imports `Database` as a type from `../lib/db.js`). In `commands/doctor.ts` delete those definitions and add:

```ts
import type { CheckStatus, DoctorCheck, DoctorResult, DoctorDeps, TokenResolution } from '../render/doctor-types.js';
export type { CheckId, CheckStatus, DoctorCheck, DoctorResult, DoctorDeps, TokenResolution } from '../render/doctor-types.js';
```

In `src/render/doctor-table.ts` change the import to `import type { CheckStatus, DoctorResult } from './doctor-types.js';` so `render/` no longer imports `commands/`. `doctor.test.ts` keeps importing types from `./doctor.js` through the re-export.

- [ ] **Step 2: Rewrite the `doctorCommand` definition** (keep `runChecks`, `exitCodeForChecks`, `latestDataDay`, `resolveTokenLikeClient` untouched)

```ts
import { dataCommand } from './run-command.js';

export const doctorCommand = dataCommand({
  meta: { name: 'doctor', description: 'Diagnose token, database, and sync health, and suggest the next step.' },
  args: { offline: { type: 'boolean', default: false, description: 'Skip the live Oura API token-validation call' } },
  async run(ctx, args) {
    const deps: DoctorDeps = {
      resolveToken: () => resolveTokenLikeClient(args.token as string | undefined),
      openDb: () => {
        const db = openDatabase({ dbPath: args.db as string | undefined });
        ensureSchema(db);
        return { db, path: getDbPath({ dbPath: args.db as string | undefined }) };
      },
      createClient: (token: string) => new OuraClient({ token }),
      offline: args.offline === true,
      today: ctx.today,
    };
    const result = await runChecks(deps);
    return {
      json: result,
      text: () => formatDoctorTable(result),
      exitCode: exitCodeForChecks(result.checks),
    };
  },
});
```

Doctor opens the DB itself (a failing open is one of its checks), so it does not set `needs.db`. Remove the now-unused imports (`resolveFormat`, `commonArgs`, `handleError`, `applyNoColor`, `todayDate`).

- [ ] **Step 3: Rewrite `src/commands/api-command.ts`**

```ts
import { defineCommand } from 'citty';
import { shiftDay } from '../lib/time.js';
import type { OuraEndpoint } from '../api/types.js';
import { dataCommand, type Ctx } from './run-command.js';

function fetchRange(ctx: Ctx, endpoint: OuraEndpoint, start: string, end: string) {
  return ctx.client!.fetch(endpoint, start, end).then(data => ({ json: data, text: () => JSON.stringify(data, null, 2) }));
}

export function createApiCommand(name: string, description: string, endpoint: OuraEndpoint) {
  return defineCommand({
    meta: { name, description },
    subCommands: {
      today: dataCommand({
        meta: { name: 'today', description: `Today's ${name} data` },
        needs: { client: true }, jsonOnly: true,
        run: ctx => fetchRange(ctx, endpoint, ctx.today, ctx.today),
      }),
      date: dataCommand({
        meta: { name: 'date', description: `${name} data for a specific date (YYYY-MM-DD)` },
        args: { day: { type: 'positional', required: true, description: 'Target date (YYYY-MM-DD)' } },
        needs: { client: true }, jsonOnly: true,
        run: (ctx, args) => fetchRange(ctx, endpoint, args.day, args.day),
      }),
      week: dataCommand({
        meta: { name: 'week', description: `Last 7 days of ${name} data` },
        needs: { client: true }, jsonOnly: true,
        run: ctx => fetchRange(ctx, endpoint, shiftDay(ctx.today, -6), ctx.today),
      }),
    },
  });
}
```

- [ ] **Step 4: Shrink `src/commands/common.ts`** to only `commonArgs`:

```ts
import type { ArgDef } from 'citty';

export const commonArgs = {
  format:     { type: 'string',  description: 'Output format: table | json (auto-detected by TTY)' },
  token:      { type: 'string',  description: 'Inline access token (prefer env vars or `oura-cli login`)' },
  db:         { type: 'string',  description: 'Path to SQLite database file (env: OURA_DB_PATH)' },
  tz:         { type: 'string',  description: 'Display timezone (env: OURA_TZ; auto-detected)' },
  'no-color': { type: 'boolean', default: false, description: 'Disable ANSI colors (also honors NO_COLOR env)' },
} as const satisfies Record<string, ArgDef>;
```

`grep -rn "handleError\|applyNoColor" src` must return nothing.

- [ ] **Step 5: Replace the self-asserting colour test**

`git rm src/index-flags.test.ts`. Create `src/no-color.test.ts`:

```ts
import { describe, it, expect } from 'bun:test';

async function run(args: string[], env: Record<string, string | undefined>) {
  const proc = Bun.spawn(['bun', 'run', 'src/index.ts', ...args], {
    stdout: 'pipe', stderr: 'pipe',
    env: { ...process.env, FORCE_COLOR: '1', ...env } as Record<string, string>,
  });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return out;
}

describe('--no-color / NO_COLOR', () => {
  it('emits no ANSI escapes with NO_COLOR=1', async () => {
    const out = await run(['--db', ':memory:', 'db', 'today', '--format', 'table'], { NO_COLOR: '1' });
    expect(out).not.toMatch(/\u001b\[/);
  });
  it('emits no ANSI escapes with --no-color', async () => {
    const out = await run(['--db', ':memory:', '--no-color', 'db', 'today', '--format', 'table'], { NO_COLOR: undefined });
    expect(out).not.toMatch(/\u001b\[/);
  });
});
```

- [ ] **Step 6: Verify, CHANGELOG, commit, PR**

Run: `bunx tsc --noEmit && bun test && bun run build`
Expected: PASS.

CHANGELOG under `## [Unreleased]` → `### Changed`:

```
- Every data command runs through one runner that resolves the output format, opens and always closes the database, creates the API client and maps errors to exit codes. `sync` progress lines are printed together with the summary instead of streaming. `--no-color` now takes effect before any output (internal).
```

```bash
git add -A
git commit -m "refactor(commands): migrate doctor and API commands to the runner; drop handleError/applyNoColor"
git push -u origin refactor/command-runner
gh pr create --title "refactor: dataCommand runner" --body "$(cat <<'EOF'
PR 2 of 6 from docs/superpowers/specs/2026-09-05-global-refactor-design.md.

Introduces src/commands/run-command.ts and migrates every data-path command. Deletes applyNoColor (racy dynamic import) and handleError; the DB is now closed in finally.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_016WjL92YiWyJrKDheoX8R54
EOF
)"
```

Stop and ask the user to review and merge.

---

# PR 3 — Merge helpers

Branch: `refactor/merge-helpers`.

### Task 3.1: `api/token.ts`

**Files:**
- Create: `src/api/token.ts`, `src/api/token.test.ts`
- Modify: `src/api/client.ts`, `src/commands/doctor.ts`, `src/commands/doctor.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface TokenResolution { token: string | null; source: string }
  export function resolveToken(explicit?: string, tokenPath?: string): TokenResolution
  ```
  Order: `explicit` (source `'--token'`) → `OURA_TOKEN` (source `'OURA_TOKEN'`) → file at `tokenPath ?? OURA_TOKEN_PATH ?? ~/.oura-token` (source is the path). Values are trimmed.

- [ ] **Step 1: Failing tests** `src/api/token.test.ts`

```ts
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { writeFileSync, rmSync } from 'fs';
import { resolve } from 'path';
import { tmpdir } from 'os';
import { resolveToken } from './token.js';

const file = resolve(tmpdir(), `oura-token-${process.pid}`);
const saved = { OURA_TOKEN: process.env.OURA_TOKEN, OURA_TOKEN_PATH: process.env.OURA_TOKEN_PATH };

beforeEach(() => { delete process.env.OURA_TOKEN; process.env.OURA_TOKEN_PATH = '/nonexistent/oura-token'; });
afterEach(() => {
  rmSync(file, { force: true });
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

describe('resolveToken', () => {
  it('prefers the explicit token and reports --token as the source', () => {
    process.env.OURA_TOKEN = 'env';
    expect(resolveToken('  explicit ')).toEqual({ token: 'explicit', source: '--token' });
  });
  it('falls back to OURA_TOKEN', () => {
    process.env.OURA_TOKEN = 'env-tok';
    expect(resolveToken()).toEqual({ token: 'env-tok', source: 'OURA_TOKEN' });
  });
  it('reads the token file and reports its path', () => {
    writeFileSync(file, 'file-tok\n');
    expect(resolveToken(undefined, file)).toEqual({ token: 'file-tok', source: file });
  });
  it('returns null with the attempted path when nothing is available', () => {
    expect(resolveToken(undefined, file)).toEqual({ token: null, source: file });
  });
});
```

- [ ] **Step 2: Run to verify failure** — `bun test src/api/token.test.ts` → module not found.

- [ ] **Step 3: Implement** `src/api/token.ts`

```ts
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { homedir } from 'os';

export interface TokenResolution {
  token: string | null;
  /** '--token', 'OURA_TOKEN', or the file path that was tried */
  source: string;
}

export function defaultTokenPath(): string {
  return process.env.OURA_TOKEN_PATH ?? resolve(homedir(), '.oura-token');
}

export function resolveToken(explicit?: string, tokenPath?: string): TokenResolution {
  if (explicit) return { token: explicit.trim(), source: '--token' };
  if (process.env.OURA_TOKEN) return { token: process.env.OURA_TOKEN.trim(), source: 'OURA_TOKEN' };
  const path = tokenPath ?? defaultTokenPath();
  try {
    return { token: readFileSync(path, 'utf-8').trim(), source: path };
  } catch {
    return { token: null, source: path };
  }
}
```

- [ ] **Step 4: Use it in `OuraClient`** — replace the constructor body in `src/api/client.ts`:

```ts
import { resolveToken } from './token.js';

constructor(options: OuraClientOptions = {}) {
  const { token, source } = resolveToken(options.token, options.tokenPath);
  if (!token) {
    throw new CliError('TOKEN_MISSING', `No Oura access token at ${source}.`, 'Run `oura-cli login` or set OURA_TOKEN.');
  }
  this.token = token;
}
```

Remove the now-unused `readFileSync`, `resolve`, `homedir` imports. `src/api/client.test.ts` keeps passing (same messages).

- [ ] **Step 5: Use it in doctor** — delete `resolveTokenLikeClient` from `src/commands/doctor.ts`; in `doctorCommand` use `resolveToken: () => resolveToken(args.token as string | undefined)`. Delete `TokenResolution` from `render/doctor-types.ts` and re-export the one from `api/token.ts` (`export type { TokenResolution } from '../api/token.js';`). In `doctor.test.ts` replace `resolveTokenLikeClient` tests with imports of `resolveToken` from `'../api/token.js'`, or delete them since `token.test.ts` covers the same cases.

- [ ] **Step 6: Verify and commit**

Run: `bunx tsc --noEmit && bun test`

```bash
git add -A
git commit -m "refactor(api): share token resolution between OuraClient and doctor"
```

### Task 3.2: `db/open.ts` replaces the two wrappers

**Files:**
- Create: `src/db/open.ts`
- Move tests: `src/lib/db.test.ts` + `src/db/database.test.ts` → `src/db/open.test.ts`
- Delete: `src/lib/db.ts`, `src/db/database.ts`
- Modify: every importer (`grep -rln "lib/db.js\|db/database.js" src`)

**Interfaces:**
- Produces:
  ```ts
  export type { Database } from 'bun:sqlite';
  export interface Migration { version: number; sql: string }
  export function getDbPath(explicit?: string): string           // explicit ?? OURA_DB_PATH ?? ~/.oura-cli/oura.db
  export function openDatabase(explicit?: string): Database       // mkdir parent, WAL, foreign_keys; does NOT migrate
  export function ensureSchema(db: Database, migrations?: Migration[]): void  // defaults to MIGRATIONS
  ```

- [ ] **Step 1: Write `src/db/open.test.ts`** by concatenating the cases from `lib/db.test.ts` and `db/database.test.ts`, changing the option-object calls to the new positional form (`getDbPath({ dbPath: p })` → `getDbPath(p)`, `openDatabase({ dbPath: p })` → `openDatabase(p)`, `ensureSchema(db, migrations)` unchanged, `ensureSchema(db)` unchanged). Add:

```ts
it('applies only migrations newer than the recorded version', () => {
  const db = new Database(':memory:');
  ensureSchema(db, [{ version: 1, sql: 'CREATE TABLE a (x)' }]);
  ensureSchema(db, [{ version: 1, sql: 'CREATE TABLE a (x)' }, { version: 2, sql: 'CREATE TABLE b (y)' }]);
  const tables = db.query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[];
  expect(tables.map(t => t.name)).toEqual(['_schema_version', 'a', 'b']);
});
```

- [ ] **Step 2: Implement** `src/db/open.ts`

```ts
import { Database } from 'bun:sqlite';
import { resolve, dirname } from 'path';
import { homedir } from 'os';
import { mkdirSync } from 'fs';
import { MIGRATIONS } from './schema.js';

export type { Database };

export interface Migration {
  version: number;
  sql: string;
}

export function getDbPath(explicit?: string): string {
  if (explicit) return explicit;
  if (process.env.OURA_DB_PATH) return process.env.OURA_DB_PATH;
  return resolve(homedir(), '.oura-cli', 'oura.db');
}

export function openDatabase(explicit?: string): Database {
  const dbPath = getDbPath(explicit);
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  return db;
}

function schemaVersion(db: Database): number {
  db.exec('CREATE TABLE IF NOT EXISTS _schema_version (version INTEGER NOT NULL)');
  const row = db.query('SELECT MAX(version) AS v FROM _schema_version').get() as { v: number | null } | undefined;
  return row?.v ?? 0;
}

export function ensureSchema(db: Database, migrations: Migration[] = MIGRATIONS): void {
  const current = schemaVersion(db);
  for (const m of migrations) {
    if (m.version > current) {
      db.exec(m.sql);
      db.query('INSERT INTO _schema_version (version) VALUES (?)').run(m.version);
    }
  }
}
```

`src/db/schema.ts` imports `Migration` from `../lib/db.js`; change it to `import type { Migration } from './open.js'` (type-only, no cycle at runtime).

- [ ] **Step 3: Rewire importers**

```bash
git rm src/lib/db.ts src/lib/db.test.ts src/db/database.ts src/db/database.test.ts
grep -rln "lib/db.js\|db/database.js" src
```

For each hit: `'../lib/db.js'` / `'../db/database.js'` / `'./database.js'` → the relative path to `db/open.js`. Callers using `openDatabase({ dbPath: X })` become `openDatabase(X)`, `getDbPath({ dbPath: X })` → `getDbPath(X)`. Affected: `commands/run-command.ts`, `commands/db.ts`, `commands/doctor.ts`, `commands/healthcheck.ts`, `db/import.ts`, `db/queries.ts`, `db/report.ts`, `db/csv-import.ts`, and the tests.

- [ ] **Step 4: Verify and commit**

Run: `bunx tsc --noEmit && bun test && bun run build`

```bash
git add -A
git commit -m "refactor(db): merge lib/db and db/database into db/open"
```

### Task 3.3: Delete `commands/helpers.ts`

**Files:**
- Delete: `src/commands/helpers.ts`, `src/commands/helpers.test.ts`
- Modify: any remaining importer (`grep -rn "helpers.js" src`)

- [ ] **Step 1:** After PR 2 the only users are gone or trivially replaced: `getClient` → `new OuraClient(...)` (runner), `todayDate` → `ctx.today`, `dateRange` → `shiftDay`. Run `grep -rn "helpers.js" src`; replace any leftover, then `git rm src/commands/helpers.ts src/commands/helpers.test.ts`.

- [ ] **Step 2: Verify, CHANGELOG, commit, PR**

Run: `bunx tsc --noEmit && bun test && bun run build`

CHANGELOG `### Changed`:

```
- Token resolution lives in `src/api/token.ts` and is shared by the API client and `doctor`; the two SQLite wrappers merged into `src/db/open.ts` (internal).
```

```bash
git add -A
git commit -m "refactor: remove commands/helpers"
git push -u origin refactor/merge-helpers
gh pr create --title "refactor: merge token and db helpers" --body "$(cat <<'EOF'
PR 3 of 6 from docs/superpowers/specs/2026-09-05-global-refactor-design.md.

api/token.ts shared by client and doctor; db/open.ts replaces lib/db + db/database; commands/helpers removed.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_016WjL92YiWyJrKDheoX8R54
EOF
)"
```

Stop and ask the user to review and merge.

---

# PR 4 — Collection registry

Branch: `refactor/collection-registry`.

### Task 4.1: Registry types and derivations, first descriptor

**Files:**
- Create: `src/collections/types.ts`, `src/collections/index.ts`, `src/collections/sleep.ts`
- Test: `src/collections/index.test.ts`

**Interfaces:**
- Produces (`types.ts`):
  ```ts
  export type SqlType = 'TEXT' | 'INTEGER' | 'REAL';
  export type SqlValue = string | number | null;
  export interface Column<Row> { name: string; type: SqlType; pick: (row: Row) => SqlValue; pk?: boolean; unique?: boolean }
  export interface IndexDef { name: string; columns: readonly string[]; unique?: boolean }
  export interface IdentityField { field: string; format?: 'date' | 'date-time'; description: string }
  export interface Collection<Row> {
    name: string; endpoint: OuraEndpoint; table: string; description: string;
    columns: readonly Column<Row>[]; indexes?: readonly IndexDef[];
    conflict: 'replace' | 'ignore'; syncWindow: 'range' | 'today-only';
    identity: readonly IdentityField[];
  }
  export type AnyCollection = Collection<any>;
  export function defineCollection<Row>(c: Collection<Row>): Collection<Row>
  ```
- Produces (`index.ts`): `COLLECTIONS: readonly AnyCollection[]`, `names(): string[]`, `byName(name: string): AnyCollection | undefined`, `ddl(c): string`, `insertSql(c): string`, `rowValues<Row>(c: Collection<Row>, row: Row): SqlValue[]`.

- [ ] **Step 1: Failing tests** `src/collections/index.test.ts`

```ts
import { describe, it, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { COLLECTIONS, ddl, insertSql, rowValues, names, byName } from './index.js';

describe('collection registry', () => {
  it('has unique names, endpoints and tables', () => {
    for (const key of ['name', 'endpoint', 'table'] as const) {
      const vals = COLLECTIONS.map(c => c[key]);
      expect(new Set(vals).size).toBe(vals.length);
    }
  });

  it('gives every collection exactly one row identity (a pk column or a unique index)', () => {
    for (const c of COLLECTIONS) {
      const pk = c.columns.filter(col => col.pk).length;
      const uniqueIdx = (c.indexes ?? []).filter(i => i.unique).length;
      expect(pk + uniqueIdx).toBe(1);
    }
  });

  it('produces one placeholder per column in insertSql', () => {
    for (const c of COLLECTIONS) {
      const sql = insertSql(c);
      expect((sql.match(/\?/g) ?? []).length).toBe(c.columns.length);
      expect(sql.startsWith(c.conflict === 'replace' ? 'INSERT OR REPLACE' : 'INSERT OR IGNORE')).toBe(true);
    }
  });

  it('ddl and insertSql round-trip a row through sqlite', () => {
    const c = byName('sleep')!;
    const db = new Database(':memory:');
    db.exec(ddl(c));
    const row = { id: 'x', day: '2026-06-15', score: 81, contributors: { deep_sleep: 1 }, timestamp: 't' };
    db.query(insertSql(c)).run(...rowValues(c, row));
    const back = db.query('SELECT id, day, score, contributors FROM daily_sleep').get();
    expect(back).toEqual({ id: 'x', day: '2026-06-15', score: 81, contributors: '{"deep_sleep":1}' });
  });

  it('exposes names for the fetch enum', () => {
    expect(names()).toContain('sleep');
    expect(byName('nope')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run** `bun test src/collections` → module not found.

- [ ] **Step 3: Implement** `src/collections/types.ts`

```ts
import type { OuraEndpoint } from '../api/types.js';

export type SqlType = 'TEXT' | 'INTEGER' | 'REAL';
export type SqlValue = string | number | null;

export interface Column<Row> {
  name: string;
  type: SqlType;
  pick: (row: Row) => SqlValue;
  pk?: boolean;
  unique?: boolean;
}

export interface IndexDef {
  name: string;
  columns: readonly string[];
  unique?: boolean;
}

/** An API field that is always present; drives the JSON Schema `required` list. */
export interface IdentityField {
  field: string;
  format?: 'date' | 'date-time';
  description: string;
}

export interface Collection<Row> {
  /** CLI and manifest name, e.g. 'sleep', 'hr', 'sleep-periods' */
  name: string;
  endpoint: OuraEndpoint;
  table: string;
  description: string;
  columns: readonly Column<Row>[];
  indexes?: readonly IndexDef[];
  conflict: 'replace' | 'ignore';
  /** heartrate is fetched for today only during sync */
  syncWindow: 'range' | 'today-only';
  identity: readonly IdentityField[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyCollection = Collection<any>;

export function defineCollection<Row>(c: Collection<Row>): Collection<Row> {
  return c;
}
```

`src/collections/sleep.ts`:

```ts
import { defineCollection } from './types.js';
import type { OuraSleepDay } from '../api/types.js';

export const sleep = defineCollection<OuraSleepDay>({
  name: 'sleep',
  endpoint: 'daily_sleep',
  table: 'daily_sleep',
  description: 'Daily sleep score and contributors',
  conflict: 'replace',
  syncWindow: 'range',
  identity: [
    { field: 'id', description: 'Oura record id' },
    { field: 'day', format: 'date', description: 'Date the record applies to (YYYY-MM-DD)' },
  ],
  columns: [
    { name: 'id', type: 'TEXT', pk: true, pick: r => r.id },
    { name: 'day', type: 'TEXT', unique: true, pick: r => r.day },
    { name: 'score', type: 'INTEGER', pick: r => r.score },
    { name: 'contributors', type: 'TEXT', pick: r => JSON.stringify(r.contributors) },
    { name: 'timestamp', type: 'TEXT', pick: r => r.timestamp },
  ],
});
```

`src/collections/index.ts`:

```ts
import type { AnyCollection, Collection, SqlValue } from './types.js';
import { sleep } from './sleep.js';

export type { AnyCollection, Collection, Column, SqlValue } from './types.js';

export const COLLECTIONS: readonly AnyCollection[] = [sleep];

export function names(): string[] {
  return COLLECTIONS.map(c => c.name);
}

export function byName(name: string): AnyCollection | undefined {
  return COLLECTIONS.find(c => c.name === name);
}

export function ddl(c: AnyCollection): string {
  const cols = c.columns
    .map(col => `    ${col.name} ${col.type}${col.pk ? ' PRIMARY KEY' : ''}${col.unique ? ' UNIQUE' : ''}`)
    .join(',\n');
  const indexes = (c.indexes ?? []).map(i =>
    `CREATE ${i.unique ? 'UNIQUE ' : ''}INDEX IF NOT EXISTS ${i.name} ON ${c.table}(${i.columns.join(', ')});`,
  );
  return [`CREATE TABLE IF NOT EXISTS ${c.table} (\n${cols}\n);`, ...indexes].join('\n');
}

export function insertSql(c: AnyCollection): string {
  const verb = c.conflict === 'replace' ? 'INSERT OR REPLACE' : 'INSERT OR IGNORE';
  const cols = c.columns.map(col => col.name).join(', ');
  const marks = c.columns.map(() => '?').join(', ');
  return `${verb} INTO ${c.table} (${cols}) VALUES (${marks})`;
}

export function rowValues<Row>(c: Collection<Row>, row: Row): SqlValue[] {
  return c.columns.map(col => col.pick(row));
}
```

- [ ] **Step 4: Run** `bun test src/collections && bunx tsc --noEmit` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/collections
git commit -m "feat(collections): add registry types, derivations and the sleep descriptor"
```

### Task 4.2: Remaining eight descriptors and the schema-equivalence test

**Files:**
- Create: `src/collections/readiness.ts`, `activity.ts`, `hr.ts`, `spo2.ts`, `stress.ts`, `workout.ts`, `sleep-periods.ts`, `cv-age.ts`
- Move: `src/db/schema.ts` → `src/db/migrations.ts` (update the import in `db/open.ts`)
- Modify: `src/collections/index.ts` (`COLLECTIONS` list)
- Test: `src/db/migrations.test.ts`

- [ ] **Step 1: Failing equivalence test** `src/db/migrations.test.ts`

```ts
import { describe, it, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { MIGRATIONS } from './migrations.js';
import { ensureSchema } from './open.js';
import { COLLECTIONS, ddl } from '../collections/index.js';

function describeTable(db: Database, table: string) {
  const columns = db.query(`PRAGMA table_info(${table})`).all();
  const indexes = (db.query(`PRAGMA index_list(${table})`).all() as { name: string; unique: number; origin: string }[])
    .map(i => ({ name: i.name, unique: i.unique, origin: i.origin, columns: db.query(`PRAGMA index_info(${i.name})`).all() }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { columns, indexes };
}

describe('registry DDL vs shipped migrations', () => {
  it('produces identical tables and indexes for every registry collection', () => {
    const viaMigrations = new Database(':memory:');
    ensureSchema(viaMigrations, MIGRATIONS);
    const viaRegistry = new Database(':memory:');
    for (const c of COLLECTIONS) viaRegistry.exec(ddl(c));

    for (const c of COLLECTIONS) {
      expect(describeTable(viaRegistry, c.table)).toEqual(describeTable(viaMigrations, c.table));
    }
  });

  it('registers all nine collections', () => {
    expect(COLLECTIONS.map(c => c.name).sort()).toEqual(
      ['activity', 'cv-age', 'hr', 'readiness', 'sleep', 'sleep-periods', 'spo2', 'stress', 'workout'],
    );
  });
});
```

- [ ] **Step 2:** `git mv src/db/schema.ts src/db/migrations.ts`; in `src/db/open.ts` change `'./schema.js'` → `'./migrations.js'`. Run the test → FAIL (only `sleep` registered).

- [ ] **Step 3: Write the descriptors.** Column order and types must match `MIGRATIONS[0]` exactly.

`src/collections/readiness.ts`:

```ts
import { defineCollection } from './types.js';
import type { OuraReadinessDay } from '../api/types.js';

export const readiness = defineCollection<OuraReadinessDay>({
  name: 'readiness', endpoint: 'daily_readiness', table: 'daily_readiness',
  description: 'Daily readiness score, contributors and temperature deviation',
  conflict: 'replace', syncWindow: 'range',
  identity: [
    { field: 'id', description: 'Oura record id' },
    { field: 'day', format: 'date', description: 'Date the record applies to (YYYY-MM-DD)' },
  ],
  columns: [
    { name: 'id', type: 'TEXT', pk: true, pick: r => r.id },
    { name: 'day', type: 'TEXT', unique: true, pick: r => r.day },
    { name: 'score', type: 'INTEGER', pick: r => r.score },
    { name: 'contributors', type: 'TEXT', pick: r => JSON.stringify(r.contributors) },
    { name: 'temperature_deviation', type: 'REAL', pick: r => r.temperature_deviation },
    { name: 'temperature_trend_deviation', type: 'REAL', pick: r => r.temperature_trend_deviation },
    { name: 'timestamp', type: 'TEXT', pick: r => r.timestamp },
  ],
});
```

`src/collections/activity.ts`:

```ts
import { defineCollection } from './types.js';
import type { OuraActivityDay } from '../api/types.js';

export const activity = defineCollection<OuraActivityDay>({
  name: 'activity', endpoint: 'daily_activity', table: 'daily_activity',
  description: 'Daily activity score, steps, calories and activity-time buckets',
  conflict: 'replace', syncWindow: 'range',
  identity: [
    { field: 'id', description: 'Oura record id' },
    { field: 'day', format: 'date', description: 'Date the record applies to (YYYY-MM-DD)' },
  ],
  columns: [
    { name: 'id', type: 'TEXT', pk: true, pick: r => r.id },
    { name: 'day', type: 'TEXT', unique: true, pick: r => r.day },
    { name: 'score', type: 'INTEGER', pick: r => r.score },
    { name: 'active_calories', type: 'INTEGER', pick: r => r.active_calories },
    { name: 'steps', type: 'INTEGER', pick: r => r.steps },
    { name: 'equivalent_walking_distance', type: 'REAL', pick: r => r.equivalent_walking_distance },
    { name: 'high_activity_time', type: 'INTEGER', pick: r => r.high_activity_time },
    { name: 'medium_activity_time', type: 'INTEGER', pick: r => r.medium_activity_time },
    { name: 'low_activity_time', type: 'INTEGER', pick: r => r.low_activity_time },
    { name: 'sedentary_time', type: 'INTEGER', pick: r => r.sedentary_time },
    { name: 'total_calories', type: 'INTEGER', pick: r => r.total_calories },
    { name: 'target_calories', type: 'INTEGER', pick: r => r.target_calories },
    { name: 'contributors', type: 'TEXT', pick: r => JSON.stringify(r.contributors) },
    { name: 'timestamp', type: 'TEXT', pick: r => r.timestamp },
  ],
});
```

`src/collections/hr.ts`:

```ts
import { defineCollection } from './types.js';
import type { OuraHeartRate } from '../api/types.js';

export const hr = defineCollection<OuraHeartRate>({
  name: 'hr', endpoint: 'heartrate', table: 'heartrate',
  description: 'Heart rate samples (bpm) with source',
  conflict: 'ignore', syncWindow: 'today-only',
  identity: [{ field: 'timestamp', format: 'date-time', description: 'ISO 8601 timestamp of the sample' }],
  columns: [
    { name: 'timestamp', type: 'TEXT', pick: r => r.timestamp },
    { name: 'bpm', type: 'INTEGER', pick: r => r.bpm },
    { name: 'source', type: 'TEXT', pick: r => r.source },
    { name: 'day', type: 'TEXT', pick: r => r.timestamp.slice(0, 10) },
  ],
  indexes: [
    { name: 'idx_heartrate_ts', columns: ['timestamp'] },
    { name: 'idx_heartrate_unique', columns: ['timestamp', 'source'], unique: true },
    { name: 'idx_heartrate_day', columns: ['day'] },
  ],
});
```

`src/collections/spo2.ts`:

```ts
import { defineCollection } from './types.js';
import type { OuraSpO2Day } from '../api/types.js';

export const spo2 = defineCollection<OuraSpO2Day>({
  name: 'spo2', endpoint: 'daily_spo2', table: 'daily_spo2',
  description: 'Daily blood-oxygen average and breathing disturbance index',
  conflict: 'replace', syncWindow: 'range',
  identity: [
    { field: 'id', description: 'Oura record id' },
    { field: 'day', format: 'date', description: 'Date the record applies to (YYYY-MM-DD)' },
  ],
  columns: [
    { name: 'id', type: 'TEXT', pk: true, pick: r => r.id },
    { name: 'day', type: 'TEXT', unique: true, pick: r => r.day },
    { name: 'spo2_average', type: 'REAL', pick: r => r.spo2_percentage?.average ?? null },
    { name: 'breathing_disturbance_index', type: 'REAL', pick: r => r.breathing_disturbance_index },
  ],
});
```

`src/collections/stress.ts`:

```ts
import { defineCollection } from './types.js';
import type { OuraStressDay } from '../api/types.js';

export const stress = defineCollection<OuraStressDay>({
  name: 'stress', endpoint: 'daily_stress', table: 'daily_stress',
  description: 'Daily stress summary with high-stress and high-recovery seconds',
  conflict: 'replace', syncWindow: 'range',
  identity: [
    { field: 'id', description: 'Oura record id' },
    { field: 'day', format: 'date', description: 'Date the record applies to (YYYY-MM-DD)' },
  ],
  columns: [
    { name: 'id', type: 'TEXT', pk: true, pick: r => r.id },
    { name: 'day', type: 'TEXT', unique: true, pick: r => r.day },
    { name: 'day_summary', type: 'TEXT', pick: r => r.day_summary ?? null },
    { name: 'recovery_high', type: 'INTEGER', pick: r => r.recovery_high },
    { name: 'stress_high', type: 'INTEGER', pick: r => r.stress_high },
  ],
});
```

`src/collections/workout.ts`:

```ts
import { defineCollection } from './types.js';
import type { OuraWorkout } from '../api/types.js';

export const workout = defineCollection<OuraWorkout>({
  name: 'workout', endpoint: 'workout', table: 'workouts',
  description: 'Workout sessions with activity, calories, distance and intensity',
  conflict: 'replace', syncWindow: 'range',
  identity: [
    { field: 'id', description: 'Oura record id' },
    { field: 'day', format: 'date', description: 'Date the record applies to (YYYY-MM-DD)' },
  ],
  columns: [
    { name: 'id', type: 'TEXT', pk: true, pick: r => r.id },
    { name: 'day', type: 'TEXT', pick: r => r.day },
    { name: 'activity', type: 'TEXT', pick: r => r.activity },
    { name: 'calories', type: 'REAL', pick: r => r.calories },
    { name: 'distance', type: 'REAL', pick: r => r.distance },
    { name: 'start_datetime', type: 'TEXT', pick: r => r.start_datetime },
    { name: 'end_datetime', type: 'TEXT', pick: r => r.end_datetime },
    { name: 'intensity', type: 'TEXT', pick: r => r.intensity },
    { name: 'label', type: 'TEXT', pick: r => r.label ?? '' },
    { name: 'source', type: 'TEXT', pick: r => r.source },
  ],
});
```

`src/collections/sleep-periods.ts`:

```ts
import { defineCollection } from './types.js';
import type { OuraSleepModel } from '../api/types.js';

export const sleepPeriods = defineCollection<OuraSleepModel>({
  name: 'sleep-periods', endpoint: 'sleep', table: 'sleep_model',
  description: 'Individual sleep periods with stages, HRV, heart rate and efficiency',
  conflict: 'replace', syncWindow: 'range',
  identity: [
    { field: 'id', description: 'Oura record id' },
    { field: 'day', format: 'date', description: 'Date the record applies to (YYYY-MM-DD)' },
  ],
  columns: [
    { name: 'id', type: 'TEXT', pk: true, pick: r => r.id },
    { name: 'day', type: 'TEXT', pick: r => r.day },
    { name: 'average_breath', type: 'REAL', pick: r => r.average_breath },
    { name: 'average_heart_rate', type: 'REAL', pick: r => r.average_heart_rate },
    { name: 'average_hrv', type: 'REAL', pick: r => r.average_hrv },
    { name: 'awake_time', type: 'INTEGER', pick: r => r.awake_time },
    { name: 'bedtime_end', type: 'TEXT', pick: r => r.bedtime_end },
    { name: 'bedtime_start', type: 'TEXT', pick: r => r.bedtime_start },
    { name: 'deep_sleep_duration', type: 'INTEGER', pick: r => r.deep_sleep_duration },
    { name: 'efficiency', type: 'INTEGER', pick: r => r.efficiency },
    { name: 'latency', type: 'INTEGER', pick: r => r.latency },
    { name: 'light_sleep_duration', type: 'INTEGER', pick: r => r.light_sleep_duration },
    { name: 'lowest_heart_rate', type: 'INTEGER', pick: r => r.lowest_heart_rate },
    { name: 'period', type: 'INTEGER', pick: r => r.period },
    { name: 'rem_sleep_duration', type: 'INTEGER', pick: r => r.rem_sleep_duration },
    { name: 'restless_periods', type: 'INTEGER', pick: r => r.restless_periods },
    { name: 'time_in_bed', type: 'INTEGER', pick: r => r.time_in_bed },
    { name: 'total_sleep_duration', type: 'INTEGER', pick: r => r.total_sleep_duration },
    { name: 'type', type: 'TEXT', pick: r => r.type ?? null },
  ],
});
```

`src/collections/cv-age.ts`:

```ts
import { defineCollection } from './types.js';
import type { OuraCardiovascularAge } from '../api/types.js';

export const cvAge = defineCollection<OuraCardiovascularAge>({
  name: 'cv-age', endpoint: 'daily_cardiovascular_age', table: 'cardiovascular_age',
  description: 'Daily cardiovascular (vascular) age estimate',
  conflict: 'replace', syncWindow: 'range',
  identity: [
    { field: 'id', description: 'Oura record id' },
    { field: 'day', format: 'date', description: 'Date the record applies to (YYYY-MM-DD)' },
  ],
  columns: [
    { name: 'id', type: 'TEXT', pk: true, pick: r => r.id },
    { name: 'day', type: 'TEXT', unique: true, pick: r => r.day },
    { name: 'vascular_age', type: 'INTEGER', pick: r => r.vascular_age },
  ],
});
```

Update `src/collections/index.ts`:

```ts
import { sleep } from './sleep.js';
import { readiness } from './readiness.js';
import { activity } from './activity.js';
import { hr } from './hr.js';
import { spo2 } from './spo2.js';
import { stress } from './stress.js';
import { workout } from './workout.js';
import { sleepPeriods } from './sleep-periods.js';
import { cvAge } from './cv-age.js';

/** Order is the sync order and the order tables appear in `db stats`. */
export const COLLECTIONS: readonly AnyCollection[] = [
  sleep, readiness, activity, hr, spo2, stress, workout, sleepPeriods, cvAge,
];
```

- [ ] **Step 4: Run** `bun test src/db/migrations.test.ts src/collections`. If `table_info` differs, the descriptor is wrong, not the migration: fix the descriptor. Then `bunx tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(collections): describe all nine collections and prove DDL matches the shipped schema"
```

### Task 4.3: `db/sync.ts` as a registry loop

**Files:**
- Move: `src/db/import.ts` → `src/db/sync.ts`; `src/db/import.test.ts` → `src/db/sync.test.ts`
- Modify: `src/commands/sync.ts`, `src/render/format.ts` (import path for `ImportResult`), `src/commands/sync.test.ts`

**Interfaces:**
- Produces: `importDaily(db: Database, client: OuraClient, today: string, log?: (msg: string) => void): Promise<ImportResult>` unchanged signature; `ImportResult.counts` keyed by table name as before.

- [ ] **Step 1: Failing test** — append to `src/db/sync.test.ts` (after the move):

```ts
it('inserts every registry collection and counts rows by table name', async () => {
  const db = new Database(':memory:');
  ensureSchema(db);
  const rows: Record<string, unknown[]> = {
    daily_sleep: [{ id: 's1', day: '2026-06-15', score: 80, contributors: {}, timestamp: 't' }],
    heartrate: [{ bpm: 60, source: 'awake', timestamp: '2026-06-15T10:00:00+00:00' }],
    daily_cardiovascular_age: [{ id: 'c1', day: '2026-06-15', vascular_age: 30 }],
  };
  const client = { fetch: async (endpoint: OuraEndpoint) => rows[endpoint] ?? [] } as unknown as OuraClient;
  const result = await importDaily(db, client, '2026-06-15');
  expect(result.counts).toEqual({
    daily_sleep: 1, daily_readiness: 0, daily_activity: 0, heartrate: 1, daily_spo2: 0,
    daily_stress: 0, workouts: 0, sleep_model: 0, cardiovascular_age: 1,
  });
  expect(db.query('SELECT day FROM heartrate').get()).toEqual({ day: '2026-06-15' });
});
```

- [ ] **Step 2: Move and rewrite**

```bash
git mv src/db/import.ts src/db/sync.ts
git mv src/db/import.test.ts src/db/sync.test.ts
```

`src/db/sync.ts`:

```ts
import type { Database } from './open.js';
import type { OuraClient } from '../api/client.js';
import { COLLECTIONS, insertSql, rowValues } from '../collections/index.js';
import { shiftDay } from '../lib/time.js';

const BACKFILL_DAYS = 30;
const FRESHNESS_TABLES = ['daily_sleep', 'daily_readiness', 'daily_activity'] as const;

export interface ImportResult {
  startDate: string;
  endDate: string;
  counts: Record<string, number>;
  isFirstSync: boolean;
}

export async function importDaily(
  db: Database, client: OuraClient, today: string, log?: (msg: string) => void,
): Promise<ImportResult> {
  const _log = log ?? (() => {});

  const lastDates: string[] = [];
  for (const tbl of FRESHNESS_TABLES) {
    const row = db.query(`SELECT MAX(day) as d FROM ${tbl}`).get() as { d: string | null };
    if (row?.d) lastDates.push(row.d);
  }
  const isFirstSync = lastDates.length === 0;
  const startDate = isFirstSync ? shiftDay(today, -BACKFILL_DAYS) : lastDates.sort()[0]!;

  _log(isFirstSync
    ? `First sync — backfilling the last ${BACKFILL_DAYS} days: ${startDate} → ${today}`
    : `Syncing ${startDate} → ${today}`);

  const counts: Record<string, number> = {};
  for (const c of COLLECTIONS) {
    const start = c.syncWindow === 'today-only' ? today : startDate;
    const rows = await client.fetch<unknown>(c.endpoint, start, today);
    const stmt = db.query(insertSql(c));
    db.transaction((rs: unknown[]) => { for (const r of rs) stmt.run(...rowValues(c, r)); })(rows);
    counts[c.table] = rows.length;
    if (rows.length > 0) _log(`  + ${c.table}: ${rows.length} rows`);
  }

  _log('Import complete.');
  return { startDate, endDate: today, counts, isFirstSync };
}
```

Update importers: `src/commands/sync.ts` → `'../db/sync.js'`; `src/render/format.ts` → `import type { ImportResult } from '../db/sync.js'`; `src/commands/sync.test.ts` → same. Any test asserting the old per-row log lines (`+ sleep 2026-…`, `+ heartrate N records`) is updated to the new `  + <table>: <n> rows` form.

- [ ] **Step 3: Verify and commit**

Run: `bunx tsc --noEmit && bun test`

```bash
git add -A
git commit -m "refactor(db): drive sync from the collection registry"
```

### Task 4.4: Remove `csv-import`, `db reset`, `db import`; drop `vo2max` from stats

**Files:**
- Delete: `src/db/csv-import.ts`, `src/db/csv-import.test.ts`
- Modify: `src/commands/db.ts`, `src/db/queries.ts`, `src/db/queries.test.ts`, `src/lib/argv-normalize.ts` (no change needed: `db` stays), `src/commands/describe.ts` (remove `import`/`reset` subcommand entries), `src/commands/describe.test.ts`, `README.md`

- [ ] **Step 1:** `git rm src/db/csv-import.ts src/db/csv-import.test.ts`. In `src/commands/db.ts` delete the `import:` and `reset:` entries and the now-unused imports (`defineCommand`, `mkdirSync`, `unlinkSync`, `dirname`, `getDbPath`, `importFromCSV`, `resolveFormat`, `emitError`, `exitCodeFor`, `commonArgs`, `runSync`). `dbCommand` becomes `defineCommand({ meta, subCommands: { today, date, week, trends, stats } })` — keep `defineCommand` for the parent.

- [ ] **Step 2:** In `src/db/queries.ts` `getStats`, replace the hard-coded `tableNames` with the registry:

```ts
import { COLLECTIONS } from '../collections/index.js';
// ...
const tables = COLLECTIONS.map(c => {
  const row = db.query(`SELECT COUNT(*) as cnt FROM ${c.table}`).get() as { cnt: number };
  return { table: c.table, rows: row.cnt };
});
```

Add a test in `src/db/queries.test.ts`:

```ts
it('reports one row-count entry per registry collection and none for vo2max', () => {
  const db = new Database(':memory:');
  ensureSchema(db);
  const stats = getStats(db, '2026-06-15');
  expect(stats.tables.map(t => t.table)).toEqual([
    'daily_sleep', 'daily_readiness', 'daily_activity', 'heartrate', 'daily_spo2',
    'daily_stress', 'workouts', 'sleep_model', 'cardiovascular_age',
  ]);
});
```

- [ ] **Step 3:** In `src/commands/describe.ts` remove the `import` and `reset` entries from the `db` subcommands list; fix any `describe.test.ts` assertion that listed them. In `README.md` delete the lines mentioning `db reset` / `db import` (`grep -n "db reset\|db import" README.md`).

- [ ] **Step 4: Verify, CHANGELOG, commit, PR**

Run: `bunx tsc --noEmit && bun test && bun run build`

CHANGELOG:

```
### Removed
- `db reset` and the CSV importer it relied on (it read a hard-coded personal directory), and the `db import` alias of `sync`.
- `vo2max` no longer appears in `db stats`; the table was never populated.

### Changed
- Every Oura collection is described once in `src/collections/`; table DDL, inserts and the sync loop derive from it. A test proves the derived DDL matches the shipped migrations (internal).
```

```bash
git add -A
git commit -m "refactor: remove csv import, db reset/import; derive stats tables from the registry"
git push -u origin refactor/collection-registry
gh pr create --title "refactor: collection registry" --body "$(cat <<'EOF'
PR 4 of 6 from docs/superpowers/specs/2026-09-05-global-refactor-design.md.

Breaking: removes `db reset`, `db import`, and `vo2max` from `db stats`.
Adds src/collections/ (9 descriptors) driving DDL, inserts and sync; schema-equivalence test against MIGRATIONS.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_016WjL92YiWyJrKDheoX8R54
EOF
)"
```

Stop and ask the user to review and merge.

---

# PR 5 — `fetch` and generated manifests

Branch: `refactor/fetch-and-manifests`.

### Task 5.1: `fetch <collection>`

**Files:**
- Create: `src/commands/fetch.ts`, `src/commands/fetch.test.ts`
- Delete: `src/commands/api-command.ts`
- Modify: `src/index.ts`, `src/lib/argv-normalize.ts`, `src/lib/argv-normalize.test.ts`

**Interfaces:**
- Produces: `export const fetchCommand`; `export function resolveRange(opts: { day?: string; from?: string; to?: string; days?: string; today: string }): { start: string; end: string }` (throws `CliError('BAD_ARGS', …)`).

- [ ] **Step 1: Failing tests** `src/commands/fetch.test.ts`

```ts
import { describe, it, expect } from 'bun:test';
import { resolveRange } from './fetch.js';
import { CliError } from '../lib/errors.js';

const T = '2026-06-15';

describe('resolveRange', () => {
  it('defaults to today', () => {
    expect(resolveRange({ today: T })).toEqual({ start: T, end: T });
  });
  it('accepts --day', () => {
    expect(resolveRange({ day: '2026-06-01', today: T })).toEqual({ start: '2026-06-01', end: '2026-06-01' });
  });
  it('accepts --from/--to', () => {
    expect(resolveRange({ from: '2026-06-01', to: '2026-06-07', today: T })).toEqual({ start: '2026-06-01', end: '2026-06-07' });
  });
  it('accepts --days N as the last N days ending today', () => {
    expect(resolveRange({ days: '7', today: T })).toEqual({ start: '2026-06-09', end: T });
  });
  it.each([
    [{ day: '2026-06-01', days: '7' }],
    [{ from: '2026-06-01' }],
    [{ to: '2026-06-01' }],
    [{ from: '2026-06-07', to: '2026-06-01' }],
    [{ day: '06/01/2026' }],
    [{ days: '0' }],
    [{ days: 'x' }],
  ])('rejects %j with BAD_ARGS', (opts) => {
    expect(() => resolveRange({ ...opts, today: T })).toThrow(CliError);
    try { resolveRange({ ...opts, today: T }); } catch (e) { expect((e as CliError).code).toBe('BAD_ARGS'); }
  });
});
```

- [ ] **Step 2: Run** → module not found.

- [ ] **Step 3: Implement** `src/commands/fetch.ts`

```ts
import { OuraClient } from '../api/client.js';
import { byName, names } from '../collections/index.js';
import { CliError } from '../lib/errors.js';
import { shiftDay } from '../lib/time.js';
import { dataCommand } from './run-command.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function assertDate(value: string, flag: string): string {
  if (!DATE.test(value)) throw new CliError('BAD_ARGS', `${flag} must be YYYY-MM-DD, got "${value}".`);
  return value;
}

export function resolveRange(opts: { day?: string; from?: string; to?: string; days?: string; today: string }): { start: string; end: string } {
  const modes = [opts.day !== undefined, opts.from !== undefined || opts.to !== undefined, opts.days !== undefined].filter(Boolean).length;
  if (modes > 1) throw new CliError('BAD_ARGS', 'Use only one of --day, --from/--to, or --days.');
  if (opts.day !== undefined) {
    const d = assertDate(opts.day, '--day');
    return { start: d, end: d };
  }
  if (opts.from !== undefined || opts.to !== undefined) {
    if (opts.from === undefined || opts.to === undefined) throw new CliError('BAD_ARGS', '--from and --to must be given together.');
    const start = assertDate(opts.from, '--from');
    const end = assertDate(opts.to, '--to');
    if (start > end) throw new CliError('BAD_ARGS', `--from (${start}) must not be after --to (${end}).`);
    return { start, end };
  }
  if (opts.days !== undefined) {
    const n = Number(opts.days);
    if (!Number.isInteger(n) || n < 1) throw new CliError('BAD_ARGS', `--days must be a positive integer, got "${opts.days}".`);
    return { start: shiftDay(opts.today, -(n - 1)), end: opts.today };
  }
  return { start: opts.today, end: opts.today };
}

export const fetchCommand = dataCommand({
  meta: { name: 'fetch', description: 'Fetch raw records for one Oura collection straight from the API (JSON).' },
  args: {
    collection: { type: 'positional', required: true, description: `Collection: ${names().join(' | ')}` },
    day:  { type: 'string', description: 'Single day (YYYY-MM-DD). Default: today.' },
    from: { type: 'string', description: 'Range start (YYYY-MM-DD); requires --to' },
    to:   { type: 'string', description: 'Range end (YYYY-MM-DD); requires --from' },
    days: { type: 'string', description: 'Last N days ending today' },
  },
  jsonOnly: true,
  async run(ctx, args) {
    // Validate arguments before touching the token so BAD_ARGS wins over TOKEN_MISSING.
    const c = byName(args.collection);
    if (!c) throw new CliError('BAD_ARGS', `Unknown collection "${args.collection}".`, `Valid collections: ${names().join(', ')}`);
    const { start, end } = resolveRange({
      day: args.day as string | undefined, from: args.from as string | undefined,
      to: args.to as string | undefined, days: args.days as string | undefined, today: ctx.today,
    });
    const client = new OuraClient(args.token ? { token: args.token as string } : {});
    const data = await client.fetch(c.endpoint, start, end);
    return { json: data, text: () => JSON.stringify(data, null, 2) };
  },
});
```

- [ ] **Step 4: Register and remove the old commands**

`git rm src/commands/api-command.ts`. In `src/index.ts` delete the seven `createApiCommand(...)` lines and the import; add `import { fetchCommand } from './commands/fetch.js';` and `fetch: fetchCommand,` in `subCommands`. In `src/lib/argv-normalize.ts` set:

```ts
const SUBCOMMANDS = new Set([
  'login', 'describe', 'healthcheck', 'doctor', 'manifest',
  'fetch', 'sync', 'db', 'report',
]);
```

Update `src/lib/argv-normalize.test.ts` cases that used `sleep` as the subcommand to use `fetch sleep`.

- [ ] **Step 5: Verify and commit**

Run: `bunx tsc --noEmit && bun test && bun run dev fetch nope; echo "exit=$?"`
Expected: tests PASS; the `fetch nope` call prints a `BAD_ARGS` JSON error on stderr and exits 1 even when no token is configured.

```bash
git add -A
git commit -m "feat(fetch): replace per-collection API commands with fetch <collection>"
```

### Task 5.2: `describe` and `manifest` from one model

**Files:**
- Rewrite: `src/commands/describe.ts`, `src/commands/manifest.ts`
- Modify: `src/index.ts`, `src/commands/describe.test.ts`, `src/healthcheck-manifest.test.ts`, `docs/schemas/describe.json`
- Create: `src/commands/describe.test.ts` snapshot cases (Bun writes `src/commands/__snapshots__/describe.test.ts.snap`)

**Interfaces:**
- Produces:
  ```ts
  export function buildManifest(version: string, commands: SubCommandsDef): Manifest
  export function describeCommand(version: string, getCommands: () => SubCommandsDef): CommandDef
  export function buildOpenclawManifest(version: string, commands: SubCommandsDef): OpenclawManifest
  export function manifestCommand(version: string, getCommands: () => SubCommandsDef): CommandDef
  ```
  `Manifest` keeps its existing fields; `ManifestCommand` gains `outputSchemas?: Record<string, string>` (used by `fetch`, keyed by collection name).

- [ ] **Step 1: Failing tests** — replace `src/commands/describe.test.ts` body with:

```ts
import { describe, it, expect } from 'bun:test';
import { defineCommand } from 'citty';
import { buildManifest } from './describe.js';
import { buildOpenclawManifest } from './manifest.js';
import { names } from '../collections/index.js';
import { fetchCommand } from './fetch.js';
import { dbCommand } from './db.js';
import { reportCommand } from './report.js';
import { doctorCommand } from './doctor.js';

const commands = { fetch: fetchCommand, db: dbCommand, report: reportCommand, doctor: doctorCommand,
  login: defineCommand({ meta: { name: 'login', description: 'Save a token.' }, args: { token: { type: 'string', description: 'Pass token' } } }) };

describe('buildManifest', () => {
  const m = buildManifest('9.9.9', commands);

  it('reports name, version and the compat manifest command', () => {
    expect(m.name).toBe('oura-cli');
    expect(m.version).toBe('9.9.9');
    expect(m.compatManifestCommand).toBe('oura-cli manifest');
  });

  it('lists exactly the registered top-level commands', () => {
    expect(m.commands.map(c => c.name).sort()).toEqual(Object.keys(commands).sort());
  });

  it('does not list global flags as per-command args', () => {
    const report = m.commands.find(c => c.name === 'report')!;
    expect(report.args.map(a => a.name)).toEqual(['--period']);
  });

  it('describes db subcommands with their positionals', () => {
    const db = m.commands.find(c => c.name === 'db')!;
    expect(db.subcommands?.map(s => s.name)).toEqual(['today', 'date', 'week', 'trends', 'stats']);
    expect(db.subcommands?.find(s => s.name === 'date')?.args[0]).toMatchObject({ name: '<day>', required: true });
  });

  it('gives fetch a collection enum and one output schema per collection', () => {
    const fetch = m.commands.find(c => c.name === 'fetch')!;
    expect(fetch.args.find(a => a.name === '<collection>')?.values).toEqual(names());
    expect(fetch.outputSchemas).toEqual(Object.fromEntries(names().map(n => [n, `docs/schemas/${n}.json`])));
  });

  it('points doctor at its output schema', () => {
    expect(m.commands.find(c => c.name === 'doctor')?.outputSchema).toBe('docs/schemas/doctor.json');
  });

  it('matches the snapshot (any diff here is a contract change)', () => {
    expect(m).toMatchSnapshot();
  });
});

describe('buildOpenclawManifest', () => {
  const o = buildOpenclawManifest('9.9.9', commands);
  it('has one entry per command with a runnable example', () => {
    expect(o.commands.map(c => c.name).sort()).toEqual(Object.keys(commands).sort());
    for (const c of o.commands) expect(c.examples[0]).toMatch(/^oura-cli /);
  });
  it('never advertises flags the CLI does not have', () => {
    expect(JSON.stringify(o)).not.toContain('--start');
  });
  it('matches the snapshot', () => {
    expect(o).toMatchSnapshot();
  });
});
```

- [ ] **Step 2: Run** → FAIL (`buildManifest` takes one argument; `buildOpenclawManifest` missing).

- [ ] **Step 3: Rewrite `src/commands/describe.ts`**

```ts
import { defineCommand } from 'citty';
import type { ArgDef, ArgsDef, CommandDef, SubCommandsDef } from 'citty';
import { names } from '../collections/index.js';
import { commonArgs } from './common.js';

export interface ManifestArg {
  name: string;
  type: string;
  required?: boolean;
  description?: string;
  values?: string[];
}

export interface ManifestSubcommand {
  name: string;
  description: string;
  args: ManifestArg[];
}

export interface ManifestCommand {
  name: string;
  description: string;
  args: ManifestArg[];
  outputSchema?: string;
  /** For commands whose output shape depends on an argument (fetch → collection). */
  outputSchemas?: Record<string, string>;
  subcommands?: ManifestSubcommand[];
}

export interface Manifest {
  name: string;
  version: string;
  compatManifestCommand?: string;
  auth: { envVars: string[]; tokenFile: string; loginCommand: string };
  globalFlags: ManifestArg[];
  exitCodes: { code: number; meaning: string }[];
  commands: ManifestCommand[];
}

const OUTPUT_SCHEMAS: Record<string, string> = { doctor: 'docs/schemas/doctor.json' };
const ENUM_ARGS: Record<string, Record<string, string[]>> = {
  fetch: { collection: names() },
  report: { period: ['week', 'month'] },
};

function resolved(def: SubCommandsDef[string]): CommandDef {
  if (typeof def === 'function' || def instanceof Promise) {
    throw new Error('describe: lazy subcommands are not supported; register plain CommandDef objects.');
  }
  return def as CommandDef;
}

function describeArgs(command: string, args: ArgsDef | undefined): ManifestArg[] {
  const out: ManifestArg[] = [];
  for (const [key, raw] of Object.entries(args ?? {})) {
    if (key in commonArgs) continue;
    const a = raw as ArgDef & { required?: boolean; options?: readonly string[] };
    const values = ENUM_ARGS[command]?.[key] ?? (a.type === 'enum' ? [...(a.options ?? [])] : undefined);
    if (a.type === 'positional') {
      out.push({ name: a.required ? `<${key}>` : `[${key}]`, type: 'string', required: a.required === true,
        description: a.description, ...(values ? { values } : {}) });
    } else {
      out.push({ name: `--${key}`, type: values ? 'enum' : String(a.type ?? 'string'), required: false,
        description: a.description, ...(values ? { values } : {}) });
    }
  }
  return out;
}

function describeCommandDef(name: string, def: CommandDef): ManifestCommand {
  const meta = (typeof def.meta === 'function' ? {} : def.meta) ?? {};
  const cmd: ManifestCommand = {
    name,
    description: meta.description ?? '',
    args: describeArgs(name, def.args as ArgsDef | undefined),
  };
  if (OUTPUT_SCHEMAS[name]) cmd.outputSchema = OUTPUT_SCHEMAS[name];
  if (name === 'fetch') cmd.outputSchemas = Object.fromEntries(names().map(n => [n, `docs/schemas/${n}.json`]));
  const subs = def.subCommands as SubCommandsDef | undefined;
  if (subs) {
    cmd.subcommands = Object.entries(subs).map(([subName, subDef]) => {
      const sub = resolved(subDef);
      const subMeta = (typeof sub.meta === 'function' ? {} : sub.meta) ?? {};
      return { name: subName, description: subMeta.description ?? '', args: describeArgs(subName, sub.args as ArgsDef | undefined) };
    });
  }
  return cmd;
}

export function buildManifest(version: string, commands: SubCommandsDef): Manifest {
  return {
    name: 'oura-cli',
    version,
    compatManifestCommand: 'oura-cli manifest',
    auth: { envVars: ['OURA_TOKEN', 'OURA_TOKEN_PATH'], tokenFile: '~/.oura-token', loginCommand: 'oura-cli login' },
    globalFlags: [
      { name: '--format', type: 'enum', values: ['table', 'json'], description: 'Output format (auto-detected by TTY when omitted)' },
      { name: '--db',     type: 'string', description: 'Override SQLite database path (env: OURA_DB_PATH)' },
      { name: '--tz',     type: 'string', description: 'Display timezone (env: OURA_TZ; default auto-detected)' },
      { name: '--token',  type: 'string', description: 'Inline access token (prefer env vars or `login`)' },
      { name: '--no-color', type: 'boolean', description: 'Disable ANSI colors in human output' },
    ],
    exitCodes: [
      { code: 0, meaning: 'success' },
      { code: 1, meaning: 'user error (bad arguments)' },
      { code: 2, meaning: 'auth error (missing or invalid token)' },
      { code: 3, meaning: 'API or network error' },
      { code: 4, meaning: 'database or local storage error' },
    ],
    commands: Object.entries(commands).map(([name, def]) => describeCommandDef(name, resolved(def))),
  };
}

export function describeCommand(version: string, getCommands: () => SubCommandsDef) {
  return defineCommand({
    meta: { name: 'describe', description: 'Emit a machine-readable manifest of commands, args, and outputs.' },
    args: {},
    run() {
      console.log(JSON.stringify(buildManifest(version, getCommands()), null, 2));
    },
  });
}
```

If `tsc` reports that `CommandDef.meta`/`args`/`subCommands` are `Resolvable<…>`, keep the `typeof === 'function'` guards shown; our registrations are plain objects.

- [ ] **Step 4: Rewrite `src/commands/manifest.ts`**

```ts
import { defineCommand } from 'citty';
import type { SubCommandsDef } from 'citty';
import { buildManifest } from './describe.js';

export interface OpenclawManifest {
  id: string;
  version: string;
  runtime: 'bun';
  bin: string;
  description: string;
  commands: { name: string; description: string; examples: string[] }[];
  envVars: string[];
  healthcheck: { command: string; expects: Record<string, string> };
}

const EXAMPLES: Record<string, string[]> = {
  fetch:  ['oura-cli fetch sleep', 'oura-cli fetch hr --days 7', 'oura-cli fetch workout --from 2026-05-01 --to 2026-05-31'],
  db:     ['oura-cli db today', 'oura-cli db week --format json'],
  report: ['oura-cli report --period week'],
  doctor: ['oura-cli doctor --offline'],
};

export function buildOpenclawManifest(version: string, commands: SubCommandsDef): OpenclawManifest {
  const m = buildManifest(version, commands);
  return {
    id: 'oura-cli',
    version,
    runtime: 'bun',
    bin: 'oura-cli',
    description: 'Oura Ring CLI — query and analyze Oura Ring health data. Designed for humans and agents.',
    commands: m.commands.map(c => ({
      name: c.name,
      description: c.description,
      examples: EXAMPLES[c.name] ?? [`oura-cli ${c.name}`],
    })),
    envVars: ['OURA_TOKEN', 'OURA_TOKEN_PATH', 'OURA_DB_PATH', 'OURA_TZ'],
    healthcheck: { command: 'healthcheck', expects: { ok: 'boolean', version: 'string', latencyMs: 'number' } },
  };
}

export function manifestCommand(version: string, getCommands: () => SubCommandsDef) {
  return defineCommand({
    meta: { name: 'manifest', description: 'Print openclaw-tool-registry-compatible manifest as JSON.' },
    args: {},
    run() {
      console.log(JSON.stringify(buildOpenclawManifest(version, getCommands()), null, 2));
    },
  });
}
```

- [ ] **Step 5: Wire in `src/index.ts`**

```ts
import type { SubCommandsDef } from 'citty';

const subCommands: SubCommandsDef = {
  login:       loginCommand,
  describe:    describeCommand(VERSION, () => subCommands),
  healthcheck: healthcheckCommand(VERSION),
  doctor:      doctorCommand,
  manifest:    manifestCommand(VERSION, () => subCommands),
  fetch:       fetchCommand,
  sync:        syncCommand,
  db:          dbCommand,
  report:      reportCommand,
};

const main = defineCommand({ meta: { … }, args: { ...commonArgs }, subCommands });
```

- [ ] **Step 6: Update `docs/schemas/describe.json`** so that `commands[].outputSchemas` (object of string → string) and `args[].values` are allowed. Open the file, find the `commands.items.properties` block and add:

```json
"outputSchemas": { "type": "object", "additionalProperties": { "type": "string" } }
```

Confirm `additionalProperties` is not `false` on `args.items`; if it is, add `"values": { "type": "array", "items": { "type": "string" } }` there too. `src/lib/schema-validate.test.ts` calls `buildManifest('0.3.0')`; change both calls to `buildManifest('0.3.0', subCommandsForTest)` where

```ts
import { fetchCommand } from '../commands/fetch.js';
import { doctorCommand } from '../commands/doctor.js';
const subCommandsForTest = { fetch: fetchCommand, doctor: doctorCommand };
```

and change the `outputSchema` loop to also check `Object.values(cmd.outputSchemas ?? {})`.

- [ ] **Step 7: Run and snapshot**

Run: `bunx tsc --noEmit && bun test`
Expected: PASS; Bun writes `src/commands/__snapshots__/describe.test.ts.snap`. Read the snapshot once and confirm `fetch`, `db` (5 subcommands) and no `sleep`/`readiness` entries. Commit the snapshot.

```bash
git add -A
git commit -m "feat(describe): build describe and manifest from the registered command tree"
```

### Task 5.3: Generated `docs/schemas/`

**Files:**
- Modify: `src/collections/index.ts` (add `jsonSchema`), `package.json` (`"schemas"` script), `src/lib/schema-validate.test.ts`
- Create: `scripts/generate-schemas.ts`, `src/collections/schema.test.ts`
- Regenerate: `docs/schemas/*.json` (delete none; add `sleep-periods.json`, `cv-age.json`)

**Interfaces:**
- Produces: `jsonSchema(c: AnyCollection): Record<string, unknown>`.

- [ ] **Step 1: Failing test** `src/collections/schema.test.ts`

```ts
import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { COLLECTIONS, jsonSchema } from './index.js';

const DIR = resolve(import.meta.dir, '..', '..', 'docs', 'schemas');

describe('docs/schemas/<collection>.json', () => {
  for (const c of COLLECTIONS) {
    it(`${c.name}.json equals jsonSchema() output (run \`bun run schemas\` to refresh)`, () => {
      const onDisk = JSON.parse(readFileSync(resolve(DIR, `${c.name}.json`), 'utf-8'));
      expect(onDisk).toEqual(jsonSchema(c));
    });
  }
  it('requires the identity fields and nothing else', () => {
    const s = jsonSchema(COLLECTIONS.find(c => c.name === 'hr')!) as { items: { required: string[] } };
    expect(s.items.required).toEqual(['timestamp']);
  });
});
```

- [ ] **Step 2: Implement `jsonSchema`** in `src/collections/index.ts`

```ts
export function jsonSchema(c: AnyCollection): Record<string, unknown> {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: `https://github.com/drakulavich/oura-cli/blob/main/docs/schemas/${c.name}.json`,
    title: `oura-cli fetch ${c.name} output`,
    description: c.description,
    type: 'array',
    items: {
      type: 'object',
      additionalProperties: true,
      required: c.identity.map(i => i.field),
      properties: Object.fromEntries(c.identity.map(i => [
        i.field,
        { type: 'string', ...(i.format ? { format: i.format } : {}), description: i.description },
      ])),
    },
  };
}
```

- [ ] **Step 3: Generator** `scripts/generate-schemas.ts`

```ts
import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { COLLECTIONS, jsonSchema } from '../src/collections/index.js';

const dir = resolve(import.meta.dir, '..', 'docs', 'schemas');
for (const c of COLLECTIONS) {
  const path = resolve(dir, `${c.name}.json`);
  writeFileSync(path, JSON.stringify(jsonSchema(c), null, 2) + '\n');
  console.log(`wrote ${path}`);
}
```

`package.json` scripts: add `"schemas": "bun run scripts/generate-schemas.ts"`. Run `bun run schemas`. `describe.json` and `doctor.json` are untouched (static).

- [ ] **Step 4: Update `src/lib/schema-validate.test.ts`** expected file list:

```ts
[
  'activity.json', 'cv-age.json', 'describe.json', 'doctor.json', 'hr.json', 'readiness.json',
  'sleep-periods.json', 'sleep.json', 'spo2.json', 'stress.json', 'workout.json',
]
```

- [ ] **Step 5: Verify and commit**

Run: `bunx tsc --noEmit && bun test`

```bash
git add -A
git commit -m "feat(schemas): generate docs/schemas from the collection registry"
```

### Task 5.4: README, CHANGELOG, PR

- [ ] **Step 1: README.** Replace the "Per-endpoint detail" section (lines around 108–120) and every `oura-cli sleep …`/`oura-cli hr …` example with `fetch` forms:

```markdown
### Raw API records

`fetch` returns one collection straight from the Oura API as JSON, without touching the local cache.

```bash
oura-cli fetch sleep                       # today
oura-cli fetch hr --days 7                 # last 7 days
oura-cli fetch workout --from 2026-05-01 --to 2026-05-31
oura-cli fetch sleep-periods --day 2026-06-01 | jq '.[] | {day, type, average_hrv}'
```

Collections: `sleep readiness activity hr spo2 stress workout sleep-periods cv-age`.
```

Update the piping example (`oura-cli sleep week | jq …` → `oura-cli fetch sleep --days 7 | jq …`) and the demo caption if it names removed commands. `grep -n "oura-cli sleep\|oura-cli hr\|oura-cli readiness\|oura-cli activity\|oura-cli spo2\|oura-cli stress\|oura-cli workout" README.md docs` must return nothing.

- [ ] **Step 2: CHANGELOG**

```
### Changed
- **Breaking:** the seven per-collection commands (`sleep`, `readiness`, `activity`, `hr`, `spo2`, `stress`, `workout` × `today|date|week`) are replaced by `oura-cli fetch <collection> [--day D | --from A --to B | --days N]`. `sleep-periods` and `cv-age` are now fetchable too.
- `describe` and `manifest` are generated from the registered command tree, so they can no longer drift from the CLI; `manifest` examples that referenced a non-existent `--start` flag are gone.
- `docs/schemas/<collection>.json` are generated (`bun run schemas`) and checked by a test; added `sleep-periods.json` and `cv-age.json`.
```

- [ ] **Step 3: Verify, commit, PR**

Run: `bunx tsc --noEmit && bun test && bun run build`

```bash
git add -A
git commit -m "docs: document fetch and generated manifests"
git push -u origin refactor/fetch-and-manifests
gh pr create --title "feat: fetch <collection>; generated describe/manifest/schemas" --body "$(cat <<'EOF'
PR 5 of 6 from docs/superpowers/specs/2026-09-05-global-refactor-design.md.

Breaking: seven per-collection commands become `fetch <collection>`. describe/manifest derive from the command tree; docs/schemas generated from the registry with a drift test.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_016WjL92YiWyJrKDheoX8R54
EOF
)"
```

Stop and ask the user to review and merge.

---

# PR 6 — Version source and documentation, release 0.5.0

Branch: `chore/release-0.5.0`.

### Task 6.1: Version from `package.json`

**Files:**
- Modify: `src/index.ts`, `package.json`, `CLAUDE.md`
- Test: `src/healthcheck-manifest.test.ts` (add a `--version` case)

- [ ] **Step 1: Failing test** — add to `src/healthcheck-manifest.test.ts`:

```ts
it('--version prints the package.json version', async () => {
  const proc = Bun.spawn(['bun', 'run', 'src/index.ts', '--version'], { stdout: 'pipe' });
  const out = (await new Response(proc.stdout).text()).trim();
  await proc.exited;
  expect(out).toBe(PACKAGE_VERSION);
});
```

- [ ] **Step 2:** Bump `package.json` `"version"` to `0.5.0`. Run the test → FAIL (constant still says 0.4.5).

- [ ] **Step 3:** In `src/index.ts` replace `const VERSION = '0.4.5';` with:

```ts
import { readFileSync } from 'fs';

const VERSION = (JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf-8'),
) as { version: string }).version;
```

This resolves to `<repo>/package.json` from both `src/index.ts` and `dist/index.js`; `package.json` is always in the published tarball.

- [ ] **Step 4:** `bun test src/healthcheck-manifest.test.ts && bun run build && ./dist/index.js --version` → prints `0.5.0`.

- [ ] **Step 5:** Commit

```bash
git add -A
git commit -m "chore: read the CLI version from package.json"
```

### Task 6.2: Rewrite `docs/ARCHITECTURE.md`, update `CLAUDE.md`, finalize CHANGELOG

- [ ] **Step 1: `docs/ARCHITECTURE.md`** — replace the whole file with:

```markdown
# Architecture

`oura-cli` is a Bun-only CLI (`bun:sqlite` has no native dependency) built on `citty`. It pulls Oura Ring data into a local SQLite cache and prints it as JSON for agents or text for a terminal.

## Layers

Dependencies point strictly downward.

```
src/index.ts      wiring: builds the citty tree, reads the version from package.json
src/commands/     citty command definitions; the only place that writes to stdout
src/render/       text formatters (day/week/trends/stats, report, doctor); no I/O
src/db/           open.ts (path, WAL, migrations), migrations.ts (frozen SQL), sync.ts, queries.ts, report.ts
src/collections/  one descriptor per Oura collection; derives DDL, inserts, fetch enum, manifests, JSON Schemas
src/api/          client.ts (HTTP), token.ts (resolution order), types.ts (upstream row shapes)
src/lib/          errors, time, argv-normalize, format-resolve — no domain knowledge
```

## Command runner

`src/commands/run-command.ts` exports `dataCommand(def)`. Given `{ meta, args, needs, jsonOnly, run }` it returns a citty command whose handler applies `--no-color`, resolves the output format, opens and migrates the database when `needs.db`, creates an `OuraClient` when `needs.client`, calls `run(ctx, args)` and prints `Output.json` or `Output.text()`. Errors are formatted per the resolved format and mapped to exit codes; the database is closed in `finally`. Exceptions: `login` (interactive), `healthcheck` (always `{ok,…}` JSON), `describe`/`manifest` (pure JSON).

## Collection registry

`src/collections/index.ts` exports `COLLECTIONS` and the derivations `ddl`, `insertSql`, `rowValues`, `names`, `byName`, `jsonSchema`. Each descriptor lists `columns` with a typed `pick` against `api/types.ts`, so an upstream rename fails `tsc`. Shipped migrations stay as frozen SQL; `src/db/migrations.test.ts` proves the registry DDL produces the same `PRAGMA table_info`/`index_list` for every table.

## Adding a collection

1. Add the row type to `src/api/types.ts` and the endpoint to `OuraEndpoint`.
2. Create `src/collections/<name>.ts` with `defineCollection<Row>({ … })` and add it to `COLLECTIONS`.
3. Append a migration to `src/db/migrations.ts` creating the table (never edit an existing entry).
4. Run `bun run schemas` and commit the new `docs/schemas/<name>.json`.
5. `bun test` — the equivalence, registry and schema-drift tests must pass. `fetch <name>`, `sync`, `describe` and `manifest` pick it up automatically.

## Adding a command

Create it in `src/commands/` with `dataCommand`, register it in `src/index.ts`, and add its name to `SUBCOMMANDS` in `src/lib/argv-normalize.ts` (citty does not hoist root flags onto subcommands; that normaliser does). `describe` and `manifest` are generated from the registered tree and need no edit. Update `src/commands/__snapshots__/describe.test.ts.snap` via `bun test -u` and review the diff.

## Output contract

JSON shapes are a published contract: `docs/schemas/*.json` (per-collection files are generated), `describe`, exit codes 0/1/2/3/4. Changing a shape means changing the schema in the same PR.
```

- [ ] **Step 2: `CLAUDE.md`** edits:
  - Delete the section "THE VERSION LIVES IN TWO PLACES"; replace with one line under "Critical Development Rules": `The version is read from package.json at runtime; there is no constant to keep in sync.`
  - "THE CLI IS citty": drop the sentence claiming `docs/ARCHITECTURE.md` says Commander.
  - "LAYERS DEPEND ONLY DOWNWARD": replace the chain with `src/lib/ → src/api/ → src/collections/ → src/db/ → src/render/ → src/commands/ → src/index.ts`, delete the paragraph that calls ARCHITECTURE.md stale.
  - "EVERY USER-FACING COMMAND NEEDS BOTH OUTPUT MODES": replace `createApiCommand always emits JSON` with `` `fetch` is JSON-only``.
  - "ERRORS": replace the wiring sentence with: `The boundary is the runner in src/commands/run-command.ts; a command built with dataCommand cannot forget it. login has its own catch; healthcheck swallows into {ok:false}.`
  - Conventions: "A new top-level command touches four files" → three (`src/commands/`, `src/index.ts`, `SUBCOMMANDS`) plus refreshing the describe snapshot; "A new Oura endpoint" → point to the "Adding a collection" recipe in ARCHITECTURE.md.
  - Build & Verify: add `bun run schemas   # regenerate docs/schemas from the registry`.

- [ ] **Step 3: CHANGELOG** — rename `## [Unreleased]` to `## [0.5.0] - <today's date>`, add a fresh empty `## [Unreleased]` above it, and prepend to the 0.5.0 section:

```
### Breaking
- Per-collection API commands replaced by `fetch <collection>`; `db reset` and `db import` removed. See "Changed" and "Removed" below.
```

- [ ] **Step 4: Verify, commit, PR**

Run: `bunx tsc --noEmit && bun test && bun run build`

```bash
git add -A
git commit -m "chore: release 0.5.0 — architecture docs, CLAUDE.md, changelog"
git push -u origin chore/release-0.5.0
gh pr create --title "chore: release 0.5.0" --body "$(cat <<'EOF'
PR 6 of 6 from docs/superpowers/specs/2026-09-05-global-refactor-design.md.

Version read from package.json (bumped to 0.5.0); ARCHITECTURE.md rewritten; CLAUDE.md updated; CHANGELOG 0.5.0 section.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_016WjL92YiWyJrKDheoX8R54
EOF
)"
```

### Task 6.3: Tag (only after the user confirms)

- [ ] **Step 1:** After PR 6 is merged, ask the user explicitly: "Push tag v0.5.0 and trigger the npm release?" Do nothing until they say yes.
- [ ] **Step 2:** On yes:

```bash
git checkout main && git pull
git tag v0.5.0
git push origin v0.5.0
gh run watch
```

`release.yml` runs tests, builds, publishes with provenance and creates the GitHub Release from the CHANGELOG section. If it fails, do not delete or re-push the tag; fix forward as 0.5.1.

---

## Self-review against the spec

- §3.1 layers and file moves → Tasks 1.3, 3.1, 3.2, 3.3, 4.2 (`schema.ts → migrations.ts`), 4.3 (`import.ts → sync.ts`).
- §3.2 registry, derivations, `vo2max` → Tasks 4.1, 4.2, 4.4, 5.3 (`jsonSchema`).
- §3.3 runner, `Ctx`/`Output`/`exitCode`, `today`/`daysBack` → Tasks 1.1, 1.2, 2.1–2.3.
- §3.4 token and open helpers → Tasks 3.1, 3.2.
- §4 contract: `fetch` → 5.1; removals → 4.4; generated `describe`/`manifest` → 5.2; schemas → 5.3; version → 6.1.
- §5 DB compatibility → Task 4.2 equivalence test.
- §7 testing: registry invariants (4.1), equivalence (4.2), schema drift (5.3), snapshots (5.2), runner (2.1), timezone regression (1.2), `NO_COLOR` process test (2.3).
- §8 sequence → six PR sections in order, each ending with a review gate.
