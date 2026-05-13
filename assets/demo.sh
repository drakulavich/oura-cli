#!/usr/bin/env bash
# Drives the oura-cli README screencast.
# Re-runs every command for real; pv-rate-limited output simulates typing.
# Invoked by: asciinema record --command "bash assets/demo.sh" assets/demo.cast

set -u

PS1_PROMPT="$ "
TYPE_RATE=10        # bytes/sec ≈ 100ms per char (deliberate, human pace)
PRE_ENTER_PAUSE=0.4 # tiny beat after the command is fully typed, before Enter
INTRO_PAUSE=1.5     # let the viewer orient on the empty prompt before anything types

run() {
  local cmd="$1"
  local pause_after="${2:-1.5}"
  printf "%s" "$PS1_PROMPT"
  printf "%s" "$cmd" | pv -qL "$TYPE_RATE"
  sleep "$PRE_ENTER_PAUSE"
  printf "\n"
  eval "$cmd"
  sleep "$pause_after"
}

sleep "$INTRO_PAUSE"

# Each command's output is held for 4 seconds before the next one starts.
run "oura-cli --version"                       4
run "oura-cli db today"                        4
run "oura-cli db week"                         4
run "oura-cli report"                          4
run "oura-cli describe | jq '.commands[].name'" 4

# closing breath
sleep 2.5
