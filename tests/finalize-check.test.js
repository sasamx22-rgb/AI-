// Unit test for app/finalize-check.js (run: node --test tests/finalize-check.test.js)
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { finalizeOnly } = require('../app/finalize-check.js');

const D = 'co';
const v3 = path.join(D, 'FAR_x_FY2025-v3.xlsx');
const v2 = path.join(D, 'FAR_x_FY2025-v2.xlsx');
const fin = path.join(D, 'FAR_x_FY2025-final.xlsx');
const rec = path.join(D, 'FAR_x_FY2025-final.record.txt');
const read = (text) => () => text;

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

test('final differs from every approved version: not ok', () => {
  const r = finalizeOnly({ [v3]: 'h3' }, { [v3]: 'h3', [fin]: 'other', [rec]: 'r' }, read('FAR_x_FY2025-v3'));
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'FINAL_DIFFERS');
});

test('record missing: not ok', () => {
  const r = finalizeOnly({ [v3]: 'h3' }, { [v3]: 'h3', [fin]: 'h3' }, read(''));
  assert.deepStrictEqual([r.ok, r.code], [false, 'RECORD_MISSING']);
});

test('record does not name the approved version: not ok', () => {
  const r = finalizeOnly({ [v3]: 'h3' }, { [v3]: 'h3', [fin]: 'h3', [rec]: 'r' }, read('approved v2 only'));
  assert.deepStrictEqual([r.ok, r.code], [false, 'RECORD_VERSION']);
});

test('record unreadable: not ok', () => {
  const r = finalizeOnly({ [v3]: 'h3' }, { [v3]: 'h3', [fin]: 'h3', [rec]: 'r' }, () => { throw new Error('x'); });
  assert.deepStrictEqual([r.ok, r.code], [false, 'RECORD_UNREADABLE']);
});

test('the approved version itself changed: not ok (new information, review again)', () => {
  const r = finalizeOnly({ [v3]: 'h3' }, { [v3]: 'h3b', [fin]: 'h3b', [rec]: 'r' }, read('FAR_x_FY2025-v3'));
  assert.deepStrictEqual([r.ok, r.code], [false, 'OTHER_CHANGED']);
});

test('a new version file appears: not ok', () => {
  const v4 = path.join(D, 'FAR_x_FY2025-v4.xlsx');
  const r = finalizeOnly({ [v3]: 'h3' }, { [v3]: 'h3', [v4]: 'h4', [fin]: 'h4', [rec]: 'r' }, read('FAR_x_FY2025-v4'));
  assert.deepStrictEqual([r.ok, r.code], [false, 'OTHER_CHANGED']);
});

test('an approved file was removed: not ok', () => {
  const r = finalizeOnly({ [v3]: 'h3', [v2]: 'h2' }, { [v3]: 'h3', [fin]: 'h3', [rec]: 'r' }, read('FAR_x_FY2025-v3'));
  assert.deepStrictEqual([r.ok, r.code], [false, 'OTHER_CHANGED']);
});

test('nothing changed: not ok (nothing was finalized)', () => {
  const r = finalizeOnly({ [v3]: 'h3' }, { [v3]: 'h3' }, read(''));
  assert.deepStrictEqual([r.ok, r.code], [false, 'NO_CHANGE']);
});

test('only a record changed, no final file: not ok', () => {
  const r = finalizeOnly({ [v3]: 'h3' }, { [v3]: 'h3', [rec]: 'r' }, read('FAR_x_FY2025-v3'));
  assert.deepStrictEqual([r.ok, r.code], [false, 'NO_FINAL']);
});

test('a different file type next to the final is not accepted as final', () => {
  const other = path.join(D, 'notes.txt');
  const r = finalizeOnly({ [v3]: 'h3' }, { [v3]: 'h3', [other]: 'x' }, read(''));
  assert.deepStrictEqual([r.ok, r.code], [false, 'OTHER_CHANGED']);
});

test('v2 and v3 have identical bytes and the record names v3: ok', () => {
  const approved = { [v2]: 'same', [v3]: 'same' };
  const after = { [v2]: 'same', [v3]: 'same', [fin]: 'same', [rec]: 'r' };
  assert.deepStrictEqual(finalizeOnly(approved, after, read('FAR_x_FY2025-v3.xlsx')), { ok: true });
});
