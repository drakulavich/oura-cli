# CLAUDE.md

`oura-cli` pulls Oura Ring data into a local SQLite cache and prints it for humans or agents. Bun-only: `bun:sqlite` is the reason — it removes any native dependency, at the cost of no Node fallback.

## Rules that are easy to get wrong

### There is a build step: `bin` points at `dist/`, not `src/`

Unlike most Bun projects, this one ships compiled output: `package.json#bin` → `dist/index.js`, produced by `bun run build` (`prepublishOnly` runs it). `bun run dev` runs the sources. **Never hand-edit `dist/`** — it is generated; if a change seems to have no effect, you are probably running a stale `dist/` via the globally linked binary. The version is read from package.json at runtime; there is no constant to keep in sync.

### Releases are tag-driven and permanent

A release is a PR that bumps `package.json` and adds a `## [x.y.z] - YYYY-MM-DD` section to `CHANGELOG.md`, then a tag on the **merge commit GitHub reports** — never local `HEAD` (the merge rewrote it) and never `origin/main` (it moves when the next PR lands). `release.yml` publishes to npm with Trusted Publishing (no token secret) and creates a GitHub Release whose body is that CHANGELOG section. A published version is permanent and a tag is one-use: on failure **fix forward** with a new patch version, never re-tag. The step-by-step procedure and the tag command are in CONTRIBUTING.md under "Releasing (maintainers)".

### Layers depend only downward

`src/lib/` → `src/api/` → `src/collections/` → `src/db/` → `src/render/` → `src/commands/` → `src/index.ts`. Reaching *upward* is the mistake to avoid — `lib/` must not import `api/`, `api/` must not import `db/`. Text formatters live in `src/render/`: they import `db` types and write nothing to stdout.

### Every user-facing data command has both output modes

JSON for agents and pipes, table/text for a TTY. The existing exceptions are deliberate — `describe`, `manifest`, `healthcheck` and `fetch` are JSON-only, `login` is interactive text. Don't "fix" those. Structured output is a published contract: the JSON Schemas under `docs/schemas/` and the `describe` manifest are consumed externally, so changing a shape means updating the schema in the same PR.

### Errors that reach the CLI surface are `CliError`

Use `CliError` with a documented `ErrorCode` from `src/lib/errors.ts`; a new code also needs an arm in `exitCodeFor`. The boundary is the runner in `src/commands/run-command.ts`, so a `dataCommand` cannot forget it; `login` has its own catch and `healthcheck` swallows into `{ok:false}` by design. Errors citty raises *before* a command runs (unknown command, missing positional) are translated in `src/index.ts` via `src/lib/citty-error.ts`, which also holds the hints for commands removed in 0.5.0. The runner rejects any flag a command did not declare in `args`.

### Keep `bun.lock` in sync

CI runs `bun install --frozen-lockfile`, so a lockfile that lags `package.json` fails the install step before any test runs; this has blocked CI twice (#15, #16). Commit the lockfile with any dependency change.

## Build & verify

```bash
bun install
bun run dev            # run the CLI from source
bun test               # co-located *.test.ts
bunx tsc --noEmit      # strict; `typescript` here is the TS 7 compiler
bun run build          # emit dist/
bun run schemas        # regenerate docs/schemas from the registry
```

CI runs type-check → tests → build → `npm audit` (high+); only the first three block. `release.yml` runs tests and build but not `tsc`, so type errors only surface in CI on a PR — run it locally before pushing.

## Conventions

- The CLI is `citty` (`defineCommand`/`runMain`). There is no `commander` dependency; don't refactor toward it.
- Tests are co-located (`foo.test.ts` next to `foo.ts`; no `tests/` directory). A new test must fail under a one-line mutation of the code it pins — reviews check this by mutating the code.
- Named exports only, and local imports carry a `.js` suffix (`./commands/login.js`) even though the files are `.ts`.
- A new top-level command: follow "Adding a command" in `docs/ARCHITECTURE.md`. The gotcha is that it must be registered in `src/commands/registry.ts` and added to `SUBCOMMANDS` in `src/lib/argv-normalize.ts`, or `oura-cli --format json <cmd>` silently ignores the flag — citty does not hoist root flags onto subcommands, and that normalizer is what moves them. The contract test fails when the two lists differ. A new *global* flag needs `GLOBAL_FLAGS_WITH_VALUE` / `GLOBAL_FLAGS_BOOLEAN` in the same file.
- A new Oura endpoint: follow "Adding a collection" in `docs/ARCHITECTURE.md`. Treat every API field as nullable unless proven otherwise — #23 had to retype `day_summary`, `label` and `type` after the upstream spec drifted.
- Schema migrations are append-only. `ensureSchema` applies only entries with `version > current`, so editing an already-shipped migration is a no-op on existing databases. Add a new version entry instead.
- A helper → `src/lib/`. Avoid bucket files.
- One logical change per commit, with a test for any behaviour change and a `CHANGELOG.md` bullet under `## [Unreleased]`. Related issues may share a PR, one commit per issue. `main` is protected: everything lands through a PR.

## Environment

`OURA_TOKEN` (or `OURA_TOKEN_PATH`) authenticates; `OURA_DB_PATH` overrides the `~/.oura-cli/oura.db` cache; `OURA_TZ` sets the timezone used for day boundaries; `NO_COLOR` (or `--no-color`) disables ANSI. The rule lives in `src/lib/color-mode.ts` and is applied by `src/lib/apply-color-mode.ts`, which **must stay the first import in `src/index.ts`**: citty decides whether to colour its help output when its module is evaluated, so a later assignment is too late (#80).

## Repo notes

- `assets/*.gif` is Git LFS-tracked; run `git lfs install` once per clone or the demo is a pointer stub. Regenerating it needs VHS — see CONTRIBUTING.md.
- `docs/loops/*-state.md` are memory files for scheduled agent loops, not documentation. Update the state file in the same run that produced the finding, and don't claim a blocker is resolved without evidence.
