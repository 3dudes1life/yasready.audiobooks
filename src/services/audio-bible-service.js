import {
  createAudioBible,
  createCharacter,
  createPronunciation,
  createRelationship,
  createSeries,
  createSpeakerBinding,
  nowIso
} from '../domain/model.js';
import { normalizeIdentity, normalizeTerm, uniqueText } from '../bible/normalization.js';
import { sha256, stableJson } from '../core/hash.js';

function assertRole(role) {
  const allowed = new Set(['narrator', 'primary', 'supporting', 'minor', 'ensemble']);
  if (!allowed.has(role)) throw new Error(`invalid character role: ${role}`);
}

function cleanPerformanceProfile(profile = {}) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
    throw new Error('performanceProfile must be an object');
  }
  return Object.freeze({ ...profile });
}

export class AudioBibleService {
  constructor(store) {
    this.store = store;
  }

  createSeries({ projectId, title, author = null, description = null }) {
    this.#requireProject(projectId);
    return this.store.put(createSeries({ projectId, title, author, description }));
  }

  createBible({ projectId, name, scope = 'book', bookId = null, seriesId = null, parentBibleId = null }) {
    this.#requireProject(projectId);
    if (!['book', 'series'].includes(scope)) throw new Error(`invalid bible scope: ${scope}`);
    if (scope === 'book') {
      const book = this.store.get('book', bookId);
      if (!book || book.projectId !== projectId) throw new Error('book bible requires a book in the same project');
      if (seriesId) {
        const series = this.store.get('series', seriesId);
        if (!series || series.projectId !== projectId) throw new Error('book bible series must belong to the same project');
      }
    }
    if (scope === 'series') {
      const series = this.store.get('series', seriesId);
      if (!series || series.projectId !== projectId) throw new Error('series bible requires a series in the same project');
      if (bookId) throw new Error('series bible cannot be attached to a book');
    }
    if (parentBibleId) {
      const parent = this.#requireBible(parentBibleId);
      if (parent.projectId !== projectId) throw new Error('parent bible must belong to the same project');
      if (scope !== 'book' || parent.scope !== 'series') {
        throw new Error('only a book bible may inherit from a series bible');
      }
      if (seriesId && parent.seriesId !== seriesId) throw new Error('parent bible series does not match');
      seriesId = parent.seriesId;
    }
    return this.store.put(createAudioBible({
      projectId,
      name,
      scope,
      bookId,
      seriesId,
      parentBibleId
    }));
  }

  addCharacter(bibleId, {
    canonicalName,
    aliases = [],
    role = 'supporting',
    pronouns = null,
    description = null,
    performanceProfile = {},
    seriesCharacterKey = null
  }) {
    const bible = this.#requireBible(bibleId);
    assertRole(role);
    const canonical = String(canonicalName ?? '').trim();
    if (!canonical) throw new Error('character requires canonicalName');
    const cleanedAliases = uniqueText(aliases).filter((alias) => normalizeIdentity(alias) !== normalizeIdentity(canonical));
    this.#assertAliasesAvailable(bibleId, [canonical, ...cleanedAliases]);
    const character = this.store.put(createCharacter({
      projectId: bible.projectId,
      bibleId,
      canonicalName: canonical,
      aliases: cleanedAliases,
      role,
      pronouns,
      description,
      performanceProfile: cleanPerformanceProfile(performanceProfile),
      seriesCharacterKey
    }));
    this.#touchBible(bibleId);
    return character;
  }

  addAlias(characterId, alias) {
    const character = this.#requireCharacter(characterId);
    const text = String(alias ?? '').trim();
    if (!text) throw new Error('alias is required');
    if (normalizeIdentity(text) === normalizeIdentity(character.canonicalName)) return character;
    this.#assertAliasesAvailable(character.bibleId, [text], { exceptCharacterId: characterId });
    const aliases = uniqueText([...character.aliases, text]);
    const updated = this.store.update('character', characterId, (current) => ({
      ...current,
      aliases,
      updatedAt: nowIso()
    }));
    this.#touchBible(character.bibleId);
    return updated;
  }

