# hledger-webuix

A local-first web interface powered by the **real hledger CLI** and Git, for Windows and Linux.

This is a substantial rework of the original standalone HTML proof of concept. It is no longer a standalone file that reimplements accounting in JavaScript: the browser talks to a small local Node.js server that executes an installed `hledger` binary. This avoids silently losing unsupported journal syntax when saving and gives reports computed by hledger itself.

> **Early development release (webuix 0.2.2).** Do not rely on it as the only copy of important financial data. Test with an example journal first. This is not a certified tax/accounting solution. Compatibility with every hledger release and every journal feature has not been established.

## Quick start and folders

All runnable files live in `__hledgerui/`: `index.html`, `start.bat`, `start.sh`, `server.js`, `scripts/` and optional `data/node/`, `data/hledger/`, `data/git/`. Keep finance workspaces **outside** this folder.

```text
hledger-webuix/
├── __hledgerui/
│   ├── index.html
│   ├── start.bat
│   ├── start.sh
│   ├── server.js
│   ├── runtime-manifest.json
│   ├── scripts/
│   └── data/
│       ├── node/win-x64/vVERSION/node.exe
│       ├── hledger/win-x64/vVERSION/hledger.exe
│       ├── git/win-x64/vVERSION/cmd/git.exe
│       ├── preferences.json        # local; ignored by Git
│       └── profiles.json           # local; ignored by Git
├── tests/
└── README.md

Documents/
├── hledger-finances/               # Existing/default profile
└── hledger-finance-profiles/
    └── my-business/                # Named profile (e.g. 2026 journal and invoices)
```

On Windows, double-click **`__hledgerui/start.bat`**. On Linux, run `cd __hledgerui && ./start.sh`. The server opens the correct `http://127.0.0.1:8765/` address automatically (Chrome first on Windows when found, otherwise default browser). Set `HLEDGER_PORT` to override the port. Closing the last UI tab requests shutdown after a six-second grace period, but browser crashes, some navigation modes and external OS/browser conditions may prevent the close event; **Ctrl+C** in the server console remains the reliable shutdown method. Closing the console directly also terminates its attached server. If you have unsaved journal edits, save them before leaving the tab. Opening `index.html` as a file shows a launcher warning, not a usable UI.

**Overview** has a single Georgia-style title, compact workspace/profile cards and the full current accounting workspace directory and exact journal path. Year selection and the detected hledger and Node.js versions are in the persistent sidebar footer, not the top header. The **Accounting profile & folders** section creates independent named workspaces under your Documents folder, with their own year files, invoice folders and bank imports. Selecting another profile is saved for the **next** launch; it never moves existing data. If you explicitly set `HLEDGER_WORKSPACE`, that override takes precedence over the profile selected in the UI.

## Settings and runtime updates

**Settings** has separate Node.js, hledger and Git cards. Each shows running/detected versions and an already visible executable path, and has **Use system**, **Use bundle** and **Custom executable path** options. Selecting **Use system** pre-fills the executable found on PATH. **Use bundle** displays a path only when an activated bundled executable really exists; otherwise the input stays empty and explains that the bundle must first be installed. The expected installation destination is shown separately. **Save path / source** remains disabled when the mode and custom path are unchanged, or when a selected executable is unavailable. Custom paths are validated against each program's `--version` command. Node.js changes apply after restarting the launcher; running Node.js is never overwritten. Other component selections apply to subsequent commands.

On Windows x64, the three **Install / update bundle** buttons launch an asynchronous PowerShell updater. The **Command console**, visible at the bottom of every app page, shows invoked hledger/Git/script commands and streams updater stdout and errors. It does not require dismissing a browser confirmation or opening a separate PowerShell window. The logs are kept **only in memory** and may contain confidential financial paths and report contents. Avoid sharing them publicly without reviewing their content.

Updates are pinned in `__hledgerui/runtime-manifest.json`: Node.js **24.22.3**, hledger **1.52.4**, and Git for Windows **2.56.1** (MinGit ZIP). The updater downloads official HTTPS ZIPs, verifies each expected SHA-256, extracts full runtime directory contents into independent `__hledgerui/data/<component>/win-x64/vVERSION/` folders, verifies `--version`, and activates only the selected version. The previous version is retained. To change a pinned version, a maintainer must review its URL and hash and test compatibility. The updater can finish activation of an already extracted executable without downloading the ZIP again; this also repairs older installations where activation failed with a PowerShell `File.Replace` exception. Choosing **Use bundle** is blocked until the bundled executable is active.

