'use strict';

// Document Department Intake — 사용자 요청을 즉시 문서 작성으로 넘기지 않고
// task.json으로 구조화한다. 정확한 수행에 꼭 필요한 값이 아니면 매번 사용자에게
// 되묻지 않고 합리적인 기본값을 쓰되, 어떤 기본값을 왜 썼는지 assumptions에
// 남긴다 (섹션 9).
//
// overrides는 orchestrator(터미널 모드의 나, 또는 server.js)가 사용자 요청을
// 이미 해석한 결과를 명시적으로 넘길 수 있게 하는 통로다 — 예를 들어 slug나
// documentType처럼 "문장의 의미"를 봐야 잘 고를 수 있는 값은 오케스트레이터가
// LLM 판단으로 넘겨주고, intake는 그 값을 신뢰하되 비어있으면 아래 휴리스틱으로
// 보수적인 기본값을 채운다.

const DOCUMENT_TYPE_KEYWORDS = [
  { type: 'financial_report', words: ['실적', '재무', '매출', '손익', '분기'] },
  { type: 'audit_memo', words: ['감사', '조서', '감사의견', '감사절차'] },
  { type: 'management_report', words: ['경영진 보고', '경영 보고', '이사회'] },
  { type: 'email', words: ['이메일', '메일', '메일로'] },
  { type: 'company_intro', words: ['회사소개', '회사 소개', '소개서', 'ir'] },
];

const FORMAT_KEYWORDS = [
  { format: 'docx', words: ['워드', 'word', '.docx', 'docx'] },
  { format: 'pptx', words: ['ppt', '피피티', '프레젠테이션', '슬라이드', '.pptx', 'pptx'] },
];

const EXTERNAL_KEYWORDS = ['고객', '외부', '제출용', '메일 발송', '감사 결론', '이사회 제출'];

function detectByKeywords(text, table, fallback, fieldName) {
  const lower = text.toLowerCase();
  for (const entry of table) {
    if (entry.words.some((w) => lower.includes(w.toLowerCase()))) {
      return { value: entry[fieldName], matched: true };
    }
  }
  return { value: fallback, matched: false };
}

function defaultSlug(jobId) {
  return `document-${jobId}`;
}

function buildTaskFields(userRequest, overrides = {}) {
  const assumptions = [];
  const text = String(userRequest || '');

  let documentType = overrides.documentType;
  if (!documentType) {
    const r = detectByKeywords(text, DOCUMENT_TYPE_KEYWORDS, 'general_report', 'type');
    documentType = r.value;
    assumptions.push(
      r.matched
        ? `documentType: 요청 문구에서 '${documentType}' 유형으로 추정`
        : `documentType: 요청에서 문서유형을 특정하지 못해 기본값 'general_report' 사용`
    );
  }

  let outputFormat = overrides.outputFormat;
  if (!outputFormat) {
    const r = detectByKeywords(text, FORMAT_KEYWORDS, 'md', 'format');
    outputFormat = r.value;
    assumptions.push(
      r.matched
        ? `outputFormat: 요청 문구에서 '${outputFormat}' 형식 지정 확인`
        : `outputFormat: 형식 언급 없어 기본값 'md'(마크다운) 사용`
    );
  }

  let humanApprovalRequired = overrides.humanApprovalRequired;
  if (humanApprovalRequired === undefined) {
    humanApprovalRequired = EXTERNAL_KEYWORDS.some((w) => text.includes(w));
    assumptions.push(
      humanApprovalRequired
        ? 'humanApprovalRequired: 외부 제출/고객용으로 보이는 키워드 감지 -> true'
        : 'humanApprovalRequired: 내부 문서로 판단, 기본값 false (James 승인만으로 final 가능)'
    );
  }

  const purpose = overrides.purpose || (humanApprovalRequired ? 'external_submission' : 'internal_report');
  const audience = overrides.audience || (humanApprovalRequired ? 'client' : 'management');

  return {
    documentType,
    purpose,
    audience,
    outputFormat,
    outputSlug: overrides.outputSlug || null, // jobId를 알아야 fallback을 만들 수 있어 null로 두고 createDocumentJob에서 채움
    language: overrides.language || 'ko',
    tone: overrides.tone || 'professional',
    asOfDate: overrides.asOfDate || null,
    sourcePolicy: 'job_inputs_only',
    riskLevel: overrides.riskLevel || 'medium',
    reviewRequired: true,
    humanApprovalRequired,
    requiredSections: overrides.requiredSections || [],
    constraints: overrides.constraints || [],
    userRequest: text,
    assumptions,
  };
}

module.exports = { buildTaskFields, defaultSlug, DOCUMENT_TYPE_KEYWORDS, FORMAT_KEYWORDS };
