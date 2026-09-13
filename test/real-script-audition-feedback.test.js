import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  buildRealAuditionPlan,
  verifyRealAuditionPlan,
  renderRealAuditions,
  summarizeRealAuditionFeedback,
  renderRealAuditionReviewHtml,
  AUDITION_HARD_CEILING_USD,
  buildCharacterCastingBiographiesFromPrepRun,
  buildCastingDiscoveryFixture,
  YASREADY_AUDIOBOOKS_VERSION
} from '../src/index.js';

function discoveryFixture() {
  const scripts = [
    ['n1', 'Narration — opening tone', 'narration-opening', 'Rawlins clenched his jaw tightly as the terminal noise folded around him.'],
    ['n2', 'Narration — emotional range', 'narration-range', 'A few nights later, the three of them sat together in the warm restaurant light.'],
    ['juan', 'Character performance — Juan Delgado', 'character-performance-juan-delgado', 'Oh, come on, Cowboy. You know you love a good night out.'],
    ['michael', 'Character performance — Michael Rawlins', 'character-performance-michael-rawlins', 'Rent has gone up enough that a mortgage almost sounds reasonable.'],
    ['christopher', 'Character performance — Christopher Lancaster', 'character-performance-christopher-lancaster', 'Too late. He is already gone, and yes, he absolutely knows it.']
  ].map(([id,label,purpose,text], index) => ({ id, label, purpose, text, chapterOrder: index + 1, chapterTitle: `Chapter ${index + 1}`, source: 'canonical-manuscript' }));
  const make = (name, id, owner, cultural = false) => ({
    id: `cand-${id}`, rank: 1, recommendation: cultural ? 'AUDITION' : 'ALTERNATE',
    voice: {
      provider: 'elevenlabs', providerVoiceId: id, publicOwnerId: owner, name,
      description: 'young American male', age: 'young', accent: 'american', locale: 'en-US',
      useCase: 'conversational', previewUrl: 'https://example.invalid/preview.mp3'
    },
    combinedScore: 90,
    culturalFit: { applicable: true, requirementMet: cultural, score: cultural ? 100 : 30 },
    tasteFit: { applicable: true, score: 95, profileVersion: 'book-one-human-v1' }
  });
  return {
    schemaVersion: 1, release: '0.14.3.5', status: 'READY_FOR_OPERATOR_REVIEW',
    castingMode: 'single-narrator', artifactFingerprint: 'discovery-fingerprint-fixture',
    book: { id: 'book-1', title: 'Tres Amigos, Una Vida', author: 'D.C.W.', sourceHash: 'abc' },
    shortlists: [{ character: 'Narrator', role: 'narrator', candidates: [
      make('Sebastian', 'seb-voice', 'owner-seb', true),
      make('Hale', 'hale-voice', 'owner-hale', false),
      make('Ryan', 'ryan-voice', 'owner-ryan', false)
    ] }],
    auditionSamples: { status: 'READY', samples: [{ character: 'Narrator', role: 'narrator', scripts }] }
  };
}

function fakeProvider() {
  const state = { renders: [], imports: [], estimates: [] };
  return {
    state,
    async healthCheck() { return { ok: true }; },
    async estimateCost({ text, model }) {
      state.estimates.push({ text, model });
      return { amountUsd: Number((text.length * 0.00005).toFixed(6)), characters: text.length, model };
    },
    async importSharedVoice({ publicOwnerId, voiceId, name }) {
      state.imports.push({ publicOwnerId, voiceId, name });
      return { voice_id: voiceId };
    },
    async listSavedVoices() { return { voices: [], hasMore: false }; },
    async render({ voiceId, text, model, outputFormat, languageCode, seed }) {
      state.renders.push({ voiceId, text, model, outputFormat, languageCode, seed });
      return {
        audio: new Uint8Array([1,2,3,4]),
        mediaType: 'audio/mpeg',
        voiceId, model, outputFormat,
        billedCharacters: text.length,
        estimatedCostUsd: Number((text.length * 0.00005).toFixed(6)),
        requestId: `req-${state.renders.length}`
      };
    }
  };
}

test('0.14.3.20.4 is current application provenance', () => {
  assert.equal(YASREADY_AUDIOBOOKS_VERSION,'0.14.3.20.4');
});

