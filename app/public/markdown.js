/* =========================================================
   Markdown renderer (headings, bold, code, lists, tables, quotes) and
   notification helpers. DOM construction only — never innerHTML, so
   anything an agent writes is shown as text, not executed.
   ========================================================= */

function mdInline(parent, text) {
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parent.appendChild(document.createTextNode(text.slice(last, m.index)));
    const tok = m[0];
    if (tok.startsWith('**')) {
      const b = document.createElement('strong');
      b.textContent = tok.slice(2, -2);
      parent.appendChild(b);
    } else {
      const c = document.createElement('code');
      c.textContent = tok.slice(1, -1);
      parent.appendChild(c);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
}

function mdSplitRow(line) {
  let t = line.trim();
  if (t.startsWith('|')) t = t.slice(1);
  if (t.endsWith('|')) t = t.slice(0, -1);
  return t.split('|').map((c) => c.trim());
}

const MD_LIST = /^\s*([-*•]|\d+[.)])\s+(.*)$/;
const MD_FENCE = /^\s*```/;

function mdIsTableSep(l) {
  return l.includes('-') && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
}

function renderMarkdown(text) {
  const root = document.createElement('div');
  root.className = 'md';
  const lines = text.replace(/\r/g, '').split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i += 1; continue; }

    if (MD_FENCE.test(line)) {
      const buf = [];
      i += 1;
      while (i < lines.length && !MD_FENCE.test(lines[i])) { buf.push(lines[i]); i += 1; }
      i += 1;
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      code.textContent = buf.join('\n');
      pre.appendChild(code);
      root.appendChild(pre);
      continue;
    }

    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const el = document.createElement('h' + Math.min(h[1].length + 2, 6));
      mdInline(el, h[2]);
      root.appendChild(el);
      i += 1;
      continue;
    }

    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      root.appendChild(document.createElement('hr'));
      i += 1;
      continue;
    }

    if (line.includes('|') && i + 1 < lines.length && mdIsTableSep(lines[i + 1])) {
      const table = document.createElement('table');
      const thead = document.createElement('thead');
      const hr = document.createElement('tr');
      for (const c of mdSplitRow(line)) {
        const th = document.createElement('th');
        mdInline(th, c);
        hr.appendChild(th);
      }
      thead.appendChild(hr);
      table.appendChild(thead);
      const tbody = document.createElement('tbody');
      i += 2;
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) {
        const tr = document.createElement('tr');
        for (const c of mdSplitRow(lines[i])) {
          const td = document.createElement('td');
          mdInline(td, c);
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
        i += 1;
      }
      table.appendChild(tbody);
      const wrap = document.createElement('div');
      wrap.className = 'table-wrap';
      wrap.appendChild(table);
      root.appendChild(wrap);
      continue;
    }

    const li = line.match(MD_LIST);
    if (li) {
      const ordered = /\d/.test(li[1]);
      const list = document.createElement(ordered ? 'ol' : 'ul');
      while (i < lines.length) {
        const m = lines[i].match(MD_LIST);
        if (!m || /\d/.test(m[1]) !== ordered) break;
        const item = document.createElement('li');
        mdInline(item, m[2]);
        list.appendChild(item);
        i += 1;
      }
      root.appendChild(list);
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const bq = document.createElement('blockquote');
      const buf = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^\s*>\s?/, '')); i += 1; }
      mdInline(bq, buf.join(' '));
      root.appendChild(bq);
      continue;
    }

    const p = document.createElement('p');
    const buf = [line];
    i += 1;
    while (
      i < lines.length && lines[i].trim() &&
      !MD_LIST.test(lines[i]) && !/^#{1,4}\s/.test(lines[i]) && !/^\s*>/.test(lines[i]) && !MD_FENCE.test(lines[i]) &&
      !(lines[i].includes('|') && i + 1 < lines.length && mdIsTableSep(lines[i + 1]))
    ) {
      buf.push(lines[i]);
      i += 1;
    }
    mdInline(p, buf.join('\n'));
    root.appendChild(p);
  }
  return root;
}

/* ---- Notifications: browser notification + short beep + tab title badge ---- */
const BASE_TITLE = document.title;
let unreadCount = 0;
let audioCtx = null;

function requestNotifyPermission() {
  try {
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
  } catch (e) { /* ignore */ }
}

function beep() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = 'sine';
    o.frequency.value = 880;
    g.gain.value = 0.08;
    o.connect(g);
    g.connect(audioCtx.destination);
    o.start();
    o.stop(audioCtx.currentTime + 0.18);
  } catch (e) { /* sound is optional */ }
}

function notifyUser(title, body) {
  beep();
  if (document.hidden || !document.hasFocus()) {
    unreadCount += 1;
    document.title = `(${unreadCount}) ${BASE_TITLE}`;
    try {
      if ('Notification' in window && Notification.permission === 'granted') {
        const n = new Notification(title, { body });
        n.onclick = () => { window.focus(); n.close(); };
      }
    } catch (e) { /* ignore */ }
  }
}

window.addEventListener('focus', () => {
  unreadCount = 0;
  document.title = BASE_TITLE;
});

/* =========================================================
   Question card: 에이미가 ```questions JSON 블록을 보내면 입력창 위에 객관식 카드로 보여준다.
   형식이 틀리면 null을 돌려주고, 본문의 질문 글만 그대로 보인다.
   ========================================================= */
