import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCharacterCastingBiographiesFromPrepRun,
  scoreCharacterBiographyFit,
  BookOneCastingDiscoveryService,
  buildCastingDiscoveryFixture,
  YASREADY_AUDIOBOOKS_VERSION
} from '../src/index.js';

function prepRunFixture() {
  const base = buildCastingDiscoveryFixture();
  const chapters = [
    {
      order: 1,
      title: 'Chapter 1',
      scenes: [{
        segments: [
          { kind: 'narration', text: 'Michael Rawlins grew up on a farm in Oklahoma, and the rhythm of farm life never completely left him.' },
          { kind: 'dialogue', text: 'I still miss some of it.' },
          { kind: 'narration', text: 'Juan Delgado laughed and leaned back against the counter.' },
          { kind: 'narration', text: 'Juan was a Latino American guy who could move easily between English and Spanish when family called.' }
        ]
      }]
    },
    {
      order: 2,
      title: 'Chapter 2',
      scenes: [{
        segments: [
          { kind: 'narration', text: 'Christopher Lancaster was Asian American and had built his adult life around the San Francisco Bay Area.' },
          { kind: 'dialogue', text: 'The Bay is home. I know how I sound.' },
          { kind: 'narration', text: 'Michael smiled when Christopher teased him about the old Oklahoma farm stories.' }
        ]
      }]
    }
  ];
  return {
    launch: base.launch,
    prep: {
      prep: {
        ...base.prep,
        status: 'AUDIO_BIBLE_LOCKED',
        book: { ...base.prep.book, sourceHash: base.launch.book.sourceHash }
      },
      ingestResult: { analysis: { chapters } }
    }
  };
}

function voice(overrides = {}) {
  return {
    provider: 'elevenlabs',
    providerVoiceId: overrides.providerVoiceId ?? 'voice',
    name: overrides.name ?? 'Voice',
    description: overrides.description ?? 'warm natural conversational American male voice',
    category: 'professional',
    accent: overrides.accent ?? 'american',
    gender: 'male',
    age: 'young',
    language: 'en',
    useCase: 'conversational',
    verifiedLanguages: [{ language: 'en', locale: 'en-US' }],
    previewUrl: 'https://example.invalid/voice.mp3',
    noticePeriodDays: 730,
    hasCustomRate: false,
    liveModerationEnabled: false,
    ...overrides
  };
}

test('0.14.3.8 is current application provenance', () => {
  assert.equal(YASREADY_AUDIOBOOKS_VERSION, '0.14.3.8');
});

test('full-manuscript biography discovers Michael Oklahoma + farm evidence and derives mild country target', () => {
  const data = prepRunFixture();
  const biographies = buildCharacterCastingBiographiesFromPrepRun(data.prep, data.launch);
  const michael = biographies.profiles.find((row) => row.character === 'Michael Rawlins');
  assert.equal(michael.sourceScope, 'full-manuscript-plus-operator-canon');
  assert.ok(michael.evidence.some((row) => row.ruleId === 'oklahoma'));
  assert.ok(michael.evidence.some((row) => row.ruleId === 'farm'));
  assert.match(michael.castingProfile.regionalFlavor.label, /Oklahoma|country/i);
  assert.equal(michael.castingProfile.regionalFlavor.requiredForPreferredAudition, true);
  assert.ok(michael.castingProfile.searchTerms.some((term) => /country|oklahoma/i.test(term)));
});

test('full-manuscript biography discovers Juan and Christopher identity/region evidence without name inference', () => {
  const data = prepRunFixture();
  const biographies = buildCharacterCastingBiographiesFromPrepRun(data.prep, data.launch);
  const juan = biographies.profiles.find((row) => row.character === 'Juan Delgado');
  const christopher = biographies.profiles.find((row) => row.character === 'Christopher Lancaster');
  assert.ok(juan.evidence.some((row) => row.ruleId === 'latino'));
  assert.ok(christopher.evidence.some((row) => row.ruleId === 'asian-american'));
  assert.ok(christopher.evidence.some((row) => row.ruleId === 'bay-area'));
  assert.equal(biographies.identityInferenceFromName, false);
  assert.equal(biographies.identityInferenceFromAudio, false);
});

