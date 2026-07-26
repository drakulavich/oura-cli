# CLAUDE.md

`oura-cli` pulls Oura Ring data into a local SQLite cache and prints it for humans or agents. Bun-only: `bun:sqlite` is the reason — it removes any native dependency, at the cost of no Node fallback.

## Critical Development Rules

### THERE IS A BUILD STEP — `bin` POINTS AT `dist/`, NOT `src/`

Unlike most Bun projects, this one ships compiled output: `package.json#bin` → `dist/index.js`, produced by `bun run build` (`prepublishOnly` runs it before publish). `bun run dev` runs the sources directly for local work.

**Never hand-edit `dist/`** — it is generated. If a change seems to have no effect, you are probably running a stale `dist/` via the globally linked binary.

### THE VERSION LIVES IN TWO PLACES

`package.json#version` **and** the `VERSION` constant in `src/index.ts` must move together — the constant is what `oura-cli --version` prints. Nothing enforces this, and it has already drifted once (0.4.5 was released with the constant left at 0.4.4).

### RELEASES ARE TAG-DRIVEN AND PERMANENT

Bump both versions, add a `## [x.y.z] - YYYY-MM-DD` section to `CHANGELOG.md`, then `git tag vx.y.z && git push origin main vx.y.z`. `release.yml` runs tests, publishes to npm, and creates a GitHub Release whose body is that CHANGELOG section.

Publishing uses **npm Trusted Publishing** (`id-token: write` + `--provenance`); there is no `NPM_TOKEN` secret, and CONTRIBUTING.md's instructions to configure one are stale. A published version is permanent and a tag is one-use: on failure, **fix forward** with a new patch version — never re-tag.

### THE CLI IS `citty`, NOT COMMANDER

Commands are `defineCommand`/`runMain` from `citty`. `docs/ARCHITECTURE.md` still says "Commander" in places — that is wrong; there is no `commander` dependency. Don't refactor toward it.

### LAYERS DEPEND ONLY DOWNWARD

`src/lib/` (generic helpers, no domain knowledge) → `src/api/` (HTTP; knows nothing about SQLite) → `src/db/` (SQL and the local cache; imports `api/` for row types and sync, but knows nothing about output formatting) → `src/commands/` (format resolution; every `console.log`/`process.stdout` write lives here) → `src/index.ts` (wiring only).

Reaching *upward* is the mistake to avoid — `lib/` must not import `api/`, `api/` must not import `db/`. Table formatters are the exception to the directory rule: they live at `src/format.ts` and `src/format-report.ts` (root level, importing `db` types), not under `commands/`.

`docs/ARCHITECTURE.md` has per-module detail but is **stale**: its diagram shows `api` and `db` as peers that only import `lib`, it omits the format modules, and it describes a Commander `parseAsync().catch()` entrypoint that no longer exists. Trust the code.

### EVERY USER-FACING COMMAND NEEDS BOTH OUTPUT MODES

JSON for agent and pipe contexts, table/text for a TTY. This applies to **new user-facing data commands**; the existing exceptions are deliberate — `describe`, `manifest` and `healthcheck` are JSON-only, `login` is interactive text, and `createApiCommand` always emits JSON without calling `resolveFormat`. Don't "fix" those.

Structured output is a published contract: the JSON Schemas under `docs/schemas/` and the `describe` manifest are consumed externally, so changing a shape means updating the schema in the same change.

### ERRORS THAT REACH THE CLI SURFACE ARE `CliError`

Use `CliError` with a documented `ErrorCode` from `src/lib/errors.ts`; a new code also needs an arm in `exitCodeFor`. There is **no global handler** — `src/index.ts` calls `runMain` and catches nothing. The boundary is `handleError()` in `src/commands/common.ts` (`emitError(err, fmt)` then `process.exit(exitCodeFor(err))`), wired per command: the data-path commands (`api-command`, `db`, `sync`, `report`) call it, `healthcheck` deliberately swallows into `{ ok: false, error }` because it is a probe, and `login`/`describe`/`manifest` have no catch at all. A throwing command without `handleError` loses both the exit-code mapping and the format-aware output.

### KEEP `bun.lock` IN SYNC

CI runs `bun install --frozen-lockfile`, so a lockfile that lags `package.json` fails the install step before any test runs. This has blocked CI twice (#15, #16) — commit the lockfile with any dependency change.

## Build & Verify

```bash
bun install
bun run dev            # run the CLI from source
bun test               # co-located *.test.ts
bunx tsc --noEmit      # strict; `typescript` here is the TS 7 compiler
bun run build          # emit dist/
```

CI runs type-check → tests → build → `npm audit` (high+). Only the first three block: the audit step swallows failures into a `::warning::`. `release.yml` runs tests and build but **not** `tsc`, so type errors only surface in CI on a PR — run it locally before pushing.

## Conventions

- **Tests are co-located**: `foo.test.ts` sits next to `foo.ts`. There is no `tests/` directory.
- **Named exports only** — there are currently no default exports anywhere in `src/`.
- **Local imports carry a `.js` suffix** (`./commands/login.js`) even though the files are `.ts`.
- **A new top-level command touches four files, not one**: `src/commands/` (the implementation), `src/index.ts` (registration), the `SUBCOMMANDS` set in `src/lib/argv-normalize.ts`, and the agent surface in `src/commands/describe.ts` (`buildManifest`) plus `src/commands/manifest.ts`. Miss `SUBCOMMANDS` and `oura-cli --format json <cmd>` silently ignores the flag — citty does not hoist root flags onto subcommands, and that normalizer is what moves them. A new *global* flag needs `GLOBAL_FLAGS_WITH_VALUE` / `GLOBAL_FLAGS_BOOLEAN` in the same file.
- **A new Oura endpoint**: row type in `src/api/types.ts`, optional cache table in `src/db/schema.ts`, command via the factory in `src/commands/api-command.ts`. Treat every API field as nullable unless proven otherwise — #23 had to retype `day_summary`, `label` and `type` after the upstream spec drifted.
- **Schema migrations are append-only.** `ensureSchema` applies only entries with `version > current`, so editing an already-shipped migration is a no-op on existing databases. Add a new version entry instead.
- A helper → `src/lib/`. Avoid bucket files.
- **One change per PR**, with a test for any behaviour change and a `CHANGELOG.md` bullet under `## [Unreleased]`.

## Environment

`OURA_TOKEN` (or `OURA_TOKEN_PATH`) authenticates; `OURA_DB_PATH` overrides the `~/.oura-cli/oura.db` cache; `OURA_TZ` sets the timezone used for day boundaries; `NO_COLOR` (or `--no-color`) disables ANSI, and is applied in `src/index.ts` before any chalk call.

## Repo Notes

- `assets/*.gif` is **Git LFS**-tracked; run `git lfs install` once per clone or the demo is a pointer stub. Regenerating it needs VHS — see CONTRIBUTING.md.
- `docs/loops/*-state.md` are memory files for scheduled agent loops, not documentation. Update the state file in the same run that produced the finding, and don't claim a blocker is resolved without evidence.
