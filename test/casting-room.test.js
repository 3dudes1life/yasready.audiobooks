import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryStore } from '../src/repositories/in-memory-store.js';
import { CostLedger } from '../src/core/cost-ledger.js';
import { ElevenLabsProvider } from '../src/providers/elevenlabs-provider.js';
import { normalizeVoiceProfile, scoreSeriesSafety } from '../src/casting/voice-profile.js';
import { CastingRoomService } from '../src/services/casting-room-service.js';

const safeVoice = (overrides = {}) => normalizeVoiceProfile({
  voice_id: 'voice-safe', public_owner_id: 'owner-1', name: 'Safe Voice', category: 'professional',
  language: 'en', notice_period_days: 365, preview_url: 'https://example.test/preview.mp3',
  live_moderation_enabled: false, verified_languages: [{ language: 'en', locale: 'en-US', model_id: 'eleven_multilingual_v2' }],
  ...overrides
}, { provider: 'elevenlabs', source: 'voice-library' });

test('normalizes current ElevenLabs shared voice metadata', () => {
  const voice = safeVoice();
  assert.equal(voice.providerVoiceId, 'voice-safe');
  assert.equal(voice.noticePeriodDays, 365);
  assert.equal(voice.verifiedLanguages[0].locale, 'en-US');
});

test('series safety strongly penalizes a voice with no notice period', () => {
  const safe = scoreSeriesSafety(safeVoice());
  const risky = scoreSeriesSafety(safeVoice({ voice_id: 'risky', notice_period_days: 0, category: 'generated' }));
  assert.ok(safe.score > risky.score);
  assert.ok(risky.warnings.some((item) => item.includes('disappear')));
});

test('scheduled removal caps the safety score', () => {
  const future = Math.floor(Date.now() / 1000) + 86400 * 40;
  const score = scoreSeriesSafety(safeVoice({ disable_at_unix: future }));
  assert.ok(score.score <= 20);
  assert.ok(score.warnings.some((item) => item.includes('scheduled')));
});

test('ElevenLabs search maps filters to shared voice API without spending', async () => {
  let requestedUrl = '';
  const provider = new ElevenLabsProvider({
    fetchImpl: async (url) => {
      requestedUrl = String(url);
      return { ok: true, status: 200, json: async () => ({ voices: [{ voice_id: 'v1', name: 'One', notice_period_days: 365 }], has_more: false, total_count: 1 }) };
    }
  });
  const result = await provider.searchVoices({ language: 'en', minNoticePeriodDays: 180, includeCustomRates: false, includeLiveModerated: false });
  assert.equal(result.voices[0].providerVoiceId, 'v1');
  assert.match(requestedUrl, /\/v1\/shared-voices\?/);
  assert.match(requestedUrl, /min_notice_period_days=180/);
});

test('provider refuses paid render without an API key', async () => {
  const provider = new ElevenLabsProvider({ fetchImpl: async () => { throw new Error('must not fetch'); } });
  await assert.rejects(() => provider.render({ voiceId: 'v', text: 'hello' }), /API_KEY/);
});

test('audition planner estimates total spend before rendering', async () => {
  const store = new InMemoryStore();
  const room = new CastingRoomService(store);
  const candidate = room.stageCandidate({ projectId: 'p', seriesId: 's', characterId: 'michael', voice: safeVoice() });
  const plan = room.createAuditionPlan({ projectId: 'p', characterId: 'michael', candidateIds: [candidate.id], scripts: [{ label: 'Neutral', text: '1234567890' }, { label: 'Emotion', text: 'abcdefghij' }], maxSpendUsd: 0.01 });
  const provider = { estimateCost: async ({ text }) => ({ amountUsd: text.length / 1000 * 0.1, characters: text.length, model: 'x' }) };
  const estimate = await room.estimateAudition(plan.id, { elevenlabs: provider });
  assert.equal(estimate.lines.length, 2);
  assert.ok(estimate.withinBudget);
});

test('audition rendering fails closed when estimate exceeds budget', async () => {
  const store = new InMemoryStore();
  const room = new CastingRoomService(store);
  const candidate = room.stageCandidate({ projectId: 'p', characterId: 'michael', voice: safeVoice() });
  const plan = room.createAuditionPlan({ projectId: 'p', characterId: 'michael', candidateIds: [candidate.id], scripts: [{ text: 'hello' }], maxSpendUsd: 0.01 });
  const provider = { estimateCost: async () => ({ amountUsd: 1, characters: 5, model: 'x' }), render: async () => { throw new Error('must not render'); } };
  await assert.rejects(() => room.renderAudition(plan.id, { providers: { elevenlabs: provider }, assetSink: async () => ({}) }), /exceeds/);
});

