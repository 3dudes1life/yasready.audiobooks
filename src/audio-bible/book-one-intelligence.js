import { BOOK_ONE_PROFILE, canonicalizeSpeakerCandidate } from '../superman/book-one-superman.js';

const freeze = (value) => Object.freeze(value);
const SPEECH_VERBS = 'said|asked|replied|answered|whispered|murmured|shouted|yelled|called|called out|added|continued|laughed|snapped|sighed|offered|admitted|insisted|promised|teased|joked|warned|cried|blurted|exclaimed|breathed|mumbled|muttered|shot back|fired back|shrieked|croaked|gasped|groaned|stated|explained|demanded|announced|chimed in|read aloud|disclaimed|barked|urged|echoed|declared';
const TAG_VERBS = 'said|asked|replied|answered|whispered|murmured|shouted|yelled|called|called out|added|continued|snapped|offered|admitted|insisted|promised|teased|joked|warned|cried|blurted|exclaimed|breathed|mumbled|muttered|shot back|fired back|shrieked|croaked|stated|explained|demanded|announced|chimed in|read aloud|disclaimed|barked|urged|echoed|declared';
const LEAD_ACTIONS = `${SPEECH_VERBS}|leaned|turned|paused|nodded|smirked|grinned|exhaled|tossed|looked|glanced|sat|stood|pushed|nudged|elbowed|flopped|checked|stretched|reached|picked|held|gestured|winked|froze|blinked|sighed|tapped|rested|collapsed|perked|pointed|raised|gave|crossed|dropped|opened|stared|walked|stepped|grabbed|pulled|rubbed|smiled|laughed|cheered|shrugged|feigned|studied|listened|reacted|hesitated|jumped|slowed|reappeared|brought|squinted|widened|strutted|yanked|sniffed|slumped|stopped|gripped|watched|wiped|entered|appeared|returned|moved|shook|broke the silence|broke it|chuckled|poked|read|let out|came back|came out|wedged|found`;
export const BOOK_ONE_SCENE_LOCAL_CANDIDATES = freeze(['Derek']);
const PRIMARY = ['Michael Rawlins', 'Juan Delgado', 'Christopher Lancaster'];
const CANONICAL_ALIASES = Object.freeze({
  'Michael Rawlins': ['Michael', 'Rawlins', 'Micheal'],
  'Juan Delgado': ['Juan', 'Delgado'],
  'Christopher Lancaster': ['Christopher', 'Chris', 'Lancaster'],
  Dani: ['Dani'], Evan: ['Evan'], Drew: ['Drew'], Alex: ['Alex'], Nick: ['Nick'], Kayla: ['Kayla'], Noah: ['Noah'], Paris: ['Paris'],
  "Michael's Mother": ['Mama'], "Michael's Brother": [], Realtor: ['Realtor'], Landlord: ['Landlord'],
  "New Year's Couple – Man (Derek)": ['Derek']
});

const MALE_SPEAKERS = new Set([
  'Michael Rawlins', 'Juan Delgado', 'Christopher Lancaster', 'Evan', 'Drew', 'Alex', 'Nick', 'Noah', "Michael's Brother", "New Year's Couple – Man (Derek)"
]);
const FEMALE_SPEAKERS = new Set(['Dani', 'Kayla', "Michael's Mother", 'Realtor', 'Landlord', "New Year's Couple – Woman", 'Pop Star']);

