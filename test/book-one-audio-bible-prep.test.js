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
  renderDialogueReviewCsv
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

test('pronunciation review never guesses spoken forms', () => {
  const ingest = ingestShape('Chapter 1\n\nMichael said, “We went to San Francisco with Juan.”\n\nThey returned to San Francisco later.');
  const plan = buildBookOneCharacterPlan(fakeSupermanReport());
  const pronunciation = buildPronunciationReview(ingest, plan);
  assert.ok(pronunciation.candidates.some((x) => x.term === 'Michael Rawlins'));
  assert.ok(pronunciation.candidates.some((x) => x.term === 'Tres Amigos, Una Vida – A Throuple Love Story'));
  assert.equal(pronunciation.candidates.every((x) => x.spokenAs === '' && x.status === 'needs-confirmation'), true);
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

test('0.11.3 focused pronunciation review makes no guesses and avoids broad obvious-name harvesting', () => {
  const ingest = ingestShape('Chapter 1\n\nMichael said, “Te amo, Juan.”\n\nThey went from San Diego to Clairemont and discussed DJ work and IG posts.');
  const plan = buildBookOneCharacterPlan(fakeSupermanReport());
  const pronunciation = buildPronunciationReview(ingest, plan);
  const terms = new Set(pronunciation.candidates.map((x) => x.term));
  assert.ok(terms.has('Te amo'));
  assert.ok(terms.has('Clairemont'));
  assert.equal(terms.has('San Diego'), false);
  assert.equal(pronunciation.noGuessesMade, true);
  assert.equal(pronunciation.candidates.every((x) => x.spokenAs === ''), true);
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
    assert.equal(result.prep.release, '0.11.4');
    assert.equal(result.prep.intelligence.resolutionCounts.narratorRouted, result.prep.dialogueReview.quotedNarrationSegments);
    assert.equal(result.prep.providerCallsPerformed, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
