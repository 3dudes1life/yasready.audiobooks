import { sha256 } from '../core/hash.js';
import { BOOK_ONE_PROFILE, canonicalizeSpeakerCandidate } from '../superman/book-one-superman.js';

const freeze = (value) => Object.freeze(value);
const PRIMARY = new Set(['Michael Rawlins', 'Juan Delgado', 'Christopher Lancaster']);
const DISCOURSE_PREFIX = /^(?:then|but|and|so|meanwhile|suddenly)\s+/i;
const NOISY_PHRASE_PREFIXES = new Set(['and', 'as', 'because', 'but', 'by', 'figured', 'maybe', 'on', 'said', 'so', 'then', 'well']);
const EMPHATIC_ALL_CAPS = new Set(['LOVE', 'RIGHT', 'OHHH', 'GURL']);
const GENERIC_PROPER_NOUNS = new Set([
  'The', 'This', 'That', 'These', 'Those', 'He', 'She', 'They', 'We', 'You', 'I', 'It', 'His', 'Her', 'Their',
  'Chapter', 'Front Matter', 'Copyright', 'Table Of Contents', 'All Rights Reserved', 'Monday', 'Tuesday', 'Wednesday',
  'Thursday', 'Friday', 'Saturday', 'Sunday', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December', 'Okay', 'Hey', 'Just', 'So', 'Also', 'Wait', 'Do', 'But', 'And', 'Yeah',
  'You', 'Your', 'Our', 'My', 'Well', 'No', 'Yes', 'Maybe', 'Really', 'Right', 'Actually', 'Sure'
]);

