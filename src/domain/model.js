import { randomUUID } from 'node:crypto';

export const EntityTypes = Object.freeze([
  'project', 'book', 'chapter', 'scene', 'segment', 'character',
  'voice_assignment', 'pronunciation', 'provider', 'generation_request',
  'cost_event', 'approval', 'audio_asset', 'alignment_record', 'master'
]);

export function nowIso(clock = () => new Date()) {
  return clock().toISOString();
}

export function entity(type, fields = {}, { id = randomUUID(), clock } = {}) {
  if (!EntityTypes.includes(type)) throw new Error(`unknown entity type: ${type}`);
  const timestamp = nowIso(clock);
  return Object.freeze({ id, type, createdAt: timestamp, updatedAt: timestamp, ...fields });
}

export function requireFields(record, fields) {
  for (const field of fields) {
    if (record[field] === undefined || record[field] === null || record[field] === '') {
      throw new Error(`${record.type ?? 'record'} requires ${field}`);
    }
  }
  return record;
}

export function createProject({ name, source = 'standalone' }, options) {
  return requireFields(entity('project', {
    name,
    source,
    status: 'draft',
    schemaVersion: 2,
    locked: false
  }, options), ['name']);
}

export function createBook({
  projectId, title, author = null, language = 'en', sourceFormat = null,
  sourceHash = null, manuscriptMetrics = null
}, options) {
  return requireFields(entity('book', {
    projectId, title, author, language, sourceFormat, sourceHash, manuscriptMetrics
  }, options), ['projectId', 'title']);
}

export function createChapter({ projectId, bookId, order, title, textHash = null }, options) {
  return requireFields(entity('chapter', {
    projectId, bookId, order, title, textHash, status: 'draft', locked: false
  }, options), ['projectId', 'bookId', 'order', 'title']);
}

export function createScene({ projectId, bookId, chapterId, order, textHash = null }, options) {
  return requireFields(entity('scene', {
    projectId, bookId, chapterId, order, textHash, status: 'draft', locked: false
  }, options), ['projectId', 'bookId', 'chapterId', 'order']);
}

export function createSegment({
  projectId, bookId, chapterId, sceneId, order, text, kind = 'narration',
  characterId = null, speakerCandidate = null
}, options) {
  return requireFields(entity('segment', {
    projectId, bookId, chapterId, sceneId, order, text, kind, characterId,
    speakerCandidate, status: 'draft', approvedTakeId: null, locked: false
  }, options), ['projectId', 'bookId', 'chapterId', 'sceneId', 'order', 'text']);
}
