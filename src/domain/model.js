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
    schemaVersion: 1,
    locked: false
  }, options), ['name']);
}

export function createBook({ projectId, title, author = null, language = 'en' }, options) {
  return requireFields(entity('book', { projectId, title, author, language }, options), ['projectId', 'title']);
}

export function createSegment({ projectId, bookId, chapterId, sceneId, order, text, kind = 'narration', characterId = null }, options) {
  return requireFields(entity('segment', {
    projectId, bookId, chapterId, sceneId, order, text, kind, characterId,
    status: 'draft', approvedTakeId: null, locked: false
  }, options), ['projectId', 'bookId', 'chapterId', 'sceneId', 'text']);
}
