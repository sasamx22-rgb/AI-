const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const express = require('express');
const multer = require('multer');

const REPO_ROOT = path.resolve(__dirname, '..');
const INPUTS_DIR = path.join(REPO_ROOT, 'inputs');
const TMP_UPLOAD_DIR = path.join(__dirname, '.tmp-uploads');
const PORT = process.env.PORT || 4000;

if (!fs.existsSync(TMP_UPLOAD_DIR)) fs.mkdirSync(TMP_UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(INPUTS_DIR)) fs.mkdirSync(INPUTS_DIR, { recursive: true });

const upload = multer({ dest: TMP_UPLOAD_DIR });

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 이 서버가 살아있는 동안의 대화 세션 id (Claude Code --resume용).
// 단일 사용자용 로컬 앱이라 프로세스 전역 변수 하나로 충분하다.
let currentSessionId = null;

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

  // acceptEdits/default 모드는 파일 쓰기·명령 실행마다 승인을 기다리는데
  // 이 앱엔 승인 버튼이 없으므로, 이 프로젝트 폴더 안에서만 자동 승인되도록
  // bypassPermissions로 실행한다. (README의 "보안 관련 중요 사항" 참고)
  const args = [
    '-p', userMessage,
    '--output-format', 'stream-json',
    '--verbose',
    '--permission-mode', 'bypassPermissions',
  ];
  if (currentSessionId) {
    args.push('--resume', currentSessionId);
  }

  console.log(`\n[chat] claude ${args.map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' ')}`);

  const child = spawn('claude', args, { cwd: REPO_ROOT, shell: true });

  let messageCount = 0;
  let stderrText = '';
  let unknownLineCount = 0;

  const processLine = (line) => {
    if (!line.trim()) return;
    console.log('[claude stdout]', line.slice(0, 500));
    let json;
    try {
      json = JSON.parse(line);
    } catch (e) {
      unknownLineCount += 1;
      return;
    }
    handleEvent(json, send, (n) => { messageCount += n; });
  };

  let buffer = '';
  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) processLine(line);
  });

  child.stderr.on('data', (chunk) => {
    const text = chunk.toString('utf8');
    stderrText += text;
    console.error('[claude stderr]', text);
    send('error', { message: text });
  });

  child.on('error', (err) => {
    console.error('[claude spawn error]', err);
    send('error', { message: `claude 실행 실패: ${err.message}. claude CLI가 설치되어 PATH에 있는지 확인하세요.` });
    res.end();
  });

  child.on('close', (code) => {
    if (buffer.trim()) processLine(buffer); // 줄바꿈 없이 끝난 마지막 줄도 처리
    console.log(`[chat] claude 종료 (exit code ${code}), 발언 ${messageCount}건`);

    if (messageCount === 0) {
      // 정상 종료됐는데도 에이미/제임스 말풍선이 하나도 없으면, 원인 파악에
      // 필요한 정보를 그대로 화면에 띄운다 — 조용히 실패시키지 않는다.
      const detail = [
        `claude 프로세스가 종료됐지만(exit code ${code}) 응답 메시지가 없습니다.`,
        stderrText.trim() ? `표준에러 출력: ${stderrText.trim().slice(0, 1000)}` : null,
        unknownLineCount > 0 ? `(해석 못한 출력 줄 ${unknownLineCount}개 — 서버 터미널 창의 [claude stdout] 로그를 확인하세요.)` : null,
      ].filter(Boolean).join('\n');
      send('error', { message: detail });
    }

    send('done', { code });
    res.end();
  });

  req.on('close', () => {
    child.kill();
  });
});

function handleEvent(json, send, countMessage) {
  if (json.type === 'system' && json.subtype === 'init' && json.session_id) {
    currentSessionId = json.session_id;
    return;
  }
  if (json.type === 'result') {
    if (json.session_id) currentSessionId = json.session_id;
    if (json.is_error || (json.subtype && json.subtype !== 'success')) {
      send('error', { message: `claude 오류(${json.subtype || 'unknown'}): ${json.result || json.error || '상세 내용 없음'}` });
      countMessage(1);
    }
    return;
  }
  if (json.type === 'assistant' && json.message && Array.isArray(json.message.content)) {
    const text = json.message.content
      .filter((b) => b.type === 'text' && b.text)
      .map((b) => b.text)
      .join('\n');
    if (text.trim()) {
      emitSpeakerChunks(text, send);
      countMessage(1);
    }
  }
}

// "[에이미]", "[제임스]", "[진행자]" 태그로 문단을 나눠 발언자별로 전송한다.
// 태그가 하나도 없으면 전체를 진행자 발언으로 취급한다.
function emitSpeakerChunks(text, send) {
  const tagRegex = /\[(에이미|제임스|진행자)\]/g;
  const marks = [];
  let match;
  while ((match = tagRegex.exec(text)) !== null) {
    marks.push({ speaker: match[1], tagStart: match.index, contentStart: match.index + match[0].length });
  }
  if (marks.length === 0) {
    send('message', { speaker: '진행자', text: text.trim() });
    return;
  }
  for (let i = 0; i < marks.length; i++) {
    const start = marks[i].contentStart;
    const end = i + 1 < marks.length ? marks[i + 1].tagStart : text.length;
    const chunk = text.slice(start, end).trim();
    if (chunk) {
      send('message', { speaker: marks[i].speaker, text: chunk });
    }
  }
}

app.listen(PORT, () => {
  console.log(`AI 비서 채팅창이 준비됐습니다: http://localhost:${PORT}`);
});
