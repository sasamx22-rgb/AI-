const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
// cross-spawn: Windows에서 npm이 설치한 .cmd 셸 스크립트(claude.cmd)를
// shell:true 없이도 안전하게 찾아 실행해준다. shell:true + 배열 인자
// 조합은 사용자가 입력한 텍스트를 이스케이프 없이 셸 명령에 섞어 넣는
// 셈이라 인젝션 위험이 있다(Node가 deprecation 경고를 띄우는 이유).
const spawn = require('cross-spawn');
const express = require('express');
const multer = require('multer');

const REPO_ROOT = path.resolve(__dirname, '..');
const INPUTS_DIR = path.join(REPO_ROOT, 'inputs');
const TMP_UPLOAD_DIR = path.join(__dirname, '.tmp-uploads');
const PORT = process.env.PORT || 4000;
const MAX_REJECTION_ROUNDS = 3;

if (!fs.existsSync(TMP_UPLOAD_DIR)) fs.mkdirSync(TMP_UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(INPUTS_DIR)) fs.mkdirSync(INPUTS_DIR, { recursive: true });

const upload = multer({ dest: TMP_UPLOAD_DIR });

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 에이미/제임스는 이제 서로 다른 독립 Claude Code 세션이다. 각자
// --session-id로 세션을 만들고, 이후엔 --resume으로 그 세션을 계속
// 이어간다 — 즉 각자 자기 대화 전체를 스스로 기억한다. 채팅창은
// 하나지만(client.js가 speaker 값으로 말풍선만 나눔), 뒤에서는 완전히
// 분리된 두 개의 claude 프로세스/세션이 각자 돌아간다.
const AGENTS = {
  amy: {
    label: '에이미',
    agentFlag: 'executor',
    sessionId: crypto.randomUUID(),
    started: false,
    extraArgs: [],
  },
  james: {
    label: '제임스',
    agentFlag: 'reviewer',
    sessionId: crypto.randomUUID(),
    started: false,
    // reviewer.md의 tools 제한(Read/Glob/Grep)이 최상위 세션에도 그대로
    // 적용될 것으로 보지만, 헤드리스·자동승인 구조라 이중으로 막아둔다.
    extraArgs: ['--disallowed-tools', 'Write', 'Edit'],
  },
};

let pendingRejectionRounds = 0;

app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '파일이 없습니다.' });
  const destPath = path.join(INPUTS_DIR, req.file.originalname);
  fs.renameSync(req.file.path, destPath);
  res.json({ ok: true, filename: req.file.originalname });
});

