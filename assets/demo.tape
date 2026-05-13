# oura-cli README screencast
# Regenerate with: vhs assets/demo.tape
# Requires: vhs >= 0.7 (brings ttyd + ffmpeg)

Output assets/demo.webm

Set Shell "bash"
Set FontSize 14
Set Width 960
Set Height 600
Set Theme "Catppuccin Mocha"
Set TypingSpeed 60ms
Set Padding 16

# 1. orient the viewer
Type "oura-cli --version"
Sleep 400ms
Enter
Sleep 1200ms

# 2. today's summary (colour)
Type "oura-cli db today"
Sleep 400ms
Enter
Sleep 2500ms

# 3. weekly cache view (v0.3.4 column-alignment fix is visible here)
Type "oura-cli db week"
Sleep 400ms
Enter
Sleep 3500ms

# 4. hero: full narrative weekly report
Type "oura-cli report"
Sleep 400ms
Enter
Sleep 6000ms

# 5. agent-friendly manifest
Type "oura-cli describe | jq '.commands[].name'"
Sleep 400ms
Enter
Sleep 3000ms

Sleep 800ms
