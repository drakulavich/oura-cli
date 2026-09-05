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
2. Create `src/collections/<name>.ts` with `defineCollection<Row>({ … })` and add it to `COLLECTIONS`. Set `rangeParams` to `'date'` unless the endpoint is a timeseries taking `start_datetime`/`end_datetime` (check the OpenAPI spec at `https://cloud.ouraring.com/v2/static/json/openapi-1.37.json`).
3. Append a migration to `src/db/migrations.ts` creating the table (never edit an existing entry).
4. Run `bun run schemas` and commit the new `docs/schemas/<name>.json`.
5. `bun test` — the equivalence, registry and schema-drift tests must pass. `fetch <name>`, `sync`, `describe` and `manifest` pick it up automatically.

## Adding a command

Create it in `src/commands/` with `dataCommand`, register it in `src/index.ts`, and add its name to `SUBCOMMANDS` in `src/lib/argv-normalize.ts` (citty does not hoist root flags onto subcommands; that normaliser does). `describe` and `manifest` are generated from the registered tree and need no edit. Update `src/commands/__snapshots__/describe.test.ts.snap` via `bun test -u` and review the diff.

## Output contract

JSON shapes are a published contract: `docs/schemas/*.json` (per-collection files are generated), `describe`, exit codes 0/1/2/3/4. Changing a shape means changing the schema in the same PR.
