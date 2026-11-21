#!/usr/bin/env sh
set -eu

cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"

if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' 'please install node.js' '1. Visit https://nodejs.org/en/download' '2. Install Node.js LTS (version 20 or newer).' '3. Open a new terminal, check node --version, and rerun ./start.sh.' >&2
  exit 1
fi
if ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)' >/dev/null 2>&1; then
  printf '%s\n' 'please install node.js 20 or newer (LTS recommended)' 'Download: https://nodejs.org/en/download' >&2
  exit 1
fi

: "${HLEDGER_WORKSPACE:=${HOME:-$PWD}/Documents/hledger-finances}"
printf 'Starting hledger-webuix with Node.js %s\n' "$(node --version)"
printf 'Workspace: %s\n' "$HLEDGER_WORKSPACE"
printf '%s\n' 'Keep this terminal open. Press Ctrl+C to stop.'
exec node "$PWD/server.js" --workspace "$HLEDGER_WORKSPACE" --open
