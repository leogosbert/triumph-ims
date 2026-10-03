#!/usr/bin/env bash
# Prints an image as numbered base64 chunks in check annotations (max 10 per step),
# so the PDF layout can be reviewed without downloading build artifacts.
set -euo pipefail
f="$1"
[ -f "$f" ] || { echo "no $f"; exit 0; }
b64=$(base64 -w0 "$f")
size=3000
n=$(( (${#b64} + size - 1) / size ))
if [ "$n" -gt 10 ]; then echo "::warning title=preview $f::too large ($n chunks)"; exit 0; fi
for ((i=0; i<n; i++)); do
  echo "::notice title=preview $f $((i+1))/$n::${b64:$((i*size)):$size}"
done
