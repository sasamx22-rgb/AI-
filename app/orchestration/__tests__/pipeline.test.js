'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { makeSandbox, runCli } = require('./helpers');

const EVIDENCE_OK = {
  items: [
    {
      id: 'E001',
      statement: '2025년 3분기 누적 매출은 320백만원이다.',
      type: 'CONFIRMED',
      sourceFile: 'sample-3q-financials.md',
      location: '3분기 누적 매출 합계',
      value: 320,
      unit: '백만원',
    },
    {
      id: 'E002',
      statement: '전년동기 대비 매출 증가율은 14.3%다.',
      type: 'DERIVED',
      sourceRefs: ['E001'],
      formula: '(320-280)/280',
      value: 14.3,
      unit: '%',
      comparisonPeriod: '전년동기',
    },
  ],
};

const OPEN_QUESTIONS_EMPTY = { items: [] };

const PLAN_OK = {
  keyMessage: '2025년 3분기 누적 매출은 전년동기 대비 14.3% 증가했다.',
  documentStrategy: '요약 -> 근거 -> 결론',
  sections: [
    { title: '요약', purpose: '핵심 결론', evidenceRefs: ['E001', 'E002'] },
    { title: '주요 사항', purpose: '분기별 실적', evidenceRefs: ['E001'] },
  ],
  mustInclude: [],
  mustAvoid: [],
};

const DRAFT_CORRECT = `# 2025년 3분기 실적 보고서

## 요약

2025년 3분기 누적 매출은 320백만원 (=95+110+115)을 기록했다. 매출은
전년동기 대비 14.3% 증가했다.

## 주요 사항

| 구분 | 1분기 | 2분기 | 3분기 |
|---|---|---|---|
| 매출 | 95 | 110 | 115 |
`;

const DRAFT_WRONG_NUMBER = `# 2025년 3분기 실적 보고서

## 요약

2025년 3분기 누적 매출은 315백만원 (=95+110+115)을 기록했다. 매출은
전년동기 대비 14.3% 증가했다.

## 주요 사항

| 구분 | 1분기 | 2분기 | 3분기 |
|---|---|---|---|
| 매출 | 95 | 110 | 115 |
`;

const DRAFT_WRONG_COMPARISON = `# 2025년 3분기 실적 보고서

## 요약

2025년 3분기 누적 매출은 320백만원 (=95+110+115)을 기록했다. 매출은
전분기 대비 14.3% 증가했다.

## 주요 사항

| 구분 | 1분기 | 2분기 | 3분기 |
|---|---|---|---|
| 매출 | 95 | 110 | 115 |
`;

const DRAFT_WITH_FORECAST = `# 2025년 3분기 실적 보고서

## 요약

2025년 3분기 누적 매출은 320백만원 (=95+110+115)을 기록했다. 매출은
전년동기 대비 14.3% 증가했다.

## 주요 사항

| 구분 | 1분기 | 2분기 | 3분기 |
|---|---|---|---|
| 매출 | 95 | 110 | 115 |

내년에는 매출 목표를 대폭 상향할 것으로 예상된다.
`;

function createDocumentJob(sandbox, overrides = {}) {
  const res = runCli(sandbox, [
    'job',
    'create',
    '--type',
    'document',
    '--request',
    overrides.request || '3분기 실적 보고서 만들어줘',
    '--slug',
    overrides.slug || 'test-doc',
    '--format',
    overrides.format || 'md',
  ]);
  assert.equal(res.status, 0, `job create 실패: ${res.stdout}${res.stderr}`);
  return res.json;
}

function writeJobFile(jobDir, relPath, content) {
  const full = path.join(jobDir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, typeof content === 'string' ? content : JSON.stringify(content, null, 2), 'utf8');
}

