const messagesEl = document.getElementById('messages');
const formEl = document.getElementById('composer');
const inputEl = document.getElementById('message-input');
const fileInputEl = document.getElementById('file-input');
const fileListEl = document.getElementById('file-list');
const sendBtn = document.getElementById('send-btn');
const membersEl = document.getElementById('members');

/* =========================================================
   UI components (presentation only — chat/data logic is below)
   ========================================================= */

const SPEAKERS = {
  '나': { kind: 'user' },
  '에이미': { kind: 'assistant', cls: 'amy', name: '에이미', role: '작성', avatar: 'amy' },
  '제임스': { kind: 'assistant', cls: 'james', name: '제임스', role: '검토', avatar: 'james' },
  '진행자': { kind: 'system' },
};

/* ---- PixelAvatar: 10x10 pixel art rendered as inline SVG ---- */
const AVATAR_ART = {
  // robot (에이미)
  amy: {
    colors: { '#': '#4c83ff', w: '#ffffff', d: '#2f5fc4' },
    rows: [
      '....dd....',
      '....dd....',
      '.########.',
      '##########',
      '##ww##ww##',
      '##ww##ww##',
      '##########',
      '##.dddd.##',
      '.########.',
      '..##..##..',
    ],
  },
  // face with glasses (제임스)
  james: {
    colors: { '#': '#2a9d9a', w: '#ffffff', d: '#165e5c' },
    rows: [
      '..dddddd..',
      '.dddddddd.',
      '.########.',
      '.dddddddd.',
      '.dwwddwwd.',
      '.dddddddd.',
      '.########.',
      '..######..',
      '.##.##.##.',
      '##########',
    ],
  },
};

function svgEl(tag, attrs) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const k in attrs) el.setAttribute(k, attrs[k]);
  return el;
}

function PixelAvatar(key, size) {
  const art = AVATAR_ART[key];
  const svg = svgEl('svg', { viewBox: '0 0 10 10', 'aria-hidden': 'true' });
  if (size) { svg.setAttribute('width', size); svg.setAttribute('height', size); }
  art.rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (ch === '.') return;
      svg.appendChild(svgEl('rect', { x, y, width: 1, height: 1, fill: art.colors[ch] }));
    });
  });
  return svg;
}

/* small pixel check icon (✓✓) for user messages */
function PixelCheck() {
  const svg = svgEl('svg', { viewBox: '0 0 14 9', 'aria-hidden': 'true' });
  const cells = [[0,4],[1,5],[2,6],[3,5],[4,4],[5,3],[6,2],[7,1],[6,5],[7,6],[8,5],[9,4],[10,3],[11,2],[12,1]];
  cells.forEach(([x, y]) => svg.appendChild(svgEl('rect', { x, y, width: 1, height: 1, fill: '#4c83ff' })));
  return svg;
}

function formatTime(d) {
  return d.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit', hour12: true });
}

/* ---- InlineInfoCard: lines starting with ▣ ☑ ☐ □ become a small card ---- */
const CARD_MARK = /^\s*([▣☑☐□■✔])\s*(.*)$/;

function splitCardBlocks(text) {
  // returns [{type:'text', value} | {type:'card', items:[{mark,text}]}]
  const out = [];
  let textBuf = [];
  let cardBuf = [];
  const flushText = () => { if (textBuf.length) { out.push({ type: 'text', value: textBuf.join('\n') }); textBuf = []; } };
  const flushCard = () => { if (cardBuf.length) { out.push({ type: 'card', items: cardBuf }); cardBuf = []; } };
  for (const line of text.split('\n')) {
    const m = line.match(CARD_MARK);
    if (m) { flushText(); cardBuf.push({ mark: m[1], text: m[2] }); }
    else { flushCard(); textBuf.push(line); }
  }
  flushCard();
  flushText();
  return out;
}

