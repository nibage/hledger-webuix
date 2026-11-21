# hledger-webuix

A local-first web interface powered by the **real hledger CLI** and Git, for Windows and Linux.

This is a substantial rework of the original standalone HTML proof of concept. It is no longer a standalone file that reimplements accounting in JavaScript: the browser talks to a small local Node.js server that executes an installed `hledger` binary. This avoids silently losing unsupported journal syntax when saving and gives reports computed by hledger itself.

> **Early development release (webuix 0.2.0).** Do not rely on it as the only copy of important financial data. Test with an example journal first. This is not a certified tax/accounting solution. Compatibility with every hledger release and every journal feature has not been established.

## Quick start

Install:

- **Node.js 20+** ([nodejs.org](https://nodejs.org/))
- **hledger CLI** ([installation guide](https://hledger.org/install.html))
- **Git** (optional, for manual history)

Ensure `node --version`, `hledger --version`, and `git --version` work in your terminal. Then, from this repo:

```sh
node server.js --workspace "/path/to/your-private-finances"
```

On Windows (PowerShell):

```powershell
node .\server.js --workspace "C:\Users\YOU\Documents\finances"
```

Visit **http://127.0.0.1:8765**. Click **Create folders** once to create the layout (existing files are never overwritten). Choose a year, edit the journal and click **Save & validate**. The browser displays the detected `hledger --version` in its header and uses `hledger` for all reporting.

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