// SOURCE_ANALYSIS -> PLANNING -> DRAFTING -> VALIDATING까지 진행하고 검증 결과를 반환한다.
function draftAndValidate(sandbox, jobId, jobDir, { evidence, openQuestions, plan, draftText, version }) {
  let res = runCli(sandbox, ['job', 'advance', jobId, '--to', 'SOURCE_ANALYSIS']);
  assert.equal(res.status, 0, res.stdout + res.stderr);

  writeJobFile(jobDir, 'evidence/evidence.json', evidence);
  writeJobFile(jobDir, 'evidence/open-questions.json', openQuestions);

  res = runCli(sandbox, ['job', 'advance', jobId, '--to', 'PLANNING']);
  assert.equal(res.status, 0, res.stdout + res.stderr);

  writeJobFile(jobDir, 'plan/plan.json', plan);

  res = runCli(sandbox, ['job', 'advance', jobId, '--to', 'DRAFTING']);
  assert.equal(res.status, 0, res.stdout + res.stderr);

  writeJobFile(jobDir, `drafts/v${version}.md`, draftText);

  res = runCli(sandbox, ['job', 'advance', jobId, '--to', 'VALIDATING', '--version', String(version)]);
  return res;
}

describe('Job Workspace 생성/격리 (테스트 A, B)', () => {
  test('A: job 생성 시 독립 워크스페이스(모든 하위 디렉터리)가 만들어진다', () => {
    const sandbox = makeSandbox();
    try {
      const { jobId, jobDir } = createDocumentJob(sandbox);
      for (const sub of ['inputs', 'working', 'evidence', 'plan', 'drafts', 'reviews', 'qa', 'outputs', 'final', 'logs']) {
        assert.ok(fs.existsSync(path.join(jobDir, sub)), `${sub} 디렉터리가 없음`);
      }
      assert.ok(fs.existsSync(path.join(jobDir, 'task.json')));
      assert.ok(fs.existsSync(path.join(jobDir, 'state.json')));
      assert.match(jobId, /^\d{8}-\d{3}$/);
    } finally {
      sandbox.cleanup();
    }
  });

  test('B: 서로 다른 Job은 inputs 스냅샷이 격리되어 서로의 자료를 보지 못한다', () => {
    const sandbox = makeSandbox();
    try {
      sandbox.writeInput('shared-a.md', 'job A 시점 자료');
      const jobA = createDocumentJob(sandbox, { slug: 'job-a' });

      sandbox.writeInput('shared-b.md', 'job B 시점에 추가된 자료');
      const jobB = createDocumentJob(sandbox, { slug: 'job-b' });

      const jobAInputs = fs.readdirSync(path.join(jobA.jobDir, 'inputs'));
      const jobBInputs = fs.readdirSync(path.join(jobB.jobDir, 'inputs'));

      assert.ok(jobAInputs.includes('shared-a.md'));
      assert.ok(!jobAInputs.includes('shared-b.md'), 'Job A가 나중에 추가된 자료를 보면 안 됨(격리 실패)');
      assert.ok(jobBInputs.includes('shared-a.md'));
      assert.ok(jobBInputs.includes('shared-b.md'));
    } finally {
      sandbox.cleanup();
    }
  });
});

