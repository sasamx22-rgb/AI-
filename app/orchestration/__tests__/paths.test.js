'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { isPathInside, sanitizeFilename, resolveNonCollidingPath } = require('../core/paths');
const fs = require('fs');
const os = require('os');

test('I(경로 검증 유닛): isPathInside는 baseDir 밖으로 나가는 경로를 거부한다', () => {
  const base = path.join(os.tmpdir(), 'base-dir');
  assert.equal(isPathInside(base, path.join(base, 'child.txt')), true);
  assert.equal(isPathInside(base, path.join(base, 'sub', 'child.txt')), true);
  assert.equal(isPathInside(base, path.join(base, '..', 'outside.txt')), false);
  assert.equal(isPathInside(base, path.join(base, '..', 'base-dir-evil', 'x.txt')), false);
});

test('I: sanitizeFilename은 경로 조작(../, 절대경로, 구분자)을 제거한다', () => {
  assert.equal(sanitizeFilename('../../etc/passwd'), 'passwd');
  assert.equal(sanitizeFilename('..\\..\\windows\\system32\\evil.exe'), 'evil.exe');
  assert.equal(sanitizeFilename('C:\\Windows\\System32\\evil.exe'), 'evil.exe');
  assert.equal(sanitizeFilename('정상파일명.xlsx'), '정상파일명.xlsx');
  assert.equal(sanitizeFilename('...hidden'), 'hidden');
});

test('동일 파일명 업로드 시 기존 파일을 덮어쓰지 않고 -1, -2 접미사를 붙인다', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'collision-test-'));
  try {
    const p1 = resolveNonCollidingPath(dir, 'a.txt');
    fs.writeFileSync(p1, 'first');
    const p2 = resolveNonCollidingPath(dir, 'a.txt');
    assert.notEqual(p1, p2);
    fs.writeFileSync(p2, 'second');
    const p3 = resolveNonCollidingPath(dir, 'a.txt');
    assert.notEqual(p3, p1);
    assert.notEqual(p3, p2);
    assert.equal(fs.readFileSync(p1, 'utf8'), 'first');
    assert.equal(fs.readFileSync(p2, 'utf8'), 'second');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
