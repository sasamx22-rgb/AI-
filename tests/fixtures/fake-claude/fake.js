// Stand-in for the `claude` CLI used by tests/flow-finalize.test.js. It only scripts the order of calls; it says nothing about real agent behaviour.
const fs = require('fs');
const path = require('path');
const a = process.argv.slice(2);
const agent = a[a.indexOf('--agent') + 1];
const root = process.env.FAKE_ROOT;
const out = path.join(root, 'outputs', 'co');
const verify = path.join(root, 'companies', 'x', 'FY2025', 'verify');
let msg = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => { msg += d; });
process.stdin.on('end', () => {
  fs.appendFileSync(path.join(root, 'calls.log'), agent + '\n');
  const f = (n) => path.join(out, 'FAR_x_FY2025-' + n);
  const fy = (n) => path.join(out, 'FAR_y_FY2025-' + n);
  // gate.txt as far-run writes it: the ARTIFACT line names the saved file the reports belong to
  const writeGate = (artifactFile) => {
    fs.mkdirSync(verify, { recursive: true });
    fs.writeFileSync(path.join(verify, 'gate.txt'), 'GATE: PASS\r\nARTIFACT: ' + artifactFile + '  (run 2026-10-08 10:00; saved: True)\r\n');
  };
  let text = 'reply';
  if (agent === 'reviewer') {
    // keep what James was asked, so tests can look at the review prompt
    fs.appendFileSync(path.join(root, 'review-prompts.log'), JSON.stringify(msg) + '\n');
    // 'REJECT' in the original request: reject the first review, approve once the user's answer is passed along
    text = msg.includes('REJECT') && !msg.includes('[사용자 확인 답변]') ? 'needs the user answer first\n[검토결과: 반려]' : 'approved (conditional)\n[검토결과: 승인]';
  } else if (msg.includes('far-run을 이 파일')) {
    // the app sent Amy back because gate.txt was not this file's: fix it unless the scenario says she cannot
    if (!fs.existsSync(path.join(root, 'stuck.flag'))) writeGate(f('v1.xlsx'));
    text = 'verification rerun';
  } else if (msg.includes('제임스가 다음과 같이') && fs.existsSync(path.join(root, 'flip.flag'))) {
    writeGate(f('v0.xlsx')); // gate now belongs to another file although v1 was already reviewed
    text = 'rebuttal';
  } else if (msg.includes('제임스가 다음과 같이')) {
    text = 'asking the user\n[확인필요]';
  } else if (msg.includes('WRITE')) {
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(f('v1.xlsx'), 'V1-bytes');
    if (msg.includes('GATESTUCK')) fs.writeFileSync(path.join(root, 'stuck.flag'), '1');
    if (msg.includes('GATEFLIP')) fs.writeFileSync(path.join(root, 'flip.flag'), '1');
    if (msg.includes('TWOCOS')) fs.writeFileSync(fy('v1.xlsx'), 'Y1-bytes');
    if (!msg.includes('NOGATE')) writeGate(msg.includes('GATEMISS') || msg.includes('GATESTUCK') ? f('v0.xlsx') : f('v1.xlsx'));
    text = 'draft written';
  } else if (msg.includes('최종본을 만들어주세요')) {
    text = 'items need your approval\n[확인필요]';
  } else if (msg.includes('확인 질문 답변')) {
    if (msg.includes('SCEN=ASKAGAIN')) text = 'one more question\n[확인필요]';
    if (msg.includes('SCEN=GOOD')) {
      fs.copyFileSync(f('v1.xlsx'), f('final.xlsx'));
      fs.writeFileSync(f('final.record.txt'), 'approved version: FAR_x_FY2025-v1.xlsx / 사용자 승인');
      text = 'final made';
    }
    if (msg.includes('SCEN=BADCOPY')) {
      fs.writeFileSync(f('final.xlsx'), 'DIFFERENT');
      fs.writeFileSync(f('final.record.txt'), 'approved version: FAR_x_FY2025-v1.xlsx / 사용자 승인');
      text = 'final made';
    }
    if (msg.includes('SCEN=NORECORD')) {
      fs.copyFileSync(f('v1.xlsx'), f('final.xlsx'));
      text = 'final made';
    }
    if (msg.includes('SCEN=V3ASK')) { // Amy makes v3 and still has one more question
      fs.writeFileSync(f('v3.xlsx'), 'V3-bytes');
      writeGate(f('v3.xlsx'));
      text = 'v3 made, one more question\n[확인필요]';
    }
    if (msg.includes('SCEN=OLDV9')) { // copies a pre-existing, never reviewed v9 as the final
      fs.copyFileSync(f('v9.xlsx'), f('final.xlsx'));
      fs.writeFileSync(f('final.record.txt'), 'approved version: FAR_x_FY2025-v9.xlsx / 사용자 승인');
      text = 'final made';
    }
    if (msg.includes('SCEN=OTHERFINAL')) { // only another company's final appears
      fs.writeFileSync(fy('final.xlsx'), 'Y-final');
      fs.writeFileSync(fy('final.record.txt'), 'approved version: FAR_y_FY2025-v1.xlsx / 사용자 승인');
      text = 'final made';
    }
    if (msg.includes('SCEN=NEWVER')) {
      fs.writeFileSync(f('v2.xlsx'), 'V2-bytes');
      fs.copyFileSync(f('v2.xlsx'), f('final.xlsx'));
      fs.writeFileSync(f('final.record.txt'), 'approved version: FAR_x_FY2025-v2.xlsx / 사용자 승인');
      writeGate(f('v2.xlsx'));
      text = 'final made';
    }
  }
  console.log(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } }));
  console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, num_turns: 1, total_cost_usd: 0, usage: {} }));
});
