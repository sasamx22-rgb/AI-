'use strict';

// 범용 Job 상태 머신. Document Department뿐 아니라 앞으로 추가될 모든
// Department가 이 표를 그대로 재사용한다 (department별 특수 상태가 필요해지면
// 그때 department 모듈이 자기 하위 상태를 이 상태들 "안에서" 관리하도록
// 확장하고, 이 표 자체는 건드리지 않는 것을 원칙으로 한다).
const STATES = Object.freeze({
  CREATED: 'CREATED',
  INTAKE: 'INTAKE',
  WAITING_FOR_USER: 'WAITING_FOR_USER',
  SOURCE_ANALYSIS: 'SOURCE_ANALYSIS',
  PLANNING: 'PLANNING',
  DRAFTING: 'DRAFTING',
  VALIDATING: 'VALIDATING',
  REVIEWING: 'REVIEWING',
  REVISING: 'REVISING',
  QA: 'QA',
  AWAITING_USER_APPROVAL: 'AWAITING_USER_APPROVAL',
  FINALIZING: 'FINALIZING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
});

const TRANSITIONS = {
  CREATED: ['INTAKE'],
  INTAKE: ['WAITING_FOR_USER', 'SOURCE_ANALYSIS', 'FAILED'],
  WAITING_FOR_USER: ['SOURCE_ANALYSIS', 'FAILED'],
  SOURCE_ANALYSIS: ['PLANNING', 'FAILED'],
  PLANNING: ['DRAFTING', 'FAILED'],
  DRAFTING: ['VALIDATING', 'FAILED'],
  VALIDATING: ['DRAFTING', 'REVIEWING', 'FAILED'],
  REVIEWING: ['REVISING', 'QA', 'FAILED'],
  REVISING: ['VALIDATING', 'FAILED'],
  QA: ['REVISING', 'AWAITING_USER_APPROVAL', 'FINALIZING', 'FAILED'],
  AWAITING_USER_APPROVAL: ['REVISING', 'FINALIZING', 'FAILED'],
  FINALIZING: ['COMPLETED', 'FAILED'],
  COMPLETED: [],
  FAILED: [],
};

class StateTransitionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'StateTransitionError';
  }
}

function canTransition(from, to) {
  const allowed = TRANSITIONS[from];
  return Array.isArray(allowed) && allowed.includes(to);
}

// guard(job) -> { ok: boolean, reason?: string } 형태의 가드 함수를 등록해두면
// applyTransition이 실제 전이 전에 실행해서 실패 시 전이를 거부한다.
// job.finalize처럼 "전이 자체가 부수효과(파일 복사 등)를 요구하는" 경우는
// 이 함수가 아니라 department 모듈이 직접 처리하고, 성공했을 때만
// applyTransition을 호출해야 한다 — 즉 COMPLETED로의 전이는 이 함수 밖에서
// 실제 파일 존재가 확인된 뒤에만 호출되는 것이 원칙이다 (finalizer.js 참고).
function applyTransition(state, to, guards) {
  const from = state.status;
  if (!canTransition(from, to)) {
    throw new StateTransitionError(`허용되지 않은 상태 전이: ${from} -> ${to}`);
  }
  const guard = guards && guards[to];
  if (guard) {
    const result = guard(state);
    if (!result || result.ok !== true) {
      const reason = (result && result.reason) || '가드 조건을 만족하지 않음';
      throw new StateTransitionError(`상태 전이 거부 (${from} -> ${to}): ${reason}`);
    }
  }
  state.status = to;
  state.updatedAt = new Date().toISOString();
  return state;
}

module.exports = {
  STATES,
  TRANSITIONS,
  StateTransitionError,
  canTransition,
  applyTransition,
};
