import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SINGLE_NARRATOR_PROFILE,
  scoreSingleNarratorCulturalFit,
  scoreSingleNarratorFit,
  buildSingleNarratorAuditionSamplePack,
  buildSingleNarratorPerformanceGuide,
  renderSingleNarratorPerformanceGuideMarkdown,
  BookOneCastingDiscoveryService,
  buildCastingDiscoveryFixture,
  YASREADY_AUDIOBOOKS_VERSION
} from '../src/index.js';

function voice(overrides = {}) {
  return {
    provider: 'elevenlabs',
    providerVoiceId: overrides.providerVoiceId ?? 'voice',
    name: overrides.name ?? 'Voice',
    description: overrides.description ?? 'young strong warm confident contemporary American audiobook narrator',
    category: 'professional',
    accent: overrides.accent ?? 'california',
    gender: overrides.gender ?? 'male',
    age: overrides.age ?? 'young',
    language: overrides.language ?? 'en',
    locale: overrides.locale ?? 'en-US',
    useCase: overrides.useCase ?? 'narration',
    descriptives: overrides.descriptives ?? ['warm', 'strong', 'storytelling'],
    verifiedLanguages: overrides.verifiedLanguages ?? [{
      language: 'en',
      locale: 'en-US',
      accent: 'california',
      modelId: 'eleven_multilingual_v2',
      previewUrl: 'https://example.invalid/english.mp3'
    }],
    previewUrl: overrides.previewUrl ?? 'https://example.invalid/primary.mp3',
    noticePeriodDays: 730,
    hasCustomRate: false,
    liveModerationEnabled: false,
    ...overrides
  };
}

test('0.14.3.13 is current application provenance', () => {
  assert.equal(YASREADY_AUDIOBOOKS_VERSION,'0.14.3.13');
});

test('single narrator target is young strong Southern California Latino American without acoustic identity inference', () => {
  assert.match(SINGLE_NARRATOR_PROFILE.label, /young.*strong.*southern california.*latino/i);
  assert.equal(SINGLE_NARRATOR_PROFILE.cultural.requiredForAudition, true);
  assert.match(SINGLE_NARRATOR_PROFILE.characterContext, /never be inferred|identity is never inferred/i);
});

test('explicit Latino metadata qualifies while Spanish capability alone does not infer identity', () => {
  const explicit = scoreSingleNarratorCulturalFit(voice({
    description: 'young Latino American Southern California audiobook narrator'
  }));
  const spanishOnly = scoreSingleNarratorCulturalFit(voice({
    description: 'young bilingual English Spanish audiobook narrator'
  }));
  assert.equal(explicit.requirementMet, true);
  assert.equal(explicit.score, 100);
  assert.equal(spanishOnly.requirementMet, false);
  assert.ok(spanishOnly.score < explicit.score);
  assert.equal(explicit.inferenceFromAudioOrName, false);
});

test('young strong SoCal narrator materially outranks older generic narrator fit', () => {
  const target = scoreSingleNarratorFit(voice({
    description: 'young strong warm confident Southern California West Coast audiobook storytelling voice',
    age: 'young',
    accent: 'california'
  }));
  const generic = scoreSingleNarratorFit(voice({
    description: 'neutral general voice',
    age: 'middle_aged',
    accent: 'american',
    useCase: 'conversational'
  }));
  assert.ok(target.score >= 82);
  assert.ok(target.score > generic.score + 12);
  assert.ok(target.regionalMatches.length > 0);
});

test('single narrator audition pack collapses narrator and three lead samples into one role', () => {
  const base = buildCastingDiscoveryFixture();
  const pack = buildSingleNarratorAuditionSamplePack(base.auditionSamples);
  assert.equal(pack.castingMode, 'single-narrator');
  assert.equal(pack.samples.length, 1);
  assert.equal(pack.samples[0].character, 'Narrator');
  assert.ok(pack.samples[0].scripts.some((row) => /Juan Delgado/i.test(row.label)));
  assert.ok(pack.samples[0].scripts.some((row) => /Michael Rawlins/i.test(row.label)));
  assert.ok(pack.samples[0].scripts.some((row) => /Christopher Lancaster/i.test(row.label)));
});

