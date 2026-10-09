// Unit test for app/finalize-check.js (run: node --test tests/finalize-check.test.js)
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { finalizeOnly } = require('../app/finalize-check.js');

const D = 'co';
const name = (n) => path.join(D, 'FAR_x_FY2025-' + n);
const v1 = name('v1.xlsx');
const v2 = name('v2.xlsx');
const v3 = name('v3.xlsx');
const fin = name('final.xlsx');
const rec = name('final.record.txt');
// the record text a real run would hold: it names the version and says the user approved
const read = (text) => () => text + ' / 사용자 승인';
const code = (r) => [r.ok, r.code];

test('approved version copied as -final with a record naming it: ok', () => {
  const approved = { [v2]: 'h2', [v3]: 'h3' };
  const after = { [v2]: 'h2', [v3]: 'h3', [fin]: 'h3', [rec]: 'r1' };
  assert.deepStrictEqual(finalizeOnly(approved, after, read('approved: FAR_x_FY2025-v3.xlsx')), { ok: true });
});

test('replacing an older -final (same file names) is ok', () => {
  const approved = { [v3]: 'h3', [fin]: 'old', [rec]: 'oldrec' };
  const after = { [v3]: 'h3', [fin]: 'h3', [rec]: 'newrec' };
  assert.strictEqual(finalizeOnly(approved, after, read('FAR_x_FY2025-v3')).ok, true);
});

test('final differs from the approved version: not ok', () => {
  assert.deepStrictEqual(code(finalizeOnly({ [v3]: 'h3' }, { [v3]: 'h3', [fin]: 'other', [rec]: 'r' }, read('FAR_x_FY2025-v3'))), [false, 'FINAL_DIFFERS']);
});

test('an OLDER version copied as final is not the approved version: not ok', () => {
  const approved = { [v1]: 'h1', [v2]: 'h2', [v3]: 'h3' };
  const after = { ...approved, [fin]: 'h1', [rec]: 'r' };
  assert.deepStrictEqual(code(finalizeOnly(approved, after, read('approved FAR_x_FY2025-v1.xlsx'))), [false, 'FINAL_DIFFERS']);
});

test('record missing: not ok', () => {
  assert.deepStrictEqual(code(finalizeOnly({ [v3]: 'h3' }, { [v3]: 'h3', [fin]: 'h3' }, read(''))), [false, 'RECORD_MISSING']);
});

test('record does not name the approved version: not ok', () => {
  assert.deepStrictEqual(code(finalizeOnly({ [v3]: 'h3' }, { [v3]: 'h3', [fin]: 'h3', [rec]: 'r' }, read('approved v2 only'))), [false, 'RECORD_VERSION']);
});

test('record names v10 while the approved version is v1: not ok (no substring match)', () => {
  const r = finalizeOnly({ [v1]: 'h1' }, { [v1]: 'h1', [fin]: 'h1', [rec]: 'r' }, read('approved FAR_x_FY2025-v10.xlsx'));
  assert.deepStrictEqual(code(r), [false, 'RECORD_VERSION']);
});

test('record names the version followed by the extension or punctuation: ok', () => {
  const r = finalizeOnly({ [v1]: 'h1' }, { [v1]: 'h1', [fin]: 'h1', [rec]: 'r' }, read('`FAR_x_FY2025-v1`, FAR_x_FY2025-v1.xlsx'));
  assert.strictEqual(r.ok, true);
});

test('record does not mention the user: not ok', () => {
  const r = finalizeOnly({ [v3]: 'h3' }, { [v3]: 'h3', [fin]: 'h3', [rec]: 'r' }, () => 'approved FAR_x_FY2025-v3.xlsx only');
  assert.deepStrictEqual(code(r), [false, 'RECORD_USER']);
});

test('record unreadable: not ok', () => {
  const r = finalizeOnly({ [v3]: 'h3' }, { [v3]: 'h3', [fin]: 'h3', [rec]: 'r' }, () => { throw new Error('x'); });
  assert.deepStrictEqual(code(r), [false, 'RECORD_UNREADABLE']);
});

test('the approved version itself changed: not ok (new information, review again)', () => {
  assert.deepStrictEqual(code(finalizeOnly({ [v3]: 'h3' }, { [v3]: 'h3b', [fin]: 'h3b', [rec]: 'r' }, read('FAR_x_FY2025-v3'))), [false, 'OTHER_CHANGED']);
});

