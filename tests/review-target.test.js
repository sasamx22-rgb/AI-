// Unit test for app/review-target.js (run: node --test tests/review-target.test.js)
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { changedFiles, farTarget, artifactStatus } = require('../app/review-target.js');

const art = path.resolve('C:\\work\\outputs\\aaa\\FAR_aaa_FY2025-v2.xlsx');
const gate = (p, saved) => `\uFEFFGATE: PASS\r\nARTIFACT: ${p}  (run 2026-10-07 14:03; saved: ${saved})\r\nINFO tie OK/DIFF: 10/0\r\n`;

test('changedFiles lists added and changed files, not removed or unchanged ones', () => {
  const before = { a: '1', b: '2', c: '3' };
  const after = { a: '1', b: '2x', d: '4' };
  assert.deepStrictEqual(changedFiles(before, after), ['b', 'd']);
});

test('farTarget reads company, year and version from a FAR version file', () => {
  const t = farTarget(path.join('aaa', 'FAR_aaa_FY2025-v12.xlsx'));
  assert.deepStrictEqual(t, { abbr: 'aaa', fy: '2025', version: 12, verifyRel: 'companies/aaa/FY2025/verify' });
});

test('farTarget allows underscores in the company abbreviation', () => {
  assert.strictEqual(farTarget(path.join('a_b', 'FAR_a_b_FY2024-v1.xlsx')).abbr, 'a_b');
});

test('farTarget ignores finals, records, other files', () => {
  for (const f of ['aaa/FAR_aaa_FY2025-final.xlsx', 'aaa/FAR_aaa_FY2025-final.record.txt', 'aaa/report-v1.docx', 'aaa/FAR_aaa_FY2025-v2.xlsx.work.xlsx']) {
    assert.strictEqual(farTarget(f), null, f);
  }
});

test('artifactStatus: gate names this artifact and it was saved', () => {
  assert.deepStrictEqual(artifactStatus(gate(art, 'True'), art), { ok: true });
});

test('artifactStatus: path comparison ignores case and slash style', () => {
  const same = art.toUpperCase().replace(/\\/g, '/');
  assert.strictEqual(artifactStatus(gate(same, 'True'), art).ok, process.platform === 'win32');
});

test('artifactStatus: gate belongs to another file', () => {
  const other = path.resolve('C:\\work\\outputs\\aaa\\FAR_aaa_FY2025-v1.xlsx');
  assert.deepStrictEqual(artifactStatus(gate(other, 'True'), art), { ok: false, code: 'OTHER_ARTIFACT' });
});

test('artifactStatus: dry run / not saved', () => {
  assert.deepStrictEqual(artifactStatus(gate(art, 'False'), art), { ok: false, code: 'NOT_SAVED' });
});

test('artifactStatus: no ARTIFACT line, or no gate file', () => {
  assert.deepStrictEqual(artifactStatus('GATE: PASS\r\n', art), { ok: false, code: 'NO_ARTIFACT' });
  assert.deepStrictEqual(artifactStatus(null, art), { ok: false, code: 'NO_GATE' });
});