function InlineInfoCard(items) {
  const card = document.createElement('div');
  card.className = 'info-card pixel-box';
  const ul = document.createElement('ul');
  for (const it of items) {
    const li = document.createElement('li');
    const done = it.mark === '☑' || it.mark === '✔';
    const mark = svgEl('svg', { viewBox: '0 0 5 5', class: 'mark', 'aria-hidden': 'true' });
    mark.appendChild(svgEl('rect', { x: 0, y: 0, width: 5, height: 5, fill: done ? '#3bb273' : 'none', stroke: done ? 'none' : '#8491a8', 'stroke-width': 0.6 }));
    const span = document.createElement('span');
    span.textContent = it.text;
    li.appendChild(mark);
    li.appendChild(span);
    ul.appendChild(li);
  }
  card.appendChild(ul);
  return card;
}

/* ---- verdict tag: last line "[검토결과: 승인|반려]" -> badge ---- */
function extractVerdict(text) {
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].trim()) continue;
    const m = lines[i].trim().match(/^\[검토결과:\s*(승인|반려)\]$/);
    if (m) return { verdict: m[1] === '승인' ? 'approved' : 'rejected', body: lines.slice(0, i).join('\n').trimEnd() };
    break;
  }
  return { verdict: null, body: text };
}

/* ---- tag on Amy's last line: "[확인필요]" -> "답변 필요" badge ---- */
function extractConfirm(text) {
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].trim()) continue;
    if (lines[i].trim() === '[확인필요]') return { needsConfirm: true, body: lines.slice(0, i).join('\n').trimEnd() };
    break;
  }
  return { needsConfirm: false, body: text };
}

let lastAssistantVerdict = null; // 마지막으로 그려진 메시지의 배지(알림 문구용)

/* ---- MessageBubble: text + inline cards, shared by user/assistant ---- */
function MessageBubble(text, markdown) {
  const bubble = document.createElement('div');
  bubble.className = 'bubble' + (markdown ? ' rich' : '');
  const blocks = splitCardBlocks(text);
  const hasCard = blocks.some((b) => b.type === 'card');
  if (!hasCard) {
    if (markdown) bubble.appendChild(renderMarkdown(text));
    else bubble.textContent = text;
    return bubble;
  }
  for (const b of blocks) {
    if (b.type === 'text') {
      if (!b.value.trim()) continue;
      if (markdown) { bubble.appendChild(renderMarkdown(b.value)); continue; }
      const p = document.createElement('div');
      p.textContent = b.value.replace(/\n+$/, '');
      bubble.appendChild(p);
    } else {
      bubble.appendChild(InlineInfoCard(b.items));
    }
  }
  return bubble;
}

/* ---- 제임스 검토 카드: "### 1. [중대] 제목" 항목과 결론 줄의 건수를 뽑아 한눈에 보여준다.
   reviewer.md의 답변 형식을 따른 경우에만 만들고, 못 뽑으면 null을 돌려 기존 말풍선 그대로 보여준다. ---- */
const REVIEW_ITEM = /^#{2,4}\s*(?:\d+[.)]\s*)?\[(중대|경미|미확인|미검증)\]\s*(.+?)\s*$/;
const REVIEW_LEVEL_CLS = { 중대: 'major', 경미: 'minor', 미확인: 'unk', 미검증: 'unk' };