const RELATIONAL_ROLES = Object.freeze([
  Object.freeze({
    canonicalName: "Michael's Mother", role: 'supporting', aliases: ['Michael’s mother', "Michael's mother", 'his mother', 'his mom', 'Mama'],
    seriesCharacterKey: 'michael-mother', continuityScope: 'book', chapterMin: 24, chapterMax: 26,
    pattern: /\b(?:his|Michael[’']s)\s+(?:mother|mom)\b|\bMama\b/i,
    pronoun: 'she'
  }),
  Object.freeze({
    canonicalName: "Michael's Brother", role: 'supporting', aliases: ['Michael’s brother', "Michael's brother", 'his brother'],
    seriesCharacterKey: 'michael-brother', continuityScope: 'book', chapterMin: 24, chapterMax: 26,
    pattern: /\b(?:his|Michael[’']s)\s+brother\b/i,
    pronoun: 'he'
  }),
  Object.freeze({
    canonicalName: 'Realtor', role: 'minor', aliases: ['the realtor', 'their realtor'],
    seriesCharacterKey: 'realtor', continuityScope: 'book', chapterMin: 42, chapterMax: 43,
    pattern: /\b(?:the|their)\s+realtor\b/i,
    pronoun: 'she'
  }),
  Object.freeze({
    canonicalName: 'Landlord', role: 'minor', aliases: ['the landlord', 'their landlord'],
    seriesCharacterKey: 'landlord', continuityScope: 'book', chapterMin: 33, chapterMax: 33,
    pattern: /\b(?:the|their)\s+landlord\b/i,
    pronoun: 'she'
  })
]);

const CONTEXTUAL_ROLES = Object.freeze([
  Object.freeze({
    canonicalName: "Juan's Friend", aliases: ["one of Juan's friends", 'the friend'], role: 'minor',
    continuityScope: 'scene', chapterOrder: 20, seriesCharacterKey: null, chapterMin: 20, chapterMax: 20,
    test: ({ before }) => /\b(?:one of Juan[’']s friends|the friend)\b/i.test(before)
  }),
  Object.freeze({
    canonicalName: 'Housewarming Guest', aliases: ['someone else', 'someone'], role: 'minor',
    continuityScope: 'scene', chapterOrder: 20, seriesCharacterKey: null, chapterMin: 20, chapterMax: 20,
    test: ({ before }) => /\b(?:someone else chimed in|someone shouted)\b/i.test(before)
  }),
  Object.freeze({
    canonicalName: 'Drag Queen', aliases: ['a queen', 'the queen'], role: 'minor',
    continuityScope: 'scene', chapterOrder: 27, seriesCharacterKey: null, chapterMin: 27, chapterMax: 27,
    test: ({ before }) => /\bqueen\b/i.test(before) && /\b(?:strutted|blowing a kiss|drag show)\b/i.test(before)
  }),
  Object.freeze({
    canonicalName: 'Pop Star', aliases: ['the pop star'], role: 'minor',
    continuityScope: 'scene', chapterOrder: 31, seriesCharacterKey: null, chapterMin: 31, chapterMax: 31,
    test: ({ before, trail, after }) => (/\bthe pop star\b/i.test(before) || (/^Her voice\b/i.test(after) && /\bthe pop star\b/i.test(trail))) && /\b(?:her voice|yelling into her phone|wig sideways)\b/i.test(`${before} ${after} ${trail}`)
  }),
  Object.freeze({
    canonicalName: "New Year's Couple – Woman", aliases: ['the girlfriend', 'his girlfriend', 'the woman'], role: 'minor',
    continuityScope: 'scene', chapterOrder: 34, seriesCharacterKey: null, chapterMin: 34, chapterMax: 34,
    test: ({ before, trail, after, dialogue }) => {
      const context = `${trail} ${before} ${after} ${dialogue}`;
      const couple = /\b(?:straight couple|her boyfriend|Derek|the girlfriend)\b/i.test(context);
      return couple && (new RegExp(`\\bshe\\s+(?:${TAG_VERBS})\\b`, 'i').test(`${before} ${after}`) || /\b(?:Are you bisexual now|Or just full of shit)\b/i.test(dialogue));
    }
  }),
  Object.freeze({
    canonicalName: "New Year's Couple – Man (Derek)", aliases: ['Derek', 'her boyfriend', 'the boyfriend'], role: 'minor',
    continuityScope: 'scene', chapterOrder: 34, seriesCharacterKey: null, chapterMin: 34, chapterMax: 34,
    test: ({ before, trail, after }) => /\b(?:straight couple|her boyfriend|Derek replied|Derek turned)\b/i.test(`${trail} ${before} ${after}`) && /\bDerek\b/i.test(`${trail} ${before} ${after}`)
  }),
  Object.freeze({
    canonicalName: "New Year's Guest – Younger", aliases: ['the younger one'], role: 'minor',
    continuityScope: 'scene', chapterOrder: 34, seriesCharacterKey: null, chapterMin: 34, chapterMax: 34,
    test: ({ after, trail }) => /\bthe younger one asked\b/i.test(after) && /\bsparkly couple\b/i.test(trail)
  }),
  Object.freeze({
    canonicalName: "New Year's Guest – Older", aliases: ['the older one'], role: 'minor',
    continuityScope: 'scene', chapterOrder: 34, seriesCharacterKey: null, chapterMin: 34, chapterMax: 34,
    test: ({ before, trail }) => /\bthe older one\s+(?:grinned|said|cheered)\b/i.test(before) && /\bsparkly couple\b/i.test(trail)
  })
]);

function clean(value) { return String(value ?? '').replace(/\s+/g, ' ').trim(); }
function wordCount(value) { return clean(value).split(/\s+/).filter(Boolean).length; }
function canon(name, aliases = BOOK_ONE_PROFILE.aliases) {
  const value = clean(name);
  if (/^Derek$/i.test(value)) return "New Year's Couple – Man (Derek)";
  return canonicalizeSpeakerCandidate(name, { aliases });
}
function sameScene(a, b) { return a && b && a.chapter.order === b.chapter.order && a.scene.order === b.scene.order; }
function sameParagraph(a, b) {
  return sameScene(a, b) && Number.isInteger(a?.segment?.paragraphIndex) && a.segment.paragraphIndex === b?.segment?.paragraphIndex;
}
function escaped(value) { return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function sceneKey(row) { return `${row?.chapter?.order ?? '?'}:${row?.scene?.order ?? '?'}`; }

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
      const rx = new RegExp(`\\b${escaped(alias)}\\b`, 'i');
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
  if (!clause || /^\[[^\]]+\]:/.test(clause)) return null;
  const subjects = [];
  for (const [canonical, aliases] of Object.entries(CANONICAL_ALIASES)) {
    for (const alias of aliases) {
      // Require the name to behave like the local grammatical subject of the action.
      // This prevents object names earlier in a sentence from stealing a later speaker lead.
      const rx = new RegExp(`\\b${escaped(alias)}\\b(?:[’']s)?(?:\\s+[A-Za-z’'\\-]+){0,3}\\s+(?:${LEAD_ACTIONS})\\b`, 'ig');
      for (const match of clause.matchAll(rx)) subjects.push({ canonical, index: match.index ?? 0, end: (match.index ?? 0) + match[0].length });
    }
  }
  const unique = [...new Set(subjects.map((x) => x.canonical))];
  if (unique.length === 1) return unique[0];
  if (unique.length > 1) {
    // Multiple named actors in one clause are not safe enough for automatic speaker assignment.
    return null;
  }
  return null;
}

function canonicalOpeningSubject(text) {
  const source = clean(text);
  const first = source.split(/(?<=[.!?])\s+/)[0] ?? source;
  const hits = [];
  for (const [canonical, aliases] of Object.entries(CANONICAL_ALIASES)) {
    for (const alias of aliases) {
      if (new RegExp(`^(?:(?:then|finally|meanwhile|later)\\s+)?${escaped(alias)}\\b`, 'i').test(first)) {
        hits.push(canonical);
        break;
      }
    }
  }
  const unique = [...new Set(hits)];
  return unique.length === 1 ? unique[0] : null;
}

function canonicalSubjectLike(text) {
  const clause = lastClause(text);
  if (!clause || /^\[[^\]]+\]:/.test(clause)) return null;
  const hits = [];
  for (const [canonical, aliases] of Object.entries(CANONICAL_ALIASES)) {
    for (const alias of aliases) {
      const token = escaped(alias);
      // Conservative subject-like mention: the name begins the last sentence/clause, optionally after a short transition.
      const rx = new RegExp(`^(?:(?:then|finally|eventually|nearby|outside|inside|later|afterward|afterwards|suddenly|just then|sure enough|meanwhile|as they|when they)\\s+)?${token}\\b(?:[’']s)?`, 'i');
      if (rx.test(clause)) { hits.push(canonical); break; }
    }
  }
  const unique = [...new Set(hits)];
  return unique.length === 1 ? unique[0] : null;
}

function relationalMention(text, chapterNumber) {
  const source = clean(text);
  if (!source || /^\[[^\]]+\]:/.test(source)) return null;
  for (const role of RELATIONAL_ROLES) {
    if (chapterNumber < role.chapterMin || chapterNumber > role.chapterMax) continue;
    if (role.pattern.test(source)) return role.canonicalName;
  }
  return null;
}

function explicitAnonymousActor(text) {
  const source = clean(text);
  if (!source) return null;
  const patterns = [
    /\b(?:the|a|that)\s+(?:guy|man|woman|girl|boy|stranger|queen|guest|friend|neighbor|bartender|server|hostess|handler)\b/i,
    /\b(?:someone|somebody|one of\s+[^,.;!?]+|the younger one|the older one|the pop star|the girlfriend|her boyfriend)\b/i,
    /\b(?:straight|sparkly)\s+couple\b/i
  ];
  for (const rx of patterns) {
    const match = rx.exec(source);
    if (match) return { index: match.index ?? 0, text: match[0] };
  }
  return null;
}

function canonicalLeadSpeakerAcrossText(text) {
  const source = clean(text);
  if (!source || /^\[[^\]]+\]:/.test(source)) return null;
  const matches = [];
  for (const [canonical, aliases] of Object.entries(CANONICAL_ALIASES)) {
    for (const alias of aliases) {
      const rx = new RegExp(`\\b${escaped(alias)}\\b(?:[’']s)?(?:\\s+[A-Za-z’'\\-]+){0,4}\\s+(?:${LEAD_ACTIONS})\\b`, 'ig');
      for (const match of source.matchAll(rx)) matches.push({ canonical, index: match.index ?? 0 });
    }
  }
  if (!matches.length) return null;
  matches.sort((a, b) => b.index - a.index);
  const top = matches[0];
  const anon = explicitAnonymousActor(source);
  if (anon && anon.index > top.index) return null;
  return top.canonical;
}

function lastCanonicalMentionMatchingPronoun(text, pronoun) {
  const source = clean(text);
  if (!source || /^\[[^\]]+\]:/.test(source)) return null;
  const matches = [];
  for (const [canonical, aliases] of Object.entries(CANONICAL_ALIASES)) {
    if (!speakerMatchesPronoun(canonical, pronoun)) continue;
    for (const alias of aliases) {
      const rx = new RegExp(`\\b${escaped(alias)}\\b`, 'ig');
      for (const match of source.matchAll(rx)) matches.push({ canonical, index: match.index ?? 0 });
    }
  }
  if (!matches.length) return null;
  matches.sort((a, b) => b.index - a.index);
  const top = matches[0];
  const anon = explicitAnonymousActor(source);
  if (anon && anon.index > top.index) return null;
  return top.canonical;
}

function recentNamedAntecedent(rows, index, pronoun, maxLookback = 8) {
  const current = rows[index];
  for (let offset = 1; offset <= maxLookback; offset += 1) {
    const row = rows[index - offset];
    if (!sameScene(current, row)) break;
    if (row.segment.kind !== 'narration') continue;
    const text = clean(row.segment.text);
    if (!text || /^\[[^\]]+\]:/.test(text)) continue;
    if (explicitAnonymousActor(text)) return null;
    // Pronoun-led narration frequently contains other named people as objects/possessives
    // (for example, "He thought of Juan's dance moves, Christopher's laugh...").
    // Never promote those object names to the pronoun antecedent. Keep walking backward
    // until we find an explicit grammatical subject or relational identity.
    const pronounLed = /^(?:he|she|his|her)\b/i.test(text);
    const named = canonicalLeadSpeakerAcrossText(text)
      ?? canonicalSubjectLike(text)
      ?? relationalMention(text, Number(row.chapter.order))
      ?? (pronounLed ? null : lastCanonicalMentionMatchingPronoun(text, pronoun));
    if (named && speakerMatchesPronoun(named, pronoun)) return named;
  }
  return null;
}

function relationalSubject(text, chapterNumber) {
  const source = clean(text);
  if (!source || /^\[[^\]]+\]:/.test(source)) return null;
  for (const role of RELATIONAL_ROLES) {
    if (chapterNumber < role.chapterMin || chapterNumber > role.chapterMax) continue;
    if (!role.pattern.test(source)) continue;
    if (new RegExp(`\\b(?:${LEAD_ACTIONS}|voice|came|returned|watched)\\b`, 'i').test(source)) return role.canonicalName;
  }
  return null;
}

