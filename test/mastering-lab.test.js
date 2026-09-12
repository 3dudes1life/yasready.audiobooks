import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryStore } from '../src/repositories/in-memory-store.js';
import { getMasteringProfile, evaluateMasterAgainstProfile, safeSectionFileName } from '../src/mastering/profiles.js';
import { parseFfmpegAnalysis, parseLoudnormJson } from '../src/mastering/ffmpeg-adapter.js';
import { MasteringLabService } from '../src/services/mastering-lab-service.js';

function seedApproved(store) {
  const session = store.put(Object.freeze({ id: 's1', type: 'review_session', projectId: 'p1', bookId: 'b1', status: 'approved', locked: true }));
  const chapter = store.put(Object.freeze({ id: 'cr1', type: 'chapter_review', sessionId: 's1', projectId: 'p1', bookId: 'b1', chapterId: 'c1', order: 0, title: 'Chapter 1', status: 'approved', locked: true }));
  const take = store.put(Object.freeze({ id: 't1', type: 'review_take', sessionId: 's1', chapterReviewId: 'cr1', chapterId: 'c1', jobId: 'j1', asset: Object.freeze({ storageLocator: 's3://bucket/take.mp3' }), locked: true }));
  const region = store.put(Object.freeze({ id: 'r1', type: 'review_region', sessionId: 's1', chapterReviewId: 'cr1', chapterId: 'c1', order: 0, canonicalTextHash: 'hash', status: 'approved', selectedTakeId: 't1', locked: true }));
  store.put(Object.freeze({ id: 'rt1', type: 'review_timing', sessionId: 's1', chapterReviewId: 'cr1', chapterId: 'c1', takeId: 't1', regionId: 'r1', startMs: 100, endMs: 2100 }));
  store.put(Object.freeze({ id: 'q1', type: 'qa_run', projectId: 'p1', bookId: 'b1', reviewSessionId: 's1', status: 'approved', locked: true }));
  return { session, chapter, take, region };
}

const qaService = { gateTake: (takeId) => ({ takeId, canApprove: true, status: 'pass' }) };

function makeService(store, extras = {}) {
  return new MasteringLabService(store, { qaService, ...extras });
}

function createPlan(service) {
  return service.createPlan({ projectId: 'p1', bookId: 'b1', reviewSessionId: 's1', qaRunId: 'q1', profile: 'acx-2026', title: 'Book', author: 'Author', narrators: ['Narrator'] });
}

test('ACX profile encodes current core technical rules', () => {
  const p = getMasteringProfile('acx-2026');
  assert.equal(p.output.sampleRateHz, 44100);
  assert.equal(p.output.bitrateKbps, 192);
  assert.equal(p.output.cbr, true);
  assert.equal(p.loudness.rmsMinDb, -23);
  assert.equal(p.loudness.rmsMaxDb, -18);
  assert.equal(p.loudness.maxPeakDb, -3);
  assert.equal(p.loudness.maxNoiseFloorDb, -60);
});

test('profile evaluation passes compliant ACX measurements', () => {
  const result = evaluateMasterAgainstProfile({ rmsDb: -20.5, peakDb: -3.5, noiseFloorDb: -70, leadingSilenceMs: 1200, trailingSilenceMs: 1500, sampleRateHz: 44100, bitrateKbps: 192 }, 'acx-2026');
  assert.equal(result.passed, true);
  assert.equal(result.issues.length, 0);
});

test('profile evaluation catches loudness, peak, noise and spacing failures', () => {
  const result = evaluateMasterAgainstProfile({ rmsDb: -25, peakDb: -1, noiseFloorDb: -50, leadingSilenceMs: 200, trailingSilenceMs: 6000, sampleRateHz: 44100, bitrateKbps: 192 }, 'acx-2026');
  assert.equal(result.passed, false);
  assert.deepEqual(new Set(result.issues.map((x) => x.code)), new Set(['rms-too-low', 'peak-too-high', 'noise-floor-too-high', 'leading-silence-short', 'trailing-silence-long']));
});

test('section filenames are ASCII-safe', () => {
  assert.equal(safeSectionFileName(7, 'Capítulo 7 — ¡Hola!', 'mp3'), '007-Capitulo-7-Hola.mp3');
});

test('FFmpeg analysis parser captures final audio measurements', () => {
  const stderr = 'RMS level dB: -20.4\nPeak level dB: -3.6\nNoise floor dB: -71.2\nsilence_start: 0\nsilence_end: 1.2 | silence_duration: 1.2\nsilence_start: 9.0';
  const a = parseFfmpegAnalysis(stderr, { durationSec: 10, sampleRateHz: 44100, bitrateKbps: 192 });
  assert.equal(a.rmsDb, -20.4);
  assert.equal(a.peakDb, -3.6);
  assert.equal(a.noiseFloorDb, -71.2);
  assert.equal(a.leadingSilenceMs, 1200);
  assert.equal(a.trailingSilenceMs, 1000);
});

