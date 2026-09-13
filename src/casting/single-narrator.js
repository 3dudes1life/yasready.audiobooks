const freeze = (value) => Object.freeze(value);
const clean = (value) => String(value ?? '').trim();
const lower = (value) => clean(value).toLowerCase();
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function norm(value) {
  return lower(value).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

const LATINO_SIGNALS = freeze([
  'latino', 'latina', 'latinx', 'latino american', 'latin american', 'hispanic',
  'mexican american', 'chicano', 'puerto rican', 'cuban american',
  'colombian american', 'venezuelan american', 'peruvian american',
  'salvadoran american', 'guatemalan american', 'dominican american'
]);

const SUPPORT_SIGNALS = freeze([
  'bilingual', 'spanish english', 'english spanish', 'es us', 'es mx'
]);

const SOCAL_SIGNALS = freeze([
  'southern california', 'socal', 'san diego', 'los angeles', 'california',
  'californian', 'west coast'
]);

const US_PREVIEW_ACCENTS = freeze([
  'american', 'neutral', 'california', 'californian', 'west coast',
  'southern california', 'socal', 'san diego', 'los angeles'
]);

const HUMAN_TASTE_POSITIVE_SIGNALS = freeze([
  'low', 'smooth', 'conversational', 'personable', 'warm', 'natural',
  'grounded', 'confident', 'intimate', 'expressive', 'charismatic', 'romance'
]);

const HUMAN_TASTE_NEGATIVE_SIGNALS = freeze([
  'podcast host', 'documentary', 'documentaries', 'business', 'history',
  'tutorial', 'tutorials', 'customer support', 'announcer', 'commercial',
  'corporate', 'explainer'
]);

export const BOOK_ONE_NARRATOR_TASTE_PROFILE = freeze({
  version: 'book-one-human-v1',
  source: 'operator-human-review-round-1',
  learningScope: 'provider-metadata-associated-with-human-decisions-only',
  acousticSimilarityLearned: false,
  target: 'young US-born/US-English Latino American male with a low, smooth, conversational, personable, strong contemporary delivery',
  preferredAges: freeze(['young', 'young adult']),
  allowedPreviewLocales: freeze(['en-US']),
  allowedPreviewAccents: US_PREVIEW_ACCENTS,
  positiveSignals: HUMAN_TASTE_POSITIVE_SIGNALS,
  negativeSignals: HUMAN_TASTE_NEGATIVE_SIGNALS,
  hardExcludeMiddleAged: true,
  hardExcludeNonUsEnglishPreview: true,
  notes: freeze([
    'Human review strongly preferred young, conversational and personable over documentary/announcer styling.',
    'Middle-aged catalog voices consumed shortlist slots but were rejected by the operator.',
    'A selected English preview with a non-US regional accent should not qualify for this Book One narrator.',
    'This calibration does not analyze acoustic similarity and never infers ethnicity from voice sound or name.'
  ])
});

export const SINGLE_NARRATOR_PROFILE = freeze({
  label: 'Young, strong Southern California Latino American romance narrator',
  characterContext: 'One narrator performs the entire audiobook. Audible target: young, strong, warm, confident contemporary Southern California / West Coast American English. Explicit Latino/Latin-American/Hispanic provider metadata is required for auto-audition; identity is never inferred from the voice name or preview sound, and no stereotyped Spanish accent is required.',
  preferredGender: 'male',
  preferredAges: freeze(['young', 'young adult', 'adult']),
  preferredAccents: freeze(['southern california', 'socal', 'san diego', 'los angeles', 'california', 'californian', 'west coast', 'american', 'neutral']),
  preferredUseCases: freeze(['audiobook', 'narration', 'narrative story', 'storytelling', 'conversational']),
  keywords: freeze([
    'strong', 'warm', 'confident', 'grounded', 'natural', 'contemporary',
    'expressive', 'emotional', 'intimate', 'romance', 'storytelling',
    'narration', 'audiobook', 'charismatic', 'clear'
  ]),
  cultural: freeze({
    label: 'Latino American narrator fit',
    requiredForAudition: true,
    strongSignals: LATINO_SIGNALS,
    supportSignals: SUPPORT_SIGNALS
  }),
  regional: freeze({
    label: 'Southern California / West Coast American delivery',
    preferred: true,
    signals: SOCAL_SIGNALS
  }),
  searchTerms: freeze([
    'young latino american conversational male',
    'us born latino male',
    'young hispanic american male',
    'smooth latino american male',
    'conversational latino narrator',
    'southern california latino male',
    'california latino american',
    'san diego latino narrator',
    'young male romance narrator',
    'smooth personable male narrator'
  ])
});

function providerIdentityText(voice) {
  // Identity fit is provider-metadata-only. Deliberately excludes voice name and accent.
  return [
    voice?.description,
    voice?.category,
    voice?.useCase,
    ...(voice?.descriptives ?? []),
    voice?.raw?.description,
    ...Object.values(voice?.raw?.labels ?? {})
  ].filter(Boolean).join(' ').toLowerCase();
}

function audibleMetadataText(voice) {
  return [
    voice?.description,
    voice?.category,
    voice?.gender,
    voice?.age,
    voice?.language,
    voice?.locale,
    voice?.accent,
    voice?.useCase,
    ...(voice?.descriptives ?? []),
    voice?.selectedEnglishProfile?.accent,
    voice?.selectedEnglishProfile?.locale
  ].filter(Boolean).join(' ').toLowerCase();
}

function explicitMatches(text, signals) {
  const normalized = norm(text);
  return signals.filter((signal) => {
    const wanted = norm(signal);
    return wanted && normalized.includes(wanted);
  });
}

export function scoreSingleNarratorCulturalFit(voice) {
  const text = providerIdentityText(voice);
  const matchedSignals = explicitMatches(text, LATINO_SIGNALS);
  const supportSignals = explicitMatches(text, SUPPORT_SIGNALS);
  const requirementMet = matchedSignals.length > 0;
  const flags = [];
  if (!requirementMet) {
    flags.push(freeze({
      code: 'single-narrator-latino-metadata-required',
      severity: 'gating',
      note: supportSignals.length
        ? 'Spanish/bilingual metadata can support the search but does not establish Latino identity. Explicit Latino/Latin-American/Hispanic provider metadata is required for auto-audition.'
        : 'No explicit Latino/Latin-American/Hispanic provider metadata is present. The voice may remain visible as an alternate but cannot be auto-auditioned for the Book One narrator.'
    }));
  }
  return freeze({
    applicable: true,
    label: SINGLE_NARRATOR_PROFILE.cultural.label,
    score: requirementMet ? 100 : supportSignals.length ? 58 : 30,
    requiredForAudition: true,
    requirementMet,
    matchedSignals: freeze(matchedSignals),
    supportSignals: freeze(supportSignals),
    flags: freeze(flags),
    source: 'explicit-provider-catalog-metadata-only',
    inferenceFromAudioOrName: false
  });
}

export function scoreSingleNarratorFit(voice) {
  const text = audibleMetadataText(voice);
  const stretchFlags = [];
  const matchedKeywords = SINGLE_NARRATOR_PROFILE.keywords.filter((word) => text.includes(norm(word)));
  const regionalMatches = SOCAL_SIGNALS.filter((signal) => text.includes(norm(signal)));
  let hardMismatch = false;
  let score = 38;

  const gender = norm(voice?.gender);
  if (gender) {
    if (gender === 'male') score += 18;
    else {
      score -= 35;
      hardMismatch = true;
      stretchFlags.push(freeze({
        code: 'gender-mismatch',
        severity: 'hard',
        note: `Catalog gender ${voice.gender} does not match the current male narrator creative target.`
      }));
    }
  }

  const age = norm(voice?.age);
  if (age) {
    if (age === 'young' || age === 'young adult') score += 14;
    else if (age === 'adult') score += 6;
    else if (/middle aged|senior|old|elder/.test(age)) {
      score -= 15;
      stretchFlags.push(freeze({
        code: 'age-stretch',
        severity: 'strong',
        note: `Catalog age ${voice.age} is older than the young / young-adult narrator target.`
      }));
    }
  }

  const useCase = norm(voice?.useCase);
  if (useCase) {
    const useMatch = SINGLE_NARRATOR_PROFILE.preferredUseCases.some((item) => {
      const wanted = norm(item);
      return useCase.includes(wanted) || wanted.includes(useCase);
    });
    if (useMatch) score += 12;
    else {
      score -= 5;
      stretchFlags.push(freeze({
        code: 'use-case-stretch',
        severity: 'soft',
        note: `Catalog use case ${voice.useCase} is not an ideal long-form fiction narration signal.`
      }));
    }
  }

  if (regionalMatches.length) score += Math.min(15, 7 + regionalMatches.length * 2);
  else if (/\bamerican\b|\bneutral\b/.test(text)) score += 4;
  else {
    stretchFlags.push(freeze({
      code: 'regional-signal-missing',
      severity: 'soft',
      note: 'No Southern California / California / West Coast signal appears in the selected English casting metadata.'
    }));
  }

  score += Math.min(20, matchedKeywords.length * 3);
  if (voice?.previewUrl) score += 3;
  if (lower(voice?.language) === 'en') score += 3;

  score = clamp(Math.round(score), 0, 100);
  return freeze({
    score,
    grade: hardMismatch ? 'hard-mismatch' : score >= 90 ? 'excellent' : score >= 82 ? 'strong' : score >= 72 ? 'possible' : 'stretch',
    label: SINGLE_NARRATOR_PROFILE.label,
    matchedKeywords: freeze(matchedKeywords),
    regionalMatches: freeze(regionalMatches),
    preferredGender: SINGLE_NARRATOR_PROFILE.preferredGender,
    preferredAccents: SINGLE_NARRATOR_PROFILE.preferredAccents,
    preferredAges: SINGLE_NARRATOR_PROFILE.preferredAges,
    preferredUseCases: SINGLE_NARRATOR_PROFILE.preferredUseCases,
    characterContext: SINGLE_NARRATOR_PROFILE.characterContext,
    hardMismatch,
    stretchFlags: freeze(stretchFlags),
    preferenceSource: 'Book One operator creative direction for single-narrator production'
  });
}


export function scoreSingleNarratorTasteFit(voice) {
  const text = audibleMetadataText(voice);
  const positiveSignals = explicitMatches(text, HUMAN_TASTE_POSITIVE_SIGNALS);
  const negativeSignals = explicitMatches(text, HUMAN_TASTE_NEGATIVE_SIGNALS);
  const age = norm(voice?.age);
  const previewLocale = clean(voice?.selectedEnglishProfile?.locale ?? voice?.locale);
  const previewAccent = norm(voice?.selectedEnglishProfile?.accent ?? voice?.accent);
  const useCase = norm(voice?.useCase);
  const flags = [];
  let score = 45;

  const young = age === 'young' || age === 'young adult';
  const middleAged = /middle aged|senior|old|elder/.test(age);
  if (young) score += 22;
  else if (age === 'adult') score += 5;
  else if (middleAged) {
    score -= 32;
    flags.push(freeze({
      code: 'human-taste-age-hard-exclude',
      severity: 'hard',
      note: `Human review rejected the middle-aged narrator cluster; ${voice?.age ?? 'this age'} is outside the Book One taste target.`
    }));
  }

  const usLocale = previewLocale === 'en-US';
  const usAccent = US_PREVIEW_ACCENTS.some((signal) => {
    const wanted = norm(signal);
    return previewAccent === wanted || previewAccent.includes(wanted) || wanted.includes(previewAccent);
  });
  if (usLocale && usAccent) score += 18;
  else {
    score -= 28;
    flags.push(freeze({
      code: 'human-taste-preview-region-hard-exclude',
      severity: 'hard',
      note: `Selected English preview ${previewLocale || 'unknown locale'} / ${previewAccent || 'unknown accent'} is outside the US-American/California narrator target.`
    }));
  }

  if (useCase === 'conversational') score += 15;
  else if (/narrative story|narration|audiobook|storytelling/.test(useCase)) score += 4;

  score += Math.min(25, positiveSignals.length * 5);
  score -= Math.min(35, negativeSignals.length * 10);

  // Descriptions that explicitly read like a human-personality profile are more useful
  // than generic content-category metadata.
  if (/\bpersonable\b/.test(text)) score += 7;
  if (/\bsmooth\b/.test(text)) score += 6;
  if (/\blow\b/.test(text)) score += 4;
  if (/\breal guy\b/.test(text)) score += 3;

  const hardExcludeFromShortlist = Boolean(
    BOOK_ONE_NARRATOR_TASTE_PROFILE.hardExcludeMiddleAged && middleAged ||
    BOOK_ONE_NARRATOR_TASTE_PROFILE.hardExcludeNonUsEnglishPreview && (!usLocale || !usAccent)
  );
  const auditionEligible = !hardExcludeFromShortlist && young && score >= 78;

  score = clamp(Math.round(score), 0, 100);
  return freeze({
    applicable: true,
    score,
    grade: score >= 90 ? 'excellent' : score >= 80 ? 'strong' : score >= 68 ? 'possible' : 'weak',
    profileVersion: BOOK_ONE_NARRATOR_TASTE_PROFILE.version,
    positiveSignals: freeze(positiveSignals),
    negativeSignals: freeze(negativeSignals),
    youngTargetMet: young,
    usPreviewTargetMet: usLocale && usAccent,
    auditionEligible,
    hardExcludeFromShortlist,
    flags: freeze(flags),
    source: BOOK_ONE_NARRATOR_TASTE_PROFILE.source,
    learningScope: BOOK_ONE_NARRATOR_TASTE_PROFILE.learningScope,
    acousticSimilarityLearned: false
  });
}

function copyScript(script, { id, label, purpose }) {
  return freeze({
    ...script,
    id,
    label,
    purpose,
    source: script.source ?? 'canonical-manuscript'
  });
}

export function buildSingleNarratorAuditionSamplePack(samplePack) {
  if (!samplePack?.samples) return null;
  const byCharacter = new Map(samplePack.samples.map((row) => [row.character, row]));
  const narratorScripts = byCharacter.get('Narrator')?.scripts ?? [];
  const scripts = [];

  for (const [index, script] of narratorScripts.slice(0, 2).entries()) {
    scripts.push(copyScript(script, {
      id: `single-narrator-narration-${index + 1}`,
      label: index === 0 ? 'Narration — opening tone' : 'Narration — emotional range',
      purpose: index === 0 ? 'narration-opening' : 'narration-range'
    }));
  }

  for (const character of ['Juan Delgado', 'Michael Rawlins', 'Christopher Lancaster']) {
    const script = byCharacter.get(character)?.scripts?.[0];
    if (!script) continue;
    scripts.push(copyScript(script, {
      id: `single-narrator-${character.toLowerCase().replace(/[^a-z]+/g, '-')}`,
      label: `Character performance — ${character}`,
      purpose: `character-performance-${character.toLowerCase().replace(/[^a-z]+/g, '-')}`
    }));
  }

  return freeze({
    sourceHash: samplePack.sourceHash ?? null,
    sourceValidated: samplePack.sourceValidated === true,
    status: scripts.length >= 4 ? 'READY' : 'PARTIAL',
    manuscriptDerived: Boolean(samplePack.manuscriptDerived),
    sensitiveLocalArtifact: true,
    doNotCommit: true,
    castingMode: 'single-narrator',
    missingCharacters: freeze(
      ['Juan Delgado', 'Michael Rawlins', 'Christopher Lancaster']
        .filter((name) => !(byCharacter.get(name)?.scripts?.length))
    ),
    samples: freeze([
      freeze({
        character: 'Narrator',
        role: 'narrator',
        scripts: freeze(scripts)
      })
    ])
  });
}

export function buildSingleNarratorPerformanceGuide(characterBiographies = null) {
  const biographyCharacters = new Set((characterBiographies?.profiles ?? []).map((row) => row.character));
  const characters = freeze([
    freeze({
      character: 'Juan Delgado',
      canon: 'Latino American',
      performanceDirection: 'Warm, confident, playful and charismatic. Contemporary American English is welcome. Keep cultural identity authentic without manufacturing a stereotyped Spanish accent.',
      differentiation: 'Slightly quicker, brighter and more teasing than the base narration voice.',
      avoid: 'No cartoonish accent, no generic “Latin lover” performance, no forced Spanish pronunciation unless the manuscript requires it.'
    }),
    freeze({
      character: 'Michael Rawlins',
      canon: 'Young adult white man from an Oklahoma ranch / rural background',
      performanceDirection: 'Grounded, warm and emotionally natural, with a light Oklahoma / Plains country coloration.',
      differentiation: 'A touch more country rhythm and grounded softness than the base narration voice.',
      avoid: 'No cowboy caricature, no exaggerated Southern drawl, no older rancher voice.'
    }),
    freeze({
      character: 'Christopher Lancaster',
      canon: 'Asian American man from the San Francisco Bay Area',
      performanceDirection: 'Polished, warm, confident and contemporary Bay Area / California American.',
      differentiation: 'Smoother, more measured and polished than Juan or Michael.',
      avoid: 'No stereotyped ethnic accent and no attempt to make him “sound Asian.”'
    })
  ]);

  return freeze({
    schemaVersion: 1,
    castingMode: 'single-narrator',
    source: 'operator-confirmed-book-one-performance-direction',
    characterBiographiesAvailable: biographyCharacters.size > 0,
    characterBiographiesUsedToSelectSeparateActors: false,
    oneNarratorPerformsAllCharacters: true,
    narratorTarget: freeze({
      label: SINGLE_NARRATOR_PROFILE.label,
      delivery: 'Young, strong, warm, confident contemporary Southern California / West Coast American English.',
      culturalRequirement: 'Explicit Latino/Latin-American/Hispanic provider metadata required before auto-audition.',
      stereotypePolicy: 'Identity is not inferred from sound. No forced Spanish accent is required.'
    }),
    globalDirection: freeze([
      'Keep one coherent narrator identity across prose and dialogue.',
      'Differentiate characters with rhythm, energy, placement and subtle regional color rather than drastic pitch changes.',
      'Character changes should be immediately legible but never cartoonish.',
      'Romance/intimacy should feel conversational and emotionally grounded.'
    ]),
    characters
  });
}

export function renderSingleNarratorPerformanceGuideMarkdown(guide) {
  if (!guide) return '# Single Narrator Performance Guide\n\nNo guide was generated.\n';
  const lines = [
    '# Book One Single Narrator Performance Guide', '',
    `**Casting mode:** ${guide.castingMode}`,
    `**Narrator target:** ${guide.narratorTarget.label}`, '',
    guide.narratorTarget.delivery, '',
    `**Cultural-fit rule:** ${guide.narratorTarget.culturalRequirement}`,
    `**Stereotype rule:** ${guide.narratorTarget.stereotypePolicy}`, '',
    '## Global performance direction', ''
  ];
  for (const row of guide.globalDirection) lines.push(`- ${row}`);
  lines.push('');
  for (const row of guide.characters) {
    lines.push(
      `## ${row.character}`, '',
      `**Canon:** ${row.canon}`, '',
      row.performanceDirection, '',
      `**Differentiate with:** ${row.differentiation}`, '',
      `**Avoid:** ${row.avoid}`, ''
    );
  }
  lines.push('> These are performance directions for one narrator. They are not separate voice-actor casting assignments.', '');
  return `${lines.join('\n')}\n`;
}
