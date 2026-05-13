# oura-cli README screencast
# Regenerate with: vhs assets/demo.tape
# Requires: vhs >= 0.7 (brings ttyd + ffmpeg), Chromium

Output assets/demo.gif

Set Shell "bash"
Set FontSize 22
Set Width 1500
Set Height 940
Set Theme "Catppuccin Mocha"
Set TypingSpeed 100ms
Set Padding 24

Sleep 1500ms

Type "oura-cli --version"
Sleep 400ms
Enter
Sleep 4000ms

Type "oura-cli db today"
Sleep 400ms
Enter
Sleep 4000ms

Type "oura-cli db week"
Sleep 400ms
Enter
Sleep 4000ms

Type "oura-cli report"
Sleep 400ms
Enter
Sleep 4000ms

Type "oura-cli describe | jq '.commands[].name'"
Sleep 400ms
Enter
Sleep 4000ms

Sleep 1500ms
