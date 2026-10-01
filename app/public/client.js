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

/* ---- MessageBubble: text + inline cards, shared by user/assistant ---- */
function MessageBubble(text) {
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  const blocks = splitCardBlocks(text);
  const hasCard = blocks.some((b) => b.type === 'card');
  if (!hasCard) {
    bubble.textContent = text;
    return bubble;
  }
  for (const b of blocks) {
    if (b.type === 'text') {
      if (!b.value.trim()) continue;
      const p = document.createElement('div');
      p.textContent = b.value.replace(/\n+$/, '');
      bubble.appendChild(p);
    } else {
      bubble.appendChild(InlineInfoCard(b.items));
    }
  }
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

  const { verdict, body } = speaker === '제임스' ? extractVerdict(text) : { verdict: null, body: text };
  const bubble = MessageBubble(body || text);
  if (verdict) {
    const badge = document.createElement('div');
    badge.className = `verdict pixel-box ${verdict}`;
    badge.textContent = verdict === 'approved' ? '✓ 검토 승인' : '✕ 검토 반려';
    bubble.appendChild(badge);
  }
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
  n.textContent = text;
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

fileInputEl.addEventListener('change', async () => {
  for (const file of fileInputEl.files) {
    const fd = new FormData();
    fd.append('file', file);
    try {
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      const data = await res.json();
      if (data.ok) {
        const chip = document.createElement('span');
        chip.className = 'file-chip';
        chip.textContent = `첨부 · ${data.filename}`;
        fileListEl.appendChild(chip);
      }
    } catch (e) {
      addBubble('진행자', `⚠️ 파일 업로드 실패: ${file.name}`);
    }
  }
  fileInputEl.value = '';
});

formEl.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = inputEl.value.trim();
  if (!text) return;

  addBubble('나', text);
  inputEl.value = '';
  sendBtn.disabled = true;
  addTypingNotice('업무 처리 중');

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text }),
    });

    if (!res.ok || !res.body) {
      removeTypingNotice();
      addBubble('진행자', '⚠️ 서버에 연결할 수 없습니다.');
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
          removeTypingNotice();
          addBubble('진행자', `⚠️ ${data.message}`);
        }
      }
    }
    removeTypingNotice();
  } catch (err) {
    removeTypingNotice();
    addBubble('진행자', `⚠️ 오류가 발생했습니다: ${err.message}`);
  }

  sendBtn.disabled = false;
  inputEl.focus();
});