test('loudnorm JSON parser extracts first-pass measurements', () => {
  const parsed = parseLoudnormJson('noise\n{\n"input_i":"-21.00",\n"input_tp":"-4.10",\n"input_lra":"3.10",\n"input_thresh":"-31.00",\n"target_offset":"0.40"\n}\n');
  assert.equal(parsed.input_i, '-21.00');
  assert.equal(parsed.target_offset, '0.40');
});

test('preflight fails closed when Review Studio is not approved', () => {
  const store = new InMemoryStore();
  seedApproved(store);
  store.update('review_session', 's1', (row) => Object.freeze({ ...row, locked: false }));
  const service = makeService(store);
  const plan = createPlan(service);
  assert.throws(() => service.preflight(plan.id), /approved, locked Review Studio/);
});

test('preflight fails closed when QA is not approved', () => {
  const store = new InMemoryStore();
  seedApproved(store);
  store.update('qa_run', 'q1', (row) => Object.freeze({ ...row, status: 'review_required', locked: false }));
  const service = makeService(store);
  const plan = createPlan(service);
  assert.throws(() => service.preflight(plan.id), /approved, locked QA/);
});

test('preflight preserves region timing and requires credit assets', () => {
  const store = new InMemoryStore();
  seedApproved(store);
  const service = makeService(store);
  const plan = createPlan(service);
  const preflight = service.preflight(plan.id);
  assert.equal(preflight.chapters[0].sources[0].startMs, 100);
  assert.equal(preflight.chapters[0].sources[0].endMs, 2100);
  assert.deepEqual(preflight.missingCredits, ['opening', 'closing']);
  assert.equal(preflight.readyToArm, false);
});

test('credit scripts contain title author and narrator', () => {
  const store = new InMemoryStore(); seedApproved(store);
  const service = makeService(store);
  const credits = service.creditScripts({ title: 'Book', author: 'Author', narrators: ['A', 'B'] });
  assert.match(credits.opening, /Book/);
  assert.match(credits.opening, /Author/);
  assert.match(credits.opening, /A and B/);
});

test('arming requires required credit audio', () => {
  const store = new InMemoryStore(); seedApproved(store);
  const service = makeService(store);
  const plan = createPlan(service);
  assert.throws(() => service.arm(plan.id, { approvedBy: 'Will' }), /credit audio/);
  service.attachCreditAsset(plan.id, 'opening', { storageLocator: 's3://credits/open.mp3' });
  service.attachCreditAsset(plan.id, 'closing', { storageLocator: 's3://credits/close.mp3' });
  assert.equal(service.arm(plan.id, { approvedBy: 'Will' }).armed, true);
});

test('masterChapter assembles only selected approved regions and creates a passed master reference', async () => {
  const store = new InMemoryStore(); seedApproved(store);
  const calls = [];
  const good = { rmsDb: -20.5, peakDb: -3.5, noiseFloorDb: -70, leadingSilenceMs: 1200, trailingSilenceMs: 1200, sampleRateHz: 44100, bitrateKbps: 192, durationSec: 10 };
  const ffmpeg = {
    healthCheck: async () => ({ ok: true }),
    extract: async (input, options) => { calls.push(['extract', input, options.startMs, options.endMs]); return options.outputPath; },
    concat: async (inputs, output) => { calls.push(['concat', inputs.length]); return output; },
    analyze: async () => good,
    master: async (input, output) => { calls.push(['master', input]); return { outputPath: output }; }
  };
  const service = makeService(store, {
    ffmpeg,
    assetMaterializer: async (asset) => `/tmp/${asset.storageLocator.split('/').at(-1)}`,
    assetSink: async (_file, context) => ({ storageLocator: `s3://masters/${context.section.outputFileName}` })
  });
  const plan = createPlan(service);
  service.attachCreditAsset(plan.id, 'opening', { storageLocator: 's3://credits/open.mp3' });
  service.attachCreditAsset(plan.id, 'closing', { storageLocator: 's3://credits/close.mp3' });
  service.arm(plan.id, { approvedBy: 'Will' });
  const mastered = await service.masterChapter(plan.id, 'cr1');
  assert.equal(mastered.status, 'passed');
  assert.equal(mastered.asset.storageLocator, 's3://masters/001-Chapter-1.mp3');
  assert.deepEqual(calls[0].slice(0, 4), ['extract', '/tmp/take.mp3', 100, 2100]);
});

