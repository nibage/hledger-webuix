'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../__hledgerui/server');

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
  const configDir=path.join(home,'app-config');
  const profileFolder=path.join(home,'profiles');
  const app = createApp({ workspace, port: 0, hledgerBin: process.execPath, hledgerArgsPrefix: [bin], configDir, profileFolder });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => app.server.close(resolve)));
  const port = app.server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const token = (await (await fetch(base + '/api/status')).json()).token;
  async function call(method, route, data, headers = {}) {
    const response = await fetch(base + '/api/' + route, { method, headers: method === 'POST' ? { 'Content-Type': 'application/json', 'X-Webuix-Token': token, ...headers } : headers, body: data === undefined ? undefined : JSON.stringify(data) });
    return { status: response.status, body: await response.json() };
  }
  return { home, workspace, configDir, profileFolder, app, base, token, call };
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
  const { home, workspace, configDir, call } = await fixture(t);
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
    workspace, configDir,
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
    fs.readFile(path.join(projectRoot, '__hledgerui', 'start.bat'), 'utf8'),
    fs.readFile(path.join(projectRoot, '__hledgerui', 'start.sh'), 'utf8')
  ]);
  for (const source of [bat, sh]) {
    assert.match(source, /please install node\.js/i);
    assert.match(source, /https:\/\/nodejs\.org\/en\/download/);
    assert.match(source, /--open/);
    assert.match(source, /HLEDGER_WORKSPACE/);
  }
});

test('favicon is served as SVG and tab content has stable layout rules', async t => {
  const { base } = await fixture(t);
  const icon = await fetch(base + '/favicon.svg');
  assert.equal(icon.status, 200);
  assert.match(icon.headers.get('content-type'), /^image\/svg\+xml/);
  const svg = await icon.text();
  assert.match(svg, /<svg\s/);
  assert.match(svg, /hledger webuix/);
  const home = await fetch(base + '/');
  assert.equal(home.status, 200);
  const html = await home.text();
  assert.match(html, /rel="icon" type="image\/svg\+xml" href="favicon.svg"/);
  assert.match(html, /scrollbar-gutter:stable/);
  assert.match(html, /grid-template-areas:"page actions" "statuses statuses"/);
  assert.match(html, /class="header-status"/);
  assert.match(html, /if\(tab!==state.tab\)window.scrollTo\(0,0\)/);
});