  updateCharacterProfile(characterId, patch = {}) {
    const character = this.#requireCharacter(characterId);
    if ('role' in patch) assertRole(patch.role);
    const updated = this.store.update('character', characterId, (current) => ({
      ...current,
      ...(patch.role !== undefined ? { role: patch.role } : {}),
      ...(patch.pronouns !== undefined ? { pronouns: patch.pronouns } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.performanceProfile !== undefined ? { performanceProfile: cleanPerformanceProfile(patch.performanceProfile) } : {}),
      updatedAt: nowIso()
    }));
    this.#touchBible(character.bibleId);
    return updated;
  }

  addRelationship(bibleId, { fromCharacterId, toCharacterId, kind, label = null, notes = null }) {
    const bible = this.#requireBible(bibleId);
    const from = this.#requireCharacter(fromCharacterId);
    const to = this.#requireCharacter(toCharacterId);
    if (fromCharacterId === toCharacterId) throw new Error('relationship cannot point to the same character');
    const effectiveIds = new Set(this.listCharacters(bibleId).map((row) => row.id));
    if (!effectiveIds.has(from.id) || !effectiveIds.has(to.id)) throw new Error('relationship characters must be visible to the bible');
    const relationshipKind = String(kind ?? '').trim();
    if (!relationshipKind) throw new Error('relationship requires kind');
    const duplicate = this.listRelationships(bibleId).find((row) =>
      row.fromCharacterId === fromCharacterId && row.toCharacterId === toCharacterId && row.kind === relationshipKind
    );
    if (duplicate) return duplicate;
    const record = this.store.put(createRelationship({
      projectId: bible.projectId,
      bibleId,
      fromCharacterId,
      toCharacterId,
      kind: relationshipKind,
      label,
      notes
    }));
    this.#touchBible(bibleId);
    return record;
  }

  addPronunciation(bibleId, {
    term,
    spokenAs,
    notation = 'plain',
    language = 'en',
    caseSensitive = false,
    source = 'author',
    notes = null
  }) {
    const bible = this.#requireBible(bibleId);
    const cleanTerm = String(term ?? '').trim();
    const cleanSpokenAs = String(spokenAs ?? '').trim();
    if (!cleanTerm || !cleanSpokenAs) throw new Error('pronunciation requires term and spokenAs');
    const key = normalizeTerm(cleanTerm, { caseSensitive });
    const localConflict = this.store.list('pronunciation', (row) => row.bibleId === bibleId)
      .find((row) => row.normalizedTerm === key && row.caseSensitive === Boolean(caseSensitive));
    if (localConflict) throw new Error(`pronunciation already exists for: ${cleanTerm}`);
    const record = this.store.put(createPronunciation({
      projectId: bible.projectId,
      bibleId,
      term: cleanTerm,
      normalizedTerm: key,
      spokenAs: cleanSpokenAs,
      notation,
      language,
      caseSensitive: Boolean(caseSensitive),
      source,
      notes
    }));
    this.#touchBible(bibleId);
    return record;
  }

  listCharacters(bibleId) {
    const chain = this.#chain(bibleId).reverse();
    const rows = [];
    for (const bible of chain) {
      rows.push(...this.store.list('character', (row) => row.bibleId === bible.id));
    }
    return Object.freeze(rows);
  }

