'use strict';

// 상태 전이 시 자동으로 실행되어야 하는 Document Department 전용 부수효과.
// cli.js(core)는 이 파일의 존재 여부만 알고 내용은 모른다 — 다른 department를
// 추가할 때 이 파일과 같은 모양(afterTransition/guard)으로 자기만의 hooks.js를
// 두면, core 쪽 코드는 한 줄도 바꿀 필요가 없다.
const fs = require('fs');
const path = require('path');
const { STATES } = require('../../core/state');
const validator = require('./validator');
const extractor = require('./extractor');
const qa = require('./qa');
const evidenceModule = require('./evidence');
const { draftPathFor, independentReviewPathFor } = require('./finalizer');

function outputExt(task) {
  return task.outputFormat === 'docx' || task.outputFormat === 'pptx' ? task.outputFormat : 'md';
}

function readJsonIfExists(p) {
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

// PLANNING으로 넘어가기 전에, 해결되지 않은 blocking open question이 있으면
// 막는다(섹션 11: blocking=true인 질문만 사용자 확인을 요구한다).
function guard(to, ctx) {
  const { jobDir } = ctx;
  if (to === STATES.PLANNING) {
    const openQ = readJsonIfExists(path.join(jobDir, 'evidence', 'open-questions.json'));
    if (openQ) {
      const blocking = evidenceModule.blockingQuestions(openQ);
      if (blocking.length > 0) {
        return {
          ok: false,
          reason: `blocking open question ${blocking.length}건 미해결: ${blocking.map((q) => q.question).join(' / ')}`,
        };
      }
    }
    const evidenceDoc = readJsonIfExists(path.join(jobDir, 'evidence', 'evidence.json'));
    const evCheck = evidenceModule.validateEvidence(evidenceDoc);
    if (!evCheck.ok) {
      return { ok: false, reason: `evidence.json 검증 실패: ${evCheck.errors.join('; ')}` };
    }
  }
  return { ok: true };
}

async function afterTransition(to, ctx) {
  const { jobDir, task, state, opts } = ctx;

  if (to === STATES.VALIDATING) {
    const version = opts.version;
    if (!version) throw new Error("--version 필요 (검증할 draft 버전 번호, 예: --version 1)");
    const ext = outputExt(task);
    const draftPath = draftPathFor(jobDir, version, ext);
    if (!fs.existsSync(draftPath)) throw new Error(`초안 파일이 없음: ${draftPath}`);
    if (fs.statSync(draftPath).size === 0) throw new Error(`초안 파일이 0바이트: ${draftPath}`);

    let draftText;
    if (ext === 'md') {
      draftText = fs.readFileSync(draftPath, 'utf8');
    } else {
      draftText = await extractor.extractText(draftPath);
      const reviewPath = independentReviewPathFor(jobDir, version);
      fs.mkdirSync(path.dirname(reviewPath), { recursive: true });
      fs.writeFileSync(reviewPath, draftText, 'utf8');
    }

    const evidence = readJsonIfExists(path.join(jobDir, 'evidence', 'evidence.json'));
    const plan = readJsonIfExists(path.join(jobDir, 'plan', 'plan.json'));
    const result = validator.validateDraft({ draftText, evidence, plan });

    const reviewsDir = path.join(jobDir, 'reviews');
    fs.mkdirSync(reviewsDir, { recursive: true });
    fs.writeFileSync(path.join(reviewsDir, `validation-v${version}.json`), JSON.stringify(result, null, 2), 'utf8');

    return { draftVersion: Number(version), validationStatus: result.status };
  }

  if (to === STATES.QA) {
    const version = state.draftVersion;
    const ext = outputExt(task);
    const draftPath = draftPathFor(jobDir, version, ext);
    let extractedText;
    if (ext === 'md') {
      extractedText = fs.readFileSync(draftPath, 'utf8');
    } else {
      const reviewPath = independentReviewPathFor(jobDir, version);
      extractedText = fs.existsSync(reviewPath) ? fs.readFileSync(reviewPath, 'utf8') : await extractor.extractText(draftPath);
    }
    const plan = readJsonIfExists(path.join(jobDir, 'plan', 'plan.json'));
    const result = await qa.runQa({ filePath: draftPath, extractedText, plan });

    const qaDir = path.join(jobDir, 'qa');
    fs.mkdirSync(qaDir, { recursive: true });
    fs.writeFileSync(path.join(qaDir, `qa-v${version}.json`), JSON.stringify(result, null, 2), 'utf8');

    return { qaStatus: result.status };
  }

  return {};
}

module.exports = { guard, afterTransition };
