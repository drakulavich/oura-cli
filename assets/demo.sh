#!/usr/bin/env bash
# Drives the oura-cli README screencast.
# Re-runs every command for real; pv-rate-limited output simulates typing.
# Invoked by: asciinema record --command "bash assets/demo.sh" assets/demo.cast

set -u

PS1_PROMPT="$ "
TYPE_RATE=16   # bytes/sec ≈ 60ms per char (matches VHS TypingSpeed)

run() {
  local cmd="$1"
  local pause_after="${2:-1.5}"
  printf "%s" "$PS1_PROMPT"
  printf "%s" "$cmd" | pv -qL "$TYPE_RATE"
  printf "\n"
  eval "$cmd"
  sleep "$pause_after"
}

# 1. orient
run "oura-cli --version" 1.2

# 2. today
run "oura-cli db today" 2.5

# 3. weekly cache view
run "oura-cli db week" 3.5

# 4. hero: narrative report
run "oura-cli report" 6.0

# 5. agent-friendly manifest
run "oura-cli describe | jq '.commands[].name'" 3.0

# trailing breath
sleep 0.8
