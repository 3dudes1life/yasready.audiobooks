import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  BookOneAudioBiblePrepService,
  InMemoryStore,
  buildBookOneCharacterPlan,
  buildDialogueReviewQueue,
  buildPronunciationReview,
  buildDialogueIntelligence,
  classifyQuotedNarration,
  classifyBookOneCharacter,
  renderDialogueReviewCsv,
  reconcileBookOneContinuity,
  computeBookOneAudioBibleLock
} from '../src/index.js';
import { analyzeManuscript } from '../src/manuscript/analyzer.js';

function fakeSupermanReport() {
  return {
    characterDiscovery: {
      candidates: [
        { name: 'Juan Delgado', mentions: 611, averageConfidence: 0.788, highConfidenceMentions: 592, inferredReviewMentions: 19, observedAs: ['Juan', 'Delgado'] },
        { name: 'Michael Rawlins', mentions: 500, averageConfidence: 0.784, highConfidenceMentions: 474, inferredReviewMentions: 26, observedAs: ['Michael', 'Micheal', 'Rawlins', 'Then Michael'] },
        { name: 'Christopher Lancaster', mentions: 315, averageConfidence: 0.787, highConfidenceMentions: 305, inferredReviewMentions: 10, observedAs: ['Chris', 'Christopher'] },
        { name: 'Dani', mentions: 39, averageConfidence: 0.794, highConfidenceMentions: 38, inferredReviewMentions: 1, observedAs: ['Dani'] },
        { name: 'Derek', mentions: 2, averageConfidence: 0.88, highConfidenceMentions: 2, inferredReviewMentions: 0, observedAs: ['Derek'] }
      ]
    }
  };
}

function ingestShape(text) {
  const analysis = analyzeManuscript({
    format: 'txt', filename: 'fixture.txt', sourceHash: 'fixture-source',
    metadata: { title: 'Tres Amigos, Una Vida – A Throuple Love Story', author: 'D.C.W.', language: 'en' }, text
  });
  const records = [];
  let n = 0;
  for (const chapter of analysis.chapters) for (const scene of chapter.scenes) for (const segment of scene.segments) {
    records.push({ id: `seg-${n++}`, type: 'segment', ...segment });
  }
  return { analysis, segments: records };
}

function segmentIdFor(ingest, dialogue) {
  let flat = 0;
  for (const chapter of ingest.analysis.chapters) for (const scene of chapter.scenes) for (const segment of scene.segments) {
    const record = ingest.segments?.[flat] ?? null;
    flat += 1;
    if (segment.kind === 'dialogue' && segment.text === dialogue) return record?.id ?? null;
  }
  return null;
}

test('Book One character tiers keep the core three primary and supporting/minor tiers conservative', () => {
  assert.equal(classifyBookOneCharacter({ name: 'Michael Rawlins', mentions: 1 }), 'primary');
  assert.equal(classifyBookOneCharacter({ name: 'Dani', mentions: 39 }), 'supporting');
  assert.equal(classifyBookOneCharacter({ name: 'Derek', mentions: 2 }), 'minor');
});

test('character plan includes narrator, strips discourse artifact aliases, and keeps source typo alias for resolution', () => {
  const plan = buildBookOneCharacterPlan(fakeSupermanReport());
  assert.equal(plan[0].canonicalName, 'Narrator');
  assert.equal(plan.filter((x) => x.role === 'primary').length, 3);
  const michael = plan.find((x) => x.canonicalName === 'Michael Rawlins');
  assert.ok(michael.aliases.includes('Micheal'));
  assert.equal(michael.aliases.includes('Then Michael'), false);
  assert.equal(michael.seriesCharacterKey, 'michael-rawlins');
});

test('dialogue review queue excludes safe and intelligence-resolved lines while preserving truly ambiguous dialogue', () => {
  const ingest = ingestShape('Chapter 1\n\nMichael said, “High.”\n\n* * *\n\nThe hallway was empty.\n\n“Who the hell are you?”\n\nThe door slammed shut.\n\n* * *\n\nJuan replied, “Known.”');
  const review = buildDialogueReviewQueue(ingest);
  assert.ok(review.autoBindable >= 2);
  assert.equal(review.needsReview, 1);
  assert.equal(review.queue[0].dialogue, 'Who the hell are you?');
  assert.equal(review.queue[0].priority, 'manual-identify');
  assert.equal(review.queue.every((x) => x.status === 'inferred-review' || x.status === 'unresolved'), true);
});

