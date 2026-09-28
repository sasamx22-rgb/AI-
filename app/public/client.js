const messagesEl = document.getElementById('messages');
const formEl = document.getElementById('composer');
const inputEl = document.getElementById('message-input');
const fileInputEl = document.getElementById('file-input');
const fileListEl = document.getElementById('file-list');
const sendBtn = document.getElementById('send-btn');

const SPEAKER_META = {
  '나': { label: '나', cls: 'me' },
  '에이미': { label: '🧑‍💼 에이미 (작성)', cls: 'amy' },
  '제임스': { label: '⚖️ 제임스 (검토)', cls: 'james' },
  '진행자': { label: '진행자', cls: 'system' },
};

function addBubble(speakerKey, text) {
  const meta = SPEAKER_META[speakerKey] || SPEAKER_META['진행자'];
  const row = document.createElement('div');
  row.className = `bubble-row ${meta.cls}`;

  const bubble = document.createElement('div');
  bubble.className = 'bubble';

  const nameEl = document.createElement('div');
  nameEl.className = 'bubble-name';
  nameEl.textContent = meta.label;

  const textEl = document.createElement('div');
  textEl.className = 'bubble-text';
  textEl.textContent = text;

  bubble.appendChild(nameEl);
  bubble.appendChild(textEl);
  row.appendChild(bubble);
  messagesEl.appendChild(row);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function addTypingNotice(text) {
  const row = document.createElement('div');
  row.className = 'bubble-row system';
  row.id = 'typing-notice';
  const bubble = document.createElement('div');
  bubble.className = 'bubble typing';
  bubble.textContent = text;
  row.appendChild(bubble);
  messagesEl.appendChild(row);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function removeTypingNotice() {
  const el = document.getElementById('typing-notice');
  if (el) el.remove();
}

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
        chip.textContent = `📎 ${data.filename}`;
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
  addTypingNotice('업무 처리 중…');

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