test('identical audition render is reused instead of paid twice', async () => {
  const store = new InMemoryStore();
  const room = new CastingRoomService(store);
  const ledger = new CostLedger();
  const candidate = room.stageCandidate({ projectId: 'p', characterId: 'michael', voice: safeVoice() });
  const plan = room.createAuditionPlan({ projectId: 'p', characterId: 'michael', candidateIds: [candidate.id], scripts: [{ text: 'hello there' }], maxSpendUsd: 1 });
  let renders = 0;
  const provider = {
    estimateCost: async ({ text }) => ({ amountUsd: 0.001, characters: text.length, model: 'x' }),
    render: async () => { renders += 1; return { audio: new Uint8Array([1]), mediaType: 'audio/mpeg' }; }
  };
  const args = { providers: { elevenlabs: provider }, ledger, assetSink: async () => ({ storageLocator: `memory://${renders}` }) };
  await room.renderAudition(plan.id, args);
  await room.renderAudition(plan.id, args);
  assert.equal(renders, 1);
  assert.equal(ledger.total('p'), 0.001);
});

test('series cast lock rejects unsafe voices unless override is explicit and reasoned', () => {
  const store = new InMemoryStore();
  const room = new CastingRoomService(store, { minimumSeriesSafety: 70 });
  const candidate = room.stageCandidate({ projectId: 'p', seriesId: 's', characterId: 'michael', voice: safeVoice({ voice_id: 'bad', notice_period_days: 0, category: 'generated', verified_languages: [] }) });
  assert.throws(() => room.lockCast({ projectId: 'p', seriesId: 's', characterId: 'michael', candidateId: candidate.id, scope: 'series' }), /blocked/);
  assert.throws(() => room.lockCast({ projectId: 'p', seriesId: 's', characterId: 'michael', candidateId: candidate.id, scope: 'series', overrideRisk: true }), /reason/);
  const assignment = room.lockCast({ projectId: 'p', seriesId: 's', characterId: 'michael', candidateId: candidate.id, scope: 'series', overrideRisk: true, reason: 'Author owns this custom voice' });
  assert.equal(assignment.locked, true);
});

test('book cast override wins over inherited series cast', () => {
  const store = new InMemoryStore();
  const room = new CastingRoomService(store);
  const seriesCandidate = room.stageCandidate({ projectId: 'p', seriesId: 's', characterId: 'michael', voice: safeVoice({ voice_id: 'series-v' }) });
  const bookCandidate = room.stageCandidate({ projectId: 'p', seriesId: 's', bookId: 'b2', characterId: 'michael', voice: safeVoice({ voice_id: 'book-v' }) });
  room.lockCast({ projectId: 'p', seriesId: 's', characterId: 'michael', candidateId: seriesCandidate.id, scope: 'series' });
  room.lockCast({ projectId: 'p', seriesId: 's', bookId: 'b2', characterId: 'michael', candidateId: bookCandidate.id, scope: 'book' });
  assert.equal(room.resolveCast({ projectId: 'p', seriesId: 's', bookId: 'b2', characterId: 'michael' }).assignment.providerVoiceId, 'book-v');
  assert.equal(room.resolveCast({ projectId: 'p', seriesId: 's', bookId: 'b1', characterId: 'michael' }).assignment.providerVoiceId, 'series-v');
});

test('locked casting cannot be silently recast', () => {
  const store = new InMemoryStore();
  const room = new CastingRoomService(store);
  const a = room.stageCandidate({ projectId: 'p', seriesId: 's', characterId: 'michael', voice: safeVoice({ voice_id: 'a' }) });
  const b = room.stageCandidate({ projectId: 'p', seriesId: 's', characterId: 'michael', voice: safeVoice({ voice_id: 'b' }) });
  const lock = room.lockCast({ projectId: 'p', seriesId: 's', characterId: 'michael', candidateId: a.id, scope: 'series' });
  assert.throws(() => room.lockCast({ projectId: 'p', seriesId: 's', characterId: 'michael', candidateId: b.id, scope: 'series' }), /locked/);
  room.unlockCast(lock.id, { reason: 'Approved recast test' });
  const newLock = room.lockCast({ projectId: 'p', seriesId: 's', characterId: 'michael', candidateId: b.id, scope: 'series' });
  assert.equal(newLock.providerVoiceId, 'b');
});
