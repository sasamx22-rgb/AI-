'use strict';

// 독립 추출기(Independent Extractor) — Amy가 만든 review.txt에 의존하지 않고,
// 실제 생성된 .docx/.pptx 바이너리에서 직접 텍스트를 다시 뽑아낸다(섹션 17).
// docx/pptx는 OOXML(zip 컨테이너) 포맷이라 jszip으로 열어 XML의 텍스트런만
// 정규식으로 뽑는다 — 레이아웃/서식은 버리고 "실제로 어떤 글자/숫자가 들어있는가"만
// 확인하는 용도이므로 이 정도 단순 구현으로 충분하다.
const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

function extractRunsFromXml(xml, tagLocalName) {
  // 네임스페이스 접두사(w:, a: 등)를 허용하는 정규식. self-closing 태그(빈 텍스트)는 무시.
  const re = new RegExp(`<(?:\\w+:)?${tagLocalName}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${tagLocalName}>`, 'g');
  const parts = [];
  let m;
  while ((m = re.exec(xml))) {
    parts.push(decodeXmlEntities(m[1]));
  }
  return parts;
}

function decodeXmlEntities(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

async function extractDocxBuffer(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const docXmlFile = zip.file('word/document.xml');
  if (!docXmlFile) throw new Error('word/document.xml을 찾을 수 없음 (docx 구조 손상 의심)');
  const xml = await docXmlFile.async('string');
  const runs = extractRunsFromXml(xml, 'w:t');
  // 문단 구분을 위해 </w:p> 경계마다 개행을 넣어 가독성을 확보한다.
  const paragraphs = xml.split(/<\/w:p>/).map((para) => extractRunsFromXml(para, 'w:t').join(''));
  return paragraphs.filter((p) => p.trim()).join('\n');
}

async function extractPptxBuffer(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const slideNames = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => {
      const na = parseInt(a.match(/slide(\d+)\.xml$/)[1], 10);
      const nb = parseInt(b.match(/slide(\d+)\.xml$/)[1], 10);
      return na - nb;
    });
  if (slideNames.length === 0) throw new Error('ppt/slides/*.xml을 찾을 수 없음 (pptx 구조 손상 의심)');
  const slideTexts = [];
  for (const name of slideNames) {
    const xml = await zip.file(name).async('string');
    const runs = extractRunsFromXml(xml, 'a:t');
    slideTexts.push(runs.join(' '));
  }
  return slideTexts.map((t, i) => `[슬라이드 ${i + 1}]\n${t}`).join('\n\n');
}

// filePath 확장자에 따라 적절한 방식으로 텍스트를 추출한다. md/txt는 이미
// 평문이므로 그대로 읽는다(추출기가 없다고 검토를 막지 않기 위함).
async function extractText(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.docx') {
    const buffer = fs.readFileSync(filePath);
    return extractDocxBuffer(buffer);
  }
  if (ext === '.pptx') {
    const buffer = fs.readFileSync(filePath);
    return extractPptxBuffer(buffer);
  }
  return fs.readFileSync(filePath, 'utf8');
}

module.exports = { extractText, extractDocxBuffer, extractPptxBuffer };
