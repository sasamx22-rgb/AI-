'use strict';

// 결정론적(Deterministic) Validator — James에게 넘기기 전에 코드로 먼저 걸러낼
// 수 있는 명백한 실수를 검사한다. 완전한 회계 판단 엔진이 아니다: 아래 6가지
// 휴리스틱 검사만 수행하고, 그 외의 "말이 되는 결론인가", "회계기준 적용이
// 맞는가" 같은 판단은 여전히 James(reviewer 서브에이전트)의 몫이다.
//
// 입력: { draftText, evidence, plan }
//   - draftText: 검토 대상 텍스트 (md 원본, 또는 docx/pptx의 독립 추출본)
//   - evidence: evidence.json 파싱 객체 ({ items: [...] })
//   - plan: plan.json 파싱 객체 ({ sections: [...] })
// 출력: { status: 'PASS'|'WARN'|'FAIL', issues: [{ severity, check, message }] }

// 숫자/콤마 바로 뒤에 붙은 경우만 통화 단위로 센다 (lookbehind) — 그렇지 않으면
// "원가", "지원" 같은 일반 단어 속 '원'까지 단위로 오탐한다.
const UNIT_TOKEN_REGEX = /(?<=[\d,])(억원|백만원|천원|원)/g;
const FORWARD_LOOKING_KEYWORDS = ['전망', '예상', '목표', '기대', '계획'];
const COMPARISON_KEYWORDS = ['전년동기', '전분기', '전기', '전월', '전년'];

function safeEvalFormula(expr) {
  const cleaned = expr.replace(/,/g, '').trim();
  if (!/^[-+*/().\d\s]+$/.test(cleaned)) return null;
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function(`return (${cleaned});`);
    const v = fn();
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  } catch (e) {
    return null;
  }
}

