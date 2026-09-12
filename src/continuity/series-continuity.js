import { normalizeIdentity, normalizeTerm, uniqueText } from '../bible/normalization.js';
import { sha256, stableJson } from '../core/hash.js';

export const SERIES_CONTINUITY_RELEASE = '0.12.0';
export const SERIES_CONTINUITY_SCHEMA_VERSION = 1;

const freeze = (value) => Object.freeze(value);

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item);
  } else {
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return Object.freeze(value);
}

function text(value) {
  return String(value ?? '').trim();
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

export function deriveSeriesTitle(bookTitle) {
  const title = text(bookTitle);
  if (!title) return 'Untitled Series';
  const enDash = title.split(/\s+[–—]\s+/)[0]?.trim();
  if (enDash && enDash !== title) return enDash;
  const subtitle = title.split(/\s+-\s+/)[0]?.trim();
  return subtitle || title;
}

export function continuityKeyForCharacter(character) {
  const explicit = text(character?.seriesCharacterKey);
  if (explicit) return explicit;
  return normalizeIdentity(character?.canonicalName).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function classifySeriesContinuityPolicy(character) {
  if (character?.continuityScope === 'scene') return 'scene-only';
  if (character?.role === 'narrator' || character?.role === 'primary') return 'required';
  if (character?.role === 'supporting') return 'carry-forward';
  if (character?.provisional || character?.castingStatus === 'provisional') return 'reference-only';
  return 'carry-forward';
}

function assertLockedPrep(prep) {
  if (!prep || typeof prep !== 'object' || Array.isArray(prep)) throw new Error('Series Continuity requires an Audio Bible Prep object');
  if (prep.status !== 'AUDIO_BIBLE_LOCKED') throw new Error(`Series Continuity requires AUDIO_BIBLE_LOCKED source; found ${prep.status ?? 'unknown'}`);
  if (prep.gates?.audioBibleLocked !== true || prep.gates?.productionReady !== true) throw new Error('Series Continuity requires a production-ready locked Audio Bible');
  if (prep.dialogueReview?.needsReview !== 0 || prep.dialogueReview?.unresolved !== 0) throw new Error('Series Continuity refuses source with unresolved speaker review');
  if (prep.pronunciationReview?.needsConfirmation !== 0) throw new Error('Series Continuity refuses source with unresolved pronunciation review');
  if (prep.continuity?.unresolvedDialogueSegments !== 0) throw new Error('Series Continuity refuses source with unresolved continuity');
  if (!prep.snapshot?.digest || prep.snapshot.digest !== prep.audioBible?.digest) throw new Error('Series Continuity source snapshot digest does not match locked Audio Bible digest');
  if (prep.providerCallsPerformed !== 0) throw new Error('Series Continuity seed source must be a zero-spend prep artifact');
}

function characterSourceDetails(prep, row) {
  const snap = (prep.snapshot?.characters ?? []).find((candidate) => {
    const key = continuityKeyForCharacter(row);
    return candidate.seriesCharacterKey === key || normalizeIdentity(candidate.canonicalName) === normalizeIdentity(row.canonicalName);
  });
  return {
    pronouns: snap?.pronouns ?? null,
    description: snap?.description ?? null,
    performanceProfile: clone(snap?.performanceProfile ?? {})
  };
}

function buildRelationshipContinuity(prep, characterKeys) {
  const sourceById = new Map((prep.snapshot?.characters ?? []).map((row) => [row.id, continuityKeyForCharacter(row)]));
  const allowed = new Set(characterKeys);
  return (prep.snapshot?.relationships ?? []).flatMap((row) => {
    const fromSeriesCharacterKey = sourceById.get(row.fromCharacterId);
    const toSeriesCharacterKey = sourceById.get(row.toCharacterId);
    if (!fromSeriesCharacterKey || !toSeriesCharacterKey || !allowed.has(fromSeriesCharacterKey) || !allowed.has(toSeriesCharacterKey)) return [];
    return [freeze({
      fromSeriesCharacterKey,
      toSeriesCharacterKey,
      kind: row.kind,
      label: row.label ?? null,
      notes: row.notes ?? null
    })];
  });
}

function packagePayloadForDigest(pkg) {
  const { digest: _digest, ...payload } = pkg;
  return payload;
}

export function computeSeriesContinuityDigest(pkg) {
  return sha256(stableJson(packagePayloadForDigest(pkg)));
}

export function verifySeriesContinuityPackage(pkg) {
  if (!pkg || pkg.schemaVersion !== SERIES_CONTINUITY_SCHEMA_VERSION) return freeze({ valid: false, reason: 'schema-version' });
  if (pkg.release !== SERIES_CONTINUITY_RELEASE) return freeze({ valid: false, reason: 'release-version' });
  if (!pkg.digest) return freeze({ valid: false, reason: 'missing-digest' });
  const digest = computeSeriesContinuityDigest(pkg);
  return freeze({ valid: digest === pkg.digest, reason: digest === pkg.digest ? null : 'digest-mismatch', digest });
}

export function buildSeriesContinuityPackage(prep, {
  seriesTitle = null,
  seriesAuthor = null,
  sourceLabel = 'locked-audio-bible'
} = {}) {
  assertLockedPrep(prep);

  const permanentRows = (prep.characterPlan ?? []).filter((row) => (row.continuityScope ?? 'book') !== 'scene');
  const seenKeys = new Set();
  const characters = permanentRows.map((row) => {
    const seriesCharacterKey = continuityKeyForCharacter(row);
    if (!seriesCharacterKey) throw new Error(`cannot create series continuity key for ${row.canonicalName ?? 'unknown character'}`);
    if (seenKeys.has(seriesCharacterKey)) throw new Error(`duplicate series continuity key: ${seriesCharacterKey}`);
    seenKeys.add(seriesCharacterKey);
    const source = characterSourceDetails(prep, row);
    return freeze({
      seriesCharacterKey,
      canonicalName: row.canonicalName,
      aliases: freeze(uniqueText(row.aliases ?? [])),
      role: row.role,
      continuityPolicy: classifySeriesContinuityPolicy(row),
      pronouns: source.pronouns,
      description: source.description,
      performanceProfile: freeze(source.performanceProfile ?? {}),
      sourceMentions: row.mentions ?? 0,
      sourceConfidence: row.averageConfidence ?? null,
      provisional: Boolean(row.provisional || row.castingStatus === 'provisional'),
      source: row.source ?? sourceLabel,
      sourceBookId: prep.book?.id ?? null
    });
  });

  const explicitRules = (prep.snapshot?.pronunciations ?? []).map((row) => freeze({
    term: row.term,
    spokenAs: row.spokenAs,
    notation: row.notation ?? 'plain',
    language: row.language ?? prep.book?.language ?? 'en',
    caseSensitive: Boolean(row.caseSensitive),
    source: row.source ?? sourceLabel
  }));
  const standardReadings = (prep.pronunciationReview?.candidates ?? [])
    .filter((row) => row.ruleRequired === false)
    .map((row) => freeze({
      term: row.term,
      category: row.category ?? null,
      language: row.language ?? prep.book?.language ?? 'en',
      resolutionMode: row.resolutionMode ?? 'standard-orthography',
      source: 'source-book-standard-reading'
    }));

  const sceneLocalExcluded = (prep.sceneLocalRoles ?? []).map((row) => freeze({
    canonicalName: row.canonicalName,
    chapterOrder: row.chapterOrder ?? null,
    mentions: row.mentions ?? 0,
    aliases: freeze(uniqueText(row.aliases ?? [])),
    exclusionReason: 'scene-local-role'
  }));

  const relationships = buildRelationshipContinuity(prep, characters.map((row) => row.seriesCharacterKey));
  const pendingSeriesCharacterKeys = characters
    .filter((row) => row.continuityPolicy !== 'reference-only')
    .map((row) => row.seriesCharacterKey);

  const payload = {
    schemaVersion: SERIES_CONTINUITY_SCHEMA_VERSION,
    release: SERIES_CONTINUITY_RELEASE,
    status: 'SERIES_CONTINUITY_READY',
    providerCallsPerformed: 0,
    series: freeze({
      title: text(seriesTitle) || deriveSeriesTitle(prep.book?.title),
      author: text(seriesAuthor) || prep.book?.author || null
    }),
    sourceBook: freeze({
      id: prep.book?.id ?? null,
      title: prep.book?.title ?? null,
      author: prep.book?.author ?? null,
      language: prep.book?.language ?? 'en',
      sourceHash: prep.book?.sourceHash ?? null,
      audioBibleId: prep.audioBible?.id ?? null,
      audioBibleDigest: prep.audioBible?.digest ?? null,
      audioBibleRevision: prep.audioBible?.revision ?? null,
      prepRelease: prep.release ?? null,
      locked: true
    }),
    characters: freeze(characters),
    relationships: freeze(relationships),
    pronunciations: freeze({ explicitRules: freeze(explicitRules), standardReadings: freeze(standardReadings) }),
    sceneLocalExcluded: freeze(sceneLocalExcluded),
    voiceContinuity: freeze({
      assignments: freeze([]),
      lockedCount: 0,
      pendingSeriesCharacterKeys: freeze(pendingSeriesCharacterKeys)
    }),
    policy: freeze({
      narratorAndPrimary: 'required',
      supportingAndNamedMinor: 'carry-forward',
      provisionalGenericRoles: 'reference-only',
      sceneLocalRoles: 'excluded',
      pronunciationConflicts: 'fail-closed',
      voiceRecast: 'explicit-unlock-required'
    }),
    gates: freeze({
      sourceAudioBibleLocked: true,
      sourceProductionReady: true,
      sourceSpeakerReviewClosed: true,
      sourcePronunciationReviewClosed: true,
      seriesPackageReady: true,
      paidGenerationArmed: false
    })
  };
  const digest = computeSeriesContinuityDigest(payload);
  return deepFreeze({ ...payload, digest });
}

function packageCharacterIdentities(character) {
  return uniqueText([character.canonicalName, ...(character.aliases ?? [])]).map(normalizeIdentity).filter(Boolean);
}

function nextCharacterMatches(seriesPackage, nextCharacter) {
  const key = continuityKeyForCharacter(nextCharacter);
  const exact = seriesPackage.characters.filter((row) => row.seriesCharacterKey === key);
  if (exact.length) return exact;
  const nextIdentities = new Set(packageCharacterIdentities(nextCharacter));
  return seriesPackage.characters.filter((row) => packageCharacterIdentities(row).some((identity) => nextIdentities.has(identity)));
}

function pronunciationKey(row) {
  return `${row.caseSensitive ? 'case' : 'fold'}:${normalizeTerm(row.term, { caseSensitive: Boolean(row.caseSensitive) })}`;
}

export function compareBookToSeriesContinuity(seriesPackage, nextPrep) {
  const packageCheck = verifySeriesContinuityPackage(seriesPackage);
  if (!packageCheck.valid) throw new Error(`invalid Series Continuity package: ${packageCheck.reason}`);
  if (!nextPrep || !Array.isArray(nextPrep.characterPlan)) throw new Error('next-book comparison requires an Audio Bible Prep artifact');

  const nextCharacters = nextPrep.characterPlan.filter((row) => (row.continuityScope ?? 'book') !== 'scene');
  const recurringCharacters = [];
  const newCharacters = [];
  const identityConflicts = [];
  const matchedSeriesKeys = new Set();
  const roleDrift = [];

  for (const row of nextCharacters) {
    const matches = nextCharacterMatches(seriesPackage, row);
    if (matches.length > 1) {
      identityConflicts.push(freeze({ nextCharacter: row.canonicalName, matches: freeze(matches.map((x) => x.seriesCharacterKey)) }));
      continue;
    }
    if (matches.length === 0) {
      newCharacters.push(freeze({ canonicalName: row.canonicalName, proposedSeriesCharacterKey: continuityKeyForCharacter(row), role: row.role }));
      continue;
    }
    const match = matches[0];
    matchedSeriesKeys.add(match.seriesCharacterKey);
    const matchType = match.seriesCharacterKey === continuityKeyForCharacter(row) ? 'series-key' : 'identity';
    recurringCharacters.push(freeze({
      seriesCharacterKey: match.seriesCharacterKey,
      seriesName: match.canonicalName,
      nextBookName: row.canonicalName,
      role: row.role,
      matchType
    }));
    if (match.role !== row.role && match.role !== 'narrator' && row.role !== 'narrator') {
      roleDrift.push(freeze({ seriesCharacterKey: match.seriesCharacterKey, seriesRole: match.role, nextBookRole: row.role }));
    }
  }

  const missingRequiredCharacters = seriesPackage.characters
    .filter((row) => row.continuityPolicy === 'required' && !matchedSeriesKeys.has(row.seriesCharacterKey))
    .map((row) => freeze({ seriesCharacterKey: row.seriesCharacterKey, canonicalName: row.canonicalName, role: row.role }));

  const nextRules = nextPrep.snapshot?.pronunciations ?? [];
  const nextByKey = new Map(nextRules.map((row) => [pronunciationKey(row), row]));
  const pronunciationConflicts = [];
  let inheritedRules = 0;
  for (const rule of seriesPackage.pronunciations.explicitRules ?? []) {
    const next = nextByKey.get(pronunciationKey(rule));
    if (!next) {
      inheritedRules += 1;
      continue;
    }
    if (next.spokenAs !== rule.spokenAs || (next.language ?? 'en') !== (rule.language ?? 'en')) {
      pronunciationConflicts.push(freeze({ term: rule.term, seriesSpokenAs: rule.spokenAs, nextBookSpokenAs: next.spokenAs, seriesLanguage: rule.language, nextBookLanguage: next.language }));
    }
  }

  const voiceLocks = seriesPackage.voiceContinuity?.assignments ?? [];
  const blockers = identityConflicts.length + pronunciationConflicts.length;
  const status = blockers > 0 ? 'BLOCKED' : (missingRequiredCharacters.length > 0 || roleDrift.length > 0 ? 'REVIEW' : 'PASS');
  return deepFreeze({
    schemaVersion: 1,
    release: SERIES_CONTINUITY_RELEASE,
    status,
    providerCallsPerformed: 0,
    seriesDigest: seriesPackage.digest,
    book: freeze({ id: nextPrep.book?.id ?? null, title: nextPrep.book?.title ?? null, sourceHash: nextPrep.book?.sourceHash ?? null }),
    recurringCharacters: freeze(recurringCharacters),
    newCharacters: freeze(newCharacters),
    identityConflicts: freeze(identityConflicts),
    missingRequiredCharacters: freeze(missingRequiredCharacters),
    roleDrift: freeze(roleDrift),
    pronunciation: freeze({ inheritedRules, conflicts: freeze(pronunciationConflicts), nextBookLocalRules: nextRules.length }),
    voiceContinuity: freeze({ lockedAssignments: voiceLocks.length, pendingSeriesCharacterKeys: freeze(seriesPackage.voiceContinuity?.pendingSeriesCharacterKeys ?? []) }),
    sceneLocalRoleCount: (nextPrep.sceneLocalRoles ?? []).length,
    gates: freeze({ identitySafe: identityConflicts.length === 0, pronunciationSafe: pronunciationConflicts.length === 0, requiredCharactersPresent: missingRequiredCharacters.length === 0, paidGenerationArmed: false }),
    nextAction: status === 'PASS'
      ? 'Continuity match passed. Inherit the series Audio Bible and preserve locked voice assignments.'
      : status === 'REVIEW'
        ? 'Review required-character or role drift before inheriting Book Two continuity.'
        : 'Resolve identity/pronunciation conflicts before production.'
  });
}

export function withSeriesVoiceLock(seriesPackage, {
  seriesCharacterKey,
  provider,
  providerVoiceId,
  approvedBy = 'operator',
  safetyScore = null,
  override = false,
  reason = null
}) {
  const check = verifySeriesContinuityPackage(seriesPackage);
  if (!check.valid) throw new Error(`invalid Series Continuity package: ${check.reason}`);
  const character = seriesPackage.characters.find((row) => row.seriesCharacterKey === seriesCharacterKey);
  if (!character) throw new Error(`unknown series character key: ${seriesCharacterKey}`);
  if (!text(provider) || !text(providerVoiceId)) throw new Error('series voice lock requires provider and providerVoiceId');
  const current = seriesPackage.voiceContinuity?.assignments?.find((row) => row.seriesCharacterKey === seriesCharacterKey);
  if (current && current.provider === provider && current.providerVoiceId === providerVoiceId) return seriesPackage;
  if (current && !override) throw new Error(`series voice for ${seriesCharacterKey} is locked; explicit override is required`);
  if (override && !text(reason)) throw new Error('series voice override requires a reason');

  const assignments = (seriesPackage.voiceContinuity?.assignments ?? []).filter((row) => row.seriesCharacterKey !== seriesCharacterKey);
  assignments.push(freeze({
    seriesCharacterKey,
    provider,
    providerVoiceId,
    approvedBy,
    safetyScore: Number.isFinite(Number(safetyScore)) ? Number(safetyScore) : null,
    locked: true,
    override: Boolean(override),
    overrideReason: override ? text(reason) : null
  }));
  assignments.sort((a, b) => a.seriesCharacterKey.localeCompare(b.seriesCharacterKey));
  const pending = seriesPackage.characters
    .filter((row) => row.continuityPolicy !== 'reference-only' && !assignments.some((x) => x.seriesCharacterKey === row.seriesCharacterKey))
    .map((row) => row.seriesCharacterKey);

  const { digest: _oldDigest, ...base } = seriesPackage;
  const next = {
    ...clone(base),
    voiceContinuity: {
      assignments,
      lockedCount: assignments.length,
      pendingSeriesCharacterKeys: pending
    }
  };
  return deepFreeze({ ...next, digest: computeSeriesContinuityDigest(next) });
}

export function renderSeriesContinuityMarkdown(pkg) {
  const rows = pkg.characters.map((row) => `| ${row.canonicalName} | ${row.role} | ${row.continuityPolicy} | ${row.seriesCharacterKey} |`).join('\n');
  const excluded = pkg.sceneLocalExcluded.length
    ? pkg.sceneLocalExcluded.map((row) => `- ${row.canonicalName}${row.chapterOrder != null ? ` — Chapter ${row.chapterOrder}` : ''}`).join('\n')
    : '- None';
  return `# Series Continuity\n\n**Release:** ${pkg.release}\n**Status:** ${pkg.status}\n**Series:** ${pkg.series.title}\n**Source book:** ${pkg.sourceBook.title}\n**Source Audio Bible:** LOCKED\n\n## Continuity promoted\n\n- ${pkg.characters.length} permanent role(s) preserved\n- ${pkg.characters.filter((x) => x.continuityPolicy === 'required').length} required series identity role(s)\n- ${pkg.characters.filter((x) => x.continuityPolicy === 'carry-forward').length} carry-forward role(s)\n- ${pkg.characters.filter((x) => x.continuityPolicy === 'reference-only').length} reference-only role(s)\n- ${pkg.pronunciations.explicitRules.length} explicit pronunciation rule(s) preserved\n- ${pkg.pronunciations.standardReadings.length} standard reading decision(s) preserved\n- ${pkg.sceneLocalExcluded.length} scene-local role(s) explicitly excluded from series continuity\n- ${pkg.voiceContinuity.lockedCount} series voice assignment(s) locked\n- ${pkg.voiceContinuity.pendingSeriesCharacterKeys.length} voice assignment(s) pending\n- 0 provider calls performed\n\n## Series character map\n\n| Character | Role | Policy | Series key |\n| --- | --- | --- | --- |\n${rows}\n\n## Scene-local roles excluded\n\n${excluded}\n\n## Safety policy\n\nSeries identity and pronunciation conflicts fail closed. Scene-local extras never become permanent series cast. A locked series voice cannot be silently replaced; recasting requires an explicit override and reason.\n\n## Next action\n\nCast Narrator and primary roles, then persist those approved voices as series voice locks before Book Two production.\n`;
}

export function renderSeriesCharacterCsv(pkg) {
  const escape = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const header = ['series_character_key','canonical_name','role','continuity_policy','aliases','source_mentions','source_confidence','provisional'];
  const rows = pkg.characters.map((row) => [row.seriesCharacterKey,row.canonicalName,row.role,row.continuityPolicy,(row.aliases ?? []).join(' | '),row.sourceMentions,row.sourceConfidence ?? '',row.provisional ? 'yes' : 'no']);
  return [header, ...rows].map((row) => row.map(escape).join(',')).join('\n') + '\n';
}

export function renderSeriesPronunciationCsv(pkg) {
  const escape = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const header = ['term','spoken_as','language','case_sensitive','mode','source'];
  const explicit = pkg.pronunciations.explicitRules.map((row) => [row.term,row.spokenAs,row.language,row.caseSensitive ? 'yes' : 'no','explicit-rule',row.source]);
  const standard = pkg.pronunciations.standardReadings.map((row) => [row.term,'',row.language,'no','standard-reading',row.source]);
  return [header, ...explicit, ...standard].map((row) => row.map(escape).join(',')).join('\n') + '\n';
}