test('dialogue review queue keeps ambiguous nearby-speaker cases blank for human decision', () => {
  const ingest = ingestShape('Chapter 1\n\nMichael said, “First.”\n\nThe lights flickered.\n\n“Who said this?”\n\nThe room went quiet.\n\nJuan replied, “Third.”');
  const review = buildDialogueReviewQueue(ingest, { intelligence: { resolutions: new Map(), provisionalRoles: [], counts: {} } });
  const row = review.queue.find((x) => x.dialogue === 'Who said this?');
  assert.ok(row);
  assert.ok(row.suggestedSpeakers.some((x) => ['Michael Rawlins', 'Juan Delgado'].includes(x.name)));
  assert.equal(row.selectedSpeaker, '');
  assert.equal(row.decision, '');
});

test('dialogue CSV safely quotes manuscript excerpts and leaves decision fields blank', () => {
  const ingest = ingestShape('Chapter 1\n\nMichael said, “Known.”\n\n“Hello, \"world\".”');
  const review = buildDialogueReviewQueue(ingest);
  const csv = renderDialogueReviewCsv(review);
  assert.match(csv, /selected_speaker/);
  assert.match(csv, /decision/);
  assert.match(csv, /Hello/);
});

test('pronunciation review closes standard orthography without inventing overrides', () => {
  const ingest = ingestShape('Chapter 1\n\nMichael said, “We went to San Francisco with Juan.”\n\nThey returned to San Francisco later.');
  const plan = buildBookOneCharacterPlan(fakeSupermanReport());
  const pronunciation = buildPronunciationReview(ingest, plan);
  const michael = pronunciation.candidates.find((x) => x.term === 'Michael Rawlins');
  const title = pronunciation.candidates.find((x) => x.term === 'Tres Amigos, Una Vida – A Throuple Love Story');
  assert.ok(michael);
  assert.ok(title);
  assert.equal(michael.status, 'standard-reading');
  assert.equal(michael.spokenAs, '');
  assert.equal(title.status, 'standard-reading');
  assert.equal(pronunciation.needsConfirmation, 0);
  assert.equal(pronunciation.noUnboundedGuessesMade, true);
});