test('performance guide turns lead biographies into direction instead of separate actor assignments', () => {
  const guide = buildSingleNarratorPerformanceGuide({ profiles: [
    { character: 'Juan Delgado' }, { character: 'Michael Rawlins' }, { character: 'Christopher Lancaster' }
  ]});
  assert.equal(guide.oneNarratorPerformsAllCharacters, true);
  assert.equal(guide.characterBiographiesUsedToSelectSeparateActors, false);
  assert.equal(guide.characters.length, 3);
  assert.match(guide.characters.find((row) => row.character === 'Michael Rawlins').performanceDirection, /Oklahoma|Plains/i);
  assert.match(guide.characters.find((row) => row.character === 'Christopher Lancaster').avoid, /stereotyped ethnic accent/i);
  assert.match(renderSingleNarratorPerformanceGuideMarkdown(guide), /one narrator/i);
});

test('single-narrator service mode stages only Narrator and requires Latino metadata for auto-audition', async () => {
  const base = buildCastingDiscoveryFixture();
  const voices = Array.from({ length: 12 }, (_, index) => voice({
    providerVoiceId: `single-${index + 1}`,
    name: `Single Voice ${index + 1}`,
    description: index < 4
      ? 'young strong warm confident Latino American Southern California audiobook narrator storytelling romance'
      : 'young warm confident California audiobook narrator storytelling romance',
    accent: index < 4 ? 'california' : 'american'
  }));

  const result = await new BookOneCastingDiscoveryService().build({
    launch: base.launch,
    prep: base.prep,
    voices,
    auditionSamples: base.auditionSamples,
    costEstimator: base.estimateCost,
    perRole: 6,
    auditionTop: 3,
    catalogProvider: 'fixture',
    castingMode: 'single-narrator'
  });

  assert.equal(result.discovery.castingMode, 'single-narrator');
  assert.equal(result.discovery.shortlists.length, 1);
  assert.equal(result.discovery.shortlists[0].character, 'Narrator');
  assert.equal(result.discovery.performanceGuide.oneNarratorPerformsAllCharacters, true);
  const auditions = result.discovery.shortlists[0].candidates.filter((row) => row.recommendation === 'AUDITION');
  assert.ok(auditions.length >= 1);
  assert.ok(auditions.every((row) => row.culturalFit.requirementMet));
  assert.equal(result.discovery.guardrails.separateCoreCharacterVoiceActorsRequired, false);
  assert.equal(result.discovery.guardrails.paidProviderCallsPerformed, 0);
  assert.equal(result.discovery.guardrails.generationCallsPerformed, 0);
});

test('single-narrator provider discovery performs zero-spend narrator-specific searches', async () => {
  const base = buildCastingDiscoveryFixture();
  const calls = [];
  const provider = {
    name: 'elevenlabs',
    apiKey: 'fixture-key',
    async searchVoices(options) {
      calls.push(options);
      return {
        voices: Array.from({ length: 10 }, (_, index) => voice({
          providerVoiceId: `provider-${index + 1}`,
          description: 'young strong Latino American Southern California audiobook narrator'
        })),
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
    perRole: 5,
    auditionTop: 3,
    maxPages: 1,
    pageSize: 100,
    castingMode: 'single-narrator'
  });

  assert.ok(calls.some((row) => /latino american|southern california|california west coast/i.test(String(row.search ?? ''))));
  assert.ok(result.discovery.catalog.supplementalSearchesPerformed.some((row) => row.source === 'single-narrator-profile'));
  assert.equal(result.discovery.shortlists.length, 1);
  assert.equal(result.discovery.guardrails.auditionRenderingArmed, false);
  assert.equal(result.discovery.guardrails.paidGenerationArmed, false);
});
