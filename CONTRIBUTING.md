# Contributing to oura-cli

Thanks for considering a contribution. This document covers what we need from you to keep things moving.

## Local setup

```bash
git clone https://github.com/drakulavich/oura-cli
cd oura-cli
bun install
bun test          # all tests should pass before you start
```

Runtime: [Bun](https://bun.sh/) >= 1.0. No Node.js fallback yet.

## Pull request expectations

- **One change per PR.** Bug fixes, features, and refactors get their own branches.
- **Tests required.** A PR that adds or changes behaviour must add a test. We use `bun test` with co-located `*.test.ts` files next to the modules they cover.
- **Match existing patterns.** New commands go under `src/commands/`; new library helpers under `src/lib/`. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the dependency rules.
- **CHANGELOG entry.** Add a bullet under `## [Unreleased]` in `CHANGELOG.md` describing the user-visible change. Follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) categories (Added / Changed / Fixed / Removed / Security).

## Style

- TypeScript strict mode is on; `bun test` and `bunx tsc --noEmit` should pass.
- Prefer named exports. No default exports outside of `src/index.ts`.
- Errors that reach the CLI surface should be `CliError` instances with a documented `ErrorCode`.
- Output: JSON for agent/pipe contexts, table/text for TTY. Both modes are mandatory for new user-facing commands.

## Releasing

Releases are tagged manually (auto-release is planned, see audit #15):

1. Bump `package.json` version and `VERSION` constant in `src/index.ts`.
2. Add a `## [x.y.z] - YYYY-MM-DD` section to `CHANGELOG.md`.
3. `bun test && bun run build`.
4. `git tag vx.y.z && git push origin main vx.y.z`.
5. `npm publish --access public`.

## Reporting bugs

Open an issue at <https://github.com/drakulavich/oura-cli/issues>. Include:

- `oura-cli --version`
- OS and Bun version
- Minimal command that reproduces, with full output (redact your token first)
- Expected vs actual

## License

By contributing, you agree that your work will be released under the MIT License.
