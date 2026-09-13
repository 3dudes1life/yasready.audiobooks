const freeze = (value) => Object.freeze(value);
const clean = (value) => String(value ?? '').trim();
const lower = (value) => clean(value).toLowerCase();
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function escapeRe(value) {
  return String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function clip(value, max = 190) {
  const text = clean(value).replace(/\s+/g, ' ');
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

function normalizedText(value) {
  return lower(value).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function confidenceLabel(value) {
  if (value >= 0.95) return 'confirmed';
  if (value >= 0.9) return 'high';
  if (value >= 0.78) return 'medium-high';
  if (value >= 0.65) return 'medium';
  return 'low';
}

// Explicit operator-confirmed fictional character canon.
// Identity is NEVER translated into an acoustic race/ethnicity score.
const BOOK_ONE_OPERATOR_CANON = Object.freeze({
  'Juan Delgado': Object.freeze({
    facts: Object.freeze([
      Object.freeze({ kind: 'identity', ruleId: 'canon-latino', label: 'Latino American', confidence: 1, acousticTrait: false })
    ])
  }),
  'Michael Rawlins': Object.freeze({
    facts: Object.freeze([
      Object.freeze({ kind: 'region', ruleId: 'canon-oklahoma', label: 'Oklahoma', confidence: 1, relation: 'origin', acousticTrait: true,
        searchTerms: Object.freeze(['oklahoma', 'country american', 'rural american', 'southern american']),
        accentHints: Object.freeze(['oklahoma', 'country', 'plains', 'midwest', 'southern']) }),
      Object.freeze({ kind: 'background', ruleId: 'canon-ranch', label: 'ranch / rural background', confidence: 1, relation: 'background', acousticTrait: true,
        searchTerms: Object.freeze(['country american', 'rural american', 'western american']),
        descriptors: Object.freeze(['grounded', 'natural', 'country']) }),
      Object.freeze({ kind: 'age', ruleId: 'canon-young-adult', label: 'young adult', confidence: 1, relation: 'age', acousticTrait: true,
        ageHints: Object.freeze(['young', 'young adult']) }),
      Object.freeze({ kind: 'identity', ruleId: 'canon-white', label: 'white', confidence: 1, acousticTrait: false })
    ])
  }),
  'Christopher Lancaster': Object.freeze({
    facts: Object.freeze([
      Object.freeze({ kind: 'identity', ruleId: 'canon-asian-american', label: 'Asian American', confidence: 1, acousticTrait: false }),
      Object.freeze({ kind: 'region', ruleId: 'canon-bay-area', label: 'San Francisco Bay Area', confidence: 1, relation: 'residence', acousticTrait: true,
        searchTerms: Object.freeze(['bay area', 'california', 'west coast american']),
        accentHints: Object.freeze(['california', 'californian', 'west coast', 'american']) })
    ])
  })
});

const EVIDENCE_RULES = Object.freeze([
  Object.freeze({
    id: 'oklahoma', kind: 'region', label: 'Oklahoma',
    regex: /\boklahoma\b/i,
    searchTerms: Object.freeze(['oklahoma', 'country american', 'rural american', 'southern american']),
    accentHints: Object.freeze(['oklahoma', 'country', 'southern', 'plains', 'midwest'])
  }),
  Object.freeze({
    id: 'bay-area', kind: 'region', label: 'San Francisco Bay Area',
    regex: /\b(?:bay area|san francisco|sf bay|oakland|berkeley|northern california)\b/i,
    searchTerms: Object.freeze(['bay area', 'california', 'west coast american']),
    accentHints: Object.freeze(['california', 'californian', 'west coast', 'american'])
  }),
  Object.freeze({
    id: 'florida', kind: 'region', label: 'Florida',
    regex: /\bflorida\b/i,
    searchTerms: Object.freeze(['florida american']),
    accentHints: Object.freeze(['american'])
  }),
  Object.freeze({
    id: 'california', kind: 'region', label: 'California',
    regex: /\bcalifornia\b/i,
    searchTerms: Object.freeze(['california', 'west coast american']),
    accentHints: Object.freeze(['california', 'californian', 'west coast', 'american'])
  }),
  Object.freeze({
    id: 'farm', kind: 'background', label: 'farm background',
    regex: /\b(?:farm|farmhouse|farmland|farm life|grew up farming)\b/i,
    searchTerms: Object.freeze(['country american', 'rural american']),
    descriptors: Object.freeze(['grounded', 'natural', 'country'])
  }),
  Object.freeze({
    id: 'ranch', kind: 'background', label: 'ranch background',
    regex: /\b(?:ranch|rancher|ranch life)\b/i,
    searchTerms: Object.freeze(['country american', 'rural american', 'western american']),
    descriptors: Object.freeze(['grounded', 'natural', 'country'])
  }),
  Object.freeze({
    id: 'rural', kind: 'background', label: 'rural background',
    regex: /\b(?:rural|small town|small-town|country boy|country life)\b/i,
    searchTerms: Object.freeze(['country american', 'rural american']),
    descriptors: Object.freeze(['grounded', 'natural', 'country'])
  }),
  Object.freeze({
    id: 'latino', kind: 'identity', label: 'Latino / Latin-American identity',
    regex: /\b(?:latino|latina|latin american|hispanic|mexican american|chicano|puerto rican|cuban american|colombian american|venezuelan american|peruvian american|salvadoran american|guatemalan american|dominican american)\b/i,
    searchTerms: Object.freeze(['latino', 'latin american', 'hispanic'])
  }),
  Object.freeze({
    id: 'asian-american', kind: 'identity', label: 'Asian American identity',
    regex: /\b(?:asian american|filipino american|chinese american|korean american|japanese american|vietnamese american|taiwanese american)\b/i,
    searchTerms: Object.freeze(['asian american'])
  }),
  Object.freeze({
    id: 'spanish-bilingual', kind: 'language', label: 'Spanish / bilingual cue',
    regex: /\b(?:bilingual|speaks spanish|spanish speaker|english and spanish|spanish and english)\b/i,
    searchTerms: Object.freeze(['bilingual', 'spanish english'])
  }),
  Object.freeze({
    id: 'country-speech', kind: 'speech', label: 'country / regional speech cue',
    regex: /\b(?:country accent|country drawl|southern drawl|oklahoma drawl|twang|southern accent|country voice)\b/i,
    searchTerms: Object.freeze(['country american', 'southern american', 'oklahoma']),
    accentHints: Object.freeze(['country', 'southern', 'oklahoma', 'plains', 'midwest'])
  }),
  Object.freeze({
    id: 'young-adult', kind: 'age', label: 'young adult cue',
    regex: /\b(?:young man|young guy|young adult|in his twenties|twenty[- ]something|late twenties|early thirties)\b/i,
    ageHints: Object.freeze(['young', 'young adult'])
  }),
  Object.freeze({
    id: 'dj', kind: 'occupation', label: 'DJ / nightlife performance background',
    regex: /\b(?:dj|djing|disc jockey|behind the decks|dj booth|dj set)\b/i,
    descriptors: Object.freeze(['confident', 'playful', 'charismatic', 'energetic'])
  })
]);

function flattenManuscript(prepRun) {
  const rows = [];
  let flat = 0;
  for (const chapter of prepRun?.ingestResult?.analysis?.chapters ?? []) {
    for (let sceneIndex = 0; sceneIndex < (chapter.scenes ?? []).length; sceneIndex += 1) {
      const scene = chapter.scenes[sceneIndex];
      const segments = scene.segments ?? [];
      for (let position = 0; position < segments.length; position += 1) {
        const segment = segments[position];
        const record = prepRun?.ingestResult?.segments?.[flat] ?? null;
        rows.push({
          chapterOrder: chapter.order ?? null,
          chapterTitle: chapter.title ?? null,
          sceneIndex,
          sceneKey: `${chapter.order ?? 'x'}:${sceneIndex}`,
          position,
          recordId: record?.id ?? null,
          text: clean(segment.text),
          kind: segment.kind ?? null
        });
        flat += 1;
      }
    }
  }
  return rows;
}

function aliasesForTarget(target, prepRun) {
  const canonical = clean(target.canonicalName);
  if (!canonical || canonical === 'Narrator') return [];
  const snapshot = prepRun?.prep?.snapshot?.characters?.find((row) => row.canonicalName === canonical);
  const aliases = new Set([canonical, ...(snapshot?.aliases ?? [])]);
  const parts = canonical.split(/\s+/).filter(Boolean);
  if (parts[0]?.length >= 3) aliases.add(parts[0]);
  if (parts.length > 1 && parts.at(-1)?.length >= 4) aliases.add(parts.at(-1));
  return [...aliases].filter((value) => value.length >= 3);
}

function containsAlias(text, aliases) {
  return aliases.some((alias) => new RegExp(`\\b${escapeRe(alias)}\\b`, 'i').test(text));
}

function firstPersonOwnership(text) {
  return /\b(?:i am|i'm|i was|i grew up|i live|i'm from|i come from|my family|my ranch|my farm|my dj|i dj|i'm a dj|i have been djing|i've been djing)\b/i.test(text);
}

function travelOrContextRegionMention(text) {
  return /\b(?:trip|weekend|vacation|visit|visiting|visited|flight|flew|flying|airport|hotel|booked|booking|headed to|driving to|drive to|drove to|survived|how(?:'s| is)|came back from|returned from|burrito|restaurant|brunch|funeral in)\b/i.test(text);
}

function regionRelation(text) {
  if (travelOrContextRegionMention(text)) return null;
  if (/\b(?:grew up|raised|born|native|hometown|from)\b/i.test(text)) return 'origin';
  if (/\b(?:lives? in|living in|based in|home in|back in|apartment in|relocat(?:e|ed|ing) to|moved to|moving to)\b/i.test(text)) return 'residence';
  if (/\b(?:built|made|established)\s+(?:his|her|their|my)\s+(?:adult\s+)?life\s+(?:in|around)\b/i.test(text)) return 'residence';
  return null;
}

function speakerMap(prepRun) {
  const map = new Map();
  for (const binding of prepRun?.prep?.dialogueReview?.autoBindings ?? []) {
    if (!binding.segmentId || !binding.speaker || binding.classification !== 'spoken-dialogue') continue;
    if (Number(binding.confidence ?? 0) < 0.9) continue;
    map.set(binding.segmentId, binding.speaker);
  }
  return map;
}

function evidenceOwner(rule, row, target, aliases, speaker) {
  const direct = containsAlias(row.text, aliases);
  const spokenByTarget = speaker === target.canonicalName;

  if (rule.kind === 'region') {
    const relation = regionRelation(row.text);
    if (!relation) return null;
    if (direct || (spokenByTarget && firstPersonOwnership(row.text))) return { relation, confidence: direct ? 0.97 : 0.92 };
    return null;
  }

  if (rule.kind === 'identity' || rule.kind === 'language' || rule.kind === 'age') {
    if (direct) return { relation: rule.kind, confidence: 0.97 };
    if (spokenByTarget && firstPersonOwnership(row.text)) return { relation: rule.kind, confidence: 0.92 };
    return null;
  }

  if (rule.kind === 'occupation' || rule.kind === 'background' || rule.kind === 'speech') {
    if (direct) return { relation: rule.kind === 'occupation' ? 'occupation' : 'background', confidence: 0.97 };
    if (spokenByTarget && firstPersonOwnership(row.text)) return { relation: rule.kind === 'occupation' ? 'occupation' : 'background', confidence: 0.92 };
    return null;
  }

  return null;
}

function canonEvidenceFor(character) {
  return (BOOK_ONE_OPERATOR_CANON[character]?.facts ?? []).map((fact) => freeze({
    ruleId: fact.ruleId,
    kind: fact.kind,
    label: fact.label,
    confidence: fact.confidence,
    confidenceLabel: 'confirmed',
    relation: fact.relation ?? fact.kind,
    chapterOrder: null,
    chapterTitle: null,
    sceneIndex: null,
    distanceFromNamedMention: 0,
    excerpt: null,
    source: 'operator-confirmed-canon',
    acousticTrait: fact.acousticTrait !== false,
    searchTerms: freeze([...(fact.searchTerms ?? [])]),
    accentHints: freeze([...(fact.accentHints ?? [])]),
    descriptors: freeze([...(fact.descriptors ?? [])]),
    ageHints: freeze([...(fact.ageHints ?? [])])
  }));
}

function deriveProfile(character, evidence) {
  const acousticEvidence = evidence.filter((row) => row.acousticTrait !== false);
  const regions = acousticEvidence.filter((row) => row.kind === 'region' && ['origin', 'residence'].includes(row.relation));
  const backgrounds = acousticEvidence.filter((row) => row.kind === 'background');
  const speech = acousticEvidence.filter((row) => row.kind === 'speech');
  const identities = evidence.filter((row) => row.kind === 'identity');
  const languages = acousticEvidence.filter((row) => row.kind === 'language');
  const ages = acousticEvidence.filter((row) => row.kind === 'age');
  const occupations = acousticEvidence.filter((row) => row.kind === 'occupation');

  const searchTerms = unique(acousticEvidence.flatMap((row) => row.searchTerms ?? [])).slice(0, 10);
  const preferredAccents = unique(acousticEvidence.flatMap((row) => row.accentHints ?? [])).slice(0, 10);
  const preferredDescriptors = unique(acousticEvidence.flatMap((row) => row.descriptors ?? [])).slice(0, 10);
  const preferredAges = unique(acousticEvidence.flatMap((row) => row.ageHints ?? [])).slice(0, 6);

  const hasOklahoma = regions.some((row) => /oklahoma/i.test(row.label) && row.confidence >= 0.78);
  const hasRural = backgrounds.some((row) => /farm|ranch|rural/i.test(row.label) && row.confidence >= 0.78);
  const hasCountrySpeech = speech.some((row) => row.ruleId === 'country-speech' && row.confidence >= 0.78);
  const hasBayArea = regions.some((row) => /bay area|san francisco/i.test(row.label) && row.confidence >= 0.78);

  let regionalFlavor = null;
  if (hasOklahoma && (hasRural || hasCountrySpeech)) {
    regionalFlavor = freeze({
      label: 'Mild Oklahoma / Plains country coloration — contemporary, not caricature',
      confidence: hasCountrySpeech ? 'high' : 'medium-high',
      evidenceBacked: true,
      requiredForPreferredAudition: true,
      matchTerms: freeze(['oklahoma', 'country', 'rural', 'southern', 'plains', 'midwest', 'western']),
      fallbackTerms: freeze(['american', 'neutral'])
    });
  } else if (hasOklahoma) {
    regionalFlavor = freeze({
      label: 'Contemporary Oklahoma / Plains American',
      confidence: 'medium-high',
      evidenceBacked: true,
      requiredForPreferredAudition: false,
      matchTerms: freeze(['oklahoma', 'plains', 'midwest', 'american']),
      fallbackTerms: freeze(['american', 'neutral'])
    });
  } else if (hasBayArea) {
    regionalFlavor = freeze({
      label: 'Contemporary Bay Area / California American',
      confidence: 'medium-high',
      evidenceBacked: true,
      requiredForPreferredAudition: false,
      matchTerms: freeze(['bay area', 'san francisco', 'california', 'californian', 'west coast', 'american']),
      fallbackTerms: freeze(['american', 'neutral'])
    });
  }

  const summaryParts = [];
  if (regions.length) summaryParts.push(`Region: ${unique(regions.map((row) => row.label)).join(', ')}`);
  if (backgrounds.length) summaryParts.push(`Background: ${unique(backgrounds.map((row) => row.label)).join(', ')}`);
  if (identities.length) summaryParts.push(`Confirmed identity: ${unique(identities.map((row) => row.label)).join(', ')} (not an acoustic trait)`);
  if (languages.length) summaryParts.push(`Language: ${unique(languages.map((row) => row.label)).join(', ')}`);
  if (ages.length) summaryParts.push(`Age: ${unique(ages.map((row) => row.label)).join(', ')}`);
  if (occupations.length) summaryParts.push(`Lifestyle/occupation: ${unique(occupations.map((row) => row.label)).join(', ')}`);
  if (regionalFlavor) summaryParts.push(`Voice target: ${regionalFlavor.label}`);

  return freeze({
    searchTerms: freeze(searchTerms),
    preferredAccents: freeze(preferredAccents),
    preferredDescriptors: freeze(preferredDescriptors),
    preferredAges: freeze(preferredAges),
    regionalFlavor,
    explicitIdentitySignals: freeze(unique(identities.map((row) => row.label))),
    summary: summaryParts.length ? summaryParts.join(' • ') : 'No strong manuscript-supported regional or cultural casting cues found.',
    avoidStereotype: true,
    identityInferenceFromName: false,
    identityInferenceFromAudio: false,
    identityUsedAsAcousticTrait: false
  });
}

export function buildCharacterCastingBiographiesFromPrepRun(prepRun, launch) {
  if (!prepRun?.prep || !prepRun?.ingestResult) throw new Error('character biography extraction requires a fresh full-manuscript Book One prep run');
  if (prepRun.prep.book?.sourceHash !== launch?.book?.sourceHash) throw new Error('character biography manuscript source hash does not match Casting Launch');
  if (prepRun.prep.status !== 'AUDIO_BIBLE_LOCKED') throw new Error('character biography extraction requires a locked fresh prep run');

  const rows = flattenManuscript(prepRun);
  const waveOne = launch?.waves?.find((row) => row.wave === 1)?.targets ?? [];
  const speakers = speakerMap(prepRun);
  const evidenceByCharacter = new Map();

  for (const target of waveOne) {
    evidenceByCharacter.set(target.canonicalName, [...canonEvidenceFor(target.canonicalName)]);
  }

  for (const target of waveOne) {
    if (target.role === 'narrator') continue;
    const aliases = aliasesForTarget(target, prepRun);
    const list = evidenceByCharacter.get(target.canonicalName) ?? [];

    for (const row of rows) {
      if (!row.text) continue;
      const speaker = row.recordId ? speakers.get(row.recordId) : null;

      for (const rule of EVIDENCE_RULES) {
        if (!rule.regex.test(row.text)) continue;
        const ownership = evidenceOwner(rule, row, target, aliases, speaker);
        if (!ownership) continue;

        const dedupe = `${rule.id}|${row.chapterOrder}|${row.sceneIndex}|${row.position}|${target.canonicalName}`;
        if (list.some((item) => item._dedupe === dedupe)) continue;

        list.push({
          _dedupe: dedupe,
          ruleId: rule.id,
          kind: rule.kind,
          label: rule.label,
          confidence: ownership.confidence,
          confidenceLabel: confidenceLabel(ownership.confidence),
          relation: ownership.relation,
          chapterOrder: row.chapterOrder,
          chapterTitle: row.chapterTitle,
          sceneIndex: row.sceneIndex,
          distanceFromNamedMention: 0,
          excerpt: clip(row.text),
          source: 'manuscript-semantic-attribution',
          acousticTrait: rule.kind !== 'identity',
          searchTerms: [...(rule.searchTerms ?? [])],
          accentHints: [...(rule.accentHints ?? [])],
          descriptors: [...(rule.descriptors ?? [])],
          ageHints: [...(rule.ageHints ?? [])]
        });
      }
    }

    evidenceByCharacter.set(target.canonicalName, list);
  }

  const profiles = waveOne.map((target) => {
    const rawEvidence = (evidenceByCharacter.get(target.canonicalName) ?? [])
      .sort((a, b) => b.confidence - a.confidence || Number(a.chapterOrder ?? 0) - Number(b.chapterOrder ?? 0));
    const evidence = rawEvidence.slice(0, 28).map(({ _dedupe, ...row }) => freeze({
      ...row,
      searchTerms: freeze([...(row.searchTerms ?? [])]),
      accentHints: freeze([...(row.accentHints ?? [])]),
      descriptors: freeze([...(row.descriptors ?? [])]),
      ageHints: freeze([...(row.ageHints ?? [])])
    }));
    const castingProfile = target.role === 'narrator'
      ? freeze({
          searchTerms: freeze([]),
          preferredAccents: freeze([]),
          preferredDescriptors: freeze([]),
          preferredAges: freeze([]),
          regionalFlavor: null,
          explicitIdentitySignals: freeze([]),
          summary: 'Narrator is not assigned a fictional character biography.',
          avoidStereotype: true,
          identityInferenceFromName: false,
          identityInferenceFromAudio: false,
          identityUsedAsAcousticTrait: false
        })
      : deriveProfile(target.canonicalName, evidence);

    return freeze({
      character: target.canonicalName,
      role: target.role,
      sourceScope: 'full-manuscript-plus-operator-canon',
      sourceHash: prepRun.prep.book.sourceHash,
      evidenceCount: evidence.length,
      evidence: freeze(evidence),
      castingProfile,
      status: target.role === 'narrator' ? 'NOT_APPLICABLE' : evidence.length ? 'EVIDENCE_BACKED' : 'PARTIAL_EVIDENCE'
    });
  });

  return freeze({
    schemaVersion: 2,
    sourceScope: 'full-manuscript-plus-operator-canon',
    sourceHash: prepRun.prep.book.sourceHash,
    manuscriptDerived: true,
    operatorCanonApplied: true,
    semanticOwnershipRequired: true,
    proximityOnlyAttributionAllowed: false,
    sensitiveLocalArtifact: true,
    doNotCommit: true,
    identityInferenceFromName: false,
    identityInferenceFromAudio: false,
    identityUsedAsAcousticTrait: false,
    profiles: freeze(profiles)
  });
}

function voiceMetadataText(voice) {
  // IMPORTANT: only the active English casting profile participates in acoustic/regional fit.
  // Never flatten every verified language/accent into one giant metadata soup.
  return [
    voice?.name,
    voice?.description,
    voice?.category,
    voice?.accent,
    voice?.gender,
    voice?.age,
    voice?.language,
    voice?.locale,
    voice?.useCase,
    ...(voice?.descriptives ?? []),
    voice?.selectedEnglishProfile?.accent,
    voice?.selectedEnglishProfile?.locale
  ].filter(Boolean).join(' ').toLowerCase();
}

export function scoreCharacterBiographyFit(voice, biography) {
  if (!biography || biography.status === 'NOT_APPLICABLE') {
    return freeze({
      applicable: false,
      score: null,
      grade: 'not-applicable',
      requirementMet: true,
      preferredAuditionRequirement: false,
      matchedTerms: freeze([]),
      concerns: freeze([])
    });
  }

  const profile = biography.castingProfile ?? {};
  const text = voiceMetadataText(voice);
  const matchTerms = unique([
    ...(profile.searchTerms ?? []),
    ...(profile.preferredAccents ?? []),
    ...(profile.preferredDescriptors ?? []),
    ...(profile.preferredAges ?? []),
    ...(profile.regionalFlavor?.matchTerms ?? [])
  ]);
  const matchedTerms = matchTerms.filter((term) => text.includes(normalizedText(term)));
  const concerns = [];
  let score = 55;

  if (/\bamerican\b/.test(text) || /\bneutral\b/.test(text)) score += 6;
  score += Math.min(30, matchedTerms.length * 6);

  if ((profile.preferredAges ?? []).length) {
    const ageMatch = profile.preferredAges.some((age) => text.includes(normalizedText(age)));
    if (ageMatch) score += 8;
    else if (/middle aged|middle_aged|senior|old|elder/.test(text)) {
      score -= 12;
      concerns.push('Provider age metadata is older than the full-book/operator-confirmed character target.');
    }
  }

  const regional = profile.regionalFlavor ?? null;
  let requirementMet = true;
  let preferredAuditionRequirement = false;
  if (regional?.requiredForPreferredAudition) {
    preferredAuditionRequirement = true;
    const regionalMatches = (regional.matchTerms ?? []).filter((term) => text.includes(normalizedText(term)));
    requirementMet = regionalMatches.length > 0;
    if (requirementMet) score += 12;
    else {
      score -= 22;
      concerns.push(`Full-book biography supports ${regional.label}; the selected English casting profile does not show that preferred regional/country signal.`);
    }
  }

  score = clamp(Math.round(score), 0, 100);
  return freeze({
    applicable: true,
    score,
    grade: score >= 90 ? 'excellent' : score >= 80 ? 'strong' : score >= 68 ? 'possible' : 'weak',
    requirementMet,
    preferredAuditionRequirement,
    matchedTerms: freeze(matchedTerms),
    concerns: freeze(concerns),
    metadataScope: 'selected-english-casting-profile-only'
  });
}

export function renderCharacterCastingBiographiesMarkdown(biographies) {
  const lines = [
    '# Book One Character Casting Biographies', '',
    `**Source scope:** ${biographies?.sourceScope ?? 'unknown'}`,
    `**Manuscript-derived:** ${biographies?.manuscriptDerived ? 'YES' : 'NO'}`,
    `**Operator canon applied:** ${biographies?.operatorCanonApplied ? 'YES' : 'NO'}`,
    `**Proximity-only attribution allowed:** ${biographies?.proximityOnlyAttributionAllowed ? 'YES' : 'NO'}`, '',
    '> These biographies are local production intelligence. Identity is never inferred from a name or from how a voice sounds, and identity itself is not scored as an acoustic trait.', ''
  ];

  for (const profile of biographies?.profiles ?? []) {
    lines.push(`## ${profile.character}`, '', `**Status:** ${profile.status}`, '');
    lines.push(profile.castingProfile?.summary ?? 'No casting summary available.', '');
    if (profile.castingProfile?.regionalFlavor) {
      lines.push(`**Derived voice target:** ${profile.castingProfile.regionalFlavor.label}`, '');
    }
    if (profile.evidence?.length) {
      lines.push('### Character truth evidence', '');
      for (const evidence of profile.evidence.slice(0, 12)) {
        const location = evidence.source === 'operator-confirmed-canon'
          ? 'operator-confirmed canon'
          : (evidence.chapterTitle ?? `Chapter ${evidence.chapterOrder ?? '?'}`);
        lines.push(`- ${evidence.label} — ${evidence.confidenceLabel} — ${evidence.relation ?? evidence.kind} — ${location}`);
      }
      lines.push('');
    }
  }
  return `${lines.join('\n')}\n`;
}
