// Flow tests for app/server.js with a fake `claude` CLI (run: node --test tests/flow-finalize.test.js).
// They check the ORDER of model calls (A = Amy, J = James) and what the review request contains; they say nothing about
// real agent behaviour. Windows only (the fake is a claude.cmd).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const REPO = path.join(__dirname, '..');
const APP = path.join(REPO, 'app');
const FAKE = path.join(__dirname, 'fixtures', 'fake-claude');
const CHECKLIST = path.join('.claude', 'skills', 'far-analytical', 'review-checklist.md');
const skip = process.platform !== 'win32' ? 'needs claude.cmd (Windows)' : false;

async function run(label, answers, first = 'WRITE 정산표 만들어줘', opts = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-' + label + '-'));
  fs.mkdirSync(path.join(root, 'app'));
  for (const f of ['server.js', 'finalize-check.js', 'review-target.js']) fs.copyFileSync(path.join(APP, f), path.join(root, 'app', f));
  if (!opts.noChecklist) {
    fs.mkdirSync(path.dirname(path.join(root, CHECKLIST)), { recursive: true });
    fs.copyFileSync(path.join(REPO, CHECKLIST), path.join(root, CHECKLIST));
  }
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
    const read = (n) => (fs.existsSync(path.join(root, n)) ? fs.readFileSync(path.join(root, n), 'utf8').trim().split('\n') : []);
    const calls = read('calls.log').map((c) => (c === 'executor' ? 'A' : 'J')).join('');
    const prompts = read('review-prompts.log').map((l) => JSON.parse(l));
    return { calls, skipped: texts.some((t) => t.includes('제임스 재검토는 생략')), prompts, all: texts.join('\n') };
  } finally {
    // wait for the server to exit before removing the directory it runs in (Windows keeps it locked until then)
    await new Promise((resolve) => { srv.once('exit', resolve); srv.kill(); setTimeout(resolve, 3000); });
    fs.rmSync(root, { recursive: true, force: true });
  }
}
const order = async (...args) => { const r = await run(...args); return { calls: r.calls, skipped: r.skipped }; };

test('exact copy + record naming the approved version: no second James review, no second finalization', { skip }, async () => {
  assert.deepStrictEqual(await order('good', ['SCEN=GOOD']), { calls: 'AJAA', skipped: true });
});
test('copy differs from the approved version: James reviews again', { skip }, async () => {
  assert.deepStrictEqual(await order('bad', ['SCEN=BADCOPY']), { calls: 'AJAAJA', skipped: false });
});
test('record missing: James reviews again', { skip }, async () => {
  assert.deepStrictEqual(await order('norec', ['SCEN=NORECORD']), { calls: 'AJAAJA', skipped: false });
});
test('a new version appears: James reviews again', { skip }, async () => {
  assert.deepStrictEqual(await order('newver', ['SCEN=NEWVER']), { calls: 'AJAAJA', skipped: false });
});
test('Amy asks one more question first, then the exact copy arrives: still no repeat', { skip }, async () => {
  assert.deepStrictEqual(await order('again', ['SCEN=ASKAGAIN', 'SCEN=GOOD']), { calls: 'AJAAA', skipped: true });
});
test('James rejected, the user answers in two steps, then no file changes: James still re-reviews', { skip }, async () => {
  assert.deepStrictEqual(await order('resume', ['SCEN=ASKAGAIN', 'SCEN=PLAIN'], 'WRITE REJECT 정산표 만들어줘'), { calls: 'AJAAAJA', skipped: false });
});

test('the review request names the changed file, the verify folder and carries the FAR checklist', { skip }, async () => {
  const r = await run('target', []);
  assert.strictEqual(r.prompts.length, 1);
  const p = r.prompts[0];
  assert.ok(p.includes('outputs/co/FAR_x_FY2025-v1.xlsx'), 'changed file');
  assert.ok(p.includes('companies/x/FY2025/verify/'), 'verify folder');
  assert.ok(p.includes('[FAR 검토 체크리스트]') && p.includes('원본 합계 5~7개'), 'checklist text from the skill folder');
  assert.ok(p.includes('통과/실패/미검증'), 'per-item table requested');
});
test('gate.txt belongs to another file: Amy is sent back once, then James reviews', { skip }, async () => {
  const r = await run('gatemiss', [], 'WRITE GATEMISS 정산표 만들어줘');
  assert.strictEqual(r.calls, 'AAJA');
  assert.ok(r.all.includes('검증 자료(gate.txt)가 이번 산출물과 맞지 않아'));
});
test('gate.txt still wrong after the bounce: James is not called', { skip }, async () => {
  const r = await run('gatestuck', [], 'WRITE GATESTUCK 정산표 만들어줘');
  assert.strictEqual(r.calls, 'AA');
  assert.ok(r.all.includes('제임스 검토를 시작하지 않습니다'));
});
test('FAR checklist file missing: James is not called', { skip }, async () => {
  const r = await run('nochecklist', [], 'WRITE 정산표 만들어줘', { noChecklist: true });
  assert.strictEqual(r.calls, 'A');
  assert.ok(r.all.includes('체크리스트 파일'));
});
