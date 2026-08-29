#!/bin/bash
# Concatenate src/ into a single self-contained index.html.
# The Artifact host wraps the output in <!doctype html><head>…</head><body>,
# so this file deliberately contains no <html>/<head>/<body> tags.
set -euo pipefail
cd "$(dirname "$0")"

OUT=index.html
{
  cat src/00-head.html
  cat src/10-body-a.html
  cat src/11-body-b.html
  cat src/12-body-c.html
  cat src/13-body-d.html
  echo '<script>'
  cat src/50-core.js
  cat src/60-ui.js
  echo '</script>'
} > "$OUT"

# dev.html is index.html inside the skeleton the Artifact host supplies, so the
# page can be opened directly in a browser during development.
{
  printf '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n'
  printf '<style>*,*::before,*::after{box-sizing:border-box}body{margin:0}</style>\n</head>\n<body>\n'
  cat "$OUT"
  printf '\n</body>\n</html>\n'
} > dev.html

printf 'built %s — %s bytes, %s lines (+ dev.html for local preview)\n' "$OUT" "$(wc -c < "$OUT" | tr -d ' ')" "$(wc -l < "$OUT" | tr -d ' ')"
