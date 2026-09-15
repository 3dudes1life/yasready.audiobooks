import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCharacterCastingBiographiesFromPrepRun,
  scoreCharacterBiographyFit,
  selectEnglishCastingProfile,
  projectEnglishCastingVoice,
  BookOneCastingDiscoveryService,
  buildCastingDiscoveryFixture,
  buildAuditionSamplePackFromPrepRun,
  YASREADY_AUDIOBOOKS_VERSION
} from '../src/index.js';

function voice(overrides = {}) {
  return {
    provider: 'elevenlabs',
    providerVoiceId: overrides.providerVoiceId ?? 'voice',
    name: overrides.name ?? 'Voice',
    description: overrides.description ?? 'warm natural conversational American male voice',
    category: 'professional',
    accent: overrides.accent ?? 'american',
    gender: 'male',
    age: overrides.age ?? 'young',
    language: overrides.language ?? 'en',
    locale: overrides.locale ?? 'en-US',
    useCase: overrides.useCase ?? 'conversational',
    descriptives: overrides.descriptives ?? ['natural'],
    verifiedLanguages: overrides.verifiedLanguages ?? [
      { language: 'en', locale: 'en-US', accent: 'american', modelId: 'eleven_multilingual_v2', previewUrl: 'https://example.invalid/en.mp3' }
    ],
    previewUrl: overrides.previewUrl ?? 'https://example.invalid/primary.mp3',
    noticePeriodDays: 730,
    hasCustomRate: false,
    liveModerationEnabled: false,
    ...overrides
  };
}

function biographyPrepFixture() {
  const base = buildCastingDiscoveryFixture();
  const chapters = [{
    order: 1,
    title: 'Chapter 1',
    scenes: [{
      segments: [
        { kind: 'narration', text: 'Michael Rawlins had grown up on a ranch in Oklahoma, under huge plains skies.' },
        { kind: 'narration', text: 'Juan Delgado booked a weekend in San Francisco with the guys before his next DJ set.' },
        { kind: 'dialogue', text: '[Juan]: How’s Florida? How’s the fam?' },
        { kind: 'dialogue', text: '[Juan]: Nope. Brunch. We survived Oklahoma. That deserves mimosas.' },
        { kind: 'narration', text: 'Christopher Lancaster was back in San Francisco, settling into his apartment and routine.' },
        { kind: 'dialogue', text: 'You’re the DJ. You do not get kitchen privileges too.' }
      ]
    }]
  }];

  return {
    launch: base.launch,
    prepRun: {
      prep: {
        ...base.prep,
        status: 'AUDIO_BIBLE_LOCKED',
        book: { ...base.prep.book, sourceHash: base.launch.book.sourceHash },
        dialogueReview: { autoBindings: [] }
      },
      ingestResult: {
        analysis: { chapters },
        segments: chapters[0].scenes[0].segments.map((_, i) => ({ id: `seg-${i + 1}` }))
      }
    }
  };
}

test('0.14.3.20.5 is current application provenance', () => {
  assert.equal(YASREADY_AUDIOBOOKS_VERSION,'0.14.3.20.5');
});

test('travel and conversation locations do not become character origin/residence truth', () => {
  const data = biographyPrepFixture();
  const bios = buildCharacterCastingBiographiesFromPrepRun(data.prepRun, data.launch);
  const juan = bios.profiles.find((row) => row.character === 'Juan Delgado');

  assert.equal(juan.evidence.some((row) => row.ruleId === 'bay-area' && row.source === 'manuscript-semantic-attribution'), false);
  assert.equal(juan.evidence.some((row) => row.ruleId === 'florida' && row.source === 'manuscript-semantic-attribution'), false);
  assert.equal(juan.evidence.some((row) => row.ruleId === 'oklahoma' && row.source === 'manuscript-semantic-attribution'), false);
  assert.match(juan.castingProfile.summary, /Region: Florida/);
  assert.doesNotMatch(juan.castingProfile.summary, /Oklahoma|Bay Area/);
  assert.ok(juan.evidence.some((row) => row.ruleId === 'canon-florida' && row.source === 'operator-confirmed-canon' && row.confidenceLabel === 'confirmed'));
});

