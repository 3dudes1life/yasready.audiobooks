import { BOOK_ONE_PROFILE, canonicalizeSpeakerCandidate } from '../superman/book-one-superman.js';

const freeze = (value) => Object.freeze(value);
const SPEECH_VERBS = 'said|asked|replied|answered|whispered|murmured|shouted|yelled|called|added|continued|laughed|snapped|sighed|offered|admitted|insisted|promised|teased|joked|warned|cried|blurted|exclaimed|breathed|mumbled|muttered|shot back|continued';
const LEAD_ACTIONS = `${SPEECH_VERBS}|leaned|turned|paused|nodded|smirked|grinned|exhaled|tossed|looked|glanced|sat|stood|pushed|nudged|elbowed|flopped|checked|stretched|reached|picked|held|gestured|winked|froze|blinked|sighed`;
const PRIMARY = ['Michael Rawlins', 'Juan Delgado', 'Christopher Lancaster'];
const CANONICAL_ALIASES = Object.freeze({
  'Michael Rawlins': ['Michael', 'Rawlins', 'Micheal'],
  'Juan Delgado': ['Juan', 'Delgado'],
  'Christopher Lancaster': ['Christopher', 'Chris', 'Lancaster'],
  Dani: ['Dani'], Evan: ['Evan'], Drew: ['Drew'], Alex: ['Alex'], Nick: ['Nick'], Derek: ['Derek'], Kayla: ['Kayla'], Noah: ['Noah'], Paris: ['Paris']
});

