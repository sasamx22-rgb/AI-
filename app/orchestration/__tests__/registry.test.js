'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getDepartment, DepartmentNotImplementedError, listDepartments } = require('../core/registry');

test('Document Department는 등록되어 있다', () => {
  assert.deepEqual(listDepartments(), ['document']);
  const dept = getDepartment('document');
  assert.equal(dept.id, 'document');
});

test('미구현 department(research 등) 요청 시 명확한 안내 메시지를 던진다', () => {
  assert.throws(() => getDepartment('research'), (err) => {
    assert.ok(err instanceof DepartmentNotImplementedError);
    assert.match(err.message, /Document Department만/);
    return true;
  });
});

test('전혀 모르는 taskType은 다른 문구(알 수 없는 taskType)로 구분해서 알려준다', () => {
  assert.throws(() => getDepartment('foobar'), /알 수 없는 taskType/);
});
