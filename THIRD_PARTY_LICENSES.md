# Third-party runtimes in optional portable releases

Portable Windows builds download and include unmodified executable binaries from the respective upstream projects. These binaries are **not** committed to this application's source repository.

- **Node.js**, Node.js contributors: https://nodejs.org/ ; release archive `node-v24.22.3-win-x64.zip` from https://nodejs.org/dist/v24.22.3/ . Runtime copyright/licensing terms: https://github.com/nodejs/node/blob/main/LICENSE . The portable builder copies the upstream LICENSE alongside the binary when present.
- **hledger**, Simon Michael and contributors: https://hledger.org/ ; version 1.52.4 release archive from https://github.com/hledgerorg/hledger/releases/tag/1.52.4 . hledger's licensing terms are documented in the upstream project and the application's GPL-3.0 license file.
- Exact approved archive versions, URLs and SHA-256 checksums are recorded in `runtime-manifest.json`. Verify them independently when updating the manifests.

Runtime binaries are optional and updated independently. See README for the exact update/activation procedure. Personal financial data should be kept outside the application directory.

- **Git for Windows / MinGit**, Git for Windows contributors: https://gitforwindows.org/ and https://github.com/git-for-windows/git . Optional Windows x64 MinGit ZIP v2.56.1.windows.1 is distributed under Git's applicable GPL-2.0 and bundled third-party licences. The complete MinGit tree (not just git.exe) is copied into portable distributions. Official archive SHA-256: 4a92850b6e917da4fd010669b614b55dccf5b0ec333a534cc4be4700dfefdafd. See upstream licence documents included with the MinGit distribution.
