import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BOOK_ONE_NARRATOR_TASTE_PROFILE,
  scoreSingleNarratorTasteFit,
  BookOneCastingDiscoveryService,
  buildCastingDiscoveryFixture,
  YASREADY_AUDIOBOOKS_VERSION
} from '../src/index.js';

function candidate(overrides = {}) {
  const accent = overrides.accent ?? 'american';
  const locale = overrides.locale ?? 'en-US';
  return {
    provider: 'elevenlabs',
    providerVoiceId: overrides.providerVoiceId ?? Math.random().toString(36).slice(2),
    name: overrides.name ?? 'Voice',
    description: overrides.description ?? 'young warm conversational American male',
    category: 'professional',
    accent,
    gender: 'male',
    age: overrides.age ?? 'young',
    language: 'en',
    locale,
    useCase: overrides.useCase ?? 'conversational',
    descriptives: [],
    verifiedLanguages: [{
      language: 'en',
      locale,
      accent,
      modelId: 'eleven_multilingual_v2',
      previewUrl: `https://example.invalid/${overrides.providerVoiceId ?? 'voice'}.mp3`
    }],
    previewUrl: `https://example.invalid/${overrides.providerVoiceId ?? 'voice'}-primary.mp3`,
    noticePeriodDays: overrides.noticePeriodDays ?? 730,
    hasCustomRate: false,
    liveModerationEnabled: false,
    ...overrides
  };
}

const reviewedRound = [
  candidate({
    providerVoiceId: 'gilbert',
    name: 'Gilbert',
    description: 'English-speaking male with NYC Hispanic Accent.',
    accent: 'en-canadian',
    age: 'young',
    useCase: 'narrative_story'
  }),
  candidate({
    providerVoiceId: 'sebastian',
    name: 'Sebastian',
    description: 'low, smooth, conversational, and personable - US-born Latino.',
    accent: 'american',
    age: 'young',
    useCase: 'conversational',
    noticePeriodDays: 180
  }),
  candidate({
    providerVoiceId: 'rod',
    name: 'Rod',
    description: 'authentic middle-aged hispanic male voice — warm, straightforward, and very real guy. Mid-to-lower register with natural warmth and some gravel.',
    accent: 'american',
    age: 'middle_aged',
    useCase: 'conversational'
  }),
  candidate({
    providerVoiceId: 'andres',
    name: 'Andres',
    description: 'A confident American narrator ideal for documentaries about money, business, history, and the Latino experience.',
    accent: 'american',
    age: 'middle_aged',
    useCase: 'narrative_story'
  }),
  candidate({
    providerVoiceId: 'luis',
    name: 'Luis Gabriel',
    description: 'Hispanic, mid 30s, romantic male voice. Perfect for Romance narrations/storytelling.',
    accent: 'american',
    age: 'middle_aged',
    useCase: 'narrative_story',
    noticePeriodDays: 180
  }),
  candidate({
    providerVoiceId: 'ahamed',
    name: 'Ahamed',
    description: 'Warm, clear Indian English male voice with a calm, confident, natural conversational tone. Ideal for narration, tutorials, customer support, and business content.',
    accent: 'indian',
    locale: 'en-IN',
    age: 'young',
    useCase: 'narrative_story'
  })
];

test('0.14.3.14 is current application provenance', () => {
  assert.equal(YASREADY_AUDIOBOOKS_VERSION,'0.14.3.14');
});

test('human taste calibration is metadata-only and never claims acoustic learning', () => {
  assert.equal(BOOK_ONE_NARRATOR_TASTE_PROFILE.version, 'book-one-human-v1');
  assert.equal(BOOK_ONE_NARRATOR_TASTE_PROFILE.acousticSimilarityLearned, false);
  assert.match(BOOK_ONE_NARRATOR_TASTE_PROFILE.target, /young.*latino.*conversational/i);
});

test('Sebastian-style metadata outranks the five human-rejected profiles', () => {
  const scores = new Map(reviewedRound.map((voice) => [voice.name, scoreSingleNarratorTasteFit({
    ...voice,
    selectedEnglishProfile: {
      language: 'en',
      locale: voice.locale,
      accent: voice.accent,
      previewUrl: voice.verifiedLanguages[0].previewUrl
    }
  })]));
  const sebastian = scores.get('Sebastian');
  assert.ok(sebastian.score >= 80);
  for (const name of ['Gilbert', 'Rod', 'Andres', 'Luis Gabriel', 'Ahamed']) {
    assert.ok(sebastian.score > scores.get(name).score, `${name} should rank below Sebastian`);
  }
});

test('middle-aged and non-US preview profiles are hard excluded from the single-narrator shortlist', () => {
  const projected = reviewedRound.map((voice) => ({
    name: voice.name,
    fit: scoreSingleNarratorTasteFit({
      ...voice,
      selectedEnglishProfile: {
        language: 'en',
        locale: voice.locale,
        accent: voice.accent,
        previewUrl: voice.verifiedLanguages[0].previewUrl
      }
    })
  }));
  for (const name of ['Rod', 'Andres', 'Luis Gabriel', 'Gilbert', 'Ahamed']) {
    assert.equal(projected.find((row) => row.name === name).fit.hardExcludeFromShortlist, true);
  }
  assert.equal(projected.find((row) => row.name === 'Sebastian').fit.hardExcludeFromShortlist, false);
});

test('real-round metadata produces Sebastian as the only surviving shortlist candidate', async () => {
  const base = buildCastingDiscoveryFixture();
  const result = await new BookOneCastingDiscoveryService().build({
    launch: base.launch,
    prep: base.prep,
    voices: reviewedRound,
    auditionSamples: base.auditionSamples,
    costEstimator: base.estimateCost,
    perRole: 6,
    auditionTop: 3,
    catalogProvider: 'fixture',
    castingMode: 'single-narrator'
  });
  const shortlist = result.discovery.shortlists[0];
  assert.equal(shortlist.character, 'Narrator');
  assert.equal(shortlist.candidates.length, 1);
  assert.equal(shortlist.candidates[0].voice.name, 'Sebastian');
  assert.equal(shortlist.candidates[0].tasteFit.profileVersion, 'book-one-human-v1');
  assert.equal(shortlist.candidates[0].tasteFit.acousticSimilarityLearned, false);
  assert.equal(result.discovery.guardrails.humanTasteMetadataCalibrationActive, true);
  assert.equal(result.discovery.guardrails.humanTasteAcousticInferencePerformed, false);
});

test('refined search profile targets young US Latino conversational voices instead of generic narrator categories', () => {
  const terms = BOOK_ONE_NARRATOR_TASTE_PROFILE.target.toLowerCase();
  assert.match(terms, /young/);
  assert.match(terms, /latino/);
  assert.match(terms, /conversational/);
});
