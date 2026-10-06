'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const CLI_PATH = path.join(__dirname, '..', 'cli.js');

// 실제 저장소가 아니라 임시 디렉터리를 AI_ASSISTANT_REPO_ROOT로 지정해 cli.js를
// 그대로 서브프로세스로 실행한다 — 실제 사용자가 오케스트레이터로서 겪는
// 것과 동일한 경로(진짜 프로세스 스폰, 진짜 파일시스템 I/O)를 테스트한다.
function makeSandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-assistant-sandbox-'));
  for (const sub of ['inputs', 'outputs', 'jobs']) {
    fs.mkdirSync(path.join(root, sub), { recursive: true });
  }
  return {
    root,
    inputsDir: path.join(root, 'inputs'),
    outputsDir: path.join(root, 'outputs'),
    jobsDir: path.join(root, 'jobs'),
    writeInput(name, content) {
      fs.writeFileSync(path.join(root, 'inputs', name), content, 'utf8');
    },
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

function runCli(sandbox, args) {
  const result = spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd: sandbox.root,
    env: { ...process.env, AI_ASSISTANT_REPO_ROOT: sandbox.root },
    encoding: 'utf8',
  });
  let json = null;
  try {
    json = JSON.parse(result.stdout);
  } catch (e) {
    // stdout이 JSON이 아니면(크래시 등) json은 null로 두고 raw를 남긴다.
  }
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, json };
}

module.exports = { makeSandbox, runCli, CLI_PATH };
