# vhs tape for the README demo — run it through ./record-demo.sh, not directly.
# The script supplies PI_DEMO_ARGS and PI_DEMO_SESSIONS, assembles the PNG frames into
# demo.webp, and removes the frames directory (only an Output line can write frames).

Output "packages/pi-subagents/docs/assets/frames/"

Require pi

Set Shell "bash"
Set FontFamily "Menlo"
Set FontSize 15
Set Width 1500
Set Height 860
Set Padding 20
Set CursorBlink false
Set Framerate 20
Set Theme "Catppuccin Macchiato"
Set TypingSpeed 15ms

Hide
Type 'clear && pi --no-extensions -e ./packages/pi-subagents/src/index.ts $PI_DEMO_ARGS -nc -ns -np --model anthropic/claude-haiku-4-5 --thinking off --session-dir "$PI_DEMO_SESSIONS"'
Enter
Sleep 6s
Show

Type "Spawn six background Explore subagents in parallel, one call each, all in this turn: find TODO comments, count TypeScript files per package, summarize the root README, list every package's npm name, map the CI workflow jobs, and find the largest test file. Never call get_subagent_result; answer each completion notice in one short line."
Sleep 500ms
Enter

Sleep 21s
Screenshot "packages/pi-subagents/docs/assets/widget.png"
Sleep 29s

Type "/subagents:sessions"
Sleep 800ms
Enter
Sleep 2s
Down
Sleep 600ms
Down
Sleep 600ms
Enter
Sleep 3s
Down@150ms 12
Sleep 1s
PageDown
Sleep 2s
PageDown
Sleep 2s
Escape
Sleep 2s

Hide
Ctrl+C
Ctrl+C
