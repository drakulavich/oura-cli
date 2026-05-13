# Flakiness Report integration

Runs `bun test` with the JUnit reporter, transforms the XML into a
spec-conformant [Flakiness JSON Report][spec], and (optionally) uploads it to
[flakiness.io][site]. The report is validated against the upstream Zod
schema (`@flakiness/flakiness-report`) before being written.

[spec]: https://github.com/flakiness/flakiness-report
[site]: https://flakiness.io

## Why this lives here

There is no first-party `bun:test` reporter from flakiness.io because
`bun:test` doesn't expose a custom-reporter plugin API yet. Until it does,
`--reporter=junit` is the most stable structured interface Bun ships, so we
generate the Flakiness JSON downstream of that. If/when Bun gains a real
reporter API, replace `junit-to-flakiness.ts` with a direct emitter — the
JSON shape stays the same.

## Local usage

```bash
bun run test:flakiness
# → flakiness-report/report.json    (Zod-validated)
# → flakiness-report/_junit.xml     (intermediate, not for upload)
# → flakiness-report/attachments/   (empty for now; spec requires the dir)
```

The script propagates the `bun test` exit code, so a red suite still produces
the artifact. The `flakiness-report/` directory is gitignored.

## Environment variables

| Var | Effect |
|-----|--------|
| `FLAKINESS_PROJECT` | Sets `flakinessProject` in the report (e.g. `drakulavich/oura-cli`). Required for upload attribution. |
| `FLAKINESS_ACCESS_TOKEN` | If set (and `FLAKINESS_DISABLE_UPLOAD` is unset), the runner shells out to `@flakiness/cli upload` after writing the report. |
| `FLAKINESS_DISABLE_UPLOAD` | Skips the upload step regardless of token presence. |
| `FLAKINESS_OUTPUT_DIR` | Override the default `flakiness-report/` output directory. |
| `FLAKINESS_TITLE` | Free-form run title shown in flakiness.io. |
| `GITHUB_SHA`, `GITHUB_SERVER_URL`, `GITHUB_REPOSITORY`, `GITHUB_RUN_ID` | Auto-detected in GitHub Actions to populate `commitId` and `url`. |

## CI

The `Test + flakiness report` step in `.github/workflows/ci.yml` runs this
tool, and the next step uploads `flakiness-report/` as a workflow artifact
(retained 30 days). Adding `FLAKINESS_ACCESS_TOKEN` to the repo secrets is
enough to start syncing runs to flakiness.io — no other code changes needed.

## Regenerating the fixture

If `bun test --reporter=junit` ever changes its XML shape, refresh the
fixture:

```bash
# Write a temporary scratch test that has one pass + one fail + one skip,
# then capture the XML and discard the source so CI isn't impacted.
bun test path/to/scratch.test.ts \
  --reporter=junit \
  --reporter-outfile=tools/flakiness/fixtures/junit-sample.xml
```

Tests in `junit-to-flakiness.test.ts` read this fixture directly, so they
fail loudly on schema drift.

## What's NOT covered

- **Steps** (`RunAttempt.steps`) — Bun's JUnit output has no step events.
- **Retries** — Bun runs each test once unless retry mode is on.
- **CPU / RAM telemetry** — orthogonal to the JUnit bridge.
- **Sources / error snippets** — Bun's `<failure>` currently emits only
  `type` (no message, no stack, no snippet). We surface the `type` string
  as the error message; richer mapping needs a Bun reporter API.
