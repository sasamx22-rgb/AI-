# AI 비서 (회계 업무 자동화)

Claude Code로 구동되는 회계 업무 보조 AI 비서입니다. 보고서/조서
작성(executor)과 검토(reviewer) 역할을 분리해, 사람이 매번 "검토해줘",
"고쳐줘"라고 지시하지 않아도 `/report` 한 번으로 작성→검토→수정
사이클이 자동으로 돕니다.

## 시작하기

```bash
npm install -g @anthropic-ai/claude-code
git clone https://github.com/sasamx22-rgb/ai-.git
cd ai-
claude
```

Claude Code를 실행하면 이 폴더의 `CLAUDE.md`를 자동으로 읽어 비서의
행동 규칙을 적용합니다.

## 사용법

1. `inputs/`에 원본 자료(엑셀, PDF, 지시사항 등)를 넣습니다.
2. Claude Code 안에서 다음처럼 실행합니다.

   ```
   /report 2026년 3분기 실적 보고서 초안 만들어줘
   ```

3. `executor`가 초안을 만들고 `reviewer`가 검토하는 과정이 자동으로
   반복되며, 최종본이 `outputs/`에 저장됩니다.

## 폴더 구조

```text
CLAUDE.md              비서의 기본 행동 원칙
.claude/agents/         executor(작성) / reviewer(검토) 서브에이전트 정의
.claude/commands/       /report 슬래시 커맨드
inputs/                 원본 자료
outputs/                작성된 산출물 (버전별로 보관)
```

## 설계 원칙

- **작성자와 검토자 분리**: 문서를 만드는 주체와 승인하는 주체를
  분리해, 자기 결과물의 허점을 스스로 못 보는 문제를 줄입니다.
- **규칙은 마크다운으로**: `CLAUDE.md`, `.claude/agents/*.md`를 고치는
  것만으로 비서의 행동을 바꿀 수 있습니다. 별도 코드 수정이 필요
  없습니다.
- **근거 없는 숫자 금지**: 모든 산출물의 수치는 `inputs/` 원본과
  대조 가능해야 합니다.
