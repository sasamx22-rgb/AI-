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
const OUTPUTS_DIR = path.join(REPO_ROOT, 'outputs');
const TMP_UPLOAD_DIR = path.join(__dirname, '.tmp-uploads');
const PORT = process.env.PORT || 4000;
const HOST = '127.0.0.1';
const MAX_REJECTION_ROUNDS = 3;
const USAGE_LOG = path.join(__dirname, '.usage-log.jsonl');

if (!fs.existsSync(TMP_UPLOAD_DIR)) fs.mkdirSync(TMP_UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(INPUTS_DIR)) fs.mkdirSync(INPUTS_DIR, { recursive: true });
if (!fs.existsSync(OUTPUTS_DIR)) fs.mkdirSync(OUTPUTS_DIR, { recursive: true });

const upload = multer({ dest: TMP_UPLOAD_DIR });

const app = express();

// 이 서버는 사용자 PC 안에서만 쓴다: 127.0.0.1에만 바인딩하고, 다른 호스트명(DNS rebinding)이나
// 다른 사이트에서 온 요청(Origin)은 거부한다. 에이미/제임스가 자동 승인 모드로 파일을 다루기 때문이다.
const ALLOWED_HOSTS = new Set([`${HOST}:${PORT}`, `localhost:${PORT}`]);
const ALLOWED_ORIGINS = new Set([`http://${HOST}:${PORT}`, `http://localhost:${PORT}`]);
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (!ALLOWED_HOSTS.has(req.headers.host) || (origin && !ALLOWED_ORIGINS.has(origin))) {
    res.status(403).send('forbidden');
    return;
  }
  next();
});

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

// 한 번에 한 작업만 처리한다. 작업 중에 새 요청이 오거나 파일이 업로드되면 에이미/제임스가
// 읽고 있는 inputs/·outputs/가 중간에 바뀌므로, 둘 다 거절하고 끝난 뒤 다시 하도록 안내한다.
let busy = false;
let reqSeq = 0;
const run = { req: 0, step: 0, route: '' }; // 사용량 기록용(내용 없는 익명 번호)

// 마지막 메시지 이후에 올린 파일 이름. 에이미에게 보내는 다음 메시지 앞에 붙이고 비운다(모델 호출 없음).
let pendingUploads = [];

// multer는 파일명을 latin1로 읽어 한글이 깨진다. 브라우저는 UTF-8 바이트로 보내므로 되돌려 읽고,
// 경로 구분자·제어문자는 제거한다.
function safeUploadName(original) {
  let name = String(original || 'upload');
  try {
    const fixed = Buffer.from(name, 'latin1').toString('utf8');
    if (!fixed.includes('\uFFFD')) name = fixed;
  } catch (e) { /* 원래 이름 유지 */ }
  name = path.basename(name.split('\\').join('/')).replace(/[\u0000-\u001f<>:"|?*]/g, '_').trim();
  return name || 'upload';
}
// 같은 이름이 이미 있으면 덮어쓰지 않고 "이름 (2).확장자"로 저장한다.
function uniquePath(dir, name) {
  const ext = path.extname(name);
  const base = path.basename(name, ext);
  let candidate = path.join(dir, name);
  for (let i = 2; fs.existsSync(candidate); i += 1) candidate = path.join(dir, base + ' (' + i + ')' + ext);
  return candidate;
}
function takeUploadNotice() {
  if (!pendingUploads.length) return '';
  const list = pendingUploads.map((n) => 'inputs/' + n).join(', ');
  pendingUploads = [];
  return '[이번에 올린 파일: ' + list + ']\n';
}

app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '파일이 없습니다.' });
  if (busy) {
    try { fs.unlinkSync(req.file.path); } catch (e) { /* ignore */ }
    return res.status(409).json({ error: '작업이 진행 중이라 지금은 파일을 올릴 수 없습니다. 작업이 끝난 뒤 다시 올려주세요.' });
  }
  const name = safeUploadName(req.file.originalname);
  const destPath = uniquePath(INPUTS_DIR, name);
  fs.renameSync(req.file.path, destPath);
  const saved = path.basename(destPath);
  pendingUploads.push(saved); // 다음 메시지를 에이미에게 보낼 때 "이번에 올린 파일"로 알려 준다
  res.json({ ok: true, filename: saved });
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

  if (busy) {
    send('message', { speaker: '진행자', text: '이전 작업이 아직 진행 중입니다. 끝난 뒤에 다시 보내주세요.' });
    send('done', {});
    res.end();
    return;
  }
  busy = true;
  reqSeq += 1;
  run.req = reqSeq;
  run.step = 0;
  run.route = '';

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
      busy = false;
      send('done', {});
      res.end();
    });
});

