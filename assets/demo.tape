# oura-cli README screencast. Recorded against the synthetic cache from scripts/demo-fixture.ts,
# never a real account: the GIF is public. See CONTRIBUTING.md, "Regenerating the demo".
# Requires: vhs >= 0.7 (brings ttyd + ffmpeg), Chromium. Not vhs 0.12.0: it writes no file (vhs#787).

Output assets/demo.gif

Set Shell "bash"
Set FontSize 22
Set Width 1500
Set Height 940
Set Theme "Catppuccin Mocha"
Set TypingSpeed 50ms
Set Padding 24

# 1. orient the viewer
Type "oura-cli --version"
Sleep 300ms
Enter
Sleep 1000ms

# 2. health check: token, database, integrity, freshness (--offline: the fixture token is a placeholder)
Type "oura-cli doctor --offline"
Sleep 300ms
Enter
Sleep 3000ms

# 3. today's summary (colour, `*` marks a day still accumulating)
Type "oura-cli db today"
Sleep 300ms
Enter
Sleep 2500ms

# 4. weekly cache view
Type "oura-cli db week"
Sleep 300ms
Enter
Sleep 3000ms

# 5. hero: full narrative weekly report
Type "oura-cli report"
Sleep 300ms
Enter
Sleep 6000ms

# 6. trends over a window
Type "oura-cli db trends 14"
Sleep 300ms
Enter
Sleep 3000ms

# 7. cached rows of any collection, the local twin of `fetch`
Type "oura-cli db rows spo2 --days 7"
Sleep 300ms
Enter
Sleep 3000ms

# 8. agent-friendly manifest
Type "oura-cli describe | jq '.commands[].name'"
Sleep 300ms
Enter
Sleep 3000ms

Sleep 800ms