For a manual installation without Node.js already installed, use PowerShell from the source repo:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\__hledgerui\scripts\update-runtime.ps1 -Component node
powershell -NoProfile -ExecutionPolicy Bypass -File .\__hledgerui\scripts\update-runtime.ps1 -Component hledger
powershell -NoProfile -ExecutionPolicy Bypass -File .\__hledgerui\scripts\update-runtime.ps1 -Component git
```

To build a Windows x64 portable ZIP: `powershell -NoProfile -ExecutionPolicy Bypass -File .\__hledgerui\scripts\build-portable-windows.ps1`, or manually trigger the **Build portable Windows ZIP** GitHub Actions workflow. The packager excludes personal profiles and preferences; it includes only the verified runtimes and program files. Linux portable downloads remain a separate future task.


**WinGet versus portable bundles:** `winget install` is useful for a **system installation** such as your existing hledger. It is not a reliable mechanism for installing and activating three independent, pinned, application-local runtimes inside `__hledgerui/data/`. Portable mode therefore downloads the **official upstream ZIPs directly** and verifies SHA-256, rather than invoking WinGet. To update a previously downloaded but unactivated runtime, click **Install / update bundle** again; the updater validates the existing binary and finishes `active.txt` activation. After the job completes, Settings automatically refreshes installed status and paths. If status retrieval fails, the error appears persistently in Settings rather than leaving indefinite “Checking…” placeholders.

## Windows: installing hledger without Scoop

First check whether Windows Package Manager is available in PowerShell: `winget --version`. It is supplied by Windows **App Installer** on most Windows 11 / recent Windows 10 installations. If available, run `winget search hledger`, then inspect the exact package/version before installing. For the UI's preliminary **1.52.x** CLI target, you can use the official release archive directly without any package manager:

```powershell
$dest = "$env:LOCALAPPDATA\Programs\hledger"
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Invoke-WebRequest "https://github.com/hledgerorg/hledger/releases/download/1.52.4/hledger-windows-x64.zip" -OutFile "$env:TEMP\hledger-windows-x64.zip"
Expand-Archive "$env:TEMP\hledger-windows-x64.zip" -DestinationPath $dest -Force
& "$dest\hledger.exe" --version
```

This follows the [official 1.52.4 release instructions](https://github.com/hledgerorg/hledger/releases/tag/1.52.4), with a user-local destination. Open the app, open **Settings → hledger → Custom executable path**, and enter the full path `C:\Users\YOUR_USER\AppData\Local\Programs\hledger\hledger.exe`. You do not need to edit `PATH` if you select **Custom executable path** in Settings and save the validated executable location. Newer hledger versions are not yet fully compatibility-tested against the UI.

The app also includes its own distinctive SVG favicon. Installed component versions and the year selector are shown in the sidebar footer, while the main header keeps only the section title and theme control. The scrollbar gutter is reserved to prevent horizontal shifts when switching tabs.

## Quick start

### One-click launchers (Windows and Linux)

- **Windows:** Double-click **`start.bat`** inside `__hledgerui/`. It checks whether Node.js (version 20+) is installed. If not, it displays **"please install node.js"**, a link to the official download, and short setup steps. Otherwise it starts the server and automatically opens the browser at **http://127.0.0.1:8765/** once the server is listening. Leave the console window open until you're done.
- **Linux:** Run `cd __hledgerui && chmod +x start.sh` once, then `./start.sh`. It performs the same Node.js check, starts the server and tries to open the browser with `xdg-open` (or `open` on macOS). If opening the browser fails, visit **http://127.0.0.1:8765/** manually.

By default, both launchers use a **private finance workspace**, separate from the program's source code:
- Windows: `%USERPROFILE%\\Documents\\hledger-finances`
- Linux: `~/Documents/hledger-finances`

Set `HLEDGER_WORKSPACE` before launching to choose another folder (for example in PowerShell, `$env:HLEDGER_WORKSPACE = 'D:\\Accounting'`). Launch scripts do **not** install Node.js, hledger or Git, and do **not** create accounting files until you explicitly choose **Create folders** in the UI.

### Install dependencies

Install:

- **Node.js 20+** ([nodejs.org](https://nodejs.org/))
- **hledger CLI** ([installation guide](https://hledger.org/install.html))
- **Git** (optional, for manual history)

On Windows, download the **Node.js LTS .msi** installer from [nodejs.org/en/download](https://nodejs.org/en/download), keep **Add to PATH** enabled, finish installation, open a new PowerShell and run `node --version` and `npm --version`.

The app opens even if hledger is missing. **Settings** shows the detected **Node.js, Git and hledger versions, executable paths and missing-component status**. The header also displays detected Node.js/hledger versions. If hledger is not on PATH, click **hledger path** in the header and enter the **absolute path to hledger.exe** (Windows) or `hledger` (Linux), then click **Save path & check**. Only a working executable whose `--version` output identifies it as hledger is accepted. The path is saved in the private workspace's `.webuix/settings.json` (ignored by Git). Use **Use auto-detect** to remove this override (auto-detect checks an explicit environment override, then bundled hledger, then PATH). No ledger file is changed by setting the executable.

The version display tells you what's installed, **not** that all versions are certified compatible. Only the preliminary hledger 1.52 CLI integration is currently targeted.

Ensure `node --version`, `hledger --version` (or a custom hledger path) and optionally `git --version` work. You can use the launchers above, or start from this repo manually:

```sh
node __hledgerui/server.js --workspace "/path/to/your-private-finances"
```

On Windows (PowerShell):

```powershell
node .\__hledgerui\server.js --workspace "C:\Users\YOU\Documents\finances"
```

Visit **http://127.0.0.1:8765**. The manual command will not auto-open your browser; use `--open` if desired. Click **Create folders** once to create the layout (existing files are never overwritten). Choose a year, edit the journal and click **Save & validate**. The browser displays the detected `hledger --version` in its header and uses `hledger` for all reporting.

This server binds **only to localhost**. There is no cloud service, no npm dependency, and no automatic Git push. Do not expose its port to other machines or the public internet. If `hledger` or Git are not on PATH, point the backend at a local executable with `HLEDGER_BIN` and/or `GIT_BIN` environment variables.

### Proposed finance workspace layout

The app repository and your personal accounting data should live **in separate directories**:

```text
finances/                         # PRIVATE: optional local Git repository
├── books/
│   ├── main.journal              # includes all year journals for opening balances
│   └── years/
│       ├── 2025/
│       │   └── transactions.journal
│       └── 2026/
│           └── transactions.journal
├── documents/
│   ├── 2025/
│   └── 2026/
│       ├── issued/               # outgoing invoices, PDF/XML
│       └── received/             # incoming invoices, PDF/XML
├── imports/
│   └── 2026/
│       ├── bank-a-czk/
│       │   └── statement-11.csv
│       └── bank-b-eur/
│           └── statement-11.csv
├── rules/
│   ├── bank-a.csv.rules
│   └── bank-b.csv.rules
├── automations/
│   ├── scripts.json
│   └── scripts/
│       ├── fetch-bank.py
│       └── export-report.js
└── .gitignore
```

The generated `books/main.journal` contains:

```hledger
include years/*/transactions.journal
```

This **single cumulative book** preserves balances from previous years (do not start the next year from zero). You can use multiple currencies, accounts and commodities in native hledger syntax, such as `450 CZK`, `-12 EUR`, or share holdings. For multi-currency transactions hledger may require appropriate balancing, cost, or conversion annotations; see the [hledger documentation](https://hledger.org/hledger.html). Invoices are supporting documents, not automatically booked transactions.

### Journal editing and safety

- The browser keeps an **unsaved draft in memory**. Typing never triggers a disk write. Navigate away or reload only after saving your changes.
- **Save & validate** writes to a temporary sibling file, runs `hledger -f <draft> check`, verifies the original file has not changed externally, replaces the selected year journal, and runs `hledger -f books/main.journal check`. If the full check fails, it restores the previous content.
- Comments, directives and formatting in the **selected year file** are preserved: unlike the original proof of concept, the application never regenerates the complete journal from its own partial parser.
- The UI uses a **raw journal editor**, plus a small transaction composer that *only appends to the unsaved draft*. This supports the full hledger syntax in the editor, but there is not yet an advanced visual per-transaction editor.
- Cross-process file locking and crash-proof transactional file replacement have **not** yet been implemented. Use one writer per finance workspace. A local Git commit is recommended before bulk edits.
- For complex journals, directives inherited from the main journal may cause the standalone draft validation to fail. The app errs on the side of refusing the save rather than silently rewriting data.

### Reports

Reports invoke the installed CLI (`balance`, `register`, `aregister`, `balancesheet`, `incomestatement`, `cashflow`, `print`, `accounts`, `prices`, `stats`, `check`, etc.). Monthly/quarterly/yearly periods are calculated **by hledger**, not by the browser. The report screen currently shows the CLI's text output. More graphical, interactive reports are planned.

**Supported hledger versions:** the initial integration is designed around the documented hledger 1.52 CLI and provides the version actually detected on your system. hledger 1.99.x / 2.0 preview introduced changes, so support must be validated separately. The displayed version is *not* a claim of certification; use the Check report to test your journal. Automated tests currently use a CLI mock, not a complete installed hledger binary.

### Bank exports and import rules

Put CSV/TSV/SSV exports beneath `imports/<year>/<bank-account>/`. Put hledger `.rules` files under `rules/`. The **Imports & files** tab can list these exports and run an explicit `hledger import --dry-run` preview against a chosen export and rules file. It does **not** apply imports yet, so no existing journal is changed by the preview workflow.

For production imports, validate CSV rules, deduplication, the `.latest` tracking state, destination journal and the batch of generated postings first. A future milestone should add a preview/diff/confirm/apply workflow with rollback and tests. See [hledger import](https://hledger.org/hledger.html#import).

### Automations and bank APIs

To show a script in the **Automations** tab, edit `automations/scripts.json`:

```json
{
  "scripts": [
    {
      "id": "fetch-bank-a",
      "name": "Fetch Bank A exports",
      "file": "fetch-bank.py",
      "description": "Downloads new CSV files into imports/2026/bank-a-czk/"
    }
  ]
}
```

Place the corresponding script inside `automations/scripts/`. Supported extensions are `.py`, `.js`, `.sh` (Unix) and `.ps1` (Windows). A deliberate click and confirmation are required to run a script. Script commands are invoked directly without a shell, with a time and output limit; they **still run with your current OS account permissions** and can modify data. Only configure code you trust. The UI does not yet offer an in-browser script editor, automatic scheduler, or direct bank API connector.

**Do not put banking API keys or credentials in scripts, Git commits, or this web UI.** Read them from an environment variable or a local secrets manager. The generated `.gitignore` excludes `.env` files and `secrets/` folders. For recurring tasks, use cron/systemd timers on Linux or Task Scheduler on Windows until the UI has a safe scheduler.

### Git snapshots (manual)

1. In **Git history**, click **Initialize Git** (once) to create a *local* repository in the finance workspace, not in this program's source repo.
2. Edit your journal and **Save & validate**.
3. When you are ready, enter a meaningful message and click **Commit checkpoint**. No automatic commits, and no extra backup copies per keystroke.

The Git action stages only `books/`, `rules/`, `automations/`, and `.gitignore`, and refuses to commit if another unrelated file has been staged elsewhere. By default, raw bank exports, invoices and secrets are excluded from Git. Back them up separately: **Git is not a backup for ignored documents**. Do **not** push finance files to a public remote repository. If you choose private remote backup, consider strong encryption and access controls.

### Development / testing

```sh
npm test
```

Tests use Node's built-in test runner and a mock hledger executable; no network or financial credentials needed. The test suite exercises workspace initialization, conflict detection, check-and-rollback logic, Git checkpoints, import-preview restrictions and local-server request protection. A real hledger compatibility test suite and Windows integration tests are still needed before calling this production-ready.

## What's next

- Reviewable **import -> validate -> confirm -> apply** flow with deduplication and rollback.
- Proper transaction editor built on the engine's representation (without destructively reserializing unsupported constructs).
- Graphical reports, account register navigation, holdings, budgets and forecasts.
- Script configuration editing and optionally an OS-integrated task scheduler.
- Multi-process write coordination, error recovery and broader installed-hledger tests on Windows/Linux.

## Česky stručně

Rozhraní spouští skutečný `hledger` přes lokální Node.js server (Windows/Linux). Každý rok má vlastní deník, ale hlavní `books/main.journal` zahrnuje všechny roky kvůli návaznosti zůstatků. Faktury a bankovní CSV mají oddělené složky. Úpravy se ukládají **jen tlačítkem Save & validate**, historie vzniká až ručním Git commitem. Bankovní import je zatím pouze bezpečný náhled, skripty je možné spouštět ručně po potvrzení. Důvěrná finanční data nikdy neukládej do veřejného repozitáře.

Licensed under the repository's GPL-3.0 license.