app.post('/api/chat', (req, res) => {
  const userMessage = ((req.body && req.body.message) || '').toString();
  if (!userMessage.trim()) {
    res.status(400).json({ error: '메시지가 비어 있습니다.' });
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  const send = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  let activeChild = null;
  // 주의: req(요청)이 아니라 res(응답)의 'close'를 써야 한다. req.on('close')는
  // 요청 바디를 다 읽자마자(응답이 끝나기 한참 전에) 발동하는 경우가 있어서,
  // 그걸로 프로세스를 죽이면 claude가 출력을 내기도 전에 즉시 kill된다.
  res.on('close', () => {
    if (!res.writableEnded && activeChild) activeChild.kill();
  });

  handleUserMessage(userMessage, send, (child) => { activeChild = child; })
    .catch((err) => {
      console.error('[chat] 처리 중 오류', err);
      send('error', { message: `서버 내부 오류: ${err.message}` });
    })
    .finally(() => {
      send('done', {});
      res.end();
    });
});

// 사용자가 "에이미, ~" / "제임스, ~"로 직접 부르면 해당 세션에만 말을
// 걸고, 그렇지 않으면 기본 흐름(에이미 작성 -> 제임스 자동 검토 ->
// 필요시 반박/재검토 반복 -> 승인 -> 최종본)을 자동으로 돌린다.
async function handleUserMessage(userMessage, send, setActiveChild) {
  const direct = matchDirectAddress(userMessage);
  if (direct) {
    await runTurn(direct.agentKey, userMessage, send, setActiveChild);
    return;
  }

  pendingRejectionRounds = 0;
  await runTurn('amy', userMessage, send, setActiveChild);

  for (;;) {
    const reviewPrompt =
      `사용자 요청: "${userMessage}"\n\n` +
      '에이미가 방금 이 요청에 대해 작업했습니다. outputs/ 폴더의 ' +
      '최신 산출물(그리고 필요하면 inputs/ 원본)을 검토해주세요.';
    const jamesText = await runTurn('james', reviewPrompt, send, setActiveChild);

    if (/\[검토결과:\s*승인\]/.test(jamesText)) {
      pendingRejectionRounds = 0;
      const finalizePrompt =
        '제임스가 방금 검토를 승인했습니다. 최종본을 만들어주세요.\n\n' +
        `제임스의 승인 메시지:\n${jamesText}`;
      await runTurn('amy', finalizePrompt, send, setActiveChild);
      return;
    }

    if (!/\[검토결과:\s*반려\]/.test(jamesText)) {
      send('message', {
        speaker: '진행자',
        text: '제임스의 검토 결과(승인/반려)를 판독하지 못했습니다. ' +
          '"제임스, 검토 결과가 승인이야 반려야?"처럼 직접 물어봐주세요.',
      });
      return;
    }

    pendingRejectionRounds += 1;
    if (pendingRejectionRounds >= MAX_REJECTION_ROUNDS) {
      send('message', {
        speaker: '진행자',
        text: `반려가 ${pendingRejectionRounds}회 반복되어 자동 진행을 멈춥니다. ` +
          '직접 에이미/제임스에게 말을 걸어 판단해주세요.',
      });
      return;
    }

    const rebutPrompt =
      '제임스가 다음과 같이 검토·반려했습니다. 동의하는 부분은 반영하고, ' +
      '동의하지 않으면 근거를 들어 반박해주세요.\n\n' + jamesText;
    await runTurn('amy', rebutPrompt, send, setActiveChild);
    // 다시 루프 위로 올라가 제임스에게 재검토를 요청한다.
  }
}

function matchDirectAddress(userMessage) {
  const m = userMessage.match(/^\s*(에이미|제임스)\s*[,:]?\s*/);
  if (!m) return null;
  return { agentKey: m[1] === '에이미' ? 'amy' : 'james' };
}

// 한 에이전트(에이미 또는 제임스)의 세션에 메시지 하나를 보내고, 그
// 턴에서 나온 assistant 텍스트 전체를 이어붙여 반환한다. 응답이 오는
// 대로 client에도 실시간으로 말풍선을 보낸다.
function runTurn(agentKey, message, send, setActiveChild) {
  const agent = AGENTS[agentKey];
  const args = [
    '--agent', agent.agentFlag,
    '-p', message,
    '--output-format', 'stream-json',
    '--verbose',
    '--permission-mode', 'bypassPermissions',
    ...(agent.started ? ['--resume', agent.sessionId] : ['--session-id', agent.sessionId]),
    ...agent.extraArgs,
  ];

  console.log(`\n[${agent.label}] claude ${args.map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' ')}`);

  return new Promise((resolve) => {
    const child = spawn('claude', args, { cwd: REPO_ROOT });
    setActiveChild(child);
    agent.started = true;

    let fullText = '';
    let messageCount = 0;
    let stderrText = '';
    let unknownLineCount = 0;
    let buffer = '';

    const processLine = (line) => {
      if (!line.trim()) return;
      console.log(`[${agent.label} stdout]`, line.slice(0, 500));
      let json;
      try {
        json = JSON.parse(line);
      } catch (e) {
        unknownLineCount += 1;
        return;
      }
      if (json.type === 'assistant' && json.message && Array.isArray(json.message.content)) {
        const text = json.message.content
          .filter((b) => b.type === 'text' && b.text)
          .map((b) => b.text)
          .join('\n');
        if (text.trim()) {
          fullText += (fullText ? '\n\n' : '') + text.trim();
          messageCount += 1;
          send('message', { speaker: agent.label, text: text.trim() });
        }
        return;
      }
      if (json.type === 'result' && (json.is_error || (json.subtype && json.subtype !== 'success'))) {
        send('error', { message: `${agent.label} 오류(${json.subtype || 'unknown'}): ${json.result || json.error || '상세 내용 없음'}` });
      }
    };

    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) processLine(line);
    });

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      stderrText += text;
      console.error(`[${agent.label} stderr]`, text);
    });

    child.on('error', (err) => {
      console.error(`[${agent.label} spawn error]`, err);
      send('error', { message: `${agent.label} 실행 실패: ${err.message}. claude CLI가 설치되어 PATH에 있는지 확인하세요.` });
      resolve('');
    });

    child.on('close', (code) => {
      if (buffer.trim()) processLine(buffer); // 줄바꿈 없이 끝난 마지막 줄도 처리
      console.log(`[${agent.label}] 종료 (exit code ${code}), 발언 ${messageCount}건`);

      if (messageCount === 0) {
        const detail = [
          `${agent.label}의 claude 프로세스가 종료됐지만(exit code ${code}) 응답이 없습니다.`,
          stderrText.trim() ? `표준에러 출력: ${stderrText.trim().slice(0, 1000)}` : null,
          unknownLineCount > 0 ? `(해석 못한 출력 줄 ${unknownLineCount}개 — 서버 터미널 창의 로그를 확인하세요.)` : null,
        ].filter(Boolean).join('\n');
        send('error', { message: detail });
      }

      resolve(fullText);
    });
  });
}

app.listen(PORT, () => {
  console.log(`AI 비서 채팅창이 준비됐습니다: http://localhost:${PORT}`);
  console.log(`에이미 세션: ${AGENTS.amy.sessionId}`);
  console.log(`제임스 세션: ${AGENTS.james.sessionId}`);
});