describe('결정론적 Validator (테스트 C, D, E)', () => {
  test('C: 원본 320인데 초안이 315 -> FAIL (formula_recompute + evidence_coverage)', () => {
    const sandbox = makeSandbox();
    try {
      const { jobId, jobDir } = createDocumentJob(sandbox, { slug: 'wrong-number' });
      const res = draftAndValidate(sandbox, jobId, jobDir, {
        evidence: EVIDENCE_OK,
        openQuestions: OPEN_QUESTIONS_EMPTY,
        plan: PLAN_OK,
        draftText: DRAFT_WRONG_NUMBER,
        version: 1,
      });
      assert.equal(res.status, 0, res.stdout + res.stderr);
      assert.equal(res.json.validationStatus, 'FAIL');
      const validationDoc = JSON.parse(fs.readFileSync(path.join(jobDir, 'reviews', 'validation-v1.json'), 'utf8'));
      const checks = validationDoc.issues.map((i) => i.check);
      assert.ok(checks.includes('formula_recompute'));
      assert.ok(checks.includes('evidence_coverage'));
    } finally {
      sandbox.cleanup();
    }
  });

  test('D: 전년동기를 전분기로 잘못 표현 -> FAIL (comparison_period_label)', () => {
    const sandbox = makeSandbox();
    try {
      const { jobId, jobDir } = createDocumentJob(sandbox, { slug: 'wrong-period' });
      const res = draftAndValidate(sandbox, jobId, jobDir, {
        evidence: EVIDENCE_OK,
        openQuestions: OPEN_QUESTIONS_EMPTY,
        plan: PLAN_OK,
        draftText: DRAFT_WRONG_COMPARISON,
        version: 1,
      });
      assert.equal(res.json.validationStatus, 'FAIL');
      const validationDoc = JSON.parse(fs.readFileSync(path.join(jobDir, 'reviews', 'validation-v1.json'), 'utf8'));
      assert.ok(validationDoc.issues.some((i) => i.check === 'comparison_period_label'));
    } finally {
      sandbox.cleanup();
    }
  });

  test('E: 근거 없는 전망 문장 -> needs_review로 플래그(차단은 아님)', () => {
    const sandbox = makeSandbox();
    try {
      const { jobId, jobDir } = createDocumentJob(sandbox, { slug: 'forecast' });
      const res = draftAndValidate(sandbox, jobId, jobDir, {
        evidence: EVIDENCE_OK,
        openQuestions: OPEN_QUESTIONS_EMPTY,
        plan: PLAN_OK,
        draftText: DRAFT_WITH_FORECAST,
        version: 1,
      });
      // 다른 blocking 이슈는 없어야 하므로 WARN(needs_review만 있음)이어야 한다.
      assert.equal(res.json.validationStatus, 'WARN');
      const validationDoc = JSON.parse(fs.readFileSync(path.join(jobDir, 'reviews', 'validation-v1.json'), 'utf8'));
      const forecastIssue = validationDoc.issues.find((i) => i.check === 'forward_looking_statement');
      assert.ok(forecastIssue, 'forward_looking_statement 이슈가 있어야 함');
      assert.equal(forecastIssue.severity, 'needs_review');
    } finally {
      sandbox.cleanup();
    }
  });

  test('정상 초안은 PASS로 통과한다', () => {
    const sandbox = makeSandbox();
    try {
      const { jobId, jobDir } = createDocumentJob(sandbox, { slug: 'correct' });
      const res = draftAndValidate(sandbox, jobId, jobDir, {
        evidence: EVIDENCE_OK,
        openQuestions: OPEN_QUESTIONS_EMPTY,
        plan: PLAN_OK,
        draftText: DRAFT_CORRECT,
        version: 1,
      });
      assert.equal(res.json.validationStatus, 'PASS');
    } finally {
      sandbox.cleanup();
    }
  });
});

function approveReview(sandbox, jobDir, jobId) {
  const payloadPath = path.join(jobDir, 'working', 'james-approve.json');
  fs.writeFileSync(
    payloadPath,
    JSON.stringify({ status: 'APPROVED', blockingIssues: [], nonBlockingIssues: [] }, null, 2),
    'utf8'
  );
  const res = runCli(sandbox, ['job', 'record-review', jobId, '--payload-file', payloadPath]);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  return res;
}