test('Michael country/Oklahoma metadata materially outranks generic American metadata', () => {
  const data = prepRunFixture();
  const biographies = buildCharacterCastingBiographiesFromPrepRun(data.prep, data.launch);
  const michael = biographies.profiles.find((row) => row.character === 'Michael Rawlins');
  const generic = scoreCharacterBiographyFit(voice({
    providerVoiceId: 'generic',
    description: 'young warm neutral American conversational male'
  }), michael);
  const country = scoreCharacterBiographyFit(voice({
    providerVoiceId: 'country',
    description: 'young warm Oklahoma country rural American conversational male'
  }), michael);
  assert.equal(generic.preferredAuditionRequirement, true);
  assert.equal(generic.requirementMet, false);
  assert.equal(country.requirementMet, true);
  assert.ok(country.score > generic.score + 15);
});

test('discovery keeps generic Michael visible but blocks auto-audition when full-book country target is strong', async () => {
  const base = buildCastingDiscoveryFixture();
  const data = prepRunFixture();
  const biographies = buildCharacterCastingBiographiesFromPrepRun(data.prep, data.launch);

  const voices = base.voices.map((row, index) => ({
    ...row,
    providerVoiceId: `bio-${index + 1}`,
    description: index === 0
      ? 'young warm Oklahoma country rural American conversational male'
      : row.description
  }));

  const result = await new BookOneCastingDiscoveryService().build({
    launch: base.launch,
    prep: base.prep,
    voices,
    auditionSamples: base.auditionSamples,
    characterBiographies: biographies,
    costEstimator: base.estimateCost,
    perRole: 5,
    auditionTop: 3,
    catalogProvider: 'fixture'
  });

  const michael = result.discovery.shortlists.find((row) => row.character === 'Michael Rawlins');
  assert.ok(michael.candidates.some((candidate) => candidate.biographyFit?.applicable));
  const genericAuditions = michael.candidates.filter((candidate) =>
    candidate.recommendation === 'AUDITION' &&
    candidate.biographyFit?.preferredAuditionRequirement &&
    !candidate.biographyFit?.requirementMet
  );
  assert.equal(genericAuditions.length, 0);
});

test('authenticated discovery performs biography-driven zero-spend catalog searches', async () => {
  const base = buildCastingDiscoveryFixture();
  const data = prepRunFixture();
  const biographies = buildCharacterCastingBiographiesFromPrepRun(data.prep, data.launch);
  const calls = [];

  const provider = {
    name: 'elevenlabs',
    apiKey: 'fixture-key',
    async searchVoices(options) {
      calls.push(options);
      return {
        voices: base.voices.slice(0, 30),
        hasMore: false,
        queryMode: 'authenticated-filtered',
        providerFiltersApplied: true,
        anonymousFallbackUsed: false,
        httpCallsPerformed: 1
      };
    },
    estimateCost: base.estimateCost
  };

  const result = await new BookOneCastingDiscoveryService().discoverFromProvider({
    launch: base.launch,
    prep: base.prep,
    provider,
    auditionSamples: base.auditionSamples,
    characterBiographies: biographies,
    perRole: 5,
    auditionTop: 3,
    maxPages: 1,
    pageSize: 100
  });

  assert.ok(calls.some((row) => /oklahoma|country american|rural american/.test(String(row.search ?? ''))));
  assert.ok(result.discovery.catalog.supplementalSearchesPerformed.some((row) => row.source === 'full-manuscript-biography'));
  assert.equal(result.discovery.guardrails.paidProviderCallsPerformed, 0);
  assert.equal(result.discovery.guardrails.generationCallsPerformed, 0);
});

test('Casting Review Board shows biography and Book fit while staying unarmed', async () => {
  const base = buildCastingDiscoveryFixture();
  const data = prepRunFixture();
  const biographies = buildCharacterCastingBiographiesFromPrepRun(data.prep, data.launch);
  const result = await new BookOneCastingDiscoveryService().build({
    launch: base.launch,
    prep: base.prep,
    voices: base.voices,
    auditionSamples: base.auditionSamples,
    characterBiographies: biographies,
    costEstimator: base.estimateCost,
    perRole: 5,
    auditionTop: 3,
    catalogProvider: 'fixture'
  });
  assert.match(result.reviewBoardHtml, /Full-book casting biography/i);
  assert.match(result.reviewBoardHtml, /Book fit/i);
  assert.match(result.reviewBoardHtml, /Oklahoma|country/i);
  assert.equal(result.discovery.guardrails.auditionRenderingArmed, false);
  assert.equal(result.discovery.guardrails.paidGenerationArmed, false);
});