  listRelationships(bibleId) {
    const visible = new Set(this.#chain(bibleId).map((row) => row.id));
    return Object.freeze(this.store.list('relationship', (row) => visible.has(row.bibleId)));
  }

  listPronunciations(bibleId) {
    const chain = this.#chain(bibleId);
    const seen = new Set();
    const output = [];
    for (const bible of chain) {
      for (const row of this.store.list('pronunciation', (item) => item.bibleId === bible.id)) {
        const key = `${row.caseSensitive ? 'case' : 'fold'}:${row.normalizedTerm}`;
        if (seen.has(key)) continue;
        seen.add(key);
        output.push(row);
      }
    }
    return Object.freeze(output);
  }

  resolveSpeaker(bibleId, candidate) {
    this.#requireBible(bibleId);
    const name = typeof candidate === 'string' ? candidate : candidate?.name;
    const candidateConfidence = typeof candidate === 'object' && candidate?.confidence != null
      ? Number(candidate.confidence) : null;
    const key = normalizeIdentity(name);
    if (!key) return Object.freeze({ status: 'unresolved', reason: 'empty-candidate', candidate: name ?? null });

    const matches = this.listCharacters(bibleId).filter((character) => {
      const identities = [character.canonicalName, ...(character.aliases ?? [])].map(normalizeIdentity);
      return identities.includes(key);
    });
    if (matches.length === 0) {
      return Object.freeze({ status: 'unresolved', reason: 'no-canonical-match', candidate: name });
    }
    if (matches.length > 1) {
      return Object.freeze({ status: 'ambiguous', reason: 'multiple-canonical-matches', candidate: name, characterIds: matches.map((row) => row.id) });
    }
    const character = matches[0];
    const canonicalMatch = normalizeIdentity(character.canonicalName) === key;
    return Object.freeze({
      status: 'resolved',
      candidate: name,
      character,
      matchType: canonicalMatch ? 'canonical' : 'alias',
      confidence: candidateConfidence == null ? (canonicalMatch ? 1 : 0.98) : candidateConfidence,
      evidence: typeof candidate === 'object' ? candidate.evidence ?? null : null
    });
  }

  bindSegmentSpeaker(bibleId, segmentId, { characterId = null, candidate = null, source = 'audio-bible', minConfidence = 0.75 } = {}) {
    const bible = this.#requireBible(bibleId);
    const segment = this.store.get('segment', segmentId);
    if (!segment) throw new Error(`segment ${segmentId} not found`);
    if (segment.projectId !== bible.projectId) throw new Error('segment and bible must belong to the same project');
    if (segment.kind !== 'dialogue') throw new Error('speaker binding is only valid for dialogue segments');

    let character;
    let resolution;
    if (characterId) {
      character = this.#requireCharacter(characterId);
      if (!new Set(this.listCharacters(bibleId).map((row) => row.id)).has(characterId)) {
        throw new Error('character is not visible to this bible');
      }
      resolution = { status: 'resolved', matchType: 'manual', confidence: 1, evidence: source };
    } else {
      resolution = this.resolveSpeaker(bibleId, candidate ?? segment.speakerCandidate);
      if (resolution.status !== 'resolved') return resolution;
      if (resolution.confidence < minConfidence) {
        return Object.freeze({ ...resolution, status: 'review', reason: 'below-confidence-threshold' });
      }
      character = resolution.character;
    }

    const updated = this.store.update('segment', segmentId, (current) => ({
      ...current,
      characterId: character.id,
      speakerResolution: Object.freeze({
        bibleId,
        matchType: resolution.matchType,
        confidence: resolution.confidence,
        evidence: resolution.evidence ?? null,
        resolvedAt: nowIso()
      }),
      updatedAt: nowIso()
    }));
    const binding = this.store.put(createSpeakerBinding({
      projectId: bible.projectId,
      bibleId,
      segmentId,
      characterId: character.id,
      source,
      confidence: resolution.confidence,
      evidence: resolution.evidence ?? null
    }));
    return Object.freeze({ status: 'bound', segment: updated, character, binding });
  }

  resolvePronunciation(bibleId, term) {
    this.#requireBible(bibleId);
    const input = String(term ?? '').trim();
    if (!input) return null;
    for (const rule of this.listPronunciations(bibleId)) {
      const candidate = normalizeTerm(input, { caseSensitive: rule.caseSensitive });
      if (candidate === rule.normalizedTerm) return rule;
    }
    return null;
  }

  snapshot(bibleId) {
    const bible = this.#requireBible(bibleId);
    const chain = this.#chain(bibleId);
    const characters = this.listCharacters(bibleId)
      .map((row) => ({
        id: row.id,
        bibleId: row.bibleId,
        canonicalName: row.canonicalName,
        aliases: [...(row.aliases ?? [])].sort(),
        role: row.role,
        pronouns: row.pronouns,
        description: row.description,
        performanceProfile: row.performanceProfile,
        seriesCharacterKey: row.seriesCharacterKey
      }))
      .sort((a, b) => normalizeIdentity(a.canonicalName).localeCompare(normalizeIdentity(b.canonicalName)));
    const pronunciations = this.listPronunciations(bibleId)
      .map((row) => ({
        bibleId: row.bibleId,
        term: row.term,
        spokenAs: row.spokenAs,
        notation: row.notation,
        language: row.language,
        caseSensitive: row.caseSensitive,
        source: row.source
      }))
      .sort((a, b) => normalizeTerm(a.term).localeCompare(normalizeTerm(b.term)));
    const relationships = this.listRelationships(bibleId)
      .map((row) => ({
        bibleId: row.bibleId,
        fromCharacterId: row.fromCharacterId,
        toCharacterId: row.toCharacterId,
        kind: row.kind,
        label: row.label,
        notes: row.notes
      }))
      .sort((a, b) => `${a.fromCharacterId}:${a.toCharacterId}:${a.kind}`.localeCompare(`${b.fromCharacterId}:${b.toCharacterId}:${b.kind}`));
    const payload = {
      schemaVersion: 3,
      bible: {
        id: bible.id,
        scope: bible.scope,
        bookId: bible.bookId,
        seriesId: bible.seriesId,
        parentBibleId: bible.parentBibleId,
        revision: bible.revision
      },
      inheritance: chain.map((row) => ({ id: row.id, scope: row.scope, revision: row.revision })),
      characters,
      pronunciations,
      relationships
    };
    return Object.freeze({ ...payload, digest: sha256(stableJson(payload)) });
  }

  continuityReport(bibleId) {
    const bible = this.#requireBible(bibleId);
    const characters = this.listCharacters(bibleId);
    const inheritedBibleIds = new Set(this.#chain(bibleId).slice(1).map((row) => row.id));
    const inheritedCharacters = characters.filter((row) => inheritedBibleIds.has(row.bibleId));
    const localCharacters = characters.filter((row) => row.bibleId === bible.id);
    const pronunciations = this.listPronunciations(bibleId);
    return Object.freeze({
      bibleId,
      scope: bible.scope,
      parentBibleId: bible.parentBibleId,
      inheritedCharacters: inheritedCharacters.length,
      localCharacters: localCharacters.length,
      pronunciationRules: pronunciations.length,
      unresolvedDialogueSegments: this.store.list('segment', (row) =>
        row.projectId === bible.projectId &&
        (!bible.bookId || row.bookId === bible.bookId) &&
        row.kind === 'dialogue' && !row.characterId
      ).length,
      digest: this.snapshot(bibleId).digest
    });
  }

  #assertAliasesAvailable(bibleId, identities, { exceptCharacterId = null } = {}) {
    const requested = identities.map((value) => ({ raw: value, key: normalizeIdentity(value) })).filter((row) => row.key);
    const duplicates = new Set();
    for (const row of requested) {
      if (duplicates.has(row.key)) throw new Error(`duplicate alias in character definition: ${row.raw}`);
      duplicates.add(row.key);
    }
    for (const character of this.listCharacters(bibleId)) {
      if (character.id === exceptCharacterId) continue;
      const existing = [character.canonicalName, ...(character.aliases ?? [])].map(normalizeIdentity);
      for (const row of requested) {
        if (existing.includes(row.key)) {
          throw new Error(`identity "${row.raw}" is already assigned to ${character.canonicalName}`);
        }
      }
    }
  }

  #touchBible(bibleId) {
    return this.store.update('audio_bible', bibleId, (current) => ({
      ...current,
      revision: current.revision + 1,
      updatedAt: nowIso()
    }));
  }

  #chain(bibleId) {
    const chain = [];
    const seen = new Set();
    let current = this.#requireBible(bibleId);
    while (current) {
      if (seen.has(current.id)) throw new Error('audio bible inheritance cycle detected');
      seen.add(current.id);
      chain.push(current);
      current = current.parentBibleId ? this.#requireBible(current.parentBibleId) : null;
    }
    return chain;
  }

  #requireProject(projectId) {
    const project = this.store.get('project', projectId);
    if (!project) throw new Error(`project ${projectId} not found`);
    return project;
  }

  #requireBible(bibleId) {
    const bible = this.store.get('audio_bible', bibleId);
    if (!bible) throw new Error(`audio bible ${bibleId} not found`);
    return bible;
  }

  #requireCharacter(characterId) {
    const character = this.store.get('character', characterId);
    if (!character) throw new Error(`character ${characterId} not found`);
    return character;
  }
}
