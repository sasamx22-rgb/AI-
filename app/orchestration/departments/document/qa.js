'use strict';

// Format / Visual QA — 섹션 18. 정직하게 스코프를 제한한다: 여기서 확실히
// 보장하는 것은 "구조적으로 멀쩡한 파일인가"이고, "표가 페이지 경계에서
// 잘렸는가" 같은 진짜 시각적 렌더링 문제는 LibreOffice(soffice)가 로컬에
// 설치돼 있을 때만 보조적으로 PDF 변환 페이지 수를 확인한다. 없으면
// qaStatus를 PASS_STRUCTURAL_ONLY로 남기고 그 사실을 그대로 기록한다 —
// 실제로 안 되는 걸 된다고 말하지 않기 위함이다.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

function findSoffice() {
  const candidates = process.platform === 'win32' ? ['soffice.exe', 'soffice'] : ['soffice'];
  for (const bin of candidates) {
    const result = spawnSync(bin, ['--version'], { timeout: 5000 });
    if (!result.error && result.status === 0) return bin;
  }
  return null;
}

function countPdfPages(pdfBuffer) {
  const text = pdfBuffer.toString('latin1');
  const matches = text.match(/\/Type\s*\/Page[^s]/g);
  return matches ? matches.length : null;
}

function tryRenderWithSoffice(filePath) {
  const soffice = findSoffice();
  if (!soffice) return { attempted: false };
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-qa-'));
  const result = spawnSync(soffice, ['--headless', '--convert-to', 'pdf', '--outdir', outDir, filePath], {
    timeout: 60000,
  });
  if (result.error || result.status !== 0) {
    return { attempted: true, ok: false, reason: (result.error && result.error.message) || `soffice exit ${result.status}` };
  }
  const base = path.basename(filePath, path.extname(filePath));
  const pdfPath = path.join(outDir, `${base}.pdf`);
  if (!fs.existsSync(pdfPath)) return { attempted: true, ok: false, reason: 'PDF 변환 결과 파일을 찾을 수 없음' };
  const pageCount = countPdfPages(fs.readFileSync(pdfPath));
  return { attempted: true, ok: true, pageCount, pdfPath };
}

function structuralChecks({ filePath, extractedText, plan }) {
  const checks = [];

  const stat = fs.statSync(filePath);
  checks.push({
    name: 'file_exists_nonempty',
    ok: stat.size > 0,
    detail: `size=${stat.size} bytes`,
  });

  const hasMojibake = /�/.test(extractedText || '');
  checks.push({
    name: 'no_mojibake',
    ok: !hasMojibake,
    detail: hasMojibake ? '추출 텍스트에 U+FFFD(깨짐 문자) 발견' : 'OK',
  });

  const hasContent = (extractedText || '').trim().length > 0;
  checks.push({ name: 'has_extractable_text', ok: hasContent, detail: hasContent ? 'OK' : '추출된 텍스트가 비어있음' });

  if (plan && Array.isArray(plan.sections) && path.extname(filePath).toLowerCase() === '.pptx') {
    const slideCount = (extractedText.match(/\[슬라이드 \d+\]/g) || []).length;
    const ok = slideCount >= plan.sections.length;
    checks.push({
      name: 'slide_count_vs_plan',
      ok,
      detail: `slideCount=${slideCount}, planSections=${plan.sections.length}`,
    });
  }

  return checks;
}

async function runQa({ filePath, extractedText, plan }) {
  const checks = structuralChecks({ filePath, extractedText, plan });
  const structuralOk = checks.every((c) => c.ok);

  const ext = path.extname(filePath).toLowerCase();
  let renderResult = { attempted: false };
  if (['.docx', '.pptx'].includes(ext)) {
    try {
      renderResult = tryRenderWithSoffice(filePath);
    } catch (e) {
      renderResult = { attempted: true, ok: false, reason: e.message };
    }
  }

  let status;
  let note;
  if (!structuralOk) {
    status = 'FAIL';
    note = '구조적 검사 실패 항목이 있습니다.';
  } else if (!['.docx', '.pptx'].includes(ext)) {
    // 마크다운 등 레이아웃이 없는 포맷은 애초에 "시각적 렌더링" 개념이 없으므로
    // soffice 미설치를 이유로 PASS_STRUCTURAL_ONLY로 낮추지 않는다.
    status = 'PASS';
    note = '레이아웃이 없는 포맷(마크다운 등)이라 구조 검사만으로 충분합니다.';
  } else if (renderResult.attempted && renderResult.ok) {
    status = 'PASS';
    note = `soffice로 실제 렌더링(PDF 변환) 확인함. pageCount=${renderResult.pageCount}`;
  } else if (renderResult.attempted && !renderResult.ok) {
    status = 'PASS_STRUCTURAL_ONLY';
    note = `soffice 렌더링 시도했으나 실패(${renderResult.reason}) — 구조 검사만 통과. 표 잘림/페이지 넘김 등 시각적 문제는 확인하지 못했습니다.`;
  } else {
    status = 'PASS_STRUCTURAL_ONLY';
    note =
      'soffice(LibreOffice headless)가 설치돼 있지 않아 구조 검사만 수행했습니다. ' +
      '표 잘림/페이지 넘김/여백 등 실제 시각적 렌더링 문제는 확인하지 못했습니다.';
  }

  return { status, note, checks, render: renderResult };
}

module.exports = { runQa, findSoffice, countPdfPages };
