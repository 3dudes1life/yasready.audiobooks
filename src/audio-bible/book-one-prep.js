import { sha256 } from '../core/hash.js';
import { BOOK_ONE_PROFILE, canonicalizeSpeakerCandidate } from '../superman/book-one-superman.js';
import { addressedCanonicalName, buildDialogueIntelligence, intelligenceResolutionFor } from './book-one-intelligence.js';

const freeze = (value) => Object.freeze(value);
const PRIMARY = new Set(['Michael Rawlins', 'Juan Delgado', 'Christopher Lancaster']);
const SCENE_LOCAL_SOURCE_NAMES = new Set(['Derek']);
const DISCOURSE_PREFIX = /^(?:then|but|and|so|meanwhile|suddenly)\s+/i;
const NOISY_PHRASE_PREFIXES = new Set(['and', 'as', 'because', 'but', 'by', 'figured', 'maybe', 'on', 'said', 'so', 'then', 'well']);
const EMPHATIC_ALL_CAPS = new Set(['LOVE', 'RIGHT', 'OHHH', 'GURL']);
const BOOK_ONE_PRONUNCIATION_WATCHLIST = new Set([
  'Hillcrest', 'Clairemont', 'La Mesa', 'Mira Mesa', 'Mission Boulevard',
  'DJ', 'DJing', 'IG', 'SF', 'LMAO', 'LOL', 'DM', 'NYE', 'VIP', 'ABE', 'AF', 'CS', 'DILF', 'DIY', 'Te amo'
]);
const BOOK_ONE_PRONUNCIATION_NOISE = new Set([
  'San Diego', 'Cowboy', 'Navy', 'Oklahoma', 'Airbnb', 'TV', 'Bay Area', 'Mission Beach',
  'Rich', 'Hong Kong', 'California', 'Instagram', 'Let', 'Pacific', 'San Francisco',
  'Bluetooth', 'Cody', 'Florida', 'Southern California', 'Happy Birthday'
]);
const BOOK_ONE_PRONUNCIATION_DEFAULTS = new Map([
  ['d.c.w.', { spokenAs: 'D C W', language: 'en', caseSensitive: true, resolutionMode: 'initials-letter-by-letter', notes: 'Author initials read letter by letter.' }],
  ['te amo', { spokenAs: 'Te amo', language: 'es', caseSensitive: false, resolutionMode: 'language-locale', notes: 'Spanish language switch retained with Spanish locale metadata.' }],
  ['dj', { spokenAs: 'D J', language: 'en', caseSensitive: true, resolutionMode: 'initialism-letter-by-letter' }],
  ['djing', { spokenAs: 'dee jaying', language: 'en', caseSensitive: true, resolutionMode: 'acronym-derived-word', category: 'acronym-derived' }],
  ['sf', { spokenAs: 'S F', language: 'en', caseSensitive: true, resolutionMode: 'initialism-letter-by-letter' }],
  ['lmao', { spokenAs: 'L M A O', language: 'en', caseSensitive: true, resolutionMode: 'message-initialism-letter-by-letter', notes: 'Text-message initialism defaults to letter-by-letter; author override remains available.' }],
  ['ig', { spokenAs: 'I G', language: 'en', caseSensitive: true, resolutionMode: 'initialism-letter-by-letter' }],
  ['lol', { spokenAs: 'L O L', language: 'en', caseSensitive: true, resolutionMode: 'message-initialism-letter-by-letter', notes: 'Text-message initialism defaults to letter-by-letter; author override remains available.' }],
  ['dm', { spokenAs: 'D M', language: 'en', caseSensitive: true, resolutionMode: 'initialism-letter-by-letter' }],
  ['nye', { spokenAs: 'N Y E', language: 'en', caseSensitive: true, resolutionMode: 'initialism-letter-by-letter' }],
  ['vip', { spokenAs: 'V I P', language: 'en', caseSensitive: true, resolutionMode: 'initialism-letter-by-letter' }],
  ['abe', { spokenAs: 'A B E', language: 'en', caseSensitive: true, resolutionMode: 'military-rating-initialism' }],
  ['af', { spokenAs: 'A F', language: 'en', caseSensitive: true, resolutionMode: 'slang-initialism-letter-by-letter' }],
  ['cs', { spokenAs: 'C S', language: 'en', caseSensitive: true, resolutionMode: 'military-rating-initialism' }],
  ['dilf', { spokenAs: 'dilf', language: 'en', caseSensitive: true, resolutionMode: 'lexicalized-acronym', notes: 'Spoken as the common lexicalized word rather than letter-by-letter.' }],
  ['diy', { spokenAs: 'D I Y', language: 'en', caseSensitive: true, resolutionMode: 'initialism-letter-by-letter' }]
]);
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

