#!/usr/bin/env sh
set -eu

cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' 'please install node.js' '1. Visit https://nodejs.org/en/download' '2. Install Node.js LTS (20+).' '3. Start a new terminal and rerun ./start.sh.' >&2
  exit 1
fi
if ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)' >/dev/null 2>&1; then
  printf '%s\n' 'please install node.js version 20 or newer' 'Download LTS: https://nodejs.org/en/download' >&2
  exit 1
fi

: "${HLEDGER_WORKSPACE:=${HOME:-$PWD}/Documents/hledger-finances}"
: "${HLEDGER_PORT:=8765}"
printf 'Node.js %s\n' "$(node --version)"
printf 'Workspace: %s\n' "$HLEDGER_WORKSPACE"
printf 'Opening http://127.0.0.1:%s/ in your default browser after startup.\n' "$HLEDGER_PORT"
printf '%s\n' 'Keep this terminal open. Press Ctrl+C to stop.'
exec node "$PWD/server.js" --workspace "$HLEDGER_WORKSPACE" --port "$HLEDGER_PORT" --open
