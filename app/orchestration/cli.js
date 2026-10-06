#!/usr/bin/env node
'use strict';

// Orchestration CLI — Job/State 관리의 유일한 진입점. 터미널 모드에서는
// 메인 Claude Code 세션(오케스트레이터)이 Bash로 이 CLI를 호출하고,
// 브라우저 채팅앱(app/server.js)은 이미 Node이므로 core/department 모듈을
// 직접 require해도 되지만 동일 커맨드 계약을 쓰면 두 실행 경로의 동작이
// 어긋날 일이 없어 server.js도 이 CLI를 그대로 호출한다.
//
// 모든 커맨드는 성공 시 stdout에 JSON 한 덩어리를 찍고 exit 0, 실패 시
// stdout에 {"error": "..."}를 찍고 exit 1 한다(사람이 읽는 로그가 아니라
// 오케스트레이터가 파싱하는 계약이라는 뜻 — 메시지를 바꿀 때 이 계약을
// 유지해야 한다).
const path = require('path');
const fs = require('fs');

const paths = require('./core/paths');
const jobCore = require('./core/job');
const stateCore = require('./core/state');
const registry = require('./core/registry');
const log = require('./core/log');

function printOk(obj) {
  process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
}

function printErr(message) {
  process.stdout.write(JSON.stringify({ error: message }, null, 2) + '\n');
  process.exitCode = 1;
}

function parseArgs(argv) {
  const result = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i += 1) {
    const tok = argv[i];
    if (tok.startsWith('--')) {
      const key = tok.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        result.flags[key] = true;
      } else {
        result.flags[key] = next;
        i += 1;
      }
    } else {
      result._.push(tok);
    }
  }
  return result;
}

function requireJob(jobId) {
  const job = jobCore.loadJob(jobId);
  if (!job) throw new Error(`job을 찾을 수 없음: ${jobId}`);
  return job;
}

function getDept(job) {
  return registry.getDepartment(job.task.department);
}

function computeJobStatusView(job) {
  const { task, state, jobDir } = job;
  const openQPath = path.join(jobDir, 'evidence', 'open-questions.json');
  let openQuestionsCount = 0;
  if (fs.existsSync(openQPath)) {
    try {
      const doc = JSON.parse(fs.readFileSync(openQPath, 'utf8'));
      openQuestionsCount = Array.isArray(doc.items) ? doc.items.length : 0;
    } catch (e) {
      openQuestionsCount = 0;
    }
  }
  const legacyCurrent = state.draftVersion > 0 ? jobCore.computeLegacyOutputPaths(task, state.draftVersion) : null;
  const legacyFinal = jobCore.computeLegacyOutputPaths(task, 'final');
  return {
    jobId: job.jobId,
    taskType: task.taskType,
    department: task.department,
    documentType: task.documentType,
    outputFormat: task.outputFormat,
    outputSlug: task.outputSlug,
    status: state.status,
    draftVersion: state.draftVersion,
    reviewRound: state.reviewRound,
    validationStatus: state.validationStatus,
    reviewStatus: state.reviewStatus,
    qaStatus: state.qaStatus,
    userApprovalStatus: state.userApprovalStatus,
    humanApprovalRequired: task.humanApprovalRequired,
    sourceFiles: state.sourceFiles || [],
    openQuestionsCount,
    outputFile: legacyCurrent ? legacyCurrent.file : null,
    finalFile: fs.existsSync(legacyFinal.file) ? legacyFinal.file : null,
    updatedAt: state.updatedAt,
  };
}

// ---- job create ----
function cmdCreate(flags) {
  const taskType = flags.type || 'document';
  let dept;
  try {
    dept = registry.getDepartment(taskType);
  } catch (e) {
    return printErr(e.message);
  }
  const overrides = {
    documentType: flags.documentType,
    outputFormat: flags.format,
    purpose: flags.purpose,
    audience: flags.audience,
    outputSlug: flags.slug,
    language: flags.language,
    tone: flags.tone,
    asOfDate: flags.asOfDate,
    riskLevel: flags.risk,
    humanApprovalRequired:
      flags.humanApproval === undefined ? undefined : String(flags.humanApproval) === 'true',
  };
  const taskFields = dept.intake.buildTaskFields(flags.request || '', overrides);
  const { jobId, jobDir, task, state } = jobCore.createJob({
    taskType,
    department: dept.id,
    taskFields,
  });

  if (!task.outputSlug) {
    task.outputSlug = dept.intake.defaultSlug(jobId);
    task.assumptions.push(`outputSlug: 요청에서 자동 추출하지 않음(오케스트레이터가 --slug로 지정 가능), 기본값 '${task.outputSlug}' 사용`);
    jobCore.saveTask(jobDir, task);
  }

  stateCore.applyTransition(state, stateCore.STATES.INTAKE);
  jobCore.saveState(jobDir, state);
  log.appendLog(jobDir, { event: 'intake_complete', assumptions: task.assumptions });

  printOk({ jobId, jobDir, task, state });
}

