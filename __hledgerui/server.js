'use strict';
// Local-only hledger web UI backend. No npm dependencies; Node.js >=20.
const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { URL } = require('node:url');

const APP_VERSION = '0.2.0';
const PORTABLE_MANIFEST = require('./runtime-manifest.json');
const PORTABLE_WINDOWS_X64 = process.platform === 'win32' && process.arch === 'x64';
function portableBinary(component) {
  if (!PORTABLE_WINDOWS_X64) return null;
  const root = path.join(__dirname, 'data', component, 'win-x64');
  let active = '';
  try { active = fs.readFileSync(path.join(root, 'active.txt'), 'utf8').trim(); }
  catch { return null; }
  if (!/^v\d+\.\d+\.\d+$/.test(active)) return null;
  const executable = path.join(root, active, component === 'node' ? 'node.exe' : component === 'git' ? 'git.exe' : 'hledger.exe');
  return fs.existsSync(executable) ? executable : null;
}
const READ_COMMANDS = new Set(['print', 'balance', 'register', 'aregister', 'balancesheet', 'incomestatement', 'cashflow', 'accounts', 'payees', 'tags', 'prices', 'stats', 'files', 'check']);
const PERIOD_COMMANDS = new Set(['balance', 'register', 'aregister', 'balancesheet', 'incomestatement', 'cashflow']);
const YEAR_RE = /^(19|20|21)\d{2}$/;
const MAX_BODY = 8 * 1024 * 1024;
const MAX_OUTPUT = 3 * 1024 * 1024;

