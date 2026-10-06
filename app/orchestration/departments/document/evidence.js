'use strict';

const EVIDENCE_TYPES = ['CONFIRMED', 'DERIVED', 'INFERRED', 'UNVERIFIED'];

// evidence.json 스키마 검증. 완전한 JSON Schema 라이브러리 없이 필요한 만큼만
// 손으로 검사한다 — CONFIRMED/DERIVED는 출처 없는 사실을 사실처럼 쓰지 못하게
// 막는 것이 핵심이다(섹션 10).
function validateEvidence(doc) {
  const errors = [];
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.items)) {
    return { ok: false, errors: ['evidence.json은 { items: [...] } 형태여야 합니다.'] };
  }
  const seenIds = new Set();
  doc.items.forEach((item, idx) => {
    const where = `items[${idx}]`;
    if (!item.id) errors.push(`${where}: id 누락`);
    else if (seenIds.has(item.id)) errors.push(`${where}: id 중복 (${item.id})`);
    else seenIds.add(item.id);

    if (!item.statement) errors.push(`${where}: statement 누락`);
    if (!EVIDENCE_TYPES.includes(item.type)) {
      errors.push(`${where}: type은 ${EVIDENCE_TYPES.join('/')} 중 하나여야 함 (받은 값: ${item.type})`);
    }
    if (item.type === 'CONFIRMED') {
      if (!item.sourceFile) errors.push(`${where}: CONFIRMED 항목은 sourceFile 필요`);
      if (item.value === undefined) errors.push(`${where}: CONFIRMED 항목은 value 필요`);
    }
    if (item.type === 'DERIVED') {
      if (!Array.isArray(item.sourceRefs) || item.sourceRefs.length === 0) {
        errors.push(`${where}: DERIVED 항목은 sourceRefs(참조 evidence id 배열) 필요`);
      }
      if (!item.formula) errors.push(`${where}: DERIVED 항목은 formula 필요`);
    }
  });
  // sourceRefs가 실제 존재하는 id를 가리키는지 확인
  doc.items.forEach((item, idx) => {
    if (Array.isArray(item.sourceRefs)) {
      for (const ref of item.sourceRefs) {
        if (!seenIds.has(ref)) errors.push(`items[${idx}]: sourceRefs의 '${ref}'가 존재하지 않는 evidence id`);
      }
    }
  });
  return { ok: errors.length === 0, errors };
}

function validateOpenQuestions(doc) {
  const errors = [];
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.items)) {
    return { ok: false, errors: ['open-questions.json은 { items: [...] } 형태여야 합니다.'] };
  }
  doc.items.forEach((item, idx) => {
    const where = `items[${idx}]`;
    if (!item.id) errors.push(`${where}: id 누락`);
    if (!item.question) errors.push(`${where}: question 누락`);
    if (typeof item.blocking !== 'boolean') errors.push(`${where}: blocking(boolean) 누락`);
  });
  return { ok: errors.length === 0, errors };
}

function blockingQuestions(doc) {
  if (!doc || !Array.isArray(doc.items)) return [];
  return doc.items.filter((i) => i.blocking === true);
}

module.exports = { EVIDENCE_TYPES, validateEvidence, validateOpenQuestions, blockingQuestions };
