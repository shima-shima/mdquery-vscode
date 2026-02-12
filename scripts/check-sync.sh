#!/bin/bash
# Check that core logic files are in sync with the web app.
# Usage: ./scripts/check-sync.sh [path-to-mdquery-web]
set -e

WEB_ROOT="${1:-../mdquery-web}"
VSC_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

FILES="markdown-parser.ts query-filter.ts"
OK=true

for f in $FILES; do
  WEB_FILE="$WEB_ROOT/src/lib/$f"
  VSC_FILE="$VSC_ROOT/src/lib/$f"

  if [ ! -f "$WEB_FILE" ]; then
    echo "⚠  Web file not found: $WEB_FILE"
    continue
  fi

  if diff -q "$WEB_FILE" "$VSC_FILE" > /dev/null 2>&1; then
    echo "✅ $f is in sync"
  else
    echo "❌ $f is OUT OF SYNC"
    diff --stat "$WEB_FILE" "$VSC_FILE" || true
    OK=false
  fi
done

if [ "$OK" = false ]; then
  echo ""
  echo "To sync: cp $WEB_ROOT/src/lib/{markdown-parser,query-filter}.ts $VSC_ROOT/src/lib/"
  exit 1
fi

echo ""
echo "All core files in sync."