// 검토 턴의 마지막 줄만 승인/반려 판정에 쓴다. 본문 어딘가에 과거
// 승인 문구를 인용만 해도 통과되는 걸 막기 위해서다(예: "지난번엔
// [검토결과: 승인]이었지만 이번엔 새 오류가 있어 반려합니다").
function parseVerdict(jamesText) {
  const lines = jamesText.split('\n').map((l) => l.trim()).filter(Boolean);
  const lastLine = lines[lines.length - 1] || '';
  if (/^\[검토결과:\s*승인\]$/.test(lastLine)) return 'approved';
  if (/^\[검토결과:\s*반려\]$/.test(lastLine)) return 'rejected';
  return 'unknown';
}

// outputs/ 폴더 전체(하위 폴더 포함)의 상대경로->내용 해시 스냅샷. 직접
// 호명("에이미, ~") 턴 전후로 비교해서, 실제로 산출물이 바뀌었는지
// (=검토가 필요한 작업인지) 판단한다. 폴더 mtime이나 최상위 항목만
// 보면 outputs/A회사/발표.pptx 같은 하위 파일 수정을 놓치므로 재귀로
// 훑고, 내용 해시를 쓴다(읽기 실패 시에만 크기+mtime으로 대체).
// _verify/ 는 검증용 산출물이라 변경 감지에서 제외한다.
function snapshotOutputs(dir = OUTPUTS_DIR, base = OUTPUTS_DIR, map = {}) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return map;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(base, full);
    if (entry.isDirectory()) {
      if (entry.name === '_verify' || entry.name === '_history') continue;
      snapshotOutputs(full, base, map);
    } else if (entry.isFile()) {
      try {
        map[rel] = crypto.createHash('sha1').update(fs.readFileSync(full)).digest('hex');
      } catch (e) {
        const stat = fs.statSync(full);
        map[rel] = `${stat.size}:${stat.mtimeMs}`;
      }
    }
  }
  return map;
}

function outputsChanged(before, after) {
  const names = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const name of names) {
    if (before[name] !== after[name]) return true;
  }
  return false;
}

// 이름 없는 메시지는 LLM 호출 없이 규칙으로만 분류한다. "검토/리뷰/검증/점검"이 있고 작성·수정
// 동사가 없으면 기존 산출물 검토 요청으로 보고 제임스에게 보낸다. 그 외에는 에이미가 받는다.
// 틀리면 "에이미, ~" / "제임스, ~"로 직접 부르면 된다.
const REVIEW_WORDS = /(검토|리뷰|검증|점검)/;
const WORK_WORDS = /(만들|만드|작성|써\s*줘|생성|수정|고쳐|고치|반영|변경|추가|삭제|변환|채워)/;
function looksLikeReviewRequest(message) {
  return REVIEW_WORDS.test(message) && !WORK_WORDS.test(message);
}

