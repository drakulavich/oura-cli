# CLAUDE.md

`oura-cli` pulls Oura Ring data into a local SQLite cache and prints it for humans or agents. Bun-only: `bun:sqlite` is the reason — it removes any native dependency, at the cost of no Node fallback.

## Critical Development Rules

### THERE IS A BUILD STEP — `bin` POINTS AT `dist/`, NOT `src/`

Unlike most Bun projects, this one ships compiled output: `package.json#bin` → `dist/index.js`, produced by `bun run build` (`prepublishOnly` runs it before publish). `bun run dev` runs the sources directly for local work.

**Never hand-edit `dist/`** — it is generated. If a change seems to have no effect, you are probably running a stale `dist/` via the globally linked binary.

The version is read from package.json at runtime; there is no constant to keep in sync.

### RELEASES ARE TAG-DRIVEN AND PERMANENT

Bump the version in `package.json`, add a `## [x.y.z] - YYYY-MM-DD` section to `CHANGELOG.md`, then `git tag vx.y.z && git push origin main vx.y.z`. `release.yml` runs tests, publishes to npm, and creates a GitHub Release whose body is that CHANGELOG section.

Publishing uses **npm Trusted Publishing** (`id-token: write` + `--provenance`); there is no `NPM_TOKEN` secret, and CONTRIBUTING.md's instructions to configure one are stale. A published version is permanent and a tag is one-use: on failure, **fix forward** with a new patch version — never re-tag.

### THE CLI IS `citty`, NOT COMMANDER

Commands are `defineCommand`/`runMain` from `citty`. There is no `commander` dependency. Don't refactor toward it.

### LAYERS DEPEND ONLY DOWNWARD

`src/lib/` → `src/api/` → `src/collections/` → `src/db/` → `src/render/` → `src/commands/` → `src/index.ts`.

Reaching *upward* is the mistake to avoid — `lib/` must not import `api/`, `api/` must not import `db/`. Text formatters live in `src/render/` (between `db/` and `commands/`): they import `db` types and write nothing to stdout.

### EVERY USER-FACING COMMAND NEEDS BOTH OUTPUT MODES

JSON for agent and pipe contexts, table/text for a TTY. This applies to **new user-facing data commands**; the existing exceptions are deliberate — `describe`, `manifest` and `healthcheck` are JSON-only, `login` is interactive text, and `fetch` is JSON-only. Don't "fix" those.

Structured output is a published contract: the JSON Schemas under `docs/schemas/` and the `describe` manifest are consumed externally, so changing a shape means updating the schema in the same change.

### ERRORS THAT REACH THE CLI SURFACE ARE `CliError`

Use `CliError` with a documented `ErrorCode` from `src/lib/errors.ts`; a new code also needs an arm in `exitCodeFor`. The boundary is the runner in src/commands/run-command.ts; a command built with dataCommand cannot forget it. Errors citty raises *before* a command runs (unknown command, missing positional) are translated in `src/index.ts` via `src/lib/citty-error.ts`, which also holds the hints for commands removed in 0.5.0. login has its own catch; healthcheck swallows into {ok:false}. The runner rejects any flag a command did not declare in `args`, so a new flag must be declared or it is a `BAD_ARGS` at runtime.

### KEEP `bun.lock` IN SYNC

CI runs `bun install --frozen-lockfile`, so a lockfile that lags `package.json` fails the install step before any test runs. This has blocked CI twice (#15, #16) — commit the lockfile with any dependency change.

## Build & Verify

```bash
bun install
bun run dev            # run the CLI from source
bun test               # co-located *.test.ts
bunx tsc --noEmit      # strict; `typescript` here is the TS 7 compiler
bun run build          # emit dist/
bun run schemas        # regenerate docs/schemas from the registry
```

CI runs type-check → tests → build → `npm audit` (high+). Only the first three block: the audit step swallows failures into a `::warning::`. `release.yml` runs tests and build but **not** `tsc`, so type errors only surface in CI on a PR — run it locally before pushing.

## Conventions

- **Tests are co-located**: `foo.test.ts` sits next to `foo.ts`. There is no `tests/` directory.
- **Named exports only** — there are currently no default exports anywhere in `src/`.
- **Local imports carry a `.js` suffix** (`./commands/login.js`) even though the files are `.ts`.
- **A new top-level command touches three files**: `src/commands/` (the implementation), `src/index.ts` (registration), and the `SUBCOMMANDS` set in `src/lib/argv-normalize.ts` — plus refreshing the describe snapshot (`bun test -u` on `src/commands/__snapshots__/describe.test.ts.snap`, then review the diff). Miss `SUBCOMMANDS` and `oura-cli --format json <cmd>` silently ignores the flag — citty does not hoist root flags onto subcommands, and that normalizer is what moves them. A new *global* flag needs `GLOBAL_FLAGS_WITH_VALUE` / `GLOBAL_FLAGS_BOOLEAN` in the same file.
- **A new Oura endpoint**: see the "Adding a collection" recipe in `docs/ARCHITECTURE.md`. Treat every API field as nullable unless proven otherwise — #23 had to retype `day_summary`, `label` and `type` after the upstream spec drifted.
- **Schema migrations are append-only.** `ensureSchema` applies only entries with `version > current`, so editing an already-shipped migration is a no-op on existing databases. Add a new version entry instead.
- A helper → `src/lib/`. Avoid bucket files.
- **One change per PR**, with a test for any behaviour change and a `CHANGELOG.md` bullet under `## [Unreleased]`.

## Environment

`OURA_TOKEN` (or `OURA_TOKEN_PATH`) authenticates; `OURA_DB_PATH` overrides the `~/.oura-cli/oura.db` cache; `OURA_TZ` sets the timezone used for day boundaries; `NO_COLOR` (or `--no-color`) disables ANSI, and is applied in `src/index.ts` before any chalk call.

## Repo Notes

- `assets/*.gif` is **Git LFS**-tracked; run `git lfs install` once per clone or the demo is a pointer stub. Regenerating it needs VHS — see CONTRIBUTING.md.
- `docs/loops/*-state.md` are memory files for scheduled agent loops, not documentation. Update the state file in the same run that produced the finding, and don't claim a blocker is resolved without evidence.
