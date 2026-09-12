import path from 'node:path';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { readZipEntries, zipText } from './zip-reader.js';
import { decodeEntities, firstHeading, firstXmlNodeText, htmlToText, normalizeNewlines, textFromXmlNodes } from './xml.js';

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function normalizeExtractedText(text) {
  return normalizeNewlines(text)
    .replace(/\u0000/g, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

function attrs(fragment = '') {
  const result = {};
  for (const match of fragment.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/gs)) result[match[1]] = decodeEntities(match[3]);
  return result;
}

function parseManifest(opf) {
  const manifest = new Map();
  for (const match of opf.matchAll(/<item\b([^>]*?)\/?\s*>/gi)) {
    const item = attrs(match[1]);
    if (item.id && item.href) manifest.set(item.id, item);
  }
  return manifest;
}

function parseSpine(opf) {
  return [...opf.matchAll(/<itemref\b([^>]*?)\/?\s*>/gi)]
    .map((match) => attrs(match[1]).idref)
    .filter(Boolean);
}

function resolveZipPath(baseFile, href) {
  const decoded = decodeURIComponent(href.split('#')[0]);
  return path.posix.normalize(path.posix.join(path.posix.dirname(baseFile), decoded));
}

export function detectManuscriptFormat({ filename = '', buffer }) {
  const ext = path.extname(filename).toLowerCase();
  if (ext === '.epub') return 'epub';
  if (ext === '.docx') return 'docx';
  if (ext === '.txt' || ext === '.text' || ext === '.md' || ext === '.markdown') return 'text';

  if (buffer?.subarray(0, 2).toString('binary') === 'PK') {
    const entries = readZipEntries(buffer);
    if (entries.has('META-INF/container.xml') || entries.has('mimetype')) return 'epub';
    if (entries.has('[Content_Types].xml') && entries.has('word/document.xml')) return 'docx';
  }
  return 'text';
}

export function extractText(input, { filename = 'manuscript.txt' } = {}) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const text = normalizeExtractedText(buffer.toString('utf8').replace(/^\uFEFF/, ''));
  return Object.freeze({
    format: 'text', filename, text,
    metadata: Object.freeze({ title: null, author: null, language: null }),
    sections: Object.freeze([]), sourceHash: sha256(buffer)
  });
}

export function extractDocx(input, { filename = 'manuscript.docx' } = {}) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const entries = readZipEntries(buffer);
  const documentXml = zipText(entries, 'word/document.xml');
  const paragraphs = [];

  for (const match of documentXml.matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/gi)) {
    const paragraphXml = match[1];
    const style = paragraphXml.match(/<w:pStyle\b[^>]*w:val=["']([^"']+)["']/i)?.[1] ?? null;
    const content = paragraphXml
      .replace(/<w:tab\b[^>]*\/?\s*>/gi, '\t')
      .replace(/<w:(?:br|cr)\b[^>]*\/?\s*>/gi, '\n');
    const pieces = [...content.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/gi)].map((textMatch) => decodeEntities(textMatch[1]));
    const value = pieces.join('').replace(/[ \t]+\n/g, '\n').trim();
    if (value) paragraphs.push({ value, style });
  }

  const text = normalizeExtractedText(paragraphs.map(({ value }) => value).join('\n\n'));
  const core = zipText(entries, 'docProps/core.xml', { required: false }) ?? '';
  return Object.freeze({
    format: 'docx', filename, text,
    metadata: Object.freeze({
      title: firstXmlNodeText(core, 'title'),
      author: firstXmlNodeText(core, 'creator'),
      language: firstXmlNodeText(core, 'language')
    }),
    sections: Object.freeze([]), sourceHash: sha256(buffer)
  });
}

export function extractEpub(input, { filename = 'manuscript.epub' } = {}) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const entries = readZipEntries(buffer);
  const containerXml = zipText(entries, 'META-INF/container.xml');
  const rootfile = containerXml.match(/<rootfile\b[^>]*full-path=["']([^"']+)["']/i)?.[1];
  if (!rootfile) throw new Error('invalid EPUB: package document not declared in META-INF/container.xml');

  const opfPath = decodeEntities(rootfile);
  const opf = zipText(entries, opfPath);
  const manifest = parseManifest(opf);
  const spine = parseSpine(opf);
  const sections = [];

  for (const idref of spine) {
    const item = manifest.get(idref);
    if (!item) continue;
    const mediaType = item['media-type'] ?? '';
    if (!/(xhtml|html)/i.test(mediaType) && !/\.x?html?$/i.test(item.href)) continue;
    const sectionPath = resolveZipPath(opfPath, item.href);
    const html = zipText(entries, sectionPath, { required: false });
    if (!html) continue;
    const text = normalizeExtractedText(htmlToText(html));
    if (!text) continue;
    sections.push(Object.freeze({
      id: idref,
      path: sectionPath,
      heading: firstHeading(html),
      text
    }));
  }

  if (!sections.length) throw new Error('invalid EPUB: no readable spine content found');
  const text = normalizeExtractedText(sections.map((section) => section.text).join('\n\n'));
  return Object.freeze({
    format: 'epub', filename, text,
    metadata: Object.freeze({
      title: firstXmlNodeText(opf, 'title'),
      author: firstXmlNodeText(opf, 'creator'),
      language: firstXmlNodeText(opf, 'language')
    }),
    sections: Object.freeze(sections), sourceHash: sha256(buffer)
  });
}

export function extractManuscript(input, { filename = 'manuscript.txt', format = null } = {}) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const resolved = format ?? detectManuscriptFormat({ filename, buffer });
  if (resolved === 'epub') return extractEpub(buffer, { filename });
  if (resolved === 'docx') return extractDocx(buffer, { filename });
  if (resolved === 'text') return extractText(buffer, { filename });
  throw new Error(`unsupported manuscript format: ${resolved}`);
}

export function extractManuscriptFile(filePath, options = {}) {
  const buffer = readFileSync(filePath);
  return extractManuscript(buffer, { filename: path.basename(filePath), ...options });
}

export const _internals = Object.freeze({ textFromXmlNodes });