describe('State Machine 가드 (테스트 F, G, H)', () => {
  test('F: James 승인 전에는 QA/FINALIZING으로 진행하거나 finalize할 수 없다', () => {
    const sandbox = makeSandbox();
    try {
      const { jobId, jobDir } = createDocumentJob(sandbox, { slug: 'no-approval-yet' });
      draftAndValidate(sandbox, jobId, jobDir, {
        evidence: EVIDENCE_OK,
        openQuestions: OPEN_QUESTIONS_EMPTY,
        plan: PLAN_OK,
        draftText: DRAFT_CORRECT,
        version: 1,
      });
      runCli(sandbox, ['job', 'advance', jobId, '--to', 'REVIEWING']);

      const qaAttempt = runCli(sandbox, ['job', 'advance', jobId, '--to', 'QA']);
      assert.equal(qaAttempt.status, 1);
      assert.match(qaAttempt.json.error, /승인/);

      const finalizeAttempt = runCli(sandbox, ['job', 'finalize', jobId]);
      assert.equal(finalizeAttempt.status, 1);
    } finally {
      sandbox.cleanup();
    }
  });

  test('G: 승인은 있어도 최종 산출물 파일이 실제로 없으면 COMPLETED가 될 수 없고 FAILED로 표시된다', () => {
    const sandbox = makeSandbox();
    try {
      const { jobId, jobDir } = createDocumentJob(sandbox, { slug: 'missing-final-file' });
      draftAndValidate(sandbox, jobId, jobDir, {
        evidence: EVIDENCE_OK,
        openQuestions: OPEN_QUESTIONS_EMPTY,
        plan: PLAN_OK,
        draftText: DRAFT_CORRECT,
        version: 1,
      });
      runCli(sandbox, ['job', 'advance', jobId, '--to', 'REVIEWING']);
      approveReview(sandbox, jobDir, jobId);
      runCli(sandbox, ['job', 'advance', jobId, '--to', 'QA']);
      runCli(sandbox, ['job', 'advance', jobId, '--to', 'FINALIZING']);

      // 승인된 draft 파일을 몰래 지워서 "승인은 있는데 산출물이 없는" 상황을 재현
      fs.unlinkSync(path.join(jobDir, 'drafts', 'v1.md'));

      const finalizeRes = runCli(sandbox, ['job', 'finalize', jobId]);
      assert.equal(finalizeRes.status, 1);

      const state = JSON.parse(fs.readFileSync(path.join(jobDir, 'state.json'), 'utf8'));
      assert.equal(state.status, 'FAILED');
      assert.notEqual(state.status, 'COMPLETED');

      const legacyFinal = path.join(sandbox.outputsDir, 'missing-final-file-final.md');
      assert.ok(!fs.existsSync(legacyFinal), 'final 파일이 실제로 생성되면 안 됨');
    } finally {
      sandbox.cleanup();
    }
  });

  test('H: 승인 + 실제 파일 존재 시에만 COMPLETED가 되고, outputs/와 jobs/.../final/ 양쪽에 실제 파일이 생긴다', () => {
    const sandbox = makeSandbox();
    try {
      const { jobId, jobDir } = createDocumentJob(sandbox, { slug: 'happy-path' });
      draftAndValidate(sandbox, jobId, jobDir, {
        evidence: EVIDENCE_OK,
        openQuestions: OPEN_QUESTIONS_EMPTY,
        plan: PLAN_OK,
        draftText: DRAFT_CORRECT,
        version: 1,
      });
      runCli(sandbox, ['job', 'advance', jobId, '--to', 'REVIEWING']);
      approveReview(sandbox, jobDir, jobId);
      runCli(sandbox, ['job', 'advance', jobId, '--to', 'QA']);
      runCli(sandbox, ['job', 'advance', jobId, '--to', 'FINALIZING']);
      const finalizeRes = runCli(sandbox, ['job', 'finalize', jobId]);

      assert.equal(finalizeRes.status, 0, finalizeRes.stdout + finalizeRes.stderr);
      assert.equal(finalizeRes.json.status, 'COMPLETED');

      const legacyFinal = path.join(sandbox.outputsDir, 'happy-path-final.md');
      const jobFinal = path.join(jobDir, 'final', 'happy-path-final.md');
      assert.ok(fs.existsSync(legacyFinal), '레거시 outputs/ 최종 파일이 실제로 있어야 함');
      assert.ok(fs.existsSync(jobFinal), 'job 워크스페이스 내 final 파일도 실제로 있어야 함');
      assert.ok(fs.statSync(legacyFinal).size > 0);
    } finally {
      sandbox.cleanup();
    }
  });
});
