'use strict';

const path = require('path');
const fs = require('fs');

// 테스트에서 실제 저장소 대신 임시 디렉터리를 가리키게 하기 위한 override.
// 평소(사람이 쓸 때)는 항상 실제 저장소 루트를 쓴다 — 프로덕션 코드 경로에는
// 영향이 없다.
const REPO_ROOT = process.env.AI_ASSISTANT_REPO_ROOT
  ? path.resolve(process.env.AI_ASSISTANT_REPO_ROOT)
  : path.resolve(__dirname, '..', '..', '..');
const JOBS_DIR = path.join(REPO_ROOT, 'jobs');
const INPUTS_DIR = path.join(REPO_ROOT, 'inputs');
const OUTPUTS_DIR = path.join(REPO_ROOT, 'outputs');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// 목적지 경로가 실제로 baseDir 내부에 있는지 확인한다 (경로 조작/traversal 방어).
// path.resolve로 정규화한 뒤 baseDir + separator로 시작하는지 검사한다 — 단순
// startsWith(baseDir)만 쓰면 baseDir="/a/b"와 실제경로="/a/bc/x" 같은
// 형제 디렉터리 오탐(우회는 아니지만 오탐)까지 허용해버리므로 구분자를 포함해 비교한다.
function isPathInside(baseDir, targetPath) {
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(targetPath);
  if (resolvedTarget === resolvedBase) return true;
  return resolvedTarget.startsWith(resolvedBase + path.sep);
}

// 업로드/생성 파일명에서 경로 구분자, 상위 디렉터리 이동, 제어문자를 제거한다.
// 원본 파일명의 "의미"는 최대한 보존하되(한글/공백/일반 특수문자는 허용),
// 실제 파일시스템 조작에 쓰일 수 있는 문자만 제거한다.
function sanitizeFilename(originalName) {
  const base = path.basename(String(originalName || '').replace(/\\/g, '/'));
  // eslint-disable-next-line no-control-regex
  let cleaned = base.replace(/[\u0000-\u001f\u007f]/g, '');
  cleaned = cleaned.replace(/^\.+/, '').trim();
  if (!cleaned) cleaned = `file-${Date.now()}`;
  return cleaned;
}

// destDir 안에 filename으로 저장하되, 이미 있으면 -1, -2 ... 접미사를 붙여
// 기존 파일을 덮어쓰지 않는다.
function resolveNonCollidingPath(destDir, filename) {
  const ext = path.extname(filename);
  const stem = filename.slice(0, filename.length - ext.length);
  let candidate = path.join(destDir, filename);
  let n = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(destDir, `${stem}-${n}${ext}`);
    n += 1;
  }
  return candidate;
}

module.exports = {
  REPO_ROOT,
  JOBS_DIR,
  INPUTS_DIR,
  OUTPUTS_DIR,
  ensureDir,
  isPathInside,
  sanitizeFilename,
  resolveNonCollidingPath,
};
