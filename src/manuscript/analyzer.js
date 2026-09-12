import { createHash } from 'node:crypto';

const CHAPTER_HEADING = /^(?:(?:chapter|chap(?:ter)?\.?|ch\.)\s+(?:\d+[a-z]?|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty)(?:\s*[:.\-–—]\s*.*)?|prologue|epilogue|introduction|preface|afterword|acknowledg(?:e)?ments|author(?:'s)?\s+note|part\s+(?:\d+|[ivxlcdm]+|one|two|three|four|five)(?:\s*[:.\-–—]\s*.*)?)$/i;
const SCENE_BREAK = /^(?:\*\s*\*\s*\*|#|#{3,}|[-–—]\s*[-–—]\s*[-–—]|•\s*•\s*•)$/;
const SPEECH_VERBS = 'said|asked|replied|answered|whispered|murmured|shouted|yelled|called|added|continued|laughed|snapped|sighed|offered|admitted|insisted|promised|teased|joked|warned|cried|muttered|retorted|declared|spoke|echoed|quipped|remarked|responded';
const NON_CHARACTER_SPEAKERS = new Set([
  'he', 'she', 'they', 'we', 'i', 'you', 'it', 'someone', 'somebody', 'everyone', 'everybody', 'nobody', 'who',
  'the', 'a', 'an', 'this', 'that', 'then', 'meanwhile', 'suddenly', 'before', 'after', 'once', 'neither', 'both',
  'at', 'as', 'when', 'later', 'eventually', 'her', 'his', 'from', 'one', 'about', 'afterward', 'and', 'back',
  'by', 'during', 'finally', 'nearby', 'not', 'outside', 'their', 'but', 'just', 'more', 'next', 'on', 'something',
  'sure', 'taking', 'was', 'while', 'downstairs', 'laughter', 'drinks', 'soon'
]);
const FRONT_MATTER_MARKERS = [
  /\bcopyright\b/i, /\ball rights reserved\b/i, /\bdedication\b/i, /\btable of contents\b/i,
  /\bisbn\b/i, /\bfirst edition\b/i, /\bprinted in\b/i, /\bcover design\b/i, /\bthis is a work of fiction\b/i
];
const CONTINUATION_CUE = /\b(?:continued|continuing|added|went on|resumed|kept going|finished|then added|before continuing)\b/i;

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

function looksLikeFrontMatter(text) {
  const source = String(text ?? '').slice(0, 12000);
  const hits = FRONT_MATTER_MARKERS.filter((pattern) => pattern.test(source)).length;
  const hasByline = /(?:^|\n)\s*by\s+[^\n]{2,80}(?:\n|$)/im.test(source);
  return hits >= 2 || (hits >= 1 && hasByline);
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
  if (chapters.length > 1 && chapters[0].title === 'Chapter 1'
    && (chapters[0].text.length < 80 || looksLikeFrontMatter(chapters[0].text))) {
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
  const clean = String(name ?? '').trim().replace(/[’']s$/u, '');
  if (!clean || NON_CHARACTER_SPEAKERS.has(clean.toLowerCase())) return null;
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

function leadingNarrationName(text) {
  const match = /^\s*([A-Z][A-Za-z’'-]+)(?:[’']s)?\b/u.exec(String(text ?? ''));
  return validSpeakerName(match?.[1]);
}

function taggedNarrationSpeaker(text) {
  const name = '([A-Z][A-Za-z’\\\'-]+)';
  const match = new RegExp(`^\\s*${name}(?:[’']s)?(?:\\s+[^.!?]{0,45}?)?\\s+(?:${SPEECH_VERBS})\\b`, 'i').exec(String(text ?? ''));
  return validSpeakerName(match?.[1]);
}

function candidate(name, confidence, evidence) {
  const resolved = validSpeakerName(name);
  return resolved ? { name: resolved, confidence, evidence } : null;
}

function nearbyAttributedNames(segments, index, radius = 8) {
  const names = new Map();
  const start = Math.max(0, index - radius);
  const end = Math.min(segments.length - 1, index + radius);
  for (let i = start; i <= end; i += 1) {
    const row = segments[i];
    if (row.kind !== 'dialogue' || !row.speakerCandidate) continue;
    const name = validSpeakerName(row.speakerCandidate.name);
    if (!name) continue;
    names.set(name.toLowerCase(), name);
  }
  return [...names.values()];
}

export function inferDialogueContext(segmentsInput) {
  const segments = segmentsInput.map((row) => ({ ...row, speakerCandidate: row.speakerCandidate ? { ...row.speakerCandidate } : null }));
  const trustedNames = new Set(segments
    .filter((row) => row.kind === 'dialogue' && row.speakerCandidate?.name)
    .map((row) => String(row.speakerCandidate.name).toLowerCase()));
  const isTrusted = (name) => name && trustedNames.has(String(name).toLowerCase());

  // Pass 1: high-confidence local context. This is intentionally conservative.
  for (let i = 0; i < segments.length; i += 1) {
    const row = segments[i];
    if (row.kind !== 'dialogue' || row.speakerCandidate) continue;
    const prev = segments[i - 1] ?? null;
    const prev2 = segments[i - 2] ?? null;
    const next = segments[i + 1] ?? null;
    const next2 = segments[i + 2] ?? null;

    // A narration line immediately after dialogue that says "Rawlins muttered/replied/..."
    // is the strongest contextual tag for the dialogue we just saw.
    if (next?.kind === 'narration') {
      const afterTag = taggedNarrationSpeaker(next.text);
      const isLeadForNextQuote = next2?.kind === 'dialogue' && next2.paragraphIndex === next.paragraphIndex;
      if (afterTag && !isLeadForNextQuote) {
        trustedNames.add(afterTag.toLowerCase());
        row.speakerCandidate = candidate(afterTag, 0.9, 'context-after-speech-tag');
        continue;
      }
    }

    if (prev?.kind === 'narration') {
      const beforeName = leadingNarrationName(prev.text);
      const beforeTag = taggedNarrationSpeaker(prev.text);
      const followsDialogue = prev2?.kind === 'dialogue';
      const sameParagraphLead = prev.paragraphIndex === row.paragraphIndex;

      // If the narration is a speech tag for the previous quote, don't steal it for the next line.
      // A same-paragraph lead-in (Michael said, “...”) belongs to the current quote.
      if (beforeTag && followsDialogue && !sameParagraphLead && !CONTINUATION_CUE.test(prev.text)) {
        // leave unresolved for a later, lower-confidence conversational pass
      } else if (beforeName && (isTrusted(beforeName) || sameParagraphLead) && (!beforeTag || !followsDialogue || sameParagraphLead || CONTINUATION_CUE.test(prev.text))) {
        if (beforeTag) trustedNames.add(beforeName.toLowerCase());
        row.speakerCandidate = candidate(beforeName, beforeTag ? 0.82 : 0.77, beforeTag ? 'context-before-speech-lead' : 'context-before-action');
        continue;
      } else if (CONTINUATION_CUE.test(prev.text) && prev2?.speakerCandidate) {
        row.speakerCandidate = candidate(prev2.speakerCandidate.name, 0.74, 'context-continuation');
        continue;
      }
    }
  }

  // Pass 2: low-confidence two-person turn inference. It improves review ergonomics without
  // pretending certainty; downstream auto-binding already requires higher confidence.
  for (let i = 0; i < segments.length; i += 1) {
    const row = segments[i];
    if (row.kind !== 'dialogue' || row.speakerCandidate) continue;
    const localNames = nearbyAttributedNames(segments, i, 8);
    if (localNames.length !== 2) continue;

    let previousDialogue = null;
    for (let j = i - 1; j >= Math.max(0, i - 4); j -= 1) {
      if (segments[j].kind === 'dialogue') { previousDialogue = segments[j]; break; }
    }
    if (!previousDialogue?.speakerCandidate) continue;

    const previousKey = previousDialogue.speakerCandidate.name.toLowerCase();
    const other = localNames.find((name) => name.toLowerCase() !== previousKey);
    if (!other) continue;

    const bridge = segments.slice(Math.max(0, (segments.indexOf(previousDialogue) + 1)), i)
      .filter((x) => x.kind === 'narration');
    if (bridge.some((x) => leadingNarrationName(x.text) && !CONTINUATION_CUE.test(x.text))) continue;
    row.speakerCandidate = candidate(other, 0.68, 'context-alternating-pair');
  }

  return segments;
}

export function segmentScene(sceneText) {
  const paragraphs = cleanText(sceneText).split(/\n\s*\n+/).map((value) => value.trim()).filter(Boolean);
  const segments = [];
  let order = 0;

  for (let paragraphIndex = 0; paragraphIndex < paragraphs.length; paragraphIndex += 1) {
    const paragraph = paragraphs[paragraphIndex];
    const speaker = speakerCandidate(paragraph);
    const quoteRegex = /[“"]([^”"\n]+)[”"]/g;
    let cursor = 0;
    let matched = false;
    for (const match of paragraph.matchAll(quoteRegex)) {
      matched = true;
      const start = match.index ?? 0;
      const narration = paragraph.slice(cursor, start).trim();
      if (narration) segments.push({ order: order++, paragraphIndex, kind: 'narration', text: narration, speakerCandidate: null });
      const dialogue = match[1].trim();
      if (dialogue) segments.push({ order: order++, paragraphIndex, kind: 'dialogue', text: dialogue, speakerCandidate: speaker });
      cursor = start + match[0].length;
    }
    const remainder = paragraph.slice(cursor).trim();
    if (remainder) {
      const kind = !matched && /^[“"]/.test(paragraph) ? 'dialogue' : 'narration';
      segments.push({ order: order++, paragraphIndex, kind, text: remainder.replace(/^[“"]|[”"]$/g, '').trim(), speakerCandidate: kind === 'dialogue' ? speaker : null });
    }
  }
  return inferDialogueContext(segments);
}

function words(text) {
  return (String(text).match(/[\p{L}\p{N}]+(?:[’'-][\p{L}\p{N}]+)*/gu) ?? []).length;
}

function inferAuthor(text) {
  const front = String(text ?? '').slice(0, 5000);
  const match = /(?:^|\n)\s*by\s+([^\n]{2,80})(?:\n|$)/im.exec(front);
  if (!match) return null;
  const value = match[1].trim().replace(/\s{2,}/g, ' ');
  return value.length <= 80 ? value : null;
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
    schemaVersion: 3,
    source: Object.freeze({
      format: extracted.format,
      filename: extracted.filename,
      sourceHash: extracted.sourceHash,
      normalizedTextHash: sha(text)
    }),
    metadata: Object.freeze({
      title: options.title ?? extracted.metadata?.title ?? null,
      author: options.author ?? extracted.metadata?.author ?? inferAuthor(text) ?? null,
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