test('nearby DJ language cannot leak occupation onto Michael', () => {
  const data = biographyPrepFixture();
  const bios = buildCharacterCastingBiographiesFromPrepRun(data.prepRun, data.launch);
  const michael = bios.profiles.find((row) => row.character === 'Michael Rawlins');
  assert.equal(michael.evidence.some((row) => row.ruleId === 'dj'), false);
  assert.doesNotMatch(michael.castingProfile.summary, /DJ/);
});

test('operator-confirmed fictional canon is preserved without becoming an acoustic identity score', () => {
  const data = biographyPrepFixture();
  const bios = buildCharacterCastingBiographiesFromPrepRun(data.prepRun, data.launch);
  const juan = bios.profiles.find((row) => row.character === 'Juan Delgado');
  const michael = bios.profiles.find((row) => row.character === 'Michael Rawlins');
  const christopher = bios.profiles.find((row) => row.character === 'Christopher Lancaster');

  assert.ok(juan.evidence.some((row) => row.ruleId === 'canon-latino'));
  assert.ok(michael.evidence.some((row) => row.ruleId === 'canon-white'));
  assert.ok(michael.evidence.some((row) => row.ruleId === 'canon-young-adult'));
  assert.ok(christopher.evidence.some((row) => row.ruleId === 'canon-asian-american'));
  assert.equal(bios.identityUsedAsAcousticTrait, false);
  assert.equal(michael.castingProfile.identityUsedAsAcousticTrait, false);
});

test('Michael still derives Oklahoma/ranch target from clean character truth', () => {
  const data = biographyPrepFixture();
  const bios = buildCharacterCastingBiographiesFromPrepRun(data.prepRun, data.launch);
  const michael = bios.profiles.find((row) => row.character === 'Michael Rawlins');
  assert.match(michael.castingProfile.regionalFlavor.label, /Oklahoma|country/i);
  assert.equal(michael.castingProfile.regionalFlavor.requiredForPreferredAudition, true);
});

test('English preview integrity rejects Spanish-primary core voices even when English exists somewhere in verified languages', () => {
  const spanishPrimary = voice({
    language: 'es',
    locale: 'es-AR',
    accent: 'latin american',
    previewUrl: 'https://example.invalid/spanish.mp3',
    verifiedLanguages: [
      { language: 'es', locale: 'es-AR', accent: 'latin american', modelId: 'eleven_multilingual_v2', previewUrl: 'https://example.invalid/spanish.mp3' },
      { language: 'en', locale: 'en-US', accent: 'other', modelId: 'eleven_multilingual_v2', previewUrl: 'https://example.invalid/english.mp3' }
    ]
  });
  const selected = selectEnglishCastingProfile(spanishPrimary);
  assert.equal(selected.ready, true);
  assert.equal(selected.primaryEnglish, false);
  assert.equal(selected.coreAuditionEligible, false);
  assert.equal(selected.previewUrl, 'https://example.invalid/english.mp3');
});

test('English-primary voice uses model-specific English preview and only that accent drives Book Fit', () => {
  const candidate = voice({
    accent: 'american',
    verifiedLanguages: [
      { language: 'en', locale: 'en-US', accent: 'en-us-midwest', modelId: 'eleven_multilingual_v2', previewUrl: 'https://example.invalid/midwest.mp3' },
      { language: 'es', locale: 'es-MX', accent: 'mexican', modelId: 'eleven_multilingual_v2', previewUrl: 'https://example.invalid/spanish.mp3' },
      { language: 'en', locale: 'en-US', accent: 'en-us-southern', modelId: 'eleven_flash_v2_5', previewUrl: 'https://example.invalid/south.mp3' }
    ]
  });
  const projected = projectEnglishCastingVoice(candidate, { model: 'eleven_multilingual_v2' });
  assert.equal(projected.previewUrl, 'https://example.invalid/midwest.mp3');
  assert.match(projected.accent, /midwest/i);
  assert.equal(projected.language, 'en');
  assert.equal(projected.selectedEnglishProfile.modelId, 'eleven_multilingual_v2');
});

