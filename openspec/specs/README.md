# oura-cli — Baseline Specifications

This directory is the **baseline spec corpus**: it captures how oura-cli *actually
behaves today*, one capability per directory, so future work can be proposed as
OpenSpec change deltas against a trustworthy reference instead of tribal knowledge.

> **Disclaimer (living document).** These specs describe the current release and
> are updated whenever behavior changes. If a spec and the code disagree, the code
> is the bug *or* the spec is stale — either way, open an issue; don't silently
> trust one side.

> **Status.** The corpus is being established. Capabilities are extracted into
> `specs/<name>/spec.md` as they are written; the table below lists the planned
> set and links each one once its spec lands. Until then, `README.md`,
> `CONTRIBUTING.md`, and `docs/ARCHITECTURE.md` are the closest record.

## How to read these specs

Every spec follows the same shape:

- **Purpose** — what the capability does and for whom.
- **Non-Goals** — what it deliberately does *not* do (so nobody "fixes" that).
- **Requirements** — verifiable contracts (`SHALL`), each with at least one
  happy-path and one error/edge **Scenario** in Given/When/Then form.
- **Technical Notes** — constants, tables, and `file:line` traceability refs,
  kept out of the requirement text so contracts stay readable.
- **Open Issues** — known gaps, tracked by GitHub issue where one exists.

Terminology is canonical: every term of art (Local cache, PAT, Data type,
`CliError`, …) is defined once in [GLOSSARY.md](GLOSSARY.md) and used verbatim
everywhere else.

## Personas

Specs reference these named personas instead of a generic "user":

- **Quinn, the quantified-self user** — runs `oura-cli sync` then `report` to
  track their own sleep and readiness in the terminal. Cares about offline reads,
  accurate digests, and that the Personal Access Token never leaves the local
  `~/.oura-token` file (0600).
- **Marcus, the data scripter** — pipes `oura-cli … --json` into `jq`, plots, and
  his own scripts. Cares about stable JSON output, the TTY-vs-pipe output switch,
  and documented exit codes.
- **Aria, the agent author** — drives oura-cli from an LLM agent via the
  `manifest` / `healthcheck` / `describe` surface (OpenClaw consumes the manifest's
  tool-registry shape). Cares about the machine-readable manifest, structured
  `CliError` codes, and the describe contract.

## Capabilities

| Spec | Covers |
|---|---|
| auth | `login`: storing and reading the Personal Access Token (`~/.oura-token`, 0600) |
| sync | `sync`: backfilling Oura Cloud API data into the Local cache |
| query | `db`: reading cached data by day/range/Data type |
| report | `report`: weekly/monthly digest with averages and trend deltas |
| output-contract | JSON-off-TTY / table-on-TTY switch, exit codes, `CliError`/`ErrorCode` |
| agent-surface | `manifest`, `healthcheck`, `describe`, `api-command`, OpenClaw skill |

*(Links are added as each `spec.md` is written; rows without a link are not yet
extracted — see Status above.)*

## Validation

```bash
openspec spec list                    # enumerate capabilities
openspec validate --specs --strict    # structural validation — must exit 0
```

These commands require the standalone **OpenSpec CLI** — a global developer tool
installed separately, not an oura-cli dependency. The specs themselves are plain
Markdown and reviewable without it.
