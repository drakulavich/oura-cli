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

`src/lib/` (generic helpers, no domain knowledge) → `src/api/` (HTTP; knows nothing about SQLite) → `src/db/` (SQL; knows nothing about output formatting) → `src/commands/` (format resolution and **all** stdout/stderr) → `src/index.ts` (wiring only).

A layer reaching sideways or upward is the main architectural mistake here. Details and per-module responsibilities: `docs/ARCHITECTURE.md`.

### EVERY USER-FACING COMMAND NEEDS BOTH OUTPUT MODES

JSON for agent and pipe contexts, table/text for a TTY — both are mandatory, not optional. Structured output is a published contract: the JSON Schemas under `docs/schemas/` and the `describe` manifest are consumed externally, so changing a shape means updating the schema in the same change.

### ERRORS THAT REACH THE CLI SURFACE ARE `CliError`

Use `CliError` with a documented `ErrorCode` from `src/lib/errors.ts`; `src/index.ts` catches through `emitError` + `exitCodeFor`. A raw `throw` bypasses both the exit-code mapping and the format-aware error output.

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

CI gates in order: type-check → tests → build → `npm audit` (high+). Run the first three locally before pushing.

## Conventions

- **Tests are co-located**: `foo.test.ts` sits next to `foo.ts`. There is no `tests/` directory.
- **Named exports only** — no default exports outside `src/index.ts`.
- **Local imports carry a `.js` suffix** (`./commands/login.js`) even though the files are `.ts`.
- **New code placement**: a top-level command → `src/commands/` + registration in `src/index.ts`; a new Oura endpoint → row type in `src/api/types.ts`, optional cache table in `src/db/schema.ts`, command via the factory in `src/commands/api-command.ts`; a helper → `src/lib/`. Avoid bucket files.
- **One change per PR**, with a test for any behaviour change and a `CHANGELOG.md` bullet under `## [Unreleased]`.

## Repo Notes

- `assets/*.gif` is **Git LFS**-tracked; run `git lfs install` once per clone or the demo is a pointer stub. Regenerating it needs VHS — see CONTRIBUTING.md.
- `docs/loops/*-state.md` are memory files for scheduled agent loops, not documentation. Update the state file in the same run that produced the finding, and don't claim a blocker is resolved without evidence.