const QUESTIONS_RE = /```questions\s*\n([\s\S]*?)\n\s*```/;

function parseQuestions(text) {
  const m = text.match(QUESTIONS_RE);
  if (!m) return { questions: null, body: text };
  const body = text.replace(QUESTIONS_RE, '').replace(/\n{3,}/g, '\n\n').trim();
  try {
    const arr = JSON.parse(m[1]);
    if (!Array.isArray(arr) || !arr.length) return { questions: null, body };
    const questions = arr.slice(0, 6).map((x) => ({
      q: String((x && x.q) || '').slice(0, 300),
      options: Array.isArray(x && x.options) ? x.options.slice(0, 4).map((o) => String(o).slice(0, 200)) : [],
      multi: !!(x && x.multi),
    })).filter((x) => x.q);
    return { questions: questions.length ? questions : null, body };
  } catch (e) {
    return { questions: null, body };
  }
}

let questionDeadline = null; // 서버가 알려 준 자동 진행 마감 시각(ms)
let questionTimerEl = null;

function updateQuestionTimer() {
  if (!questionTimerEl || !document.body.contains(questionTimerEl)) return;
  if (!questionDeadline) { questionTimerEl.textContent = ''; return; }
  const min = Math.max(0, Math.ceil((questionDeadline - Date.now()) / 60000));
  questionTimerEl.textContent = min > 0
    ? `${min}분 안에 답이 없으면 가정으로 진행합니다 (제임스 검토 없음)`
    : '곧 가정으로 진행합니다';
}
setInterval(updateQuestionTimer, 20000);

function removeQuestionPanel() {
  const old = document.getElementById('question-panel');
  if (old) old.remove();
  questionTimerEl = null;
}

function showQuestionPanel(questions, onSubmit) {
  removeQuestionPanel();
  const panel = document.createElement('div');
  panel.id = 'question-panel';
  panel.className = 'question-panel pixel-box';

  const head = document.createElement('div');
  head.className = 'qp-head';
  const title = document.createElement('strong');
  title.textContent = `에이미의 확인 질문 ${questions.length}개`;
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'qp-close';
  close.textContent = '닫기';
  close.title = '카드를 닫고 입력창으로 직접 답할 수 있습니다';
  close.addEventListener('click', removeQuestionPanel);
  head.appendChild(title);
  head.appendChild(close);
  panel.appendChild(head);

  const groups = [];
  questions.forEach((q, qi) => {
    const box = document.createElement('div');
    box.className = 'qp-q';
    const label = document.createElement('div');
    label.className = 'qp-label';
    label.textContent = `${qi + 1}. ${q.q}`;
    box.appendChild(label);

    const name = `qp-${qi}`;
    const type = q.multi ? 'checkbox' : 'radio';
    const inputs = [];
    for (const opt of q.options) {
      const row = document.createElement('label');
      row.className = 'qp-opt';
      const inp = document.createElement('input');
      inp.type = type;
      inp.name = name;
      inp.value = opt;
      row.appendChild(inp);
      row.appendChild(document.createTextNode(' ' + opt));
      box.appendChild(row);
      inputs.push(inp);
    }
    // 기타(직접 입력): 선택지가 없으면 입력칸만 보인다
    const otherRow = document.createElement('label');
    otherRow.className = 'qp-opt qp-other';
    let otherChoice = null;
    if (q.options.length) {
      otherChoice = document.createElement('input');
      otherChoice.type = type;
      otherChoice.name = name;
      otherRow.appendChild(otherChoice);
      otherRow.appendChild(document.createTextNode(' 기타 '));
    }
    const otherText = document.createElement('input');
    otherText.type = 'text';
    otherText.className = 'qp-text';
    otherText.placeholder = q.options.length ? '직접 입력' : '답변 입력';
    otherText.addEventListener('input', () => { if (otherChoice && otherText.value) otherChoice.checked = true; });
    otherRow.appendChild(otherText);
    box.appendChild(otherRow);
    panel.appendChild(box);
    groups.push({ q, inputs, otherText });
  });

  const foot = document.createElement('div');
  foot.className = 'qp-foot';
  questionTimerEl = document.createElement('span');
  questionTimerEl.className = 'qp-timer';
  const submit = document.createElement('button');
  submit.type = 'button';
  submit.className = 'qp-submit';
  submit.textContent = '답변 보내기';
  submit.addEventListener('click', () => {
    const lines = groups.map((g, i) => {
      const picked = g.inputs.filter((x) => x.checked).map((x) => x.value);
      const other = g.otherText.value.trim();
      if (other) picked.push(other);
      return `${i + 1}) ${g.q.q} → ${picked.length ? picked.join(', ') : '(미답변)'}`;
    });
    removeQuestionPanel();
    onSubmit('확인 질문 답변:\n' + lines.join('\n'));
  });
  foot.appendChild(questionTimerEl);
  foot.appendChild(submit);
  panel.appendChild(foot);

  const composer = document.getElementById('composer');
  composer.parentNode.insertBefore(panel, composer);
  updateQuestionTimer();
  return panel;
}
