// 승인 뒤 최종화 확인.
// 제임스가 승인한 뒤 사용자가 미검증·미확인 항목을 승인하고 에이미가 -final 과 승인 기록을 만들었을 때,
// 그 변경이 "승인된 버전의 바이트 동일 복사본 + 그 버전을 적은 승인 기록"뿐이면 제임스 재검토를 생략한다.
// 그 밖의 변경(승인된 파일이 바뀜, 새 버전이 생김, 파일이 사라짐 등)이 있으면 ok:false 이고 기존대로 제임스가 재검토한다.
//
// "승인된 버전"은 승인 시점에 있던 가장 높은 -vN 이다(제임스는 최신 산출물을 검토한다). 더 오래된 버전을 복사한 최종본은 인정하지 않는다.
//
// approved, after: 상대경로 -> 내용 해시 (app/server.js 의 snapshotOutputs 결과)
// readText(rel): 승인 기록 파일 내용을 읽는 함수
// 반환: { ok: true } 또는 { ok: false, code } — code 에는 파일 이름을 넣지 않는다(로그에 고객 정보가 남지 않게).
const path = require('path');

const FINAL_RE = /^(.*)-final(\.[^.\\/]+)$/; // X-final.xlsx (X-final.record.txt 는 확장자에 점이 있어 해당 없음)
const RECORD_RE = /-final\.record\.txt$/;
const VERSION_RE = /^-v(\d+)$/;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// stem 아래 ext 확장자의 -vN 파일들: [{ key, n }]
function versionsOf(files, stem, ext) {
  const out = [];
  for (const k of Object.keys(files)) {
    if (!k.startsWith(stem) || !k.endsWith(ext)) continue;
    const m = k.slice(stem.length, k.length - ext.length).match(VERSION_RE);
    if (m) out.push({ key: k, n: Number(m[1]) });
  }
  return out;
}

function finalizeOnly(approved, after, readText) {
  const changed = [];
  for (const k of new Set([...Object.keys(approved), ...Object.keys(after)])) {
    if (approved[k] !== after[k]) changed.push(k);
  }
  if (changed.length === 0) return { ok: false, code: 'NO_CHANGE' };

  const finals = [];
  const records = [];
  for (const k of changed) {
    if (RECORD_RE.test(k)) { records.push(k); continue; }
    if (!FINAL_RE.test(k) || after[k] === undefined) return { ok: false, code: 'OTHER_CHANGED' };
    finals.push(k);
  }
  if (finals.length === 0) return { ok: false, code: 'NO_FINAL' };

  const expectedRecords = new Set();
  for (const f of finals) {
    const [, stem, ext] = f.match(FINAL_RE);
    const versions = versionsOf(approved, stem, ext);
    if (versions.length === 0) return { ok: false, code: 'FINAL_DIFFERS' };
    const top = versions.reduce((a, b) => (b.n > a.n ? b : a));
    if (approved[top.key] !== after[f]) return { ok: false, code: 'FINAL_DIFFERS' };

    const rec = stem + '-final.record.txt';
    expectedRecords.add(rec);
    if (after[rec] === undefined) return { ok: false, code: 'RECORD_MISSING' };
    let text;
    try { text = readText(rec); } catch (e) { return { ok: false, code: 'RECORD_UNREADABLE' }; }
    // 최신 버전과 바이트가 같은 다른 버전(예: 같은 입력으로 다시 만든 v3 와 v2)은 기록이 어느 쪽을 적어도 된다.
    // 이름 뒤에 숫자가 이어지면(v1 대 v10) 다른 버전이므로 인정하지 않는다.
    const names = versions.filter((v) => approved[v.key] === approved[top.key]).map((v) => path.basename(v.key, ext));
    if (!names.some((n) => new RegExp(escapeRe(n) + '(?!\\d)').test(text))) return { ok: false, code: 'RECORD_VERSION' };
    // 이 경로는 사용자가 항목별로 승인한 뒤에만 오므로 기록에 사용자 승인이 적혀 있어야 한다(내용의 정확성까지 확인하는 것은 아니다).
    if (!text.includes('사용자')) return { ok: false, code: 'RECORD_USER' };
  }
  // 검증한 최종본의 기록이 아닌 다른 승인 기록이 바뀌었으면 건너뛰지 않는다.
  if (records.some((r) => !expectedRecords.has(r))) return { ok: false, code: 'OTHER_CHANGED' };
  return { ok: true };
}

module.exports = { finalizeOnly };