function parseReview(text) {
  const lines = text.split('\n');
  const items = [];
  let cur = null;
  for (const line of lines) {
    const m = line.match(REVIEW_ITEM);
    if (m) { cur = { level: m[1], title: m[2].replace(/[*`]/g, ''), body: [] }; items.push(cur); continue; }
    // 다음 제목이나 "에이미에게 전달할 수정 지시" 구역이 시작되면 이 항목은 끝난다
    if (cur && (/^#{1,4}\s/.test(line) || /^\s*\**\s*(에이미에게|수정 지시)/.test(line))) { cur = null; continue; }
    if (cur) cur.body.push(line);
  }
  const head = (lines.find((l) => l.trim()) || '').replace(/^#+\s*/, '').replace(/[*`]/g, '').trim();
  const counts = { major: 0, minor: 0, unk: 0 };
  if (items.length) {
    for (const it of items) counts[REVIEW_LEVEL_CLS[it.level]] += 1;
  } else {
    const pick = (re) => { const m = head.match(re); return m ? Number(m[1]) : null; };
    const c = { major: pick(/중대\s*(\d+)\s*건/), minor: pick(/경미\s*(\d+)\s*건/), unk: pick(/미확인(?:\s*\/\s*미검증)?\s*(\d+)\s*건/) };
    if (c.major === null && c.minor === null && c.unk === null) return null; // 형식이 다르면 카드를 만들지 않는다
    counts.major = c.major || 0; counts.minor = c.minor || 0; counts.unk = c.unk || 0;
  }
  return { head, counts, items };
}

function ReviewBubble(review, body, verdict) {
  const bubble = document.createElement('div');
  bubble.className = 'bubble rich review';
  const card = document.createElement('div');
  card.className = 'review-card';

  const top = document.createElement('div');
  top.className = 'review-top';
  if (verdict) {
    const v = document.createElement('span');
    v.className = 'review-verdict ' + verdict;
    v.textContent = verdict === 'approved' ? '✓ 승인' : '✕ 반려';
    top.appendChild(v);
  }
  for (const [key, label] of [['major', '중대'], ['minor', '경미'], ['unk', '미확인·미검증']]) {
    const chip = document.createElement('span');
    chip.className = 'review-chip ' + key + (review.counts[key] ? '' : ' zero');
    chip.textContent = label + ' ' + review.counts[key];
    top.appendChild(chip);
  }
  card.appendChild(top);

  if (review.head) {
    const sum = document.createElement('div');
    sum.className = 'review-summary';
    sum.textContent = review.head;
    card.appendChild(sum);
  }

  review.items.forEach((it, i) => {
    const text = it.body.join('\n').trim();
    const box = document.createElement(text ? 'details' : 'div');
    box.className = 'review-item ' + REVIEW_LEVEL_CLS[it.level];
    const head = document.createElement(text ? 'summary' : 'div');
    head.className = 'review-item-head';
    const tag = document.createElement('span');
    tag.className = 'review-tag';
    tag.textContent = it.level;
    const title = document.createElement('span');
    title.textContent = (i + 1) + '. ' + it.title;
    head.append(tag, title);
    box.appendChild(head);
    if (text) {
      const detail = document.createElement('div');
      detail.className = 'review-item-body';
      detail.appendChild(renderMarkdown(text));
      box.appendChild(detail);
    }
    card.appendChild(box);
  });
  bubble.appendChild(card);

  // 원문은 지우지 않고 접어 둔다 — 카드가 틀리게 뽑아도 정보가 사라지지 않는다
  const full = document.createElement('details');
  full.className = 'review-full';
  const fs2 = document.createElement('summary');
  fs2.textContent = '검토 원문 전체 보기';
  full.appendChild(fs2);
  full.appendChild(renderMarkdown(body));
  bubble.appendChild(full);
  return bubble;
}

/* ---- UserMessage: right aligned, no avatar, time + ✓✓ ---- */
function UserMessage(text) {
  const row = document.createElement('div');
  row.className = 'msg user';
  const stack = document.createElement('div');
  stack.className = 'stack';
  const bubble = MessageBubble(text);
  bubble.classList.add('pixel-box');
  stack.appendChild(bubble);
  const meta = document.createElement('div');
  meta.className = 'meta';
  const t = document.createElement('span');
  t.textContent = formatTime(new Date());
  meta.appendChild(t);
  meta.appendChild(PixelCheck());
  stack.appendChild(meta);
  row.appendChild(stack);
  return row;
}

/* ---- AssistantMessage: left aligned, pixel avatar, name, optional verdict ---- */
function AssistantMessage(speaker, text) {
  const meta = SPEAKERS[speaker];
  const row = document.createElement('div');
  row.className = `msg assistant ${meta.cls}`;

  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  avatar.appendChild(PixelAvatar(meta.avatar));
  row.appendChild(avatar);

  const stack = document.createElement('div');
  stack.className = 'stack';
  const nameEl = document.createElement('div');
  nameEl.className = 'name';
  nameEl.textContent = meta.name;
  const roleEl = document.createElement('span');
  roleEl.className = 'role';
  roleEl.textContent = meta.role;
  nameEl.appendChild(roleEl);
  stack.appendChild(nameEl);

  let { verdict, body } = speaker === '제임스' ? extractVerdict(text) : { verdict: null, body: text };
  if (speaker === '에이미') {
    const parsed = parseQuestions(text); // ```questions 블록은 카드로 따로 보여주므로 본문에서 뺀다
    const c = extractConfirm(parsed.body);
    body = parsed.body;
    if (c.needsConfirm) {
      verdict = 'confirm';
      body = c.body;
      if (parsed.questions) showQuestionPanel(parsed.questions, submitQuestionAnswer);
    }
  }
  const review = speaker === '제임스' ? parseReview(body || text) : null;
  const bubble = review ? ReviewBubble(review, body || text, verdict) : MessageBubble(body || text, true);
  if (verdict && !review) { // 검토 카드가 있으면 카드 맨 위에 판정이 이미 보인다
    const badge = document.createElement('div');
    badge.className = `verdict pixel-box ${verdict}`;
    badge.textContent = verdict === 'approved' ? '✓ 검토 승인' : verdict === 'rejected' ? '✕ 검토 반려' : '⏸ 답변 필요';
    bubble.appendChild(badge);
  }
  if (verdict) lastAssistantVerdict = verdict;
  stack.appendChild(bubble);

  const time = document.createElement('div');
  time.className = 'meta';
  const t = document.createElement('span');
  t.textContent = formatTime(new Date());
  time.appendChild(t);
  stack.appendChild(time);

  row.appendChild(stack);
  return row;
}

/* ---- system notice (진행자) ---- */
function SystemMessage(text) {
  const row = document.createElement('div');
  row.className = 'msg system';
  const n = document.createElement('div');
  n.className = 'notice' + (/^⚠/.test(text) ? ' warn' : '');
  n.textContent = text; // 진행자 문구는 서버가 만든 짧은 안내라 마크다운 없이 그대로 보여준다
  row.appendChild(n);
  return row;
}

/* ---- MessageList ---- */
function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function addBubble(speakerKey, text) {
  const meta = SPEAKERS[speakerKey] || SPEAKERS['진행자'];
  let node;
  if (meta.kind === 'user') node = UserMessage(text);
  else if (meta.kind === 'assistant') node = AssistantMessage(speakerKey, text);
  else node = SystemMessage(text);
  messagesEl.appendChild(node);
  scrollToBottom();
}

function addTypingNotice(text) {
  const row = document.createElement('div');
  row.className = 'msg system';
  row.id = 'typing-notice';
  const n = document.createElement('div');
  n.className = 'notice typing';
  const label = document.createElement('span');
  label.textContent = text;
  const dots = document.createElement('span');
  dots.className = 'dots';
  dots.innerHTML = '<i></i><i></i><i></i>';
  n.appendChild(label);
  n.appendChild(dots);
  row.appendChild(n);
  messagesEl.appendChild(row);
  scrollToBottom();
}

function removeTypingNotice() {
  const el = document.getElementById('typing-notice');
  if (el) el.remove();
}

/* ---- 진행 단계 표시: 작성 → 검토 → 수정 → 최종본 ---- */
const progressEl = document.getElementById('progress');
const STAGES = [['write', '작성'], ['review', '검토'], ['revise', '수정'], ['final', '최종본']];
const STAGE_TEXT = { write: '작성 중', review: '검토 중', revise: '수정·반박 중', final: '최종본 작성 중' };
// BASE_TITLE·unreadCount는 markdown.js(알림)와 공유한다
let progress = null; // { agent, stage, round, max, stageStartedAt, seen: Set }
let progressTimer = null;

function renderProgress() {
  if (!progress) { progressEl.hidden = true; progressEl.textContent = ''; return; }
  progressEl.hidden = false;
  progressEl.textContent = '';
  const steps = document.createElement('ol');
  steps.className = 'steps';
  for (const [key, label] of STAGES) {
    const li = document.createElement('li');
    li.textContent = label;
    if (key === progress.stage) li.className = 'cur ' + progress.agent;
    else if (progress.seen.has(key)) li.className = 'done';
    steps.appendChild(li);
  }
  const who = progress.agent === 'amy' ? '에이미' : '제임스';
  const sec = Math.floor((Date.now() - progress.stageStartedAt) / 1000);
  const round = progress.round > 0 ? ' · 반려 ' + progress.round + '/' + progress.max + '회' : '';
  const info = document.createElement('span');
  info.className = 'p-info';
  info.textContent = who + ' ' + STAGE_TEXT[progress.stage] + ' · ' + Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0') + round;
  progressEl.append(steps, info);
}
function setPhase(p) {
  const seen = progress ? progress.seen : new Set();
  if (progress) seen.add(progress.stage);
  progress = { ...p, stageStartedAt: Date.now(), seen };
  renderProgress();
  document.title = '⏳ ' + BASE_TITLE;
  const label = document.querySelector('#typing-notice .notice span');
  if (label) label.textContent = (p.agent === 'amy' ? '에이미 ' : '제임스 ') + STAGE_TEXT[p.stage];
  if (!progressTimer) progressTimer = setInterval(renderProgress, 1000);
}
function clearProgress() {
  progress = null;
  clearInterval(progressTimer);
  progressTimer = null;
  document.title = unreadCount ? `(${unreadCount}) ${BASE_TITLE}` : BASE_TITLE;
  renderProgress();
}

/* header member chips */
(function renderMembers() {
  for (const key of ['amy', 'james']) {
    const m = document.createElement('span');
    m.className = 'member';
    m.appendChild(PixelAvatar(key, 20));
    const l = document.createElement('span');
    l.className = 'label';
    l.textContent = key === 'amy' ? '에이미 · 작성' : '제임스 · 검토';
    m.appendChild(l);
    membersEl.appendChild(m);
  }
})();

/* =========================================================
   Chat logic (unchanged)
   ========================================================= */

async function uploadFile(file) {
  const fd = new FormData();
  fd.append('file', file);
  try {
    const res = await fetch('/api/upload', { method: 'POST', body: fd });
    const data = await res.json();
    if (data.ok) {
      const chip = document.createElement('span');
      chip.className = 'file-chip';
      chip.textContent = `첨부 · ${data.filename}`;
      const x = document.createElement('button');
      x.type = 'button';
      x.className = 'chip-x';
      x.textContent = '✕';
      x.title = '첨부 취소 (inputs/의 파일이 삭제됩니다)';
      x.setAttribute('aria-label', `${data.filename} 첨부 취소`);
      x.addEventListener('click', () => cancelUpload(data.filename, chip));
      chip.appendChild(x);
      fileListEl.appendChild(chip);
    } else {
      addBubble('진행자', `⚠️ ${data.error || '파일 업로드에 실패했습니다.'} (${file.name})`);
    }
  } catch (e) {
    addBubble('진행자', `⚠️ 파일 업로드 실패: ${file.name}`);
  }
}

async function cancelUpload(filename, chip) {
  if (!confirm(`"${filename}" 파일을 삭제하고 첨부를 취소할까요?\n삭제하면 되돌릴 수 없습니다.`)) return;
  try {
    const res = await fetch('/api/upload/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename }),
    });
    const data = await res.json();
    if (data.ok) chip.remove();
    else addBubble('진행자', '⚠️ ' + (data.error || '첨부를 취소하지 못했습니다.'));
  } catch (e) {
    addBubble('진행자', '⚠️ 첨부를 취소하지 못했습니다: ' + e.message);
  }
}

fileInputEl.addEventListener('change', async () => {
  for (const file of Array.from(fileInputEl.files)) await uploadFile(file);
  fileInputEl.value = '';
});

/* 화면에 파일을 끌어다 놓아도 첨부된다(첨부 버튼과 같은 업로드). 폴더는 올릴 수 없어 안내만 한다. */
const dropOverlayEl = document.createElement('div');
dropOverlayEl.className = 'drop-overlay';
dropOverlayEl.textContent = '여기에 놓으면 첨부됩니다';
dropOverlayEl.hidden = true;
document.body.appendChild(dropOverlayEl);
let dragDepth = 0;
const hasFiles = (e) => !!e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
window.addEventListener('dragenter', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth += 1;
  dropOverlayEl.hidden = false;
});
window.addEventListener('dragover', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault(); // 이게 없으면 브라우저가 파일을 그냥 열어 버린다
  e.dataTransfer.dropEffect = 'copy';
});
window.addEventListener('dragleave', (e) => {
  if (!hasFiles(e)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) dropOverlayEl.hidden = true;
});
window.addEventListener('drop', async (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  dropOverlayEl.hidden = true;
  const items = Array.from(e.dataTransfer.items || []);
  const files = Array.from(e.dataTransfer.files || []);
  let skippedFolder = false;
  for (let i = 0; i < files.length; i += 1) {
    const entry = items[i] && items[i].webkitGetAsEntry ? items[i].webkitGetAsEntry() : null;
    if (entry && entry.isDirectory) { skippedFolder = true; continue; }
    await uploadFile(files[i]);
  }
  if (skippedFolder) addBubble('진행자', '⚠️ 폴더는 올릴 수 없습니다. 폴더 안의 파일을 직접 끌어다 놓아 주세요.');
});

