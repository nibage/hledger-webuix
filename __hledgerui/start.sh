#!/usr/bin/env sh
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
NODE_EXE=node
if [ -r data/node-mode.txt ] && [ "$(cat data/node-mode.txt)" = custom ] && [ -r data/node-path.txt ]; then
  NODE_EXE=$(cat data/node-path.txt)
fi
if ! command -v "$NODE_EXE" >/dev/null 2>&1 && [ ! -x "$NODE_EXE" ]; then
  printf '%s\n' 'please install node.js' 'Download Node.js LTS: https://nodejs.org/en/download' >&2
  exit 1
fi
if ! "$NODE_EXE" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)' >/dev/null 2>&1; then
  printf '%s\n' 'please install node.js version 20 or newer' 'https://nodejs.org/en/download' >&2
  exit 1
fi
: "${HLEDGER_PORT:=8765}"
printf 'Opening http://127.0.0.1:%s/ after startup.\n' "$HLEDGER_PORT"
printf '%s\n' 'Closing the last application tab requests shutdown. Ctrl+C stops the server.'
if [ -n "${HLEDGER_WORKSPACE:-}" ]; then
  exec "$NODE_EXE" "$PWD/server.js" --workspace "$HLEDGER_WORKSPACE" --port "$HLEDGER_PORT" --open --close-on-tab-exit
else
  exec "$NODE_EXE" "$PWD/server.js" --port "$HLEDGER_PORT" --open --close-on-tab-exit
fi
