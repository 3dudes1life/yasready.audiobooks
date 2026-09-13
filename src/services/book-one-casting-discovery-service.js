import { createHash } from 'node:crypto';
import { normalizeVoiceProfile, scoreSeriesSafety } from '../casting/voice-profile.js';
import { scoreCharacterBiographyFit } from '../casting/character-biography.js';
import {
  SINGLE_NARRATOR_PROFILE,
  buildSingleNarratorAuditionSamplePack,
  buildSingleNarratorPerformanceGuide,
  renderSingleNarratorPerformanceGuideMarkdown,
  scoreSingleNarratorCulturalFit,
  scoreSingleNarratorFit
} from '../casting/single-narrator.js';
import { YASREADY_AUDIOBOOKS_VERSION } from '../release.js';

const freeze = (value) => Object.freeze(value);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const clean = (value) => String(value ?? '').trim();
const lower = (value) => clean(value).toLowerCase();

const BOOK_ONE_CASTING_INTENTS = Object.freeze({
  Narrator: Object.freeze({
    label: 'Warm contemporary romance narrator',
    preferredGender: 'male',
    preferredAccents: Object.freeze(['american', 'neutral', 'standard', 'californian']),
    preferredAges: Object.freeze(['young', 'middle aged', 'adult']),
    preferredUseCases: Object.freeze(['narrative story', 'narration', 'audiobook']),
    keywords: Object.freeze(['audiobook', 'narration', 'storytelling', 'warm', 'natural', 'conversational', 'expressive', 'emotional'])
  }),
  'Juan Delgado': Object.freeze({
    label: 'Warm, confident, playful Latino American lead',
    characterContext: 'Juan is Latino. Contemporary American/neutral delivery is welcome; cultural fit must never be inferred from sound or reduced to a stereotyped accent.',
    preferredGender: 'male',
    preferredAccents: Object.freeze(['american', 'neutral', 'standard', 'californian', 'latin american']),
    preferredAges: Object.freeze(['young', 'middle aged', 'adult']),
    preferredUseCases: Object.freeze(['conversational', 'narrative story']),
    keywords: Object.freeze(['warm', 'confident', 'playful', 'charismatic', 'conversational', 'expressive', 'romantic']),
    cultural: Object.freeze({
      label: 'Latino American cultural fit',
      requiredForAudition: true,
      strongSignals: Object.freeze(['latino', 'latina', 'latin american', 'hispanic', 'mexican american', 'chicano', 'puerto rican', 'cuban american', 'colombian american', 'venezuelan american', 'peruvian american', 'salvadoran american', 'guatemalan american', 'dominican american']),
      supportSignals: Object.freeze(['bilingual', 'spanish', 'english spanish', 'es us', 'es mx']),
      searchTerms: Object.freeze(['latino', 'latin american', 'hispanic', 'mexican american'])
    })
  }),
  'Michael Rawlins': Object.freeze({
    label: 'Young, grounded Oklahoma ranch-background lead',
    characterContext: 'Michael is a young adult white man from an Oklahoma ranch/farm background. Prefer mild contemporary Oklahoma/Plains/country coloration when supported by the selected English profile; avoid cowboy caricature. White identity is canon, not an acoustic trait.',
    preferredGender: 'male',
    preferredAccents: Object.freeze(['american', 'neutral', 'oklahoma', 'plains', 'midwest', 'country', 'southern']),
    preferredAges: Object.freeze(['young', 'young adult']),
    preferredUseCases: Object.freeze(['conversational', 'narrative story']),
    keywords: Object.freeze(['grounded', 'warm', 'natural', 'emotional', 'calm', 'conversational', 'intimate', 'country', 'oklahoma', 'rural'])
  }),
  'Christopher Lancaster': Object.freeze({
    label: 'Confident, polished, warm Asian American Bay Area lead',
    characterContext: 'Christopher is Asian American from the San Francisco Bay Area. Contemporary American/California delivery is the audible target; no stereotyped ethnic accent is required or rewarded.',
    preferredGender: 'male',
    preferredAccents: Object.freeze(['american', 'neutral', 'standard', 'californian', 'california', 'west coast', 'bay area']),
    preferredAges: Object.freeze(['young', 'middle aged', 'adult']),
    preferredUseCases: Object.freeze(['conversational', 'narrative story']),
    keywords: Object.freeze(['confident', 'polished', 'warm', 'smooth', 'conversational', 'expressive', 'natural', 'california', 'bay area']),
    cultural: Object.freeze({
      label: 'Asian American / Bay Area context',
      requiredForAudition: false,
      identitySignals: Object.freeze(['asian american', 'filipino american', 'chinese american', 'korean american', 'japanese american', 'vietnamese american', 'taiwanese american']),
      regionalSignals: Object.freeze(['bay area', 'san francisco', 'sf bay', 'california', 'californian', 'west coast']),
      searchTerms: Object.freeze(['bay area', 'california', 'asian american'])
    })
  })
});

function sha256(value) {
  return createHash('sha256').update(String(value ?? '')).digest('hex');
}

