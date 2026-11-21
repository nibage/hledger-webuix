# Third-party runtimes in optional portable releases

Portable Windows builds download and include unmodified executable binaries from the respective upstream projects. These binaries are **not** committed to this application's source repository.

- **Node.js**, Node.js contributors: https://nodejs.org/ ; release archive `node-v24.22.3-win-x64.zip` from https://nodejs.org/dist/v24.22.3/ . Runtime copyright/licensing terms: https://github.com/nodejs/node/blob/main/LICENSE . The portable builder copies the upstream LICENSE alongside the binary when present.
- **hledger**, Simon Michael and contributors: https://hledger.org/ ; version 1.52.4 release archive from https://github.com/hledgerorg/hledger/releases/tag/1.52.4 . hledger's licensing terms are documented in the upstream project and the application's GPL-3.0 license file.
- Exact approved archive versions, URLs and SHA-256 checksums are recorded in `runtime-manifest.json`. Verify them independently when updating the manifests.

Runtime binaries are optional and updated independently. See README for the exact update/activation procedure. Personal financial data should be kept outside the application directory.
