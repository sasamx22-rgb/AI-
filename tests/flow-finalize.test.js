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
  for (const [name, text] of Object.entries(opts.preFiles || {})) {
    fs.mkdirSync(path.join(root, 'outputs', 'co'), { recursive: true });
    fs.writeFileSync(path.join(root, 'outputs', 'co', name), text);
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
  assert.ok(p.includes('위에 지정된 파일') && !p.includes('최신 산출물'), 'no competing "latest output" instruction');
  assert.ok(p.includes('경로가 위 산출물과 같고 saved: True라는 것뿐'), 'states only what the app verified');
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

test('a never-reviewed older v9 copied as the final is not accepted as the approved version: James reviews again', { skip }, async () => {
  const r = await run('oldv9', ['SCEN=OLDV9'], 'WRITE 정산표 만들어줘', { preFiles: { 'FAR_x_FY2025-v9.xlsx': 'V9-bytes' } });
  assert.strictEqual(r.calls, 'AJAAJA');
  assert.strictEqual(r.skipped, false);
});
test('Amy makes v3 while asking one more question, then the answer changes no file: James gets v3 and no re-run is requested', { skip }, async () => {
  const r = await run('v3', ['SCEN=V3ASK', 'SCEN=PLAIN'], 'WRITE REJECT 정산표 만들어줘');
  assert.strictEqual(r.calls, 'AJAAAJA');
  const last = r.prompts[r.prompts.length - 1];
  assert.ok(last.includes('정산표 검토 대상: outputs/co/FAR_x_FY2025-v3.xlsx'), 'target is v3');
  assert.ok(last.includes('outputs/co/FAR_x_FY2025-v3.xlsx'), 'v3 in the changed list');
});
test('gate no longer matches a version James already reviewed: no overwrite instruction, James is not called again', { skip }, async () => {
  const r = await run('flip', [], 'WRITE REJECT GATEFLIP 정산표 만들어줘');
  assert.strictEqual(r.calls, 'AJA');
  assert.ok(r.all.includes('제임스가 이미 검토한'));
  assert.ok(!r.all.includes('덮어써도 됩니다'));
});
test('two companies changed in one turn: no review is started', { skip }, async () => {
  const r = await run('twocos', [], 'WRITE TWOCOS 정산표 만들어줘');
  assert.strictEqual(r.calls, 'A');
  assert.ok(r.all.includes('여러 회사'));
});
test('only another company\'s final changes: the earlier target is not carried over', { skip }, async () => {
  const r = await run('otherfinal', ['SCEN=OTHERFINAL']);
  assert.strictEqual(r.calls, 'AJAAJA');
  const last = r.prompts[r.prompts.length - 1];
  assert.ok(last.includes('FAR_y_FY2025-final'), 'the other final is listed');
  assert.ok(!last.includes('정산표 검토 대상'), 'no FAR target of the first company');
});
test('no gate.txt (individual tool path): Amy is not sent back, James is told there is no fast-path evidence', { skip }, async () => {
  const r = await run('nogate', [], 'WRITE NOGATE 정산표 만들어줘');
  assert.strictEqual(r.calls, 'AJA');
  assert.ok(r.prompts[0].includes('gate.txt가 없습니다') && r.prompts[0].includes('[FAR 검토 체크리스트]'));
});
