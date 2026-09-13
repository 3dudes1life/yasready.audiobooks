import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BookOneCastingDiscoveryService,
  buildCastingDiscoveryFixture,
  scoreBookOneCulturalFit,
  YASREADY_AUDIOBOOKS_VERSION
} from '../src/index.js';

function baseVoice(overrides = {}) {
  return {
    provider: 'elevenlabs',
    providerVoiceId: 'voice-base',
    name: 'Contemporary American Male',
    description: 'warm confident natural conversational expressive voice',
    category: 'professional',
    accent: 'american',
    gender: 'male',
    age: 'middle_aged',
    language: 'en',
    useCase: 'conversational',
    verifiedLanguages: [{ language: 'en', locale: 'en-US', accent: 'american' }],
    previewUrl: 'https://example.invalid/base.mp3',
    noticePeriodDays: 730,
    hasCustomRate: false,
    liveModerationEnabled: false,
    ...overrides
  };
}

test('0.14.3.1 is current application provenance', () => {
  assert.equal(YASREADY_AUDIOBOOKS_VERSION, '0.14.3.1');
});

test('Juan requires explicit Latino or Latin-American catalog metadata for auto-audition', () => {
  const generic = scoreBookOneCulturalFit(baseVoice(), { canonicalName: 'Juan Delgado', role: 'primary' });
  assert.equal(generic.applicable, true);
  assert.equal(generic.requiredForAudition, true);
  assert.equal(generic.requirementMet, false);
  assert.ok(generic.score < 60);
  assert.ok(generic.flags.some((row) => row.code === 'cultural-signal-required'));

  const latino = scoreBookOneCulturalFit(baseVoice({
    providerVoiceId: 'juan-latino',
    description: 'Latino American bilingual male, warm contemporary conversational delivery'
  }), { canonicalName: 'Juan Delgado', role: 'primary' });
  assert.equal(latino.requirementMet, true);
  assert.ok(latino.score >= 90);
  assert.ok(latino.matchedSignals.some((row) => /latino/i.test(row)));
});

test('Spanish or bilingual metadata helps Juan but does not silently infer Latino identity', () => {
  const bilingual = scoreBookOneCulturalFit(baseVoice({
    providerVoiceId: 'bilingual-only',
    description: 'bilingual English Spanish contemporary male narrator'
  }), { canonicalName: 'Juan Delgado', role: 'primary' });
  assert.equal(bilingual.requirementMet, false);
  assert.ok(bilingual.score > 30);
  assert.ok(bilingual.supportSignals.length > 0);
});

test('Christopher accepts contemporary American voice while Bay Area or explicit Asian-American metadata boosts fit', () => {
  const generic = scoreBookOneCulturalFit(baseVoice(), { canonicalName: 'Christopher Lancaster', role: 'primary' });
  assert.equal(generic.applicable, true);
  assert.equal(generic.requiredForAudition, false);
  assert.equal(generic.requirementMet, true);

  const bay = scoreBookOneCulturalFit(baseVoice({
    providerVoiceId: 'christopher-bay',
    description: 'polished Bay Area California contemporary American conversational voice'
  }), { canonicalName: 'Christopher Lancaster', role: 'primary' });

  const asianAmerican = scoreBookOneCulturalFit(baseVoice({
    providerVoiceId: 'christopher-aa',
    description: 'Asian American contemporary California male voice'
  }), { canonicalName: 'Christopher Lancaster', role: 'primary' });

  assert.ok(bay.score > generic.score);
  assert.ok(asianAmerican.score > generic.score);
  assert.equal(bay.requirementMet, true);
  assert.equal(asianAmerican.requirementMet, true);
});

test('Juan generic voices remain visible but cannot be auto-recommended as AUDITION', async () => {
  const fixture = buildCastingDiscoveryFixture();
  const genericOnly = fixture.voices.map((voice, index) => ({
    ...voice,
    providerVoiceId: `generic-${index + 1}`,
    description: 'warm confident natural conversational expressive audiobook voice'
  }));
  const result = await new BookOneCastingDiscoveryService().build({
    launch: fixture.launch,
    prep: fixture.prep,
    voices: genericOnly,
    auditionSamples: fixture.auditionSamples,
    costEstimator: fixture.estimateCost,
    perRole: 5,
    auditionTop: 3,
    catalogProvider: 'fixture'
  });
  const juan = result.discovery.shortlists.find((row) => row.character === 'Juan Delgado');
  assert.ok(juan.candidates.length > 0);
  assert.equal(juan.candidates.some((candidate) => candidate.recommendation === 'AUDITION'), false);
  assert.equal(juan.candidates.every((candidate) => candidate.culturalFit.requiredForAudition), true);
  assert.equal(result.discovery.status, 'NEEDS_BETTER_ROLE_FIT');
});