// 자동 검토 턴에만 제임스가 승인/반려 태그를 붙이도록 [자동 검토 요청] 표지를 단다.
function buildReviewPrompt(userMessage, { lastAmyText, reviewOnly } = {}) {
  let intro = '에이미가 방금 이 요청에 대해 작업했습니다.\n\n';
  if (reviewOnly) intro = '사용자가 기존 산출물의 검토를 요청했습니다.\n\n';
  if (lastAmyText) intro = `에이미가 직전 지적사항에 대해 다음과 같이 응답(수정/반박)했습니다:\n${lastAmyText}\n\n`;
  return (
    '[자동 검토 요청]\n' +
    `사용자 요청: "${userMessage}"\n\n` +
    intro +
    'outputs/ 폴더의 최신 산출물(그리고 필요하면 inputs/ 원본)을 검토해주세요. ' +
    '검토 결과의 마지막 줄은 [검토결과: 승인] 또는 [검토결과: 반려] 중 하나여야 합니다.'
  );
}

// 사용자 확인 대기: 에이미가 응답 마지막 줄에 [확인필요]를 붙이면 제임스 자동 검토를 보류하고
// 대기 상태로 둔다. 사용자가 CONFIRM_WAIT_MS(기본 30분) 안에 답하지 않으면 브라우저가 이 서버에
// AUTO_MARK 메시지를 보내고(/api/pending으로 마감 시각을 확인), 에이미가 가정으로 끝까지 작성한다.
// 이 경우 제임스 검토는 하지 않고 -final도 만들지 않는다.
const CONFIRM_WAIT_MS = Number(process.env.CONFIRM_WAIT_MS) || 30 * 60 * 1000;
const AUTO_MARK = '[미응답-자동진행]';
const AUTO_PROMPT =
  '[미응답 자동 진행] 사용자가 앞서 물은 확인 사항에 ' + Math.round(CONFIRM_WAIT_MS / 60000) + '분 안에 답하지 않았습니다. ' +
  '이미 제임스가 승인한 버전이 있고 물은 것이 최종본 승인 항목뿐이면 파일을 새로 만들지 말고(새 버전·재생성 금지) notes.md에 보류 항목만 적고 끝내세요. ' +
  '그 밖에는(아직 산출물이 없거나 작성 전 질문) 물어본 항목을 가장 보수적인 가정으로 처리해 끝까지 작성하세요. 가정은 응답의 "가정" 항목과 ' +
  '회사 폴더의 notes.md에 적고, 코멘트에도 "사용자 미확인 가정"이라고 표시하세요. ' +
  '새 질문으로 멈추지 마세요. 제임스 검토는 요청하지 않으며 -final을 만들지 않습니다.';
let pendingConfirm = null; // { deadline: ms }

function needsUserConfirm(text) {
  const lines = String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);
  return (lines[lines.length - 1] || '') === '[확인필요]';
}

// ---- 산출물·검토 자료 목록과 열기 (다운로드 없이 원본 위치에서 바로 연다. 토큰을 쓰지 않는다) ----
const COMPANIES_DIR = path.join(REPO_ROOT, 'companies');
const HIDE_OUTPUT = /(\.work\.xlsx|\.review\.txt|\.record\.txt)$|^~\$/;
function listFilesFlat(dir, base, skipDirs) {
  const out = [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (skipDirs.has(e.name)) continue;
      out.push(...listFilesFlat(full, base, skipDirs));
    } else if (e.isFile()) {
      let st; try { st = fs.statSync(full); } catch (err) { continue; }
      out.push({ rel: path.relative(REPO_ROOT, full).split(path.sep).join('/'), name: e.name, mtime: st.mtimeMs, size: st.size });
    }
  }
  return out;
}
app.get('/api/files', (req, res) => {
  const outputs = listFilesFlat(OUTPUTS_DIR, OUTPUTS_DIR, new Set(['_verify', '_history']))
    .filter((f) => !HIDE_OUTPUT.test(f.name) && !f.name.startsWith('.') && !f.name.startsWith('sample-') && !f.rel.includes('/sample-'))
    .map((f) => {
      const isFinal = /-final\.[^.]+$/.test(f.name);
      const m = /^FAR_([a-z0-9]+)_FY(\d{4})/i.exec(f.name);
      let review = [];
      if (m) {
        const vdir = path.join(COMPANIES_DIR, m[1], 'FY' + m[2], 'verify');
        review = listFilesFlat(vdir, vdir, new Set()).map((r) => ({ rel: r.rel, name: r.name }));
        const rec = f.rel.replace(/\.[^.]+$/, '.record.txt');
        if (isFinal && fs.existsSync(path.join(REPO_ROOT, rec))) review.unshift({ rel: rec, name: path.basename(rec) });
      }
      return { ...f, status: isFinal ? 'final' : 'draft', review };
    })
    .sort((a, b) => b.mtime - a.mtime);
  res.json({ files: outputs, now: Date.now() });
});

