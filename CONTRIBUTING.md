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

- TypeScript strict mode is on; `bun test` and `bunx tsgo --noEmit` should pass. `tsgo` is the native Go-based TypeScript 7 compiler from `@typescript/native-preview`.
- Prefer named exports. No default exports outside of `src/index.ts`.
- Errors that reach the CLI surface should be `CliError` instances with a documented `ErrorCode`.
- Output: JSON for agent/pipe contexts, table/text for TTY. Both modes are mandatory for new user-facing commands.

## Regenerating the demo

The README screencast at `assets/demo.webm` is generated from a checked-in
[VHS](https://github.com/charmbracelet/vhs) script. After a CLI surface change
(renamed commands or flags, altered output format), regenerate it:

```bash
brew install vhs                       # one-time; pulls in ttyd + ffmpeg
brew install --cask chromium           # one-time; VHS drives a headless browser
xattr -dr com.apple.quarantine /Applications/Chromium.app  # macOS only
oura-cli sync                          # fresh data in the local cache
unset OURA_TOKEN                       # don't let an env token leak into the recording
vhs assets/demo.tape                   # writes assets/demo.webm
```

Keep the recording under 40 seconds and the file under 2 MB. The tape
deliberately omits `login` and `sync` — the demo focuses on what a first-time
user reads, not what they type to set up.

## Releasing (maintainers)

Releases are tag-driven now (per audit #15):

1. Bump `package.json` version and `VERSION` constant in `src/index.ts`.
2. Add a `## [x.y.z] - YYYY-MM-DD` section to `CHANGELOG.md`.
3. Commit, then `git tag vx.y.z && git push origin main vx.y.z`.
4. The `release.yml` workflow runs tests, publishes to npm (with provenance), and creates a GitHub Release whose body is the matching CHANGELOG section.

If the workflow fails, fix forward — the published version is permanent. Do not re-use a tag.

The `NPM_TOKEN` secret must be configured in GitHub repo settings (Settings → Secrets and variables → Actions). Generate at https://www.npmjs.com/settings/[user]/tokens with type "Automation" and publish scope.

## Reporting bugs

Open an issue at <https://github.com/drakulavich/oura-cli/issues>. Include:

- `oura-cli --version`
- OS and Bun version
- Minimal command that reproduces, with full output (redact your token first)
- Expected vs actual

## License

By contributing, you agree that your work will be released under the MIT License.
