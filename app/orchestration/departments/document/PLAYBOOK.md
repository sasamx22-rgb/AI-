# Document Department Playbook

이 문서는 `.claude/agents/executor.md`(에이미)·`reviewer.md`(제임스)가
**Document Department 업무를 맡을 때만** 참조하는 세부 규칙이다. 에이미/제임스의
정체성·기본 태도는 각자의 파일에 있고, "문서 유형별 구조"와 "회계/감사
문서 전용 심화 체크리스트"처럼 Document Department에만 해당하는 세부사항만
여기 모아 `CLAUDE.md`와 agent 파일이 비대해지지 않게 한다.

## Job Workspace

Document Department 업무는 (직접 "에이미,"/"제임스,"로 부른 게 아니라 일반
지시로 시작됐다면) 진행자가 미리 `jobs/<jobId>/`를 만들어 넘겨준다. 이
폴더 밖의 `inputs/`·`outputs/`를 직접 뒤지지 말고, 진행자가 알려준
`jobs/<jobId>/` 하위 경로만 사용한다.

```
jobs/<jobId>/
  task.json          진행자가 이미 채워둔 작업 정의(문서유형/형식/기본값 등)
  inputs/             이 작업 전용 원본 자료 스냅샷 (여기만 근거로 사용)
  evidence/
    evidence.json      네가 SOURCE_ANALYSIS 단계에서 작성
    open-questions.json 네가 SOURCE_ANALYSIS 단계에서 작성
  plan/
    plan.json           네가 PLANNING 단계에서 작성
  drafts/
    v<N>.<ext>           네가 DRAFTING 단계에서 작성 (ext: md/docx/pptx)
    v<N>.review.txt      docx/pptx일 때 너도 참고용으로 함께 남긴다(단, 최종
                          검토·확정에 쓰이는 건 진행자가 별도로 만드는 독립
                          추출본 reviews/actual-v<N>.review.txt다 — 네 review.txt는
                          네가 "실제로 뭘 넣었다고 생각하는지" 확인용 보조자료다)
```

## 진행 순서 (한 턴 안에서 순차적으로 진행)

INTAKE는 이미 진행자가 끝내둔 상태로 너에게 온다. 너는 한 턴 안에서
아래 순서를 지켜 진행한다 (중간에 blocking 질문이 나오면 거기서 멈추고
진행자에게 보고한다):

1. **SOURCE_ANALYSIS** — `jobs/<jobId>/inputs/`의 모든 자료를 읽고
   `evidence/evidence.json`, `evidence/open-questions.json`을 작성한다.
   - evidence 항목의 `type`은 반드시 CONFIRMED(원본에서 직접 확인) /
     DERIVED(원본으로 계산) / INFERRED(해석) / UNVERIFIED(근거 불충분) 중
     하나. 출처 없는 사실을 CONFIRMED로 쓰지 않는다.
   - 확인이 필요하지만 진행을 막을 정도는 아니면 open-questions.json에
     `blocking: false`로 남기고 계속 진행한다. 정말 이것 없이는 문서를
     쓸 수 없는 경우만 `blocking: true`로 표시하고, 그 경우 여기서 멈춰
     진행자에게 사용자 확인을 요청한다.
2. **PLANNING** — `plan/plan.json`을 작성한다. `sections[].evidenceRefs`는
   실제 evidence.json의 id를 가리켜야 한다. 아래 "문서유형별 기본 구조"를
   참고하되, 실제 내용에 맞게 조정해도 된다.
3. **DRAFTING** — `drafts/v<N>.<ext>`를 작성한다(N은 진행자가 알려준 버전
   번호). CONFIRMED/DERIVED는 사실로 쓸 수 있지만, INFERRED는 해석임이
   드러나게 쓰고, UNVERIFIED는 확정된 사실처럼 쓰지 않는다. 근거보다 강한
   표현을 하지 않는다.

이후 검증/검토는 진행자가 코드(deterministic validator)와 제임스를 통해
진행하고, 문제가 있으면 구체적인 지적사항과 함께 다시 너에게 돌아온다.

## 문서유형별 기본 구조 (plan.json sections 기본값)

| documentType | 구조 |
|---|---|
| `audit_memo` (감사 메모) | 목적 → 사실관계 → 회계/감사 분석 → 수행 절차 → 결론 |
| `financial_report` / `management_report` (경영진 보고) | 요약 → 주요 사항 → 영향 분석 → 향후 조치 |
| `email` | 배경 → 요청 사항 → 기한 → 맺음말 |
| 그 외(`general_report`, `company_intro` 등) | 요약 → 근거 → 세부 분석 → 결론 |

## 수정 요청 intent 분류 (버전 2 이상 작업 시)

사용자 또는 제임스의 수정 요청은 아래 intent 중 하나로 분류해서 대응
범위를 정한다. 대부분은 **지적된 범위만 고치는 부분 수정**이고, rewrite/
restructure만 더 넓은 수정을 허용한다.

`rewrite`(전면 재작성) · `shorten`(축약) · `expand`(확장) ·
`change_tone`(어조 변경) · `add_evidence`(근거 보강) · `fact_check`(사실
재확인) · `restructure`(구조 변경) · `format_only`(서식만) ·
`correct_number`(수치 정정) · `visual_fix`(시각적 수정)

## 제임스의 Document Review Playbook — 회계/감사 문서 심화 체크리스트

일반 문서 체크리스트(근거/숫자/날짜/논리/누락/결론 등)는 `reviewer.md`
본문에 있다. `documentType`이 `audit_memo`이거나 회계기준 인용이 포함된
문서라면 아래를 추가로 확인한다:

- [ ] **기준서 근거**: 인용한 조항 번호가 실제로 맞는가? (확신 없으면
      "재확인 필요"로 표시하고 승인 자체는 막지 않는다)
- [ ] **반대 회계처리 검토**: 다른 회계처리 대안이 있었다면 왜 현재
      처리가 맞는지 본문에서 다뤘는가?
- [ ] **감사 목적-절차 연결**: 감사 메모라면 Purpose에서 밝힌 목적과
      실제 Procedures가 실제로 연결되는가?
- [ ] **감사증거 충분성**: 결론을 내리기에 제시된 증거(evidence.json의
      CONFIRMED/DERIVED 항목)가 양적으로/질적으로 충분한가?
- [ ] **결론이 증거 범위를 넘지 않는가**: evidence.json에 없는 판단을
      결론에서 새로 도입하지 않았는가?
- [ ] **상위 reviewer가 물을 법한 질문**: 이 문서를 상급자/파트너가 다시
      본다면 추가로 물을 질문이 있는가? 있다면 review JSON의
      `expectedReviewerQuestions`에 적는다.

## James의 구조화된 검토 결과 (진행자가 파싱해서 기록함)

James는 Write 권한이 없어 review 파일을 직접 만들지 않는다. 대신 검토
턴의 마지막에 아래 JSON을 fenced code block(```json ... ```)으로 반드시
포함한다 — 기존 `[검토결과: 승인]`/`[검토결과: 반려]` 태그는 사람이 읽기
위해 계속 유지하되, 이 JSON이 실제로 상태를 기록하는 데 쓰인다.

```json
{
  "status": "APPROVED",
  "blockingIssues": [],
  "nonBlockingIssues": [],
  "expectedReviewerQuestions": [],
  "questionsForUser": []
}
```
`status`는 `APPROVED` 또는 `REJECTED`. 반려라면 `blockingIssues`에 구체적인
지적사항을 배열로 채운다(각 항목: 어디가, 왜 문제인지).