test('masterChapter fails closed when finished audio violates profile', async () => {
  const store = new InMemoryStore(); seedApproved(store);
  let analysisCall = 0;
  const ffmpeg = {
    healthCheck: async () => ({ ok: true }),
    extract: async (_i, o) => o.outputPath,
    concat: async (_i, o) => o,
    master: async (_i, o) => ({ outputPath: o }),
    analyze: async () => (++analysisCall === 1
      ? { rmsDb: -20, peakDb: -4, noiseFloorDb: -70, leadingSilenceMs: 1000, trailingSilenceMs: 1000, sampleRateHz: 44100, bitrateKbps: 192 }
      : { rmsDb: -26, peakDb: -1, noiseFloorDb: -50, leadingSilenceMs: 200, trailingSilenceMs: 6000, sampleRateHz: 44100, bitrateKbps: 192 })
  };
  const service = makeService(store, { ffmpeg, assetMaterializer: async () => '/tmp/in.mp3', assetSink: async () => ({ storageLocator: 's3://never' }) });
  const plan = createPlan(service);
  service.attachCreditAsset(plan.id, 'opening', { storageLocator: 's3://credits/open.mp3' });
  service.attachCreditAsset(plan.id, 'closing', { storageLocator: 's3://credits/close.mp3' });
  service.arm(plan.id, { approvedBy: 'Will' });
  await assert.rejects(() => service.masterChapter(plan.id, 'cr1'), /failed acx-2026/);
  assert.equal(store.list('mastering_section', (x) => x.status === 'failed').length, 1);
});


test('masterCredit masters required credits as separate profile-checked files', async () => {
  const store = new InMemoryStore(); seedApproved(store);
  const good = { rmsDb: -20.5, peakDb: -3.5, noiseFloorDb: -70, leadingSilenceMs: 1200, trailingSilenceMs: 1200, sampleRateHz: 44100, bitrateKbps: 192, durationSec: 5 };
  const ffmpeg = {
    healthCheck: async () => ({ ok: true }),
    analyze: async () => good,
    master: async (_input, output) => ({ outputPath: output })
  };
  const service = makeService(store, {
    ffmpeg,
    assetMaterializer: async () => '/tmp/credit.mp3',
    assetSink: async (_file, context) => ({ storageLocator: `s3://masters/${context.kind}-credits.mp3` })
  });
  const plan = createPlan(service);
  service.attachCreditAsset(plan.id, 'opening', { storageLocator: 's3://credits/open.mp3' });
  service.attachCreditAsset(plan.id, 'closing', { storageLocator: 's3://credits/close.mp3' });
  service.arm(plan.id, { approvedBy: 'Will' });
  const credit = await service.masterCredit(plan.id, 'opening');
  assert.equal(credit.status, 'passed');
  assert.equal(credit.kind, 'opening');
  assert.equal(credit.asset.storageLocator, 's3://masters/opening-credits.mp3');
});

test('finalize requires every chapter to pass', () => {
  const store = new InMemoryStore(); seedApproved(store);
  const service = makeService(store);
  const plan = createPlan(service);
  service.attachCreditAsset(plan.id, 'opening', { storageLocator: 's3://credits/open.mp3' });
  service.attachCreditAsset(plan.id, 'closing', { storageLocator: 's3://credits/close.mp3' });
  service.arm(plan.id, { approvedBy: 'Will' });
  assert.throws(() => service.finalize(plan.id, { reviewer: 'Will' }), /every chapter and required credit file passes/);
  store.put(Object.freeze({ id: 'm1', type: 'mastering_section', planId: plan.id, chapterReviewId: 'cr1', status: 'passed' }));
  store.put(Object.freeze({ id: 'mc1', type: 'mastering_credit_section', planId: plan.id, kind: 'opening', status: 'passed' }));
  store.put(Object.freeze({ id: 'mc2', type: 'mastering_credit_section', planId: plan.id, kind: 'closing', status: 'passed' }));
  const final = service.finalize(plan.id, { reviewer: 'Will' });
  assert.equal(final.status, 'mastered');
  assert.equal(final.locked, true);
  assert.equal(final.armed, false);
});

test('Mastering Lab never accepts raw audio bytes as durable assets', () => {
  const store = new InMemoryStore(); seedApproved(store);
  const service = makeService(store);
  const plan = createPlan(service);
  assert.throws(() => service.attachCreditAsset(plan.id, 'opening', { audio: new Uint8Array([1, 2]) }), /asset references/);
});
