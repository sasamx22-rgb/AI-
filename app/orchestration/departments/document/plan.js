'use strict';

// 문서유형별 기본 구조 템플릿 (섹션 12). plan.json이 sections를 비워서 오면
// documentType에 맞는 기본 구조를 제안값으로 채워준다 — 강제는 아니고, Amy가
// 실제 내용에 맞게 조정할 수 있다. 문서 언어가 기본적으로 한국어(language: ko)이므로
// 제목 자체는 한국어로 두고, 사용자 스펙 원문의 영문 카테고리명은 category로 남겨
// 매핑 관계를 추적할 수 있게 한다.
const DEFAULT_SECTIONS_BY_TYPE = {
  audit_memo: [
    { title: '목적', category: 'Purpose' },
    { title: '사실관계', category: 'Facts' },
    { title: '회계/감사 분석', category: 'Accounting/Audit Analysis' },
    { title: '수행 절차', category: 'Procedures' },
    { title: '결론', category: 'Conclusion' },
  ],
  financial_report: [
    { title: '요약', category: 'Executive Summary' },
    { title: '주요 사항', category: 'Findings' },
    { title: '영향 분석', category: 'Impact' },
    { title: '향후 조치', category: 'Actions' },
  ],
  management_report: [
    { title: '요약', category: 'Executive Summary' },
    { title: '주요 사항', category: 'Findings' },
    { title: '영향 분석', category: 'Impact' },
    { title: '향후 조치', category: 'Actions' },
  ],
  email: [
    { title: '배경', category: 'Context' },
    { title: '요청 사항', category: 'Request' },
    { title: '기한', category: 'Deadline' },
    { title: '맺음말', category: 'Closing' },
  ],
  general_report: [
    { title: '요약', category: 'Summary' },
    { title: '근거', category: 'Evidence' },
    { title: '세부 분석', category: 'Analysis' },
    { title: '결론', category: 'Conclusion' },
  ],
  company_intro: [
    { title: '요약', category: 'Summary' },
    { title: '근거', category: 'Evidence' },
    { title: '세부 분석', category: 'Analysis' },
    { title: '결론', category: 'Conclusion' },
  ],
};

function defaultSectionsFor(documentType) {
  return DEFAULT_SECTIONS_BY_TYPE[documentType] || DEFAULT_SECTIONS_BY_TYPE.general_report;
}

function validatePlan(doc) {
  const errors = [];
  if (!doc || typeof doc !== 'object') return { ok: false, errors: ['plan.json이 비어있거나 객체가 아닙니다.'] };
  if (!doc.keyMessage) errors.push('keyMessage 누락');
  if (!Array.isArray(doc.sections) || doc.sections.length === 0) {
    errors.push('sections 배열이 비어있습니다 (최소 1개 필요)');
  } else {
    doc.sections.forEach((s, idx) => {
      if (!s.title) errors.push(`sections[${idx}]: title 누락`);
      if (!s.purpose) errors.push(`sections[${idx}]: purpose 누락`);
      if (!Array.isArray(s.evidenceRefs)) errors.push(`sections[${idx}]: evidenceRefs(배열) 누락`);
    });
  }
  return { ok: errors.length === 0, errors };
}

module.exports = { DEFAULT_SECTIONS_BY_TYPE, defaultSectionsFor, validatePlan };