// ---- job show / list / status ----
function cmdShow(jobId) {
  try {
    const job = requireJob(jobId);
    printOk(job);
  } catch (e) {
    printErr(e.message);
  }
}

function cmdList() {
  const jobs = jobCore.listJobs();
  printOk({ jobs: jobs.map((j) => computeJobStatusView(j)) });
}

function cmdStatus(jobId) {
  try {
    const job = requireJob(jobId);
    printOk(computeJobStatusView(job));
  } catch (e) {
    printErr(e.message);
  }
}

// ---- job advance ----
function genericGuards(state, task) {
  return {
    [stateCore.STATES.REVIEWING]: () => ({
      ok: state.validationStatus !== 'FAIL',
      reason: `validationStatus=${state.validationStatus} (FAIL이면 REVIEWING으로 넘어갈 수 없음, DRAFTING으로 돌려보내세요)`,
    }),
    [stateCore.STATES.QA]: () => ({
      ok: state.reviewStatus === 'APPROVED',
      reason: `reviewStatus=${state.reviewStatus} (James 승인 전에는 QA로 넘어갈 수 없음)`,
    }),
    [stateCore.STATES.AWAITING_USER_APPROVAL]: () => ({
      ok: task.humanApprovalRequired === true && ['PASS', 'PASS_STRUCTURAL_ONLY'].includes(state.qaStatus),
      reason: !task.humanApprovalRequired
        ? 'humanApprovalRequired=false인 job은 이 상태를 쓰지 않음'
        : `qaStatus=${state.qaStatus}`,
    }),
    [stateCore.STATES.FINALIZING]: () => ({
      ok:
        state.reviewStatus === 'APPROVED' &&
        ['PASS', 'PASS_STRUCTURAL_ONLY'].includes(state.qaStatus) &&
        (!task.humanApprovalRequired || state.userApprovalStatus === 'APPROVED'),
      reason:
        `reviewStatus=${state.reviewStatus}, qaStatus=${state.qaStatus}, ` +
        `humanApprovalRequired=${task.humanApprovalRequired}, userApprovalStatus=${state.userApprovalStatus}`,
    }),
  };
}

async function cmdAdvance(jobId, flags) {
  const to = flags.to;
  if (!to) return printErr('--to <STATE> 필요');
  if (to === stateCore.STATES.COMPLETED) {
    return printErr("COMPLETED은 'job advance'로 직접 설정할 수 없습니다 — 'job finalize'를 사용하세요.");
  }
  let job;
  try {
    job = requireJob(jobId);
  } catch (e) {
    return printErr(e.message);
  }
  const { jobDir, task, state } = job;
  const dept = getDept(job);

  const guardMap = genericGuards(state, task);
  const wrapped = {};
  for (const key of Object.keys(guardMap)) wrapped[key] = () => guardMap[key]();
  if (dept.hooks && typeof dept.hooks.guard === 'function') {
    const prior = wrapped[to];
    wrapped[to] = () => {
      const deptResult = dept.hooks.guard(to, { jobDir, task, state, opts: flags });
      if (deptResult && deptResult.ok === false) return deptResult;
      return prior ? prior() : { ok: true };
    };
  }

  try {
    stateCore.applyTransition(state, to, wrapped);
  } catch (e) {
    return printErr(e.message);
  }

  try {
    if (dept.hooks && typeof dept.hooks.afterTransition === 'function') {
      const patch = await dept.hooks.afterTransition(to, { jobDir, task, state, opts: flags });
      Object.assign(state, patch || {});
    }
  } catch (e) {
    // hook 실패는 상태 전이 자체를 되돌리지 않되(이미 기록된 정보는 남겨야 진단 가능),
    // FAILED로 명시적으로 빠뜨려 다음 단계로 잘못 진행되는 걸 막는다.
    state.status = stateCore.STATES.FAILED;
    state.updatedAt = new Date().toISOString();
    state.lastError = e.message;
    jobCore.saveState(jobDir, state);
    log.appendLog(jobDir, { event: 'advance_hook_failed', to, error: e.message });
    return printErr(`상태 전이 후속 처리 실패, job을 FAILED로 표시함: ${e.message}`);
  }

  jobCore.saveState(jobDir, state);
  log.appendLog(jobDir, { event: 'state_transition', to, status: state.status, draftVersion: state.draftVersion, validationStatus: state.validationStatus, qaStatus: state.qaStatus });
  printOk(computeJobStatusView({ jobId: job.jobId, jobDir, task, state }));
}