function explicitAfterSpeechSpeaker(after, followingRow = null) {
  const clause = clean(after).split(/(?<=[.!?])\s+/)[0] ?? '';
  if (!clause) return null;
  // A standalone "Juan joked." immediately before another dialogue line is usually a lead into that next line,
  // not a tag for the dialogue that came before it. Fail closed rather than stealing the next speaker.
  if (followingRow?.segment?.kind === 'dialogue' && new RegExp(`^(?:${Object.values(CANONICAL_ALIASES).flat().map(escaped).join('|')})\\s+(?:${SPEECH_VERBS})[.!]?$`, 'i').test(clause)) {
    return null;
  }
  for (const [canonical, aliases] of Object.entries(CANONICAL_ALIASES)) {
    for (const alias of aliases) {
      const token = escaped(alias);
      const rx1 = new RegExp(`^${token}\\s+(?:${SPEECH_VERBS})\\b`, 'i');
      const rx2 = new RegExp(`^(?:${SPEECH_VERBS})\\s+${token}\\b`, 'i');
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

export function addressedCanonicalName(dialogue, aliases = BOOK_ONE_PROFILE.aliases) {
  const text = clean(dialogue);
  // A bare single name (for example "Michael." during an introduction) is not automatically
  // a vocative. Require punctuation that proves the name is being addressed, or a known phrase.
  const match = /[,;:]\s*(Michael|Juan|Christopher|Chris)\s*[.!?]*$/i.exec(text)
    ?? /^(Michael|Juan|Christopher|Chris)\s*[,;:]/i.exec(text)
    ?? /\b(?:te amo|love you),?\s+(Michael|Juan|Christopher|Chris)(?:ito)?[.!?]*$/i.exec(text);
  if (match) return canon(match[1], aliases);
  if (/(?:^|[,;:]\s*)Cowboy\s*[.!?]*$/i.test(text)) return 'Michael Rawlins';
  if (/(?:^|[,;:]\s*)Juanito\s*[.!?]*$/i.test(text)) return 'Juan Delgado';
  if (/(?:^|[,;:]\s*)Bay Area\s*[.!?]*$/i.test(text)) return 'Christopher Lancaster';
  return null;
}

function contextualRoleFromContext(row, before, after, trail = '') {
  const chapterNumber = Number(row.chapter.order);
  const payload = { before: clean(before), after: clean(after), trail: clean(trail), dialogue: clean(row.segment.text) };
  for (const role of CONTEXTUAL_ROLES) {
    if (chapterNumber < role.chapterMin || chapterNumber > role.chapterMax) continue;
    if (role.test(payload)) return role;
  }
  return null;
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
  return new RegExp(`\\b(?:${SPEECH_VERBS}|voice|asked|whispered|murmured|added)\\b`, 'i').test(source)
    || /\b(?:looked at|stood beside|came out|stepped between|continued|chuckled|nodded|smiled|hugged)\b/i.test(source);
}

export function classifyQuotedNarration(dialogue, before, after, { extendedBefore = '' } = {}) {
  const text = clean(dialogue);
  const prev = clean(before);
  const next = clean(after);
  const trail = clean(extendedBefore || prev);
  const wc = wordCount(text);
  if (!text || wc > 14) return null;
  if (selfIdentifiedSpeaker(text, BOOK_ONE_PROFILE.aliases)) return null;
  if (new RegExp(`^(?:he|she|they|[A-Z][A-Za-z’'\-]+)\\s+(?:${SPEECH_VERBS})\\b`, 'i').test(next)) return null;

  const displayLead = /(?:subject lines?|emails?|cocktails?|drinks?|names?|words?|phrases?|terms?|headline|caption|sign|label|menu|screen|news|article|song|track|title)(?:\s+[^.!?]{0,45})?\s+(?:read|reads|said|says|called|calls|named|titled|labeled|showed|showing|displayed|performing|sing|sang)(?:\s+(?:an?|the|this|that))?\s*$/i.test(prev)
    || /\b(?:subject lines?|names?|cocktails?|drinks?)\s+(?:such as|like)\s*$/i.test(prev)
    || /\b(?:sign that read|news called an?|began to sing|performing)\s*$/i.test(prev);
  const chainLead = /\b(?:cocktails?|drinks?|names?|subject lines?)\s+(?:such as|like)\b/i.test(trail)
    && /(?:\band\b\s*)$/i.test(prev);
  const grammaticalContinuation = /^[a-z][a-z’'\-]*\b/.test(next)
    || /^(?:and|or|had|was|were|is|are|aesthetic|That changed|There were)\b/.test(next);
  const lowerEmphasis = wc <= 5 && text === text.toLowerCase() && Boolean(next);
  const titleLabel = wc <= 7 && /^(?:[A-Z][\w’'&.-]*)(?:\s+[A-Z][\w’'&.-]*)*[.!]?$/.test(text)
    && (displayLead || chainLead || grammaticalContinuation);
  const emailLike = /\b(?:Docs|Timeline|Update|Attached|Approval|Notice|Confirmation)\b/.test(text)
    && /\b(?:email|subject|browser|tabs?|documents?)\b/i.test(trail);
  const bracketMessageFragment = /^\[[^\]]+\]:/.test(prev) && wc <= 12;
  const hypotheticalInline = /^Not[.!]?$/.test(prev) && (/^Not[.!]?$/.test(next) || /^Just a\b/i.test(next) || /^Rather than\b/i.test(next));
  const performanceTitle = /\b(?:performing|began to sing|started to sing|song called|track called)\s*$/i.test(prev) && wc <= 8;
  const collectiveLead = /\b(?:everyone|everybody|they all|the group|the room)\b[^.!?]{0,80}\b(?:chimed|shouted|said|called|sang|began to sing)\b[^.!?]*:?\s*$/i.test(prev);
  const collectiveAfter = /^(?:they|everyone|everybody)\s+(?:said|shouted|called|sang)\s+(?:it\s+)?together\b/i.test(next);
  const narrativeBridge = wc <= 5 && text === text.toLowerCase()
    && /\b(?:how|being|called|felt|seemed|looked|was|were)\s*$/i.test(prev)
    && (/^[A-Z][A-Za-z’'\-]+\s+(?:was|were|is|are)\b/.test(next) || grammaticalContinuation);

  const embeddedIllustration = wc <= 5
    && /\b(?:first time|last time|every time|when)\s+(?:he|she|they|[A-Z][A-Za-z’'\-]+)\s+(?:said|called it|used the word)\s*$/i.test(prev);
  const selfDeclaredLabel = wc <= 6 && /\bself-declared\s*$/i.test(prev);
  const playlistTitle = wc <= 9 && /\b(?:playlist|mix|set)\s+(?:titled|called|named)\s*$/i.test(prev);
  // DOCX segmentation can split a song reference into: “Artist’s” + quoted-looking title +
  // “dropped/played...”. That title is narration/media metadata, never a speaking character.
  const splitSongTitle = wc <= 10
    && /(?:[A-Z][\p{L}’'\-]+(?:\s+[A-Z][\p{L}’'\-]+){0,3})[’']s\s*$/u.test(prev)
    && /^(?:dropped|played|blasted|started|came on|hit)\b/i.test(next);
  const crowdReveal = wc <= 4 && /^Surprise[!.]*$/i.test(text) && /\b(?:patio|room|crowd|group)\b[^.!?]{0,60}\b(?:erupted|cheered|shouted)\b/i.test(next);

  if (embeddedIllustration) return freeze({ classification: 'quoted-narration', confidence: 0.99, evidence: 'embedded-example-quote' });
  if (selfDeclaredLabel) return freeze({ classification: 'quoted-narration', confidence: 0.99, evidence: 'self-declared-label' });
  if (playlistTitle) return freeze({ classification: 'displayed-text', confidence: 0.99, evidence: 'playlist-title' });
  if (splitSongTitle) return freeze({ classification: 'quoted-narration', confidence: 0.995, evidence: 'split-song-title-not-dialogue' });
  if (crowdReveal) return freeze({ classification: 'collective-speech-narrated', confidence: 0.99, evidence: 'collective-reveal' });
  if (emailLike) return freeze({ classification: 'displayed-text', confidence: 0.99, evidence: 'quoted-display-label' });
  if (bracketMessageFragment) return freeze({ classification: 'displayed-text', confidence: 0.99, evidence: 'message-quoted-fragment' });
  if (hypotheticalInline) return freeze({ classification: 'quoted-narration', confidence: 0.99, evidence: 'hypothetical-quote-not-spoken' });
  if (performanceTitle) return freeze({ classification: 'quoted-narration', confidence: 0.99, evidence: 'performance-title-not-dialogue' });
  if (collectiveLead || collectiveAfter) return freeze({ classification: 'collective-speech-narrated', confidence: 0.97, evidence: 'collective-speech-no-single-speaker' });
  if (displayLead || chainLead) return freeze({ classification: 'quoted-narration', confidence: 0.98, evidence: 'inline-quoted-label' });
  if (narrativeBridge) return freeze({ classification: 'quoted-narration', confidence: 0.98, evidence: 'narrative-quoted-fragment' });
  if ((lowerEmphasis || titleLabel) && grammaticalContinuation) return freeze({ classification: 'quoted-narration', confidence: 0.97, evidence: 'inline-emphasis-not-dialogue' });
  return null;
}

function speakerMatchesPronoun(speaker, pronoun) {
  if (!speaker) return false;
  if (pronoun === 'he') return MALE_SPEAKERS.has(speaker);
  if (pronoun === 'she') return FEMALE_SPEAKERS.has(speaker);
  return true;
}

function recentActorBefore(rows, index, pronoun, aliases, maxLookback = 12) {
  return recentNamedAntecedent(rows, index, pronoun, maxLookback);
}
function pronounContextResolution(rows, index, aliases, resolutions) {
  const row = rows[index];
  const before = sameScene(row, rows[index - 1]) ? clean(rows[index - 1].segment.text) : '';
  const beforeTag = new RegExp(`^(he|she)\\s+(?:${TAG_VERBS})\\b`, 'i').exec(before);
  const beforeAction = new RegExp(`^(he|she)\\s+(?:${LEAD_ACTIONS})\\b`, 'i').exec(before);
  const pronoun = (beforeTag ?? beforeAction)?.[1]?.toLowerCase() ?? null;
  if (!pronoun) return null;

  const previousSpeaker = immediatePriorDialogueSpeaker(rows, index - 1, aliases, resolutions, 5);
  if (previousSpeaker && speakerMatchesPronoun(previousSpeaker, pronoun)) {
    return freeze({
      speaker: previousSpeaker,
      confidence: beforeTag ? 0.93 : 0.9,
      evidence: beforeTag ? `pronoun-speech-continuation:${pronoun}` : `pronoun-action-continuation:${pronoun}`
    });
  }

  // 0.11.5: a pronoun action can inherit the nearest explicitly named same-gender actor,
  // but only when no anonymous actor has intervened.
  const antecedent = recentNamedAntecedent(rows, index - 1, pronoun, 6);
  if (antecedent) {
    return freeze({
      speaker: antecedent,
      confidence: beforeTag ? 0.91 : 0.88,
      evidence: beforeTag ? `pronoun-speech-antecedent:${pronoun}` : `pronoun-action-antecedent:${pronoun}`
    });
  }
  return null;
}
function pronounAfterTagResolution(rows, index, aliases, resolutions) {
  const row = rows[index];
  const after = sameScene(row, rows[index + 1]) ? clean(rows[index + 1].segment.text) : '';
  const match = new RegExp(`^(he|she)\\s+(?:${TAG_VERBS})\\b`, 'i').exec(after);
  if (!match) return null;
  const pronoun = match[1].toLowerCase();
  const before = sameScene(row, rows[index - 1]) ? clean(rows[index - 1].segment.text) : '';

  // Do not jump past an explicitly anonymous actor ("the guy", "a queen", "someone", etc.).
  // Those are handled by contextual-role logic or left for review.
  if (explicitAnonymousActor(before)) return null;

  const local = canonicalLeadSpeakerAcrossText(before)
    ?? canonicalSubjectLike(before)
    ?? relationalSubject(before, Number(row.chapter.order))
    ?? relationalMention(before, Number(row.chapter.order));
  if (local && speakerMatchesPronoun(local, pronoun)) {
    return freeze({ speaker: local, confidence: 0.97, evidence: `pronoun-after-tag+local-antecedent:${pronoun}` });
  }

  const recent = recentNamedAntecedent(rows, index, pronoun, 7);
  if (recent) return freeze({ speaker: recent, confidence: 0.92, evidence: `pronoun-after-tag+recent-antecedent:${pronoun}` });

  // Last resort for split quote/tag/quote runs: keep the prior spoken speaker only if no
  // explicit named/anonymous actor appears in intervening narration.
  const prior = immediatePriorDialogueSpeaker(rows, index, aliases, resolutions, 8);
  if (prior && speakerMatchesPronoun(prior, pronoun)) {
    let safe = true;
    for (let j = index - 1; j >= 0 && j >= index - 8; j -= 1) {
      const probe = rows[j];
      if (!sameScene(row, probe)) break;
      if (probe.segment.kind === 'dialogue') break;
      const text = clean(probe.segment.text);
      if (explicitAnonymousActor(text)) { safe = false; break; }
      const named = canonicalLeadSpeakerAcrossText(text) ?? canonicalSubjectLike(text);
      if (named && named !== prior) { safe = false; break; }
    }
    if (safe) return freeze({ speaker: prior, confidence: 0.89, evidence: `pronoun-after-tag+prior-dialogue:${pronoun}` });
  }
  return null;
}
function nearbyCanonicalSpeakers(rows, index, aliases, radius = 5, resolutions = null) {
  const current = rows[index];
  const weighted = new Map();
  for (let offset = 1; offset <= radius; offset += 1) {
    for (const j of [index - offset, index + offset]) {
      const row = rows[j];
      if (!sameScene(current, row) || row.segment.kind !== 'dialogue') continue;
      const id = row.record?.id ?? `${row.chapter.order}:${row.scene.order}:${row.segment.order}`;
      const resolved = resolutions?.get(id);
      const canonical = resolved?.speaker && resolved.speaker !== 'Narrator'
        ? resolved.speaker
        : canon(row.segment.speakerCandidate?.name, aliases);
      if (!canonical || canonical === 'Narrator') continue;
      const confidence = Number(resolved?.confidence ?? row.segment.speakerCandidate?.confidence ?? 0.5);
      weighted.set(canonical, (weighted.get(canonical) ?? 0) + (radius + 1 - offset) * Math.max(0.2, confidence));
    }
  }
  return [...weighted.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
}

function directAddressExclusion(dialogue, rows, index, aliases, resolutions = null, sceneStats = null) {
  const addressed = addressedCanonicalName(dialogue, aliases);
  if (!addressed) return null;
  const before = sameScene(rows[index], rows[index - 1]) ? clean(rows[index - 1].segment.text) : '';
  const lead = canonicalLeadSpeaker(before);
  if (lead && lead !== addressed) return freeze({ speaker: lead, confidence: 0.97, evidence: `vocative-exclusion+preceding-lead:${addressed}` });
  if (/\b(?:someone|somebody|a guy|the guy|a woman|the woman|one of\s+\w+)\b[^.!?]{0,100}\b(?:said|asked|called|shouted|yelled|blurted|demanded)\b/i.test(before)) return null;
  const pair = sceneStats ? stableTwoSpeakerPair(sceneStats, rows[index]) : null;
  if (!pair || !pair.includes(addressed)) return null;
  const others = pair.filter((name) => name !== addressed);
  if (others.length === 1) return freeze({ speaker: others[0], confidence: 0.9, evidence: `direct-address-exclusion:${addressed}` });
  return null;
}

function buildSceneSpeakerStats(rows, aliases) {
  const scenes = new Map();
  for (const row of rows) {
    if (row.segment.kind !== 'dialogue') continue;
    const canonical = canon(row.segment.speakerCandidate?.name, aliases);
    const confidence = Number(row.segment.speakerCandidate?.confidence ?? 0);
    if (!canonical || confidence < 0.75) continue;
    const key = sceneKey(row);
    const map = scenes.get(key) ?? new Map();
    map.set(canonical, (map.get(canonical) ?? 0) + 1);
    scenes.set(key, map);
  }
  return scenes;
}

function stableTwoSpeakerPair(sceneStats, row) {
  const counts = sceneStats.get(sceneKey(row));
  if (!counts) return null;
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const strong = ranked.filter(([, count]) => count >= 2);
  if (strong.length !== 2) return null;
  const total = ranked.reduce((sum, [, count]) => sum + count, 0);
  const covered = strong[0][1] + strong[1][1];
  if (total < 4 || covered / total < 0.9) return null;
  return strong.map(([name]) => name);
}

function knownDialogueSpeaker(row, aliases, resolutions) {
  if (!row || row.segment.kind !== 'dialogue') return null;
  const id = row.record?.id ?? `${row.chapter.order}:${row.scene.order}:${row.segment.order}`;
  const resolved = resolutions.get(id);
  if (resolved?.speaker && resolved.speaker !== 'Narrator') return resolved.speaker;
  const candidate = canon(row.segment.speakerCandidate?.name, aliases);
  if (candidate && Number(row.segment.speakerCandidate?.confidence ?? 0) >= 0.75) return candidate;
  return null;
}

function immediatePriorDialogueSpeaker(rows, index, aliases, resolutions, maxDistance = 5) {
  const current = rows[index];
  for (let offset = 1; offset <= maxDistance; offset += 1) {
    const row = rows[index - offset];
    if (!sameScene(current, row)) break;
    if (row.segment.kind !== 'dialogue') continue;
    return knownDialogueSpeaker(row, aliases, resolutions);
  }
  return null;
}

function immediateNextDialogueSpeaker(rows, index, aliases, resolutions, maxDistance = 5) {
  const current = rows[index];
  for (let offset = 1; offset <= maxDistance; offset += 1) {
    const row = rows[index + offset];
    if (!sameScene(current, row)) break;
    if (row.segment.kind !== 'dialogue') continue;
    return knownDialogueSpeaker(row, aliases, resolutions);
  }
  return null;
}

function nearestPriorDialogueSpeaker(rows, index, aliases, resolutions, maxDistance = 4) {
  const current = rows[index];
  for (let offset = 1; offset <= maxDistance; offset += 1) {
    const row = rows[index - offset];
    if (!sameScene(current, row)) break;
    const speaker = knownDialogueSpeaker(row, aliases, resolutions);
    if (speaker) return speaker;
  }
  return null;
}

function nearestNextDialogueSpeaker(rows, index, aliases, resolutions, maxDistance = 4) {
  const current = rows[index];
  for (let offset = 1; offset <= maxDistance; offset += 1) {
    const row = rows[index + offset];
    if (!sameScene(current, row)) break;
    const speaker = knownDialogueSpeaker(row, aliases, resolutions);
    if (speaker) return speaker;
  }
  return null;
}

function twoSpeakerTurnResolution(rows, index, aliases, resolutions, sceneStats) {
  const row = rows[index];
  const pair = stableTwoSpeakerPair(sceneStats, row);
  if (!pair) return null;
  const candidate = canon(row.segment.speakerCandidate?.name, aliases);
  const confidence = Number(row.segment.speakerCandidate?.confidence ?? 0);
  const previous = immediatePriorDialogueSpeaker(rows, index, aliases, resolutions);
  const next = immediateNextDialogueSpeaker(rows, index, aliases, resolutions);
  if (!previous || !next || previous !== next || !pair.includes(previous)) return null;
  const other = pair.find((name) => name !== previous);
  if (!other) return null;
  if (candidate && confidence < 0.75 && candidate === other) {
    return freeze({ speaker: candidate, confidence: 0.88, evidence: 'two-speaker-sandwich+candidate' });
  }
  if (!candidate) return freeze({ speaker: other, confidence: 0.86, evidence: 'two-speaker-sandwich-turn' });
  return null;
}

function reactionExclusionResolution(rows, index, aliases, sceneStats) {
  const row = rows[index];
  const pair = stableTwoSpeakerPair(sceneStats, row);
  if (!pair) return null;
  const candidate = canon(row.segment.speakerCandidate?.name, aliases);
  const confidence = Number(row.segment.speakerCandidate?.confidence ?? 0);
  if (!candidate || confidence >= 0.75 || !pair.includes(candidate)) return null;
  const before = sameScene(row, rows[index - 1]) ? clean(rows[index - 1].segment.text) : '';
  if (/\b(?:someone|somebody|a guy|the guy|a woman|the woman|one of\s+\w+)\b[^.!?]{0,100}\b(?:said|asked|called|shouted|yelled|blurted)\b/i.test(before)) return null;
  const after = sameScene(row, rows[index + 1]) ? rows[index + 1].segment.text : '';
  const reactor = canonicalLeadSpeaker(after);
  const previous = immediatePriorDialogueSpeaker(rows, index, aliases, new Map());
  if (!reactor || !pair.includes(reactor) || reactor === candidate || previous !== reactor) return null;
  return freeze({ speaker: candidate, confidence: 0.9, evidence: `two-speaker-reaction-exclusion:${reactor}` });
}

function extendedBefore(rows, index, count = 4) {
  const current = rows[index];
  const parts = [];
  for (let j = Math.max(0, index - count); j < index; j += 1) {
    if (!sameScene(current, rows[j])) continue;
    parts.push(clean(rows[j].segment.text));
  }
  return parts.join(' ');
}


function explicitSpeakerWithinAfter(rows, index, maxLookahead = 3) {
  const current = rows[index];
  for (let offset = 1; offset <= maxLookahead; offset += 1) {
    const row = rows[index + offset];
    if (!sameScene(current, row)) break;
    if (row.segment.kind === 'dialogue') break;
    const text = clean(row.segment.text);
    const speaker = explicitAfterSpeechSpeaker(text, null);
    if (speaker) return { speaker, offset };
    const rel = relationalSubject(text, Number(current.chapter.order));
    if (rel && new RegExp(`\\b(?:${SPEECH_VERBS}|voice)\\b`, 'i').test(text)) return { speaker: rel, offset };
    const voice = /^(?:from [^,]+,\s*)?(?:they heard\s+)?(his|her) voice\b/i.exec(text);
    if (voice) {
      const antecedent = recentNamedAntecedent(rows, index, voice[1].toLowerCase() === 'his' ? 'he' : 'she', 10);
      if (antecedent) return { speaker: antecedent, offset };
    }
  }
  return null;
}

function leadCueResolution(rows, index) {
  const row = rows[index];
  const before = sameScene(row, rows[index - 1]) ? clean(rows[index - 1].segment.text) : '';
  const trail = extendedBefore(rows, index, 4);
  if (/\bJuan broke it[.!]?$/i.test(before)) return { speaker: 'Juan Delgado', confidence: 0.97, evidence: 'explicit-dialogue-lead:juan-broke-it' };
  if (/\bDani was deep in storytelling mode[.!]?$/i.test(before)) return { speaker: 'Dani', confidence: 0.97, evidence: 'explicit-dialogue-lead:dani-storytelling' };
  if (/\brealtor\b[^.!?]{0,80}\bpulling out her phone\b/i.test(before)) return { speaker: 'Realtor', confidence: 0.97, evidence: 'explicit-dialogue-lead:realtor-action' };
  if (/\bafter a while, Juan chuckled[.!]?$/i.test(before)) return { speaker: 'Juan Delgado', confidence: 0.96, evidence: 'explicit-dialogue-lead:juan-chuckled' };
  if (/\bfrom outside, he called[,:]?$/i.test(before)) {
    const prior = recentNamedAntecedent(rows, index - 1, 'he', 10);
    if (prior) return { speaker: prior, confidence: 0.95, evidence: 'pronoun-call-antecedent:he' };
  }
  if (/\bher eyes moved next to Juan[.!]?$/i.test(before) && /Michael[’']s mother|his mother|his mom|Mama/i.test(trail)) {
    return { speaker: "Michael's Mother", confidence: 0.96, evidence: 'maternal-scene-antecedent' };
  }
  return null;
}

function segmentIdForRow(row) {
  return row?.record?.id ?? `${row?.chapter?.order ?? '?'}:${row?.scene?.order ?? '?'}:${row?.segment?.order ?? '?'}`;
}

function roleByCanonicalName(name) {
  return [...RELATIONAL_ROLES, ...CONTEXTUAL_ROLES].find((role) => role.canonicalName === name) ?? null;
}

function activeRelationalRoleNear(rows, index, pronoun, radius = 18) {
  const current = rows[index];
  const matches = [];
  for (let offset = 0; offset <= radius; offset += 1) {
    for (const j of offset === 0 ? [index] : [index - offset, index + offset]) {
      const row = rows[j];
      if (!sameScene(current, row)) continue;
      const text = clean(row.segment.text);
      for (const role of RELATIONAL_ROLES) {
        if (role.pronoun !== pronoun) continue;
        if (Number(current.chapter.order) < role.chapterMin || Number(current.chapter.order) > role.chapterMax) continue;
        if (role.pattern.test(text)) matches.push({ role, distance: offset });
      }
    }
    if (matches.length) break;
  }
  const unique = [...new Map(matches.map((item) => [item.role.canonicalName, item])).values()];
  return unique.length === 1 ? unique[0].role : null;
}

function uniqueGenderSpeakerNear(rows, index, pronoun, aliases, resolutions, radius = 10) {
  const current = rows[index];
  const hits = new Map();
  for (let offset = 1; offset <= radius; offset += 1) {
    for (const j of [index - offset, index + offset]) {
      const row = rows[j];
      if (!sameScene(current, row)) continue;
      let speaker = null;
      if (row.segment.kind === 'dialogue') speaker = knownDialogueSpeaker(row, aliases, resolutions);
      if (!speaker && row.segment.kind === 'narration') {
        const names = aliasesInText(row.segment.text).filter((name) => speakerMatchesPronoun(name, pronoun));
        if (names.length === 1) speaker = names[0];
        if (!speaker) {
          const rel = relationalMention(row.segment.text, Number(row.chapter.order));
          if (rel && speakerMatchesPronoun(rel, pronoun)) speaker = rel;
        }
      }
      if (!speaker || !speakerMatchesPronoun(speaker, pronoun)) continue;
      hits.set(speaker, Math.min(hits.get(speaker) ?? Infinity, offset));
    }
  }
  const ranked = [...hits.entries()].sort((a, b) => a[1] - b[1]);
  if (ranked.length === 1) return ranked[0][0];
  if (ranked.length > 1 && ranked[0][1] + 3 <= ranked[1][1]) return ranked[0][0];
  return null;
}

function pronounFromSameParagraphText(text) {
  const source = clean(text);
  if (!source) return null;
  if (/\b(?:she|her)\b/i.test(source) && !/\b(?:he|his)\b/i.test(source)) return 'she';
  if (/\b(?:he|his)\b/i.test(source) && !/\b(?:she|her)\b/i.test(source)) return 'he';
  return null;
}

function paragraphPronounSpeaker(rows, index, pronoun, aliases, resolutions) {
  const relational = activeRelationalRoleNear(rows, index, pronoun);
  if (relational) return relational.canonicalName;
  const prior = immediatePriorDialogueSpeaker(rows, index, aliases, resolutions, 6);
  if (prior && speakerMatchesPronoun(prior, pronoun)) return prior;
  return uniqueGenderSpeakerNear(rows, index, pronoun, aliases, resolutions, 12);
}


function safeSentenceSubject(sentence) {
  const source = clean(sentence);
  if (!source) return null;
  const hits = [];
  for (const [canonical, aliases] of Object.entries(CANONICAL_ALIASES)) {
    for (const alias of aliases) {
      const token = escaped(alias);
      // Do not treat possessives ("Michael's mother") as Michael acting. Only the actual
      // grammatical subject at the beginning of the sentence/clause qualifies.
      const rx = new RegExp(`^(?:(?:then|finally|meanwhile|later|afterward|afterwards|suddenly|just then|sure enough)\\s+)?${token}(?![’']s)\\b`, 'i');
      if (rx.test(source)) { hits.push(canonical); break; }
    }
  }
  const unique = [...new Set(hits)];
  return unique.length === 1 ? unique[0] : null;
}

function lastSafeSentenceSubject(text) {
  const source = clean(text);
  if (!source) return null;
  let subject = null;
  for (const sentence of source.split(/(?<=[.!?])\s+/)) {
    const found = safeSentenceSubject(sentence);
    if (found) subject = found;
  }
  return subject;
}

function speakerTruthResolution(rows, index, aliases, resolutions) {
  const row = rows[index];
  const beforeRow = rows[index - 1];
  const afterRow = rows[index + 1];
  const before = sameParagraph(row, beforeRow) ? clean(beforeRow.segment.text) : '';
  const after = sameParagraph(row, afterRow) ? clean(afterRow.segment.text) : '';

  const collective = explicitCollectiveDialogueResolution(rows, index, aliases);
  if (collective) return collective;

  const self = selfIdentifiedSpeaker(row.segment.text, aliases);
  if (self) return freeze({ speaker: self, confidence: 0.995, evidence: 'speaker-truth-self-identification', classification: 'spoken-dialogue', authority: 'truth-override' });

  // Same-paragraph grammatical subjects are the strongest ordinary prose evidence because
  // the quote and tag were authored as one paragraph before segmentation.
  const beforeSubject = lastSafeSentenceSubject(before);
  const afterSubject = lastSafeSentenceSubject(after);
  const subject = afterSubject ?? beforeSubject;
  if (subject && (!beforeSubject || !afterSubject || beforeSubject === afterSubject)) {
    const addressed = addressedCanonicalName(row.segment.text, aliases);
    if (!addressed || addressed !== subject) {
      const role = roleByCanonicalName(subject);
      return freeze({ speaker: subject, confidence: 0.995, evidence: 'speaker-truth-same-paragraph-subject', classification: 'spoken-dialogue', provisional: Boolean(role), continuityScope: role?.continuityScope ?? 'book', authority: 'truth-override' });
    }
  }

  // Pronoun tags such as "she huffed" or "he said" can be authoritative when a single
  // compatible antecedent is available and no anonymous actor blocks the chain.
  const pronounTag = /^(he|she|his|her)\b/i.exec(after || before)?.[1]?.toLowerCase();
  if (pronounTag) {
    const pronoun = pronounTag === 'she' || pronounTag === 'her' ? 'she' : 'he';
    const contextual = activeRelationalRoleNear(rows, index, pronoun, 12)?.canonicalName
      ?? recentNamedAntecedent(rows, index, pronoun, 10)
      ?? immediatePriorDialogueSpeaker(rows, index, aliases, resolutions, 6);
    const addressed = addressedCanonicalName(row.segment.text, aliases);
    if (contextual && contextual !== addressed && speakerMatchesPronoun(contextual, pronoun)) {
      const role = roleByCanonicalName(contextual);
      return freeze({ speaker: contextual, confidence: 0.98, evidence: `speaker-truth-pronoun-tag:${pronoun}`, classification: 'spoken-dialogue', provisional: Boolean(role), continuityScope: role?.continuityScope ?? 'book', authority: 'truth-override' });
    }
  }

  return null;
}

function applySpeakerTruthVerifier(rows, aliases, resolutions, counts, provisionalMentions) {
  let corrections = 0;
  let confirmations = 0;
  for (let pass = 0; pass < 3; pass += 1) {
    let changed = 0;
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      if (row.segment.kind !== 'dialogue' || String(row.chapter.title).toLowerCase() === 'front matter') continue;
      const id = segmentIdForRow(row);
      const truth = speakerTruthResolution(rows, i, aliases, resolutions);
      if (!truth) continue;
      const prior = resolutions.get(id);
      // Narration/displayed-text classification is a different semantic class, not a speaker
      // guess. Speaker truth may refine spoken dialogue, but must never turn media labels,
      // signs, quoted narration, or other non-spoken text back into character dialogue.
      if (prior?.speaker === 'Narrator' || /^(?:quoted-narration|displayed-text|collective-speech-narrated)$/.test(String(prior?.classification ?? ''))) {
        confirmations += 1;
        continue;
      }
      if (prior?.evidence === 'self-identification' && truth.evidence === 'speaker-truth-self-identification') {
        confirmations += 1;
        continue;
      }
      // A later explicit self-identification can backfill an anonymous speaker with stronger
      // identity evidence than a nearby generic he/she tag. Never let the verifier undo that
      // identity with mere pronoun proximity.
      if (prior?.evidence === 'anonymous-speaker-backfilled-by-self-identification'
          && String(truth.evidence ?? '').startsWith('speaker-truth-pronoun-tag:')) {
        confirmations += 1;
        continue;
      }
      const priorSingle = prior?.speaker ?? null;
      const priorCollective = prior?.speakers ?? null;
      const same = truth.speakers?.length
        ? priorCollective && JSON.stringify([...priorCollective].sort()) === JSON.stringify([...truth.speakers].sort())
        : priorSingle === truth.speaker;
      if (same) {
        confirmations += 1;
        // A truth verifier confirmation is also an authority upgrade. This matters when the
        // parser had a confident-but-wrong candidate: the review builder must trust the explicit
        // same-paragraph/tag truth instead of falling back to that original candidate.
        if (truth.authority === 'truth-override' && prior?.authority !== 'truth-override') {
          resolutions.set(id, freeze(truth));
          changed += 1;
        }
        continue;
      }
      if (prior) corrections += 1;
      resolutions.set(id, freeze(truth));
      if (truth.provisional && truth.speaker) provisionalMentions.set(truth.speaker, Math.max(1, provisionalMentions.get(truth.speaker) ?? 0));
      changed += 1;
    }
    if (!changed) break;
  }
  counts.speakerTruthCorrections = corrections;
  counts.speakerTruthConfirmations = confirmations;
  return { corrections, confirmations };
}

function explicitCollectiveDialogueResolution(rows, index, aliases) {
  const row = rows[index];
  const before = sameScene(row, rows[index - 1]) ? clean(rows[index - 1].segment.text) : '';
  const after = sameScene(row, rows[index + 1]) ? clean(rows[index + 1].segment.text) : '';
  if (!/^they\s+(?:said|shouted|called|answered|replied)\s+together\b/i.test(after)) return null;
  // Collective delivery must be explicit. Prefer the immediately preceding actor sentence so
  // unrelated nearby cast members never get swept into a multi-speaker binding.
  let speakers = aliasesInText(before).filter((name) => name !== 'Narrator' && !BOOK_ONE_SCENE_LOCAL_CANDIDATES.includes(name));
  if (speakers.length < 2) {
    const earlier = sameScene(row, rows[index - 2]) ? clean(rows[index - 2].segment.text) : '';
    speakers = aliasesInText(`${earlier} ${before}`).filter((name) => name !== 'Narrator' && !BOOK_ONE_SCENE_LOCAL_CANDIDATES.includes(name));
  }
  const unique = [...new Set(speakers)];
  if (unique.length < 2 || unique.length > 3) return null;
  return freeze({ speakers: freeze(unique), confidence: 0.995, evidence: 'explicit-collective-together', classification: 'collective-dialogue', authority: 'override' });
}

function sameParagraphResolution(rows, index, aliases, resolutions) {
  const row = rows[index];
  const beforeRow = rows[index - 1];
  const afterRow = rows[index + 1];
  const before = sameParagraph(row, beforeRow) ? clean(beforeRow.segment.text) : '';
  const after = sameParagraph(row, afterRow) ? clean(afterRow.segment.text) : '';
  if (!before && !after) return null;

  if (/\bthey\s+(?:said|shouted|called|answered|replied)\s+together\b/i.test(after)) {
    const trail = `${sameScene(row, rows[index - 2]) ? clean(rows[index - 2].segment.text) : ''} ${before}`;
    const speakers = aliasesInText(trail).filter((name) => !BOOK_ONE_SCENE_LOCAL_CANDIDATES.includes(name));
    const unique = [...new Set(speakers)].filter((name) => name !== 'Narrator');
    if (unique.length >= 2 && unique.length <= 3) {
      return freeze({ speakers: freeze(unique), confidence: 0.99, evidence: 'same-paragraph-collective-tag', classification: 'collective-dialogue', authority: 'override' });
    }
  }

  for (const text of [before, after]) {
    if (!text) continue;
    const relational = relationalSubject(text, Number(row.chapter.order)) ?? relationalMention(text, Number(row.chapter.order));
    if (relational) {
      const role = roleByCanonicalName(relational);
      return freeze({ speaker: relational, confidence: 0.97, evidence: 'same-paragraph-relational-attribution', classification: 'spoken-dialogue', provisional: true, continuityScope: role?.continuityScope ?? 'book', authority: 'override' });
    }
  }

  const contextual = contextualRoleFromContext(row, before, after, extendedBefore(rows, index, 8));
  if (contextual) {
    return freeze({ speaker: contextual.canonicalName, confidence: 0.98, evidence: 'same-paragraph-scene-local-attribution', classification: 'spoken-dialogue', provisional: true, continuityScope: 'scene', authority: 'override' });
  }

  // A same-paragraph gendered tag is stronger than nearby proper nouns. Resolve the pronoun
  // before looking at names so object mentions such as \"gave Michael a hug\" cannot steal
  // a line from the woman whose \"Her lips...\" narration actually owns it.
  const pronoun = pronounFromSameParagraphText(`${before} ${after}`);
  if (pronoun) {
    const speaker = paragraphPronounSpeaker(rows, index, pronoun, aliases, resolutions);
    if (speaker) {
      const role = roleByCanonicalName(speaker);
      return freeze({ speaker, confidence: 0.94, evidence: `same-paragraph-pronoun-attribution:${pronoun}`, classification: 'spoken-dialogue', provisional: Boolean(role), continuityScope: role?.continuityScope ?? 'book', authority: 'override' });
    }
  }

  // If the previous quote is in the exact same paragraph and has already been resolved,
  // a pronoun-only interstitial tag (\"he said\") continues that speaker unless the current
  // line explicitly addresses them.
  if (sameParagraph(row, rows[index - 2]) && rows[index - 2]?.segment?.kind === 'dialogue') {
    const priorId = segmentIdForRow(rows[index - 2]);
    const priorResolved = resolutions.get(priorId);
    const addressed = addressedCanonicalName(row.segment.text, aliases);
    if (priorResolved?.speaker && priorResolved.speaker !== 'Narrator' && priorResolved.speaker !== addressed
      && /^(?:he|she)\s+(?:said|asked|replied|answered|whispered|murmured|added|continued)\b/i.test(before)) {
      return freeze({ speaker: priorResolved.speaker, confidence: 0.97, evidence: 'same-paragraph-prior-speaker-continuation', classification: 'spoken-dialogue', authority: 'override' });
    }
  }

  const addressed = addressedCanonicalName(row.segment.text, aliases);
  for (const text of [before, after]) {
    if (!text) continue;
    // Only accept a real grammatical subject here. Broad \"name somewhere before an action\"
    // matching is intentionally excluded because it can turn objects/addressees into speakers.
    const named = canonicalSubjectLike(text);
    if (named && named !== addressed) {
      const role = roleByCanonicalName(named);
      return freeze({ speaker: named, confidence: 0.96, evidence: 'same-paragraph-named-attribution', classification: 'spoken-dialogue', continuityScope: role?.continuityScope ?? 'book', authority: 'override' });
    }
    const names = aliasesInText(text);
    if (names.length === 1 && names[0] !== addressed && !explicitAnonymousActor(text)
      && new RegExp(`^(?:(?:then|finally|meanwhile|later)\\s+)?${escaped((CANONICAL_ALIASES[names[0]] ?? [names[0]])[0] ?? names[0])}\\b`, 'i').test(text)) {
      const role = roleByCanonicalName(names[0]);
      return freeze({ speaker: names[0], confidence: 0.93, evidence: 'same-paragraph-single-subject', classification: 'spoken-dialogue', continuityScope: role?.continuityScope ?? 'book', authority: 'override' });
    }
  }
  return null;
}

function futureSelfIdentificationResolution(rows, index, aliases) {
  const row = rows[index];
  let sawAnonymous = false;
  // Look backward across the immediate local run because one anonymous introduction can
  // own multiple quote fragments before the person identifies themself.
  for (let offset = 1; offset <= 5; offset += 1) {
    const probe = rows[index - offset];
    if (!sameScene(row, probe)) break;
    if (explicitAnonymousActor(probe.segment.text)) { sawAnonymous = true; break; }
    if (probe.segment.kind === 'dialogue') {
      const known = canon(probe.segment.speakerCandidate?.name, aliases);
      if (known && Number(probe.segment.speakerCandidate?.confidence ?? 0) >= 0.75) break;
    }
  }
  for (let offset = 1; offset <= 8; offset += 1) {
    const probe = rows[index + offset];
    if (!sameScene(row, probe)) break;
    if (probe.segment.kind === 'narration' && explicitAnonymousActor(probe.segment.text)) sawAnonymous = true;
    if (probe.segment.kind !== 'dialogue') continue;
    const self = selfIdentifiedSpeaker(probe.segment.text, aliases);
    if (self && sawAnonymous) return freeze({ speaker: self, confidence: 0.97, evidence: 'anonymous-speaker-backfilled-by-self-identification', classification: 'spoken-dialogue', authority: 'override' });
    const known = canon(probe.segment.speakerCandidate?.name, aliases);
    if (known && Number(probe.segment.speakerCandidate?.confidence ?? 0) >= 0.75 && !sawAnonymous) break;
  }
  return null;
}

function residualContextResolution(rows, index, aliases, resolutions) {
  const row = rows[index];
  const before = sameScene(row, rows[index - 1]) ? clean(rows[index - 1].segment.text) : '';
  const after = sameScene(row, rows[index + 1]) ? clean(rows[index + 1].segment.text) : '';

  // Final safe closures for the handful of residual patterns left after 0.11.5.
  // 1) A pronoun voice lead inherits the nearest compatible named antecedent.
  const voiceLead = /^(his|her) voice\b/i.exec(before);
  if (voiceLead) {
    const pronoun = voiceLead[1].toLowerCase() === 'his' ? 'he' : 'she';
    const antecedent = recentNamedAntecedent(rows, index, pronoun, 12);
    if (antecedent) {
      const role = roleByCanonicalName(antecedent);
      return freeze({ speaker: antecedent, confidence: 0.97, evidence: `residual-voice-antecedent:${pronoun}`, classification: 'spoken-dialogue', provisional: Boolean(role), continuityScope: role?.continuityScope ?? 'book', authority: 'override' });
    }
  }

  // 2) In a chapter-scoped relational scene, an immediate gendered action can safely inherit
  // the one active relational role of that gender (for example Michael's mother: "She hesitated...").
  const leadingPronoun = /^(she|her|he|his)\b/i.exec(before)?.[1]?.toLowerCase();
  if (leadingPronoun) {
    const pronoun = leadingPronoun === 'she' || leadingPronoun === 'her' ? 'she' : 'he';
    const relational = activeRelationalRoleNear(rows, index, pronoun, 12);
    if (relational) {
      return freeze({ speaker: relational.canonicalName, confidence: 0.97, evidence: `residual-relational-pronoun:${pronoun}`, classification: 'spoken-dialogue', provisional: true, continuityScope: relational.continuityScope ?? 'book', authority: 'override' });
    }
  }

  // 3) "A turned to B" followed by B reacting makes A the safe owner of the intervening line.
  // This is deliberately stricter than ordinary nearby-actor inference.
  const beforeSubject = canonicalSubjectLike(before) ?? canonicalOpeningSubject(before);
  const afterReactor = canonicalSubjectLike(after) ?? canonicalOpeningSubject(after);
  if (beforeSubject && afterReactor && beforeSubject !== afterReactor && /\bturned to\b/i.test(before)) {
    const afterAliases = CANONICAL_ALIASES[afterReactor] ?? [];
    if (afterAliases.some((alias) => new RegExp(`\\bturned to\\s+${escaped(alias)}\\b`, 'i').test(before))) {
      return freeze({ speaker: beforeSubject, confidence: 0.97, evidence: `residual-turn-to-reaction:${afterReactor}`, classification: 'spoken-dialogue', authority: 'override' });
    }
  }

  // Anonymous introductions that self-identify a few beats later outrank pronoun proximity.
  // This prevents "the guy ... he said" from being incorrectly inherited by the nearest known man.
  const selfBackfill = futureSelfIdentificationResolution(rows, index, aliases);
  if (selfBackfill) return selfBackfill;

  const paragraph = sameParagraphResolution(rows, index, aliases, resolutions);
  if (paragraph) return paragraph;

  // A named person can own a line when the immediately preceding narration explicitly says
  // their words/voice broke out, or when the next known speaker is a relational role while
  // a different named person visibly reacts to the current line.
  const namesBefore = aliasesInText(before);
  if (namesBefore.length === 1 && /\b(?:burst|poured|came)\s+out\s+of\b|\bbroke\s+(?:it|the silence)\b/i.test(before)) {
    return freeze({ speaker: namesBefore[0], confidence: 0.95, evidence: 'residual-explicit-speech-lead', classification: 'spoken-dialogue', authority: 'override' });
  }

  const reactor = canonicalLeadSpeakerAcrossText(after) ?? canonicalSubjectLike(after);
  const nextSpeaker = nearestNextDialogueSpeaker(rows, index, aliases, resolutions, 5);
  if (reactor && nextSpeaker && reactor !== nextSpeaker) {
    const role = roleByCanonicalName(nextSpeaker);
    if (role || speakerMatchesPronoun(nextSpeaker, 'he') || speakerMatchesPronoun(nextSpeaker, 'she')) {
      return freeze({ speaker: nextSpeaker, confidence: 0.9, evidence: `residual-reaction-exclusion:${reactor}`, classification: 'spoken-dialogue', provisional: Boolean(role), continuityScope: role?.continuityScope ?? 'book', authority: 'review-only' });
    }
  }

  return null;
}

function applyResidualFinalizer(rows, aliases, resolutions, counts, provisionalMentions) {
  let applied = 0;
  // Multiple passes let a newly closed split tag feed the next ambiguous turn without ever
  // overwriting an existing resolution.
  for (let pass = 0; pass < 4; pass += 1) {
    let changed = 0;
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      if (row.segment.kind !== 'dialogue' || String(row.chapter.title).toLowerCase() === 'front matter') continue;
      const id = segmentIdForRow(row);
      if (resolutions.has(id)) continue;
      const resolution = residualContextResolution(rows, i, aliases, resolutions);
      if (!resolution) continue;
      resolutions.set(id, freeze(resolution));
      if (resolution.speakers?.length) counts.collectiveDialogue += 1;
      else counts.residualContext += 1;
      if (resolution.provisional && resolution.speaker) provisionalMentions.set(resolution.speaker, (provisionalMentions.get(resolution.speaker) ?? 0) + 1);
      changed += 1;
      applied += 1;
    }
    if (!changed) break;
  }
  return applied;
}

export function buildDialogueIntelligence(ingestResult, { aliases = BOOK_ONE_PROFILE.aliases } = {}) {
  const rows = analysisRowsForIntelligence(ingestResult);
  const resolutions = new Map();
  const provisionalMentions = new Map();
  const sceneStats = buildSceneSpeakerStats(rows, aliases);
  const counts = {
    quotedNarration: 0,
    collectiveSpeech: 0,
    selfIdentified: 0,
    explicitContext: 0,
    pronounContext: 0,
    pronounAfterTag: 0,
    directAddress: 0,
    relationalRole: 0,
    contextualRole: 0,
    twoSpeakerTurn: 0,
    reactionExclusion: 0,
    residualContext: 0,
    collectiveDialogue: 0,
    speakerTruthCorrections: 0,
    speakerTruthConfirmations: 0
  };

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (row.segment.kind !== 'dialogue' || String(row.chapter.title).toLowerCase() === 'front matter') continue;
    const before = sameScene(row, rows[i - 1]) ? clean(rows[i - 1].segment.text) : '';
    const after = sameScene(row, rows[i + 1]) ? clean(rows[i + 1].segment.text) : '';
    const segmentId = row.record?.id ?? `${row.chapter.order}:${row.scene.order}:${row.segment.order}`;

    const collective = explicitCollectiveDialogueResolution(rows, i, aliases);
    if (collective) {
      resolutions.set(segmentId, collective);
      counts.collectiveDialogue += 1;
      continue;
    }

    const narrated = classifyQuotedNarration(row.segment.text, before, after, { extendedBefore: extendedBefore(rows, i) });
    if (narrated) {
      resolutions.set(segmentId, freeze({ speaker: 'Narrator', confidence: narrated.confidence, evidence: narrated.evidence, classification: narrated.classification, authority: 'override' }));
      if (narrated.classification === 'collective-speech-narrated') counts.collectiveSpeech += 1;
      else counts.quotedNarration += 1;
      continue;
    }

    const self = selfIdentifiedSpeaker(row.segment.text, aliases);
    if (self) {
      resolutions.set(segmentId, freeze({ speaker: self, confidence: 0.995, evidence: 'self-identification', classification: 'spoken-dialogue', authority: 'override' }));
      counts.selfIdentified += 1;
      continue;
    }

    const rawCandidateName = clean(row.segment.speakerCandidate?.name);
    if (Number(row.chapter.order) === 34 && /^Derek$/i.test(rawCandidateName)) {
      const sceneMan = CONTEXTUAL_ROLES.find((role) => role.canonicalName === "New Year's Couple – Man (Derek)");
      resolutions.set(segmentId, freeze({ speaker: sceneMan.canonicalName, confidence: 0.97, evidence: 'scene-local-named-extra', classification: 'spoken-dialogue', provisional: true, authority: 'override' }));
      provisionalMentions.set(sceneMan.canonicalName, (provisionalMentions.get(sceneMan.canonicalName) ?? 0) + 1);
      counts.contextualRole += 1;
      continue;
    }

    const relational = relationalRoleFromContext(row, before, after);
    if (relational && relationalSpeechCue(relational, before, after)) {
      resolutions.set(segmentId, freeze({ speaker: relational.canonicalName, confidence: 0.92, evidence: 'relational-role-context', classification: 'spoken-dialogue', provisional: true, authority: 'review-only' }));
      provisionalMentions.set(relational.canonicalName, (provisionalMentions.get(relational.canonicalName) ?? 0) + 1);
      counts.relationalRole += 1;
      continue;
    }

    const contextual = contextualRoleFromContext(row, before, after, extendedBefore(rows, i, 6));
    if (contextual) {
      resolutions.set(segmentId, freeze({ speaker: contextual.canonicalName, confidence: 0.97, evidence: 'contextual-anonymous-role', classification: 'spoken-dialogue', provisional: true, authority: 'override' }));
      provisionalMentions.set(contextual.canonicalName, (provisionalMentions.get(contextual.canonicalName) ?? 0) + 1);
      counts.contextualRole += 1;
      continue;
    }

    const leadCue = leadCueResolution(rows, i);
    if (leadCue) {
      resolutions.set(segmentId, freeze({ ...leadCue, classification: 'spoken-dialogue', authority: 'review-only' }));
      counts.explicitContext += 1;
      continue;
    }

    const widerAfter = explicitSpeakerWithinAfter(rows, i, 3);
    if (widerAfter) {
      resolutions.set(segmentId, freeze({ speaker: widerAfter.speaker, confidence: widerAfter.offset === 1 ? 0.97 : 0.93, evidence: `post-dialogue-attribution:${widerAfter.offset}`, classification: 'spoken-dialogue', authority: 'review-only' }));
      counts.explicitContext += 1;
      continue;
    }

    const afterPronoun = pronounAfterTagResolution(rows, i, aliases, resolutions);
    if (afterPronoun) {
      resolutions.set(segmentId, freeze({ ...afterPronoun, classification: 'spoken-dialogue', authority: 'review-only' }));
      counts.pronounAfterTag += 1;
      continue;
    }

    const direct = directAddressExclusion(row.segment.text, rows, i, aliases, resolutions, sceneStats);
    if (direct) {
      resolutions.set(segmentId, freeze({ ...direct, classification: 'spoken-dialogue', authority: 'contradiction-override', addressed: addressedCanonicalName(row.segment.text, aliases) }));
      counts.directAddress += 1;
      continue;
    }

    const afterSpeaker = explicitAfterSpeechSpeaker(after, sameScene(row, rows[i + 2]) ? rows[i + 2] : null);
    if (afterSpeaker) {
      resolutions.set(segmentId, freeze({ speaker: afterSpeaker, confidence: 0.96, evidence: 'explicit-after-speech-tag', classification: 'spoken-dialogue', authority: 'review-only' }));
      counts.explicitContext += 1;
      continue;
    }

    const lead = canonicalLeadSpeaker(before);
    if (lead) {
      resolutions.set(segmentId, freeze({ speaker: lead, confidence: 0.93, evidence: 'preceding-speaker-lead', classification: 'spoken-dialogue', authority: 'review-only' }));
      counts.explicitContext += 1;
      continue;
    }

    const pronoun = pronounContextResolution(rows, i, aliases, resolutions);
    if (pronoun) {
      resolutions.set(segmentId, freeze({ ...pronoun, classification: 'spoken-dialogue', authority: 'review-only' }));
      counts.pronounContext += 1;
      continue;
    }

    const reaction = reactionExclusionResolution(rows, i, aliases, sceneStats);
    if (reaction) {
      resolutions.set(segmentId, freeze({ ...reaction, classification: 'spoken-dialogue', authority: 'review-only' }));
      counts.reactionExclusion += 1;
      continue;
    }

    const turn = twoSpeakerTurnResolution(rows, i, aliases, resolutions, sceneStats);
    if (turn) {
      resolutions.set(segmentId, freeze({ ...turn, classification: 'spoken-dialogue', authority: 'review-only' }));
      counts.twoSpeakerTurn += 1;
    }
  }

  applyResidualFinalizer(rows, aliases, resolutions, counts, provisionalMentions);
  applySpeakerTruthVerifier(rows, aliases, resolutions, counts, provisionalMentions);

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
      continuityScope: role.continuityScope ?? 'book',
      source: 'book-one-intelligence-relational-role',
      provisional: true
    }));

  const sceneLocalRoles = CONTEXTUAL_ROLES
    .filter((role) => provisionalMentions.has(role.canonicalName))
    .map((role) => freeze({
      canonicalName: role.canonicalName,
      aliases: freeze([...role.aliases]),
      role: role.role,
      mentions: provisionalMentions.get(role.canonicalName),
      averageConfidence: 0.94,
      highConfidenceMentions: provisionalMentions.get(role.canonicalName),
      inferredReviewMentions: 0,
      castingPriority: 4,
      seriesCharacterKey: null,
      castingStatus: 'scene-local',
      continuityScope: 'scene',
      chapterOrder: role.chapterOrder ?? role.chapterMin,
      source: 'book-one-intelligence-scene-local-role',
      provisional: true
    }));

  return freeze({
    resolutions,
    provisionalRoles: freeze(provisionalRoles),
    sceneLocalRoles: freeze(sceneLocalRoles),
    counts: freeze({ ...counts }),
    autoResolutionCount: resolutions.size
  });
}

export function intelligenceResolutionFor(intelligence, segmentId) {
  return intelligence?.resolutions?.get(segmentId) ?? null;
}
