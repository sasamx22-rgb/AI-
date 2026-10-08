// 제임스에게 줄 "이번 검토 대상"을 정하는 순수 함수들(파일 읽기 없음, 시험하기 쉽게 분리).
//  - changedFiles: 에이미가 이번에 추가·변경한 산출물 목록 (outputs 스냅샷 비교)
//  - farTarget: 산출물 파일 이름에서 정산표(FAR) 회사·연도·버전과 검증 자료 폴더를 읽는다
//  - artifactStatus: 검증 자료 gate.txt 의 ARTIFACT 줄이 이 산출물의 것이고 저장된 결과인지 본다
const path = require('path');

const FAR_RE = /(?:^|[\\/])FAR_(.+)_FY(\d{4})-v(\d+)\.xlsx$/i;

// before, after: 상대경로 -> 내용 해시 (server.js 의 snapshotOutputs 결과)
function changedFiles(before, after) {
  return Object.keys(after).filter((k) => before[k] !== after[k]).sort();
}

function farTarget(rel) {
  const m = rel.match(FAR_RE);
  if (!m) return null;
  return { abbr: m[1], fy: m[2], version: Number(m[3]), verifyRel: ['companies', m[1], 'FY' + m[2], 'verify'].join('/') };
}

const samePath = (a, b) => {
  const n = (p) => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p));
  return n(a) === n(b);
};

// gateText: gate.txt 내용(없으면 null), artifactAbs: 이번 산출물의 절대경로
// ARTIFACT 줄 형식: "ARTIFACT: <경로>  (run <시각>; saved: True|False)"
function artifactStatus(gateText, artifactAbs) {
  if (gateText === null || gateText === undefined) return { ok: false, code: 'NO_GATE' };
  const m = gateText.match(/^ARTIFACT:\s*(.+?)\s{2,}\(run [^;]*;\s*saved:\s*(True|False)\)/im);
  if (!m) return { ok: false, code: 'NO_ARTIFACT' };
  if (!samePath(m[1], artifactAbs)) return { ok: false, code: 'OTHER_ARTIFACT' };
  if (m[2].toLowerCase() !== 'true') return { ok: false, code: 'NOT_SAVED' };
  return { ok: true };
}

module.exports = { changedFiles, farTarget, artifactStatus };