test('verified languages that are not selected cannot fabricate Michael regional Book Fit', () => {
  const data = biographyPrepFixture();
  const bios = buildCharacterCastingBiographiesFromPrepRun(data.prepRun, data.launch);
  const michael = bios.profiles.find((row) => row.character === 'Michael Rawlins');

  const generic = projectEnglishCastingVoice(voice({
    description: 'young neutral American conversational male',
    verifiedLanguages: [
      { language: 'en', locale: 'en-US', accent: 'american', modelId: 'eleven_multilingual_v2', previewUrl: 'https://example.invalid/en.mp3' },
      { language: 'es', locale: 'es-ES', accent: 'southern', modelId: 'eleven_flash_v2_5', previewUrl: 'https://example.invalid/es.mp3' }
    ]
  }));
  const fit = scoreCharacterBiographyFit(generic, michael);
  assert.equal(fit.preferredAuditionRequirement, true);
  assert.equal(fit.requirementMet, false);
  assert.ok(fit.score < 80);
});

test('middle-aged Michael is a stronger stretch than young metadata', async () => {
  const base = buildCastingDiscoveryFixture();
  const data = biographyPrepFixture();
  const bios = buildCharacterCastingBiographiesFromPrepRun(data.prepRun, data.launch);

  const pool = base.voices.map((v, i) => ({
    ...v,
    providerVoiceId: `lang-${i + 1}`,
    language: 'en',
    locale: 'en-US',
    previewUrl: `https://example.invalid/${i + 1}.mp3`,
    verifiedLanguages: [{
      language: 'en',
      locale: 'en-US',
      accent: i === 0 ? 'en-us-midwest' : 'american',
      modelId: 'eleven_multilingual_v2',
      previewUrl: `https://example.invalid/${i + 1}.mp3`
    }],
    age: i === 0 ? 'young' : 'middle_aged',
    description: i === 0 ? 'young Oklahoma country rural grounded American male' : v.description
  }));

  const result = await new BookOneCastingDiscoveryService().build({
    launch: base.launch,
    prep: base.prep,
    voices: pool,
    auditionSamples: base.auditionSamples,
    characterBiographies: bios,
    costEstimator: base.estimateCost,
    perRole: 5,
    auditionTop: 3,
    catalogProvider: 'fixture'
  });
  const michael = result.discovery.shortlists.find((row) => row.character === 'Michael Rawlins');
  assert.equal(michael.candidates[0].voice.age, 'young');
  assert.equal(michael.candidates[0].biographyFit.requirementMet, true);
  assert.match(michael.candidates[0].voice.description, /Oklahoma|country|rural/i);
  assert.equal(result.discovery.guardrails.constrainedRoleScarcityProtection, true);
});

test('narrator audition extraction rejects reader-facing closing/back-matter copy', () => {
  // This test exercises the public sample-pack path with a tiny canonical prep run.
  const base = buildCastingDiscoveryFixture();
  const rows = [
    { id: 'n1', kind: 'narration', text: 'The morning air felt sharp against his face as he crossed the terminal, suitcase in hand, trying not to think about how much his life was about to change.' },
    { id: 'n2', kind: 'narration', text: 'By the middle of the year, the three of them had learned how to make room for silence without mistaking it for distance, and that felt like its own kind of promise.' },
    { id: 'n3', kind: 'narration', text: 'This isn’t just our story — it’s ours, thank you for being a part of it and it’s just getting started.' },
    { id: 'n4', kind: 'narration', text: 'Later, the ocean rolled beneath the fading light while they stood shoulder to shoulder, tired and uncertain but finally willing to imagine the future together.' }
  ];
  const prepRun = {
    prep: {
      ...base.prep,
      status: 'AUDIO_BIBLE_LOCKED',
      book: { ...base.prep.book, sourceHash: base.launch.book.sourceHash },
      dialogueReview: { autoBindings: [] }
    },
    ingestResult: {
      analysis: {
        chapters: [{
          order: 1, title: 'Chapter 1', scenes: [{ segments: rows.map(({ id, ...segment }) => segment) }]
        }]
      },
      segments: rows.map((row) => ({ id: row.id }))
    }
  };
  const pack = buildAuditionSamplePackFromPrepRun(prepRun, base.launch);
  const narrator = pack.samples.find((row) => row.character === 'Narrator');
  assert.equal(narrator.scripts.some((row) => /thank you for being a part|this isn.t just our story/i.test(row.text)), false);
});
