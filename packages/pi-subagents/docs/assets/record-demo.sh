#!/usr/bin/env bash
# Re-record the README demo (demo.webp) and widget still (widget.png).
#
# Requires: vhs, ffmpeg, img2webp (brew install vhs ffmpeg webp), and a logged-in pi.
# Run from the repo root. The recording drives a real pi session against a
# real model, so each run spends tokens and produces slightly different output.
#
# PI_DEMO_ARGS carries extra pi flags, e.g. an auth extension the demo session
# needs because the tape runs with --no-extensions:
#   PI_DEMO_ARGS="-e ~/.pi/agent/npm/node_modules/@gotgenes/pi-anthropic-auth/src/index.ts" \
#     packages/pi-subagents/docs/assets/record-demo.sh
#
# The animation is built from vhs's lossless PNG frames rather than its GIF, so no
# frame passes through a 256-colour palette, and is encoded lossless: lossy WebP
# smears halos around terminal text.
set -euo pipefail

assets=packages/pi-subagents/docs/assets
tape="$assets/demo.tape"
frames="$assets/frames" # the tape's Output directory
work=$(mktemp -d /tmp/pi-demo.XXXXXX) # short: transcript paths show up on screen
trap 'rm -rf "$work" "$frames"' EXIT

rm -rf "$frames"
PI_DEMO_ARGS="${PI_DEMO_ARGS:-}" PI_DEMO_SESSIONS="$work/sessions" vhs "$tape"

setting() { awk -v key="$1" '$1 == "Set" && $2 == key { print $3 }' "$tape"; }
fps=$(setting Framerate)
width=$(setting Width)
height=$(setting Height)
frame_ms=$((1000 / fps))

# vhs splits each frame into an opaque text layer and a transparent cursor layer, and
# applies its padding only when it encodes. Recompose both, padding out to the tape's
# Width x Height with the theme background sampled from the text layer, so the frames
# match the Screenshot still.
first="$frames/frame-text-00001.png"
bg=$(ffmpeg -v error -i "$first" -vf crop=1:1:0:0 -f rawvideo -pix_fmt rgb24 - | xxd -p)
mkdir "$work/composed"
ffmpeg -v error -framerate "$fps" -i "$frames/frame-text-%05d.png" \
  -framerate "$fps" -i "$frames/frame-cursor-%05d.png" \
  -filter_complex "[0][1]overlay,pad=$width:$height:(ow-iw)/2:(oh-ih)/2:color=0x$bg" \
  "$work/composed/%05d.png"

# Collapse each run of identical frames into one frame that lasts the whole run.
args=()
prev_hash=""
prev_frame=""
run=0
for frame in "$work"/composed/*.png; do
  hash=$(md5 -q "$frame")
  if [[ $hash == "$prev_hash" ]]; then
    run=$((run + 1))
    continue
  fi
  if [[ -n $prev_frame ]]; then
    args+=(-d "$((run * frame_ms))" "$prev_frame")
  fi
  prev_hash=$hash
  prev_frame=$frame
  run=1
done
args+=(-d "$((run * frame_ms))" "$prev_frame")

img2webp "${args[@]}" -o "$assets/demo.webp"
echo "frames: $(find "$work/composed" -name '*.png' | wc -l | tr -d ' ') recorded, $((${#args[@]} / 3)) distinct"
ls -l "$assets/demo.webp" "$assets/widget.png"
