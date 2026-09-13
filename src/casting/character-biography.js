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

function voiceMetadataText(voice) {
  return [
    voice?.name, voice?.description, voice?.category, voice?.accent, voice?.gender,
    voice?.age, voice?.language, voice?.locale, voice?.useCase,
    ...(voice?.descriptives ?? []),
    ...(voice?.verifiedLanguages ?? []).flatMap((row) => [row.language, row.locale, row.accent])
  ].filter(Boolean).join(' ').toLowerCase();
}

const EVIDENCE_RULES = Object.freeze([
  Object.freeze({
    id: 'oklahoma', kind: 'region', label: 'Oklahoma',
    regex: /\boklahoma\b/i,
    searchTerms: Object.freeze(['oklahoma', 'country american', 'rural american', 'southern american']),
    accentHints: Object.freeze(['american', 'oklahoma', 'country', 'southern', 'plains'])
  }),
  Object.freeze({
    id: 'bay-area', kind: 'region', label: 'San Francisco Bay Area',
    regex: /\b(?:bay area|san francisco|sf bay|oakland|berkeley|northern california)\b/i,
    searchTerms: Object.freeze(['bay area', 'california', 'west coast american']),
    accentHints: Object.freeze(['american', 'california', 'californian', 'west coast'])
  }),
  Object.freeze({
    id: 'florida', kind: 'region', label: 'Florida',
    regex: /\bflorida\b/i,
    searchTerms: Object.freeze(['florida american', 'american']),
    accentHints: Object.freeze(['american'])
  }),
  Object.freeze({
    id: 'california', kind: 'region', label: 'California',
    regex: /\bcalifornia\b/i,
    searchTerms: Object.freeze(['california', 'west coast american']),
    accentHints: Object.freeze(['american', 'california', 'californian', 'west coast'])
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
    accentHints: Object.freeze(['country', 'southern', 'oklahoma', 'american'])
  }),
  Object.freeze({
    id: 'young-adult', kind: 'age', label: 'young adult cue',
    regex: /\b(?:young man|young guy|young adult|in his twenties|twenty[- ]something|late twenties|early thirties)\b/i,
    ageHints: Object.freeze(['young', 'young adult', 'middle aged'])
  }),
  Object.freeze({
    id: 'dj', kind: 'occupation', label: 'DJ / nightlife performance background',
    regex: /\b(?:dj|djing|disc jockey|behind the decks)\b/i,
    descriptors: Object.freeze(['confident', 'playful', 'charismatic', 'energetic'])
  })
]);

