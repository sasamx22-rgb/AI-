// Flow test for the "after the user answers the approval items" path of app/server.js, with a fake `claude` CLI
// (run: node --test tests/flow-finalize.test.js). It checks the ORDER of model calls only (A = Amy, J = James);
// it does not say anything about real agent behaviour. Windows only (the fake is a claude.cmd).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const APP = path.join(__dirname, '..', 'app');
const FAKE = path.join(__dirname, 'fixtures', 'fake-claude');
const skip = process.platform !== 'win32' ? 'needs claude.cmd (Windows)' : false;

async function run(label, answers, first = 'WRITE 정산표 만들어줘') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-' + label + '-'));
  fs.mkdirSync(path.join(root, 'app'));
  for (const f of ['server.js', 'finalize-check.js']) fs.copyFileSync(path.join(APP, f), path.join(root, 'app', f));
  const port = String(5100 + Math.floor(Math.random() * 800));
  const env = { ...process.env, PORT: port, FAKE_ROOT: root, NODE_PATH: path.join(APP, 'node_modules'), PATH: FAKE + path.delimiter + process.env.PATH };
  const srv = spawn(process.execPath, ['server.js'], { cwd: path.join(root, 'app'), env });
  let log = '';
  srv.stdout.on('data', (d) => { log += d; });
  srv.stderr.on('data', (d) => { log += d; });
  try {
    for (let i = 0; i < 75 && !log.includes('준비됐습니다'); i++) await new Promise((r) => setTimeout(r, 200));
    const post = async (m) => (await fetch('http://127.0.0.1:' + port + '/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: m }) })).text();
    const texts = [await post(first)];
    for (const a of answers) texts.push(await post('확인 질문 답변: 승인합니다 ' + a));
    const calls = fs.readFileSync(path.join(root, 'calls.log'), 'utf8').trim().split('\n').map((c) => (c === 'executor' ? 'A' : 'J')).join('');
    return { calls, skipped: texts.some((t) => t.includes('제임스 재검토는 생략')) };
  } finally {
    // wait for the server to exit before removing the directory it runs in (Windows keeps it locked until then)
    await new Promise((resolve) => { srv.once('exit', resolve); srv.kill(); setTimeout(resolve, 3000); });
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('exact copy + record naming the approved version: no second James review, no second finalization', { skip }, async () => {
  assert.deepStrictEqual(await run('good', ['SCEN=GOOD']), { calls: 'AJAA', skipped: true });
});
test('copy differs from the approved version: James reviews again', { skip }, async () => {
  assert.deepStrictEqual(await run('bad', ['SCEN=BADCOPY']), { calls: 'AJAAJA', skipped: false });
});
test('record missing: James reviews again', { skip }, async () => {
  assert.deepStrictEqual(await run('norec', ['SCEN=NORECORD']), { calls: 'AJAAJA', skipped: false });
});
test('a new version appears: James reviews again', { skip }, async () => {
  assert.deepStrictEqual(await run('newver', ['SCEN=NEWVER']), { calls: 'AJAAJA', skipped: false });
});
test('Amy asks one more question first, then the exact copy arrives: still no repeat', { skip }, async () => {
  assert.deepStrictEqual(await run('again', ['SCEN=ASKAGAIN', 'SCEN=GOOD']), { calls: 'AJAAA', skipped: true });
});

test('James rejected, the user answers in two steps, then no file changes: James still re-reviews', { skip }, async () => {
  assert.deepStrictEqual(await run('resume', ['SCEN=ASKAGAIN', 'SCEN=PLAIN'], 'WRITE REJECT 정산표 만들어줘'), { calls: 'AJAAAJA', skipped: false });
});
