'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../server');

async function fixture(t) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'hledger-webuix-test-'));
  t.after(async () => { await fs.rm(home, { recursive: true, force: true }); });
  const bin = path.join(home, 'fake-hledger.js');
  await fs.writeFile(bin, `#!/usr/bin/env node
const fs=require('fs');const path=require('path');
const args=process.argv.slice(2);if(args.includes('--version')){console.log('hledger 1.52.4 mock');process.exit(0)}
const file=args[args.indexOf('-f')+1];let text=fs.readFileSync(file,'utf8');
if(file.endsWith('main.journal')){const books=path.dirname(file);const years=path.join(books,'years');for(const year of fs.readdirSync(years)){const f=path.join(years,year,'transactions.journal');if(fs.existsSync(f))text+=fs.readFileSync(f,'utf8')}}
if(args.includes('check')){if(text.includes('INVALID')||(file.endsWith('main.journal')&&text.includes('CROSSERROR'))){console.error('mock check failed');process.exit(1)}console.log('ok');process.exit(0)}
if(args.includes('import')){if(!args.includes('--dry-run'))process.exit(3);console.log('PREVIEW ONLY');process.exit(0)}
console.log('MOCK '+args.slice(2).join(' '));
`);
  await fs.chmod(bin, 0o755);
  const workspace = path.join(home, 'private-finances');
  const app = createApp({ workspace, port: 0, hledgerBin: process.execPath, hledgerArgsPrefix: [bin] });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => app.server.close(resolve)));
  const port = app.server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const token = (await (await fetch(base + '/api/status')).json()).token;
  async function call(method, route, data, headers = {}) {
    const response = await fetch(base + '/api/' + route, { method, headers: method === 'POST' ? { 'Content-Type': 'application/json', 'X-Webuix-Token': token, ...headers } : headers, body: data === undefined ? undefined : JSON.stringify(data) });
    return { status: response.status, body: await response.json() };
  }
  return { home, workspace, app, base, token, call };
}

test('workspace is created idempotently and journals retain multi-year includes', async t => {
  const { workspace, call } = await fixture(t);
  const a = await call('POST', 'init', { year: '2026' });
  assert.equal(a.status, 200);
  assert.equal((await fs.readFile(path.join(workspace, 'books/main.journal'), 'utf8')).includes('include years/*/transactions.journal'), true);
  const year = path.join(workspace, 'books/years/2026/transactions.journal');
  await fs.appendFile(year, '2026-01-01 first\n    assets:bank  10 CZK\n    equity:opening  -10 CZK\n');
  const b = await call('POST', 'init', { year: '2026' });
  assert.deepEqual(b.body.created, []);
  assert.match(await fs.readFile(year, 'utf8'), /first/);
  await call('POST', 'init', { year: '2025' });
  assert.equal((await call('GET', 'status')).body.years.join(','), '2025,2026');
});

test('save is manual, preserves original text, validates and detects conflicts', async t => {
  const { workspace, call } = await fixture(t);
  await call('POST', 'init', { year: '2026' });
  const journal = (await call('GET', 'journal?year=2026')).body;
  const contents = journal.content + '\n; preserve comments\n2026-11-21 * Lunch\n    expenses:food  5 EUR\n    assets:cash  -5 EUR\n';
  const filename = path.join(workspace, 'books/years/2026/transactions.journal');
  assert.equal(await fs.readFile(filename, 'utf8'), journal.content);
  const saved = await call('POST', 'save', { year: '2026', content: contents, etag: journal.etag });
  assert.equal(saved.status, 200);
  assert.equal(await fs.readFile(filename, 'utf8'), contents);
  const stale = await call('POST', 'save', { year: '2026', content: contents + '\n', etag: journal.etag });
  assert.equal(stale.status, 409);
  const invalid = await call('POST', 'save', { year: '2026', content: contents + '\nINVALID\n', etag: saved.body.etag });
  assert.equal(invalid.status, 422);
  assert.equal(await fs.readFile(filename, 'utf8'), contents);
  const invalidCross = await call('POST', 'save', { year: '2026', content: contents + '\nCROSSERROR\n', etag: saved.body.etag });
  assert.equal(invalidCross.status, 422);
  assert.equal(await fs.readFile(filename, 'utf8'), contents);
  const entries = await fs.readdir(path.dirname(filename));
  assert.equal(entries.some(name => name.startsWith('.webuix-draft-')), false);
});

test('report command whitelist and CSRF/host protections', async t => {
  const { call, base, token } = await fixture(t);
  await call('POST', 'init', { year: '2026' });
  const report = await call('POST', 'report', { command: 'balancesheet', period: 'monthly' });
  assert.equal(report.status, 200);
  assert.match(report.body.stdout, /MOCK balancesheet -M/);
  assert.equal((await call('POST', 'report', { command: 'import' })).status, 400);
  assert.equal((await call('POST', 'report', { command: 'balance', query: '--output-file=/tmp/out' })).status, 400);
  const attack = await fetch(base + '/api/init', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ year: '2025' }) });
  assert.equal(attack.status, 403);
  const cross = await fetch(base + '/api/init', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Webuix-Token': token, Origin: 'http://evil.example' }, body: JSON.stringify({ year: '2025' }) });
  assert.equal(cross.status, 403);
});