test('scarce Latino candidate is reserved for Juan instead of being consumed by another core role', async () => {
  const fixture = buildCastingDiscoveryFixture();
  const voices = fixture.voices.slice(0, 20).map((voice, index) => ({
    ...voice,
    providerVoiceId: `reserve-${index + 1}`,
    description: index === 0
      ? 'Latino American warm natural expressive conversational audiobook storytelling voice'
      : 'warm natural expressive conversational audiobook storytelling voice'
  }));
  const result = await new BookOneCastingDiscoveryService().build({
    launch: fixture.launch,
    prep: fixture.prep,
    voices,
    auditionSamples: fixture.auditionSamples,
    costEstimator: fixture.estimateCost,
    perRole: 4,
    auditionTop: 2,
    catalogProvider: 'fixture'
  });
  const juan = result.discovery.shortlists.find((row) => row.character === 'Juan Delgado');
  assert.equal(juan.candidates[0].voice.providerVoiceId, 'reserve-1');
  assert.equal(juan.candidates[0].culturalFit.requirementMet, true);
  const narrator = result.discovery.shortlists.find((row) => row.character === 'Narrator');
  assert.equal(narrator.candidates.some((candidate) => candidate.voice.providerVoiceId === 'reserve-1'), false);
});

test('authenticated discovery performs zero-spend cultural metadata searches and deduplicates results', async () => {
  const fixture = buildCastingDiscoveryFixture();
  const calls = [];
  const broad = fixture.voices.slice(0, 24).map((voice, index) => ({
    ...voice,
    providerVoiceId: `broad-${index + 1}`,
    description: 'warm natural conversational audiobook voice'
  }));
  const latino = baseVoice({
    providerVoiceId: 'targeted-latino',
    name: 'Targeted Latino',
    description: 'Latino American bilingual warm confident conversational voice'
  });
  const bay = baseVoice({
    providerVoiceId: 'targeted-bay',
    name: 'Targeted Bay Area',
    description: 'Bay Area California polished contemporary American voice'
  });

  const provider = {
    name: 'elevenlabs',
    apiKey: 'fixture-key',
    async searchVoices(options) {
      calls.push(options);
      if (options.search && /latino|latin american|hispanic/i.test(options.search)) {
        return { voices: [latino], hasMore: false, queryMode: 'authenticated-filtered', providerFiltersApplied: true, anonymousFallbackUsed: false, httpCallsPerformed: 1 };
      }
      if (options.search && /bay area|california|asian american/i.test(options.search)) {
        return { voices: [bay], hasMore: false, queryMode: 'authenticated-filtered', providerFiltersApplied: true, anonymousFallbackUsed: false, httpCallsPerformed: 1 };
      }
      return { voices: broad, hasMore: false, queryMode: 'authenticated-filtered', providerFiltersApplied: true, anonymousFallbackUsed: false, httpCallsPerformed: 1 };
    },
    estimateCost: fixture.estimateCost
  };

  const result = await new BookOneCastingDiscoveryService().discoverFromProvider({
    launch: fixture.launch,
    prep: fixture.prep,
    provider,
    auditionSamples: fixture.auditionSamples,
    perRole: 5,
    auditionTop: 3,
    maxPages: 1,
    pageSize: 100
  });

  assert.ok(calls.some((row) => row.search === 'latino'));
  assert.ok(calls.some((row) => row.search === 'bay area'));
  assert.ok(result.discovery.catalog.supplementalSearchesPerformed.length >= 2);
  assert.equal(result.discovery.guardrails.paidProviderCallsPerformed, 0);
  assert.equal(result.discovery.guardrails.generationCallsPerformed, 0);
  const juan = result.discovery.shortlists.find((row) => row.character === 'Juan Delgado');
  assert.ok(juan.candidates.some((candidate) => candidate.voice.providerVoiceId === 'targeted-latino'));
});

test('Casting Review Board exposes cultural fit and the explicit-metadata-only policy', async () => {
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
  assert.match(result.reviewBoardHtml, /Cultural fit/);
  assert.match(result.reviewBoardHtml, /explicit provider catalog metadata/i);
  assert.match(result.reviewBoardHtml, /Latino/i);
  assert.match(result.reviewBoardHtml, /Bay Area/i);
  assert.equal(result.discovery.guardrails.culturalIdentityInferredFromAudio, false);
  assert.equal(result.discovery.guardrails.auditionRenderingArmed, false);
});
