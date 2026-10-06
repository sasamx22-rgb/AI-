'use strict';

// Department Registry — taskType 문자열을 실제 department 구현 모듈에 연결한다.
// 이번 V2에서 실제로 구현된 department는 'document' 하나뿐이다. 앞으로
// research/spreadsheet/presentation/coding 등을 추가할 때는 각자
// app/orchestration/departments/<name>/ 아래에 같은 모양의 모듈을 만들고
// 여기 REGISTRY에 한 줄 추가하면 된다 — core는 department의 내부를 몰라도 된다.
const documentDepartment = require('../departments/document');

const REGISTRY = {
  document: documentDepartment,
};

// 사용자가 실제로 요청할 법하지만 아직 구현되지 않은 department들을 명시적으로
// 안다고 표시해둔다 — orchestrator가 "모르는 요청"과 "아직 지원 안 하는 요청"을
// 구분해서 사용자에게 다른 메시지를 줄 수 있게 하기 위함이다.
const KNOWN_UNIMPLEMENTED = ['research', 'spreadsheet', 'presentation', 'coding', 'email', 'file_management'];

class DepartmentNotImplementedError extends Error {
  constructor(taskType) {
    const known = KNOWN_UNIMPLEMENTED.includes(taskType);
    super(
      known
        ? `현재 V2에서는 Document Department만 자동 orchestration 대상으로 지원합니다. ('${taskType}' department는 아직 구현되지 않았습니다.)`
        : `알 수 없는 taskType입니다: '${taskType}'. 현재 V2에서는 'document'만 자동 orchestration 대상으로 지원합니다.`
    );
    this.name = 'DepartmentNotImplementedError';
    this.taskType = taskType;
    this.known = known;
  }
}

function getDepartment(taskType) {
  const dept = REGISTRY[taskType];
  if (!dept) throw new DepartmentNotImplementedError(taskType);
  return dept;
}

function listDepartments() {
  return Object.keys(REGISTRY);
}

module.exports = {
  REGISTRY,
  KNOWN_UNIMPLEMENTED,
  DepartmentNotImplementedError,
  getDepartment,
  listDepartments,
};
