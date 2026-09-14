# CLAUDE.md

This file is the list of mistakes agents and people have actually made in this repo that nothing yet prevents. Every line names the mistake and where it happened; when a test or CI step comes to catch one, its line goes. If something here surprises or confuses you, say so in the PR description or open an issue instead of working around it: that is how this list grows and shrinks. What the repo is and how to run it: README.md, CONTRIBUTING.md, `package.json` scripts.

- **The `oura-cli` on PATH is the npm package, not this checkout.** `bun run dev` runs the sources; if a change has no effect, check which one ran.
- **Tag the merge commit GitHub reports**, never local `HEAD` or `origin/main`: a rebase-merge rewrites the SHA and `origin/main` moves when the next PR lands. A published version is permanent: on failure fix forward with a new patch version, never re-tag. Exact command: CONTRIBUTING.md, "Releasing (maintainers)".
- **Commit `bun.lock` with any dependency change.** A lockfile behind `package.json` fails CI at install, before any test runs (#15, #16).
- **JSON-only is deliberate** for `describe`, `manifest`, `healthcheck` and `fetch`, and `login` is interactive text. Don't "fix" them. Every other user-facing data command needs both a JSON and a table mode.
- **A new command is registered twice**, in `src/commands/registry.ts` and in `SUBCOMMANDS` in `src/lib/argv-normalize.ts`, or `oura-cli --format json <cmd>` silently ignores the flag: citty does not hoist root flags onto subcommands, the normalizer does. The contract test names the mismatch. A new global flag goes into `GLOBAL_FLAGS_WITH_VALUE` / `GLOBAL_FLAGS_BOOLEAN` in the same file.
- **Every Oura API field is nullable until proven otherwise.** #23 retyped `day_summary`, `label` and `type` after the upstream spec drifted.
- **Errors that reach the user are `CliError`** with a code from `src/lib/errors.ts`. The runner in `src/commands/run-command.ts` wraps a `dataCommand`; `login` has its own catch and let a raw `EISDIR` through (#149).
- **A new test must fail under a one-line mutation** of the code it pins; reviews mutate the code to check, and have found tests that survived it. One logical change per commit with a `CHANGELOG.md` bullet under `[Unreleased]`; related issues may share a PR, one commit per issue; `main` takes PRs only.
- **`assets/*.gif` is Git LFS.** Run `git lfs install` once per clone or the demo is a pointer stub.
- **`docs/loops/*-state.md` are memory for scheduled agent loops**, not documentation. Update the state file in the run that produced the finding, and never claim a blocker resolved without evidence.