/* 입력칸: Enter = 전송, Shift+Enter = 줄바꿈. 줄 수에 맞춰 높이가 늘어난다(최대 160px).
   한글 조합 중(isComposing)의 Enter는 글자 확정이므로 전송하지 않는다. */
function autosizeInput() {
  if (!inputEl.value) { inputEl.style.height = ''; return; } // 비어 있으면 기본 높이(placeholder 줄바꿈에 영향받지 않게)
  inputEl.style.height = 'auto';
  inputEl.style.height = Math.min(inputEl.scrollHeight + 2, 160) + 'px';
}
inputEl.addEventListener('input', autosizeInput);
inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
    e.preventDefault();
    formEl.requestSubmit();
  }
});

formEl.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = inputEl.value.trim();
  if (!text) return;
  requestNotifyPermission();
  addBubble('나', text);
  inputEl.value = '';
  autosizeInput();
  runChat(text);
});

let chatRunning = false;
const stopBtn = document.getElementById('stop-btn');
let abortCtl = null;
let userStopped = false;
stopBtn.addEventListener('click', () => {
  if (!abortCtl) return;
  userStopped = true;
  abortCtl.abort(); // 연결이 끊기면 서버가 진행 중인 claude 프로세스를 종료한다
});

/* 질문 카드의 "답변 보내기": 지금 처리 중이면 끝나길 기다렸다가 보낸다 */
function submitQuestionAnswer(text) {
  addBubble('나', text);
  const go = () => { if (chatRunning) setTimeout(go, 500); else runChat(text); };
  go();
}