function fail(message, status = 400) { const e = new Error(message); e.status = status; throw e; }
function sha(content) { return crypto.createHash('sha256').update(content).digest('hex'); }
function yearOK(year) { if (!YEAR_RE.test(String(year))) fail('Invalid year.'); return String(year); }
function fileIfExists(file) { return fsp.readFile(file, 'utf8').catch(e => { if (e.code === 'ENOENT') return null; throw e; }); }
function inside(base, file) { const rel = path.relative(base, file); return rel && !rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel); }
function relSafe(base, relative, extensions) {
  if (typeof relative !== 'string' || !relative || relative.includes('\\') || relative.includes('\0')) fail('Invalid relative path.');
  const full = path.resolve(base, relative);
  if (!inside(base, full) || (extensions && !extensions.some(ext => full.toLowerCase().endsWith(ext)))) fail('Path not permitted.');
  return full;
}
async function noSymlinkWithin(base, target) {
  const baseReal = await fsp.realpath(base);
  const targetReal = await fsp.realpath(target);
  if (!inside(baseReal, targetReal)) fail('Symlinks pointing outside workspace are not permitted.');
  const st = await fsp.stat(targetReal);
  if (!st.isFile()) fail('Not a file.');
  return targetReal;
}
async function listRelative(base, extensions, maxDepth = 5) {
  const found = [];
  async function walk(dir, depth) {
    if (depth > maxDepth || found.length >= 1200) return;
    let entries; try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch (e) { if (e.code === 'ENOENT') return; throw e; }
    for (const d of entries) {
      if (d.name.startsWith('.') || found.length >= 1200) continue;
      const full = path.join(dir, d.name);
      if (d.isDirectory()) await walk(full, depth + 1);
      else if (d.isFile() && (!extensions || extensions.some(ext => d.name.toLowerCase().endsWith(ext)))) found.push(path.relative(base, full).split(path.sep).join('/'));
    }
  }
  await walk(base, 0);
  return found.sort();
}
function runCommand(cmd, args, options = {}) {
  const { cwd, timeout = 20000, env = process.env } = options;
  return new Promise(resolve => {
    let child;
    try { child = spawn(cmd, args, { cwd, env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (e) { resolve({ ok: false, code: null, stdout: '', stderr: e.message }); return; }
    let stdout = '', stderr = '', done = false, killed = false;
    const timer = setTimeout(() => { killed = true; child.kill(); }, timeout);
    function append(key, data) {
      const str = data.toString('utf8');
      if (key === 'out') stdout = (stdout + str).slice(0, MAX_OUTPUT);
      else stderr = (stderr + str).slice(0, MAX_OUTPUT);
      if (stdout.length >= MAX_OUTPUT || stderr.length >= MAX_OUTPUT) { killed = true; child.kill(); }
    }
    child.stdout.on('data', data => append('out', data));
    child.stderr.on('data', data => append('err', data));
    function finish(code, error) { if (done) return; done = true; clearTimeout(timer); resolve({ ok: code === 0 && !killed && !error, code, stdout, stderr: error ? String(error.message) : killed ? (stderr + '\nProcess stopped (timeout/output limit).') : stderr }); }
    child.on('error', e => finish(null, e));
    child.on('close', code => finish(code));
  });
}

function createApp({ workspace, port = 8765, hledgerBin = process.env.HLEDGER_BIN || 'hledger', hledgerArgsPrefix = [], gitBin = process.env.GIT_BIN || portableBinary('git') || 'git' }) {
  if (!workspace) fail('Provide a workspace path with --workspace.');
  workspace = path.resolve(workspace);
  const frontendFile = path.join(__dirname, 'index.html');
  const mainJournal = path.join(workspace, 'books', 'main.journal');
  const token = crypto.randomBytes(24).toString('hex');
  const localSettingsFile = path.join(workspace, '.webuix', 'settings.json');
  let mutationBusy = false;
  async function selectedHledger() {
    const raw = await fileIfExists(localSettingsFile);
    if (raw !== null) {
      try {
        const saved = JSON.parse(raw);
        if (typeof saved.hledgerPath === 'string' && path.isAbsolute(saved.hledgerPath))
          return { binary: saved.hledgerPath, source: 'saved' };
      } catch { /* Invalid settings fall back to the startup executable. */ }
    }
    if (process.env.HLEDGER_BIN || hledgerBin !== 'hledger') {
      return { binary: hledgerBin, source: process.env.HLEDGER_BIN ? 'environment' : 'custom' };
    }
    const bundled = portableBinary('hledger');
    if (bundled) return { binary: bundled, source: 'bundled' };
    return { binary: hledgerBin, source: 'PATH' };
  }
  async function hledger(args, timeout) {
    const selected = await selectedHledger();
    return runCommand(selected.binary, [...hledgerArgsPrefix, ...args], { cwd: fs.existsSync(workspace) ? workspace : __dirname, timeout });
  }
  async function git(args) { return runCommand(gitBin, args, { cwd: fs.existsSync(workspace) ? workspace : __dirname }); }
  function yearJournal(year) { return path.join(workspace, 'books', 'years', yearOK(year), 'transactions.journal'); }
  async function safeYearJournal(year) {
    const file = yearJournal(year);
    const rootReal = await fsp.realpath(workspace);
    const fileReal = await fsp.realpath(file);
    if (path.relative(rootReal, fileReal) !== path.join('books', 'years', yearOK(year), 'transactions.journal')) fail('Year journal may not be a symlink.', 403);
    return file;
  }
  async function assertInitialized() { if (!fs.existsSync(mainJournal)) fail('Create the workspace structure first.', 409); }
  async function mutate(fn) { if (mutationBusy) fail('Another write operation is running.', 409); mutationBusy = true; try { return await fn(); } finally { mutationBusy = false; } }
  async function configureHledgerPath(value) {
    if (typeof value !== 'string' || value.length > 4096 || /[\r\n\0]/.test(value)) fail('Enter a valid executable path.');
    const binary = value.trim().replace(/^"(.*)"$/, '$1');
    if (binary) {
      if (!path.isAbsolute(binary)) fail('Enter an absolute path to hledger.exe (Windows) or hledger (Linux).');
      let stat;
      try { stat = await fsp.stat(binary); } catch { fail('Executable not found at the specified path.'); }
      if (!stat.isFile()) fail('The selected path must point to a file.');
      const probe = await runCommand(binary, [...hledgerArgsPrefix, '--version'], { cwd: fs.existsSync(workspace) ? workspace : __dirname, timeout: 5000 });
      if (!probe.ok || !/^hledger(?:\s|$)/i.test(probe.stdout.trim()))
        fail('The selected executable did not return a valid hledger --version. Choose a trusted hledger executable.');
    }
    return mutate(async () => {
      if (!binary) {
        await fsp.rm(localSettingsFile, { force: true });
      } else {
        await fsp.mkdir(path.dirname(localSettingsFile), { recursive: true });
        const temp = localSettingsFile + '.tmp-' + crypto.randomBytes(6).toString('hex');
        try {
          await fsp.writeFile(temp, JSON.stringify({ hledgerPath: binary }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
          await fsp.rename(temp, localSettingsFile);
        } finally { await fsp.rm(temp, { force: true }).catch(() => {}); }
        // Backwards compatibility with workspaces created before the local-settings exclusion.
        const ignoreFile = path.join(workspace, '.gitignore');
        const existing = await fileIfExists(ignoreFile);
        if (existing !== null && !/^\.webuix\/\s*$/m.test(existing))
          await fsp.appendFile(ignoreFile, (existing.endsWith('\n') ? '' : '\n') + '.webuix/\n');
      }
      return status();
    });
  }
  async function putNew(file, content) { await fsp.mkdir(path.dirname(file), { recursive: true }); try { await fsp.writeFile(file, content, { encoding: 'utf8', flag: 'wx' }); return true; } catch (e) { if (e.code === 'EEXIST') return false; throw e; } }
  async function initWorkspace(year) {
    return mutate(async () => {
      year = yearOK(year);
      await fsp.mkdir(workspace, { recursive: true });
      const made = [];
      const files = [
        ['books/main.journal', '; hledger-webuix: all years are included for cumulative balances\ninclude years/*/transactions.journal\n'],
        [`books/years/${year}/transactions.journal`, `; Accounting transactions for ${year}\n`],
        ['automations/scripts.json', '{\n  "scripts": []\n}\n'],
        ['.gitignore', '# Private source documents and bank exports stay outside Git by default.\nimports/\ndocuments/\n**/.env\n**/secrets/\n**/.webuix-draft-*\nnode_modules/\n.webuix/\n']
      ];
      for (const [rel, content] of files) if (await putNew(path.join(workspace, rel), content)) made.push(rel);
      for (const dir of [`imports/${year}`, `documents/${year}/issued`, `documents/${year}/received`, 'rules', 'automations/scripts']) await fsp.mkdir(path.join(workspace, dir), { recursive: true });
      return { created: made, year };
    });
  }
  async function years() {
    const roots = ['books/years', 'imports', 'documents']; const set = new Set();
    for (const rel of roots) {
      try { const dirs = await fsp.readdir(path.join(workspace, rel), { withFileTypes: true }); dirs.filter(d => d.isDirectory() && YEAR_RE.test(d.name)).forEach(d => set.add(d.name)); }
      catch (e) { if (e.code !== 'ENOENT') throw e; }
    }
    return [...set].sort();
  }
  async function status() {
    const [selected, h, g, yr, tracked] = await Promise.all([
      selectedHledger(), hledger(['--version'], 5000), git(['--version']), years(), fileIfExists(mainJournal)
    ]);
    const detectedVersion = (h.stdout || '').trim().split('\n')[0];
    const installed = h.ok && /^hledger(?:\s|$)/i.test(detectedVersion);
    const gitRoot = fs.existsSync(path.join(workspace, '.git'));
    return {
      appVersion: APP_VERSION, workspace, initialized: tracked !== null, years: yr, token,
      node: {
        installed: true, version: process.version, path: process.execPath,
        source: PORTABLE_WINDOWS_X64 && path.normalize(process.execPath).toLowerCase().startsWith(
          (path.join(__dirname, 'data', 'node', 'win-x64') + path.sep).toLowerCase()
        ) ? 'bundled' : 'system'
      },
      runtime: {
        canUpdate: PORTABLE_WINDOWS_X64,
        platform: process.platform + '-' + process.arch,
        target: { node: PORTABLE_MANIFEST.node.version, hledger: PORTABLE_MANIFEST.hledger.version }
      },
      hledger: {
        installed, version: installed ? detectedVersion : '',
        path: selected.binary, source: selected.source,
        error: installed ? '' : (h.stderr || 'The selected executable is not a working hledger CLI.').trim().slice(0, 500)
      },
      git: {
        installed: g.ok, version: (g.stdout || g.stderr).trim().split('\n')[0],
        initialized: gitRoot, path: gitBin,
        source: process.env.GIT_BIN ? 'environment' : (PORTABLE_WINDOWS_X64 && gitBin === portableBinary('git') ? 'bundled' : 'PATH'),
        bundledAvailable: !!portableBinary('git')
      },
      supported: 'CLI integration tested with a mock for hledger 1.52.x; verify your installed version with Check'
    };
  }
  async function journal(year) {
    const filename = yearJournal(year);
    const text = await fileIfExists(filename);
    if (text === null) fail('Year not found. Create it first.', 404);
    await safeYearJournal(year);
    return { year, content: text, etag: sha(text) };
  }
  async function saveJournal({ year, content, etag }) {
    if (typeof content !== 'string' || typeof etag !== 'string') fail('Missing journal content or revision hash.');
    if (Buffer.byteLength(content) > MAX_BODY) fail('Journal too large.');
    await assertInitialized();
    return mutate(async () => {
      const file = yearJournal(year);
      const before = await fileIfExists(file);
      if (before === null) fail('Year journal not found. Create the year first.', 404);
      await safeYearJournal(year);
      if (sha(before) !== etag) fail('Journal changed on disk since you opened it. Reload before saving.', 409);
      if (before === content) return { changed: false, etag };
      const draft = path.join(path.dirname(file), `.webuix-draft-${crypto.randomBytes(8).toString('hex')}.journal`);
      await fsp.writeFile(draft, content, { flag: 'wx' });
      try {
        const single = await hledger(['-f', draft, 'check']);
        if (!single.ok) fail(`hledger rejected the draft:\n${single.stderr || single.stdout}`, 422);
        // Another process may have edited the journal while we were validating.
        if (sha((await fileIfExists(file)) || '') !== etag) fail('Journal changed externally during validation.', 409);
        await fsp.rename(draft, file);
        const full = await hledger(['-f', mainJournal, 'check']);
        if (!full.ok) {
          // Restore previous bytes on failed cross-year validation, without creating a backup file.
          await fsp.writeFile(draft, before, { flag: 'wx' });
          await fsp.rename(draft, file);
          fail(`Full ledger validation failed. Previous content restored:\n${full.stderr || full.stdout}`, 422);
        }
        return { changed: true, etag: sha(content), validation: full.stdout.trim() || 'hledger check passed' };
      } finally { await fsp.rm(draft, { force: true }).catch(() => {}); }
    });
  }
  async function report({ command = 'balance', period = 'none', query = '' }) {
    await assertInitialized();
    if (!READ_COMMANDS.has(command)) fail('Command is not allowed.');
    if (!['none', 'monthly', 'quarterly', 'yearly'].includes(period)) fail('Invalid period.');
    if (typeof query !== 'string' || query.length > 200 || query.startsWith('-') || /[\r\n\0]/.test(query)) fail('Invalid query.');
    const args = ['-f', mainJournal, command];
    if (PERIOD_COMMANDS.has(command)) { if (period === 'monthly') args.push('-M'); if (period === 'quarterly') args.push('-Q'); if (period === 'yearly') args.push('-Y'); }
    if (query.trim()) args.push(query.trim());
    const result = await hledger(args);
    return { ...result, args: ['hledger', '-f', 'books/main.journal', ...args.slice(3)] };
  }
  async function fileOverview(year) {
    year = yearOK(year);
    const [imports, issued, received, rules] = await Promise.all([
      listRelative(path.join(workspace, 'imports', year), ['.csv', '.tsv', '.ssv']),
      listRelative(path.join(workspace, 'documents', year, 'issued')),
      listRelative(path.join(workspace, 'documents', year, 'received')),
      listRelative(path.join(workspace, 'rules'), ['.rules'])
    ]);
    return { imports, issued, received, rules };
  }
  async function importPreview({ year, csv, rules }) {
    await assertInitialized(); year = yearOK(year);
    const importsBase = path.join(workspace, 'imports', year);
    const source = await noSymlinkWithin(importsBase, relSafe(importsBase, csv, ['.csv', '.tsv', '.ssv']));
    const ruleBase = path.join(workspace, 'rules');
    const rulesPath = rules ? await noSymlinkWithin(ruleBase, relSafe(ruleBase, rules, ['.rules'])) : null;
    const args = ['-f', yearJournal(year), 'import', '--dry-run'];
    if (rulesPath) args.push('--rules-file', rulesPath);
    args.push(source);
    const result = await hledger(args, 30000);
    return { ...result, note: 'Preview only: import --dry-run. No transactions were intentionally written.' };
  }
  async function scripts() {
    const raw = await fileIfExists(path.join(workspace, 'automations', 'scripts.json'));
    if (raw === null) return [];
    let parsed;
    try { parsed = JSON.parse(raw); } catch { fail('Invalid automations/scripts.json.'); }
    if (!parsed || !Array.isArray(parsed.scripts)) fail('Expected {"scripts":[]} in scripts.json.');
    return parsed.scripts.map(s => {
      if (!s || typeof s.id !== 'string' || !/^[a-zA-Z0-9_-]{1,60}$/.test(s.id) || typeof s.file !== 'string' || !/^[a-zA-Z0-9_-][a-zA-Z0-9_./-]*\.(py|js|sh|ps1)$/.test(s.file) || s.file.includes('..')) fail('Unsafe script definition in scripts.json.');
      return { id: s.id, name: String(s.name || s.id).slice(0,100), file: s.file, description: String(s.description || '').slice(0,400) };
    });
  }
  async function runScript(id) {
    return mutate(async () => {
      const item = (await scripts()).find(s => s.id === id);
      if (!item) fail('Script not configured.', 404);
      const scriptBase = path.join(workspace, 'automations', 'scripts');
      const file = await noSymlinkWithin(scriptBase, relSafe(scriptBase, item.file));
      const ext = path.extname(file);
      let cmd, args;
      if (ext === '.py') { cmd = process.platform === 'win32' ? 'py' : 'python3'; args = [file]; }
      else if (ext === '.js') { cmd = process.execPath; args = [file]; }
      else if (ext === '.sh') { if (process.platform === 'win32') fail('.sh scripts need WSL or a Unix environment.'); cmd = 'sh'; args = [file]; }
      else { if (process.platform !== 'win32') fail('.ps1 scripts are enabled only on Windows.'); cmd = 'powershell.exe'; args = ['-NoProfile', '-NonInteractive', '-File', file]; }
      return { ...await runCommand(cmd, args, { cwd: workspace, timeout: 60000 }), id: item.id };
    });
  }
  async function gitStatus() {
    if (!fs.existsSync(path.join(workspace, '.git'))) return { initialized: false, changes: '' };
    const [s, log] = await Promise.all([git(['status', '--short', '--untracked-files=normal']), git(['log', '-5', '--pretty=format:%h %ad %s', '--date=short'])]);
    return { initialized: true, changes: s.stdout, history: log.stdout, error: s.ok ? null : s.stderr };
  }
  async function gitInit() {
    return mutate(async () => {
      if (fs.existsSync(path.join(workspace, '.git'))) return { changed: false };
      const r = await git(['init', '-b', 'main']);
      if (!r.ok) fail(r.stderr || r.stdout || 'git init failed', 422);
      return { changed: true, message: r.stdout };
    });
  }
  async function gitCommit(message) {
    if (typeof message !== 'string' || !message.trim() || message.length > 150) fail('Enter a commit message (max 150 characters).');
    return mutate(async () => {
      if (!fs.existsSync(path.join(workspace, '.git'))) fail('Initialize Git first.', 409);
      // Never commit imported bank files, invoices, secrets or unrelated staged files.
      const add = await git(['add', '-A', '--', 'books', 'rules', 'automations', '.gitignore']);
      if (!add.ok) fail(add.stderr, 422);
      const staged = await git(['diff', '--cached', '--name-only']);
      if (!staged.ok) fail(staged.stderr, 422);
      const paths = staged.stdout.split(/\r?\n/).filter(Boolean);
      if (paths.some(p => !/^(books\/|rules\/|automations\/|\.gitignore$)/.test(p))) fail('Other files are staged in Git. Unstage them before using the UI commit button.', 409);
      if (!paths.length) return { changed: false, message: 'No changes to commit.' };
      const result = await git(['commit', '-m', message.trim()]);
      if (!result.ok) fail(result.stderr || result.stdout, 422);
      return { changed: true, message: result.stdout };
    });
  }
  async function runPortableUpdater(component) {
    if (!PORTABLE_WINDOWS_X64) fail('Portable runtime updating is currently supported on Windows x64 only.', 400);
    if (component !== 'node' && component !== 'hledger') fail('Unknown runtime component.');
    const updater = path.join(__dirname, 'scripts', 'update-runtime.ps1');
    if (!fs.existsSync(updater)) fail('Portable runtime updater script missing.', 500);
    return new Promise((resolve, reject) => {
      const child = spawn('powershell.exe', [
        '-NoProfile', '-NoExit', '-ExecutionPolicy', 'Bypass', '-File', updater,
        '-Component', component, '-ServerProcessId', String(process.pid)
      ], { detached: true, windowsHide: false, stdio: 'ignore' });
      child.once('error', e => reject(Object.assign(new Error('Could not start updater: ' + e.message), { status: 422 })));
      child.once('spawn', () => {
        child.unref();
        resolve({ started: true, component, target: PORTABLE_MANIFEST[component].version,
          note: 'Updater opened in a separate PowerShell window. Confirm there, then stop the server with Ctrl+C. The updater waits for the server to exit before replacing runtimes. Start webuix again afterward.' });
      });
    });
  }
  async function bodyJSON(req) {
    let total = 0, chunks = [];
    for await (const chunk of req) { total += chunk.length; if (total > MAX_BODY) fail('Request too large.', 413); chunks.push(chunk); }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { fail('Invalid JSON.'); }
  }
  const server = http.createServer(async (req, res) => {
    const host = req.headers.host || '';
    if (!new RegExp(`^(localhost|127\\.0\\.0\\.1):${server.address()?.port || port}$`, 'i').test(host)) { res.writeHead(403).end('Invalid host.'); return; }
    const origin = req.headers.origin;
    if (origin && origin !== `http://${host}`) { res.writeHead(403).end('Cross-origin requests forbidden.'); return; }
    const send = (statusCode, data) => { res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(data)); };
    try {
      const url = new URL(req.url, `http://${host}`);
      if (req.method === 'GET' && url.pathname === '/favicon.svg') {
        const favicon = await fsp.readFile(path.join(__dirname, 'favicon.svg'));
        res.writeHead(200, {
          'Content-Type': 'image/svg+xml; charset=utf-8',
          'Cache-Control': 'public, max-age=3600',
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'"
        });
        res.end(favicon); return;
      }
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
        const html = await fsp.readFile(frontendFile);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'" });
        res.end(html); return;
      }
      if (!url.pathname.startsWith('/api/')) { send(404, { error: 'Not found.' }); return; }
      if (req.method === 'POST') {
        if (!String(req.headers['content-type'] || '').startsWith('application/json') || req.headers['x-webuix-token'] !== token) fail('Invalid request token.', 403);
      }
      if (req.method === 'GET' && url.pathname === '/api/status') return send(200, await status());
      if (req.method === 'GET' && url.pathname === '/api/journal') return send(200, await journal(url.searchParams.get('year')));
      if (req.method === 'GET' && url.pathname === '/api/files') return send(200, await fileOverview(url.searchParams.get('year')));
      if (req.method === 'GET' && url.pathname === '/api/scripts') return send(200, await scripts());
      if (req.method === 'GET' && url.pathname === '/api/git') return send(200, await gitStatus());
      if (req.method === 'POST') {
        const b = await bodyJSON(req);
        if (url.pathname === '/api/init') return send(200, await initWorkspace(b.year));
        if (url.pathname === '/api/hledger-path') return send(200, await configureHledgerPath(b.path));
        if (url.pathname === '/api/runtime-update') return send(200, await runPortableUpdater(b.component));
        if (url.pathname === '/api/save') return send(200, await saveJournal(b));
        if (url.pathname === '/api/report') return send(200, await report(b));
        if (url.pathname === '/api/import-preview') return send(200, await importPreview(b));
        if (url.pathname === '/api/run-script') return send(200, await runScript(b.id));
        if (url.pathname === '/api/git-init') return send(200, await gitInit());
        if (url.pathname === '/api/git-commit') return send(200, await gitCommit(b.message));
      }
      send(404, { error: 'Not found.' });
    } catch (e) { send(e.status || 500, { error: e.status ? e.message : 'Internal error: ' + e.message }); }
  });
  return { server, workspace, initWorkspace, journal, saveJournal, report, status, gitStatus, configureHledgerPath };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const option = name => { const i = args.indexOf(name); return i === -1 ? null : args[i + 1]; };
  const workspace = option('--workspace') || process.env.HLEDGER_WORKSPACE;
  const port = Number(option('--port') || process.env.HLEDGER_PORT || 8765);
  if (!workspace || !Number.isInteger(port) || port < 1 || port > 65535) {
    console.error('Usage: node server.js --workspace "/path/to/private/finance" [--port 8765] [--open]');
    process.exit(1);
  }
  const app = createApp({ workspace, port });
  app.server.on('error', error => {
    if (error.code === 'EADDRINUSE') console.error(`Port ${port} is already used. Close the other webuix server or set HLEDGER_PORT to another port.`);
    else console.error('Cannot start local server:', error.message);
    process.exitCode = 1;
  });
  app.server.listen(port, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${port}/`;
    console.log(`hledger-webuix ready at ${url} (workspace: ${app.workspace})`);
    if (args.includes('--open')) {
      // Only open after a successful listen. On Windows, Start-Process uses
      // the system's default HTTP handler; an existing browser usually opens a new tab.
      const opener = process.platform === 'win32'
        ? ['powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Start-Process -FilePath '${url}'`]]
        : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
      try {
        const child = spawn(opener[0], opener[1], { detached: true, stdio: 'ignore', windowsHide: true });
        child.on('error', () => console.warn('Could not open browser automatically. Open ' + url));
        child.on('exit', code => { if (code !== 0) console.warn('Could not open browser automatically. Open ' + url); });
        child.unref();
      } catch { console.warn('Could not open browser automatically. Open ' + url); }
    }
  });
}
module.exports = { createApp, runCommand };
