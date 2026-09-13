import test from 'node:test';
import assert from 'node:assert/strict';
import {
  InMemoryStore,
  ManuscriptService,
  ProjectService,
  analyzeManuscript,
  extractDocx,
  extractEpub,
  extractText,
  splitChapters,
  splitScenes
} from '../src/index.js';

function makeStoredZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  let count = 0;

  for (const [name, content] of Object.entries(files)) {
    const filename = Buffer.from(name, 'utf8');
    const data = Buffer.from(content, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(filename.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, filename, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(0, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(filename.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, filename);

    offset += local.length + filename.length + data.length;
    count += 1;
  }

  const localBlob = Buffer.concat(localParts);
  const centralBlob = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(count, 8);
  eocd.writeUInt16LE(count, 10);
  eocd.writeUInt32LE(centralBlob.length, 12);
  eocd.writeUInt32LE(localBlob.length, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([localBlob, centralBlob, eocd]);
}

test('text extraction strips BOM and preserves manuscript paragraphs', () => {
  const result = extractText(Buffer.from('\uFEFFChapter 1\r\n\r\nHello world.'));
  assert.equal(result.format, 'text');
  assert.equal(result.text, 'Chapter 1\n\nHello world.');
  assert.match(result.sourceHash, /^[a-f0-9]{64}$/);
});

test('chapter and explicit scene breaks are detected without inventing blank-line scenes', () => {
  const text = `Prologue\n\nOpening.\n\nChapter 1\n\nFirst paragraph.\n\n***\n\nSecond scene.`;
  const chapters = splitChapters(text);
  assert.equal(chapters.length, 2);
  assert.equal(chapters[0].title, 'Prologue');
  assert.equal(chapters[1].title, 'Chapter 1');
  assert.deepEqual(splitScenes(chapters[1].text), ['First paragraph.', 'Second scene.']);
});

test('analysis separates quoted dialogue and keeps attribution as candidate evidence', () => {
  const extracted = extractText(Buffer.from(`Chapter 1\n\nMichael watched the door.\n\n“Are you coming?” Michael asked.\n\nJuan smiled.`));
  const result = analyzeManuscript(extracted, { title: 'Test Novel' });
  const segments = result.chapters[0].scenes[0].segments;
  const dialogue = segments.find((segment) => segment.kind === 'dialogue');
  assert.equal(dialogue.text, 'Are you coming?');
  assert.equal(dialogue.speakerCandidate.name, 'Michael');
  assert.ok(dialogue.speakerCandidate.confidence >= 0.8);
  assert.equal(result.metrics.dialogueSegments, 1);
  assert.equal(result.metadata.title, 'Test Novel');
});

test('DOCX extractor reads paragraphs and core metadata from native package', () => {
  const zip = makeStoredZip({
    '[Content_Types].xml': '<Types/>',
    'word/document.xml': `<w:document xmlns:w="w"><w:body>
      <w:p><w:r><w:t>Chapter 1</w:t></w:r></w:p>
      <w:p><w:r><w:t>Hello &amp; goodbye.</w:t></w:r></w:p>
    </w:body></w:document>`,
    'docProps/core.xml': '<cp:coreProperties xmlns:dc="dc"><dc:title>DOCX Book</dc:title><dc:creator>Author Name</dc:creator><dc:language>en-US</dc:language></cp:coreProperties>'
  });
  const result = extractDocx(zip);
  assert.equal(result.metadata.title, 'DOCX Book');
  assert.equal(result.metadata.author, 'Author Name');
  assert.match(result.text, /Chapter 1\n\nHello & goodbye\./);
});

test('EPUB extractor follows package spine order instead of ZIP entry order', () => {
  const zip = makeStoredZip({
    'mimetype': 'application/epub+zip',
    'META-INF/container.xml': '<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>',
    'OEBPS/chapter2.xhtml': '<html><body><h1>Chapter 2</h1><p>Second.</p></body></html>',
    'OEBPS/chapter1.xhtml': '<html><body><h1>Chapter 1</h1><p>First.</p></body></html>',
    'OEBPS/content.opf': `<package><metadata><dc:title>EPUB Book</dc:title><dc:creator>Writer</dc:creator><dc:language>en</dc:language></metadata>
      <manifest><item id="c2" href="chapter2.xhtml" media-type="application/xhtml+xml"/><item id="c1" href="chapter1.xhtml" media-type="application/xhtml+xml"/></manifest>
      <spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>`
  });
  const result = extractEpub(zip);
  assert.equal(result.metadata.title, 'EPUB Book');
  assert.equal(result.sections.length, 2);
  assert.ok(result.text.indexOf('Chapter 1') < result.text.indexOf('Chapter 2'));
});

test('ManuscriptService persists book hierarchy and advances draft project to analyzed', () => {
  const store = new InMemoryStore();
  const projects = new ProjectService(store);
  const manuscripts = new ManuscriptService(store);
  const project = projects.create({ name: 'Import test' });
  const result = manuscripts.ingestBuffer(project.id, Buffer.from(`Chapter 1\n\nHello.\n\n***\n\n“Hi,” Michael said.`), {
    filename: 'book.txt', title: 'Book'
  });
  assert.equal(store.get('project', project.id).status, 'analyzed');
  assert.equal(result.book.title, 'Book');
  assert.equal(result.chapters.length, 1);
  assert.equal(result.scenes.length, 2);
  assert.ok(result.segments.length >= 2);
  assert.equal(store.list('segment').length, result.segments.length);
});

test('empty manuscripts fail closed', () => {
  const extracted = extractText(Buffer.from('   \n\n'));
  assert.throws(() => analyzeManuscript(extracted), /no readable text/);
});


test('DOCX extractor preserves blank-paragraph and style-spacing layout evidence without changing extracted text', () => {
  const zip = makeStoredZip({
    '[Content_Types].xml': '<Types/>',
    'word/styles.xml': `<w:styles xmlns:w="w">
      <w:style w:type="paragraph" w:styleId="Body"><w:pPr><w:spacing w:after="160"/></w:pPr></w:style>
    </w:styles>`,
    'word/document.xml': `<w:document xmlns:w="w"><w:body>
      <w:p><w:r><w:t>Chapter 1</w:t></w:r></w:p>
      <w:p><w:pPr><w:pStyle w:val="Body"/></w:pPr><w:r><w:t>First paragraph.</w:t></w:r></w:p>
      <w:p></w:p>
      <w:p><w:pPr><w:pStyle w:val="Body"/></w:pPr><w:r><w:t>Second paragraph.</w:t></w:r></w:p>
    </w:body></w:document>`
  });
  const result = extractDocx(zip);
  assert.equal(result.text, 'Chapter 1\n\nFirst paragraph.\n\nSecond paragraph.');
  assert.equal(result.paragraphLayout.length, 3);
  assert.equal(result.paragraphLayout[1].spacingAfterTwips, 160);
  assert.equal(result.paragraphLayout[2].blankParagraphsBefore, 1);
  assert.ok(result.paragraphLayout.every((row) => !Object.prototype.hasOwnProperty.call(row, 'text')));
});
