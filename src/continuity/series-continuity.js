import { normalizeIdentity, normalizeTerm, uniqueText } from '../bible/normalization.js';
import { sha256, stableJson } from '../core/hash.js';

export const SERIES_CONTINUITY_RELEASE = '0.12.1';
export const SERIES_CONTINUITY_SCHEMA_VERSION = 2;

const freeze = (value) => Object.freeze(value);
const SYMMETRIC_RELATIONSHIP_KINDS = new Set([
  'partner', 'romantic-partner', 'spouse', 'ex-partner', 'former-partner', 'ex-spouse', 'boyfriend', 'girlfriend', 'fiance', 'fiancee',
  'friend', 'sibling', 'roommate', 'colleague', 'coworker', 'co-worker', 'cohost', 'co-host'
]);

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

function normalizeRelationshipKind(value) {
  return text(value).toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function relationshipPairKey(fromSeriesCharacterKey, toSeriesCharacterKey) {
  return [text(fromSeriesCharacterKey), text(toSeriesCharacterKey)].sort().join('::');
}

function relationshipEndpoints(fromSeriesCharacterKey, toSeriesCharacterKey, kind) {
  const from = text(fromSeriesCharacterKey);
  const to = text(toSeriesCharacterKey);
  const normalizedKind = normalizeRelationshipKind(kind);
  if (SYMMETRIC_RELATIONSHIP_KINDS.has(normalizedKind)) {
    return [from, to].sort();
  }
  return [from, to];
}

function relationshipAuditSnapshot(row) {
  if (!row) return null;
  return {
    relationshipKey: row.relationshipKey,
    fromSeriesCharacterKey: row.fromSeriesCharacterKey,
    toSeriesCharacterKey: row.toSeriesCharacterKey,
    kind: row.kind,
    label: row.label ?? null,
    approvedBy: row.approvedBy ?? null,
    source: row.source ?? null,
    revision: row.revision ?? 1
  };
}

function voiceAuditSnapshot(row) {
  if (!row) return null;
  return {
    seriesCharacterKey: row.seriesCharacterKey,
    provider: row.provider,
    providerVoiceId: row.providerVoiceId,
    approvedBy: row.approvedBy ?? null,
    safetyScore: row.safetyScore ?? null,
    revision: row.revision ?? 1
  };
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

function buildRelationshipRecord({
  fromSeriesCharacterKey,
  toSeriesCharacterKey,
  kind,
  label = null,
  notes = null,
  approvedBy = 'source-audio-bible',
  source = 'source-audio-bible',
  override = false,
  overrideReason = null,
  revision = 1,
  history = []
}) {
  const normalizedKind = normalizeRelationshipKind(kind);
  if (!normalizedKind) throw new Error('series relationship requires kind');
  const [from, to] = relationshipEndpoints(fromSeriesCharacterKey, toSeriesCharacterKey, normalizedKind);
  if (!from || !to) throw new Error('series relationship requires both character keys');
  if (from === to) throw new Error('series relationship cannot point to the same character');
  return freeze({
    relationshipKey: relationshipPairKey(from, to),
    fromSeriesCharacterKey: from,
    toSeriesCharacterKey: to,
    kind: normalizedKind,
    label: text(label) || null,
    notes: text(notes) || null,
    locked: true,
    approvedBy: text(approvedBy) || 'operator',
    source: text(source) || 'operator-confirmed',
    revision: Number.isInteger(revision) && revision > 0 ? revision : 1,
    override: Boolean(override),
    overrideReason: override ? text(overrideReason) || null : null,
    history: freeze(clone(history) ?? [])
  });
}

function buildRelationshipContinuity(prep, characterKeys) {
  const sourceById = new Map((prep.snapshot?.characters ?? []).map((row) => [row.id, continuityKeyForCharacter(row)]));
  const allowed = new Set(characterKeys);
  const byPair = new Map();
  for (const row of prep.snapshot?.relationships ?? []) {
    const fromSeriesCharacterKey = sourceById.get(row.fromCharacterId);
    const toSeriesCharacterKey = sourceById.get(row.toCharacterId);
    if (!fromSeriesCharacterKey || !toSeriesCharacterKey || !allowed.has(fromSeriesCharacterKey) || !allowed.has(toSeriesCharacterKey)) continue;
    const record = buildRelationshipRecord({
      fromSeriesCharacterKey,
      toSeriesCharacterKey,
      kind: row.kind,
      label: row.label,
      notes: row.notes,
      approvedBy: 'source-audio-bible',
      source: 'source-audio-bible'
    });
    const existing = byPair.get(record.relationshipKey);
    if (existing && (existing.kind !== record.kind || existing.fromSeriesCharacterKey !== record.fromSeriesCharacterKey || existing.toSeriesCharacterKey !== record.toSeriesCharacterKey)) {
      throw new Error(`conflicting source relationships for ${record.relationshipKey}`);
    }
    byPair.set(record.relationshipKey, record);
  }
  return [...byPair.values()].sort((a, b) => a.relationshipKey.localeCompare(b.relationshipKey));
}

function packagePayloadForDigest(pkg) {
  const { digest: _digest, ...payload } = pkg;
  return payload;
}

export function computeSeriesContinuityDigest(pkg) {
  return sha256(stableJson(packagePayloadForDigest(pkg)));
}

function recomputeDerivedPackage(base) {
  const next = clone(base);
  const assignments = [...(next.voiceContinuity?.assignments ?? [])].sort((a, b) => a.seriesCharacterKey.localeCompare(b.seriesCharacterKey));
  const pendingSeriesCharacterKeys = next.characters
    .filter((row) => row.continuityPolicy !== 'reference-only' && !assignments.some((x) => x.seriesCharacterKey === row.seriesCharacterKey))
    .map((row) => row.seriesCharacterKey);
  const requiredVoiceKeys = next.characters
    .filter((row) => row.continuityPolicy === 'required')
    .map((row) => row.seriesCharacterKey);
  const lockedRequiredVoiceKeys = requiredVoiceKeys.filter((key) => assignments.some((row) => row.seriesCharacterKey === key));
  const pendingRequiredVoiceKeys = requiredVoiceKeys.filter((key) => !lockedRequiredVoiceKeys.includes(key));
  const relationships = [...(next.relationships ?? [])].sort((a, b) => a.relationshipKey.localeCompare(b.relationshipKey));

  next.voiceContinuity = {
    assignments,
    lockedCount: assignments.length,
    pendingSeriesCharacterKeys
  };
  next.relationships = relationships;
  next.relationshipContinuity = {
    lockedCount: relationships.length,
    sourceLockedCount: relationships.filter((row) => row.source === 'source-audio-bible').length,
    operatorConfirmedCount: relationships.filter((row) => row.source === 'operator-confirmed').length,
    overrideCount: relationships.filter((row) => row.override).length
  };
  next.seriesLock = {
    status: pendingRequiredVoiceKeys.length === 0 ? 'SERIES_CORE_LOCKED' : 'OPEN_FOR_CASTING',
    requiredVoiceKeys,
    lockedRequiredVoiceKeys,
    pendingRequiredVoiceKeys,
    relationshipLockCount: relationships.length,
    identityDigestProtected: true,
    pronunciationDigestProtected: true,
    relationshipDigestProtected: true,
    voiceRecastProtection: true
  };
  next.gates = {
    ...(next.gates ?? {}),
    seriesPackageReady: true,
    relationshipContinuityReady: true,
    coreVoicesLocked: pendingRequiredVoiceKeys.length === 0,
    paidGenerationArmed: false
  };
  return next;
}

function finalizePackage(payload) {
  const derived = recomputeDerivedPackage(payload);
  return deepFreeze({ ...derived, digest: computeSeriesContinuityDigest(derived) });
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
    voiceContinuity: freeze({ assignments: freeze([]) }),
    policy: freeze({
      narratorAndPrimary: 'required',
      supportingAndNamedMinor: 'carry-forward',
      provisionalGenericRoles: 'reference-only',
      sceneLocalRoles: 'excluded',
      pronunciationConflicts: 'fail-closed',
      relationshipConflicts: 'fail-closed-when-explicitly-observed',
      relationshipChange: 'explicit-override-required',
      voiceRecast: 'explicit-override-required'
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
  return finalizePackage(payload);
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

function resolveNextSnapshotSeriesKey(seriesPackage, snapshotCharacter) {
  const explicit = text(snapshotCharacter?.seriesCharacterKey);
  if (explicit && seriesPackage.characters.some((row) => row.seriesCharacterKey === explicit)) return explicit;
  const matches = nextCharacterMatches(seriesPackage, snapshotCharacter);
  return matches.length === 1 ? matches[0].seriesCharacterKey : null;
}

function compareRelationshipContinuity(seriesPackage, nextPrep) {
  const nextSnapshotCharacters = nextPrep.snapshot?.characters ?? [];
  const keyById = new Map(nextSnapshotCharacters.map((row) => [row.id, resolveNextSnapshotSeriesKey(seriesPackage, row)]));
  const nextRelationships = (nextPrep.snapshot?.relationships ?? []).flatMap((row) => {
    const from = keyById.get(row.fromCharacterId);
    const to = keyById.get(row.toCharacterId);
    if (!from || !to || from === to || !text(row.kind)) return [];
    return [{
      relationshipKey: relationshipPairKey(from, to),
      fromSeriesCharacterKey: from,
      toSeriesCharacterKey: to,
      kind: normalizeRelationshipKind(row.kind),
      label: text(row.label) || null
    }];
  });
  const nextByPair = new Map();
  for (const row of nextRelationships) {
    const list = nextByPair.get(row.relationshipKey) ?? [];
    list.push(row);
    nextByPair.set(row.relationshipKey, list);
  }

  const matched = [];
  const conflicts = [];
  const unobserved = [];
  for (const locked of seriesPackage.relationships ?? []) {
    const observed = nextByPair.get(locked.relationshipKey) ?? [];
    if (observed.length === 0) {
      unobserved.push(freeze({ relationshipKey: locked.relationshipKey, kind: locked.kind }));
      continue;
    }
    const exact = observed.find((row) => row.kind === locked.kind);
    if (exact) {
      matched.push(freeze({ relationshipKey: locked.relationshipKey, kind: locked.kind }));
      continue;
    }
    conflicts.push(freeze({
      relationshipKey: locked.relationshipKey,
      seriesKind: locked.kind,
      nextBookKinds: freeze(uniqueText(observed.map((row) => row.kind))),
      fromSeriesCharacterKey: locked.fromSeriesCharacterKey,
      toSeriesCharacterKey: locked.toSeriesCharacterKey
    }));
  }

  const lockedPairs = new Set((seriesPackage.relationships ?? []).map((row) => row.relationshipKey));
  const newRelationships = nextRelationships
    .filter((row) => !lockedPairs.has(row.relationshipKey))
    .map((row) => freeze(row));
  return freeze({
    lockedSeriesRelationships: (seriesPackage.relationships ?? []).length,
    observedMatches: freeze(matched),
    conflicts: freeze(conflicts),
    unobserved: freeze(unobserved),
    newRelationships: freeze(newRelationships)
  });
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

  const relationship = compareRelationshipContinuity(seriesPackage, nextPrep);
  const voiceLocks = seriesPackage.voiceContinuity?.assignments ?? [];
  const blockers = identityConflicts.length + pronunciationConflicts.length + relationship.conflicts.length;
  const status = blockers > 0 ? 'BLOCKED' : (missingRequiredCharacters.length > 0 || roleDrift.length > 0 ? 'REVIEW' : 'PASS');
  return deepFreeze({
    schemaVersion: 2,
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
    relationship,
    voiceContinuity: freeze({ lockedAssignments: voiceLocks.length, pendingSeriesCharacterKeys: freeze(seriesPackage.voiceContinuity?.pendingSeriesCharacterKeys ?? []) }),
    seriesLock: clone(seriesPackage.seriesLock),
    sceneLocalRoleCount: (nextPrep.sceneLocalRoles ?? []).length,
    gates: freeze({
      identitySafe: identityConflicts.length === 0,
      pronunciationSafe: pronunciationConflicts.length === 0,
      relationshipSafe: relationship.conflicts.length === 0,
      requiredCharactersPresent: missingRequiredCharacters.length === 0,
      paidGenerationArmed: false
    }),
    nextAction: status === 'PASS'
      ? 'Continuity match passed. Inherit the series Audio Bible, relationship locks and approved voice assignments.'
      : status === 'REVIEW'
        ? 'Review required-character or role drift before inheriting next-book continuity.'
        : 'Resolve identity, pronunciation or relationship conflicts before production.'
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
  const cleanProvider = text(provider);
  const cleanVoiceId = text(providerVoiceId);
  const cleanApprovedBy = text(approvedBy);
  if (!cleanProvider || !cleanVoiceId) throw new Error('series voice lock requires provider and providerVoiceId');
  if (!cleanApprovedBy) throw new Error('series voice lock requires approvedBy');
  const numericSafetyScore = safetyScore == null || safetyScore === '' ? null : Number(safetyScore);
  if (numericSafetyScore != null && (!Number.isFinite(numericSafetyScore) || numericSafetyScore < 0 || numericSafetyScore > 100)) {
    throw new Error('series voice lock safetyScore must be between 0 and 100');
  }
  const current = seriesPackage.voiceContinuity?.assignments?.find((row) => row.seriesCharacterKey === seriesCharacterKey);
  if (current && current.provider === cleanProvider && current.providerVoiceId === cleanVoiceId) return seriesPackage;
  if (current && !override) throw new Error(`series voice for ${seriesCharacterKey} is locked; explicit override is required`);
  if (override && !text(reason)) throw new Error('series voice override requires a reason');

  const assignments = (seriesPackage.voiceContinuity?.assignments ?? []).filter((row) => row.seriesCharacterKey !== seriesCharacterKey);
  const history = current ? [...(current.history ?? []), voiceAuditSnapshot(current)] : [];
  assignments.push(freeze({
    seriesCharacterKey,
    provider: cleanProvider,
    providerVoiceId: cleanVoiceId,
    approvedBy: cleanApprovedBy,
    safetyScore: numericSafetyScore,
    locked: true,
    revision: current ? (current.revision ?? 1) + 1 : 1,
    override: Boolean(override),
    overrideReason: override ? text(reason) : null,
    history: freeze(history)
  }));

  const { digest: _oldDigest, ...base } = seriesPackage;
  const next = {
    ...clone(base),
    voiceContinuity: { assignments }
  };
  return finalizePackage(next);
}

export function withSeriesRelationshipLock(seriesPackage, {
  fromSeriesCharacterKey,
  toSeriesCharacterKey,
  kind,
  label = null,
  notes = null,
  approvedBy = 'operator',
  override = false,
  reason = null
}) {
  const check = verifySeriesContinuityPackage(seriesPackage);
  if (!check.valid) throw new Error(`invalid Series Continuity package: ${check.reason}`);
  const from = seriesPackage.characters.find((row) => row.seriesCharacterKey === fromSeriesCharacterKey);
  const to = seriesPackage.characters.find((row) => row.seriesCharacterKey === toSeriesCharacterKey);
  if (!from) throw new Error(`unknown series character key: ${fromSeriesCharacterKey}`);
  if (!to) throw new Error(`unknown series character key: ${toSeriesCharacterKey}`);
  if (from.seriesCharacterKey === to.seriesCharacterKey) throw new Error('series relationship cannot point to the same character');
  if (!text(kind)) throw new Error('series relationship lock requires kind');
  if (!text(approvedBy)) throw new Error('series relationship lock requires approvedBy');

  const pairKey = relationshipPairKey(from.seriesCharacterKey, to.seriesCharacterKey);
  const current = (seriesPackage.relationships ?? []).find((row) => row.relationshipKey === pairKey);
  const [canonicalFrom, canonicalTo] = relationshipEndpoints(from.seriesCharacterKey, to.seriesCharacterKey, kind);
  const normalizedKind = normalizeRelationshipKind(kind);
  const same = current
    && current.kind === normalizedKind
    && current.fromSeriesCharacterKey === canonicalFrom
    && current.toSeriesCharacterKey === canonicalTo
    && (current.label ?? null) === (text(label) || null);
  if (same) return seriesPackage;
  if (current && !override) throw new Error(`series relationship for ${pairKey} is locked; explicit override is required`);
  if (override && !text(reason)) throw new Error('series relationship override requires a reason');

  const relationships = (seriesPackage.relationships ?? []).filter((row) => row.relationshipKey !== pairKey);
  const history = current ? [...(current.history ?? []), relationshipAuditSnapshot(current)] : [];
  relationships.push(buildRelationshipRecord({
    fromSeriesCharacterKey: canonicalFrom,
    toSeriesCharacterKey: canonicalTo,
    kind: normalizedKind,
    label,
    notes,
    approvedBy,
    source: 'operator-confirmed',
    override: Boolean(current && override),
    overrideReason: current && override ? reason : null,
    revision: current ? (current.revision ?? 1) + 1 : 1,
    history
  }));

  const { digest: _oldDigest, ...base } = seriesPackage;
  return finalizePackage({ ...clone(base), relationships });
}

export function withSeriesRelationshipGroupLock(seriesPackage, {
  members,
  kind = 'partner',
  label = null,
  notes = null,
  approvedBy = 'operator',
  override = false,
  reason = null
}) {
  const keys = uniqueText(Array.isArray(members) ? members : String(members ?? '').split(',').map((x) => x.trim())).filter(Boolean);
  if (keys.length < 2) throw new Error('relationship group lock requires at least two member keys');
  let next = seriesPackage;
  for (let i = 0; i < keys.length; i += 1) {
    for (let j = i + 1; j < keys.length; j += 1) {
      next = withSeriesRelationshipLock(next, {
        fromSeriesCharacterKey: keys[i],
        toSeriesCharacterKey: keys[j],
        kind,
        label,
        notes,
        approvedBy,
        override,
        reason
      });
    }
  }
  return next;
}

export function renderSeriesContinuityMarkdown(pkg) {
  const rows = pkg.characters.map((row) => `| ${row.canonicalName} | ${row.role} | ${row.continuityPolicy} | ${row.seriesCharacterKey} |`).join('\n');
  const relationships = pkg.relationships.length
    ? pkg.relationships.map((row) => `- ${row.fromSeriesCharacterKey} ↔ ${row.toSeriesCharacterKey}: **${row.kind}**${row.label ? ` — ${row.label}` : ''} (${row.source}, rev ${row.revision})`).join('\n')
    : '- None locked yet';
  const excluded = pkg.sceneLocalExcluded.length
    ? pkg.sceneLocalExcluded.map((row) => `- ${row.canonicalName}${row.chapterOrder != null ? ` — Chapter ${row.chapterOrder}` : ''}`).join('\n')
    : '- None';
  return `# Series Continuity\n\n**Release:** ${pkg.release}\n**Status:** ${pkg.status}\n**Series:** ${pkg.series.title}\n**Source book:** ${pkg.sourceBook.title}\n**Source Audio Bible:** LOCKED\n**Series core lock:** ${pkg.seriesLock.status}\n\n## Continuity promoted\n\n- ${pkg.characters.length} permanent role(s) preserved\n- ${pkg.characters.filter((x) => x.continuityPolicy === 'required').length} required series identity role(s)\n- ${pkg.characters.filter((x) => x.continuityPolicy === 'carry-forward').length} carry-forward role(s)\n- ${pkg.characters.filter((x) => x.continuityPolicy === 'reference-only').length} reference-only role(s)\n- ${pkg.pronunciations.explicitRules.length} explicit pronunciation rule(s) preserved\n- ${pkg.pronunciations.standardReadings.length} standard reading decision(s) preserved\n- ${pkg.relationshipContinuity.lockedCount} relationship truth lock(s)\n- ${pkg.sceneLocalExcluded.length} scene-local role(s) explicitly excluded from series continuity\n- ${pkg.voiceContinuity.lockedCount} series voice assignment(s) locked\n- ${pkg.voiceContinuity.pendingSeriesCharacterKeys.length} voice assignment(s) pending\n- ${pkg.seriesLock.pendingRequiredVoiceKeys.length} required core voice lock(s) pending\n- 0 provider calls performed\n\n## Series character map\n\n| Character | Role | Policy | Series key |\n| --- | --- | --- | --- |\n${rows}\n\n## Locked relationships\n\n${relationships}\n\n## Scene-local roles excluded\n\n${excluded}\n\n## Safety policy\n\nSeries identity, pronunciation and explicit relationship conflicts fail closed. A relationship that is merely absent from a future book is not treated as a contradiction. Scene-local extras never become permanent series cast. Locked relationships and voices cannot be silently replaced; changes require an explicit override and reason, and prior truth is retained in audit history.\n\n## Next action\n\n${pkg.seriesLock.status === 'SERIES_CORE_LOCKED' ? 'Series core voices are locked. Compare the next book against identity, pronunciation, relationship and voice continuity before production.' : 'Cast Narrator and primary roles, then persist those approved voices as series voice locks. Add operator-confirmed relationship locks for durable story truth that was not encoded in the source Audio Bible.'}\n`;
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

export function renderSeriesRelationshipCsv(pkg) {
  const escape = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const header = ['relationship_key','from_series_character_key','to_series_character_key','kind','label','locked','approved_by','source','revision','override','override_reason'];
  const rows = (pkg.relationships ?? []).map((row) => [
    row.relationshipKey,row.fromSeriesCharacterKey,row.toSeriesCharacterKey,row.kind,row.label ?? '',row.locked ? 'yes' : 'no',row.approvedBy,row.source,row.revision,row.override ? 'yes' : 'no',row.overrideReason ?? ''
  ]);
  return [header, ...rows].map((row) => row.map(escape).join(',')).join('\n') + '\n';
}