const RELATIONAL_ROLES = Object.freeze([
  Object.freeze({
    canonicalName: "Michael's Mother", role: 'supporting', aliases: ['Michael’s mother', "Michael's mother", 'his mother', 'his mom', 'Mama'],
    seriesCharacterKey: 'michael-mother', chapterMin: 24, chapterMax: 26,
    pattern: /\b(?:his|Michael[’']s)\s+(?:mother|mom)\b|\bMama\b/i
  }),
  Object.freeze({
    canonicalName: "Michael's Brother", role: 'supporting', aliases: ['Michael’s brother', "Michael's brother", 'his brother'],
    seriesCharacterKey: 'michael-brother', chapterMin: 24, chapterMax: 26,
    pattern: /\b(?:his|Michael[’']s)\s+brother\b/i
  }),
  Object.freeze({
    canonicalName: 'Realtor', role: 'minor', aliases: ['the realtor', 'their realtor'],
    seriesCharacterKey: 'realtor', chapterMin: 42, chapterMax: 42,
    pattern: /\b(?:the|their)\s+realtor\b/i
  }),
  Object.freeze({
    canonicalName: 'Landlord', role: 'minor', aliases: ['the landlord', 'their landlord'],
    seriesCharacterKey: 'landlord', chapterMin: 33, chapterMax: 33,
    pattern: /\b(?:the|their)\s+landlord\b/i
  })
]);

function clean(value) { return String(value ?? '').replace(/\s+/g, ' ').trim(); }
function wordCount(value) { return clean(value).split(/\s+/).filter(Boolean).length; }
function canon(name, aliases = BOOK_ONE_PROFILE.aliases) { return canonicalizeSpeakerCandidate(name, { aliases }); }
function sameScene(a, b) { return a && b && a.chapter.order === b.chapter.order && a.scene.order === b.scene.order; }

export function analysisRowsForIntelligence(ingestResult) {
  const output = [];
  let flat = 0;
  for (const chapter of ingestResult.analysis.chapters) {
    for (const scene of chapter.scenes) {
      for (const segment of scene.segments) {
        output.push({ chapter, scene, segment, record: ingestResult.segments?.[flat] ?? null, flatIndex: flat });
        flat += 1;
      }
    }
  }
  return output;
}

function aliasesInText(text) {
  const source = clean(text);
  const hits = [];
  for (const [canonical, aliases] of Object.entries(CANONICAL_ALIASES)) {
    for (const alias of aliases) {
      const rx = new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (rx.test(source)) { hits.push(canonical); break; }
    }
  }
  return [...new Set(hits)];
}

function lastClause(text) {
  const source = clean(text);
  const parts = source.split(/(?<=[.!?])\s+/);
  return parts.at(-1) ?? source;
}

function canonicalLeadSpeaker(before) {
  const clause = lastClause(before);
  const hits = aliasesInText(clause);
  if (!hits.length) return null;
  const action = new RegExp(`\\b(?:${LEAD_ACTIONS})\\b`, 'i').test(clause);
  if (!action) return null;
  // Prefer a named subject appearing before the lead/action verb.
  for (const canonical of hits) {
    const aliases = CANONICAL_ALIASES[canonical] ?? [canonical];
    for (const alias of aliases) {
      const rx = new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b[^.!?]{0,100}\\b(?:${LEAD_ACTIONS})\\b`, 'i');
      if (rx.test(clause)) return canonical;
    }
  }
  return hits.length === 1 ? hits[0] : null;
}

function explicitAfterSpeechSpeaker(after) {
  const clause = clean(after).split(/(?<=[.!?])\s+/)[0] ?? '';
  for (const [canonical, aliases] of Object.entries(CANONICAL_ALIASES)) {
    for (const alias of aliases) {
      const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const rx1 = new RegExp(`^${escaped}\\s+(?:${SPEECH_VERBS})\\b`, 'i');
      const rx2 = new RegExp(`^(?:${SPEECH_VERBS})\\s+${escaped}\\b`, 'i');
      if (rx1.test(clause) || rx2.test(clause)) return canonical;
    }
  }
  return null;
}

function selfIdentifiedSpeaker(dialogue, aliases) {
  const text = clean(dialogue).replace(/[.!?]+$/, '');
  const patterns = [
    /^(?:I[’']m|I am)\s+([A-Z][A-Za-z’'\-]+(?:\s+[A-Z][A-Za-z’'\-]+)?)$/,
    /^(?:My name is|Name[’']s)\s+([A-Z][A-Za-z’'\-]+(?:\s+[A-Z][A-Za-z’'\-]+)?)$/i
  ];
  for (const rx of patterns) {
    const match = rx.exec(text);
    if (!match) continue;
    const canonical = canon(match[1], aliases);
    if (canonical) return canonical;
  }
  return null;
}

function addressedCanonical(dialogue, aliases) {
  const text = clean(dialogue);
  // Direct-address form only: comma/colon + known first name near the end, or opening name + comma.
  const match = /(?:^|[,;:]\s*)(Michael|Juan|Christopher|Chris)\s*[.!?]*$/i.exec(text)
    ?? /^(Michael|Juan|Christopher|Chris)\s*[,;:]/i.exec(text);
  if (!match) return null;
  return canon(match[1], aliases);
}

function relationalRoleFromContext(row, before, after) {
  const chapterNumber = Number(row.chapter.order);
  const combined = `${before} ${after}`;
  for (const role of RELATIONAL_ROLES) {
    if (chapterNumber < role.chapterMin || chapterNumber > role.chapterMax) continue;
    if (role.pattern.test(combined)) return role;
  }
  return null;
}

function relationalSpeechCue(role, before, after) {
  const source = `${before} ${after}`;
  if (!role.pattern.test(source)) return false;
  // Role mention plus a speech/interaction cue around the quote.
  return new RegExp(`\\b(?:${SPEECH_VERBS}|voice|asked|whispered|murmured|added)\\b`, 'i').test(source)
    || /\b(?:looked at|stood beside|came out|stepped between|continued|chuckled)\b/i.test(source);
}

export function classifyQuotedNarration(dialogue, before, after) {
  const text = clean(dialogue);
  const prev = clean(before);
  const next = clean(after);
  const wc = wordCount(text);
  if (!text || wc > 10) return null;
  if (selfIdentifiedSpeaker(text, BOOK_ONE_PROFILE.aliases)) return null;
  if (new RegExp(`^(?:he|she|they|[A-Z][A-Za-z’'\-]+)\\s+(?:${SPEECH_VERBS})\\b`, 'i').test(next)) return null;

  const listOrLabelLead = /(?:subject lines?|emails?|cocktails?|drinks?|names?|words?|phrases?|terms?|called|named|titled|labeled|screamed|felt|being|how)(?:\s+like)?\s*$/i.test(prev)
    || /\b(?:subject lines?|names?|cocktails?|drinks?)\s+(?:such as|like)\s*$/i.test(prev);
  const grammaticalContinuation = /^[a-z][a-z’'\-]*\b/.test(next)
    || /^(?:and|or|had|was|were|is|are|aesthetic|That changed|There were)\b/.test(next);
  const lowerEmphasis = wc <= 4 && text === text.toLowerCase() && !/[.!?]$/.test(text) && Boolean(next);
  const titleLabel = wc <= 6 && /^(?:[A-Z][\w’'&.-]*)(?:\s+[A-Z][\w’'&.-]*)*$/.test(text)
    && (listOrLabelLead || grammaticalContinuation);
  const emailLike = /\b(?:Docs|Timeline|Update|Attached|Approval|Notice|Confirmation)\b/.test(text)
    && /\b(?:email|subject|browser|tabs?|documents?)\b/i.test(prev);

  if (emailLike) return freeze({ classification: 'displayed-text', confidence: 0.99, evidence: 'quoted-display-label' });
  if (listOrLabelLead && (wc <= 8 || grammaticalContinuation)) return freeze({ classification: 'quoted-narration', confidence: 0.98, evidence: 'inline-quoted-label' });
  if ((lowerEmphasis || titleLabel) && grammaticalContinuation) return freeze({ classification: 'quoted-narration', confidence: 0.97, evidence: 'inline-emphasis-not-dialogue' });
  return null;
}

function nearbyCanonicalSpeakers(rows, index, aliases, radius = 5) {
  const current = rows[index];
  const weighted = new Map();
  for (let offset = 1; offset <= radius; offset += 1) {
    for (const j of [index - offset, index + offset]) {
      const row = rows[j];
      if (!sameScene(current, row) || row.segment.kind !== 'dialogue') continue;
      const canonical = canon(row.segment.speakerCandidate?.name, aliases);
      if (!canonical) continue;
      weighted.set(canonical, (weighted.get(canonical) ?? 0) + (radius + 1 - offset) * Math.max(0.2, Number(row.segment.speakerCandidate?.confidence ?? 0.5)));
    }
  }
  return [...weighted.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
}

function directAddressExclusion(dialogue, rows, index, aliases) {
  const addressed = addressedCanonical(dialogue, aliases);
  if (!addressed) return null;
  const nearby = nearbyCanonicalSpeakers(rows, index, aliases).filter((name) => PRIMARY.includes(name));
  const others = nearby.filter((name) => name !== addressed);
  if (others.length === 1) return freeze({ speaker: others[0], confidence: 0.86, evidence: `direct-address-exclusion:${addressed}` });
  return null;
}

export function buildDialogueIntelligence(ingestResult, { aliases = BOOK_ONE_PROFILE.aliases } = {}) {
  const rows = analysisRowsForIntelligence(ingestResult);
  const resolutions = new Map();
  const provisionalMentions = new Map();
  const counts = {
    quotedNarration: 0,
    selfIdentified: 0,
    explicitContext: 0,
    directAddress: 0,
    relationalRole: 0
  };

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (row.segment.kind !== 'dialogue' || String(row.chapter.title).toLowerCase() === 'front matter') continue;
    const before = sameScene(row, rows[i - 1]) ? clean(rows[i - 1].segment.text) : '';
    const after = sameScene(row, rows[i + 1]) ? clean(rows[i + 1].segment.text) : '';
    const segmentId = row.record?.id ?? `${row.chapter.order}:${row.scene.order}:${row.segment.order}`;

    const narrated = classifyQuotedNarration(row.segment.text, before, after);
    if (narrated) {
      resolutions.set(segmentId, freeze({ speaker: 'Narrator', confidence: narrated.confidence, evidence: narrated.evidence, classification: narrated.classification }));
      counts.quotedNarration += 1;
      continue;
    }

    const self = selfIdentifiedSpeaker(row.segment.text, aliases);
    if (self) {
      resolutions.set(segmentId, freeze({ speaker: self, confidence: 0.995, evidence: 'self-identification', classification: 'spoken-dialogue' }));
      counts.selfIdentified += 1;
      continue;
    }

    const afterSpeaker = explicitAfterSpeechSpeaker(after);
    if (afterSpeaker) {
      resolutions.set(segmentId, freeze({ speaker: afterSpeaker, confidence: 0.96, evidence: 'explicit-after-speech-tag', classification: 'spoken-dialogue' }));
      counts.explicitContext += 1;
      continue;
    }

    const lead = canonicalLeadSpeaker(before);
    if (lead) {
      resolutions.set(segmentId, freeze({ speaker: lead, confidence: 0.9, evidence: 'preceding-speaker-lead', classification: 'spoken-dialogue' }));
      counts.explicitContext += 1;
      continue;
    }

    const relational = relationalRoleFromContext(row, before, after);
    if (relational && relationalSpeechCue(relational, before, after)) {
      resolutions.set(segmentId, freeze({ speaker: relational.canonicalName, confidence: 0.92, evidence: 'relational-role-context', classification: 'spoken-dialogue', provisional: true }));
      provisionalMentions.set(relational.canonicalName, (provisionalMentions.get(relational.canonicalName) ?? 0) + 1);
      counts.relationalRole += 1;
      continue;
    }

    const direct = directAddressExclusion(row.segment.text, rows, i, aliases);
    if (direct) {
      resolutions.set(segmentId, freeze({ ...direct, classification: 'spoken-dialogue' }));
      counts.directAddress += 1;
    }
  }

  const provisionalRoles = RELATIONAL_ROLES
    .filter((role) => provisionalMentions.has(role.canonicalName))
    .map((role) => freeze({
      canonicalName: role.canonicalName,
      aliases: freeze([...role.aliases]),
      role: role.role,
      mentions: provisionalMentions.get(role.canonicalName),
      averageConfidence: 0.92,
      highConfidenceMentions: provisionalMentions.get(role.canonicalName),
      inferredReviewMentions: 0,
      castingPriority: role.role === 'supporting' ? 2 : 3,
      seriesCharacterKey: role.seriesCharacterKey,
      castingStatus: 'provisional',
      source: 'book-one-intelligence-relational-role',
      provisional: true
    }));

  return freeze({
    resolutions,
    provisionalRoles: freeze(provisionalRoles),
    counts: freeze({ ...counts }),
    autoResolutionCount: resolutions.size
  });
}

export function intelligenceResolutionFor(intelligence, segmentId) {
  return intelligence?.resolutions?.get(segmentId) ?? null;
}
