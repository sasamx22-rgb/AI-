// 승인 뒤 최종화 확인.
// 제임스가 승인한 뒤 사용자가 미검증·미확인 항목을 승인하고 에이미가 -final 과 승인 기록을 만들었을 때,
// 그 변경이 "승인된 버전의 바이트 동일 복사본 + 그 버전을 적은 승인 기록"뿐이면 제임스 재검토를 생략한다.
// 그 밖의 변경(승인된 파일이 바뀜, 새 버전이 생김, 파일이 사라짐 등)이 있으면 ok:false 이고 기존대로 제임스가 재검토한다.
//
// approved, after: 상대경로 -> 내용 해시 (app/server.js 의 snapshotOutputs 결과)
// readText(rel): 승인 기록 파일 내용을 읽는 함수
// 반환: { ok: true } 또는 { ok: false, code } — code 에는 파일 이름을 넣지 않는다(로그에 고객 정보가 남지 않게).
const path = require('path');

const FINAL_RE = /^(.*)-final(\.[^.\\/]+)$/; // X-final.xlsx (X-final.record.txt 는 확장자에 점이 있어 해당 없음)
const RECORD_RE = /-final\.record\.txt$/;

function finalizeOnly(approved, after, readText) {
  const changed = [];
  for (const k of new Set([...Object.keys(approved), ...Object.keys(after)])) {
    if (approved[k] !== after[k]) changed.push(k);
  }
  if (changed.length === 0) return { ok: false, code: 'NO_CHANGE' };

  const finals = [];
  for (const k of changed) {
    if (RECORD_RE.test(k)) continue;
    if (!FINAL_RE.test(k) || after[k] === undefined) return { ok: false, code: 'OTHER_CHANGED' };
    finals.push(k);
  }
  if (finals.length === 0) return { ok: false, code: 'NO_FINAL' };

  for (const f of finals) {
    const [, stem, ext] = f.match(FINAL_RE);
    const srcs = Object.keys(approved).filter((k) => {
      if (k === f || !k.startsWith(stem) || !k.endsWith(ext)) return false;
      return /^-v\d+$/.test(k.slice(stem.length, k.length - ext.length)) && approved[k] === after[f];
    });
    if (srcs.length === 0) return { ok: false, code: 'FINAL_DIFFERS' };
    const rec = stem + '-final.record.txt';
    if (after[rec] === undefined) return { ok: false, code: 'RECORD_MISSING' };
    let text;
    try { text = readText(rec); } catch (e) { return { ok: false, code: 'RECORD_UNREADABLE' }; }
    // 같은 바이트의 승인 버전이 둘 이상이면(예: 같은 입력으로 다시 만든 v3) 기록이 그중 하나를 적었으면 된다
    if (!srcs.some((s) => text.includes(path.basename(s, ext)))) return { ok: false, code: 'RECORD_VERSION' };
  }
  return { ok: true };
}

module.exports = { finalizeOnly };