test('portable runtime pins and settings surface are exposed without automatic changes', async t => {
  const { call, base, workspace } = await fixture(t);
  const status = (await call('GET','status')).body;
  assert.equal(status.runtime.target.node, '24.22.3');
  assert.equal(status.runtime.target.git, '2.56.1');
  assert.ok(status.runtime.components.node.systemPath || status.node.path);
  assert.equal(status.runtime.target.hledger, '1.52.4');
  assert.equal(status.runtime.platform, process.platform + '-' + process.arch);
  assert.equal(status.node.source, 'system');
  const manifest = require('../__hledgerui/runtime-manifest.json');
  for (const component of ['node','hledger']) {
    assert.match(manifest[component]['windows-x64'].url, /^https:\/\//);
    assert.match(manifest[component]['windows-x64'].sha256, /^[a-f0-9]{64}$/);
  }
  const html = await (await fetch(base+'/')).text();
  assert.match(html, /data-tab="settings"/);
  assert.match(html, /id="runtime-update-node"/);
  assert.match(html, /id="runtime-update-hledger"/);
  assert.match(html, /api\('runtime-update'/);
  const windowsUpdater = await fs.readFile(path.join(__dirname,'..','__hledgerui','scripts','update-runtime.ps1'),'utf8');
  assert.match(windowsUpdater, /Get-FileHash/);
  assert.doesNotMatch(windowsUpdater, /Wait-Process/);
  assert.match(windowsUpdater, /\.staging-/);
  const launcher = await fs.readFile(path.join(__dirname,'..','__hledgerui','start.bat'),'utf8');
  assert.match(launcher, /data\\node\\win-x64\\active.txt/);
  assert.match(launcher, /NODE_EXE/);
  if (process.platform !== 'win32') {
    const unsupported = await call('POST','runtime-update',{component:'node'});
    assert.equal(unsupported.status,400);
  }
  await assert.rejects(fs.access(path.join(workspace,'data')));
});

test('portable directory layout, index file startup notice and Settings status', async t => {
  const { call, base } = await fixture(t);
  const status = (await call('GET', 'status')).body;
  assert.equal(status.git.path, process.env.GIT_BIN || 'git');
  assert.equal(status.git.bundledAvailable, false);
  assert.ok(typeof status.git.version === 'string');
  assert.ok(typeof status.git.installed === 'boolean');
  const html = await (await fetch(base + '/index.html')).text();
  assert.match(html, /id="tab-overview" class="panel active"/);
  assert.match(html, /Your finances, your files/);
  assert.match(html, /Quick balance overview/);
  assert.match(html, /id="tab-settings"/);
  for (const id of ['runtime-node-status','runtime-hledger-status','runtime-git-status','component-mode-git']) {
    assert.match(html, new RegExp('id="' + id + '"'));
  }
  assert.match(html, /please open with start script to start node\.js server/);
  assert.match(html, /location\.protocol === "file:"/);
  assert.match(html, /if\(location\.protocol!==\x27file:\x27\)\{/);
  assert.match(html, /class="file-launch-banner"/);
  for (const component of ['node','hledger','git']) {
    await fs.access(path.join(__dirname, '..', '__hledgerui','data',component,'.gitkeep'));
  }
  assert.equal((await fetch(base + '/hledger-webuix.html')).status, 404);
});

test('launch scripts use configured localhost port and browser opens after server listens', async () => {
  const appRoot = path.join(__dirname, '..', '__hledgerui');
  const [bat, sh, server] = await Promise.all([
    fs.readFile(path.join(appRoot,'start.bat'), 'utf8'),
    fs.readFile(path.join(appRoot,'start.sh'), 'utf8'),
    fs.readFile(path.join(appRoot,'server.js'), 'utf8')
  ]);
  for (const launcher of [bat, sh]) {
    assert.match(launcher, /HLEDGER_PORT/);
    assert.match(launcher, /--port/);
    assert.match(launcher, /--open/);
    assert.match(launcher, /server\.js/);
  }
  assert.match(bat, /data\\node\\win-x64\\active.txt/);
  assert.match(server, /Start-Process -FilePath/);
  assert.ok(server.indexOf("app.server.listen(port") < server.indexOf("if (args.includes('--open'))"));
});

test('Settings exposes all paths and rejects unsafe custom executable paths',async t=>{
 const {call,workspace,configDir}=await fixture(t);
 const status=(await call('GET','status')).body;
 for(const component of ['node','hledger','git']){
   assert.ok(['system','bundle','custom'].includes(status.runtime.components[component].mode));
   assert.ok(typeof status.runtime.components[component].systemPath==='string');
   assert.ok(typeof status.runtime.components[component].bundlePath==='string');
 }
 const bad=await call('POST','component',{component:'git',mode:'custom',executable:'../git.exe'});
 assert.equal(bad.status,400);
 const invalid=await call('POST','component',{component:'git',mode:'custom',executable:process.execPath});
 assert.equal(invalid.status,422);
 const node=await call('POST','component',{component:'node',mode:'custom',executable:process.execPath});
 assert.equal(node.status,200,JSON.stringify(node.body));
 assert.equal(node.body.restartRequired,true);
 const after=(await call('GET','status')).body;
 assert.equal(after.runtime.components.node.mode,'custom');
 assert.equal(after.runtime.components.node.customPath,process.execPath);
 const logs=(await call('GET','console?after=0')).body;
 assert.ok(logs.entries.some(x=>x.message.includes('node')));
 assert.equal(logs.running,null);
 // Runtime settings do not leak into the user's accounting journal.
 assert.equal((await fs.readdir(workspace).catch(()=>[])).includes('preferences.json'),false);
 assert.ok((await fs.readFile(path.join(configDir,'preferences.json'),'utf8')).includes('node'));
});

test('a new accounting profile creates a separate, discoverable year structure and can be selected',async t=>{
 const {call,workspace}=await fixture(t);
 const label='QA'+Date.now().toString(36);
 const made=await call('POST','profile-create',{name:label,year:'2026'});
 assert.equal(made.status,200,JSON.stringify(made.body));
 const file=path.join(made.body.workspace,'books','years','2026','transactions.journal');
 assert.match(await fs.readFile(file,'utf8'),/2026/);
 assert.ok(made.body.workspace!==workspace);
 const p=(await call('GET','profiles')).body;
 assert.equal(p.current,workspace);
 assert.ok(p.profiles.some(x=>x.id===made.body.id));
 const switched=await call('POST','profile-select',{id:made.body.id});
 assert.equal(switched.status,200);
 assert.equal(switched.body.restartRequired,true);
 const s=(await call('GET','status')).body;
 assert.equal(s.profile.active,made.body.id);
 assert.equal(s.profile.current,workspace);
 await fs.rm(made.body.workspace,{recursive:true,force:true});
});

test('the command console and tab lifecycle are access controlled',async t=>{
 const {call,base}=await fixture(t);
 assert.equal((await call('POST','client-attach',{id:'tab_abcdef1234'})).status,200);
 assert.equal((await call('POST','client-detach',{id:'tab_abcdef1234'})).status,200);
 assert.equal((await call('POST','client-attach',{id:'!bad'})).status,400);
 const attempt=await fetch(base+'/api/runtime-update',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"component":"git"}'});
 assert.equal(attempt.status,403);
 const page=await (await fetch(base+'/')).text();
 for(const id of ['command-console','console-output','component-mode-node','component-mode-hledger','component-mode-git','profile-card','profile-select'])
   assert.match(page,new RegExp('id="'+id+'"'));
 assert.doesNotMatch(page,/id="configure-hledger-btn"/);
 assert.doesNotMatch(page,/Start a separate updater for node/);
});

test('updater supports pinned Git bundle and preserves the full archive layout',async()=>{
 const root=path.join(__dirname,'..','__hledgerui');
 const manifest=require('../__hledgerui/runtime-manifest.json');
 assert.equal(manifest.git.version,'2.56.1');
 assert.match(manifest.git['windows-x64'].sha256,/^[0-9a-f]{64}$/);
 const script=await fs.readFile(path.join(root,'scripts','update-runtime.ps1'),'utf8');
 assert.match(script,/ValidateSet\('node', 'hledger', 'git'\)/);
 assert.match(script,/cmd\\git.exe/);
 assert.match(script,/SHA-256 verified/);
 assert.match(script,/Move-Item -LiteralPath \$unpack -Destination \$payload/);
 assert.doesNotMatch(script,/Wait-Process/);
 const builder=await fs.readFile(path.join(root,'scripts','build-portable-windows.ps1'),'utf8');
 assert.match(builder,/Component git -Unattended/);
 assert.doesNotMatch(builder,/Join-Path \$appRoot 'data'\) -Destination \$packageRoot/);
});
