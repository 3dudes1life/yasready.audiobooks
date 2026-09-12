import { createHash } from 'node:crypto';

const CHAPTER_HEADING = /^(?:(?:chapter|chap(?:ter)?\.?|ch\.)\s+(?:\d+[a-z]?|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty)(?:\s*[:.\-–—]\s*.*)?|prologue|epilogue|introduction|preface|afterword|acknowledg(?:e)?ments|author(?:'s)?\s+note|part\s+(?:\d+|[ivxlcdm]+|one|two|three|four|five)(?:\s*[:.\-–—]\s*.*)?)$/i;
const SCENE_BREAK = /^(?:\*\s*\*\s*\*|#|#{3,}|[-–—]\s*[-–—]\s*[-–—]|•\s*•\s*•)$/;
const SPEECH_VERBS = 'said|asked|replied|answered|whispered|murmured|shouted|yelled|called|added|continued|laughed|snapped|sighed|offered|admitted|insisted|promised|teased|joked|warned|cried';
const NON_CHARACTER_SPEAKERS = new Set(['he', 'she', 'they', 'we', 'i', 'you', 'it', 'someone', 'somebody', 'everyone', 'everybody', 'nobody', 'who']);

function cleanText(text = '') {
  return String(text)
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

function sha(value) {
  return createHash('sha256').update(value).digest('hex');
}

function detectHeading(line) {
  const value = line.trim();
  if (value.length > 100) return false;
  return CHAPTER_HEADING.test(value);
}

export function splitChapters(text) {
  const lines = cleanText(text).split('\n');
  const chapters = [];
  let current = { title: null, lines: [] };

  const flush = () => {
    const body = cleanText(current.lines.join('\n'));
    if (!current.title && !body) return;
    chapters.push({ title: current.title ?? `Chapter ${chapters.length + 1}`, text: body });
  };

  for (const line of lines) {
    if (detectHeading(line)) {
      if (current.title || current.lines.some((value) => value.trim())) flush();
      current = { title: line.trim(), lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  flush();

  if (!chapters.length) return [{ title: 'Chapter 1', text: cleanText(text) }];
  if (chapters.length > 1 && chapters[0].title === 'Chapter 1' && chapters[0].text.length < 80) {
    chapters[0].title = 'Front Matter';
  }
  return chapters;
}

export function splitScenes(chapterText) {
  const lines = cleanText(chapterText).split('\n');
  const scenes = [];
  let current = [];
  const flush = () => {
    const text = cleanText(current.join('\n'));
    if (text) scenes.push(text);
    current = [];
  };
  for (const line of lines) {
    if (SCENE_BREAK.test(line.trim())) flush();
    else current.push(line);
  }
  flush();
  return scenes.length ? scenes : [''];
}

function validSpeakerName(name) {
  const clean = String(name ?? '').trim();
  if (!clean || NON_CHARACTER_SPEAKERS.has(clean.toLowerCase())) return null;
  // Keep the original capitalization rule meaningful even though the verb regexes are case-insensitive.
  const parts = clean.split(/\s+/);
  if (parts.some((part) => !/^\p{Lu}[\p{L}’'-]*$/u.test(part))) return null;
  return clean;
}

function speakerCandidate(paragraph) {
  const name = '([A-Z][A-Za-z’\\\'-]+(?:\\s+[A-Z][A-Za-z’\\\'-]+)?)';
  const checks = [
    { match: new RegExp(`^\\s*${name}\\s+(?:${SPEECH_VERBS})\\b`, 'i').exec(paragraph), confidence: 0.82, evidence: 'speaker-before-dialogue' },
    { match: new RegExp(`[”"]\\s*,?\\s*${name}\\s+(?:${SPEECH_VERBS})\\b`, 'i').exec(paragraph), confidence: 0.88, evidence: 'dialogue-tag' },
    { match: new RegExp(`[”"]\\s*,?\\s*(?:${SPEECH_VERBS})\\s+${name}\\b`, 'i').exec(paragraph), confidence: 0.86, evidence: 'inverted-dialogue-tag' }
  ];
  for (const check of checks) {
    const resolved = validSpeakerName(check.match?.[1]);
    if (resolved) return { name: resolved, confidence: check.confidence, evidence: check.evidence };
  }
  return null;
}

export function segmentScene(sceneText) {
  const paragraphs = cleanText(sceneText).split(/\n\s*\n+/).map((value) => value.trim()).filter(Boolean);
  const segments = [];
  let order = 0;

  for (const paragraph of paragraphs) {
    const speaker = speakerCandidate(paragraph);
    const quoteRegex = /[“"]([^”"\n]+)[”"]/g;
    let cursor = 0;
    let matched = false;
    for (const match of paragraph.matchAll(quoteRegex)) {
      matched = true;
      const start = match.index ?? 0;
      const narration = paragraph.slice(cursor, start).trim();
      if (narration) segments.push({ order: order++, kind: 'narration', text: narration, speakerCandidate: null });
      const dialogue = match[1].trim();
      if (dialogue) segments.push({ order: order++, kind: 'dialogue', text: dialogue, speakerCandidate: speaker });
      cursor = start + match[0].length;
    }
    const remainder = paragraph.slice(cursor).trim();
    if (remainder) {
      const kind = !matched && /^[“"]/.test(paragraph) ? 'dialogue' : 'narration';
      segments.push({ order: order++, kind, text: remainder.replace(/^[“"]|[”"]$/g, '').trim(), speakerCandidate: kind === 'dialogue' ? speaker : null });
    }
  }
  return segments;
}

function words(text) {
  return (String(text).match(/[\p{L}\p{N}]+(?:[’'-][\p{L}\p{N}]+)*/gu) ?? []).length;
}

export function countProduction({ text, chapters }) {
  const allSegments = chapters.flatMap((chapter) => chapter.scenes.flatMap((scene) => scene.segments));
  const productionText = allSegments.map((segment) => segment.text).join('\n');
  const wordCount = words(text);
  const dialogueSegments = allSegments.filter((segment) => segment.kind === 'dialogue');
  const narrationSegments = allSegments.filter((segment) => segment.kind === 'narration');
  return Object.freeze({
    words: wordCount,
    sourceCharacters: text.length,
    sourceCharactersNoWhitespace: text.replace(/\s/g, '').length,
    productionCharacters: productionText.length,
    estimatedMinutesAt155Wpm: Number((wordCount / 155).toFixed(1)),
    chapters: chapters.length,
    scenes: chapters.reduce((sum, chapter) => sum + chapter.scenes.length, 0),
    segments: allSegments.length,
    dialogueSegments: dialogueSegments.length,
    narrationSegments: narrationSegments.length,
    dialogueCharacters: dialogueSegments.reduce((sum, segment) => sum + segment.text.length, 0),
    narrationCharacters: narrationSegments.reduce((sum, segment) => sum + segment.text.length, 0)
  });
}

export function analyzeManuscript(extracted, options = {}) {
  if (!extracted?.text?.trim()) throw new Error('manuscript contains no readable text');
  const text = cleanText(extracted.text);
  const chapters = splitChapters(text).map((chapter, chapterIndex) => {
    const scenes = splitScenes(chapter.text).map((sceneText, sceneIndex) => {
      const segments = segmentScene(sceneText);
      return Object.freeze({
        order: sceneIndex,
        textHash: sha(sceneText),
        segments: Object.freeze(segments.map((segment) => Object.freeze(segment)))
      });
    });
    return Object.freeze({
      order: chapterIndex,
      title: chapter.title,
      textHash: sha(chapter.text),
      scenes: Object.freeze(scenes)
    });
  });

  const metrics = countProduction({ text, chapters });
  return Object.freeze({
    schemaVersion: 2,
    source: Object.freeze({
      format: extracted.format,
      filename: extracted.filename,
      sourceHash: extracted.sourceHash,
      normalizedTextHash: sha(text)
    }),
    metadata: Object.freeze({
      title: options.title ?? extracted.metadata?.title ?? null,
      author: options.author ?? extracted.metadata?.author ?? null,
      language: options.language ?? extracted.metadata?.language ?? 'en'
    }),
    metrics,
    chapters: Object.freeze(chapters),
    warnings: Object.freeze(buildWarnings({ extracted, chapters, metrics }))
  });
}

function buildWarnings({ extracted, chapters, metrics }) {
  const warnings = [];
  if (chapters.length === 1 && metrics.words > 10_000) warnings.push('Only one chapter was detected; verify chapter headings before production.');
  if (metrics.dialogueSegments === 0 && metrics.words > 5_000) warnings.push('No quoted dialogue was detected; verify quotation style if this is fiction.');
  const unresolved = chapters.flatMap((chapter) => chapter.scenes.flatMap((scene) => scene.segments))
    .filter((segment) => segment.kind === 'dialogue' && !segment.speakerCandidate).length;
  if (unresolved) warnings.push(`${unresolved} dialogue segment(s) need speaker attribution in a later casting/director pass.`);
  if (extracted.format === 'epub' && extracted.sections?.length && chapters.length < Math.max(2, extracted.sections.length / 4)) {
    warnings.push('EPUB spine contains substantially more sections than detected chapters; review front/back matter and chapter structure.');
  }
  return warnings;
}