function flattenManuscript(prepRun) {
  const rows = [];
  for (const chapter of prepRun?.ingestResult?.analysis?.chapters ?? []) {
    for (let sceneIndex = 0; sceneIndex < (chapter.scenes ?? []).length; sceneIndex += 1) {
      const scene = chapter.scenes[sceneIndex];
      const segments = scene.segments ?? [];
      for (let position = 0; position < segments.length; position += 1) {
        const segment = segments[position];
        rows.push({
          chapterOrder: chapter.order ?? null,
          chapterTitle: chapter.title ?? null,
          sceneIndex,
          sceneKey: `${chapter.order ?? 'x'}:${sceneIndex}`,
          position,
          text: clean(segment.text),
          kind: segment.kind ?? null
        });
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

function closestMention(row, mentionsByCharacter) {
  let best = null;
  let tied = false;
  for (const [character, mentions] of mentionsByCharacter.entries()) {
    for (const mention of mentions) {
      if (mention.sceneKey !== row.sceneKey) continue;
      const distance = Math.abs(mention.position - row.position);
      if (distance > 3) continue;
      if (!best || distance < best.distance) {
        best = { character, distance };
        tied = false;
      } else if (distance === best.distance && character !== best.character) {
        tied = true;
      }
    }
  }
  return tied ? null : best;
}

function confidenceFor(rowText, aliases, distance) {
  if (containsAlias(rowText, aliases)) return 0.97;
  if (distance === 0) return 0.94;
  if (distance === 1) return 0.86;
  if (distance === 2) return 0.78;
  return 0.7;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function confidenceLabel(value) {
  if (value >= 0.9) return 'high';
  if (value >= 0.78) return 'medium-high';
  if (value >= 0.65) return 'medium';
  return 'low';
}

function deriveProfile(character, evidence) {
  const regions = evidence.filter((row) => row.kind === 'region');
  const backgrounds = evidence.filter((row) => row.kind === 'background');
  const speech = evidence.filter((row) => row.kind === 'speech');
  const identities = evidence.filter((row) => row.kind === 'identity');
  const languages = evidence.filter((row) => row.kind === 'language');
  const ages = evidence.filter((row) => row.kind === 'age');
  const occupations = evidence.filter((row) => row.kind === 'occupation');

  const searchTerms = unique(evidence.flatMap((row) => row.searchTerms ?? [])).slice(0, 10);
  const preferredAccents = unique(evidence.flatMap((row) => row.accentHints ?? [])).slice(0, 10);
  const preferredDescriptors = unique(evidence.flatMap((row) => row.descriptors ?? [])).slice(0, 10);
  const preferredAges = unique(evidence.flatMap((row) => row.ageHints ?? [])).slice(0, 6);

  const hasOklahoma = regions.some((row) => row.ruleId === 'oklahoma' && row.confidence >= 0.7);
  const hasRural = backgrounds.some((row) => ['farm', 'ranch', 'rural'].includes(row.ruleId) && row.confidence >= 0.7);
  const hasCountrySpeech = speech.some((row) => row.ruleId === 'country-speech' && row.confidence >= 0.7);
  const hasBayArea = regions.some((row) => row.ruleId === 'bay-area' && row.confidence >= 0.7);

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
      confidence: 'medium',
      evidenceBacked: true,
      requiredForPreferredAudition: false,
      matchTerms: freeze(['oklahoma', 'plains', 'american', 'midwest']),
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
  if (identities.length) summaryParts.push(`Explicit identity: ${unique(identities.map((row) => row.label)).join(', ')}`);
  if (languages.length) summaryParts.push(`Language: ${unique(languages.map((row) => row.label)).join(', ')}`);
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
    identityInferenceFromAudio: false
  });
}

export function buildCharacterCastingBiographiesFromPrepRun(prepRun, launch) {
  if (!prepRun?.prep || !prepRun?.ingestResult) throw new Error('character biography extraction requires a fresh full-manuscript Book One prep run');
  if (prepRun.prep.book?.sourceHash !== launch?.book?.sourceHash) throw new Error('character biography manuscript source hash does not match Casting Launch');
  if (prepRun.prep.status !== 'AUDIO_BIBLE_LOCKED') throw new Error('character biography extraction requires a locked fresh prep run');

  const rows = flattenManuscript(prepRun);
  const waveOne = launch?.waves?.find((row) => row.wave === 1)?.targets ?? [];
  const aliasesByCharacter = new Map();
  const mentionsByCharacter = new Map();

  for (const target of waveOne) {
    const aliases = aliasesForTarget(target, prepRun);
    aliasesByCharacter.set(target.canonicalName, aliases);
    const mentions = target.role === 'narrator'
      ? []
      : rows.filter((row) => row.text && containsAlias(row.text, aliases)).map((row) => ({ sceneKey: row.sceneKey, position: row.position }));
    mentionsByCharacter.set(target.canonicalName, mentions);
  }

  const evidenceByCharacter = new Map(waveOne.map((target) => [target.canonicalName, []]));
  for (const row of rows) {
    if (!row.text) continue;
    for (const rule of EVIDENCE_RULES) {
      if (!rule.regex.test(row.text)) continue;
      const nearest = closestMention(row, mentionsByCharacter);
      if (!nearest) continue;
      const aliases = aliasesByCharacter.get(nearest.character) ?? [];
      const confidence = confidenceFor(row.text, aliases, nearest.distance);
      const list = evidenceByCharacter.get(nearest.character) ?? [];
      const dedupe = `${rule.id}|${row.chapterOrder}|${row.sceneIndex}|${row.position}`;
      if (list.some((item) => item.dedupe === dedupe)) continue;
      list.push({
        dedupe,
        ruleId: rule.id,
        kind: rule.kind,
        label: rule.label,
        confidence,
        confidenceLabel: confidenceLabel(confidence),
        chapterOrder: row.chapterOrder,
        chapterTitle: row.chapterTitle,
        sceneIndex: row.sceneIndex,
        distanceFromNamedMention: nearest.distance,
        excerpt: clip(row.text),
        searchTerms: [...(rule.searchTerms ?? [])],
        accentHints: [...(rule.accentHints ?? [])],
        descriptors: [...(rule.descriptors ?? [])],
        ageHints: [...(rule.ageHints ?? [])]
      });
      evidenceByCharacter.set(nearest.character, list);
    }
  }

  const profiles = waveOne.map((target) => {
    const rawEvidence = (evidenceByCharacter.get(target.canonicalName) ?? [])
      .sort((a, b) => b.confidence - a.confidence || Number(a.chapterOrder ?? 0) - Number(b.chapterOrder ?? 0));
    const evidence = rawEvidence.slice(0, 24).map(({ dedupe, ...row }) => freeze(row));
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
          identityInferenceFromAudio: false
        })
      : deriveProfile(target.canonicalName, evidence);

    return freeze({
      character: target.canonicalName,
      role: target.role,
      sourceScope: 'full-manuscript',
      sourceHash: prepRun.prep.book.sourceHash,
      evidenceCount: evidence.length,
      evidence: freeze(evidence),
      castingProfile,
      status: target.role === 'narrator' ? 'NOT_APPLICABLE' : evidence.length ? 'EVIDENCE_BACKED' : 'PARTIAL_EVIDENCE'
    });
  });

  return freeze({
    schemaVersion: 1,
    sourceScope: 'full-manuscript',
    sourceHash: prepRun.prep.book.sourceHash,
    manuscriptDerived: true,
    sensitiveLocalArtifact: true,
    doNotCommit: true,
    identityInferenceFromName: false,
    identityInferenceFromAudio: false,
    profiles: freeze(profiles)
  });
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
    ...(profile.regionalFlavor?.matchTerms ?? [])
  ]);
  const matchedTerms = matchTerms.filter((term) => text.includes(normalizedText(term)));
  const concerns = [];
  let score = 58;

  if (/\bamerican\b/.test(text) || /\bneutral\b/.test(text)) score += 8;
  score += Math.min(34, matchedTerms.length * 8);

  const regional = profile.regionalFlavor ?? null;
  let requirementMet = true;
  let preferredAuditionRequirement = false;
  if (regional?.requiredForPreferredAudition) {
    preferredAuditionRequirement = true;
    const regionalMatches = (regional.matchTerms ?? []).filter((term) => text.includes(normalizedText(term)));
    requirementMet = regionalMatches.length > 0;
    if (requirementMet) score += 10;
    else {
      score -= 18;
      concerns.push(`Full-book biography supports ${regional.label}; provider metadata does not show the preferred regional/country signal.`);
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
    concerns: freeze(concerns)
  });
}