function parseNumberToken(token) {
  const cleaned = String(token).replace(/,/g, '');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

function numbersCloseEnough(a, b) {
  // 반올림/소수점 표기 차이를 감안해 절대오차 0.05 이내면 동일값으로 본다.
  return Math.abs(a - b) < 0.05;
}

// 1. 산식 재계산: "320백만원 (=95+110+115)" 형태의 명시적 산식을 실제로 계산해
//    바로 앞 숫자와 대조한다.
function checkFormulas(draftText, issues) {
  const re = /([\d,]+(?:\.\d+)?)\s*[^\s(]{0,4}\s*\(=\s*([^)]+)\)/g;
  let m;
  while ((m = re.exec(draftText))) {
    const stated = parseNumberToken(m[1]);
    const computed = safeEvalFormula(m[2]);
    if (stated === null || computed === null) continue;
    if (!numbersCloseEnough(stated, computed)) {
      issues.push({
        severity: 'blocking',
        check: 'formula_recompute',
        message: `산식 재계산 불일치: 표기값 ${m[1]}, 산식(${m[2]}) 재계산값 ${computed} — 원문: "${m[0]}"`,
      });
    }
  }
}

// 2. 근거 대사: CONFIRMED/DERIVED evidence의 numeric value가 초안 어딘가에
//    실제로 등장하는지 확인한다. (예: 원본 320인데 초안이 315만 쓰면 FAIL)
function checkEvidenceCoverage(draftText, evidence, issues) {
  if (!evidence || !Array.isArray(evidence.items)) return;
  for (const item of evidence.items) {
    if (!['CONFIRMED', 'DERIVED'].includes(item.type)) continue;
    if (item.value === undefined || item.value === null) continue;
    const asIs = String(item.value);
    const withComma = Number(item.value).toLocaleString('en-US');
    if (!draftText.includes(asIs) && !draftText.includes(withComma)) {
      issues.push({
        severity: 'blocking',
        check: 'evidence_coverage',
        message: `근거 ${item.id} 값 '${item.value}'가 초안 텍스트 어디에도 등장하지 않음 (근거: ${item.statement})`,
      });
    }
  }
}

// 3. 비교기간 라벨 대사: evidence 항목의 comparisonPeriod가 실제 초안에서
//    그 숫자 주변에 올바른 키워드로 쓰였는지 확인한다.
function checkComparisonPeriodLabels(draftText, evidence, issues) {
  if (!evidence || !Array.isArray(evidence.items)) return;
  for (const item of evidence.items) {
    if (!item.comparisonPeriod || item.value === undefined || item.value === null) continue;
    const needle = String(item.value);
    const idx = draftText.indexOf(needle);
    if (idx === -1) continue; // evidence_coverage 체크에서 이미 잡힘
    const windowStart = Math.max(0, idx - 40);
    const windowEnd = Math.min(draftText.length, idx + needle.length + 40);
    const window = draftText.slice(windowStart, windowEnd);
    const hasCorrect = window.includes(item.comparisonPeriod);
    const wrongKeyword = COMPARISON_KEYWORDS.find((k) => k !== item.comparisonPeriod && window.includes(k));
    if (!hasCorrect && wrongKeyword) {
      issues.push({
        severity: 'blocking',
        check: 'comparison_period_label',
        message: `근거 ${item.id}는 '${item.comparisonPeriod}' 기준인데 초안에는 '${wrongKeyword}'로 표기됨 — 주변 문맥: "...${window}..."`,
      });
    }
  }
}

// 4. 단위 일관성: 원/천원/백만원/억원 중 둘 이상이 본문에 동시 사용되면 경고.
function checkUnitConsistency(draftText, issues) {
  const counts = {};
  let m;
  UNIT_TOKEN_REGEX.lastIndex = 0;
  while ((m = UNIT_TOKEN_REGEX.exec(draftText))) {
    counts[m[0]] = (counts[m[0]] || 0) + 1;
  }
  const usedUnits = Object.keys(counts);
  if (usedUnits.length > 1) {
    issues.push({
      severity: 'warn',
      check: 'unit_consistency',
      message: `문서에 서로 다른 단위가 혼용됨: ${usedUnits.map((u) => `${u}(${counts[u]}회)`).join(', ')}`,
    });
  }
}

// 5. 필수 섹션 누락: plan.json sections의 title이 초안 헤딩/본문에 있는지.
function checkRequiredSections(draftText, planDoc, issues) {
  if (!planDoc || !Array.isArray(planDoc.sections)) return;
  for (const section of planDoc.sections) {
    if (!section.title) continue;
    if (!draftText.includes(section.title)) {
      issues.push({
        severity: 'blocking',
        check: 'required_section',
        message: `plan.json에 정의된 섹션 '${section.title}'이 초안에서 발견되지 않음`,
      });
    }
  }
}

// 6. 미검증 전망 flag: 전망성 키워드가 등장하면 차단하지 않고 James에게
//    명시적으로 넘긴다 (근거 없는 전망 여부는 의미 판단이라 코드가 확정할 수
//    없음).
function checkForwardLookingStatements(draftText, issues) {
  const sentences = draftText.split(/(?<=[.\n])/);
  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (!trimmed) continue;
    const hit = FORWARD_LOOKING_KEYWORDS.find((k) => trimmed.includes(k));
    if (hit) {
      issues.push({
        severity: 'needs_review',
        check: 'forward_looking_statement',
        message: `전망성 표현('${hit}') 포함 문장 — James가 INFERRED/UNVERIFIED 근거 여부를 확인해야 함: "${trimmed.slice(0, 120)}"`,
      });
    }
  }
}

function validateDraft({ draftText, evidence, plan }) {
  const text = String(draftText || '');
  const issues = [];
  checkFormulas(text, issues);
  checkEvidenceCoverage(text, evidence, issues);
  checkComparisonPeriodLabels(text, evidence, issues);
  checkUnitConsistency(text, issues);
  checkRequiredSections(text, plan, issues);
  checkForwardLookingStatements(text, issues);

  const hasBlocking = issues.some((i) => i.severity === 'blocking');
  const hasWarn = issues.some((i) => i.severity === 'warn' || i.severity === 'needs_review');
  const status = hasBlocking ? 'FAIL' : hasWarn ? 'WARN' : 'PASS';
  return { status, issues };
}

module.exports = { validateDraft, safeEvalFormula };