test('CSV import is preview-only and blocks path traversal and symlinks', async t => {
  const { call, workspace } = await fixture(t);
  await call('POST', 'init', { year: '2026' });
  const file = path.join(workspace, 'imports/2026/bank-a/statement.csv');
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, 'date,description,amount\n2026-11-21,Food,-5\n');
  await fs.writeFile(path.join(workspace, 'rules/bank.rules'), 'fields date,description,amount\n');
  const preview = await call('POST', 'import-preview', { year: '2026', csv: 'bank-a/statement.csv', rules: 'bank.rules' });
  assert.equal(preview.status, 200); assert.match(preview.body.stdout, /PREVIEW ONLY/);
  assert.equal((await call('POST', 'import-preview', { year: '2026', csv: '../other.csv' })).status, 400);
  if (process.platform !== 'win32') {
    await fs.symlink(path.join(workspace, 'books/main.journal'), path.join(workspace, 'imports/2026/bank-a/notcsv.csv'));
    assert.equal((await call('POST', 'import-preview', { year: '2026', csv: 'bank-a/notcsv.csv' })).status, 400);
  }
});

test('Git versioning is explicit and ignores bank source documents', async t => {
  const { call, workspace } = await fixture(t);
  await call('POST', 'init', { year: '2026' });
  assert.equal((await call('GET', 'git')).body.initialized, false);
  await fs.writeFile(path.join(workspace, 'imports/2026/private.csv'), 'secret financial data');
  await fs.writeFile(path.join(workspace, 'documents/2026/received/invoice.pdf'), 'private invoice');
  assert.equal((await call('POST', 'git-init', {})).status, 200);
  const before = await call('GET', 'git');
  assert.equal(before.body.initialized, true);
  const old = [process.env.GIT_AUTHOR_NAME, process.env.GIT_AUTHOR_EMAIL, process.env.GIT_COMMITTER_NAME, process.env.GIT_COMMITTER_EMAIL];
  process.env.GIT_AUTHOR_NAME = process.env.GIT_COMMITTER_NAME = 'Test';
  process.env.GIT_AUTHOR_EMAIL = process.env.GIT_COMMITTER_EMAIL = 'test@example.invalid';
  try {
    const commit = await call('POST', 'git-commit', { message: 'Initial books' });
    assert.equal(commit.status, 200, JSON.stringify(commit.body));
    assert.equal(commit.body.changed, true);
    const after = await call('GET', 'git');
    assert.match(after.body.history, /Initial books/);
    assert.doesNotMatch(after.body.changes, /private.csv|invoice.pdf/);
  } finally {
    ['GIT_AUTHOR_NAME','GIT_AUTHOR_EMAIL','GIT_COMMITTER_NAME','GIT_COMMITTER_EMAIL'].forEach((name, i) => { if (old[i] === undefined) delete process.env[name]; else process.env[name] = old[i]; });
  }
});

test('scripts require manifest and stay within trusted scripts directory', async t => {
  const { workspace, call } = await fixture(t);
  await call('POST', 'init', { year: '2026' });
  const scriptsDir = path.join(workspace, 'automations/scripts');
  await fs.writeFile(path.join(scriptsDir, 'hello.js'), 'console.log("script execution ok");\n');
  const manifest = path.join(workspace, 'automations/scripts.json');
  await fs.writeFile(manifest, JSON.stringify({ scripts: [{ id: 'hello', file: 'hello.js', name: 'Hello' }] }));
  const r = await call('POST', 'run-script', { id: 'hello' });
  assert.equal(r.status, 200); assert.match(r.body.stdout, /script execution ok/);
  await fs.writeFile(manifest, JSON.stringify({ scripts: [{ id: 'bad', file: '../server.js' }] }));
  assert.equal((await call('GET', 'scripts')).status, 400);
});

test('reports Node version and persists a validated custom hledger path (including when PATH is missing)', async t => {
  const { home, workspace, call } = await fixture(t);
  const original = (await call('GET', 'status')).body;
  assert.equal(original.node.installed, true);
  assert.equal(original.node.version, process.version);
  assert.equal(original.hledger.installed, true);
  assert.match(original.hledger.version, /hledger 1\.52/);

  assert.equal((await call('POST', 'hledger-path', { path: 'relative/hledger.exe' })).status, 400);
  assert.equal((await call('POST', 'hledger-path', { path: path.join(home, 'missing-hledger.exe') })).status, 400);
  const good = await call('POST', 'hledger-path', { path: process.execPath });
  assert.equal(good.status, 200, JSON.stringify(good.body));
  assert.equal(good.body.hledger.installed, true);
  assert.equal(good.body.hledger.source, 'saved');
  assert.equal(good.body.hledger.path, process.execPath);
  assert.equal(JSON.parse(await fs.readFile(path.join(workspace, '.webuix/settings.json'), 'utf8')).hledgerPath, process.execPath);
  // Status must survive app restart, with no real hledger on PATH.
  const unavailable = createApp({
    workspace,
    hledgerBin: path.join(home, 'does-not-exist-hledger'),
    hledgerArgsPrefix: [path.join(home, 'fake-hledger.js')]
  });
  assert.equal((await unavailable.status()).hledger.installed, true);
  assert.equal((await unavailable.status()).hledger.source, 'saved');
  const removed = await call('POST', 'hledger-path', { path: '' });
  assert.equal(removed.status, 200);
  assert.notEqual(removed.body.hledger.source, 'saved');
  assert.equal((await unavailable.status()).hledger.installed, false);
  await assert.rejects(fs.access(path.join(workspace, '.webuix/settings.json')));
});

test('launchers handle missing Node.js and start the server in open-browser mode', async () => {
  const projectRoot = path.join(__dirname, '..');
  const [bat, sh] = await Promise.all([
    fs.readFile(path.join(projectRoot, 'start.bat'), 'utf8'),
    fs.readFile(path.join(projectRoot, 'start.sh'), 'utf8')
  ]);
  for (const source of [bat, sh]) {
    assert.match(source, /please install node\.js/i);
    assert.match(source, /https:\/\/nodejs\.org\/en\/download/);
    assert.match(source, /--open/);
    assert.match(source, /HLEDGER_WORKSPACE/);
  }
});
