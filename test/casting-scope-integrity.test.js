import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryStore } from '../src/repositories/in-memory-store.js';
import { normalizeVoiceProfile } from '../src/casting/voice-profile.js';
import { CastingRoomService } from '../src/services/casting-room-service.js';

const safeVoice = (voiceId = 'voice-safe') => normalizeVoiceProfile({
  voice_id: voiceId,
  public_owner_id: 'owner-1',
  name: `Safe Voice ${voiceId}`,
  category: 'professional',
  language: 'en',
  notice_period_days: 365,
  preview_url: 'https://example.test/preview.mp3',
  live_moderation_enabled: false,
  verified_languages: [{ language: 'en', locale: 'en-US', model_id: 'eleven_multilingual_v2' }]
}, { provider: 'elevenlabs', source: 'voice-library' });

function scopeFixture() {
  const store = new InMemoryStore();
  const records = [
    { id: 'project-1', type: 'project', name: 'Scope Integrity Project' },
    { id: 'series-a', type: 'series', projectId: 'project-1', title: 'Series A' },
    { id: 'series-b', type: 'series', projectId: 'project-1', title: 'Series B' },
    { id: 'book-1', type: 'book', projectId: 'project-1', title: 'Book One' },
    { id: 'book-2', type: 'book', projectId: 'project-1', title: 'Book Two' },
    {
      id: 'series-bible-a', type: 'audio_bible', projectId: 'project-1', name: 'Series A Bible',
      scope: 'series', seriesId: 'series-a', bookId: null, parentBibleId: null
    },
    {
      id: 'series-bible-b', type: 'audio_bible', projectId: 'project-1', name: 'Series B Bible',
      scope: 'series', seriesId: 'series-b', bookId: null, parentBibleId: null
    },
    {
      id: 'book-bible-1', type: 'audio_bible', projectId: 'project-1', name: 'Book One Bible',
      scope: 'book', seriesId: 'series-a', bookId: 'book-1', parentBibleId: 'series-bible-a'
    },
    {
      id: 'book-bible-2', type: 'audio_bible', projectId: 'project-1', name: 'Book Two Bible',
      scope: 'book', seriesId: 'series-a', bookId: 'book-2', parentBibleId: 'series-bible-a'
    },
    {
      id: 'book-one-only-character', type: 'character', projectId: 'project-1', bibleId: 'book-bible-1',
      canonicalName: 'Book One Only', aliases: [], role: 'supporting'
    },
    {
      id: 'series-a-character', type: 'character', projectId: 'project-1', bibleId: 'series-bible-a',
      canonicalName: 'Series A Character', aliases: [], role: 'primary'
    }
  ];
  records.forEach((record) => store.put(record));
  return { store, room: new CastingRoomService(store) };
}

test('hostile: Book 1-only character cannot be staged for Book 2 inside the same project', () => {
  const { room, store } = scopeFixture();
  assert.throws(() => room.stageCandidate({
    projectId: 'project-1',
    seriesId: 'series-a',
    bookId: 'book-2',
    characterId: 'book-one-only-character',
    voice: safeVoice('book-crossing')
  }), /not visible to this book/);
  assert.equal(store.list('voice_candidate').length, 0);
});

test('hostile: Series A character cannot be locked into Series B inside the same project', () => {
  const { room, store } = scopeFixture();
  const candidate = room.stageCandidate({
    projectId: 'project-1',
    seriesId: 'series-a',
    characterId: 'series-a-character',
    voice: safeVoice('series-crossing')
  });
  assert.throws(() => room.lockCast({
    projectId: 'project-1',
    seriesId: 'series-b',
    characterId: 'series-a-character',
    candidateId: candidate.id,
    scope: 'series'
  }), /does not belong to this series/);
  assert.equal(store.list('voice_assignment').length, 0);
});

test('hostile: book-scoped cast lock requires bookId and cannot create an orphan assignment', () => {
  const { room, store } = scopeFixture();
  const candidate = room.stageCandidate({
    projectId: 'project-1',
    seriesId: 'series-a',
    bookId: 'book-1',
    characterId: 'book-one-only-character',
    voice: safeVoice('missing-book-id')
  });
  assert.throws(() => room.lockCast({
    projectId: 'project-1',
    seriesId: 'series-a',
    characterId: 'book-one-only-character',
    candidateId: candidate.id,
    scope: 'book'
  }), /book cast lock requires bookId/);
  assert.equal(store.list('voice_assignment').length, 0);
  assert.equal(room.resolveCast({
    projectId: 'project-1',
    seriesId: 'series-a',
    bookId: 'book-1',
    characterId: 'book-one-only-character'
  }), null);
});

test('regression: inherited series character remains valid for a book that inherits that series Bible', () => {
  const { room } = scopeFixture();
  const candidate = room.stageCandidate({
    projectId: 'project-1',
    seriesId: 'series-a',
    bookId: 'book-2',
    characterId: 'series-a-character',
    voice: safeVoice('valid-inheritance')
  });
  const assignment = room.lockCast({
    projectId: 'project-1',
    seriesId: 'series-a',
    bookId: 'book-2',
    characterId: 'series-a-character',
    candidateId: candidate.id,
    scope: 'book'
  });
  assert.equal(assignment.bookId, 'book-2');
  assert.equal(room.resolveCast({
    projectId: 'project-1',
    seriesId: 'series-a',
    bookId: 'book-2',
    characterId: 'series-a-character'
  }).assignment.id, assignment.id);
});