test('plan stage selects explicit voices, estimates cost and performs zero generation calls', async () => {
  const provider = fakeProvider();
  const discovery = discoveryFixture();
  const plan = await buildRealAuditionPlan({
    discovery,
    selectedVoiceIds: ['seb-voice', 'hale-voice', 'ryan-voice'],
    estimator: provider.estimateCost.bind(provider)
  });
  assert.equal(plan.status, 'READY_FOR_EXPLICIT_APPROVAL');
  assert.equal(plan.selectedCandidates.length, 3);
  assert.equal(plan.renderItems.length, 15);
  assert.equal(provider.state.renders.length, 0);
  assert.equal(provider.state.imports.length, 0);
  assert.match(plan.confirmation.token, /^AUDITION-[A-F0-9]{10}$/);
  assert.ok(plan.cost.estimateUsd > 0);
  assert.ok(plan.cost.suggestedMaxUsd > plan.cost.estimateUsd);
  assert.ok(plan.cost.suggestedMaxUsd <= AUDITION_HARD_CEILING_USD);
  assert.equal(verifyRealAuditionPlan(plan), true);
});

test('Keep/Maybe decision export can select audition voices while Pass is excluded', async () => {
  const provider = fakeProvider();
  const plan = await buildRealAuditionPlan({
    discovery: discoveryFixture(),
    decisions: { decisions: {
      'cand-seb-voice': { decision: 'maybe' },
      'cand-hale-voice': { decision: 'keep' },
      'cand-ryan-voice': { decision: 'pass' }
    }},
    estimator: provider.estimateCost.bind(provider)
  });
  assert.deepEqual(plan.selectedCandidates.map((x) => x.name), ['Sebastian', 'Hale']);
});

test('wrong confirmation token blocks all provider writes and TTS calls', async () => {
  const provider = fakeProvider();
  const plan = await buildRealAuditionPlan({
    discovery: discoveryFixture(), selectedVoiceIds: ['seb-voice'], estimator: provider.estimateCost.bind(provider)
  });
  await assert.rejects(
    renderRealAuditions({ plan, provider, outDir: await mkdtemp(path.join(os.tmpdir(), 'yas-aud-')), approvalToken: 'WRONG', maxUsd: plan.cost.suggestedMaxUsd }),
    /approval token mismatch/i
  );
  assert.equal(provider.state.imports.length, 0);
  assert.equal(provider.state.renders.length, 0);
});

test('too-low max spend blocks before provider writes and TTS calls', async () => {
  const provider = fakeProvider();
  const plan = await buildRealAuditionPlan({
    discovery: discoveryFixture(), selectedVoiceIds: ['seb-voice'], estimator: provider.estimateCost.bind(provider)
  });
  await assert.rejects(
    renderRealAuditions({ plan, provider, outDir: await mkdtemp(path.join(os.tmpdir(), 'yas-aud-')), approvalToken: plan.confirmation.token, maxUsd: plan.cost.estimateUsd }),
    /suggested protected maximum/i
  );
  assert.equal(provider.state.imports.length, 0);
  assert.equal(provider.state.renders.length, 0);
});

test('approved real audition renders exactly five canonical clips per selected voice and writes review artifacts', async () => {
  const provider = fakeProvider();
  const plan = await buildRealAuditionPlan({
    discovery: discoveryFixture(),
    selectedVoiceIds: ['seb-voice', 'hale-voice', 'ryan-voice'],
    estimator: provider.estimateCost.bind(provider)
  });
  const out = await mkdtemp(path.join(os.tmpdir(), 'yas-aud-'));
  const result = await renderRealAuditions({
    plan, provider, outDir: out, approvalToken: plan.confirmation.token, maxUsd: plan.cost.suggestedMaxUsd
  });
  assert.equal(result.status, 'READY_FOR_HUMAN_REVIEW');
  assert.equal(result.providerGenerationCalls, 15);
  assert.equal(result.productionGenerationCalls, 0);
  assert.equal(result.castLocksCreated, 0);
  assert.equal(provider.state.imports.length, 3);
  assert.equal(provider.state.renders.length, 15);
  assert.ok(provider.state.renders.every((row) => row.languageCode === 'en'));
  assert.ok(provider.state.renders.every((row) => row.seed === 424242));
  await stat(path.join(out, 'real-audition-results.json'));
  await stat(path.join(out, 'real-audition-review.html'));
  await stat(path.join(out, result.rendered[0].outputRelativePath));
  const html = await readFile(path.join(out, 'real-audition-review.html'), 'utf8');
  assert.match(html, /Export Human Feedback/);
  assert.match(html, /Narration/);
  assert.match(html, /Juan/);
  assert.match(html, /Michael/);
  assert.match(html, /Christopher/);
  assert.doesNotMatch(html, /ELEVENLABS_API_KEY/i);
});