function clean(value) { return String(value ?? '').replace(/\s+/g, ' ').trim(); }
function round(value, digits = 3) { return Number(Number(value).toFixed(digits)); }
function excerpt(value, max = 220) {
  const text = clean(value);
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}
function slug(value) {
  return clean(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
function csvCell(value) {
  const text = Array.isArray(value) ? value.join(' | ') : String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}
function chapterRole(chapter) {
  return String(chapter?.title ?? '').toLowerCase() === 'front matter' ? 'front-matter' : 'narrative';
}

export function classifyBookOneCharacter(candidate) {
  if (PRIMARY.has(candidate.name)) return 'primary';
  if (Number(candidate.mentions) >= 10) return 'supporting';
  return 'minor';
}

function bibleAliasesFor(candidate) {
  const configured = BOOK_ONE_PROFILE.aliases?.[candidate.name] ?? candidate.observedAs ?? [];
  const seen = new Set();
  const out = [];
  for (const raw of configured) {
    const value = clean(raw);
    if (!value || value === candidate.name || DISCOURSE_PREFIX.test(value)) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return freeze(out);
}

export function buildBookOneCharacterPlan(supermanReport, { includeNarrator = true } = {}) {
  const candidates = supermanReport?.characterDiscovery?.candidates ?? [];
  const rows = [];
  if (includeNarrator) {
    rows.push(freeze({
      canonicalName: 'Narrator', aliases: freeze([]), role: 'narrator', mentions: 0,
      averageConfidence: 1, castingPriority: 0, seriesCharacterKey: 'narrator',
      castingStatus: 'unassigned', source: 'required-narration-role'
    }));
  }
  for (const candidate of candidates) {
    const role = classifyBookOneCharacter(candidate);
    rows.push(freeze({
      canonicalName: candidate.name,
      aliases: bibleAliasesFor(candidate),
      role,
      mentions: candidate.mentions,
      averageConfidence: candidate.averageConfidence,
      highConfidenceMentions: candidate.highConfidenceMentions ?? 0,
      inferredReviewMentions: candidate.inferredReviewMentions ?? 0,
      castingPriority: role === 'primary' ? 1 : role === 'supporting' ? 2 : 3,
      seriesCharacterKey: slug(candidate.name),
      castingStatus: 'unassigned',
      source: 'book-one-superman'
    }));
  }
  return freeze(rows);
}

function analysisRows(ingestResult) {
  const output = [];
  let flat = 0;
  for (const chapter of ingestResult.analysis.chapters) {
    for (const scene of chapter.scenes) {
      for (const segment of scene.segments) {
        const record = ingestResult.segments?.[flat] ?? null;
        output.push({ chapter, scene, segment, record, flatIndex: flat });
        flat += 1;
      }
    }
  }
  return output;
}

function nearbySpeakerSuggestions(rows, currentIndex, aliases, radius = 5) {
  const current = rows[currentIndex];
  const suggestions = new Map();
  for (let offset = 1; offset <= radius; offset += 1) {
    for (const index of [currentIndex - offset, currentIndex + offset]) {
      const row = rows[index];
      if (!row || row.chapter.order !== current.chapter.order || row.scene.order !== current.scene.order) continue;
      const candidate = row.segment.kind === 'dialogue' ? row.segment.speakerCandidate : null;
      const canonical = canonicalizeSpeakerCandidate(candidate?.name, { aliases });
      if (!canonical) continue;
      const prior = suggestions.get(canonical) ?? { name: canonical, score: 0, nearestDistance: offset, evidence: new Set() };
      prior.score += Math.max(1, (radius + 1) - offset) * Math.max(0.2, Number(candidate?.confidence ?? 0.5));
      prior.nearestDistance = Math.min(prior.nearestDistance, offset);
      if (candidate?.evidence) prior.evidence.add(candidate.evidence);
      suggestions.set(canonical, prior);
    }
  }
  return freeze([...suggestions.values()]
    .map((x) => freeze({ name: x.name, score: round(x.score, 2), nearestDistance: x.nearestDistance, evidence: freeze([...x.evidence]) }))
    .sort((a, b) => b.score - a.score || a.nearestDistance - b.nearestDistance || a.name.localeCompare(b.name))
    .slice(0, 4));
}

export function buildDialogueReviewQueue(ingestResult, {
  aliases = BOOK_ONE_PROFILE.aliases,
  minAutoBindConfidence = 0.75,
  contextChars = 220
} = {}) {
  const rows = analysisRows(ingestResult);
  const queue = [];
  let autoBindable = 0;
  let unresolved = 0;
  let inferredReview = 0;

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (row.segment.kind !== 'dialogue' || chapterRole(row.chapter) !== 'narrative') continue;
    const candidate = row.segment.speakerCandidate;
    const canonical = canonicalizeSpeakerCandidate(candidate?.name, { aliases });
    const confidence = Number(candidate?.confidence ?? 0);
    if (canonical && confidence >= minAutoBindConfidence) {
      autoBindable += 1;
      continue;
    }
    const status = canonical ? 'inferred-review' : 'unresolved';
    if (status === 'unresolved') unresolved += 1;
    else inferredReview += 1;
    const suggestions = nearbySpeakerSuggestions(rows, i, aliases);
    const before = rows[i - 1] && rows[i - 1].chapter.order === row.chapter.order && rows[i - 1].scene.order === row.scene.order
      ? excerpt(rows[i - 1].segment.text, contextChars) : '';
    const after = rows[i + 1] && rows[i + 1].chapter.order === row.chapter.order && rows[i + 1].scene.order === row.scene.order
      ? excerpt(rows[i + 1].segment.text, contextChars) : '';
    const position = `${row.chapter.order}:${row.scene.order}:${row.segment.order}`;
    queue.push(freeze({
      reviewKey: sha256(`${ingestResult.analysis.source.sourceHash}:${position}`).slice(0, 16),
      status,
      priority: status === 'inferred-review' ? 'quick-confirm' : suggestions.length === 1 ? 'single-nearby-speaker' : suggestions.length > 1 ? 'context-review' : 'manual-identify',
      chapterOrder: row.chapter.order,
      chapterTitle: row.chapter.title,
      sceneOrder: row.scene.order,
      segmentOrder: row.segment.order,
      segmentId: row.record?.id ?? null,
      dialogue: clean(row.segment.text),
      contextBefore: before,
      contextAfter: after,
      currentCandidate: canonical,
      currentConfidence: canonical ? round(confidence, 3) : null,
      currentEvidence: candidate?.evidence ?? null,
      suggestedSpeakers: suggestions,
      selectedSpeaker: '',
      decision: '',
      notes: ''
    }));
  }
  queue.sort((a, b) => {
    const rank = { 'quick-confirm': 0, 'single-nearby-speaker': 1, 'context-review': 2, 'manual-identify': 3 };
    return rank[a.priority] - rank[b.priority] || a.chapterOrder - b.chapterOrder || a.sceneOrder - b.sceneOrder || a.segmentOrder - b.segmentOrder;
  });
  const priorityCounts = { quickConfirm: 0, singleNearbySpeaker: 0, contextReview: 0, manualIdentify: 0 };
  for (const item of queue) {
    if (item.priority === 'quick-confirm') priorityCounts.quickConfirm += 1;
    else if (item.priority === 'single-nearby-speaker') priorityCounts.singleNearbySpeaker += 1;
    else if (item.priority === 'context-review') priorityCounts.contextReview += 1;
    else if (item.priority === 'manual-identify') priorityCounts.manualIdentify += 1;
  }
  return freeze({
    totalDialogueSegments: autoBindable + queue.length,
    autoBindable,
    needsReview: queue.length,
    inferredReview,
    unresolved,
    priorityCounts: freeze(priorityCounts),
    queue: freeze(queue)
  });
}

function addPronunciationCandidate(map, term, data = {}) {
  const value = clean(term);
  if (!value || value.length < 2 || value.length > 80) return;
  const key = value.toLowerCase();
  const prior = map.get(key);
  if (prior) {
    prior.occurrences += Number(data.occurrences ?? 1);
    prior.sources.add(data.source ?? 'detected');
    prior.priority = Math.min(prior.priority, Number(data.priority ?? 3));
    return;
  }
  map.set(key, {
    term: value,
    category: data.category ?? 'proper-noun',
    occurrences: Number(data.occurrences ?? 1),
    priority: Number(data.priority ?? 3),
    sources: new Set([data.source ?? 'detected']),
    spokenAs: '', status: 'needs-confirmation', notes: ''
  });
}

function properNounCandidates(text) {
  const candidates = [];
  const rx = /\b([A-Z][\p{L}’'\-]+(?:\s+(?:(?:de|del|la|las|los|of|the|and|y)\s+)?[A-Z][\p{L}’'\-]+){0,3})\b/gu;
  for (const match of String(text ?? '').matchAll(rx)) {
    const term = clean(match[1]);
    if (!term || GENERIC_PROPER_NOUNS.has(term)) continue;
    const before = String(text ?? '').slice(0, match.index ?? 0);
    const atSentenceStart = !before.trim() || /[.!?…]["'’”)]*\s*$/.test(before) || /\n\s*$/.test(before);
    candidates.push({ term, atSentenceStart });
  }
  return candidates;
}

function normalizePossessive(term) {
  return clean(term).replace(/[’']s$/i, '');
}

function looksLikeContraction(term) {
  return /^(?:I|We|You|They|He|She|It|That|There|What|Who|Where|When|Why|How)[’'][A-Za-z]+$/i.test(clean(term));
}

function consistsOnlyOfKnownCharacterNames(term, characterTerms) {
  const pieces = clean(term).split(/\s+(?:and|&|y)\s+/i).map(normalizePossessive).filter(Boolean);
  return pieces.length > 0 && pieces.every((piece) => characterTerms.has(piece.toLowerCase()));
}

export function buildPronunciationReview(ingestResult, characterPlan, { maxDetectedTerms = 32 } = {}) {
  const map = new Map();
  addPronunciationCandidate(map, ingestResult.analysis.metadata?.title, { category: 'book-title', source: 'metadata', priority: 1, occurrences: 1 });
  addPronunciationCandidate(map, ingestResult.analysis.metadata?.author, { category: 'author-byline', source: 'metadata', priority: 2, occurrences: 1 });
  for (const character of characterPlan) {
    if (character.role === 'narrator') continue;
    addPronunciationCandidate(map, character.canonicalName, {
      category: 'character-name', source: 'audio-bible-roster', priority: character.role === 'primary' ? 1 : character.role === 'supporting' ? 2 : 3,
      occurrences: Math.max(1, Number(character.mentions ?? 1))
    });
  }

  const bodyCounts = new Map();
  for (const chapter of ingestResult.analysis.chapters) {
    if (chapterRole(chapter) !== 'narrative') continue;
    for (const scene of chapter.scenes) {
      for (const segment of scene.segments) {
        for (const item of properNounCandidates(segment.text)) {
          if (item.atSentenceStart && !item.term.includes(' ')) continue;
          const key = item.term.toLowerCase();
          bodyCounts.set(key, { term: item.term, count: (bodyCounts.get(key)?.count ?? 0) + 1 });
        }
      }
    }
  }
  const characterTerms = new Set(characterPlan.flatMap((x) => [x.canonicalName, ...(x.aliases ?? [])]).map((x) => x.toLowerCase()));
  const cleanedBodyCounts = new Map();
  for (const item of bodyCounts.values()) {
    if (looksLikeContraction(item.term)) continue;
    const normalized = normalizePossessive(item.term);
    if (!normalized || GENERIC_PROPER_NOUNS.has(normalized)) continue;
    const firstWord = normalizePossessive(normalized.split(/\s+/)[0]).toLowerCase();
    if (NOISY_PHRASE_PREFIXES.has(firstWord)) continue;
    if (EMPHATIC_ALL_CAPS.has(normalized)) continue;
    if (characterTerms.has(normalized.toLowerCase())) continue;
    if (normalized.includes(' ') && characterTerms.has(firstWord)) continue;
    if (consistsOnlyOfKnownCharacterNames(normalized, characterTerms)) continue;
    const key = normalized.toLowerCase();
    const prior = cleanedBodyCounts.get(key) ?? { term: normalized, count: 0 };
    prior.count += item.count;
    cleanedBodyCounts.set(key, prior);
  }
  let detected = [...cleanedBodyCounts.values()]
    .filter((x) => {
      const acronym = /^[A-Z][A-Z0-9.&-]{1,4}$/.test(x.term) && !EMPHATIC_ALL_CAPS.has(x.term);
      const multiword = x.term.includes(' ');
      return acronym || multiword || x.count >= 4;
    })
    .sort((a, b) => b.count - a.count || a.term.localeCompare(b.term));
  const multiwords = detected.filter((x) => x.term.includes(' '));
  detected = detected.filter((x) => x.term.includes(' ') || !multiwords.some((m) => m.count >= x.count && m.term.toLowerCase().split(/\s+/).includes(x.term.toLowerCase())));
  detected = detected.slice(0, maxDetectedTerms);
  for (const item of detected) {
    addPronunciationCandidate(map, item.term, { category: 'proper-noun', source: 'manuscript', priority: item.count >= 5 ? 2 : 3, occurrences: item.count });
  }

  const candidates = [...map.values()].map((item) => freeze({
    term: item.term, category: item.category, occurrences: item.occurrences,
    priority: item.priority, sources: freeze([...item.sources]), spokenAs: '', status: item.status, notes: ''
  })).sort((a, b) => a.priority - b.priority || b.occurrences - a.occurrences || a.term.localeCompare(b.term));
  return freeze({ candidateCount: candidates.length, confirmedCount: 0, needsConfirmation: candidates.length, candidates: freeze(candidates) });
}

export function renderCharacterPlanCsv(rows) {
  const header = ['canonical_name', 'role', 'mentions', 'average_confidence', 'aliases', 'series_character_key', 'casting_status', 'notes'];
  const lines = [header.map(csvCell).join(',')];
  for (const row of rows) lines.push([
    row.canonicalName, row.role, row.mentions, row.averageConfidence, row.aliases, row.seriesCharacterKey, row.castingStatus, ''
  ].map(csvCell).join(','));
  return `${lines.join('\n')}\n`;
}

export function renderDialogueReviewCsv(review) {
  const header = ['review_key', 'priority', 'status', 'chapter', 'scene', 'segment', 'dialogue', 'context_before', 'context_after', 'current_candidate', 'current_confidence', 'current_evidence', 'suggested_speakers', 'selected_speaker', 'decision', 'notes'];
  const lines = [header.map(csvCell).join(',')];
  for (const row of review.queue) lines.push([
    row.reviewKey, row.priority, row.status, row.chapterTitle, row.sceneOrder + 1, row.segmentOrder + 1,
    row.dialogue, row.contextBefore, row.contextAfter, row.currentCandidate ?? '', row.currentConfidence ?? '', row.currentEvidence ?? '',
    row.suggestedSpeakers.map((x) => `${x.name} (${x.score})`), row.selectedSpeaker, row.decision, row.notes
  ].map(csvCell).join(','));
  return `${lines.join('\n')}\n`;
}

export function renderPronunciationReviewCsv(review) {
  const header = ['term', 'category', 'occurrences', 'priority', 'sources', 'spoken_as', 'status', 'notes'];
  const lines = [header.map(csvCell).join(',')];
  for (const row of review.candidates) lines.push([
    row.term, row.category, row.occurrences, row.priority, row.sources, row.spokenAs, row.status, row.notes
  ].map(csvCell).join(','));
  return `${lines.join('\n')}\n`;
}

export function renderAudioBiblePrepMarkdown(prep) {
  const lines = [
    '# Book One Audio Bible Prep', '',
    `**Release:** ${prep.release}`,
    `**Status:** ${prep.status}`,
    `**Book:** ${prep.book.title}`,
    `**Author:** ${prep.book.author ?? 'Not supplied'}`, '',
    '## What YasReady prepared', '',
    `- ${prep.characterPlan.length} Audio Bible roles including Narrator`,
    `- ${prep.dialogueReview.autoBound.toLocaleString()} high-confidence dialogue line(s) auto-bound to canonical speakers`,
    `- ${prep.dialogueReview.needsReview.toLocaleString()} targeted dialogue line(s) placed in the review CSV`,
    `- ${prep.dialogueReview.priorityCounts.quickConfirm.toLocaleString()} quick-confirm line(s)`,
    `- ${prep.dialogueReview.priorityCounts.singleNearbySpeaker.toLocaleString()} unresolved line(s) with one nearby speaker suggestion`,
    `- ${prep.dialogueReview.priorityCounts.contextReview.toLocaleString()} context-review line(s) with multiple nearby speakers`,
    `- ${prep.dialogueReview.priorityCounts.manualIdentify.toLocaleString()} line(s) needing manual speaker identification`,
    `- ${prep.pronunciationReview.candidateCount.toLocaleString()} conservative pronunciation candidate(s) awaiting author confirmation`, '',
    '## Character plan', '',
    '| Character | Role | Mentions | Aliases |', '| --- | --- | ---: | --- |'
  ];
  for (const row of prep.characterPlan) {
    lines.push(`| ${row.canonicalName.replace(/\|/g, '\\|')} | ${row.role} | ${row.mentions} | ${(row.aliases ?? []).join(', ').replace(/\|/g, '\\|')} |`);
  }
  lines.push('', '## Review workflow', '',
    '1. Open `dialogue-review.csv`. Work top-to-bottom: quick confirmations are first, then context reviews, then manual identification.',
    '2. Fill `selected_speaker`, set `decision` to `approved` or `corrected`, and add notes only when useful.',
    '3. Open `pronunciation-review.csv`. Fill `spoken_as` only for terms whose pronunciation should be explicitly controlled.',
    '4. Keep these files outside GitHub. They contain manuscript excerpts and author production decisions.', '',
    '## Gates', '',
    `- Superman manuscript gate: ${prep.gates.supermanPass ? 'PASS' : 'NOT READY'}`,
    `- Canonical roster prepared: ${prep.gates.rosterPrepared ? 'YES' : 'NO'}`,
    `- Primary-role casting may begin: ${prep.gates.primaryCastingCanBegin ? 'YES' : 'NO'}`,
    `- Production-ready Audio Bible: ${prep.gates.productionReady ? 'YES' : 'NO — finish targeted dialogue/pronunciation review first'}`, '',
    '## Next action', '', prep.nextAction, '',
    '> This prep run performs zero provider calls and never arms paid generation.', ''
  );
  return lines.join('\n');
}
