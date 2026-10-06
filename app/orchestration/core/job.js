'use strict';

const fs = require('fs');
const path = require('path');
const { JOBS_DIR, INPUTS_DIR, OUTPUTS_DIR, ensureDir } = require('./paths');
const { STATES } = require('./state');
const log = require('./log');

const JOB_SUBDIRS = [
  'inputs',
  'working',
  'evidence',
  'plan',
  'drafts',
  'reviews',
  'qa',
  'outputs',
  'final',
  'logs',
];

function todayStamp(date) {
  const d = date || new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

// 오늘 날짜의 job들 중 가장 큰 순번을 찾아 다음 jobId를 만든다. 같은 날 여러
// job이 생겨도 충돌하지 않는다(파일시스템 기준이라 동시성은 가정하지 않음 —
// 로컬 단일 사용자 앱이므로 충분하다).
function nextJobId(date) {
  ensureDir(JOBS_DIR);
  const stamp = todayStamp(date);
  const existing = fs
    .readdirSync(JOBS_DIR)
    .filter((name) => name.startsWith(`${stamp}-`));
  let maxN = 0;
  for (const name of existing) {
    const m = name.match(/^\d{8}-(\d{3})$/);
    if (m) maxN = Math.max(maxN, parseInt(m[1], 10));
  }
  const n = String(maxN + 1).padStart(3, '0');
  return `${stamp}-${n}`;
}

function jobDirFor(jobId) {
  return path.join(JOBS_DIR, jobId);
}

// inputs/ 스냅샷: job 생성 시점의 전역 inputs/ 파일들을 job 전용 inputs/로
// 복사한다. 이후 그 job은 자기 스냅샷만 보고 작업하므로, 나중에 다른 job을
// 위해 inputs/에 새 파일이 추가/변경돼도 이 job에는 영향이 없다 — Job 간
// 자료 격리(요구사항 B)를 파일시스템 복사만으로 보장하는 가장 단순한 방법이다.
function snapshotGlobalInputs(destInputsDir) {
  if (!fs.existsSync(INPUTS_DIR)) return [];
  const copied = [];
  for (const name of fs.readdirSync(INPUTS_DIR)) {
    if (name === '.gitkeep') continue;
    const src = path.join(INPUTS_DIR, name);
    if (fs.statSync(src).isDirectory()) continue;
    const dest = path.join(destInputsDir, name);
    fs.copyFileSync(src, dest);
    copied.push(name);
  }
  return copied;
}

// taskFields: department 모듈이 채운 task.json 전체 필드 (jobId/department 등
// core가 채워주는 값 제외). 반환값: { jobId, jobDir, task, state }
function createJob({ taskType, department, taskFields }) {
  const jobId = nextJobId();
  const jobDir = jobDirFor(jobId);
  ensureDir(jobDir);
  for (const sub of JOB_SUBDIRS) ensureDir(path.join(jobDir, sub));

  const sourceFiles = snapshotGlobalInputs(path.join(jobDir, 'inputs'));

  const task = {
    jobId,
    taskType,
    department,
    createdAt: new Date().toISOString(),
    ...taskFields,
  };
  fs.writeFileSync(path.join(jobDir, 'task.json'), JSON.stringify(task, null, 2), 'utf8');

  const state = {
    jobId,
    taskType,
    department,
    status: STATES.CREATED,
    draftVersion: 0,
    reviewRound: 0,
    validationStatus: null,
    reviewStatus: null,
    qaStatus: null,
    userApprovalStatus: null,
    sourceFiles,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(jobDir, 'state.json'), JSON.stringify(state, null, 2), 'utf8');

  log.appendLog(jobDir, { event: 'job_created', jobId, taskType, department, sourceFiles });

  return { jobId, jobDir, task, state };
}

function loadJob(jobId) {
  const jobDir = jobDirFor(jobId);
  if (!fs.existsSync(jobDir)) return null;
  const task = JSON.parse(fs.readFileSync(path.join(jobDir, 'task.json'), 'utf8'));
  const state = JSON.parse(fs.readFileSync(path.join(jobDir, 'state.json'), 'utf8'));
  return { jobId, jobDir, task, state };
}

function saveState(jobDir, state) {
  fs.writeFileSync(path.join(jobDir, 'state.json'), JSON.stringify(state, null, 2), 'utf8');
}

function saveTask(jobDir, task) {
  fs.writeFileSync(path.join(jobDir, 'task.json'), JSON.stringify(task, null, 2), 'utf8');
}

function listJobs() {
  ensureDir(JOBS_DIR);
  return fs
    .readdirSync(JOBS_DIR)
    .filter((name) => /^\d{8}-\d{3}$/.test(name))
    .sort()
    .reverse()
    .map((jobId) => loadJob(jobId))
    .filter(Boolean);
}

// 신규 job 파이프라인도 기존 "outputs/<주제>-v<버전>.<확장자>" /
// "outputs/<주제>-final.<확장자>" 관례를 그대로 지킨다 — 사용자가 기존
// 방식으로 outputs/를 계속 확인할 수 있어야 하기 때문이다(하위호환).
function computeLegacyOutputPaths(task, version) {
  const slug = task.outputSlug;
  const ext = task.outputFormat === 'docx' || task.outputFormat === 'pptx' ? task.outputFormat : 'md';
  const base = version === 'final' ? `${slug}-final` : `${slug}-v${version}`;
  return {
    file: path.join(OUTPUTS_DIR, `${base}.${ext}`),
    reviewText: ext === 'md' ? null : path.join(OUTPUTS_DIR, `${base}.review.txt`),
  };
}

module.exports = {
  JOB_SUBDIRS,
  nextJobId,
  jobDirFor,
  createJob,
  loadJob,
  saveState,
  saveTask,
  listJobs,
  computeLegacyOutputPaths,
  snapshotGlobalInputs,
};