export function buildBookOneCharacterPlan(supermanReport, { includeNarrator = true, provisionalRoles = [], spokenCharacterNames = null } = {}) {
  const candidates = supermanReport?.characterDiscovery?.candidates ?? [];
  const rows = [];
  if (includeNarrator) {
    rows.push(freeze({
      canonicalName: 'Narrator', aliases: freeze([]), role: 'narrator', mentions: 0,
      averageConfidence: 1, castingPriority: 0, seriesCharacterKey: 'narrator',
      castingStatus: 'unassigned', source: 'required-narration-role', continuityScope: 'book'
    }));
  }
  const spoken = spokenCharacterNames ? new Set([...spokenCharacterNames].map((name) => clean(name))) : null;
  for (const candidate of candidates) {
    if (SCENE_LOCAL_SOURCE_NAMES.has(candidate.name)) continue;
    // One capitalized mention is not enough to become a permanent audiobook character.
    // Keep it only when the dialogue resolver found real spoken evidence. This preserves true
    // one-line roles (e.g. a named neighbor) while rejecting title/artist/name noise.
    if (!PRIMARY.has(candidate.name) && Number(candidate.mentions) <= 1 && spoken && !spoken.has(candidate.name)) continue;
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
      source: 'book-one-superman',
      provisional: false,
      continuityScope: 'book'
    }));
  }
  const existing = new Set(rows.map((row) => row.canonicalName.toLowerCase()));
  for (const provisional of provisionalRoles ?? []) {
    if (!provisional?.canonicalName || existing.has(provisional.canonicalName.toLowerCase())) continue;
    rows.push(freeze({
      canonicalName: provisional.canonicalName,
      aliases: freeze([...(provisional.aliases ?? [])]),
      role: provisional.role ?? 'minor',
      mentions: provisional.mentions ?? 0,
      averageConfidence: provisional.averageConfidence ?? 0.92,
      highConfidenceMentions: provisional.highConfidenceMentions ?? provisional.mentions ?? 0,
      inferredReviewMentions: provisional.inferredReviewMentions ?? 0,
      castingPriority: provisional.castingPriority ?? 3,
      seriesCharacterKey: provisional.seriesCharacterKey === undefined ? slug(provisional.canonicalName) : provisional.seriesCharacterKey,
      castingStatus: provisional.castingStatus ?? 'provisional',
      source: provisional.source ?? 'book-one-intelligence',
      provisional: true,
      continuityScope: provisional.continuityScope ?? (provisional.source === 'book-one-intelligence-contextual-role' ? 'scene' : 'book')
    }));
    existing.add(provisional.canonicalName.toLowerCase());
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

function nearbySpeakerSuggestions(rows, currentIndex, aliases, radius = 5, intelligence = null) {
  const current = rows[currentIndex];
  const suggestions = new Map();
  for (let offset = 1; offset <= radius; offset += 1) {
    for (const index of [currentIndex - offset, currentIndex + offset]) {
      const row = rows[index];
      if (!row || row.chapter.order !== current.chapter.order || row.scene.order !== current.scene.order || row.segment.kind !== 'dialogue') continue;
      const segmentId = row.record?.id ?? `${row.chapter.order}:${row.scene.order}:${row.segment.order}`;
      const resolved = intelligenceResolutionFor(intelligence, segmentId);
      const candidate = row.segment.speakerCandidate;
      const canonical = resolved?.speaker && resolved.speaker !== 'Narrator'
        ? resolved.speaker
        : canonicalizeSpeakerCandidate(candidate?.name, { aliases });
      if (!canonical || canonical === 'Narrator') continue;
      const confidence = Number(resolved?.confidence ?? candidate?.confidence ?? 0.5);
      const prior = suggestions.get(canonical) ?? { name: canonical, score: 0, nearestDistance: offset, evidence: new Set() };
      prior.score += Math.max(1, (radius + 1) - offset) * Math.max(0.2, confidence);
      prior.nearestDistance = Math.min(prior.nearestDistance, offset);
      if (resolved?.evidence) prior.evidence.add(resolved.evidence);
      else if (candidate?.evidence) prior.evidence.add(candidate.evidence);
      suggestions.set(canonical, prior);
    }
  }
  return freeze([...suggestions.values()]
    .map((x) => freeze({ name: x.name, score: round(x.score, 2), nearestDistance: x.nearestDistance, evidence: freeze([...x.evidence]) }))
    .sort((a, b) => b.score - a.score || a.nearestDistance - b.nearestDistance || a.name.localeCompare(b.name))
    .slice(0, 4));
}

function safeReviewPriority({ status, canonical, confidence, dialogue, evidence, suggestions, aliases }) {
  if (status === 'unresolved') {
    return suggestions.length === 1 ? 'single-nearby-speaker' : suggestions.length > 1 ? 'context-review' : 'manual-identify';
  }
  const addressed = addressedCanonicalName(dialogue, aliases);
  if (addressed && addressed === canonical) return 'context-review';
  const top = suggestions[0] ?? null;
  const current = suggestions.find((x) => x.name === canonical) ?? null;
  const runnerUp = suggestions.find((x) => x.name !== canonical) ?? null;
  const evidenceText = String(evidence ?? '');
  if (/context-alternating-pair/i.test(evidenceText)) return 'context-review';
  const evidenceSupportsContinuation = /context-continuation|dialogue-tag|speaker-before-dialogue|preceding-speaker-lead|pronoun-|two-speaker-/i.test(evidenceText);
  if (!top) return confidence >= 0.72 && evidenceSupportsContinuation ? 'quick-confirm' : 'context-review';
  if (top.name !== canonical) return 'context-review';
  if (runnerUp && top.score < runnerUp.score * 1.15) return 'context-review';
  if (!current) return 'context-review';
  return 'quick-confirm';
}

function incrementAppliedIntelligence(counts, resolution) {
  if (!resolution) return;
  const evidence = String(resolution.evidence ?? '');
  if (resolution.speaker === 'Narrator') counts.narratorRouted += 1;
  if (/self-identification/.test(evidence)) counts.selfIdentified += 1;
  else if (/direct-address|vocative-exclusion/.test(evidence)) counts.directAddress += 1;
  else if (/contextual-anonymous-role/.test(evidence)) counts.contextualRole += 1;
  else if (/relational-role/.test(evidence)) counts.relationalRole += 1;
  else if (/pronoun-after-tag/.test(evidence)) counts.pronounAfterTag += 1;
  else if (/pronoun-/.test(evidence)) counts.pronounContext += 1;
  else if (/two-speaker-reaction/.test(evidence)) counts.reactionExclusion += 1;
  else if (/two-speaker-/.test(evidence)) counts.twoSpeakerTurn += 1;
  else if (/same-paragraph|residual-|anonymous-speaker-backfilled/.test(evidence)) counts.residualContext += 1;
  else if (/speaker-lead|speech-tag/.test(evidence)) counts.explicitContext += 1;
}

export function buildDialogueReviewQueue(ingestResult, {
  aliases = BOOK_ONE_PROFILE.aliases,
  minAutoBindConfidence = 0.75,
  intelligence = null,
  contextChars = 220
} = {}) {
  const rows = analysisRows(ingestResult);
  const smart = intelligence ?? buildDialogueIntelligence(ingestResult, { aliases });
  const queue = [];
  const autoBindings = [];
  const sceneLocalBindings = [];
  const collectiveBindings = [];
  let autoBindable = 0;
  let unresolved = 0;
  let inferredReview = 0;
  let reviewCandidatesBeforeIntelligence = 0;
  let intelligenceResolved = 0;
  let quotedNarration = 0;
  let correctedSafeBindings = 0;
  const appliedIntelligence = {
    narratorRouted: 0, selfIdentified: 0, explicitContext: 0, pronounContext: 0, pronounAfterTag: 0,
    directAddress: 0, relationalRole: 0, contextualRole: 0, twoSpeakerTurn: 0, reactionExclusion: 0,
    residualContext: 0, collectiveDialogue: 0
  };

  const sceneLocalNames = new Set((smart.sceneLocalRoles ?? []).map((x) => x.canonicalName));
  const recordResolution = (row, resolution, { originalSafe = false } = {}) => {
    if (originalSafe) correctedSafeBindings += 1;
    else {
      reviewCandidatesBeforeIntelligence += 1;
      intelligenceResolved += 1;
    }
    if (resolution.speaker === 'Narrator') quotedNarration += 1;
    incrementAppliedIntelligence(appliedIntelligence, resolution);
    if (resolution.speakers?.length) {
      collectiveBindings.push(freeze({
        segmentId: row.record?.id ?? null, speakers: freeze([...resolution.speakers]),
        confidence: round(resolution.confidence, 3), evidence: resolution.evidence,
        classification: resolution.classification ?? 'collective-dialogue', source: 'book-one-intelligence'
      }));
      appliedIntelligence.collectiveDialogue += 1;
      return;
    }
    const binding = freeze({
      segmentId: row.record?.id ?? null, speaker: resolution.speaker,
      confidence: round(resolution.confidence, 3), evidence: resolution.evidence,
      classification: resolution.classification ?? 'spoken-dialogue', source: 'book-one-intelligence'
    });
    if (resolution.continuityScope === 'scene' || sceneLocalNames.has(resolution.speaker)) sceneLocalBindings.push(binding);
    else { autoBindable += 1; autoBindings.push(binding); }
  };

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (row.segment.kind !== 'dialogue' || chapterRole(row.chapter) !== 'narrative') continue;
    const candidate = row.segment.speakerCandidate;
    const canonical = canonicalizeSpeakerCandidate(candidate?.name, { aliases });
    const confidence = Number(candidate?.confidence ?? 0);
    const segmentId = row.record?.id ?? `${row.chapter.order}:${row.scene.order}:${row.segment.order}`;
    const resolution = intelligenceResolutionFor(smart, segmentId);
    const originalSafe = Boolean(canonical && confidence >= minAutoBindConfidence);
    const contradictionOverride = resolution?.authority === 'contradiction-override'
      && (!canonical || canonical === resolution.addressed || confidence < minAutoBindConfidence);
    const authoritative = Boolean(resolution && Number(resolution.confidence) >= 0.85
      && (resolution.authority === 'override' || resolution.authority === 'truth-override' || contradictionOverride));

    if (authoritative) {
      recordResolution(row, resolution, { originalSafe });
      continue;
    }

    if (originalSafe) {
      autoBindable += 1;
      autoBindings.push(freeze({
        segmentId: row.record?.id ?? null,
        speaker: canonical,
        confidence: round(confidence, 3),
        evidence: candidate?.evidence ?? 'book-one-superman',
        classification: 'spoken-dialogue',
        source: 'book-one-superman'
      }));
      continue;
    }

    reviewCandidatesBeforeIntelligence += 1;
    if (resolution && Number(resolution.confidence) >= 0.85) {
      reviewCandidatesBeforeIntelligence -= 1; // recordResolution owns this accounting
      recordResolution(row, resolution);
      continue;
    }

    const status = canonical ? 'inferred-review' : 'unresolved';
    if (status === 'unresolved') unresolved += 1;
    else inferredReview += 1;
    const suggestions = nearbySpeakerSuggestions(rows, i, aliases, 5, smart);
    const before = rows[i - 1] && rows[i - 1].chapter.order === row.chapter.order && rows[i - 1].scene.order === row.scene.order
      ? excerpt(rows[i - 1].segment.text, contextChars) : '';
    const after = rows[i + 1] && rows[i + 1].chapter.order === row.chapter.order && rows[i + 1].scene.order === row.scene.order
      ? excerpt(rows[i + 1].segment.text, contextChars) : '';
    const position = `${row.chapter.order}:${row.scene.order}:${row.segment.order}`;
    const priority = safeReviewPriority({
      status, canonical, confidence, dialogue: row.segment.text, evidence: candidate?.evidence, suggestions, aliases
    });
    queue.push(freeze({
      reviewKey: sha256(`${ingestResult.analysis.source.sourceHash}:${position}`).slice(0, 16),
      status,
      priority,
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
    totalDialogueSegments: autoBindable + sceneLocalBindings.length + collectiveBindings.length + queue.length,
    spokenDialogueSegments: autoBindable + sceneLocalBindings.length + collectiveBindings.length + queue.length - quotedNarration,
    quotedNarrationSegments: quotedNarration,
    autoBindable,
    intelligenceResolved,
    correctedSafeBindings,
    reviewCandidatesBeforeIntelligence,
    reviewReduction: Math.max(0, reviewCandidatesBeforeIntelligence - queue.length),
    needsReview: queue.length,
    inferredReview,
    unresolved,
    priorityCounts: freeze(priorityCounts),
    intelligenceDetected: freeze({ ...smart.counts, provisionalRoleCount: smart.provisionalRoles.length, sceneLocalRoleCount: (smart.sceneLocalRoles ?? []).length }),
    intelligenceApplied: freeze({ ...appliedIntelligence, provisionalRoleCount: smart.provisionalRoles.length, sceneLocalRoleCount: (smart.sceneLocalRoles ?? []).length }),
    autoBindings: freeze(autoBindings),
    sceneLocalBindings: freeze(sceneLocalBindings),
    collectiveBindings: freeze(collectiveBindings),
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

export function buildPronunciationReview(ingestResult, characterPlan, { maxDetectedTerms = 24 } = {}) {
  const map = new Map();
  const title = ingestResult.analysis.metadata?.title;
  const author = ingestResult.analysis.metadata?.author;
  addPronunciationCandidate(map, title, { category: 'book-title', source: 'metadata', priority: 1, occurrences: 1 });
  addPronunciationCandidate(map, author, { category: 'author-byline', source: 'metadata', priority: 1, occurrences: 1 });

  for (const character of characterPlan) {
    if (character.role === 'narrator' || character.provisional) continue;
    addPronunciationCandidate(map, character.canonicalName, {
      category: 'character-name', source: 'audio-bible-roster', priority: character.role === 'primary' ? 1 : character.role === 'supporting' ? 2 : 3,
      occurrences: Math.max(1, Number(character.mentions ?? 1))
    });
  }

  const bodyCounts = new Map();
  let teAmoCount = 0;
  for (const chapter of ingestResult.analysis.chapters) {
    if (chapterRole(chapter) !== 'narrative') continue;
    for (const scene of chapter.scenes) {
      for (const segment of scene.segments) {
        const text = String(segment.text ?? '');
        teAmoCount += (text.match(/\bTe amo\b/gi) ?? []).length;
        for (const item of properNounCandidates(text)) {
          if (item.atSentenceStart && !item.term.includes(' ')) continue;
          const key = item.term.toLowerCase();
          bodyCounts.set(key, { term: item.term, count: (bodyCounts.get(key)?.count ?? 0) + 1 });
        }
      }
    }
  }
  if (teAmoCount) addPronunciationCandidate(map, 'Te amo', { category: 'language-switch', source: 'manuscript', priority: 1, occurrences: teAmoCount });

  const characterTerms = new Set(characterPlan.flatMap((x) => [x.canonicalName, ...(x.aliases ?? [])]).map((x) => x.toLowerCase()));
  let detected = [];
  for (const item of bodyCounts.values()) {
    if (looksLikeContraction(item.term)) continue;
    const normalized = normalizePossessive(item.term);
    if (!normalized || GENERIC_PROPER_NOUNS.has(normalized) || BOOK_ONE_PRONUNCIATION_NOISE.has(normalized)) continue;
    const firstWord = normalizePossessive(normalized.split(/\s+/)[0]).toLowerCase();
    if (NOISY_PHRASE_PREFIXES.has(firstWord) || EMPHATIC_ALL_CAPS.has(normalized)) continue;
    if (characterTerms.has(normalized.toLowerCase())) continue;
    if (normalized.includes(' ') && characterTerms.has(firstWord)) continue;
    if (consistsOnlyOfKnownCharacterNames(normalized, characterTerms)) continue;
    const acronym = /^[A-Z][A-Z0-9.&-]{1,5}$/.test(normalized) && !EMPHATIC_ALL_CAPS.has(normalized);
    const explicitWatch = BOOK_ONE_PRONUNCIATION_WATCHLIST.has(normalized);
    if (!explicitWatch) continue;
    detected.push({ term: normalized, count: item.count, acronym, explicitWatch });
  }
  detected = detected
    .sort((a, b) => b.count - a.count || a.term.localeCompare(b.term))
    .slice(0, maxDetectedTerms);
  for (const item of detected) {
    const defaultPolicy = BOOK_ONE_PRONUNCIATION_DEFAULTS.get(item.term.toLowerCase());
    addPronunciationCandidate(map, item.term, {
      category: defaultPolicy?.category ?? (item.acronym ? 'acronym-or-initialism' : 'place-or-proper-name'),
      source: 'manuscript', priority: item.count >= 5 ? 2 : 3, occurrences: item.count
    });
  }

  const candidates = [...map.values()].map((item) => {
    const policy = BOOK_ONE_PRONUNCIATION_DEFAULTS.get(item.term.toLowerCase()) ?? null;
    if (policy) {
      return freeze({
        term: item.term,
        category: policy.category ?? item.category,
        occurrences: item.occurrences,
        priority: item.priority,
        sources: freeze([...item.sources]),
        spokenAs: policy.spokenAs,
        status: 'auto-resolved',
        notes: policy.notes ?? 'Deterministic YasReady production pronunciation default.',
        resolutionMode: policy.resolutionMode,
        ruleRequired: true,
        language: policy.language ?? 'en',
        caseSensitive: Boolean(policy.caseSensitive),
        blocking: false
      });
    }
    return freeze({
      term: item.term,
      category: item.category,
      occurrences: item.occurrences,
      priority: item.priority,
      sources: freeze([...item.sources]),
      spokenAs: '',
      status: 'standard-reading',
      notes: 'Standard orthographic reading; no explicit pronunciation override is required.',
      resolutionMode: 'standard-orthography',
      ruleRequired: false,
      language: 'en',
      caseSensitive: false,
      blocking: false
    });
  }).sort((a, b) => a.priority - b.priority || b.occurrences - a.occurrences || a.term.localeCompare(b.term));

  const explicitRuleCount = candidates.filter((item) => item.ruleRequired).length;
  const standardReadingCount = candidates.length - explicitRuleCount;
  return freeze({
    candidateCount: candidates.length,
    resolvedCount: candidates.length,
    autoResolvedCount: candidates.length,
    explicitRuleCount,
    standardReadingCount,
    confirmedCount: 0,
    needsConfirmation: 0,
    blockingCount: 0,
    deterministicDefaultsApplied: explicitRuleCount > 0,
    authorOverrideAvailable: true,
    noUnboundedGuessesMade: true,
    candidates: freeze(candidates)
  });
}

export function renderCharacterPlanCsv(rows) {
  const header = ['canonical_name', 'role', 'mentions', 'average_confidence', 'aliases', 'continuity_scope', 'series_character_key', 'casting_status', 'notes'];
  const lines = [header.map(csvCell).join(',')];
  for (const row of rows) lines.push([
    row.canonicalName, row.role, row.mentions, row.averageConfidence, row.aliases, row.continuityScope ?? 'book', row.seriesCharacterKey ?? '', row.castingStatus, ''
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
  const header = ['term', 'category', 'occurrences', 'priority', 'sources', 'spoken_as', 'status', 'resolution_mode', 'rule_required', 'language', 'blocking', 'notes'];
  const lines = [header.map(csvCell).join(',')];
  for (const row of review.candidates) lines.push([
    row.term, row.category, row.occurrences, row.priority, row.sources, row.spokenAs, row.status,
    row.resolutionMode ?? '', row.ruleRequired ? 'yes' : 'no', row.language ?? '', row.blocking ? 'yes' : 'no', row.notes
  ].map(csvCell).join(','));
  return `${lines.join('\n')}\n`;
}

export function renderAudioBiblePrepMarkdown(prep) {
  const lines = [
    '# Book One Audio Bible Prep', '',
    `**Release:** ${prep.release}`,
    `**Prep Engine:** ${prep.provenance?.prepEngineRelease ?? prep.release}`,
    `**Superman Engine:** ${prep.provenance?.supermanEngineRelease ?? prep.superman?.engineRelease ?? 'unknown'}`,
    `**Status:** ${prep.status}`,
    `**Book:** ${prep.book.title}`,
    `**Author:** ${prep.book.author ?? 'Not supplied'}`, '',
    '## What YasReady prepared', '',
    `- ${prep.characterPlan.length} permanent Audio Bible role(s) including Narrator`,
    `- ${(prep.sceneLocalRoles ?? []).length} scene-local extra role(s) kept outside the permanent Audio Bible`,
    `- ${prep.dialogueReview.safelyResolved.toLocaleString()} dialogue/displayed-text segment(s) safely resolved`,
    `- ${prep.dialogueReview.autoBound.toLocaleString()} permanent-role/Narrator segment(s) bound into the Audio Bible`,
    `- ${(prep.dialogueReview.sceneLocalResolved ?? 0).toLocaleString()} scene-local segment(s) resolved without creating permanent cast entries`,
    `- ${(prep.dialogueReview.collectiveResolved ?? 0).toLocaleString()} collective dialogue segment(s) resolved without forcing a fake single speaker`,
    `- ${prep.intelligence?.reviewReduction?.toLocaleString?.() ?? 0} avoidable review chore(s) removed by ${prep.provenance?.prepEngineRelease ?? prep.release} context-resolver intelligence`,
    `- ${prep.intelligence?.quotedNarrationSegments?.toLocaleString?.() ?? 0} quoted/displayed-text segment(s) routed to Narrator instead of fake speakers`,
    `- ${(prep.intelligence?.provisionalRoles ?? []).length} durable book/series relational role(s) created from explicit context`,
    `- ${prep.dialogueReview.needsReview.toLocaleString()} genuinely ambiguous dialogue line(s) placed in the review CSV`,
    `- ${prep.dialogueReview.priorityCounts.quickConfirm.toLocaleString()} quick-confirm line(s)`,
    `- ${prep.dialogueReview.priorityCounts.singleNearbySpeaker.toLocaleString()} unresolved line(s) with one nearby speaker suggestion`,
    `- ${prep.dialogueReview.priorityCounts.contextReview.toLocaleString()} context-review line(s) with multiple nearby speakers`,
    `- ${prep.dialogueReview.priorityCounts.manualIdentify.toLocaleString()} line(s) needing manual speaker identification`,
    `- ${prep.pronunciationReview.candidateCount.toLocaleString()} pronunciation candidate(s) closed by policy (${prep.pronunciationReview.explicitRuleCount.toLocaleString()} explicit rule(s) + ${prep.pronunciationReview.standardReadingCount.toLocaleString()} standard reading(s))`,
    `- ${prep.pronunciationReview.needsConfirmation.toLocaleString()} pronunciation item(s) still requiring author confirmation`, '',
    '## Character plan', '',
    '| Character | Role | Scope | Mentions | Aliases |', '| --- | --- | --- | ---: | --- |'
  ];
  for (const row of prep.characterPlan) {
    lines.push(`| ${row.canonicalName.replace(/\|/g, '\\|')} | ${row.role} | ${row.continuityScope ?? 'book'} | ${row.mentions} | ${(row.aliases ?? []).join(', ').replace(/\|/g, '\\|')} |`);
  }
  if ((prep.sceneLocalRoles ?? []).length) {
    lines.push('', '## Scene-local extras', '',
      'These roles are usable for the current scene but are deliberately excluded from permanent/series Audio Bible continuity.', '',
      '| Scene role | Chapter | Mentions | Aliases |', '| --- | ---: | ---: | --- |');
    for (const row of prep.sceneLocalRoles) {
      lines.push(`| ${row.canonicalName.replace(/\|/g, '\\|')} | ${row.chapterOrder ?? ''} | ${row.mentions} | ${(row.aliases ?? []).join(', ').replace(/\|/g, '\\|')} |`);
    }
  }

  lines.push('', '## Lock / override workflow', '',
    '1. `dialogue-review.csv` is intentionally header-only when speaker truth is fully closed.',
    '2. `pronunciation-review.csv` records the deterministic production defaults. Override `spoken_as` only if you intentionally want a different reading.',
    '3. Standard-reading rows need no explicit pronunciation rule; explicit-rule rows are already written into the Audio Bible snapshot.',
    '4. Keep these files outside GitHub. They can contain manuscript-derived production decisions.', '',
    '## Gates', '',
    `- Superman manuscript gate: ${prep.gates.supermanPass ? 'PASS' : 'NOT READY'}`,
    `- Canonical roster prepared: ${prep.gates.rosterPrepared ? 'YES' : 'NO'}`,
    `- Primary-role casting may begin: ${prep.gates.primaryCastingCanBegin ? 'YES' : 'NO'}`,
    `- Production-ready Audio Bible: ${prep.gates.productionReady ? 'YES' : 'NO — finish targeted dialogue/pronunciation review first'}`,
    `- Audio Bible locked: ${prep.gates.audioBibleLocked ? 'YES' : 'NO'}`,
    `- Continuity unresolved dialogue: ${prep.continuity.unresolvedDialogueSegments.toLocaleString()}`,
    `- Pronunciation rules persisted: ${prep.continuity.pronunciationRules.toLocaleString()}`, '',
    '## Next action', '', prep.nextAction, '',
    '> This prep run performs zero provider calls and never arms paid generation.', ''
  );
  return lines.join('\n');
}
