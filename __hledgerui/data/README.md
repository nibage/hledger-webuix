# Optional portable program components and local preferences

Each Windows x64 runtime has a separate versioned directory:

- `node/win-x64/vVERSION/node.exe` (Node.js and its sibling files)
- `hledger/win-x64/vVERSION/hledger.exe` (hledger and its helpers)
- `git/win-x64/vVERSION/cmd/git.exe` (entire MinGit layout, including dependencies)

An `active.txt` in each component's `win-x64/` selects the bundled release.
`preferences.json` keeps user choices for system/bundle/custom source,
and `node-mode.txt` and `node-path.txt` let start.bat select Node.js before
the server starts. `profiles.json` points to named finance workspaces.

**Private finance files do not belong here.** Profiles use a separate folder
outside the application, typically in your Documents directory.
Preferences, downloaded runtimes and private profiles.json are ignored by the
source repository. The portable ZIP packager excludes private settings.

Runtime update scripts are in `../scripts/`. ZIP downloads are checked against
the approved SHA-256 digests before activation. Updating Node.js takes effect
at the *next* app start; old version directories are not automatically deleted.
