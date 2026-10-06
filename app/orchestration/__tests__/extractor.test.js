'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const JSZip = require('jszip');
const { extractText } = require('../departments/document/extractor');

const DOCX_DOCUMENT_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>2025년 3분기 누적 매출은 320백만원이다.</w:t></w:r></w:p>
    <w:p><w:r><w:t>전년동기 대비 14.3% 증가했다.</w:t></w:r></w:p>
  </w:body>
</w:document>`;

const PPTX_SLIDE1_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>회사 소개</a:t></a:r></a:p></p:txBody></p:sp></p:cSld>
</p:sld>`;

const PPTX_SLIDE2_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>2025년 매출 320백만원</a:t></a:r></a:p></p:txBody></p:sp></p:cSld>
</p:sld>`;

async function writeMinimalDocx(filePath) {
  const zip = new JSZip();
  zip.file('word/document.xml', DOCX_DOCUMENT_XML);
  const buf = await zip.generateAsync({ type: 'nodebuffer' });
  fs.writeFileSync(filePath, buf);
}

async function writeMinimalPptx(filePath) {
  const zip = new JSZip();
  zip.file('ppt/slides/slide1.xml', PPTX_SLIDE1_XML);
  zip.file('ppt/slides/slide2.xml', PPTX_SLIDE2_XML);
  const buf = await zip.generateAsync({ type: 'nodebuffer' });
  fs.writeFileSync(filePath, buf);
}

test('L: 독립 추출기가 실제 .docx 바이너리에서 텍스트를 뽑아낸다 (Amy의 자체 review.txt에 의존하지 않음)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extractor-test-'));
  const docxPath = path.join(dir, 'sample.docx');
  await writeMinimalDocx(docxPath);

  const text = await extractText(docxPath);
  assert.match(text, /320백만원/);
  assert.match(text, /전년동기 대비 14\.3%/);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('L: 독립 추출기가 실제 .pptx 바이너리에서 슬라이드별 텍스트를 뽑아낸다', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extractor-test-'));
  const pptxPath = path.join(dir, 'sample.pptx');
  await writeMinimalPptx(pptxPath);

  const text = await extractText(pptxPath);
  assert.match(text, /\[슬라이드 1\]/);
  assert.match(text, /회사 소개/);
  assert.match(text, /\[슬라이드 2\]/);
  assert.match(text, /320백만원/);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('손상된 docx(zip이지만 document.xml 없음)는 명확한 에러를 던진다', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extractor-test-'));
  const docxPath = path.join(dir, 'broken.docx');
  const zip = new JSZip();
  zip.file('word/nothing.xml', '<x/>');
  fs.writeFileSync(docxPath, await zip.generateAsync({ type: 'nodebuffer' }));

  await assert.rejects(() => extractText(docxPath), /document\.xml/);

  fs.rmSync(dir, { recursive: true, force: true });
});
