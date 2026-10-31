## ADDED Requirements

### Requirement: Summary lines fit a 60-column terminal

In the table Output mode on a TTY of at least 60 columns, every line that `db trends` prints, and every line of the averages and recommendations that `report` prints, SHALL be no wider than the terminal, so that Quinn reads them in a narrow pane without wrapped rows. A line that is still wider than a narrower terminal MAY wrap, as it does today.

#### Scenario: Trend rows at 60 columns
- **GIVEN** a Local cache whose trends have a three-digit day count, such as `db trends --days 120`
- **WHEN** Quinn runs `oura-cli db trends` on a 60-column TTY
- **THEN** no line is wider than 60 characters
- **AND** the `avg`, `min` and `max` columns still line up from row to row

#### Scenario: A report average wider than the screen
- **GIVEN** a `report` whose Steps line reads `Steps        8,752 ↓ -2,114  (min: 172, max: 15,524, 5 days)`, 62 characters
- **WHEN** Quinn runs `oura-cli report` on a 60-column TTY
- **THEN** the value and the change stay on the Steps line, and `(min: 172, max: 15,524, 5 days)` goes on the next line, indented under the value
- **AND** at 80 columns the same average stays on one line, as before

#### Scenario: A recommendation wider than the screen
- **WHEN** a `report` on a 60-column TTY recommends `Low readiness — possible sleep debt. Prioritize recovery.`
- **THEN** the bullet wraps between words, and its continuation lines start under the text after `• `

#### Scenario: Not a TTY
- **WHEN** Marcus pipes `oura-cli report --format table` into a file
- **THEN** no line is wrapped, because a pipe has no width

### Requirement: JSON-only commands refuse the table Output mode

`describe`, `manifest`, `healthcheck` and `fetch` SHALL refuse `--format table` with a `CliError` whose `ErrorCode` is `BAD_ARGS`, exiting 1. The hint SHALL say that the command prints JSON only and that `--format json`, or no `--format` at all, is accepted. Without this, Aria and Marcus cannot tell that the output mode they asked for was ignored.

#### Scenario: describe with --format table
- **WHEN** Aria runs `oura-cli describe --format table`
- **THEN** stdout is empty, the exit code is 1, and stderr carries the `BAD_ARGS` envelope with that hint

#### Scenario: The same command with --format json or no --format
- **WHEN** Aria runs `oura-cli describe --format json`, or `oura-cli describe` on a TTY
- **THEN** the JSON contract prints and the exit code is 0, as today

#### Scenario: fetch with --format table
- **WHEN** Marcus runs `oura-cli fetch sleep --format table`
- **THEN** the exit code is 1 with `BAD_ARGS`, before any request to the Oura Cloud API

#### Scenario: An unknown format value
- **WHEN** Aria runs `oura-cli manifest --format yaml`
- **THEN** the existing `Unknown --format value: "yaml".` refusal is unchanged
