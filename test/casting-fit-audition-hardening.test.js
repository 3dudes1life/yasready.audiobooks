import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BookOneCastingDiscoveryService,
  buildCastingDiscoveryFixture,
  buildAuditionSamplePackFromPrepRun,
  scoreBookOneCastingFit,
  YASREADY_AUDIOBOOKS_VERSION
} from '../src/index.js';

test('0.14.3.14.1 is current application provenance', () => {
  assert.equal(YASREADY_AUDIOBOOKS_VERSION,'0.14.3.14.1');
});

test('hard gender mismatch cannot masquerade as a strong Christopher fit', () => {
  const female = {
    provider: 'elevenlabs',
    providerVoiceId: 'female-stretch',
    name: 'Warm polished expressive narrator',
    description: 'Warm polished confident conversational expressive natural storytelling voice',
    category: 'professional',
    accent: 'british',
    gender: 'female',
    age: 'young',
    language: 'en',
    useCase: 'conversational',
    verifiedLanguages: [{ language: 'en', locale: 'en-GB' }],
    previewUrl: 'https://example.invalid/female.mp3',
    noticePeriodDays: 730
  };
  const fit = scoreBookOneCastingFit(female, { canonicalName: 'Christopher Lancaster', role: 'primary' });
  assert.equal(fit.hardMismatch, true);
  assert.ok(fit.score < 70);
  assert.ok(fit.stretchFlags.some((row) => row.code === 'gender-mismatch'));
});

test('Book One lead fit rewards practical American conversational metadata over obvious stretch metadata', () => {
  const good = {
    providerVoiceId: 'good', name: 'Natural lead', description: 'warm confident playful conversational expressive voice',
    category: 'professional', accent: 'american', gender: 'male', age: 'middle_aged',
    language: 'en', useCase: 'conversational', verifiedLanguages: [{ language: 'en' }],
    previewUrl: 'https://example.invalid/good.mp3', noticePeriodDays: 730
  };
  const stretch = {
    ...good, providerVoiceId: 'stretch', name: 'Grandpa narrator', description: 'old documentary narrator',
    accent: 'british', age: 'old', useCase: 'narrative_story'
  };
  const target = { canonicalName: 'Juan Delgado', role: 'primary' };
  const goodFit = scoreBookOneCastingFit(good, target);
  const stretchFit = scoreBookOneCastingFit(stretch, target);
  assert.ok(goodFit.score >= 90);
  assert.ok(stretchFit.score <= 75);
  assert.ok(stretchFit.stretchFlags.length >= 2);
});

test('Narrator audition extraction rejects copyright/front matter and starts with real narrative prose', () => {
  const fixture = buildCastingDiscoveryFixture();
  const chapters = [
    {
      order: 0, title: 'Front Matter',
      scenes: [{ segments: [{ kind: 'narration', text: 'Copyright © 2025 D.C.W. All rights reserved. No part of this book may be reproduced, distributed, transmitted, copied, stored, or otherwise reused without permission from the publisher.' }] }]
    },
    {
      order: 1, title: 'Chapter 1',
      scenes: [{ segments: [{ kind: 'narration', text: 'Morning light slid across the apartment windows while the city outside slowly came awake, leaving the room warm and quiet before the day finally began.' }] }]
    },
    {
      order: 2, title: 'Chapter 2',
      scenes: [{ segments: [{ kind: 'narration', text: 'By the middle of the week, the three men had fallen into the kind of comfortable rhythm that made ordinary plans feel unexpectedly important.' }] }]
    },
    {
      order: 3, title: 'Chapter 3',
      scenes: [{ segments: [{ kind: 'narration', text: 'Later that night, they stood together near the doorway, each carrying a different version of the future and the same hope that they would choose it together.' }] }]
    }
  ];
  const segments = ['front', 'one', 'two', 'three'].map((id) => ({ id }));
  const pack = buildAuditionSamplePackFromPrepRun({
    prep: {
      status: 'AUDIO_BIBLE_LOCKED',
      book: { sourceHash: fixture.launch.book.sourceHash },
      dialogueReview: { autoBindings: [] }
    },
    ingestResult: { analysis: { chapters }, segments }
  }, fixture.launch);
  const narrator = pack.samples.find((row) => row.character === 'Narrator');
  assert.equal(narrator.scripts.length, 3);
  assert.equal(narrator.scripts[0].chapterOrder, 1);
  assert.equal(narrator.scripts.some((row) => /copyright|all rights reserved|no part of this book/i.test(row.text)), false);
});

test('Casting Review Board is local, playable, decision-ready and still unarmed', async () => {
  const fixture = buildCastingDiscoveryFixture();
  const result = await new BookOneCastingDiscoveryService().build({
    launch: fixture.launch,
    prep: fixture.prep,
    voices: fixture.voices,
    auditionSamples: fixture.auditionSamples,
    costEstimator: fixture.estimateCost,
    perRole: 5,
    auditionTop: 3,
    catalogProvider: 'fixture'
  });
  assert.match(result.reviewBoardHtml, /Casting Review Board/);
  assert.match(result.reviewBoardHtml, /Export Audition Choices/);
  assert.match(result.reviewBoardHtml, />Keep</);
  assert.match(result.reviewBoardHtml, />Maybe</);
  assert.match(result.reviewBoardHtml, />Pass</);
  assert.match(result.reviewBoardHtml, /audio/i);
  assert.match(result.reviewBoardHtml, /paid audition generation remains unarmed/i);
  assert.equal(result.discovery.guardrails.auditionRenderingArmed, false);
  assert.equal(result.discovery.guardrails.paidGenerationArmed, false);
});

test('recommended audition plan excludes candidates that are not actually marked AUDITION', async () => {
  const fixture = buildCastingDiscoveryFixture();
  const result = await new BookOneCastingDiscoveryService().build({
    launch: fixture.launch,
    prep: fixture.prep,
    voices: fixture.voices,
    auditionSamples: fixture.auditionSamples,
    costEstimator: fixture.estimateCost,
    perRole: 5,
    auditionTop: 3,
    catalogProvider: 'fixture'
  });
  const recommendedIds = result.discovery.shortlists.flatMap((row) =>
    row.candidates.filter((candidate) => candidate.recommendation === 'AUDITION').map((candidate) => candidate.id)
  );
  assert.deepEqual(result.discovery.auditionPlanPreview.candidateIds, recommendedIds);
  assert.equal(result.discovery.auditionPlanPreview.armed, false);
});