test('Book One Audio Bible Prep creates a real bible, characters and high-confidence speaker bindings with zero provider calls', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'yasready-prep-test-'));
  const file = path.join(dir, 'book.txt');
  try {
    await writeFile(file, [
      'Book Title', '', 'by D.C.W.', '', 'Copyright 2026', '',
      'Chapter 1: Departure', '',
      'Michael said, “High confidence.”', '',
      'Michael raised an eyebrow.', '',
      '“Context inference.”', '',
      '“Unresolved line.”', '',
      'Juan replied, “Known Juan.”', '',
      'Chapter 2: Return', '',
      'Christopher said, “Known Chris.”'
    ].join('\n'));
    const store = new InMemoryStore();
    const service = new BookOneAudioBiblePrepService(store);
    const result = await service.runFile(file, { title: 'Tres Amigos, Una Vida – A Throuple Love Story' });
    assert.equal(result.prep.providerCallsPerformed, 0);
    assert.equal(result.prep.gates.paidGenerationArmed, false);
    assert.ok(result.prep.characterPlan.some((x) => x.canonicalName === 'Narrator'));
    assert.ok(store.list('audio_bible').length === 1);
    assert.ok(store.list('speaker_binding').length > 0);
    const binding = store.list('speaker_binding')[0];
    assert.ok(binding.confidence <= 1 && binding.confidence >= 0.75);
    assert.notEqual(binding.evidence, null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('Audio Bible Prep leaves genuinely ambiguous dialogue unbound for operator review', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'yasready-prep-review-'));
  const file = path.join(dir, 'book.txt');
  try {
    await writeFile(file, 'Chapter 1\n\nMichael said, “Known.”\n\n* * *\n\nThe hallway was empty.\n\n“Who the hell are you?”\n\nThe door slammed shut.\n\n* * *\n\nJuan replied, “Known.”');
    const store = new InMemoryStore();
    const service = new BookOneAudioBiblePrepService(store);
    const result = await service.runFile(file);
    assert.equal(result.prep.dialogueReview.needsReview, 1);
    assert.equal(result.prep.dialogueReview.queue[0].dialogue, 'Who the hell are you?');
    assert.ok(result.prep.continuity.unresolvedDialogueSegments >= result.prep.dialogueReview.needsReview);
    assert.equal(result.prep.gates.productionReady, false);
    assert.equal(result.prep.gates.primaryCastingCanBegin, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});


test('0.11.3 classifies quoted labels and displayed text as narrator instead of fake dialogue speakers', () => {
  const result = classifyQuotedNarration('Loan Docs Attached', 'There were emails with subject lines like', 'and');
  assert.ok(result);
  assert.equal(result.classification, 'displayed-text');
  assert.equal(result.evidence, 'quoted-display-label');
});

test('0.11.3 resolves explicit self-identification without a human review row', () => {
  const ingest = ingestShape('Chapter 1\n\nHe extended a hand.\n\n“I’m Christopher.”\n\nJuan shook it.');
  const intelligence = buildDialogueIntelligence(ingest);
  const review = buildDialogueReviewQueue(ingest, { intelligence });
  assert.equal(review.needsReview, 0);
  assert.ok(review.autoBindings.some((x) => x.speaker === 'Christopher Lancaster' && x.evidence === 'self-identification'));
});

test('0.11.3 creates provisional relational roles only when contextual evidence supports them', () => {
  const ingest = JSON.parse(JSON.stringify(ingestShape('Chapter 24 – When the Call Comes\n\nMichael’s mother came out to the porch.\n\n“You’ve changed, son.”\n\nshe said softly.')));
  ingest.analysis.chapters[0].order = 24;
  const intelligence = buildDialogueIntelligence(ingest);
  assert.ok(intelligence.provisionalRoles.some((x) => x.canonicalName === "Michael's Mother"));
  const review = buildDialogueReviewQueue(ingest, { intelligence });
  assert.equal(review.needsReview, 0);
  assert.ok(review.autoBindings.some((x) => x.speaker === "Michael's Mother"));
});

test('0.11.3 focused pronunciation review avoids broad obvious-name harvesting and 0.11.8 applies bounded defaults', () => {
  const ingest = ingestShape('Chapter 1\n\nMichael said, “Te amo, Juan.”\n\nThey went from San Diego to Clairemont and discussed DJ work and IG posts.');
  const plan = buildBookOneCharacterPlan(fakeSupermanReport());
  const pronunciation = buildPronunciationReview(ingest, plan);
  const terms = new Set(pronunciation.candidates.map((x) => x.term));
  assert.ok(terms.has('Te amo'));
  assert.ok(terms.has('Clairemont'));
  assert.equal(terms.has('San Diego'), false);
  assert.equal(pronunciation.noUnboundedGuessesMade, true);
  assert.equal(pronunciation.needsConfirmation, 0);
  assert.equal(pronunciation.candidates.find((x) => x.term === 'Te amo')?.spokenAs, 'Te amo');
  assert.equal(pronunciation.candidates.find((x) => x.term === 'Clairemont')?.status, 'standard-reading');
});

test('0.11.4 closes remaining quoted sign, news, message, hypothetical, and performance-title false dialogue', () => {
  const cases = [
    classifyQuotedNarration('Tacos & Truth.', 'Their booth was tucked in the back, under a sign that read', 'Chips were flowing.'),
    classifyQuotedNarration('atmospheric river.', 'the kind the news called an', 'Towering waves followed.'),
    classifyQuotedNarration('nightclub hooligan.', '[Leo]: Mom wants to know if you are still a', 'haha'),
    classifyQuotedNarration('Can we talk?', 'Not', 'Not'),
    classifyQuotedNarration('Toxic.', 'A drag queen emerged, performing', 'Juan shot out of his seat.')
  ];
  assert.equal(cases.every(Boolean), true);
  assert.equal(cases[2].classification, 'displayed-text');
  assert.equal(cases[3].evidence, 'hypothetical-quote-not-spoken');
  assert.equal(cases[4].evidence, 'performance-title-not-dialogue');
});

test('0.11.4 direct-address exclusion can override a confidently wrong addressee candidate in a stable two-person scene', () => {
  const ingest = JSON.parse(JSON.stringify(ingestShape([
    'Chapter 1', '',
    'Michael said, “One.”', '',
    'Juan said, “Two.”', '',
    'Michael said, “Three.”', '',
    'Juan said, “Four.”', '',
    'He hesitated, then exhaled.', '',
    '“Te amo, Michael.”', '',
    'Michael froze.'
  ].join('\n'))));
  let target = null;
  for (const chapter of ingest.analysis.chapters) for (const scene of chapter.scenes) for (const segment of scene.segments) {
    if (segment.text === 'Te amo, Michael.') target = segment;
  }
  assert.ok(target);
  target.speakerCandidate = { name: 'Michael', confidence: 0.77, evidence: 'context-before-action' };
  const intelligence = buildDialogueIntelligence(ingest);
  const review = buildDialogueReviewQueue(ingest, { intelligence });
  const binding = review.autoBindings.find((x) => x.segmentId && x.evidence.includes('direct-address-exclusion'));
  assert.ok(binding);
  assert.equal(binding.speaker, 'Juan Delgado');
  assert.equal(review.queue.some((x) => x.dialogue === 'Te amo, Michael.'), false);
  assert.ok(review.correctedSafeBindings >= 1);
});

test('0.11.4 relational speaker evidence wins before direct-address guessing', () => {
  const ingest = JSON.parse(JSON.stringify(ingestShape([
    'Chapter 25 – The Weight of Goodbye', '',
    'Michael turned just in time to see his brother in the doorway.', '',
    '“You’ve gotta be kidding me, Michael!”', '',
    'his brother said, stepping outside.'
  ].join('\n'))));
  ingest.analysis.chapters[0].order = 25;
  const intelligence = buildDialogueIntelligence(ingest);
  const review = buildDialogueReviewQueue(ingest, { intelligence });
  assert.ok(intelligence.provisionalRoles.some((x) => x.canonicalName === "Michael's Brother"));
  assert.ok(review.autoBindings.some((x) => x.speaker === "Michael's Brother" && x.evidence === 'relational-role-context'));
});

test('0.11.4 does not let two-speaker reaction logic swallow an explicitly anonymous third speaker', () => {
  const ingest = JSON.parse(JSON.stringify(ingestShape([
    'Chapter 1', '',
    'Michael said, “One.”', '',
    'Juan said, “Two.”', '',
    'Michael said, “Three.”', '',
    'Juan said, “Four.”', '',
    'Before Michael could answer, someone nearby called out.', '',
    '“Yo, are you two coming?”', '',
    'Juan turned eagerly.'
  ].join('\n'))));
  let target = null;
  for (const chapter of ingest.analysis.chapters) for (const scene of chapter.scenes) for (const segment of scene.segments) {
    if (segment.text === 'Yo, are you two coming?') target = segment;
  }
  assert.ok(target);
  target.speakerCandidate = { name: 'Michael', confidence: 0.68, evidence: 'context-alternating-pair' };
  const intelligence = buildDialogueIntelligence(ingest);
  const review = buildDialogueReviewQueue(ingest, { intelligence });
  assert.equal(review.autoBindings.some((x) => x.segmentId && x.evidence.includes('reaction-exclusion')), false);
  assert.ok(review.queue.some((x) => x.dialogue === 'Yo, are you two coming?'));
});

test('0.11.4 alternating-pair guesses are never labeled quick-confirm', () => {
  const ingest = JSON.parse(JSON.stringify(ingestShape('Chapter 1\n\nMichael said, “First.”\n\n“Maybe.”\n\nMichael said, “Third.”')));
  let target = null;
  for (const chapter of ingest.analysis.chapters) for (const scene of chapter.scenes) for (const segment of scene.segments) {
    if (segment.text === 'Maybe.') target = segment;
  }
  assert.ok(target);
  target.speakerCandidate = { name: 'Michael', confidence: 0.68, evidence: 'context-alternating-pair' };
  const review = buildDialogueReviewQueue(ingest, { intelligence: { resolutions: new Map(), provisionalRoles: [], counts: {} } });
  const row = review.queue.find((x) => x.dialogue === 'Maybe.');
  assert.ok(row);
  assert.equal(row.priority, 'context-review');
});

test('0.11.4 prep accounting uses applied narrator routing as the single quoted-text source of truth', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'yasready-prep-0114-accounting-'));
  const file = path.join(dir, 'book.txt');
  try {
    await writeFile(file, 'Chapter 1\n\nThe booth sat under a sign that read “Tacos & Truth.”\n\nMichael said, “Hello.”');
    const store = new InMemoryStore();
    const service = new BookOneAudioBiblePrepService(store);
    const result = await service.runFile(file);
    assert.equal(result.prep.release, '0.14.3');
    assert.equal(result.prep.provenance.applicationRelease, '0.14.3');
    assert.equal(result.prep.provenance.prepEngineRelease, '0.11.8');
    assert.equal(result.prep.intelligence.resolutionCounts.narratorRouted, result.prep.dialogueReview.quotedNarrationSegments);
    assert.equal(result.prep.providerCallsPerformed, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('0.11.5 reaction verbs do not steal an ambiguous quote from a prior known speaker', () => {
  const ingest = ingestShape([
    'Chapter 1', '',
    'Juan said, “Absolutely not.”', '',
    '“Oh heck no.”', '',
    'She gasped.'
  ].join('\n'));
  const intelligence = buildDialogueIntelligence(ingest);
  const review = buildDialogueReviewQueue(ingest, { intelligence });
  const row = review.queue.find((x) => x.dialogue === 'Oh heck no.');
  assert.ok(row, 'reaction-only evidence must remain reviewable');
  assert.equal(review.autoBindings.some((x) => x.segmentId === segmentIdFor(ingest, 'Oh heck no.')), false);
});

test('0.11.5 an explicit anonymous actor blocks pronoun fallback to the core cast', () => {
  const ingest = ingestShape([
    'Chapter 1', '',
    'Juan leaned against the bar.', '',
    'The guy smiled at him.', '',
    '“Hell of a set,”', '',
    'he said.'
  ].join('\n'));
  const intelligence = buildDialogueIntelligence(ingest);
  const review = buildDialogueReviewQueue(ingest, { intelligence });
  assert.ok(review.queue.some((x) => x.dialogue === 'Hell of a set,'));
  assert.equal(review.autoBindings.some((x) => x.segmentId === segmentIdFor(ingest, 'Hell of a set,') && ['Juan Delgado', 'Michael Rawlins', 'Christopher Lancaster'].includes(x.speaker)), false);
});

test('0.11.5 split pronoun tags inherit a nearby explicitly named actor conservatively', () => {
  const ingest = ingestShape([
    'Chapter 1', '',
    'Michael stepped onto the porch and rubbed the back of his neck.', '',
    '“Hey,”', '',
    'he said.'
  ].join('\n'));
  const intelligence = buildDialogueIntelligence(ingest);
  const review = buildDialogueReviewQueue(ingest, { intelligence });
  assert.equal(review.queue.some((x) => x.dialogue === 'Hey,'), false);
  assert.ok(review.autoBindings.some((x) => x.segmentId === segmentIdFor(ingest, 'Hey,') && x.speaker === 'Michael Rawlins' && /pronoun-after-tag/.test(x.evidence)));
});

test('0.11.5 carries a resolved pronoun speaker across split dialogue-tag-dialogue fragments', () => {
  const ingest = ingestShape([
    'Chapter 1', '',
    'Juan yanked open the envelope and stared at the page.', '',
    '“Fuck me,”', '',
    'he whispered.', '',
    '“The bill.”'
  ].join('\n'));
  const intelligence = buildDialogueIntelligence(ingest);
  const review = buildDialogueReviewQueue(ingest, { intelligence });
  assert.equal(review.queue.some((x) => ['Fuck me,', 'The bill.'].includes(x.dialogue)), false);
  assert.ok(review.autoBindings.some((x) => x.segmentId === segmentIdFor(ingest, 'Fuck me,') && x.speaker === 'Juan Delgado'));
  assert.ok(review.autoBindings.some((x) => x.segmentId === segmentIdFor(ingest, 'The bill.') && x.speaker === 'Juan Delgado'));
});

test('0.11.5 creates a contextual anonymous role instead of forcing a core-cast speaker', () => {
  const ingest = JSON.parse(JSON.stringify(ingestShape([
    'Chapter 20 – Housewarming', '',
    'One of Juan’s friends leaned closer with a grin.', '',
    '“Are you guys a throuple?”'
  ].join('\n'))));
  ingest.analysis.chapters[0].order = 20;
  const intelligence = buildDialogueIntelligence(ingest);
  const review = buildDialogueReviewQueue(ingest, { intelligence });
  assert.equal(intelligence.provisionalRoles.some((x) => /Juan's Friend/.test(x.canonicalName)), false);
  assert.ok(intelligence.sceneLocalRoles.some((x) => x.canonicalName === "Juan's Friend"));
  assert.ok(review.sceneLocalBindings.some((x) => x.segmentId === segmentIdFor(ingest, 'Are you guys a throuple?') && x.speaker === "Juan's Friend"));
  assert.equal(review.autoBindings.some((x) => /Juan's Friend/.test(x.speaker)), false);
});

test('0.11.5 closes safe embedded, label, playlist and collective-reveal quote patterns', () => {
  assert.equal(classifyQuotedNarration('g’day.', 'The first time he said', 'It became an inside joke.')?.evidence, 'embedded-example-quote');
  assert.equal(classifyQuotedNarration('emotional support boyfriend.', 'He was the self-declared', 'The room laughed.')?.evidence, 'self-declared-label');
  assert.equal(classifyQuotedNarration('S’mores & Gay Screams.', 'He queued the playlist titled', 'They kept dancing.')?.evidence, 'playlist-title');
  assert.equal(classifyQuotedNarration('Surprise!', 'The doors opened.', 'The patio crowd erupted into cheers.')?.classification, 'collective-speech-narrated');
});

test('0.11.5 prep exports explicit Superman engine provenance instead of a stale-looking nested release', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'yasready-prep-0115-provenance-'));
  const file = path.join(dir, 'book.txt');
  try {
    await writeFile(file, 'Chapter 1\n\nMichael said, “Hello.”\n\nJuan replied, “Hi.”');
    const store = new InMemoryStore();
    const service = new BookOneAudioBiblePrepService(store);
    const result = await service.runFile(file);
    assert.equal(result.prep.release, '0.14.3');
    assert.equal(result.prep.schemaVersion, 8);
    assert.equal(result.prep.provenance.applicationRelease, '0.14.3');
    assert.equal(result.prep.provenance.artifactRelease, '0.14.3');
    assert.equal(result.prep.provenance.prepEngineRelease, '0.11.8');
    assert.equal(result.prep.provenance.supermanEngineRelease, result.prep.superman.engineRelease);
    assert.equal(result.prep.audioBible.lockEngineRelease, result.prep.gates.productionReady ? '0.11.8' : null);
    assert.equal(typeof result.prep.superman.engineRelease, 'string');
    assert.equal(Object.hasOwn(result.prep.superman, 'release'), false);
    assert.equal(result.prep.providerCallsPerformed, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});


test('0.11.6 does not promote Derek or scene-local extras into the permanent Book One continuity roster', () => {
  const report = fakeSupermanReport();
  report.characterDiscovery.candidates.push({ name: 'Derek', observedAs: ['Derek'], mentions: 2, averageConfidence: 0.88, highConfidenceMentions: 2, inferredReviewMentions: 0 });
  const plan = buildBookOneCharacterPlan(report, { provisionalRoles: [] });
  assert.equal(plan.some((x) => x.canonicalName === 'Derek'), false);
  assert.equal(plan.some((x) => /New Year's Couple|Girlfriend/.test(x.canonicalName)), false);
});

test('0.11.6 names the anonymous New Years woman as a scene-local role, not Dereks Girlfriend', () => {
  const ingest = JSON.parse(JSON.stringify(ingestShape([
    'Chapter 34 - New Years Eve', '',
    'A straight couple nearby erupted into an argument. Her boyfriend Derek shrugged.', '',
    '“Are you bisexual now?”', '',
    'she demanded.'
  ].join('\n'))));
  ingest.analysis.chapters[0].order = 34;
  const intelligence = buildDialogueIntelligence(ingest);
  assert.equal(intelligence.provisionalRoles.some((x) => /Derek|Girlfriend|New Year's Eve/.test(x.canonicalName)), false);
  const woman = intelligence.sceneLocalRoles.find((x) => x.canonicalName === "New Year's Couple – Woman");
  assert.ok(woman);
  assert.equal(woman.continuityScope, 'scene');
  assert.equal(woman.seriesCharacterKey, null);
});

test('0.11.6 resolves explicit post-dialogue attribution such as Micheal exclaimed', () => {
  const ingest = ingestShape(['Chapter 1', '', 'They stared at the screen.', '', '“He really wants this.”', '', 'Micheal exclaimed.'].join('\n'));
  const intelligence = buildDialogueIntelligence(ingest);
  const review = buildDialogueReviewQueue(ingest, { intelligence });
  assert.equal(review.queue.some((x) => x.dialogue === 'He really wants this.'), false);
  assert.ok(review.autoBindings.some((x) => x.segmentId === segmentIdFor(ingest, 'He really wants this.') && x.speaker === 'Michael Rawlins'));
});

test('0.11.6 resolves realtor action lead without promoting the realtor to series continuity', () => {
  const ingest = JSON.parse(JSON.stringify(ingestShape(['Chapter 43 – The Waiting Game', '', 'The realtor was already pulling out her phone.', '', '“Let me message the seller. We’ll get it looked at today.”'].join('\n'))));
  ingest.analysis.chapters[0].order = 43;
  const intelligence = buildDialogueIntelligence(ingest);
  const review = buildDialogueReviewQueue(ingest, { intelligence });
  assert.equal(review.queue.some((x) => x.dialogue.startsWith('Let me message the seller')), false);
  assert.ok(review.autoBindings.some((x) => x.speaker === 'Realtor'));
});


test('0.11.6 stores explicit together dialogue as a collective binding instead of inventing one speaker', () => {
  const ingest = ingestShape([
    'Chapter 1', '',
    'Juan and Michael turned to each other, exchanging a look before pivoting in sync.', '',
    '“Te amo,” they said together.'
  ].join('\n'));
  const intelligence = buildDialogueIntelligence(ingest);
  const review = buildDialogueReviewQueue(ingest, { intelligence });
  assert.equal(review.needsReview, 0);
  assert.equal(review.collectiveBindings.length, 1);
  assert.deepEqual(new Set(review.collectiveBindings[0].speakers), new Set(['Juan Delgado', 'Michael Rawlins']));
  assert.equal(review.autoBindings.some((x) => x.segmentId === segmentIdFor(ingest, 'Te amo,')), false);
});

test('0.11.6 closes a turn-to/reactor line without assigning the reacting addressee', () => {
  const ingest = ingestShape([
    'Chapter 1', '',
    'Michael read it once. Then again. Then turned to Juan, who was lounging on the couch.', '',
    '“He’s really thinking about moving closer?”', '',
    'Juan looked up, intrigued.'
  ].join('\n'));
  const intelligence = buildDialogueIntelligence(ingest);
  const review = buildDialogueReviewQueue(ingest, { intelligence });
  assert.equal(review.needsReview, 0);
  assert.ok(review.autoBindings.some((x) => x.segmentId === segmentIdFor(ingest, 'He’s really thinking about moving closer?') && x.speaker === 'Michael Rawlins'));
});


test('0.11.7 speaker truth overrides a confident wrong candidate when same-paragraph attribution is explicit', () => {
  const ingest = JSON.parse(JSON.stringify(ingestShape([
    'Chapter 1', '',
    'They unpacked the groceries.', '',
    '“We got the ham and potatoes,” Michael announced.'
  ].join('\n'))));
  let target = null;
  for (const chapter of ingest.analysis.chapters) for (const scene of chapter.scenes) for (const segment of scene.segments) {
    if (segment.text === 'We got the ham and potatoes,') target = segment;
  }
  assert.ok(target);
  target.speakerCandidate = { name: 'Juan', confidence: 0.77, evidence: 'context-before-action' };
  const intelligence = buildDialogueIntelligence(ingest);
  const review = buildDialogueReviewQueue(ingest, { intelligence });
  const binding = review.autoBindings.find((x) => x.segmentId === segmentIdFor(ingest, 'We got the ham and potatoes,'));
  assert.ok(binding);
  assert.equal(binding.speaker, 'Michael Rawlins');
  assert.ok(review.correctedSafeBindings >= 1);
});

test('0.11.7 future self-identification outranks generic pronoun proximity for an anonymous speaker', () => {
  const ingest = ingestShape([
    'Chapter 1', '',
    'Juan grinned at the stranger.', '',
    'The guy finally moved.', '',
    '“Nice set,”', '',
    'he said.', '',
    '“You know how to work a crowd.”', '',
    'Juan shrugged.', '',
    '“I’m Christopher.”'
  ].join('\n'));
  const intelligence = buildDialogueIntelligence(ingest);
  const review = buildDialogueReviewQueue(ingest, { intelligence });
  for (const line of ['Nice set,', 'You know how to work a crowd.']) {
    const binding = review.autoBindings.find((x) => x.segmentId === segmentIdFor(ingest, line));
    assert.ok(binding);
    assert.equal(binding.speaker, 'Christopher Lancaster');
    assert.equal(binding.evidence, 'anonymous-speaker-backfilled-by-self-identification');
  }
});

test('0.11.7 keeps split media titles as narrator text instead of inventing a one-mention character', () => {
  const result = classifyQuotedNarration('Best Friend’s Ass', 'Famous Singer’s', 'dropped, the beat filling the room.');
  assert.ok(result);
  assert.equal(result.classification, 'quoted-narration');
  assert.equal(result.evidence, 'split-song-title-not-dialogue');
});

test('0.11.7 one-mention names require spoken evidence before entering the permanent Audio Bible', () => {
  const report = fakeSupermanReport();
  report.characterDiscovery.candidates.push(
    { name: 'Kayla', mentions: 1, averageConfidence: 0.77, highConfidenceMentions: 1, inferredReviewMentions: 0, observedAs: ['Kayla'] },
    { name: 'Paris', mentions: 1, averageConfidence: 0.77, highConfidenceMentions: 1, inferredReviewMentions: 0, observedAs: ['Paris'] }
  );
  const plan = buildBookOneCharacterPlan(report, { spokenCharacterNames: new Set(['Kayla']) });
  assert.ok(plan.some((x) => x.canonicalName === 'Kayla'));
  assert.equal(plan.some((x) => x.canonicalName === 'Paris'), false);
});


test('0.11.8 closes pronunciation review with deterministic rules and fixes DJing classification', () => {
  const ingest = ingestShape([
    'Chapter 1', '',
    'Juan finished DJing and sent a DM.', '',
    '“LOL. LMAO. Tell the VIP DJ I said hi.”', '',
    'Michael laughed. “DIY astronaut?”', '',
    '“Te amo.”'
  ].join('\n'));
  const plan = buildBookOneCharacterPlan(fakeSupermanReport(), { spokenCharacterNames: new Set(['Michael Rawlins', 'Juan Delgado', 'Christopher Lancaster', 'Dani']) });
  const review = buildPronunciationReview(ingest, plan);
  assert.equal(review.needsConfirmation, 0);
  assert.equal(review.blockingCount, 0);
  assert.equal(review.resolvedCount, review.candidateCount);
  const djing = review.candidates.find((x) => x.term === 'DJing');
  assert.ok(djing);
  assert.equal(djing.category, 'acronym-derived');
  assert.equal(djing.spokenAs, 'dee jaying');
  assert.equal(djing.ruleRequired, true);
  const michael = review.candidates.find((x) => x.term === 'Michael Rawlins');
  assert.ok(michael);
  assert.equal(michael.status, 'standard-reading');
  assert.equal(michael.ruleRequired, false);
});

test('0.11.8 reconciles scene-local and collective dialogue out of continuity unresolved counts', () => {
  const raw = { bibleId: 'bible-1', unresolvedDialogueSegments: 17, pronunciationRules: 16 };
  const review = {
    sceneLocalBindings: Array.from({ length: 16 }, (_, i) => ({ segmentId: `scene-${i}` })),
    collectiveBindings: [{ segmentId: 'collective-1', speakers: ['Michael Rawlins', 'Juan Delgado'] }]
  };
  const result = reconcileBookOneContinuity(raw, review);
  assert.equal(result.unboundInPermanentBible, 17);
  assert.equal(result.externallyResolvedDialogueSegments, 17);
  assert.equal(result.unresolvedDialogueSegments, 0);
  assert.equal(result.speakerResolutionComplete, true);
});

test('0.11.8 persists pronunciation defaults but does not lock below a Superman PASS', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'yasready-prep-0118-lock-'));
  const file = path.join(dir, 'book.txt');
  try {
    await writeFile(file, [
      'Tres Amigos, Una Vida – A Throuple Love Story', '',
      'by D.C.W.', '',
      'Chapter 1', '',
      'Michael said, “Hello.”', '',
      'Juan replied, “Te amo.”', '',
      'Juan finished DJing and sent a DM.'
    ].join('\n'));
    const store = new InMemoryStore();
    const service = new BookOneAudioBiblePrepService(store);
    const result = await service.runFile(file);
    assert.equal(result.prep.release, '0.14.3');
    assert.equal(result.prep.schemaVersion, 8);
    assert.equal(result.prep.provenance.applicationRelease, '0.14.3');
    assert.equal(result.prep.provenance.prepEngineRelease, '0.11.8');
    assert.equal(result.prep.dialogueReview.needsReview, 0);
    assert.equal(result.prep.pronunciationReview.needsConfirmation, 0);
    assert.equal(result.prep.continuity.unresolvedDialogueSegments, 0);
    assert.notEqual(result.prep.superman.status, 'PASS');
    assert.equal(result.prep.gates.productionReady, false);
    assert.equal(result.prep.gates.audioBibleLocked, false);
    assert.equal(result.prep.status, 'READY_FOR_AUDIO_BIBLE_REVIEW');
    assert.equal(result.prep.lock.status, 'OPEN');
    assert.equal(result.prep.audioBible.locked, false);
    assert.ok(result.prep.snapshot.pronunciations.some((x) => x.term === 'D.C.W.' && x.spokenAs === 'D C W'));
    assert.ok(result.prep.snapshot.pronunciations.some((x) => x.term === 'Te amo' && x.language === 'es'));
    assert.equal(result.prep.snapshot.pronunciations.some((x) => x.term === 'Michael Rawlins'), false);
    assert.equal(result.prep.continuity.pronunciationRules, result.prep.pronunciationReview.rulesCreated);
    assert.equal(result.prep.providerCallsPerformed, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});


test('0.11.8 lock gate requires Superman PASS plus zero speaker, pronunciation and continuity blockers', () => {
  assert.equal(computeBookOneAudioBibleLock({ supermanStatus: 'PASS', reviewNeedsReview: 0, pronunciationNeedsConfirmation: 0, continuityUnresolvedDialogue: 0 }), true);
  assert.equal(computeBookOneAudioBibleLock({ supermanStatus: 'REVIEW', reviewNeedsReview: 0, pronunciationNeedsConfirmation: 0, continuityUnresolvedDialogue: 0 }), false);
  assert.equal(computeBookOneAudioBibleLock({ supermanStatus: 'PASS', reviewNeedsReview: 1, pronunciationNeedsConfirmation: 0, continuityUnresolvedDialogue: 0 }), false);
  assert.equal(computeBookOneAudioBibleLock({ supermanStatus: 'PASS', reviewNeedsReview: 0, pronunciationNeedsConfirmation: 1, continuityUnresolvedDialogue: 0 }), false);
  assert.equal(computeBookOneAudioBibleLock({ supermanStatus: 'PASS', reviewNeedsReview: 0, pronunciationNeedsConfirmation: 0, continuityUnresolvedDialogue: 1 }), false);
});
