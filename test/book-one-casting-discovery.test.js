import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BookOneCastingDiscoveryService,
  buildCastingDiscoveryFixture,
  YASREADY_AUDIOBOOKS_VERSION
} from '../src/index.js';

test('0.14.2.1 is current application provenance', () => {
  assert.equal(YASREADY_AUDIOBOOKS_VERSION, '0.14.2.1');
});

test('candidate discovery fills unique Wave 1 shortlists without paid generation', async () => {
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
  assert.equal(result.discovery.status, 'READY_FOR_OPERATOR_REVIEW');
  assert.equal(result.discovery.shortlists.length, 4);
  assert.equal(result.discovery.shortlists.every((row) => row.candidates.length === 5), true);
  const voiceIds = result.discovery.shortlists.flatMap((row) => row.candidates.map((candidate) => candidate.voice.providerVoiceId));
  assert.equal(new Set(voiceIds).size, voiceIds.length);
  assert.equal(result.discovery.guardrails.paidProviderCallsPerformed, 0);
  assert.equal(result.discovery.guardrails.generationCallsPerformed, 0);
  assert.equal(result.discovery.guardrails.auditionRenderingArmed, false);
  assert.equal(result.discovery.guardrails.productionArmed, false);
});

test('candidate discovery uses existing series-safety scoring and produces cost preview only', async () => {
  const fixture = buildCastingDiscoveryFixture();
  fixture.voices[0] = { ...fixture.voices[0], noticePeriodDays: 0, category: 'community', previewUrl: null, verifiedLanguages: [] };
  const result = await new BookOneCastingDiscoveryService().build({
    launch: fixture.launch, prep: fixture.prep, voices: fixture.voices,
    auditionSamples: fixture.auditionSamples, costEstimator: fixture.estimateCost,
    perRole: 4, auditionTop: 2, catalogProvider: 'fixture'
  });
  assert.equal(result.discovery.auditionCost.status, 'ESTIMATED');
  assert.ok(result.discovery.auditionCost.recommendedAuditionUsd > 0);
  assert.ok(result.discovery.shortlists.every((row) => row.candidates.every((candidate) => Number.isFinite(candidate.seriesSafety.score))));
  const riskyUsed = result.discovery.shortlists.flatMap((row) => row.candidates).find((candidate) => candidate.voice.providerVoiceId === 'fixture-voice-1');
  if (riskyUsed) assert.ok(riskyUsed.seriesSafety.score < 70);
});

test('candidate discovery fails closed when launch and prep identity drift', async () => {
  const fixture = buildCastingDiscoveryFixture();
  fixture.prep.audioBible.digest = 'wrong-digest';
  await assert.rejects(
    () => new BookOneCastingDiscoveryService().build({ launch: fixture.launch, prep: fixture.prep, voices: fixture.voices }),
    /identity\/digest/
  );
});

test('candidate discovery refuses an armed paid state', async () => {
  const fixture = buildCastingDiscoveryFixture();
  fixture.launch.guardrails = { ...fixture.launch.guardrails, paidGenerationArmed: true };
  await assert.rejects(
    () => new BookOneCastingDiscoveryService().build({ launch: fixture.launch, prep: fixture.prep, voices: fixture.voices }),
    /already-armed/
  );
});

test('candidate discovery reports shortfall rather than reusing a core voice', async () => {
  const fixture = buildCastingDiscoveryFixture();
  const result = await new BookOneCastingDiscoveryService().build({
    launch: fixture.launch, prep: fixture.prep, voices: fixture.voices.slice(0, 8), perRole: 4, auditionTop: 2
  });
  assert.equal(result.discovery.status, 'NEEDS_MORE_CANDIDATES');
  const ids = result.discovery.shortlists.flatMap((row) => row.candidates.map((candidate) => candidate.voice.providerVoiceId));
  assert.equal(new Set(ids).size, ids.length);
});

test('candidate discovery without manuscript samples cannot become audition-ready', async () => {
  const fixture = buildCastingDiscoveryFixture();
  const result = await new BookOneCastingDiscoveryService().build({
    launch: fixture.launch, prep: fixture.prep, voices: fixture.voices, perRole: 3, auditionTop: 2
  });
  assert.equal(result.discovery.status, 'CANDIDATES_READY_SAMPLES_PENDING');
  assert.equal(result.discovery.auditionCost.status, 'NEEDS_SOURCE_SAMPLES');
  assert.match(result.discovery.nextAction, /--manuscript/);
});

test('human outputs clearly preserve the unarmed boundary', async () => {
  const fixture = buildCastingDiscoveryFixture();
  const result = await new BookOneCastingDiscoveryService().build({
    launch: fixture.launch, prep: fixture.prep, voices: fixture.voices,
    auditionSamples: fixture.auditionSamples, costEstimator: fixture.estimateCost,
    perRole: 3, auditionTop: 2
  });
  assert.match(result.markdown, /Paid provider calls: 0/);
  assert.match(result.markdown, /ARM AUDITIONS/);
  assert.match(result.shortlistCsv, /operator_decision/);
  assert.match(result.scriptsCsv, /High-energy \/ dynamic/);
});