// 열 수 있는 곳: outputs/ 아래(내부 폴더 제외), companies/<약칭>/FY<연도>/verify/ 아래뿐이다.
function resolveOpenable(rel) {
  if (typeof rel !== 'string' || !rel || rel.includes(String.fromCharCode(0))) return null;
  const full = path.resolve(REPO_ROOT, rel);
  let real;
  try { real = fs.realpathSync(full); } catch (e) { return null; }
  const inside = (root) => { const r = path.relative(root, real); return r && !r.startsWith('..') && !path.isAbsolute(r); };
  if (inside(OUTPUTS_DIR)) return real;
  const rc = path.relative(COMPANIES_DIR, real).split(path.sep);
  if (inside(COMPANIES_DIR) && rc.length >= 4 && /^FY\d{4}$/.test(rc[1]) && rc[2] === 'verify') return real;
  return null;
}
app.post('/api/open', (req, res) => {
  const real = resolveOpenable(req.body && req.body.rel);
  if (!real) { res.status(400).json({ ok: false, error: '열 수 없는 경로입니다.' }); return; }
  if (process.platform !== 'win32') { res.status(501).json({ ok: false, error: 'Windows에서만 지원합니다.' }); return; }
  const folder = req.body.mode === 'folder';
  const args = folder ? ['/select,' + real] : [real];
  try {
    const child = spawn('explorer.exe', args, { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 새 작업 시작: 에이미·제임스의 세션을 새로 만들어 이전 회사 대화의 기억을 끊는다(회사를 바꿀 때 쓴다).
// 맥락이 쌓이면 매 턴 비용이 커지고, 제임스가 이전 회사의 맥락을 가진 채 검토하면 독립성이 약해진다.
// 작업 중에는 거절한다(진행 중인 호출의 세션을 바꾸면 안 된다).
app.post('/api/reset', (req, res) => {
  if (busy) {
    res.status(409).json({ error: '작업 중에는 새로 시작할 수 없습니다. 끝난 뒤 다시 눌러 주세요.' });
    return;
  }
  for (const a of Object.values(AGENTS)) {
    a.sessionId = crypto.randomUUID();
    a.started = false;
  }
  pendingConfirm = null;
  pendingRejectionRounds = 0;
  console.log('새 작업 시작: 에이미/제임스 세션을 새로 만들었습니다.');
  console.log('  에이미 세션: ' + AGENTS.amy.sessionId);
  console.log('  제임스 세션: ' + AGENTS.james.sessionId);
  res.json({ ok: true });
});

app.get('/api/pending', (req, res) => {
  res.json(pendingConfirm ? { pending: true, deadline: pendingConfirm.deadline, now: Date.now() } : { pending: false });
});

// 처리 경로:
//  - 제임스를 부르거나 기존 파일 검토를 요청 -> 제임스 한 번(자동 연쇄 없음)
//  - 그 외(에이미를 부르거나 이름 없는 메시지) -> 에이미 한 번. 산출물(outputs/)이 실제로 바뀐
//    경우에만 제임스 검토 -> 반려 시 반영/반박 -> 승인 -> 최종본 루프로 이어진다. 일반 대화나 질문은
//    산출물이 바뀌지 않으므로 Claude 호출이 한 번으로 끝난다.
async function handleUserMessage(userMessage, send, setActiveChild) {
  let autoProceed = false;
  if (userMessage.trim() === AUTO_MARK) {
    if (!pendingConfirm || Date.now() < pendingConfirm.deadline) {
      send('message', { speaker: '진행자', text: '대기 중인 확인 사항이 없거나 아직 대기 시간이 지나지 않았습니다.' });
      return;
    }
    autoProceed = true;
    userMessage = AUTO_PROMPT;
  }
  const direct = matchDirectAddress(userMessage);
  // 에이미가 확인을 기다리는 중이면 "제임스"라고 부르지 않은 메시지(질문 카드 답변 등)는 키워드와 상관없이 에이미에게 간다.
  const answeringPending = !!pendingConfirm && !direct;
  const toJames = !autoProceed && (direct ? direct.agentKey === 'james' : (!answeringPending && looksLikeReviewRequest(userMessage)));

  if (toJames) {
    run.route = direct ? 'james-direct' : 'review-request';
    const prompt = direct ? userMessage : buildReviewPrompt(userMessage, { reviewOnly: true });
    const result = await runTurn('james', prompt, send, setActiveChild);
    if (!direct && !result.failed && parseVerdict(result.text) === 'rejected') {
      send('message', {
        speaker: '진행자',
        text: '제임스가 반려했습니다. 에이미가 지적사항을 반영하길 원하면 "에이미, 제임스 지적 반영해줘"라고 말해주세요.',
      });
    }
    return;
  }

  run.route = autoProceed ? 'amy-auto' : (direct ? 'amy-direct' : 'amy');
  const resume = pendingConfirm && pendingConfirm.resume ? pendingConfirm.resume : null; // 제임스 반려 뒤 사용자 확인을 기다리던 중이었나
  pendingConfirm = null; // 에이미에게 말을 걸면(사용자 답변 또는 자동 진행) 이전 확인 대기는 끝난다.
  const before = snapshotOutputs();
  const result = await runTurn('amy', (autoProceed ? '' : takeUploadNotice()) + userMessage, send, setActiveChild);
  if (result.failed) return; // 실행 자체가 실패했으면 여기서 멈춘다 (자동 진행 금지).

  if (needsUserConfirm(result.text)) {
    if (autoProceed) {
      send('message', {
        speaker: '진행자',
        text: '⚠ 자동 진행 중인데 에이미가 다시 확인을 요청했습니다. 더 기다리지 않고 멈춥니다. 에이미의 질문에 직접 답해주세요.',
      });
      return;
    }
    pendingConfirm = { deadline: Date.now() + CONFIRM_WAIT_MS };
    send('awaiting', { deadline: pendingConfirm.deadline, minutes: Math.round(CONFIRM_WAIT_MS / 60000) });
    return; // 확인이 끝나기 전에는 제임스 검토로 넘기지 않는다.
  }
  if (autoProceed) {
    send('message', {
      speaker: '진행자',
      text: '사용자 미응답으로 에이미가 가정으로 작성을 마쳤습니다. 제임스 검토는 하지 않았고 최종본(-final)도 아닙니다. 가정은 에이미의 응답과 회사 폴더의 notes.md를 확인해주세요.',
    });
    send('unreviewed', {});
    return;
  }
  if (resume) {
    // 사용자 답을 에이미가 반영했으면 파일이 안 바뀌었어도(승인 항목 답 등) 제임스가 재검토한다.
    send('message', { speaker: '진행자', text: '사용자 답변을 반영했습니다. 제임스에게 재검토를 넘깁니다.' });
    // 제임스가 사용자의 답(미검증·미확인 항목 승인 등)을 근거로 재검토할 수 있게 원래 요청과 함께 넘긴다.
    await runReviewLoop(resume.userMessage + '\n\n[사용자 확인 답변]\n' + userMessage, send, setActiveChild, result.text);
    return;
  }
  if (!outputsChanged(before, snapshotOutputs())) return; // 산출물이 안 바뀌었으면(질문/설명 등) 에이미 단독 응답으로 종료.

  send('message', {
    speaker: '진행자',
    text: '에이미가 outputs/ 산출물을 변경했습니다. 제임스에게 자동으로 검토를 넘깁니다.',
  });
  pendingRejectionRounds = 0;
  await runReviewLoop(userMessage, send, setActiveChild);
}

// 에이미의 최신 작업을 제임스가 검토하고, 반려면 에이미가 반영/반박한
// 뒤 다시 제임스에게 재검토를 요청하는 과정을 승인 또는 한도(3회)까지
// 반복한다. userMessage는 최초 사용자 요청 텍스트(맥락 전달용)이고,
// lastAmyText는 직전 라운드에서 에이미가 한 말(반박 등)로, 다음 제임스
// 호출에 그대로 실어 보낸다 — 이게 없으면 제임스가 에이미의 반박 내용을
// 전혀 모른 채로 재검토하게 된다.
async function runReviewLoop(userMessage, send, setActiveChild, lastAmyText) {
  for (;;) {
    const reviewPrompt = buildReviewPrompt(userMessage, { lastAmyText });
    const jamesResult = await runTurn('james', reviewPrompt, send, setActiveChild);
    if (jamesResult.failed) return; // 검토 프로세스 자체가 실패하면 절대 승인으로 넘어가지 않는다.
    const jamesText = jamesResult.text;

    const verdict = parseVerdict(jamesText);

    if (verdict === 'approved') {
      pendingRejectionRounds = 0;
      const finalizePrompt =
        '제임스가 방금 검토를 승인했습니다. 최종본을 만들어주세요. ' +
        '단, 제임스의 승인에 미확인·미검증 항목이 있으면 사용자가 항목별로 승인하기 전에는 최종본을 만들지 말고 ' +
        '질문 카드로 항목별 승인을 먼저 물은 뒤 [확인필요]로 멈추세요.\n\n' +
        `제임스의 승인 메시지:\n${jamesText}`;
      const finalResult = await runTurn('amy', finalizePrompt, send, setActiveChild);
      // 승인 메시지에 미확인·미검증 항목이 있으면 에이미가 조건부 최종본 전에 사용자 승인을 묻는다.
      // 이 경우에도 다른 확인 대기와 똑같이 보류하고, 시간이 지나면 -final 없이 끝난다.
      if (!finalResult.failed && needsUserConfirm(finalResult.text)) {
        pendingConfirm = { deadline: Date.now() + CONFIRM_WAIT_MS };
        send('awaiting', { deadline: pendingConfirm.deadline, minutes: Math.round(CONFIRM_WAIT_MS / 60000) });
      }
      return;
    }

    if (verdict === 'unknown') {
      send('message', {
        speaker: '진행자',
        text: '제임스의 검토 결과(승인/반려)를 판독하지 못했습니다(응답 마지막 줄에 ' +
          '[검토결과: 승인] 또는 [검토결과: 반려] 태그가 없습니다). ' +
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
    const amyResult = await runTurn('amy', rebutPrompt, send, setActiveChild);
    if (amyResult.failed) return;
    lastAmyText = amyResult.text;
    // 에이미가 사용자 답이 필요하다고 멈췄으면(응답 마지막 줄 [확인필요]) 제임스에게 다시 넘기지 않는다.
    // 사용자가 답하면 에이미가 반영한 뒤 제임스 재검토로 이어진다(resume).
    if (needsUserConfirm(amyResult.text)) {
      pendingConfirm = { deadline: Date.now() + CONFIRM_WAIT_MS, resume: { userMessage, lastAmyText } };
      send('awaiting', { deadline: pendingConfirm.deadline, minutes: Math.round(CONFIRM_WAIT_MS / 60000) });
      return;
    }
    // 다시 루프 위로 올라가 제임스에게 재검토를 요청한다(이번엔 lastAmyText 포함).
  }
}

function matchDirectAddress(userMessage) {
  const m = userMessage.match(/^\s*(에이미|제임스)\s*[,:]?\s*/);
  if (!m) return null;
  return { agentKey: m[1] === '에이미' ? 'amy' : 'james' };
}

// 한 에이전트(에이미 또는 제임스)의 세션에 메시지 하나를 보내고, 그
// 턴에서 나온 assistant 텍스트 전체를 이어붙여 { text, failed } 형태로
// 반환한다. 응답이 오는 대로 client에도 실시간으로 말풍선을 보낸다.
//
// failed:true는 "이 턴의 결과를 다음 단계(승인 판정, 자동 체인 등)로
// 절대 넘기면 안 된다"는 신호다 — spawn 자체 실패, claude가 result
// 이벤트에서 에러를 보고한 경우, 또는 응답이 아예 없이 종료된 경우가
// 모두 여기 해당한다. 과거엔 이런 경우에도 그냥 빈 문자열/부분 텍스트를
// 반환해서, 실패한 검토의 텍스트에 우연히 승인 문구가 섞여 있으면 다음
// 단계로 새어나갈 수 있었다.
function runTurn(agentKey, message, send, setActiveChild, retried = false) {
  const agent = AGENTS[agentKey];
  const resumed = agent.started;
  const args = [
    '--agent', agent.agentFlag,
    // 메시지는 인자가 아니라 표준입력으로 보낸다. Windows의 claude.cmd(npm 래퍼)는 인자 속
    // 줄바꿈에서 메시지를 잘라 첫 줄만 전달하는데, 자동 검토 요청처럼 여러 줄인 메시지가
    // 이 때문에 제임스에게 제대로 가지 않았다.
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--permission-mode', 'bypassPermissions',
    ...(resumed ? ['--resume', agent.sessionId] : ['--session-id', agent.sessionId]),
    ...agent.extraArgs,
  ];

  // 고객 자료가 들어갈 수 있는 프롬프트·응답 내용은 콘솔/로그에 남기지 않는다. 호출 횟수·시간·
  // 사용량 같은 숫자만 남긴다(내용 없는 익명 번호 #요청.단계).
  run.step += 1;
  const step = run.step;
  const startedAt = Date.now();
  console.log(`[#${run.req}.${step}] ${agent.label} 호출 (${resumed ? '세션 이어서' : '새 세션'}, 경로: ${run.route})`);

  return new Promise((resolve) => {
    const child = spawn('claude', args, { cwd: REPO_ROOT });
    setActiveChild(child);
    if (child.stdin) {
      child.stdin.on('error', () => { /* 프로세스가 먼저 끝나면 EPIPE — close에서 처리한다 */ });
      child.stdin.write(message, 'utf8');
      child.stdin.end();
    }
    // 'error'(예: ENOENT — claude CLI를 못 찾음)가 아니라 'spawn'에서만
    // started를 true로 켠다. 예전엔 spawn() 호출 직후 무조건 true로
    // 켰는데, 그러면 spawn 자체가 실패해도(=세션이 실제로 만들어진 적
    // 없는데도) 다음 호출이 --session-id 대신 --resume을 써서 "No
    // conversation found with session ID" 오류로 이어졌다.
    child.on('spawn', () => {
      agent.started = true;
    });

    let fullText = '';
    let messageCount = 0;
    let stderrText = '';
    let unknownLineCount = 0;
    const unknownSamples = []; // 응답 없이 끝난 경우의 원인 파악용(앞 2줄, 160자까지)
    let buffer = '';
    let sawResultError = false;
    let resultErrorMessage = '';
    let usage = null;

    const processLine = (line) => {
      if (!line.trim()) return;
      let json;
      try {
        json = JSON.parse(line);
      } catch (e) {
        unknownLineCount += 1;
        if (unknownSamples.length < 2) unknownSamples.push(line.slice(0, 160));
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
      if (json.type === 'result') {
        const u = json.usage || {};
        usage = {
          turns: typeof json.num_turns === 'number' ? json.num_turns : null,
          cost: typeof json.total_cost_usd === 'number' ? json.total_cost_usd : null,
          tokensIn: typeof u.input_tokens === 'number' ? u.input_tokens : null,
          tokensOut: typeof u.output_tokens === 'number' ? u.output_tokens : null,
          cacheRead: typeof u.cache_read_input_tokens === 'number' ? u.cache_read_input_tokens : null,
          cacheCreate: typeof u.cache_creation_input_tokens === 'number' ? u.cache_creation_input_tokens : null,
        };
        if (json.is_error || (json.subtype && json.subtype !== 'success')) {
          sawResultError = true;
          resultErrorMessage = `${agent.label} 오류(${json.subtype || 'unknown'}): ${json.result || json.error || '상세 내용 없음'}`;
        }
      }
    };

    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) processLine(line);
    });

    child.stderr.on('data', (chunk) => {
      stderrText += chunk.toString('utf8');
    });

    child.on('error', (err) => {
      console.error(`[#${run.req}.${step}] ${agent.label} 실행 실패: ${err.code || err.message}`);
      send('error', { message: `${agent.label} 실행 실패: ${err.message}. claude CLI가 설치되어 PATH에 있는지 확인하세요.` });
      resolve({ text: '', failed: true });
    });

    child.on('close', (code) => {
      if (buffer.trim()) processLine(buffer); // 줄바꿈 없이 끝난 마지막 줄도 처리

      // 이어가려던 세션이 이 PC에 없으면(서버가 먼저 시작 표시를 켰거나 세션 파일이 사라진 경우)
      // 한 번만 새 세션으로 다시 시도한다. 사용자가 같은 말을 다시 보낼 필요가 없다.
      if (resumed && !retried && code !== 0 && messageCount === 0 && /No conversation found/i.test(stderrText)) {
        agent.started = false;
        console.log(`[#${run.req}.${step}] ${agent.label} 세션을 찾지 못해 새 세션으로 재시도합니다.`);
        resolve(runTurn(agentKey, message, send, setActiveChild, true));
        return;
      }

      const failed = sawResultError || code !== 0 || messageCount === 0;
      recordUsage({
        req: run.req, step, route: run.route, agent: agentKey, resumed, retried,
        code, ms: Date.now() - startedAt, messages: messageCount, failed, ...(usage || {}),
      });

      if (messageCount === 0) {
        const detail = [
          resultErrorMessage || null,
          `${agent.label}의 claude 프로세스가 종료됐지만(exit code ${code}) 응답이 없습니다.`,
          stderrText.trim() ? `표준에러 출력: ${stderrText.trim().slice(0, 1000)}` : null,
          unknownLineCount > 0 ? `(해석 못한 출력 줄 ${unknownLineCount}개)` : null,
        ].filter(Boolean).join('\n');
        send('error', { message: detail });
        try {
          fs.writeFileSync(path.join(__dirname, '.last-failure.log'),
            JSON.stringify({ ts: new Date().toISOString(), agent: agentKey, code, unknownLineCount, unknownSamples, stderr: stderrText.slice(0, 1500) }, null, 2));
        } catch (err) { /* 진단 기록 실패는 작업을 막지 않는다 */ }
      } else if (failed) {
        if (resultErrorMessage) send('error', { message: resultErrorMessage });
        send('error', { message: `${agent.label}의 이번 턴이 실패로 처리되어(exit code ${code}) 자동 진행을 멈춥니다.` });
      }

      resolve({ text: fullText, failed });
    });
  });
}

function recordUsage(e) {
  const num = (v) => (v === null || v === undefined ? '-' : v);
  console.log(
    `[#${e.req}.${e.step}] ${e.agent} 종료 code=${e.code} ${e.ms}ms turns=${num(e.turns)} ` +
    `cost=${num(e.cost)} tokens(in/out)=${num(e.tokensIn)}/${num(e.tokensOut)}${e.failed ? ' 실패' : ''}`
  );
  try {
    fs.appendFileSync(USAGE_LOG, JSON.stringify({ ts: new Date().toISOString(), ...e }) + '\n');
  } catch (err) { /* 기록 실패는 작업을 막지 않는다 */ }
}

app.listen(PORT, HOST, () => {
  console.log(`AI 비서 채팅창이 준비됐습니다: http://${HOST}:${PORT}`);
  console.log(`에이미 세션: ${AGENTS.amy.sessionId}`);
  console.log(`제임스 세션: ${AGENTS.james.sessionId}`);
});
