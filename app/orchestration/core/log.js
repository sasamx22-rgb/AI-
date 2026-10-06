'use strict';

const fs = require('fs');
const path = require('path');

// jobs/<id>/logs/log.jsonl 에 한 줄씩 이벤트를 append한다. 사람이 읽기 쉬운
// 요약(진행자/UI에서 사용)과, 나중에 문제가 생겼을 때 추적 가능한 감사
// 로그(누가 언제 무슨 상태 전이를 왜 했는지)를 겸한다.
function appendLog(jobDir, event) {
  const logsDir = path.join(jobDir, 'logs');
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
  const line = JSON.stringify({ at: new Date().toISOString(), ...event });
  fs.appendFileSync(path.join(logsDir, 'log.jsonl'), line + '\n', 'utf8');
}

function readLog(jobDir) {
  const file = path.join(jobDir, 'logs', 'log.jsonl');
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

module.exports = { appendLog, readLog };