async function runChat(text) {
  removeQuestionPanel(); // 새 메시지를 보내면 이전 질문 카드는 닫는다
  questionDeadline = null;
  chatRunning = true;
  sendBtn.disabled = true;
  addTypingNotice('업무 처리 중');
  // 메시지를 보내면 첨부는 에이미에게 전달되므로 더는 취소할 수 없다
  document.querySelectorAll('.chip-x').forEach((b) => b.remove());
  stopBtn.hidden = false;
  abortCtl = new AbortController();
  userStopped = false;
  document.title = '⏳ ' + BASE_TITLE;
  const startedAt = Date.now();
  lastAssistantVerdict = null;
  let sawAwaiting = false;
  let sawError = false;
  let sawUnreviewed = false;

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text }),
      signal: abortCtl.signal,
    });

    if (!res.ok || !res.body) {
      removeTypingNotice();
      addBubble('진행자', '⚠️ 서버에 연결할 수 없습니다.');
      stopBtn.hidden = true;
      clearProgress();
      chatRunning = false;
      sendBtn.disabled = false;
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let gotFirstMessage = false;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split('\n\n');
      buffer = events.pop();
      for (const evt of events) {
        const lines = evt.split('\n');
        let eventType = 'message';
        let dataLine = '';
        for (const line of lines) {
          if (line.startsWith('event:')) eventType = line.slice(6).trim();
          if (line.startsWith('data:')) dataLine = line.slice(5).trim();
        }
        if (!dataLine) continue;
        let data;
        try {
          data = JSON.parse(dataLine);
        } catch (err) {
          continue;
        }
        if (eventType === 'message') {
          if (!gotFirstMessage) {
            removeTypingNotice();
            gotFirstMessage = true;
          }
          addBubble(data.speaker, data.text);
        } else if (eventType === 'error') {
          sawError = true;
          removeTypingNotice();
          addBubble('진행자', `⚠️ ${data.message}`);
        } else if (eventType === 'awaiting') {
          sawAwaiting = true;
          questionDeadline = data.deadline;
          updateQuestionTimer();
          removeTypingNotice();
          addBubble('진행자', `⏸ 에이미가 답변을 기다립니다. ${data.minutes}분 안에 답이 없으면 가정으로 작성하고, 제임스 검토는 하지 않습니다.`);
        } else if (eventType === 'phase') {
          setPhase(data);
        } else if (eventType === 'unreviewed') {
          sawUnreviewed = true;
        }
      }
    }
    removeTypingNotice();
  } catch (err) {
    removeTypingNotice();
    if (userStopped) {
      addBubble('진행자', '■ 작업을 중지했습니다. 이미 저장된 산출물 파일은 남아 있을 수 있으니 outputs/를 확인해주세요. 이어서 하려면 에이미나 제임스를 불러 다시 요청하세요.');
    } else {
      sawError = true;
      addBubble('진행자', `⚠️ 오류가 발생했습니다: ${err.message}`);
    }
  }
  stopBtn.hidden = true;
  clearProgress();

  if (sawAwaiting) notifyUser('에이미가 확인을 기다립니다', '답변이 필요합니다.');
  else if (lastAssistantVerdict === 'approved') notifyUser('제임스 검토 완료', '승인되었습니다.');
  else if (lastAssistantVerdict === 'rejected') notifyUser('제임스 검토 완료', '반려되었습니다. 지적사항을 확인하세요.');
  else if (sawError) notifyUser('작업 중 오류', '채팅창을 확인하세요.');
  else if (sawUnreviewed) notifyUser('가정으로 작성 완료', '제임스 검토는 하지 않았습니다.');
  else if (Date.now() - startedAt > 15000) notifyUser('작업 완료', '결과를 확인하세요.');

  chatRunning = false;
  sendBtn.disabled = false;
  inputEl.focus();
  checkPending();
  if (!sawAwaiting) refreshTrayAfterRun(startedAt);
}

