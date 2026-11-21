# Local application dependencies

This folder is for optional **portable executables**, separate from your accounting data.

- `node/win-x64/vVERSION/node.exe` — locally bundled Node.js, activated by `node/win-x64/active.txt`
- `hledger/win-x64/vVERSION/hledger.exe` — locally bundled hledger, activated by `hledger/win-x64/active.txt`
- `git/` — reserved for a possible future bundled Git distribution (currently use Git from PATH or GIT_BIN)

The Windows updater in `../scripts/update-runtime.ps1` downloads pinned official
binaries, validates the approved SHA-256 and activates the selected version only
after the running server is stopped. Untrusted or unverified binaries should never
be placed here. Nothing in `data/` is your finance workspace.

Actual financial data defaults to Documents/hledger-finances outside __hledgerui.
See the repository README for changing HLEDGER_WORKSPACE and build instructions.
