'use strict';

// Finalizer — 승인된 버전을 실제 최종 산출물로 확정하는 유일한 코드 경로.
// 여기서 파일 복사와 실존 검증이 전부 성공했을 때만 호출자(cli.js)가
// state를 COMPLETED로 바꾼다. 복사가 하나라도 실패하면 ok:false를 반환하고,
// 호출자는 이 경우 반드시 FAILED로 남겨야 한다 — "승인은 있었는데 최종
// 파일이 없는" 상황(섹션 20)을 구조적으로 막기 위한 핵심 안전장치다.
const fs = require('fs');
const path = require('path');
const { OUTPUTS_DIR, ensureDir } = require('../../core/paths');
const { computeLegacyOutputPaths } = require('../../core/job');

function draftPathFor(jobDir, version, ext) {
  return path.join(jobDir, 'drafts', `v${version}.${ext}`);
}

function independentReviewPathFor(jobDir, version) {
  return path.join(jobDir, 'reviews', `actual-v${version}.review.txt`);
}

function copyAndVerify(src, dest) {
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
  const stat = fs.statSync(dest);
  if (stat.size === 0) throw new Error(`복사 결과 파일이 0바이트: ${dest}`);
  return dest;
}

function finalize({ jobDir, task, version }) {
  const ext = task.outputFormat === 'docx' || task.outputFormat === 'pptx' ? task.outputFormat : 'md';
  const srcDraft = draftPathFor(jobDir, version, ext);

  if (!fs.existsSync(srcDraft)) {
    return { ok: false, error: `최종 확정 대상 초안 파일이 없음: ${srcDraft}` };
  }
  if (fs.statSync(srcDraft).size === 0) {
    return { ok: false, error: `초안 파일이 0바이트: ${srcDraft}` };
  }

  const legacy = computeLegacyOutputPaths(task, 'final');
  const jobFinalDraft = path.join(jobDir, 'final', `${task.outputSlug}-final.${ext}`);

  try {
    ensureDir(OUTPUTS_DIR);
    copyAndVerify(srcDraft, legacy.file);
    copyAndVerify(srcDraft, jobFinalDraft);

    let reviewFiles = null;
    if (ext !== 'md') {
      const srcReview = independentReviewPathFor(jobDir, version);
      if (!fs.existsSync(srcReview)) {
        return {
          ok: false,
          error: `docx/pptx 산출물인데 독립 추출본(${srcReview})이 없음 — extract 단계를 먼저 실행해야 함`,
        };
      }
      const jobFinalReview = path.join(jobDir, 'final', `${task.outputSlug}-final.review.txt`);
      copyAndVerify(srcReview, legacy.reviewText);
      copyAndVerify(srcReview, jobFinalReview);
      reviewFiles = { legacy: legacy.reviewText, job: jobFinalReview };
    }

    return {
      ok: true,
      files: {
        draft: { legacy: legacy.file, job: jobFinalDraft },
        review: reviewFiles,
      },
    };
  } catch (e) {
    return { ok: false, error: `최종본 복사/검증 중 오류: ${e.message}` };
  }
}

module.exports = { finalize, draftPathFor, independentReviewPathFor };
