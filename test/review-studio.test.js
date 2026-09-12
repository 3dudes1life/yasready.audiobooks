import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryStore } from '../src/repositories/in-memory-store.js';
import { ReviewStudioService } from '../src/services/review-studio-service.js';

function readyJob(store, id, asset = { storageLocator: `private://${id}.mp3`, mediaType: 'audio/mpeg' }) {
  return store.put(Object.freeze({ id, type: 'production_job', status: 'ready', asset, estimatedCostUsd: 1 }));
}

function setup({ productionEngine = null } = {}) {
  const store = new InMemoryStore();
  const studio = new ReviewStudioService(store, { productionEngine });
  const session = studio.createSession({ projectId: 'p1', bookId: 'b1', productionPlanId: 'prod1' });
  const chapter = studio.openChapter(session.id, { chapterId: 'c1', order: 1, title: 'Chapter One' });
  return { store, studio, session, chapter };
}

function registerTimeline(studio, chapter, take, suffix = '') {
  return studio.registerTimeline(chapter.id, take.id, [
    { regionKey: 'r1', order: 1, canonicalText: `First line${suffix}`, startMs: 0, endMs: 1000 },
    { regionKey: 'r2', order: 2, canonicalText: `Second line${suffix}`, startMs: 1000, endMs: 2200 }
  ]);
}

test('review session is idempotent per production plan', () => {
  const { studio, session } = setup();
  assert.equal(studio.createSession({ projectId: 'p1', bookId: 'b1', productionPlanId: 'prod1' }).id, session.id);
});

test('registerTake only accepts ready production jobs and auto labels A/B/C', () => {
  const { store, studio, chapter } = setup();
  store.put(Object.freeze({ id: 'bad', type: 'production_job', status: 'queued', asset: { storageLocator: 'x' } }));
  assert.throws(() => studio.registerTake(chapter.id, { jobId: 'bad' }), /only ready/);
  readyJob(store, 'j1'); readyJob(store, 'j2'); readyJob(store, 'j3');
  assert.equal(studio.registerTake(chapter.id, { jobId: 'j1' }).label, 'A');
  assert.equal(studio.registerTake(chapter.id, { jobId: 'j2' }).label, 'B');
  assert.equal(studio.registerTake(chapter.id, { jobId: 'j3' }).label, 'C');
});

test('registerTake is idempotent for the same production job', () => {
  const { store, studio, chapter } = setup(); readyJob(store, 'j1');
  const a = studio.registerTake(chapter.id, { jobId: 'j1' });
  const b = studio.registerTake(chapter.id, { jobId: 'j1' });
  assert.equal(a.id, b.id);
});

test('review takes refuse raw audio bytes', () => {
  const { store, studio, chapter } = setup(); readyJob(store, 'j1', { storageLocator: 'private://j1', audio: new Uint8Array([1]) });
  assert.throws(() => studio.registerTake(chapter.id, { jobId: 'j1' }), /asset references/);
});

test('timeline rejects overlaps and take duration overflow', () => {
  const { store, studio, chapter } = setup(); readyJob(store, 'j1');
  const take = studio.registerTake(chapter.id, { jobId: 'j1', durationMs: 2000 });
  assert.throws(() => studio.registerTimeline(chapter.id, take.id, [
    { regionKey: 'a', canonicalText: 'A', startMs: 0, endMs: 1200 },
    { regionKey: 'b', canonicalText: 'B', startMs: 1000, endMs: 1500 }
  ]), /overlap/);
  assert.throws(() => studio.registerTimeline(chapter.id, take.id, [
    { regionKey: 'a', canonicalText: 'A', startMs: 0, endMs: 2100 }
  ]), /exceeds take duration/);
});

test('same canonical region may have timing on multiple takes but text cannot drift', () => {
  const { store, studio, chapter } = setup(); readyJob(store, 'j1'); readyJob(store, 'j2');
  const a = studio.registerTake(chapter.id, { jobId: 'j1' });
  const b = studio.registerTake(chapter.id, { jobId: 'j2' });
  registerTimeline(studio, chapter, a);
  registerTimeline(studio, chapter, b);
  assert.throws(() => studio.registerTimeline(chapter.id, b.id, [
    { regionKey: 'r1', canonicalText: 'Different text', startMs: 0, endMs: 900 }
  ]), /canonical text mismatch/);
});

test('approving a region requires synchronized timing for selected take', () => {
  const { store, studio, chapter } = setup(); readyJob(store, 'j1'); readyJob(store, 'j2');
  const a = studio.registerTake(chapter.id, { jobId: 'j1' });
  const b = studio.registerTake(chapter.id, { jobId: 'j2' });
  registerTimeline(studio, chapter, a);
  const region = store.list('review_region')[0];
  assert.throws(() => studio.approveRegion(region.id, { takeId: b.id, reviewer: 'William' }), /no synchronized timing/);
  assert.equal(studio.approveRegion(region.id, { takeId: a.id, reviewer: 'William' }).status, 'approved');
});

test('rejecting a take records reason and creates regeneration request without rendering', () => {
  const { store, studio, chapter } = setup(); readyJob(store, 'j1');
  const take = studio.registerTake(chapter.id, { jobId: 'j1' }); registerTimeline(studio, chapter, take);
  const region = store.list('review_region')[0];
  assert.throws(() => studio.rejectTake(region.id, { takeId: take.id, reviewer: 'William', reason: '' }), /requires a reason/);
  const result = studio.rejectTake(region.id, { takeId: take.id, reviewer: 'William', reason: 'Too flat' });
  assert.equal(result.regeneration.status, 'requested');
  assert.equal(store.list('production_job').length, 1);
});