/* 에이미가 답변을 기다리는 중이고 대기 시간이 지났으면 자동 진행을 요청한다(서버가 마감 시각을 관리) */
async function checkPending() {
  if (chatRunning) return;
  try {
    const res = await fetch('/api/pending');
    const data = await res.json();
    if (data.pending && data.now >= data.deadline && !chatRunning) {
      addBubble('진행자', '⏱ 대기 시간이 지나 에이미가 가정으로 진행합니다. (제임스 검토는 하지 않습니다)');
      runChat('[미응답-자동진행]');
    }
  } catch (e) { /* 서버가 꺼져 있으면 다음 주기에 다시 확인한다 */ }
}
setInterval(checkPending, 20000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkPending(); });
checkPending();

/* =========================================================
   산출물 트레이 — 다운로드 없이 원본 위치(outputs/)에서 바로 열기
   ========================================================= */
const filesTrayEl = document.getElementById('files-tray');
const filesBtnEl = document.getElementById('files-btn');

function fmtTime(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
async function openPath(rel, mode) {
  try {
    const res = await fetch('/api/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rel, mode }),
    });
    const data = await res.json();
    if (!data.ok) addBubble('진행자', '⚠️ ' + (data.error || '열 수 없습니다.'));
  } catch (err) {
    addBubble('진행자', '⚠️ 열 수 없습니다: ' + err.message);
  }
}
function fileButton(label, rel, mode) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'ft-btn';
  b.textContent = label;
  b.addEventListener('click', () => openPath(rel, mode));
  return b;
}
async function renderFilesTray(sinceMs) {
  let data;
  try {
    data = await (await fetch('/api/files')).json();
  } catch (err) {
    return;
  }
  filesTrayEl.textContent = '';
  const head = document.createElement('div');
  head.className = 'ft-head';
  const title = document.createElement('strong');
  title.textContent = '산출물';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'qp-close';
  close.textContent = '닫기';
  close.addEventListener('click', () => { filesTrayEl.hidden = true; });
  head.append(title, close);
  filesTrayEl.appendChild(head);
  // 같은 문서(-v1, -v2, -final)는 한 묶음으로: 최종본 → 최신 버전 순으로 맨 위에 보이고, 나머지는 접어 둔다.
  const groups = new Map();
  for (const f of data.files) {
    const key = f.rel.replace(/-(v\d+|final)(?=\.[^.]+$)/, '');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(f);
  }
  const verNum = (f) => { const m = /-v(\d+)\.[^.]+$/.exec(f.name); return m ? Number(m[1]) : 0; };
  const rank = (f) => (f.status === 'final' ? Infinity : verNum(f) || f.mtime / 1e15);
  const ordered = [...groups.values()]
    .map((g) => g.sort((x, y) => rank(y) - rank(x)))
    .sort((x, y) => Math.max(...y.map((f) => f.mtime)) - Math.max(...x.map((f) => f.mtime)))
    .slice(0, 8);
  const list = ordered.map((g) => g[0]);
  const olderOf = new Map(ordered.map((g) => [g[0], g.slice(1)]));
  if (!list.length) {
    const empty = document.createElement('div');
    empty.className = 'ft-empty';
    empty.textContent = '아직 산출물이 없습니다.';
    filesTrayEl.appendChild(empty);
  }
  for (const f of list) {
    const row = document.createElement('div');
    row.className = 'ft-row';
    const info = document.createElement('div');
    info.className = 'ft-info';
    const badge = document.createElement('span');
    badge.className = 'ft-badge ' + f.status;
    const vm = /-v(\d+)\.[^.]+$/.exec(f.name);
    badge.textContent = f.status === 'final' ? '최종본(제임스 승인)' : (vm ? '초안 v' + vm[1] : '초안');
    const name = document.createElement('span');
    name.className = 'ft-name';
    name.textContent = f.name;
    const meta = document.createElement('span');
    meta.className = 'ft-meta';
    meta.textContent = fmtTime(f.mtime) + (sinceMs && f.mtime >= sinceMs ? ' · 방금 변경' : '');
    info.append(badge, name, meta);
    const acts = document.createElement('div');
    acts.className = 'ft-acts';
    acts.append(fileButton('열기', f.rel, 'file'), fileButton('폴더', f.rel, 'folder'));
    row.append(info, acts);
    filesTrayEl.appendChild(row);
    if (f.review && f.review.length) {
      const det = document.createElement('details');
      det.className = 'ft-review';
      const sum = document.createElement('summary');
      sum.textContent = '검토 자료 보기 (' + f.review.length + ')';
      det.appendChild(sum);
      for (const r of f.review) det.appendChild(fileButton(r.name, r.rel, 'file'));
      filesTrayEl.appendChild(det);
    }
    const older = olderOf.get(f) || [];
    if (older.length) {
      const od = document.createElement('details');
      od.className = 'ft-review';
      const os = document.createElement('summary');
      os.textContent = '이전 버전 (' + older.length + ')';
      od.appendChild(os);
      for (const o of older) {
        const line = document.createElement('div');
        line.className = 'ft-older';
        const nm = document.createElement('span');
        nm.textContent = o.name + ' · ' + fmtTime(o.mtime) + ' ';
        line.append(nm, fileButton('열기', o.rel, 'file'), fileButton('폴더', o.rel, 'folder'));
        od.appendChild(line);
      }
      filesTrayEl.appendChild(od);
    }
  }
  filesTrayEl.hidden = false;
}
filesBtnEl.addEventListener('click', () => {
  if (!filesTrayEl.hidden) { filesTrayEl.hidden = true; return; }
  renderFilesTray(0);
});

async function refreshTrayAfterRun(startedAt) {
  try {
    const data = await (await fetch('/api/files')).json();
    if (data.files.some((f) => f.mtime >= startedAt)) renderFilesTray(startedAt);
  } catch (err) { /* 트레이는 보조 기능이라 실패해도 무시 */ }
}