test('a new version file appears: not ok', () => {
  const v4 = name('v4.xlsx');
  assert.deepStrictEqual(code(finalizeOnly({ [v3]: 'h3' }, { [v3]: 'h3', [v4]: 'h4', [fin]: 'h4', [rec]: 'r' }, read('FAR_x_FY2025-v4'))), [false, 'OTHER_CHANGED']);
});

test('an approved file was removed: not ok', () => {
  assert.deepStrictEqual(code(finalizeOnly({ [v3]: 'h3', [v2]: 'h2' }, { [v3]: 'h3', [fin]: 'h3', [rec]: 'r' }, read('FAR_x_FY2025-v3'))), [false, 'OTHER_CHANGED']);
});

test('nothing changed: not ok (nothing was finalized)', () => {
  assert.deepStrictEqual(code(finalizeOnly({ [v3]: 'h3' }, { [v3]: 'h3' }, read(''))), [false, 'NO_CHANGE']);
});

test('only a record changed, no final file: not ok', () => {
  assert.deepStrictEqual(code(finalizeOnly({ [v3]: 'h3' }, { [v3]: 'h3', [rec]: 'r' }, read('FAR_x_FY2025-v3'))), [false, 'NO_FINAL']);
});

test('a different file next to the final is not accepted', () => {
  const other = path.join(D, 'notes.txt');
  assert.deepStrictEqual(code(finalizeOnly({ [v3]: 'h3' }, { [v3]: 'h3', [other]: 'x' }, read(''))), [false, 'OTHER_CHANGED']);
});

test('v2 and v3 have identical bytes and the record names v3: ok', () => {
  const approved = { [v2]: 'same', [v3]: 'same' };
  assert.deepStrictEqual(finalizeOnly(approved, { ...approved, [fin]: 'same', [rec]: 'r' }, read('FAR_x_FY2025-v3.xlsx')), { ok: true });
});

test('v2 and v3 have identical bytes and the record names v2: ok (same content)', () => {
  const approved = { [v2]: 'same', [v3]: 'same' };
  assert.deepStrictEqual(finalizeOnly(approved, { ...approved, [fin]: 'same', [rec]: 'r' }, read('FAR_x_FY2025-v2.xlsx')), { ok: true });
});

test('another stem\'s approval record changed in the same turn: not ok', () => {
  const otherRec = path.join('co2', 'FAR_y_FY2025-final.record.txt');
  const approved = { [v3]: 'h3', [otherRec]: 'old' };
  const after = { [v3]: 'h3', [fin]: 'h3', [rec]: 'r', [otherRec]: 'tampered' };
  assert.deepStrictEqual(code(finalizeOnly(approved, after, read('FAR_x_FY2025-v3'))), [false, 'OTHER_CHANGED']);
});

test('reviewed file is the top version: ok', () => {
  const approved = { [v1]: 'h1', [v2]: 'h2' };
  const after = { ...approved, [fin]: 'h2', [rec]: 'r' };
  assert.deepStrictEqual(finalizeOnly(approved, after, read('FAR_x_FY2025-v2.xlsx'), v2), { ok: true });
});

test('a higher version that was not the reviewed file is not accepted as approved', () => {
  const v9 = name('v9.xlsx');
  const approved = { [v1]: 'h1', [v9]: 'h9' };
  const after = { ...approved, [fin]: 'h9', [rec]: 'r' };
  assert.deepStrictEqual(code(finalizeOnly(approved, after, read('FAR_x_FY2025-v9.xlsx'), v1)), [false, 'NOT_REVIEWED']);
  assert.deepStrictEqual(finalizeOnly(approved, after, read('FAR_x_FY2025-v9.xlsx'), null), { ok: true }); // no reviewed file known: old behaviour
});

test('reviewed file has the same bytes as the top version (identical re-run): ok', () => {
  const approved = { [v2]: 'same', [v3]: 'same' };
  const after = { ...approved, [fin]: 'same', [rec]: 'r' };
  assert.strictEqual(finalizeOnly(approved, after, read('FAR_x_FY2025-v3.xlsx'), v2).ok, true);
});