function csvCell(value) {
  const text = Array.isArray(value) ? value.join(' | ') : String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

function assertArtifacts(launch, prep) {
  if (!launch || typeof launch !== 'object') throw new Error('Casting Candidate Discovery requires casting-launch.json');
  if (!prep || typeof prep !== 'object') throw new Error('Casting Candidate Discovery requires book-one-audio-bible-prep.json');
  if (launch.status !== 'READY_FOR_CANDIDATE_DISCOVERY') throw new Error('Casting Candidate Discovery requires READY_FOR_CANDIDATE_DISCOVERY launch state');
  if (launch.guardrails?.candidateDiscoveryAllowed !== true) throw new Error('Casting Candidate Discovery is not allowed by launch guardrails');
  if (launch.guardrails?.auditionRenderingArmed || launch.guardrails?.paidGenerationArmed || launch.guardrails?.productionArmed) {
    throw new Error('Casting Candidate Discovery refuses an already-armed paid/production state');
  }
  if (prep.status !== 'AUDIO_BIBLE_LOCKED' || prep.audioBible?.locked !== true || prep.gates?.productionReady !== true) {
    throw new Error('Casting Candidate Discovery requires a locked production-ready Audio Bible prep artifact');
  }
  if (launch.book?.id !== prep.book?.id || launch.book?.sourceHash !== prep.book?.sourceHash) {
    throw new Error('Casting Candidate Discovery book/source hash does not match Audio Bible prep');
  }
  if (launch.source?.audioBibleId !== prep.audioBible?.id || launch.source?.audioBibleDigest !== prep.audioBible?.digest) {
    throw new Error('Casting Candidate Discovery Audio Bible identity/digest does not match prep');
  }
  if (!Array.isArray(prep.snapshot?.characters) || prep.snapshot.characters.length === 0) {
    throw new Error('Casting Candidate Discovery requires Audio Bible snapshot characters');
  }
  const waveOne = launch.waves?.find((row) => row.wave === 1)?.targets ?? [];
  if (!waveOne.length) throw new Error('Casting Candidate Discovery requires Wave 1 targets');
  const snapshotNames = new Set(prep.snapshot.characters.map((row) => row.canonicalName));
  for (const target of waveOne) {
    if (!snapshotNames.has(target.canonicalName)) throw new Error(`Casting Candidate Discovery cannot resolve character identity for ${target.canonicalName}`);
  }
  return { launch, prep, waveOne };
}

function normalizedVoice(raw) {
  if (raw?.providerVoiceId) {
    return freeze({
      provider: raw.provider ?? 'elevenlabs',
      source: raw.source ?? 'voice-library',
      providerVoiceId: raw.providerVoiceId,
      publicOwnerId: raw.publicOwnerId ?? null,
      name: raw.name ?? 'Unnamed voice',
      description: raw.description ?? '',
      category: raw.category ?? null,
      accent: raw.accent ?? null,
      gender: raw.gender ?? null,
      age: raw.age ?? null,
      language: raw.language ?? null,
      locale: raw.locale ?? null,
      useCase: raw.useCase ?? null,
      descriptives: freeze([...(raw.descriptives ?? [])]),
      verifiedLanguages: freeze([...(raw.verifiedLanguages ?? [])]),
      previewUrl: raw.previewUrl ?? null,
      selectedEnglishProfile: raw.selectedEnglishProfile ? freeze({ ...raw.selectedEnglishProfile }) : null,
      previewIntegrity: raw.previewIntegrity ? freeze({ ...raw.previewIntegrity }) : null,
      catalogPrimaryLanguage: raw.catalogPrimaryLanguage ?? raw.language ?? null,
      catalogPrimaryLocale: raw.catalogPrimaryLocale ?? raw.locale ?? null,
      catalogPrimaryAccent: raw.catalogPrimaryAccent ?? raw.accent ?? null,
      noticePeriodDays: Number(raw.noticePeriodDays ?? 0) || 0,
      disableAtUnix: raw.disableAtUnix ?? null,
      customRate: raw.customRate ?? null,
      hasCustomRate: Boolean(raw.hasCustomRate),
      liveModerationEnabled: Boolean(raw.liveModerationEnabled),
      featured: Boolean(raw.featured),
      usageCharacterCount1y: Number(raw.usageCharacterCount1y ?? 0) || 0,
      clonedByCount: Number(raw.clonedByCount ?? 0) || 0
    });
  }
  return normalizeVoiceProfile(raw, { provider: raw?.provider ?? 'elevenlabs', source: raw?.source ?? 'voice-library' });
}

function metadataText(voice) {
  return [
    voice.name, voice.description, voice.category, voice.accent, voice.gender, voice.age, voice.language,
    voice.locale, voice.useCase, ...(voice.descriptives ?? []),
    voice.selectedEnglishProfile?.accent, voice.selectedEnglishProfile?.locale
  ].filter(Boolean).join(' ').toLowerCase();
}

function englishAccentLabel(accent, locale = null) {
  const raw = normalizedTrait(accent);
  if (!raw && /^en-us\b/i.test(String(locale ?? ''))) return 'american';
  if (/^en us (.+)$/.test(raw)) {
    const tail = raw.replace(/^en us /, '').trim();
    if (!tail || tail === 'standard') return 'american';
    if (tail === 'other') return 'other';
    return `american ${tail}`;
  }
  if (/^en (arabic|indian|chinese|korean|spanish|latin|russian|french|german)\b/.test(raw)) {
    return `${raw.replace(/^en /, '')}-accented english`;
  }
  return raw || null;
}

export function selectEnglishCastingProfile(rawVoice, { model = 'eleven_multilingual_v2' } = {}) {
  const voice = normalizedVoice(rawVoice);
  const primaryLanguage = lower(voice.catalogPrimaryLanguage ?? voice.language);
  const primaryLocale = clean(voice.catalogPrimaryLocale ?? voice.locale);
  const primaryEnglish = primaryLanguage === 'en' || /^en(?:-|$)/i.test(primaryLocale);
  const primaryLanguageExplicit = Boolean(primaryLanguage);

  const englishRows = (voice.verifiedLanguages ?? [])
    .filter((row) => lower(row.language) === 'en' && clean(row.previewUrl))
    .map((row) => ({
      language: 'en',
      locale: row.locale ?? null,
      accent: englishAccentLabel(row.accent, row.locale),
      rawAccent: row.accent ?? null,
      modelId: row.modelId ?? null,
      previewUrl: row.previewUrl
    }))
    .sort((a, b) => {
      const exactA = a.modelId === model ? 1 : 0;
      const exactB = b.modelId === model ? 1 : 0;
      if (exactA !== exactB) return exactB - exactA;
      const specific = (row) => row.accent && !['american', 'standard', 'other'].includes(normalizedTrait(row.accent)) ? 1 : 0;
      if (specific(a) !== specific(b)) return specific(b) - specific(a);
      return String(a.locale ?? '').localeCompare(String(b.locale ?? ''));
    });

  let selected = englishRows[0] ?? null;
  if (!selected && primaryEnglish && clean(voice.previewUrl)) {
    selected = {
      language: 'en',
      locale: voice.locale ?? null,
      accent: englishAccentLabel(voice.accent, voice.locale),
      rawAccent: voice.accent ?? null,
      modelId: null,
      previewUrl: voice.previewUrl
    };
  }

  const ready = Boolean(selected?.previewUrl);
  const coreAuditionEligible = Boolean(ready && (!primaryLanguageExplicit || primaryEnglish));
  return freeze({
    ready,
    desiredLanguage: 'en',
    primaryLanguage: primaryLanguage || null,
    primaryLocale: primaryLocale || null,
    primaryAccent: voice.catalogPrimaryAccent ?? voice.accent ?? null,
    primaryEnglish,
    primaryLanguageExplicit,
    coreAuditionEligible,
    selectionSource: selected ? (englishRows.length ? 'verified-english-profile' : 'catalog-primary') : 'missing',
    model,
    language: selected?.language ?? null,
    locale: selected?.locale ?? null,
    accent: selected?.accent ?? null,
    rawAccent: selected?.rawAccent ?? null,
    modelId: selected?.modelId ?? null,
    previewUrl: selected?.previewUrl ?? null,
    score: !ready ? 0 : primaryEnglish || !primaryLanguageExplicit ? 100 : 62
  });
}

export function projectEnglishCastingVoice(rawVoice, { model = 'eleven_multilingual_v2' } = {}) {
  const voice = normalizedVoice(rawVoice);
  const previewIntegrity = selectEnglishCastingProfile(voice, { model });
  if (!previewIntegrity.ready) return null;
  return freeze({
    ...voice,
    catalogPrimaryLanguage: voice.catalogPrimaryLanguage ?? voice.language ?? null,
    catalogPrimaryLocale: voice.catalogPrimaryLocale ?? voice.locale ?? null,
    catalogPrimaryAccent: voice.catalogPrimaryAccent ?? voice.accent ?? null,
    language: 'en',
    locale: previewIntegrity.locale,
    accent: previewIntegrity.accent,
    previewUrl: previewIntegrity.previewUrl,
    selectedEnglishProfile: freeze({
      language: 'en',
      locale: previewIntegrity.locale,
      accent: previewIntegrity.accent,
      rawAccent: previewIntegrity.rawAccent,
      modelId: previewIntegrity.modelId,
      previewUrl: previewIntegrity.previewUrl
    }),
    previewIntegrity
  });
}

function roleIntent(target) {
  return BOOK_ONE_CASTING_INTENTS[target.canonicalName] ?? freeze({
    label: `${target.role} casting profile`,
    characterContext: null,
    preferredGender: null,
    keywords: freeze(['natural', 'conversational', 'expressive']),
    cultural: null
  });
}

function normalizedTrait(value) {
  return lower(value).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function matchesAnyTrait(value, options = []) {
  const actual = normalizedTrait(value);
  if (!actual) return false;
  return options.some((option) => {
    const desired = normalizedTrait(option);
    return actual === desired || actual.includes(desired) || desired.includes(actual);
  });
}

function explicitSignalMatches(text, signals = []) {
  const normalized = normalizedTrait(text);
  return signals.filter((signal) => {
    const wanted = normalizedTrait(signal);
    return wanted && normalized.includes(wanted);
  });
}

export function scoreBookOneCulturalFit(rawVoice, target) {
  const voice = normalizedVoice(rawVoice);
  const intent = roleIntent(target);
  const policy = intent.cultural ?? null;
  if (!policy) {
    return freeze({
      applicable: false,
      label: 'Not applicable',
      score: null,
      requiredForAudition: false,
      requirementMet: true,
      matchedSignals: freeze([]),
      supportSignals: freeze([]),
      flags: freeze([]),
      source: 'explicit-provider-catalog-metadata-only',
      inferenceFromAudioOrName: false
    });
  }

  const text = metadataText(voice);
  const flags = [];

  if (target.canonicalName === 'Juan Delgado') {
    const matchedSignals = explicitSignalMatches(text, policy.strongSignals);
    const supportSignals = explicitSignalMatches(text, policy.supportSignals);
    const requirementMet = matchedSignals.length > 0;
    const score = requirementMet ? 100 : supportSignals.length ? 58 : 30;
    if (!requirementMet) {
      flags.push(freeze({
        code: 'cultural-signal-required',
        severity: 'gating',
        note: supportSignals.length
          ? 'Spanish/bilingual catalog metadata is helpful but does not by itself establish Latino identity; explicit Latino/Latin-American/Hispanic metadata is required for Juan auto-audition.'
          : 'No explicit Latino/Latin-American/Hispanic cultural signal appears in provider catalog metadata; this voice may remain visible but cannot be auto-recommended for Juan.'
      }));
    }
    return freeze({
      applicable: true,
      label: policy.label,
      score,
      requiredForAudition: true,
      requirementMet,
      matchedSignals: freeze(matchedSignals),
      supportSignals: freeze(supportSignals),
      flags: freeze(flags),
      source: 'explicit-provider-catalog-metadata-only',
      inferenceFromAudioOrName: false
    });
  }

  if (target.canonicalName === 'Christopher Lancaster') {
    const identitySignals = explicitSignalMatches(text, policy.identitySignals);
    const regionalSignals = explicitSignalMatches(text, policy.regionalSignals);
    const score = clamp(80 + Math.min(10, identitySignals.length * 10) + Math.min(10, regionalSignals.length * 10), 0, 100);
    return freeze({
      applicable: true,
      label: policy.label,
      score,
      requiredForAudition: false,
      requirementMet: true,
      matchedSignals: freeze([...identitySignals, ...regionalSignals]),
      supportSignals: freeze([]),
      flags: freeze([]),
      source: 'explicit-provider-catalog-metadata-only',
      inferenceFromAudioOrName: false
    });
  }

  return freeze({
    applicable: false,
    label: 'Not applicable',
    score: null,
    requiredForAudition: false,
    requirementMet: true,
    matchedSignals: freeze([]),
    supportSignals: freeze([]),
    flags: freeze([]),
    source: 'explicit-provider-catalog-metadata-only',
    inferenceFromAudioOrName: false
  });
}

export function scoreBookOneCastingFit(rawVoice, target) {
  const voice = normalizedVoice(rawVoice);
  const intent = roleIntent(target);
  const text = metadataText(voice);
  const matchedKeywords = intent.keywords.filter((word) => text.includes(word));
  const stretchFlags = [];
  let hardMismatch = false;
  let score = 35;

  if (intent.preferredGender && voice.gender) {
    if (normalizedTrait(voice.gender) === normalizedTrait(intent.preferredGender)) score += 18;
    else {
      score -= 30;
      hardMismatch = true;
      stretchFlags.push(freeze({ code: 'gender-mismatch', severity: 'hard', note: `Catalog gender ${voice.gender} does not match the current Book One ${intent.preferredGender} creative preference.` }));
    }
  }

  if (voice.useCase) {
    if (matchesAnyTrait(voice.useCase, intent.preferredUseCases)) score += 15;
    else {
      score -= 6;
      stretchFlags.push(freeze({ code: 'use-case-stretch', severity: 'soft', note: `Catalog use case ${voice.useCase} is not a preferred fit for this role.` }));
    }
  }

  if (voice.accent) {
    if (matchesAnyTrait(voice.accent, intent.preferredAccents)) score += 8;
    else {
      score -= 8;
      stretchFlags.push(freeze({ code: 'accent-stretch', severity: 'soft', note: `Catalog accent ${voice.accent} is outside the current Book One soft accent preference.` }));
    }
  }

  if (voice.age) {
    if (matchesAnyTrait(voice.age, intent.preferredAges)) score += 8;
    else if (target.role !== 'narrator' && /old|senior|elder/.test(normalizedTrait(voice.age))) {
      score -= 15;
      stretchFlags.push(freeze({ code: 'age-stretch', severity: 'strong', note: `Catalog age ${voice.age} is an obvious stretch for this Book One lead.` }));
    } else if (target.canonicalName === 'Michael Rawlins' && /middle aged|middle_aged/.test(normalizedTrait(voice.age))) {
      score -= 12;
      stretchFlags.push(freeze({ code: 'age-stretch', severity: 'strong', note: `Catalog age ${voice.age} is older than Michael's operator-confirmed young-adult target.` }));
    } else {
      score -= 4;
      stretchFlags.push(freeze({ code: 'age-stretch', severity: 'soft', note: `Catalog age ${voice.age} is outside the current Book One soft age preference.` }));
    }
  }

  if (voice.previewIntegrity?.primaryLanguageExplicit && !voice.previewIntegrity.primaryEnglish) {
    score -= 18;
    stretchFlags.push(freeze({ code: 'catalog-primary-language-stretch', severity: 'strong', note: `Catalog-primary language ${voice.previewIntegrity.primaryLanguage} is not English; core Book One audition requires an English-primary/unspecified catalog voice.` }));
  }

  score += Math.min(30, matchedKeywords.length * 5);
  if (voice.previewUrl) score += 3;
  const englishVerified = lower(voice.language) === 'en' && Boolean(voice.previewUrl);
  if (englishVerified) score += 4;

  const finalScore = clamp(Math.round(score), 0, 100);
  return freeze({
    score: finalScore,
    grade: hardMismatch ? 'hard-mismatch' : finalScore >= 90 ? 'excellent' : finalScore >= 82 ? 'strong' : finalScore >= 72 ? 'possible' : 'stretch',
    label: intent.label,
    matchedKeywords: freeze(matchedKeywords),
    preferredGender: intent.preferredGender,
    preferredAccents: freeze([...(intent.preferredAccents ?? [])]),
    preferredAges: freeze([...(intent.preferredAges ?? [])]),
    preferredUseCases: freeze([...(intent.preferredUseCases ?? [])]),
    characterContext: intent.characterContext ?? null,
    hardMismatch,
    stretchFlags: freeze(stretchFlags),
    preferenceSource: 'Book One casting default; a creative preference, not canonical character biography'
  });
}

function compactVoice(voice) {
  return freeze({
    provider: voice.provider,
    providerVoiceId: voice.providerVoiceId,
    publicOwnerId: voice.publicOwnerId ?? null,
    name: voice.name,
    description: voice.description ?? '',
    category: voice.category ?? null,
    accent: voice.accent ?? null,
    gender: voice.gender ?? null,
    age: voice.age ?? null,
    language: voice.language ?? null,
    locale: voice.locale ?? null,
    useCase: voice.useCase ?? null,
    descriptives: freeze([...(voice.descriptives ?? [])]),
    verifiedLanguages: freeze([...(voice.verifiedLanguages ?? [])]),
    previewUrl: voice.previewUrl ?? null,
    selectedEnglishProfile: voice.selectedEnglishProfile ? freeze({ ...voice.selectedEnglishProfile }) : null,
    previewLanguage: voice.selectedEnglishProfile?.language ?? voice.language ?? null,
    previewLocale: voice.selectedEnglishProfile?.locale ?? voice.locale ?? null,
    previewAccent: voice.selectedEnglishProfile?.accent ?? voice.accent ?? null,
    catalogPrimaryLanguage: voice.catalogPrimaryLanguage ?? null,
    catalogPrimaryLocale: voice.catalogPrimaryLocale ?? null,
    catalogPrimaryAccent: voice.catalogPrimaryAccent ?? null,
    noticePeriodDays: Number(voice.noticePeriodDays ?? 0),
    disableAtUnix: voice.disableAtUnix ?? null,
    hasCustomRate: Boolean(voice.hasCustomRate),
    liveModerationEnabled: Boolean(voice.liveModerationEnabled),
    featured: Boolean(voice.featured)
  });
}

function candidateScore(voice, target, biography = null) {
  const previewIntegrity = voice.previewIntegrity ?? selectEnglishCastingProfile(voice);
  const safety = scoreSeriesSafety(voice, { desiredLanguage: 'en' });
  const fit = scoreBookOneCastingFit(voice, target);
  const culturalFit = scoreBookOneCulturalFit(voice, target);
  const biographyFit = scoreCharacterBiographyFit(voice, biography);
  let combined;
  if (biographyFit.applicable && culturalFit.applicable) {
    combined = Number((safety.score * 0.20 + fit.score * 0.35 + culturalFit.score * 0.25 + biographyFit.score * 0.20).toFixed(1));
  } else if (biographyFit.applicable) {
    combined = Number((safety.score * 0.25 + fit.score * 0.50 + biographyFit.score * 0.25).toFixed(1));
  } else if (culturalFit.applicable) {
    combined = Number((safety.score * 0.25 + fit.score * 0.55 + culturalFit.score * 0.20).toFixed(1));
  } else {
    combined = Number((safety.score * 0.35 + fit.score * 0.65).toFixed(1));
  }
  combined = Number((combined * 0.88 + previewIntegrity.score * 0.12).toFixed(1));
  const strengths = [...safety.reasons];
  if (previewIntegrity.ready) strengths.push(`English preview selected (${previewIntegrity.locale ?? 'locale not listed'}${previewIntegrity.accent ? ` / ${previewIntegrity.accent}` : ''})`);
  if (fit.matchedKeywords.length) strengths.push(`casting-fit metadata: ${fit.matchedKeywords.join(', ')}`);
  if (culturalFit.matchedSignals.length) strengths.push(`explicit cultural/regional metadata: ${culturalFit.matchedSignals.join(', ')}`);
  if (biographyFit.matchedTerms?.length) strengths.push(`full-book biography match: ${biographyFit.matchedTerms.join(', ')}`);
  const concerns = [
    ...safety.warnings,
    ...fit.stretchFlags.map((row) => row.note),
    ...culturalFit.flags.map((row) => row.note),
    ...(biographyFit.concerns ?? []),
    ...(!previewIntegrity.coreAuditionEligible ? [`Catalog-primary language ${previewIntegrity.primaryLanguage ?? 'unknown'} is not eligible for English-first core audition recommendation.`] : [])
  ];
  if (!fit.matchedKeywords.length) concerns.push('limited role-specific descriptive metadata; audition matters more than metadata fit');
  return freeze({ voice, safety, fit, culturalFit, biographyFit, previewIntegrity, combined, strengths: freeze(strengths), concerns: freeze(concerns) });
}

function meetsBookOneDiscoveryPolicy(raw, { model = 'eleven_multilingual_v2' } = {}) {
  const voice = normalizedVoice(raw);
  const category = lower(voice.category);
  const english = selectEnglishCastingProfile(voice, { model });
  return Boolean(
    voice.providerVoiceId &&
    english.ready &&
    english.coreAuditionEligible &&
    ['professional', 'high_quality'].includes(category) &&
    Number(voice.noticePeriodDays ?? 0) >= 180 &&
    !voice.hasCustomRate &&
    !voice.liveModerationEnabled
  );
}

function metadataSignature(voice) {
  const traitWords = ['warm', 'grounded', 'confident', 'playful', 'calm', 'polished', 'raspy', 'deep', 'conversational', 'narration', 'storytelling', 'expressive', 'upbeat', 'soothing', 'authoritative', 'charismatic', 'natural', 'emotional', 'smooth'];
  const text = metadataText(voice);
  const values = [voice.gender, voice.age, voice.accent, voice.useCase, ...(voice.descriptives ?? [])]
    .map(normalizedTrait).filter(Boolean);
  for (const word of traitWords) if (text.includes(word)) values.push(word);
  return new Set(values);
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const item of a) if (b.has(item)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

function buildDistinctiveness(shortlists) {
  const leaders = shortlists.map((row) => ({ character: row.character, candidate: row.candidates[0] })).filter((row) => row.candidate);
  const warnings = [];
  for (let i = 0; i < leaders.length; i += 1) {
    for (let j = i + 1; j < leaders.length; j += 1) {
      const a = leaders[i];
      const b = leaders[j];
      const similarity = jaccard(metadataSignature(a.candidate.voice), metadataSignature(b.candidate.voice));
      if (similarity >= 0.72) {
        warnings.push(freeze({
          characters: freeze([a.character, b.character]),
          similarity: Number(similarity.toFixed(2)),
          note: 'Top candidates still share a similar casting-metadata profile after distinctiveness-aware ranking. Human listening is required; this does not claim acoustic similarity.'
        }));
      }
    }
  }
  return freeze({
    exactVoiceReuseBlocked: true,
    metadataSimilarityChecked: true,
    acousticSimilarityValidated: false,
    status: warnings.length ? 'REVIEW' : 'PASS',
    warnings: freeze(warnings)
  });
}

function recommendationFor(candidate, rank, auditionTop) {
  if (!candidate.previewIntegrity?.ready || !candidate.previewIntegrity?.coreAuditionEligible) return 'PASS';
  if (candidate.fit.hardMismatch || candidate.fit.score < 72) return 'PASS';
  if (candidate.culturalFit?.requiredForAudition && !candidate.culturalFit.requirementMet) return 'ALTERNATE';
  if (candidate.biographyFit?.preferredAuditionRequirement && !candidate.biographyFit.requirementMet) return 'ALTERNATE';
  if (rank <= auditionTop && candidate.fit.score >= 84) return 'AUDITION';
  return 'ALTERNATE';
}

function singleNarratorCandidateScore(voice) {
  const previewIntegrity = voice.previewIntegrity ?? selectEnglishCastingProfile(voice);
  const safety = scoreSeriesSafety(voice, { desiredLanguage: 'en' });
  const fit = scoreSingleNarratorFit(voice);
  const culturalFit = scoreSingleNarratorCulturalFit(voice);
  const biographyFit = freeze({
    applicable: false,
    score: null,
    grade: 'not-applicable',
    requirementMet: true,
    preferredAuditionRequirement: false,
    matchedTerms: freeze([]),
    concerns: freeze([]),
    metadataScope: 'character-biographies-are-performance-direction-in-single-narrator-mode'
  });
  let combined = Number((safety.score * 0.25 + fit.score * 0.50 + culturalFit.score * 0.25).toFixed(1));
  combined = Number((combined * 0.9 + previewIntegrity.score * 0.1).toFixed(1));

  const strengths = [...safety.reasons];
  if (previewIntegrity.ready) strengths.push(`English preview selected (${previewIntegrity.locale ?? 'locale not listed'}${previewIntegrity.accent ? ` / ${previewIntegrity.accent}` : ''})`);
  if (fit.matchedKeywords?.length) strengths.push(`narrator-fit metadata: ${fit.matchedKeywords.join(', ')}`);
  if (fit.regionalMatches?.length) strengths.push(`Southern California / West Coast metadata: ${fit.regionalMatches.join(', ')}`);
  if (culturalFit.matchedSignals?.length) strengths.push(`explicit Latino cultural metadata: ${culturalFit.matchedSignals.join(', ')}`);

  const concerns = [
    ...safety.warnings,
    ...(fit.stretchFlags ?? []).map((row) => row.note),
    ...(culturalFit.flags ?? []).map((row) => row.note),
    ...(!previewIntegrity.coreAuditionEligible ? [`Catalog-primary language ${previewIntegrity.primaryLanguage ?? 'unknown'} is not eligible for the English-first narrator shortlist.`] : [])
  ];

  return freeze({
    voice, safety, fit, culturalFit, biographyFit, previewIntegrity, combined,
    strengths: freeze(strengths),
    concerns: freeze(concerns)
  });
}

function singleNarratorRecommendation(candidate, rank, auditionTop) {
  if (!candidate.previewIntegrity?.ready || !candidate.previewIntegrity?.coreAuditionEligible) return 'PASS';
  if (candidate.fit.hardMismatch || candidate.fit.score < 72) return 'PASS';
  if (candidate.culturalFit.requiredForAudition && !candidate.culturalFit.requirementMet) return 'ALTERNATE';
  if (rank <= auditionTop && candidate.fit.score >= 82) return 'AUDITION';
  return 'ALTERNATE';
}

function chooseSingleNarratorShortlist(waveOne, voices, { perRole = 6, auditionTop = 3 } = {}) {
  const target = waveOne.find((row) => row.role === 'narrator' || row.canonicalName === 'Narrator');
  if (!target) throw new Error('Single narrator casting requires a Narrator target in Wave 1');
  const ranked = voices
    .map((voice) => singleNarratorCandidateScore(voice))
    .sort((a, b) =>
      b.combined - a.combined ||
      b.fit.score - a.fit.score ||
      b.culturalFit.score - a.culturalFit.score ||
      b.safety.score - a.safety.score ||
      a.voice.name.localeCompare(b.voice.name)
    )
    .slice(0, perRole);

  return freeze([freeze({
    character: 'Narrator',
    role: 'narrator',
    intent: SINGLE_NARRATOR_PROFILE,
    candidates: freeze(ranked.map((row, index) => {
      const rank = index + 1;
      return freeze({
        ...row,
        rank,
        recommendation: singleNarratorRecommendation(row, rank, auditionTop)
      });
    }))
  })]);
}

function leaderAdjustedScore(candidate, leaders) {
  if (!leaders.length) return candidate.combined;
  const signature = metadataSignature(candidate.voice);
  let maxSimilarity = 0;
  for (const leader of leaders) maxSimilarity = Math.max(maxSimilarity, jaccard(signature, metadataSignature(leader.voice)));
  const penalty = maxSimilarity >= 0.75 ? maxSimilarity * 6 : 0;
  return candidate.combined - penalty;
}

function chooseUniqueShortlists(waveOne, voices, { perRole = 6, auditionTop = 3, characterBiographies = null } = {}) {
  const biographyByCharacter = new Map((characterBiographies?.profiles ?? []).map((row) => [row.character, row]));
  const ranked = new Map();
  for (const target of waveOne) {
    const biography = biographyByCharacter.get(target.canonicalName) ?? null;
    ranked.set(target.canonicalName, voices
      .map((voice) => candidateScore(voice, target, biography))
      .sort((a, b) => b.combined - a.combined || b.fit.score - a.fit.score || b.safety.score - a.safety.score || a.voice.name.localeCompare(b.voice.name)));
  }
  const used = new Set();
  const leaders = [];
  const chosen = new Map(waveOne.map((target) => [target.canonicalName, []]));
  const constraintPriority = (target) => {
    const biography = biographyByCharacter.get(target.canonicalName) ?? null;
    let priority = 0;
    if (roleIntent(target).cultural?.requiredForAudition) priority += 5;
    if (biography?.castingProfile?.regionalFlavor?.requiredForPreferredAudition) priority += 3;
    if ((biography?.castingProfile?.preferredAges ?? []).length) priority += 1;
    return priority;
  };
  const allocationOrder = [...waveOne].sort((a, b) =>
    constraintPriority(b) - constraintPriority(a)
  );
  for (let slot = 0; slot < perRole; slot += 1) {
    for (const target of allocationOrder) {
      const rows = ranked.get(target.canonicalName).filter((row) => !used.has(`${row.voice.provider}:${row.voice.providerVoiceId}`));
      if (!rows.length) continue;
      let next;
      if (slot === 0) {
        next = [...rows].sort((a, b) =>
          leaderAdjustedScore(b, leaders) - leaderAdjustedScore(a, leaders) ||
          b.fit.score - a.fit.score ||
          b.combined - a.combined
        )[0];
        leaders.push(next);
      } else {
        next = rows[0];
      }
      used.add(`${next.voice.provider}:${next.voice.providerVoiceId}`);
      chosen.get(target.canonicalName).push(next);
    }
  }
  return waveOne.map((target) => freeze({
    character: target.canonicalName,
    role: target.role,
    intent: roleIntent(target),
    candidates: freeze(chosen.get(target.canonicalName).map((row, index) => {
      const rank = index + 1;
      return freeze({
        ...row,
        rank,
        recommendation: recommendationFor(row, rank, auditionTop)
      });
    }))
  }));
}

function analysisRows(ingestResult) {
  const rows = [];
  let flat = 0;
  for (const chapter of ingestResult.analysis.chapters ?? []) {
    for (const scene of chapter.scenes ?? []) {
      for (const segment of scene.segments ?? []) {
        const record = ingestResult.segments?.[flat] ?? null;
        rows.push({ chapter, scene, segment, record });
        flat += 1;
      }
    }
  }
  return rows;
}

function clipText(value, max = 320) {
  const text = clean(value).replace(/\s+/g, ' ');
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

function pickSpread(rows, count = 3) {
  if (!rows.length) return [];
  const out = [];
  const indexes = count === 1 ? [0] : Array.from({ length: count }, (_, i) => Math.round((rows.length - 1) * (i / (count - 1))));
  for (const index of indexes) {
    const row = rows[index];
    if (row && !out.includes(row)) out.push(row);
  }
  for (const row of rows) {
    if (out.length >= count) break;
    if (!out.includes(row)) out.push(row);
  }
  return out.slice(0, count);
}

function dialogueScore(text, mode) {
  const t = clean(text);
  const emotional = (t.match(/\b(love|sorry|miss|need|want|afraid|hurt|fuck|shit|damn|please|god|hell)\b/gi) ?? []).length;
  const punctuation = (t.match(/[!?]/g) ?? []).length;
  if (mode === 'emotional') return emotional * 8 + punctuation * 3 + Math.min(10, t.length / 30);
  if (mode === 'energy') return punctuation * 7 + emotional * 3 + Math.min(8, t.length / 35);
  return 40 - Math.abs(110 - t.length) / 5 - punctuation * 2;
}

function pickCharacterScripts(rows) {
  const usable = rows.filter((row) => {
    const len = clean(row.text).length;
    return len >= 18 && len <= 320;
  });
  const used = new Set();
  const modes = [
    ['neutral', 'Conversational / neutral'],
    ['emotional', 'Emotional range'],
    ['energy', 'High-energy / dynamic']
  ];
  const result = [];
  for (const [mode, label] of modes) {
    const candidate = [...usable]
      .filter((row) => !used.has(row.segmentId))
      .sort((a, b) => dialogueScore(b.text, mode) - dialogueScore(a.text, mode))[0];
    if (!candidate) continue;
    used.add(candidate.segmentId);
    result.push(freeze({
      id: mode,
      label,
      text: clipText(candidate.text),
      chapterOrder: candidate.chapterOrder,
      chapterTitle: candidate.chapterTitle,
      segmentId: candidate.segmentId,
      purpose: mode,
      source: 'canonical-manuscript-dialogue'
    }));
  }
  return result;
}

function isPrintOnlyNarrationRow(row) {
  const title = lower(row.chapter?.title);
  const order = Number(row.chapter?.order);
  const text = lower(row.segment?.text);
  if (Number.isFinite(order) && order <= 0) return true;
  if (/front matter|copyright|title page|table of contents|contents|dedication|acknowledg|about the author|author.?s note|afterword|epilogue note|reader note/.test(title)) return true;
  if (/copyright|all rights reserved|no part of this book|isbn|library of congress|published by|publisher|edition|cover design|www\.|https?:\/\//.test(text)) return true;
  if (/thank you for (?:reading|listening|being a part)|this isn.?t just our story|dear reader|author.?s note|please (?:review|rate|follow)|follow (?:me|us)|newsletter|join (?:my|our) mailing list|the end\b/.test(text)) return true;
  return false;
}

function pickNarratorScripts(rows) {
  const narration = rows
    .filter((row) => row.segment.kind !== 'dialogue')
    .filter((row) => !isPrintOnlyNarrationRow(row))
    .filter((row) => clean(row.segment.text).length >= 90 && clean(row.segment.text).length <= 420)
    .sort((a, b) => Number(a.chapter?.order ?? 0) - Number(b.chapter?.order ?? 0));
  return pickSpread(narration, 3).map((row, index) => freeze({
    id: `narration-${index + 1}`,
    label: ['Narrative opening tone', 'Narrative middle range', 'Narrative later-book range'][index] ?? `Narration ${index + 1}`,
    text: clipText(row.segment.text),
    chapterOrder: row.chapter.order ?? null,
    chapterTitle: row.chapter.title ?? null,
    segmentId: row.record?.id ?? null,
    purpose: ['neutral', 'emotional', 'range'][index] ?? 'range',
    source: 'canonical-manuscript-narration'
  }));
}

export function buildAuditionSamplePackFromPrepRun(prepRun, launch) {
  if (!prepRun?.prep || !prepRun?.ingestResult) throw new Error('audition sample extraction requires a fresh Book One Audio Bible Prep run');
  if (prepRun.prep.book?.sourceHash !== launch.book?.sourceHash) throw new Error('audition sample manuscript source hash does not match Casting Launch');
  if (prepRun.prep.status !== 'AUDIO_BIBLE_LOCKED') throw new Error('audition sample extraction requires a locked fresh prep run');
  const rows = analysisRows(prepRun.ingestResult);
  const byId = new Map(rows.filter((row) => row.record?.id).map((row) => [row.record.id, row]));
  const bindingRows = new Map();
  for (const binding of prepRun.prep.dialogueReview?.autoBindings ?? []) {
    if (!binding.segmentId || binding.classification !== 'spoken-dialogue' || Number(binding.confidence ?? 0) < 0.9) continue;
    const row = byId.get(binding.segmentId);
    if (!row) continue;
    const list = bindingRows.get(binding.speaker) ?? [];
    list.push({
      segmentId: binding.segmentId,
      text: row.segment.text,
      chapterOrder: row.chapter.order ?? null,
      chapterTitle: row.chapter.title ?? null,
      confidence: binding.confidence,
      evidence: binding.evidence
    });
    bindingRows.set(binding.speaker, list);
  }

  const waveOne = launch.waves?.find((row) => row.wave === 1)?.targets ?? [];
  const samples = [];
  for (const target of waveOne) {
    let scripts;
    if (target.role === 'narrator') {
      scripts = pickNarratorScripts(rows);
    } else {
      scripts = pickCharacterScripts(bindingRows.get(target.canonicalName) ?? []);
    }
    samples.push(freeze({ character: target.canonicalName, role: target.role, scripts: freeze(scripts) }));
  }
  const missing = samples.filter((row) => row.scripts.length < 3).map((row) => row.character);
  return freeze({
    sourceHash: prepRun.prep.book.sourceHash,
    sourceValidated: true,
    status: missing.length ? 'PARTIAL' : 'READY',
    manuscriptDerived: true,
    sensitiveLocalArtifact: true,
    doNotCommit: true,
    missingCharacters: freeze(missing),
    samples: freeze(samples)
  });
}

async function buildCostPreview(shortlists, samplePack, estimator, { model, auditionTop }) {
  if (!samplePack || !Array.isArray(samplePack.samples) || typeof estimator !== 'function') {
    return freeze({ status: 'NEEDS_SOURCE_SAMPLES', model, recommendedAuditionUsd: null, fullShortlistUsd: null, roles: freeze([]) });
  }
  const sampleByCharacter = new Map(samplePack.samples.map((row) => [row.character, row]));
  let recommendedTotal = 0;
  let fullTotal = 0;
  const roles = [];
  for (const shortlist of shortlists) {
    const scripts = sampleByCharacter.get(shortlist.character)?.scripts ?? [];
    let perCandidate = 0;
    const lines = [];
    for (const script of scripts) {
      const estimate = await estimator({ text: script.text, model });
      if (estimate?.amountUsd === null || estimate?.amountUsd === undefined || !Number.isFinite(Number(estimate.amountUsd))) {
        return freeze({ status: 'UNKNOWN_COST', model, recommendedAuditionUsd: null, fullShortlistUsd: null, roles: freeze(roles) });
      }
      perCandidate += Number(estimate.amountUsd);
      lines.push(freeze({ scriptId: script.id, characters: estimate.characters ?? script.text.length, amountUsd: Number(estimate.amountUsd) }));
    }
    const recommendedCount = shortlist.candidates.filter((candidate) => candidate.recommendation === 'AUDITION').length;
    const recommendedUsd = Number((perCandidate * recommendedCount).toFixed(6));
    const fullUsd = Number((perCandidate * shortlist.candidates.length).toFixed(6));
    recommendedTotal += recommendedUsd;
    fullTotal += fullUsd;
    roles.push(freeze({ character: shortlist.character, scripts: freeze(lines), perCandidateUsd: Number(perCandidate.toFixed(6)), recommendedCandidateCount: recommendedCount, recommendedUsd, fullShortlistUsd: fullUsd }));
  }
  return freeze({
    status: samplePack.status === 'READY' ? 'ESTIMATED' : 'PARTIAL_SAMPLES',
    model,
    recommendedAuditionUsd: Number(recommendedTotal.toFixed(6)),
    fullShortlistUsd: Number(fullTotal.toFixed(6)),
    roles: freeze(roles)
  });
}

function compactShortlists(shortlists, prep, launch) {
  const charByName = new Map((prep.snapshot.characters ?? []).map((row) => [row.canonicalName, row]));
  return shortlists.map((row) => freeze({
    character: row.character,
    role: row.role,
    intent: row.intent,
    candidates: freeze(row.candidates.map((candidate) => {
      const character = charByName.get(row.character);
      const id = `vc_${sha256(`${launch.artifactFingerprint}|${character?.id}|${candidate.voice.provider}|${candidate.voice.providerVoiceId}`).slice(0, 24)}`;
      return freeze({
        id,
        characterId: character?.id ?? null,
        rank: candidate.rank,
        recommendation: candidate.recommendation,
        candidateStatus: 'staged-zero-spend',
        auditionStatus: 'not-armed',
        voice: compactVoice(candidate.voice),
        seriesSafety: candidate.safety,
        roleFit: candidate.fit,
        culturalFit: candidate.culturalFit,
        biographyFit: candidate.biographyFit,
        previewIntegrity: candidate.previewIntegrity,
        combinedScore: candidate.combined,
        strengths: candidate.strengths,
        concerns: candidate.concerns
      });
    }))
  }));
}

export function renderCastingDiscoveryMarkdown(discovery) {
  const lines = [
    '# Book One Casting Candidate Discovery', '',
    `**YasReady Audiobooks:** ${discovery.provenance.applicationRelease}`,
    `**Book:** ${discovery.book.title}`,
    `**Status:** ${discovery.status}`,
    `**Casting mode:** ${discovery.castingMode ?? 'multicast'}`,
    `**Voice catalog:** ${discovery.catalog.provider} (${discovery.catalog.uniqueVoices} unique voice(s))`, '',
    '## Spend state', '',
    `- Catalog metadata calls: ${discovery.catalog.catalogCallsPerformed}`,
    `- Catalog query mode: ${discovery.catalog.queryMode ?? 'unknown'}`,
    `- Anonymous fallback used: ${discovery.catalog.anonymousFallbackUsed ? 'YES — safety filters enforced locally' : 'NO'}`,
    `- Anonymous page-size cap: ${discovery.catalog.anonymousPageSizeCap ?? 'none detected'}`,
    `- API key recommended for broader discovery: ${discovery.catalog.authRecommended ? 'YES' : 'NO'}`,
    '- Paid provider calls: 0',
    '- TTS generation calls: 0',
    '- Paid audition generation armed: NO',
    '- Production generation armed: NO', '',
    '## Wave 1 shortlists', ''
  ];
  for (const row of discovery.shortlists) {
    lines.push(`### ${row.character}`, '', `Casting intent: ${row.intent.label}`, '');
    if (!row.candidates.length) {
      lines.push('- No safe unique candidates staged. Increase catalog pages or relax discovery filters.', '');
      continue;
    }
    for (const candidate of row.candidates) {
      const v = candidate.voice;
      lines.push(
        `${candidate.rank}. **${v.name}** — ${candidate.combinedScore}/100 — ${candidate.recommendation}`,
        `   - Series safety: ${candidate.seriesSafety.score}/100 (${candidate.seriesSafety.grade})`,
        `   - Role fit: ${candidate.roleFit.score}/100 (${candidate.roleFit.grade ?? 'ungraded'})`,
        ...(candidate.culturalFit?.applicable ? [`   - Cultural fit: ${candidate.culturalFit.score}/100 (${candidate.culturalFit.requirementMet ? 'metadata signal satisfied' : 'explicit signal missing'})`] : []),
        ...(candidate.biographyFit?.applicable ? [`   - Full-book biography fit: ${candidate.biographyFit.score}/100 (${candidate.biographyFit.requirementMet ? 'preferred evidence target met' : 'preferred evidence target missing'})`] : []),
        `   - Selected English preview: ${v.previewLanguage ?? 'not listed'} / ${v.previewLocale ?? 'not listed'} / ${v.previewAccent ?? 'not listed'}`,
        `   - Catalog-primary language: ${v.catalogPrimaryLanguage ?? 'not listed'}`,
        `   - Accent / age / gender: ${v.accent ?? 'not listed'} / ${v.age ?? 'not listed'} / ${v.gender ?? 'not listed'}`,
        `   - Notice protection: ${v.noticePeriodDays} day(s)`,
        `   - Use case: ${v.useCase ?? 'not listed'}`,
        `   - Strengths: ${candidate.strengths.slice(0, 3).join('; ') || 'catalog metadata is limited'}`,
        `   - Concerns: ${candidate.concerns.slice(0, 2).join('; ') || 'none from catalog safety metadata'}`,
        `   - Preview: ${v.previewUrl ?? 'no preview URL supplied by catalog'}`,
        ''
      );
    }
  }
  lines.push('## Audition scripts', '');
  if (!discovery.auditionSamples) {
    lines.push('- No manuscript was supplied to this discovery run. Candidate ranking is usable, but auditions are not ready until canonical Book One samples are extracted.', '');
  } else {
    for (const row of discovery.auditionSamples.samples) {
      lines.push(`### ${row.character}`, '');
      for (const script of row.scripts) lines.push(`- **${script.label}:** ${script.text}`);
      lines.push('');
    }
    lines.push('> These excerpts are manuscript-derived local production material. Keep this folder out of GitHub.', '');
  }
  lines.push(
    '## Audition cost preview', '',
    `- Status: ${discovery.auditionCost.status}`,
    `- Recommended top-candidate audition plan: ${discovery.auditionCost.recommendedAuditionUsd === null ? 'not available yet' : `$${discovery.auditionCost.recommendedAuditionUsd.toFixed(2)}`}`,
    `- Full shortlist audition plan: ${discovery.auditionCost.fullShortlistUsd === null ? 'not available yet' : `$${discovery.auditionCost.fullShortlistUsd.toFixed(2)}`}`,
    '- This is an estimate only. No audition has been rendered or paid for.', '',
    '## Distinctiveness', '',
    `- Exact voice reuse across Wave 1 shortlists: ${discovery.distinctiveness.exactVoiceReuseBlocked ? 'BLOCKED' : 'not checked'}`,
    `- Metadata similarity gate: ${discovery.distinctiveness.status}`,
    '- Acoustic similarity: NOT VALIDATED until humans listen to auditions.', ''
  );
  for (const warning of discovery.distinctiveness.warnings) {
    lines.push(`- Review ${warning.characters.join(' vs ')} — metadata similarity ${warning.similarity}`);
  }
  lines.push('', '## Next action', '', discovery.nextAction, '', '> `ARM AUDITIONS` remains a separate future operator action. This discovery build cannot render paid audio.', '');
  return lines.join('\n');
}

function browserSafeJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

export function renderCastingReviewBoardHtml(discovery) {
  const boardData = {
    release: discovery.release,
    artifactFingerprint: discovery.artifactFingerprint,
    book: discovery.book,
    shortlists: discovery.shortlists,
    auditionSamples: discovery.auditionSamples,
    characterBiographies: discovery.characterBiographies,
    castingMode: discovery.castingMode,
    performanceGuide: discovery.performanceGuide,
    auditionCost: discovery.auditionCost,
    guardrails: discovery.guardrails
  };
  const data = browserSafeJson(boardData);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>YasReady Casting Review Board — ${String(discovery.book.title).replace(/[<>&"]/g, '')}</title>
<style>
:root{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","Segoe UI",sans-serif;color-scheme:light dark;--bg:#f5f5f7;--card:rgba(255,255,255,.88);--text:#1d1d1f;--muted:#6e6e73;--line:rgba(0,0,0,.09);--accent:#0071e3;--good:#248a3d;--maybe:#b25000;--bad:#d70015}
@media(prefers-color-scheme:dark){:root{--bg:#000;--card:rgba(28,28,30,.92);--text:#f5f5f7;--muted:#a1a1a6;--line:rgba(255,255,255,.12);--accent:#2997ff;--good:#30d158;--maybe:#ff9f0a;--bad:#ff453a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text)}main{max-width:1180px;margin:auto;padding:34px 22px 90px}
.hero{padding:8px 0 26px}.eyebrow{font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--accent)}h1{font-size:clamp(32px,5vw,56px);line-height:.98;margin:10px 0 14px;letter-spacing:-.045em}.sub{font-size:18px;color:var(--muted);max-width:820px;line-height:1.45}
.guard{display:flex;gap:10px;flex-wrap:wrap;margin:18px 0}.pill{padding:8px 11px;border:1px solid var(--line);border-radius:999px;font-size:13px;background:var(--card)}.pill.safe{color:var(--good);font-weight:700}.decisionLegend{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}.decisionLegend span{font-size:12px;font-weight:700;padding:6px 9px;border:1px solid var(--line);border-radius:999px;color:var(--muted)}
.toolbar{position:sticky;top:0;z-index:5;background:color-mix(in srgb,var(--bg) 88%,transparent);backdrop-filter:blur(20px);padding:12px 0;border-bottom:1px solid var(--line);display:flex;gap:10px;align-items:center;flex-wrap:wrap}
button{font:inherit;border:0;border-radius:999px;padding:10px 14px;cursor:pointer}.primary{background:var(--accent);color:white;font-weight:700}.ghost{background:var(--card);color:var(--text);border:1px solid var(--line)}
.summary{margin-left:auto;color:var(--muted);font-size:14px}.role{margin-top:42px}.role h2{font-size:30px;letter-spacing:-.03em;margin-bottom:5px}.intent{color:var(--muted);margin-bottom:7px}.context{color:var(--muted);font-size:13px;line-height:1.45;max-width:860px;margin-bottom:18px;padding:10px 12px;border-left:3px solid var(--accent);background:var(--card);border-radius:0 12px 12px 0}
.bio{padding:15px 16px;background:var(--card);border:1px solid var(--line);border-radius:18px;margin:12px 0 18px}.bio b{display:block;font-size:13px;margin-bottom:5px}.bio p{font-size:13px;color:var(--muted);line-height:1.45;margin:4px 0}.bio .evidence{font-size:12px}.scripts{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:14px 0 20px}.script{padding:14px;background:var(--card);border:1px solid var(--line);border-radius:18px}.script b{display:block;font-size:13px;margin-bottom:6px}.script p{font-size:13px;color:var(--muted);margin:0;line-height:1.4}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.card{background:var(--card);border:1px solid var(--line);border-radius:24px;padding:18px;box-shadow:0 8px 30px rgba(0,0,0,.04)}.topline{display:flex;gap:10px;justify-content:space-between;align-items:flex-start}.rank{font-size:12px;color:var(--muted);font-weight:700}.name{font-size:21px;font-weight:750;letter-spacing:-.02em;margin:3px 0}.rec{font-size:12px;font-weight:800;padding:6px 9px;border-radius:999px;background:var(--bg)}
.meta{display:flex;gap:7px;flex-wrap:wrap;margin:10px 0}.meta span{font-size:12px;padding:5px 8px;border-radius:999px;border:1px solid var(--line);color:var(--muted)}audio{width:100%;margin:9px 0 12px}.scores{display:grid;grid-template-columns:repeat(auto-fit,minmax(90px,1fr));gap:8px}.score{padding:9px;border-radius:14px;background:var(--bg);font-size:12px}.score strong{display:block;font-size:18px}
.concerns{font-size:12px;color:var(--maybe);margin:9px 0;line-height:1.4}.decisions{display:flex;gap:7px;margin-top:12px}.decision{flex:1;background:var(--bg);color:var(--text);border:1px solid var(--line);font-weight:700}.decision.active.keep{background:var(--good);color:#fff}.decision.active.maybe{background:var(--maybe);color:#fff}.decision.active.pass{background:var(--bad);color:#fff}
textarea{width:100%;margin-top:9px;border:1px solid var(--line);border-radius:13px;padding:10px;background:var(--bg);color:var(--text);font:inherit;resize:vertical;min-height:58px}.footerNote{margin-top:40px;color:var(--muted);font-size:13px;line-height:1.5}
@media(max-width:760px){.grid,.scripts{grid-template-columns:1fr}.summary{width:100%;margin-left:0}}
</style>
</head>
<body><main>
<section class="hero"><div class="eyebrow">YasReady Audiobooks ${discovery.release}</div><h1>Casting Review Board</h1><div class="sub"></div>
<div class="guard"><span class="pill safe">Paid audition generation remains unarmed</span><span class="pill">TTS calls: 0</span><span class="pill">${discovery.castingMode === 'single-narrator' ? 'Book One • Single Narrator' : 'Book One • Wave 1'}</span></div>
<div class="decisionLegend" aria-label="Decision options"><span>Keep</span><span>Maybe</span><span>Pass</span></div></section>
<div class="toolbar"><button class="primary" id="export">Export Audition Choices</button><button class="ghost" id="clear">Clear Local Decisions</button><div class="summary" id="summary"></div></div>
<div id="roles"></div>
<div class="footerNote">Preview audio streams from the provider URLs already present in this local discovery artifact. Decisions autosave only in this browser. Export the JSON before moving computers or clearing browser storage. This page contains no ElevenLabs API key and cannot generate paid audio.</div>
</main>
<script>
const DISCOVERY=${data};
const storageKey='yasready-casting-review:'+DISCOVERY.artifactFingerprint;
let decisions={};
try{decisions=JSON.parse(localStorage.getItem(storageKey)||'{}')}catch{}
const roleRoot=document.getElementById('roles');
document.querySelector('.sub').textContent=DISCOVERY.castingMode==='single-narrator'
  ? DISCOVERY.book.title+' — choose ONE narrator who can carry the prose and perform Juan, Michael and Christopher. Listen first; metadata is guidance, not a substitute for your ears.'
  : DISCOVERY.book.title+' — listen first, then mark Keep, Maybe, or Pass. YasReady recommendations are metadata guidance, not a substitute for your ears.';
const samples=new Map((DISCOVERY.auditionSamples?.samples||[]).map(x=>[x.character,x]));
const biographies=new Map((DISCOVERY.characterBiographies?.profiles||[]).map(x=>[x.character,x]));
if(DISCOVERY.castingMode==='single-narrator'&&DISCOVERY.performanceGuide){
 const box=el('section','role');box.append(el('h2','','One narrator. Three character performances.'));
 const guide=el('div','bio');guide.append(el('b','','Single Narrator Performance Guide'));
 guide.append(el('p','',DISCOVERY.performanceGuide.narratorTarget?.delivery||''));
 for(const c of DISCOVERY.performanceGuide.characters||[])guide.append(el('p','',c.character+': '+c.performanceDirection));
 box.append(guide);roleRoot.append(box);
}
function save(){localStorage.setItem(storageKey,JSON.stringify(decisions));updateSummary()}
function updateSummary(){
 const values=Object.values(decisions).map(x=>x.decision).filter(Boolean);
 const count=(v)=>values.filter(x=>x===v).length;
 document.getElementById('summary').textContent='Keep '+count('keep')+' • Maybe '+count('maybe')+' • Pass '+count('pass')+' • Undecided '+Math.max(0,DISCOVERY.shortlists.reduce((n,r)=>n+r.candidates.length,0)-values.length);
}
function el(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n}
for(const role of DISCOVERY.shortlists){
 const section=el('section','role'); section.append(el('h2','',role.character)); section.append(el('div','intent',role.intent.label));
 if(role.intent.characterContext)section.append(el('div','context',role.intent.characterContext));
 const bio=biographies.get(role.character);
 if(bio&&bio.status!=='NOT_APPLICABLE'){
   const box=el('div','bio');box.append(el('b','','Full-book casting biography'));
   box.append(el('p','',bio.castingProfile?.summary||'No strong manuscript-supported casting cues found.'));
   if(bio.castingProfile?.regionalFlavor)box.append(el('p','', 'Voice target: '+bio.castingProfile.regionalFlavor.label));
   const ev=(bio.evidence||[]).slice(0,5).map(x=>x.label+' ('+x.confidenceLabel+')').join(' • ');
   if(ev)box.append(el('p','evidence','Evidence: '+ev));
   section.append(box);
 }
 const scriptRow=el('div','scripts');
 for(const script of samples.get(role.character)?.scripts||[]){
   const box=el('div','script'); box.append(el('b','',script.label)); box.append(el('p','',script.text)); scriptRow.append(box);
 }
 if(scriptRow.children.length)section.append(scriptRow);
 const grid=el('div','grid');
 for(const c of role.candidates){
   const card=el('article','card'); card.dataset.id=c.id;
   const top=el('div','topline'); const left=el('div');
   left.append(el('div','rank','#'+c.rank+' • '+c.recommendation)); left.append(el('div','name',c.voice.name));
   top.append(left); top.append(el('div','rec',c.recommendation)); card.append(top);
   const meta=el('div','meta');
   for(const v of [('Preview: '+(c.voice.previewLanguage||'unknown')),c.voice.previewAccent,c.voice.age,c.voice.gender,c.voice.useCase].filter(Boolean))meta.append(el('span','',v));
   card.append(meta);
   if(c.voice.catalogPrimaryLanguage&&c.voice.catalogPrimaryLanguage!=='en')card.append(el('div','concerns','Catalog-primary language: '+c.voice.catalogPrimaryLanguage+' — this voice should not be in the English-first core shortlist.'));
   if(c.voice.previewUrl){const audio=document.createElement('audio');audio.controls=true;audio.preload='none';audio.src=c.voice.previewUrl;card.append(audio)}
   const scores=el('div','scores');
   const scoreRows=[['Overall',c.combinedScore],['Role fit',c.roleFit.score],['Safety',c.seriesSafety.score]];
   let insertAt=2;
   if(c.culturalFit?.applicable){scoreRows.splice(insertAt,0,['Cultural fit',c.culturalFit.score]);insertAt+=1}
   if(c.biographyFit?.applicable)scoreRows.splice(insertAt,0,['Book fit',c.biographyFit.score]);
   for(const [label,value] of scoreRows){const s=el('div','score');s.append(el('strong','',value));s.append(document.createTextNode(label));scores.append(s)}
   card.append(scores);
   if(c.culturalFit?.applicable){const policy=el('div','concerns','Cultural fit uses explicit provider catalog metadata only — never the voice sound or name. '+(c.culturalFit.requirementMet?'Relevant signal found.':'Required signal not found.'));card.append(policy)}
   if(c.biographyFit?.applicable&&c.biographyFit.preferredAuditionRequirement){const policy=el('div','concerns','Full-book voice target: '+(c.biographyFit.requirementMet?'preferred regional/background metadata found.':'preferred regional/background metadata not found; shown as an alternate rather than auto-audition.'));card.append(policy)}
   if(c.concerns?.length)card.append(el('div','concerns',c.concerns.slice(0,3).join(' • ')));
   const buttons=el('div','decisions');
   for(const choice of ['keep','maybe','pass']){const b=el('button','decision '+choice,choice[0].toUpperCase()+choice.slice(1));b.onclick=()=>{decisions[c.id]={...(decisions[c.id]||{}),candidateId:c.id,character:role.character,voiceId:c.voice.providerVoiceId,voiceName:c.voice.name,decision:choice};save();paint(card,c.id)};buttons.append(b)}
   card.append(buttons);
   const notes=document.createElement('textarea');notes.placeholder='Optional notes…';notes.value=decisions[c.id]?.notes||'';notes.oninput=()=>{decisions[c.id]={...(decisions[c.id]||{}),candidateId:c.id,character:role.character,voiceId:c.voice.providerVoiceId,voiceName:c.voice.name,notes:notes.value};save()};card.append(notes);
   grid.append(card); paint(card,c.id);
 }
 section.append(grid); roleRoot.append(section);
}
function paint(card,id){const d=decisions[id]?.decision;for(const b of card.querySelectorAll('.decision'))b.classList.toggle('active',b.classList.contains(d))}
document.getElementById('clear').onclick=()=>{if(confirm('Clear every local Keep / Maybe / Pass decision?')){decisions={};save();for(const card of document.querySelectorAll('.card'))paint(card,card.dataset.id);for(const t of document.querySelectorAll('textarea'))t.value=''}};
document.getElementById('export').onclick=()=>{
 const rows=DISCOVERY.shortlists.flatMap(role=>role.candidates.map(c=>({role,c}))).map(({role,c})=>({...decisions[c.id],candidateId:c.id,character:role.character,voiceId:c.voice.providerVoiceId,voiceName:c.voice.name,yasReadyRecommendation:c.recommendation,roleFit:c.roleFit.score,culturalFit:c.culturalFit?.applicable?c.culturalFit.score:null,culturalRequirementMet:c.culturalFit?.requirementMet??true,biographyFit:c.biographyFit?.applicable?c.biographyFit.score:null,biographyRequirementMet:c.biographyFit?.requirementMet??true,seriesSafety:c.seriesSafety.score})).filter(x=>x.decision||x.notes);
 const auditionCandidateIds=rows.filter(x=>x.decision==='keep'||x.decision==='maybe').map(x=>x.candidateId);
 const payload={schemaVersion:1,release:DISCOVERY.release,artifactFingerprint:DISCOVERY.artifactFingerprint,book:DISCOVERY.book,exportedAt:new Date().toISOString(),decisions:rows,auditionCandidateIds,armed:false,moneyGuardApprovalRequiredBeforeRendering:true};
 const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='casting-review-decisions.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
};
updateSummary();
</script></body></html>`;
}

export function renderCastingDiscoveryCsv(discovery) {
  const header = ['character', 'rank', 'recommendation', 'candidate_id', 'character_id', 'provider', 'voice_name', 'voice_id', 'combined_score', 'series_safety_score', 'series_safety_grade', 'role_fit_score', 'cultural_fit_score', 'cultural_requirement_met', 'biography_fit_score', 'biography_requirement_met', 'preview_language', 'preview_locale', 'preview_accent', 'catalog_primary_language', 'accent', 'age', 'gender', 'use_case', 'notice_days', 'preview_url', 'candidate_status', 'audition_status', 'operator_decision', 'notes'];
  const lines = [header.map(csvCell).join(',')];
  for (const row of discovery.shortlists) for (const candidate of row.candidates) {
    const v = candidate.voice;
    lines.push([
      row.character, candidate.rank, candidate.recommendation, candidate.id, candidate.characterId,
      v.provider, v.name, v.providerVoiceId, candidate.combinedScore, candidate.seriesSafety.score,
      candidate.seriesSafety.grade, candidate.roleFit.score, candidate.culturalFit?.applicable ? candidate.culturalFit.score : '', candidate.culturalFit?.requirementMet ?? true, candidate.biographyFit?.applicable ? candidate.biographyFit.score : '', candidate.biographyFit?.requirementMet ?? true, v.previewLanguage, v.previewLocale, v.previewAccent, v.catalogPrimaryLanguage, v.accent, v.age, v.gender, v.useCase,
      v.noticePeriodDays, v.previewUrl, candidate.candidateStatus, candidate.auditionStatus, '', ''
    ].map(csvCell).join(','));
  }
  return `${lines.join('\n')}\n`;
}

export function renderAuditionScriptsCsv(discovery) {
  const header = ['character', 'script_id', 'label', 'purpose', 'chapter_order', 'chapter_title', 'source', 'text'];
  const lines = [header.map(csvCell).join(',')];
  for (const row of discovery.auditionSamples?.samples ?? []) for (const script of row.scripts) {
    lines.push([row.character, script.id, script.label, script.purpose, script.chapterOrder, script.chapterTitle, script.source, script.text].map(csvCell).join(','));
  }
  return `${lines.join('\n')}\n`;
}

export class BookOneCastingDiscoveryService {
  async build({ launch, prep, voices, auditionSamples = null, costEstimator = null, perRole = 6, auditionTop = 3, model = 'eleven_multilingual_v2', catalogCallsPerformed = 0, catalogProvider = 'provided-pool', catalogQueryMode = 'provided-pool', providerFiltersApplied = null, anonymousFallbackUsed = false, anonymousPageSizeCap = null, catalogAuthRecommended = false, rawCatalogVoices = null, supplementalSearchesPerformed = [], characterBiographies = null, castingMode = 'multicast' } = {}) {
    const { waveOne } = assertArtifacts(launch, prep);
    const singleNarratorMode = castingMode === 'single-narrator';
    const castingTargets = singleNarratorMode
      ? waveOne.filter((row) => row.role === 'narrator' || row.canonicalName === 'Narrator').slice(0, 1)
      : waveOne;
    if (singleNarratorMode && castingTargets.length !== 1) throw new Error('Single narrator casting requires exactly one Narrator target');
    const effectiveAuditionSamples = singleNarratorMode ? buildSingleNarratorAuditionSamplePack(auditionSamples) : auditionSamples;
    const performanceGuide = singleNarratorMode ? buildSingleNarratorPerformanceGuide(characterBiographies) : null;
    const perRoleCount = clamp(Math.trunc(Number(perRole) || 6), 1, 8);
    const auditionCount = clamp(Math.trunc(Number(auditionTop) || 3), 1, perRoleCount);
    const uniquePool = [];
    const seen = new Set();
    for (const raw of voices ?? []) {
      if (!meetsBookOneDiscoveryPolicy(raw, { model })) continue;
      const voice = projectEnglishCastingVoice(raw, { model });
      if (!voice || !clean(voice.providerVoiceId)) continue;
      const key = `${voice.provider}:${voice.providerVoiceId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      uniquePool.push(voice);
    }
    const rawShortlists = singleNarratorMode
      ? chooseSingleNarratorShortlist(castingTargets, uniquePool, { perRole: perRoleCount, auditionTop: auditionCount })
      : chooseUniqueShortlists(castingTargets, uniquePool, { perRole: perRoleCount, auditionTop: auditionCount, characterBiographies });
    const shortlists = freeze(compactShortlists(rawShortlists, prep, launch));
    const totalNeeded = castingTargets.length * perRoleCount;
    const totalStaged = shortlists.reduce((sum, row) => sum + row.candidates.length, 0);
    const distinctiveness = buildDistinctiveness(shortlists);
    const auditionCost = await buildCostPreview(shortlists, effectiveAuditionSamples, costEstimator, { model, auditionTop: auditionCount });
    const sourceReady = effectiveAuditionSamples?.status === 'READY';
    const rolesWithoutAudition = shortlists.filter((row) => !row.candidates.some((candidate) => candidate.recommendation === 'AUDITION')).map((row) => row.character);
    const status = totalStaged < totalNeeded
      ? 'NEEDS_MORE_CANDIDATES'
      : sourceReady && rolesWithoutAudition.length
        ? 'NEEDS_BETTER_ROLE_FIT'
        : sourceReady
          ? 'READY_FOR_OPERATOR_REVIEW'
          : 'CANDIDATES_READY_SAMPLES_PENDING';
    const artifactFingerprint = sha256(JSON.stringify({
      launch: launch.artifactFingerprint,
      prepDigest: prep.audioBible.digest,
      voices: shortlists.flatMap((row) => row.candidates.map((candidate) => [row.character, candidate.voice.provider, candidate.voice.providerVoiceId])),
      sampleHash: effectiveAuditionSamples ? sha256(JSON.stringify(effectiveAuditionSamples.samples)) : null,
      biographyHash: characterBiographies ? sha256(JSON.stringify(characterBiographies.profiles)) : null,
      castingMode,
      performanceGuideHash: performanceGuide ? sha256(JSON.stringify(performanceGuide)) : null,
      model
    }));
    const discovery = freeze({
      schemaVersion: 1,
      release: YASREADY_AUDIOBOOKS_VERSION,
      status,
      castingMode,
      performanceGuide,
      provenance: freeze({
        application: 'YasReady Audiobooks',
        applicationRelease: YASREADY_AUDIOBOOKS_VERSION,
        artifact: 'book-one-casting-candidate-discovery',
        artifactRelease: YASREADY_AUDIOBOOKS_VERSION,
        sourceCastingLaunchRelease: launch.release ?? launch.provenance?.artifactRelease ?? null,
        sourcePrepRelease: prep.release ?? prep.provenance?.artifactRelease ?? null,
        sourcePrepEngineRelease: prep.provenance?.prepEngineRelease ?? null,
        sourceSupermanEngineRelease: prep.provenance?.supermanEngineRelease ?? prep.superman?.engineRelease ?? null
      }),
      book: freeze({ id: launch.book.id, title: launch.book.title, author: launch.book.author ?? null, sourceHash: launch.book.sourceHash }),
      source: freeze({
        castingLaunchFingerprint: launch.artifactFingerprint,
        audioBibleId: launch.source.audioBibleId,
        audioBibleDigest: launch.source.audioBibleDigest,
        audioBibleRevision: launch.source.audioBibleRevision ?? null
      }),
      catalog: freeze({
        provider: catalogProvider,
        catalogCallsPerformed: Number(catalogCallsPerformed ?? 0),
        queryMode: catalogQueryMode,
        providerFiltersApplied,
        anonymousFallbackUsed: Boolean(anonymousFallbackUsed),
        anonymousPageSizeCap: anonymousPageSizeCap === null ? null : Number(anonymousPageSizeCap),
        authRecommended: Boolean(catalogAuthRecommended),
        rawVoicesSeen: rawCatalogVoices === null ? uniquePool.length : Number(rawCatalogVoices),
        uniqueVoices: uniquePool.length,
        requestedPerRole: perRoleCount,
        auditionTopPerRole: auditionCount,
        filters: freeze({ language: 'en', category: 'professional/high_quality', minNoticePeriodDays: 180, includeCustomRates: false, includeLiveModerated: false, sort: 'trending' }),
        localSafetyPolicyEnforced: true,
        supplementalSearchesPerformed: freeze([...(supplementalSearchesPerformed ?? [])]),
        culturalFitSource: 'explicit-provider-catalog-metadata-only',
        biographyFitSource: singleNarratorMode
          ? 'character-intelligence-used-for-performance-direction-not-separate-actor-selection'
          : characterBiographies ? 'full-manuscript-semantic-truth-plus-selected-english-profile' : 'not-supplied',
        castingMode,
        previewLanguagePolicy: 'english-primary-or-unspecified-with-selected-english-preview',
        multilingualMetadataLeakageBlocked: true
      }),
      shortlists,
      distinctiveness,
      auditionSamples: effectiveAuditionSamples,
      characterBiographies,
      auditionCost,
      auditionPlanPreview: freeze({
        status: sourceReady && totalStaged >= totalNeeded && rolesWithoutAudition.length === 0 ? 'READY_TO_REQUEST_ARMING' : 'NOT_READY',
        armed: false,
        model,
        candidateIds: freeze(shortlists.flatMap((row) => row.candidates.filter((candidate) => candidate.recommendation === 'AUDITION').map((candidate) => candidate.id))),
        scriptCount: effectiveAuditionSamples?.samples?.reduce((sum, row) => sum + row.scripts.length, 0) ?? 0,
        estimatedUsd: auditionCost.recommendedAuditionUsd,
        moneyGuardApprovalRequiredBeforeRendering: true
      }),
      guardrails: freeze({
        candidateDiscoveryPerformed: true,
        exactVoiceReuseAcrossCoreShortlistsBlocked: true,
        roleFitHardMismatchAuditionBlocked: true,
        printFrontMatterAuditionBlocked: true,
        culturalIdentityInferredFromAudio: false,
        culturalIdentityInferredFromVoiceName: false,
        JuanExplicitCulturalMetadataRequiredForAutoAudition: true,
        fullManuscriptBiographyUsedForCasting: Boolean(characterBiographies) && !singleNarratorMode,
        characterIntelligenceUsedAsPerformanceDirection: Boolean(characterBiographies) && singleNarratorMode,
        singleNarratorProduction: singleNarratorMode,
        separateCoreCharacterVoiceActorsRequired: !singleNarratorMode,
        narratorPerformsLeadDialogue: singleNarratorMode,
        narratorExplicitLatinoMetadataRequiredForAutoAudition: singleNarratorMode,
        narratorSouthernCaliforniaRegionalPreference: singleNarratorMode,
        biographyIdentityInferenceFromName: false,
        biographyIdentityInferenceFromAudio: false,
        biographyProximityOnlyAttributionAllowed: false,
        identityUsedAsAcousticTrait: false,
        selectedEnglishPreviewRequired: true,
        nonEnglishPrimaryCoreVoiceBlocked: true,
        unrelatedVerifiedLanguageAccentsExcludedFromFit: true,
        readerFacingBackMatterAuditionBlocked: true,
        constrainedRoleScarcityProtection: true,
        paidProviderCallsPerformed: 0,
        generationCallsPerformed: 0,
        auditionRenderingArmed: false,
        paidGenerationArmed: false,
        productionArmed: false,
        castLocked: false,
        armAuditionsAvailableInThisBuild: false
      }),
      artifactFingerprint,
      nextAction: totalStaged < totalNeeded
        ? catalogAuthRecommended
          ? `Only ${totalStaged}/${totalNeeded} unique Wave 1 candidate slots were filled through ElevenLabs anonymous catalog browsing. Set ELEVENLABS_API_KEY for broader filtered discovery, then rerun; do not reuse a core voice just to fill the shortlist.`
          : `Only ${totalStaged}/${totalNeeded} unique Wave 1 candidate slots were filled. Increase catalog pages or lower --per-role before auditioning.`
        : sourceReady && rolesWithoutAudition.length
          ? `Do not arm auditions yet. YasReady found no strong audition-fit candidate for ${rolesWithoutAudition.join(', ')}. Broaden discovery or adjust the explicit creative casting intent before spending.`
          : sourceReady
            ? singleNarratorMode
              ? 'Open casting-review.html and judge one narrator across prose plus Juan, Michael and Christopher performance samples. Mark Keep / Maybe / Pass and export choices; no audio has been generated.'
              : `Open casting-review.html, listen to the preview players, and mark Keep / Maybe / Pass for ${castingTargets.map((row) => row.canonicalName).join(', ')}. Export Audition Choices when finished; no audio has been generated.`
            : 'Candidate discovery is complete, but canonical audition scripts are missing. Re-run with --manuscript pointing to the exact Book One source before any audition can be armed.'
    });
    return freeze({
      discovery,
      markdown: renderCastingDiscoveryMarkdown(discovery),
      shortlistCsv: renderCastingDiscoveryCsv(discovery),
      scriptsCsv: renderAuditionScriptsCsv(discovery),
      performanceGuideMarkdown: performanceGuide ? renderSingleNarratorPerformanceGuideMarkdown(performanceGuide) : null,
      reviewBoardHtml: renderCastingReviewBoardHtml(discovery)
    });
  }

  async discoverFromProvider({
    launch, prep, provider, auditionSamples = null, characterBiographies = null, perRole = 6, auditionTop = 3,
    model = 'eleven_multilingual_v2', maxPages = 3, anonymousPageLimit = 30, pageSize = 100, castingMode = 'multicast'
  } = {}) {
    if (!provider || typeof provider.searchVoices !== 'function') throw new Error('Casting Candidate Discovery requires a provider with searchVoices()');

    const waveOne = launch?.waves?.find((row) => row.wave === 1)?.targets ?? [];
    const singleNarratorMode = castingMode === 'single-narrator';
    const castingTargets = singleNarratorMode
      ? waveOne.filter((row) => row.role === 'narrator' || row.canonicalName === 'Narrator').slice(0, 1)
      : waveOne;
    const perRoleCount = clamp(Math.trunc(Number(perRole) || 6), 1, 8);
    const targetEligibleCount = Math.max(1, castingTargets.length * perRoleCount);
    const filteredPageLimit = clamp(Math.trunc(Number(maxPages) || 3), 1, 5);
    const anonymousLimit = clamp(Math.trunc(Number(anonymousPageLimit) || 30), 1, 50);
    const size = clamp(Math.trunc(Number(pageSize) || 100), 10, 100);

    const eligibleVoices = [];
    const eligibleSeen = new Set();
    let rawVoicesSeen = 0;
    let catalogCallsPerformed = 0;
    let catalogQueryMode = 'provider-filtered';
    let providerFiltersApplied = true;
    let anonymousFallbackUsed = false;
    let anonymousPageSizeCap = null;
    let anonymousPublicOnly = false;
    let noGrowthPages = 0;
    let page = 0;

    while (true) {
      const currentLimit = anonymousPublicOnly ? anonymousLimit : filteredPageLimit;
      if (page >= currentLimit) break;

      const result = await provider.searchVoices({
        language: 'en',
        category: 'professional',
        minNoticePeriodDays: 180,
        includeCustomRates: false,
        includeLiveModerated: false,
        sort: 'trending',
        page,
        pageSize: size,
        anonymousPublicOnly,
        anonymousPageSizeCap: anonymousPageSizeCap ?? 3
      });

      catalogCallsPerformed += Number(result.httpCallsPerformed ?? 1);
      catalogQueryMode = result.queryMode ?? catalogQueryMode;
      providerFiltersApplied = result.providerFiltersApplied ?? providerFiltersApplied;
      anonymousFallbackUsed = Boolean(anonymousFallbackUsed || result.anonymousFallbackUsed);
      anonymousPageSizeCap = result.anonymousPageSizeCap ?? anonymousPageSizeCap;
      if (result.queryMode === 'anonymous-public-capped') anonymousPublicOnly = true;

      const rows = result.voices ?? [];
      rawVoicesSeen += rows.length;
      const before = eligibleVoices.length;

      for (const raw of rows) {
        if (!meetsBookOneDiscoveryPolicy(raw, { model })) continue;
        const voice = projectEnglishCastingVoice(raw, { model });
        if (!voice) continue;
        const key = `${voice.provider}:${voice.providerVoiceId}`;
        if (eligibleSeen.has(key)) continue;
        eligibleSeen.add(key);
        eligibleVoices.push(voice);
      }

      if (eligibleVoices.length === before) noGrowthPages += 1;
      else noGrowthPages = 0;

      if (eligibleVoices.length >= targetEligibleCount) break;
      if (!result.hasMore) break;
      if (noGrowthPages >= 3) break;
      page += 1;
    }

    const supplementalSearchesPerformed = [];
    if (provider.apiKey && !anonymousPublicOnly) {
      const searches = [];
      const searchSeen = new Set();
      const biographyByCharacter = new Map((characterBiographies?.profiles ?? []).map((row) => [row.character, row]));
      if (singleNarratorMode) {
        for (const term of SINGLE_NARRATOR_PROFILE.searchTerms) {
          const key = lower(term);
          if (!key || searchSeen.has(key) || searches.length >= 12) continue;
          searchSeen.add(key);
          searches.push({ character: 'Narrator', term, source: 'single-narrator-profile' });
        }
      } else {
        for (const target of castingTargets) {
          for (const term of roleIntent(target).cultural?.searchTerms ?? []) {
            const key = lower(term);
            if (!key || searchSeen.has(key)) continue;
            searchSeen.add(key);
            searches.push({ character: target.canonicalName, term, source: 'character-cultural-profile' });
          }
          const biographyTerms = biographyByCharacter.get(target.canonicalName)?.castingProfile?.searchTerms ?? [];
          for (const term of biographyTerms.slice(0, 4)) {
            const key = lower(term);
            if (!key || searchSeen.has(key) || searches.length >= 12) continue;
            searchSeen.add(key);
            searches.push({ character: target.canonicalName, term, source: 'full-manuscript-biography' });
          }
        }
      }

      for (const searchSpec of searches.slice(0, 12)) {
        const result = await provider.searchVoices({
          search: searchSpec.term,
          language: 'en',
          category: 'professional',
          minNoticePeriodDays: 180,
          includeCustomRates: false,
          includeLiveModerated: false,
          sort: 'trending',
          page: 0,
          pageSize: size,
          allowAnonymousFallback: false
        });
        catalogCallsPerformed += Number(result.httpCallsPerformed ?? 1);
        rawVoicesSeen += (result.voices ?? []).length;
        supplementalSearchesPerformed.push(freeze({
          character: searchSpec.character,
          term: searchSpec.term,
          source: searchSpec.source,
          voicesReturned: (result.voices ?? []).length
        }));
        for (const raw of result.voices ?? []) {
          if (!meetsBookOneDiscoveryPolicy(raw, { model })) continue;
          const voice = projectEnglishCastingVoice(raw, { model });
          if (!voice) continue;
          const key = `${voice.provider}:${voice.providerVoiceId}`;
          if (eligibleSeen.has(key)) continue;
          eligibleSeen.add(key);
          eligibleVoices.push(voice);
        }
      }
    }

    const catalogAuthRecommended = Boolean(
      anonymousFallbackUsed && eligibleVoices.length < targetEligibleCount
    );

    return this.build({
      launch, prep, voices: eligibleVoices, auditionSamples,
      costEstimator: typeof provider.estimateCost === 'function' ? provider.estimateCost.bind(provider) : null,
      perRole, auditionTop, model,
      catalogCallsPerformed,
      catalogProvider: provider.name ?? 'elevenlabs',
      catalogQueryMode,
      providerFiltersApplied,
      anonymousFallbackUsed,
      anonymousPageSizeCap,
      catalogAuthRecommended,
      rawCatalogVoices: rawVoicesSeen,
      supplementalSearchesPerformed,
      characterBiographies,
      castingMode
    });
  }
}

export function buildCastingDiscoveryFixture() {
  const launch = {
    schemaVersion: 1,
    release: '0.14.1',
    status: 'READY_FOR_CANDIDATE_DISCOVERY',
    provenance: { applicationRelease: '0.14.1', artifactRelease: '0.14.1' },
    book: { id: 'book-one', title: 'Fixture Book One', author: 'Fixture Author', sourceHash: 'fixture-source' },
    source: { audioBibleId: 'bible-one', audioBibleDigest: 'fixture-digest', audioBibleRevision: 32 },
    artifactFingerprint: 'fixture-launch-fingerprint',
    waves: [{
      wave: 1,
      label: 'Narrator + primary cast',
      targets: [
        { canonicalName: 'Narrator', role: 'narrator', wave: 1 },
        { canonicalName: 'Juan Delgado', role: 'primary', wave: 1 },
        { canonicalName: 'Michael Rawlins', role: 'primary', wave: 1 },
        { canonicalName: 'Christopher Lancaster', role: 'primary', wave: 1 }
      ]
    }],
    requiredBeforeDirector: ['Narrator', 'Juan Delgado', 'Michael Rawlins', 'Christopher Lancaster'],
    guardrails: { candidateDiscoveryAllowed: true, auditionRenderingArmed: false, paidGenerationArmed: false, productionArmed: false }
  };
  const chars = launch.requiredBeforeDirector.map((name, index) => ({ id: `char-${index + 1}`, canonicalName: name, bibleId: 'bible-one' }));
  const prep = {
    schemaVersion: 8,
    release: '0.14.1',
    status: 'AUDIO_BIBLE_LOCKED',
    provenance: { artifactRelease: '0.14.1', prepEngineRelease: '0.11.8', supermanEngineRelease: '0.11.3' },
    book: { id: 'book-one', sourceHash: 'fixture-source' },
    audioBible: { id: 'bible-one', digest: 'fixture-digest', locked: true },
    snapshot: { characters: chars, digest: 'fixture-digest' },
    gates: { productionReady: true, audioBibleLocked: true }
  };
  const voices = Array.from({ length: 36 }, (_, index) => ({
    provider: 'elevenlabs',
    providerVoiceId: `fixture-voice-${index + 1}`,
    name: `Fixture Voice ${String(index + 1).padStart(2, '0')}`,
    description: `${['warm', 'grounded', 'confident', 'playful', 'polished', 'natural'][index % 6]} conversational audiobook storytelling voice ${index % 6 === 2 ? 'Latino American bilingual' : ''} ${index % 6 === 3 ? 'Bay Area California Asian American' : ''}`.trim(),
    category: 'professional',
    accent: ['american', 'neutral', 'californian'][index % 3],
    gender: 'male',
    age: ['young', 'middle-aged'][index % 2],
    language: 'en',
    useCase: index % 4 === 0 ? 'narration' : 'conversational',
    descriptives: [['warm', 'expressive'], ['natural', 'grounded'], ['confident', 'smooth']][index % 3],
    verifiedLanguages: [{ language: 'en', locale: 'en-US', accent: 'american' }],
    previewUrl: `https://example.invalid/voice-${index + 1}.mp3`,
    noticePeriodDays: index < 30 ? 365 : 180,
    hasCustomRate: false,
    liveModerationEnabled: false
  }));
  const sampleText = {
    Narrator: ['The room settled into a quiet that felt warmer than silence.', 'By morning, the city looked different, though nothing outside had changed.', 'They stood together at the threshold, carrying more hope than luggage.'],
    'Juan Delgado': ['I can make dinner, but nobody gets to judge the playlist.', 'I love you. I just need you to hear me before you answer.', 'Are you kidding me? We are absolutely doing this tonight!'],
    'Michael Rawlins': ['Give me a minute. I am trying to understand what you mean.', 'I am scared because this matters more than I know how to say.', 'No. Absolutely not. You cannot drop that on me and walk away!'],
    'Christopher Lancaster': ['Coffee first, explanations second. That is the deal.', 'I did not come here to make this harder. I came because I care.', 'Well, hell. If we are doing this, we are doing it all the way.']
  };
  const auditionSamples = {
    sourceHash: 'fixture-source', sourceValidated: true, status: 'READY', manuscriptDerived: false,
    sensitiveLocalArtifact: false, doNotCommit: false,
    samples: launch.requiredBeforeDirector.map((character) => ({
      character,
      role: character === 'Narrator' ? 'narrator' : 'primary',
      scripts: sampleText[character].map((text, index) => ({
        id: ['neutral', 'emotional', 'energy'][index],
        label: ['Conversational / neutral', 'Emotional range', 'High-energy / dynamic'][index],
        text, purpose: ['neutral', 'emotional', 'energy'][index], chapterOrder: index + 1, chapterTitle: `Fixture ${index + 1}`, source: 'fixture'
      }))
    }))
  };
  const estimateCost = async ({ text, model = 'eleven_multilingual_v2' }) => ({
    amountUsd: Number(((String(text).length / 1000) * 0.10).toFixed(6)),
    characters: String(text).length,
    model,
    estimated: true
  });
  return { launch, prep, voices, auditionSamples, estimateCost };
}