// ---- job record-review ----
function cmdRecordReview(jobId, flags) {
  let job;
  try {
    job = requireJob(jobId);
  } catch (e) {
    return printErr(e.message);
  }
  const { jobDir, state } = job;
  if (state.status !== stateCore.STATES.REVIEWING) {
    return printErr(`현재 상태가 REVIEWING이 아님(${state.status}) — review는 REVIEWING 상태에서만 기록 가능`);
  }
  if (!flags['payload-file']) return printErr('--payload-file <james-review.json 경로> 필요');
  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(flags['payload-file'], 'utf8'));
  } catch (e) {
    return printErr(`payload-file을 JSON으로 읽지 못함: ${e.message}`);
  }
  const status = String(payload.status || '').toUpperCase();
  if (!['APPROVED', 'REJECTED'].includes(status)) {
    return printErr(`payload.status는 APPROVED 또는 REJECTED여야 함 (받은 값: ${payload.status})`);
  }

  const nextRound = (state.reviewRound || 0) + 1;
  const record = { ...payload, status, recordedAt: new Date().toISOString(), reviewRound: nextRound };
  const reviewsDir = path.join(jobDir, 'reviews');
  fs.mkdirSync(reviewsDir, { recursive: true });
  fs.writeFileSync(path.join(reviewsDir, `review-v${nextRound}.json`), JSON.stringify(record, null, 2), 'utf8');

  state.reviewRound = nextRound;
  state.reviewStatus = status;
  state.updatedAt = new Date().toISOString();
  jobCore.saveState(jobDir, state);
  log.appendLog(jobDir, { event: 'review_recorded', reviewRound: nextRound, status });

  printOk(computeJobStatusView(job));
}

// ---- job approve-user ----
function cmdApproveUser(jobId, flags) {
  let job;
  try {
    job = requireJob(jobId);
  } catch (e) {
    return printErr(e.message);
  }
  const { jobDir, state } = job;
  if (state.status !== stateCore.STATES.AWAITING_USER_APPROVAL) {
    return printErr(`현재 상태가 AWAITING_USER_APPROVAL이 아님(${state.status})`);
  }
  const decision = flags.decision;
  if (!['approve', 'revise'].includes(decision)) return printErr('--decision approve|revise 필요');

  state.userApprovalStatus = decision === 'approve' ? 'APPROVED' : 'REVISE_REQUESTED';
  state.updatedAt = new Date().toISOString();
  jobCore.saveState(jobDir, state);
  log.appendLog(jobDir, { event: 'user_approval', decision, note: flags.note || null });

  printOk(computeJobStatusView(job));
}

// ---- job finalize ----
async function cmdFinalize(jobId) {
  let job;
  try {
    job = requireJob(jobId);
  } catch (e) {
    return printErr(e.message);
  }
  const { jobDir, task, state } = job;
  if (state.status !== stateCore.STATES.FINALIZING) {
    return printErr(`현재 상태가 FINALIZING이 아님(${state.status}) — 먼저 'job advance --to FINALIZING'을 호출하세요.`);
  }
  const dept = getDept(job);
  const result = dept.finalizer.finalize({ jobDir, task, version: state.draftVersion });

  if (!result.ok) {
    state.status = stateCore.STATES.FAILED;
    state.lastError = result.error;
    state.updatedAt = new Date().toISOString();
    jobCore.saveState(jobDir, state);
    log.appendLog(jobDir, { event: 'finalize_failed', error: result.error });
    return printErr(`최종본 확정 실패, job을 FAILED로 표시함: ${result.error}`);
  }

  stateCore.applyTransition(state, stateCore.STATES.COMPLETED);
  jobCore.saveState(jobDir, state);
  log.appendLog(jobDir, { event: 'finalized', files: result.files });

  printOk({ ...computeJobStatusView(job), finalizedFiles: result.files });
}

// ---- job fail ----
function cmdFail(jobId, flags) {
  let job;
  try {
    job = requireJob(jobId);
  } catch (e) {
    return printErr(e.message);
  }
  const { jobDir, state } = job;
  state.status = stateCore.STATES.FAILED;
  state.lastError = flags.reason || '사유 미기재';
  state.updatedAt = new Date().toISOString();
  jobCore.saveState(jobDir, state);
  log.appendLog(jobDir, { event: 'manually_failed', reason: state.lastError });
  printOk(computeJobStatusView(job));
}

async function main() {
  const [, , group, sub, ...rest] = process.argv;
  if (group !== 'job') {
    printErr(`알 수 없는 커맨드 그룹: ${group} (지원: job)`);
    return;
  }
  const { _, flags } = parseArgs(rest);
  const jobId = _[0];

  switch (sub) {
    case 'create':
      return cmdCreate(flags);
    case 'show':
      return cmdShow(jobId);
    case 'list':
      return cmdList();
    case 'status':
      return cmdStatus(jobId);
    case 'advance':
      return cmdAdvance(jobId, flags);
    case 'record-review':
      return cmdRecordReview(jobId, flags);
    case 'approve-user':
      return cmdApproveUser(jobId, flags);
    case 'finalize':
      return cmdFinalize(jobId);
    case 'fail':
      return cmdFail(jobId, flags);
    default:
      return printErr(`알 수 없는 job 서브커맨드: ${sub}`);
  }
}

main().catch((e) => {
  printErr(`예상치 못한 오류: ${e.stack || e.message}`);
});

module.exports = { parseArgs, computeJobStatusView };