export function renderCharacterCastingBiographiesMarkdown(biographies) {
  const lines = [
    '# Book One Character Casting Biographies', '',
    `**Source scope:** ${biographies?.sourceScope ?? 'unknown'}`,
    `**Manuscript-derived:** ${biographies?.manuscriptDerived ? 'YES' : 'NO'}`, '',
    '> These biographies are local production intelligence. Cultural identity is never inferred from a name or from how a voice sounds.', ''
  ];

  for (const profile of biographies?.profiles ?? []) {
    lines.push(`## ${profile.character}`, '', `**Status:** ${profile.status}`, '');
    lines.push(profile.castingProfile?.summary ?? 'No casting summary available.', '');
    if (profile.castingProfile?.regionalFlavor) {
      lines.push(`**Derived voice target:** ${profile.castingProfile.regionalFlavor.label}`, '');
    }
    if (profile.evidence?.length) {
      lines.push('### Manuscript evidence', '');
      for (const evidence of profile.evidence.slice(0, 10)) {
        lines.push(`- ${evidence.label} — ${evidence.confidenceLabel} confidence — ${evidence.chapterTitle ?? `Chapter ${evidence.chapterOrder ?? '?'}`}`);
      }
      lines.push('');
    }
  }
  return `${lines.join('\n')}\n`;
}