test('queueRegeneration delegates to Production Engine but never renders', () => {
  let called = 0;
  const engine = { requestRegeneration(jobId, { reason }) { called += 1; return { id: `regen-${jobId}`, reason }; } };
  const { store, studio, chapter } = setup({ productionEngine: engine }); readyJob(store, 'j1');
  const take = studio.registerTake(chapter.id, { jobId: 'j1' }); registerTimeline(studio, chapter, take);
  const region = store.list('review_region')[0];
  const { regeneration } = studio.rejectTake(region.id, { takeId: take.id, reviewer: 'William', reason: 'Wrong emphasis' });
  const queued = studio.queueRegeneration(regeneration.id);
  assert.equal(queued.status, 'queued'); assert.equal(queued.generatedJobId, 'regen-j1'); assert.equal(called, 1);
});

test('chapter approval is blocked until every canonical region has a selected approved take', () => {
  const { store, studio, chapter } = setup(); readyJob(store, 'j1');
  const take = studio.registerTake(chapter.id, { jobId: 'j1' }); registerTimeline(studio, chapter, take);
  const regions = store.list('review_region');
  studio.approveRegion(regions[0].id, { takeId: take.id, reviewer: 'William' });
  assert.throws(() => studio.approveChapter(chapter.id, { reviewer: 'William' }), /every region/);
  studio.approveRegion(regions[1].id, { takeId: take.id, reviewer: 'William' });
  assert.equal(studio.approveChapter(chapter.id, { reviewer: 'William' }).status, 'approved');
});

test('chapter approval locks selected takes and regions against silent overwrite', () => {
  const { store, studio, chapter } = setup(); readyJob(store, 'j1');
  const take = studio.registerTake(chapter.id, { jobId: 'j1' }); registerTimeline(studio, chapter, take);
  for (const region of store.list('review_region')) studio.approveRegion(region.id, { takeId: take.id, reviewer: 'William' });
  studio.approveChapter(chapter.id, { reviewer: 'William' });
  assert.equal(store.get('review_take', take.id).locked, true);
  assert.throws(() => studio.updateTakePresentation(take.id, { waveformLocator: 'changed' }), /chapter review is locked|review take is locked/);
});

test('unlocking an approved chapter requires audit reason and permits revised selections', () => {
  const { store, studio, chapter } = setup(); readyJob(store, 'j1');
  const take = studio.registerTake(chapter.id, { jobId: 'j1' }); registerTimeline(studio, chapter, take);
  for (const region of store.list('review_region')) studio.approveRegion(region.id, { takeId: take.id, reviewer: 'William' });
  studio.approveChapter(chapter.id, { reviewer: 'William' });
  assert.throws(() => studio.unlockChapter(chapter.id, { reviewer: 'William', reason: '' }), /requires reviewer and reason/);
  const unlocked = studio.unlockChapter(chapter.id, { reviewer: 'William', reason: 'Compare regenerated line' });
  assert.equal(unlocked.locked, false); assert.equal(unlocked.revision, 2);
});

test('chapter progress and takeMatrix expose Review Studio UI state', () => {
  const { store, studio, chapter } = setup(); readyJob(store, 'j1');
  const take = studio.registerTake(chapter.id, { jobId: 'j1', waveformLocator: 'private://waveform/j1.json' }); registerTimeline(studio, chapter, take);
  const regions = store.list('review_region'); studio.approveRegion(regions[0].id, { takeId: take.id, reviewer: 'William' });
  const matrix = studio.takeMatrix(chapter.id);
  assert.equal(matrix.takes[0].label, 'A'); assert.equal(matrix.regions.length, 2); assert.equal(matrix.timings.length, 2); assert.equal(matrix.progress.completionPct, 50);
});

test('session cannot lock until every chapter is approved', () => {
  const { store, studio, session, chapter } = setup();
  assert.throws(() => studio.lockSession(session.id, { reviewer: 'William' }), /every chapter/);
  readyJob(store, 'j1'); const take = studio.registerTake(chapter.id, { jobId: 'j1' }); registerTimeline(studio, chapter, take);
  for (const region of store.list('review_region')) studio.approveRegion(region.id, { takeId: take.id, reviewer: 'William' });
  studio.approveChapter(chapter.id, { reviewer: 'William' });
  assert.equal(studio.lockSession(session.id, { reviewer: 'William' }).status, 'approved');
});

test('locked session blocks new chapters until explicitly unlocked', () => {
  const { store, studio, session, chapter } = setup(); readyJob(store, 'j1');
  const take = studio.registerTake(chapter.id, { jobId: 'j1' }); registerTimeline(studio, chapter, take);
  for (const region of store.list('review_region')) studio.approveRegion(region.id, { takeId: take.id, reviewer: 'William' });
  studio.approveChapter(chapter.id, { reviewer: 'William' }); studio.lockSession(session.id, { reviewer: 'William' });
  assert.throws(() => studio.openChapter(session.id, { chapterId: 'c2' }), /session is locked/);
  studio.unlockSession(session.id, { reviewer: 'William', reason: 'Add corrected chapter' });
  assert.equal(studio.openChapter(session.id, { chapterId: 'c2' }).chapterId, 'c2');
});