test('human feedback summary ranks explicit Keep/Maybe ratings and preserves no-acoustic-inference policy', async () => {
  const provider = fakeProvider();
  const plan = await buildRealAuditionPlan({
    discovery: discoveryFixture(),
    selectedVoiceIds: ['seb-voice', 'hale-voice'],
    estimator: provider.estimateCost.bind(provider)
  });
  const feedback = {
    schemaVersion: 1, artifact: 'book-one-real-audition-human-feedback',
    planFingerprint: plan.integrity.planFingerprint,
    feedback: [
      { providerVoiceId: 'seb-voice', name: 'Sebastian', decision: 'maybe', ratings: { narration: 4, juan: 4, michael: 3, christopher: 4, overall: 4 }, notes: 'close' },
      { providerVoiceId: 'hale-voice', name: 'Hale', decision: 'keep', ratings: { narration: 5, juan: 4, michael: 4, christopher: 4, overall: 5 }, notes: 'strong' }
    ]
  };
  const summary = summarizeRealAuditionFeedback(feedback, plan);
  assert.equal(summary.counts.keep, 1);
  assert.equal(summary.counts.maybe, 1);
  assert.equal(summary.rankedHumanChoices[0].name, 'Hale');
  assert.equal(summary.futureTasteSignal.acousticSimilarityInferred, false);
  assert.equal(summary.futureTasteSignal.identityInferredFromAudio, false);
});


test('Book One biography cleanup makes canon authoritative and only operator canon renders confirmed', () => {
  const base = buildCastingDiscoveryFixture();
  const chapters = [{
    order: 1, title: 'Truth Test', scenes: [{ segments: [
      { kind: 'narration', text: 'Juan Delgado was born and raised in Florida and later became a DJ.' },
      { kind: 'narration', text: 'Juan Delgado laughed about everything that happened in Oklahoma.' },
      { kind: 'narration', text: 'Michael Rawlins watched Juan DJ from across the room.' },
      { kind: 'narration', text: 'Christopher Lancaster returned to his life in San Francisco.' },
      { kind: 'narration', text: 'Christopher Lancaster teased Michael about Oklahoma.' }
    ] }]
  }];
  const prepRun = {
    prep: {
      ...base.prep,
      status: 'AUDIO_BIBLE_LOCKED',
      book: { ...base.prep.book, sourceHash: base.launch.book.sourceHash },
      dialogueReview: { autoBindings: [] }
    },
    ingestResult: {
      analysis: { chapters },
      segments: chapters[0].scenes[0].segments.map((_, i) => ({ id: `truth-${i}` }))
    }
  };
  const bios = buildCharacterCastingBiographiesFromPrepRun(prepRun, base.launch);
  const juan = bios.profiles.find((x) => x.character === 'Juan Delgado');
  const michael = bios.profiles.find((x) => x.character === 'Michael Rawlins');
  const christopher = bios.profiles.find((x) => x.character === 'Christopher Lancaster');

  assert.ok(juan.evidence.some((x) => x.ruleId === 'canon-florida' && x.confidenceLabel === 'confirmed'));
  assert.equal(juan.evidence.some((x) => x.ruleId === 'oklahoma'), false);
  assert.equal(michael.evidence.some((x) => x.ruleId === 'dj'), false);
  assert.equal(christopher.evidence.some((x) => x.ruleId === 'dj'), false);
  assert.equal(christopher.evidence.some((x) => x.ruleId === 'oklahoma'), false);
  assert.ok(juan.evidence.filter((x) => x.source === 'manuscript-semantic-attribution').every((x) => x.confidenceLabel !== 'confirmed'));
  assert.equal(bios.canonAuthorityApplied, true);
});
