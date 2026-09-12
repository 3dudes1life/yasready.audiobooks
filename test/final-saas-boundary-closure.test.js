import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  AudiobookDirectorService,
  CastingRoomService,
  ContinuityQaService,
  DistributionBrainService,
  InMemoryStore,
  MasteringLabService,
  ProductionEngineService,
  ReviewStudioService,
  buildOperatorFlowStatus
} from '../src/index.js';

function put(store, row) { return store.put(Object.freeze(row)); }

function voiceProfile(id = 'voice-safe') {
  return {
    provider: 'elevenlabs', providerVoiceId: id, name: id, category: 'professional', language: 'en',
    noticePeriodDays: 365, verifiedLanguages: [{ language: 'en', locale: 'en-US', modelId: 'eleven_multilingual_v2' }],
    scheduledDisableAt: null, liveModerationEnabled: false, customRates: null, source: 'test'
  };
}

function seedCanonicalDirector(store, { projectId = 'p1', bookId = 'b1', prefix = '' } = {}) {
  put(store, { id: projectId, type: 'project', name: projectId, status: 'analyzed', locked: false });
  put(store, { id: bookId, type: 'book', projectId, title: `Book ${prefix}` });
  put(store, { id: `ch${prefix || '1'}`, type: 'chapter', projectId, bookId, order: 1, title: 'Chapter 1' });
  put(store, { id: `sc${prefix || '1'}`, type: 'scene', projectId, bookId, chapterId: `ch${prefix || '1'}`, order: 1 });
  put(store, { id: `seg${prefix || '1'}`, type: 'segment', projectId, bookId, chapterId: `ch${prefix || '1'}`, sceneId: `sc${prefix || '1'}`, order: 1, text: `Canonical ${prefix || 'one'}.`, kind: 'narration', characterId: null });
  return { chapterId: `ch${prefix || '1'}`, sceneId: `sc${prefix || '1'}`, segmentId: `seg${prefix || '1'}` };
}

function fakeProvider({ failFirst = false, settled = false } = {}) {
  let calls = 0;
  return {
    get calls() { return calls; },
    async estimateCost({ text }) { return { amountUsd: text.length * 0.01, characters: text.length }; },
    async render({ text }) {
      calls += 1;
      if (failFirst && calls === 1) {
        const error = new Error('invalid api key'); error.status = 401; error.providerCode = 'invalid_api_key'; throw error;
      }
      return {
        audio: new Uint8Array([1]), billedCharacters: text.length, requestId: `r${calls}`,
        ...(settled ? { actualCostUsd: text.length * 0.01 } : { estimatedCostUsd: text.length * 0.01 })
      };
    }
  };
}

async function realDirectorProductionHarness({ provider = fakeProvider(), assetSink = async () => ({ storageLocator: 'private://ready.mp3' }), maxAttempts = 1 } = {}) {
  const store = new InMemoryStore();
  const ids = seedCanonicalDirector(store);
  const director = new AudiobookDirectorService(store);
  const dplan = director.createPlan({ projectId: 'p1', bookId: 'b1' });
  const segment = store.get('segment', ids.segmentId);
  const directed = await director.directScene({ planId: dplan.id, chapterId: ids.chapterId, sceneId: ids.sceneId, segments: [segment] });
  director.lockPlan(dplan.id);
  const engine = new ProductionEngineService(store, { directorService: director, providers: { elevenlabs: provider }, assetSink, sleep: async () => {} });
  const pplan = engine.createPlan({ projectId: 'p1', bookId: 'b1', directorPlanId: dplan.id, provider: 'elevenlabs', hardBudgetUsd: 10, maxAttempts });
  const jobs = await engine.planCues(pplan.id, { cueIds: [directed.cues[0].id], resolveVoice: () => ({ providerVoiceId: 'voice-1' }) });
  engine.arm(pplan.id, { approvedBy: 'tester' });
  return { store, director, dplan, engine, pplan, jobs, provider, directed };
}

function distributionFixture() {
  const store = new InMemoryStore();
  put(store, { id: 'm1', type: 'mastering_plan', projectId: 'p1', bookId: 'b1', title: 'Book', author: 'Author', narrators: ['Narrator'], profileId: 'acx-2026', status: 'mastered', locked: true });
  put(store, { id: 'r1', type: 'chapter_review', projectId: 'p1', bookId: 'b1', chapterId: 'c1', order: 0 });
  put(store, { id: 's1', type: 'mastering_section', planId: 'm1', chapterReviewId: 'r1', chapterId: 'c1', title: 'Chapter 1', outputFileName: '001-Chapter-1.mp3', status: 'passed', asset: { locator: 'a1', mediaType: 'audio/mpeg' }, postAnalysis: { durationSec: 600, bitrateKbps: 192, sampleRateHz: 44100, channels: 1 } });
  put(store, { id: 'o1', type: 'mastering_credit_section', planId: 'm1', kind: 'opening', outputFileName: '000-opening-credits.mp3', status: 'passed', asset: { locator: 'open', mediaType: 'audio/mpeg' }, postAnalysis: { durationSec: 8, bitrateKbps: 192, sampleRateHz: 44100, channels: 1 } });
  put(store, { id: 'z1', type: 'mastering_credit_section', planId: 'm1', kind: 'closing', outputFileName: '999-closing-credits.mp3', status: 'passed', asset: { locator: 'close', mediaType: 'audio/mpeg' }, postAnalysis: { durationSec: 10, bitrateKbps: 192, sampleRateHz: 44100, channels: 1 } });
  const service = new DistributionBrainService(store, { clock: () => new Date('2026-09-12T20:00:00Z') });
  const project = service.createProject({ projectId: 'p1', bookId: 'b1', masteringPlanId: 'm1', metadata: { title: 'Book', author: 'Author', narrators: ['Narrator'], language: 'en' }, digitalNarration: false });
  service.confirmRights(project.id, { confirmedBy: 'tester' });
  service.attachCover(project.id, { locator: 'cover', fileName: 'cover.jpg', mediaType: 'image/jpeg', metadata: { width: 3000, height: 3000, format: 'jpg', bytes: 1000000, colorSpace: 'RGB' } });
  const target = service.addTarget(project.id, 'acx-2026');
  return { store, service, project, target };
}

test('Director refuses a real book owned by another project', () => {
  const store = new InMemoryStore();
  put(store, { id: 'p1', type: 'project', name: 'A' }); put(store, { id: 'p2', type: 'project', name: 'B' });
  put(store, { id: 'b2', type: 'book', projectId: 'p2', title: 'Foreign' });
  const director = new AudiobookDirectorService(store);
  assert.throws(() => director.createPlan({ projectId: 'p1', bookId: 'b2' }), /another project/);
});

test('Director refuses foreign canonical scene/segment truth', async () => {
  const store = new InMemoryStore();
  const a = seedCanonicalDirector(store, { projectId: 'p1', bookId: 'b1', prefix: 'a' });
  const b = seedCanonicalDirector(store, { projectId: 'p2', bookId: 'b2', prefix: 'b' });
  const director = new AudiobookDirectorService(store);
  const plan = director.createPlan({ projectId: 'p1', bookId: 'b1' });
  await assert.rejects(() => director.directScene({ planId: plan.id, chapterId: a.chapterId, sceneId: a.sceneId, segments: [store.get('segment', b.segmentId)] }), /another project|canonical manuscript/);
});

test('Director plan lock is transitive and blocks cue mutation until explicit plan unlock', async () => {
  const store = new InMemoryStore(); const ids = seedCanonicalDirector(store);
  const director = new AudiobookDirectorService(store); const plan = director.createPlan({ projectId: 'p1', bookId: 'b1' });
  const directed = await director.directScene({ planId: plan.id, chapterId: ids.chapterId, sceneId: ids.sceneId, segments: [store.get('segment', ids.segmentId)] });
  director.lockPlan(plan.id);
  assert.equal(store.get('director_cue', directed.cues[0].id).locked, true);
  assert.equal(store.get('director_scene', directed.scene.id).locked, true);
  assert.throws(() => director.reviseCue(directed.cues[0].id, { direction: { pace: 'slow' } }, { reason: 'try' }), /plan is locked/);
  director.unlockPlan(plan.id, { reason: 'author revision' });
  assert.equal(store.get('director_cue', directed.cues[0].id).locked, false);
});

test('Casting refuses a real character owned by another project', () => {
  const store = new InMemoryStore();
  put(store, { id: 'p1', type: 'project', name: 'A' }); put(store, { id: 'p2', type: 'project', name: 'B' });
  put(store, { id: 'ab2', type: 'audio_bible', projectId: 'p2', name: 'B', scope: 'book', bookId: 'b2' });
  put(store, { id: 'char2', type: 'character', projectId: 'p2', bibleId: 'ab2', canonicalName: 'Foreign', aliases: [], role: 'primary' });
  const room = new CastingRoomService(store);
  assert.throws(() => room.stageCandidate({ projectId: 'p1', characterId: 'char2', voice: voiceProfile() }), /another project/);
});

test('Review Studio refuses a chapter owned by another project/book', () => {
  const store = new InMemoryStore();
  put(store, { id: 'b1', type: 'book', projectId: 'p1', title: 'A' });
  put(store, { id: 'foreign-ch', type: 'chapter', projectId: 'p2', bookId: 'b2', order: 1, title: 'Foreign' });
  put(store, { id: 'prod', type: 'production_plan', projectId: 'p1', bookId: 'b1' });
  const studio = new ReviewStudioService(store);
  const session = studio.createSession({ projectId: 'p1', bookId: 'b1', productionPlanId: 'prod' });
  assert.throws(() => studio.openChapter(session.id, { chapterId: 'foreign-ch' }), /another project\/book/);
});

test('Production refuses an unlocked real Director plan', async () => {
  const store = new InMemoryStore(); const ids = seedCanonicalDirector(store);
  const director = new AudiobookDirectorService(store); const dp = director.createPlan({ projectId: 'p1', bookId: 'b1' });
  const directed = await director.directScene({ planId: dp.id, chapterId: ids.chapterId, sceneId: ids.sceneId, segments: [store.get('segment', ids.segmentId)] });
  const provider = fakeProvider();
  const engine = new ProductionEngineService(store, { directorService: director, providers: { elevenlabs: provider } });
  const pp = engine.createPlan({ projectId: 'p1', bookId: 'b1', directorPlanId: dp.id, hardBudgetUsd: 10 });
  await assert.rejects(() => engine.planCues(pp.id, { cueIds: [directed.cues[0].id], resolveVoice: () => ({ providerVoiceId: 'v' }) }), /locked Audiobook Director plan/);
});

test('Production refuses to render if Director truth is unlocked after planning', async () => {
  const h = await realDirectorProductionHarness();
  h.director.unlockPlan(h.dplan.id, { reason: 'change direction' });
  await assert.rejects(() => h.engine.renderJob(h.jobs[0].id), /locked Audiobook Director plan|locked director_cue/);
  assert.equal(h.provider.calls, 0);
});

test('Production createPlan rejects a real Director plan from another project', () => {
  const store = new InMemoryStore();
  put(store, { id: 'dp2', type: 'director_plan', projectId: 'p2', bookId: 'b2', locked: true });
  const engine = new ProductionEngineService(store, { directorService: new AudiobookDirectorService(store) });
  assert.throws(() => engine.createPlan({ projectId: 'p1', bookId: 'b1', directorPlanId: 'dp2', hardBudgetUsd: 5 }), /another project\/book/);
});

test('failed provider-render job has an explicit audited requeue path', async () => {
  const provider = fakeProvider({ failFirst: true });
  const h = await realDirectorProductionHarness({ provider, maxAttempts: 1 });
  const failed = await h.engine.renderJob(h.jobs[0].id);
  assert.equal(failed.failureStage, 'provider-render');
  const queued = h.engine.retryFailedJob(failed.id, { approvedBy: 'operator', reason: 'credentials repaired' });
  assert.equal(queued.status, 'queued'); assert.equal(queued.attemptCount, 0); assert.equal(queued.retryHistory.length, 1);
  const ready = await h.engine.renderJob(queued.id);
  assert.equal(ready.status, 'ready'); assert.equal(provider.calls, 2);
});

test('post-billing storage failure cannot silently re-call provider and supports asset recovery', async () => {
  const provider = fakeProvider();
  const h = await realDirectorProductionHarness({ provider, assetSink: async () => { throw new Error('storage down'); } });
  const failed = await h.engine.renderJob(h.jobs[0].id);
  assert.equal(failed.failureStage, 'asset-storage'); assert.equal(provider.calls, 1);
  assert.throws(() => h.engine.retryFailedJob(failed.id, { reason: 'try again' }), /billing boundary/);
  const recovered = h.engine.recoverStoredAsset(failed.id, { asset: { storageLocator: 'private://recovered.mp3' }, approvedBy: 'operator', reason: 'recovered upload from provider response cache' });
  assert.equal(recovered.status, 'ready'); assert.equal(provider.calls, 1); assert.ok(recovered.accountedCostUsd > 0);
});

test('provider-settled spend is distinguished from estimated/accounted spend', async () => {
  const h = await realDirectorProductionHarness({ provider: fakeProvider({ settled: true }) });
  await h.engine.renderJob(h.jobs[0].id);
  const manifest = h.engine.manifest(h.pplan.id);
  assert.ok(manifest.providerSettledSpendUsd > 0);
  assert.equal(manifest.estimatedOrUnsettledSpendUsd, 0);
  assert.equal(manifest.actualSpendUsd, manifest.providerSettledSpendUsd);
  assert.equal(manifest.spendBasis, 'provider-settled');
});

test('QA rejects a real Audio Bible from another project', () => {
  const store = new InMemoryStore();
  put(store, { id: 'p1', type: 'project', name: 'A' });
  put(store, { id: 'session', type: 'review_session', projectId: 'p1', bookId: 'b1', productionPlanId: 'prod', status: 'approved', locked: true });
  put(store, { id: 'foreign-bible', type: 'audio_bible', projectId: 'p2', name: 'B', scope: 'book', bookId: 'b2' });
  const qa = new ContinuityQaService(store);
  assert.throws(() => qa.createRun({ projectId: 'p1', bookId: 'b1', reviewSessionId: 'session', bibleId: 'foreign-bible' }), /another project/);
});

test('QA cannot lock until every selected Review Studio take has exact-run coverage', () => {
  const store = new InMemoryStore();
  put(store, { id: 'session', type: 'review_session', projectId: 'p1', bookId: 'b1', productionPlanId: 'prod', status: 'approved', locked: true });
  put(store, { id: 't1', type: 'review_take', sessionId: 'session', chapterReviewId: 'cr1', jobId: 'j1', asset: { storageLocator: 'x' }, locked: true });
  put(store, { id: 't2', type: 'review_take', sessionId: 'session', chapterReviewId: 'cr1', jobId: 'j2', asset: { storageLocator: 'y' }, locked: true });
  put(store, { id: 'r1', type: 'review_region', sessionId: 'session', chapterReviewId: 'cr1', status: 'approved', selectedTakeId: 't1', locked: true });
  put(store, { id: 'r2', type: 'review_region', sessionId: 'session', chapterReviewId: 'cr1', status: 'approved', selectedTakeId: 't2', locked: true });
  const qa = new ContinuityQaService(store);
  const run = qa.createRun({ projectId: 'p1', bookId: 'b1', reviewSessionId: 'session', productionPlanId: 'prod' });
  put(store, { id: 'qr1', type: 'qa_report', runId: run.id, takeId: 't1', status: 'pass' });
  assert.throws(() => qa.lockRun(run.id, { reviewer: 'tester' }), /incomplete coverage/);
  put(store, { id: 'qr2', type: 'qa_report', runId: run.id, takeId: 't2', status: 'pass' });
  assert.equal(qa.lockRun(run.id, { reviewer: 'tester' }).locked, true);
});

test('Mastering requires QA evidence from its exact QA run even without a QA service adapter', () => {
  const store = new InMemoryStore();
  put(store, { id: 'session', type: 'review_session', projectId: 'p1', bookId: 'b1', productionPlanId: 'prod', status: 'approved', locked: true });
  put(store, { id: 'cr1', type: 'chapter_review', sessionId: 'session', projectId: 'p1', bookId: 'b1', chapterId: 'c1', order: 0, status: 'approved', locked: true });
  put(store, { id: 't1', type: 'review_take', sessionId: 'session', chapterReviewId: 'cr1', chapterId: 'c1', jobId: 'j1', asset: { storageLocator: 'x' }, locked: true });
  put(store, { id: 'r1', type: 'review_region', sessionId: 'session', chapterReviewId: 'cr1', chapterId: 'c1', order: 0, status: 'approved', selectedTakeId: 't1', locked: true, canonicalTextHash: 'h' });
  put(store, { id: 'rt1', type: 'review_timing', sessionId: 'session', chapterReviewId: 'cr1', chapterId: 'c1', takeId: 't1', regionId: 'r1', startMs: 0, endMs: 1000 });
  put(store, { id: 'qa1', type: 'qa_run', projectId: 'p1', bookId: 'b1', reviewSessionId: 'session', productionPlanId: 'prod', status: 'approved', locked: true });
  const mastering = new MasteringLabService(store);
  const plan = mastering.createPlan({ projectId: 'p1', bookId: 'b1', reviewSessionId: 'session', qaRunId: 'qa1', title: 'Book', author: 'Author' });
  assert.throws(() => mastering.preflight(plan.id), /no QA report in the exact mastering QA run/);
});

test('distribution metadata changes immediately invalidate an existing package', () => {
  const { store, service, project, target } = distributionFixture();
  const pkg = service.buildTargetPackage(target.id);
  service.updateMetadata(project.id, { title: 'Changed Title' });
  const current = store.get('distribution_target', target.id);
  assert.equal(current.status, 'stale'); assert.equal(current.packageId, null); assert.equal(current.stalePackageId, pkg.id);
  assert.equal(store.get('distribution_package', pkg.id).status, 'stale');
  assert.throws(() => service.lockProject(project.id, { reviewer: 'tester' }), /current, non-stale package/);
});

test('distribution detects mastering drift by source digest even when mutated outside the service', () => {
  const { store, service, project, target } = distributionFixture();
  service.buildTargetPackage(target.id);
  store.update('mastering_section', 's1', (row) => Object.freeze({ ...row, postAnalysis: { ...row.postAnalysis, durationSec: 601 } }));
  const preflight = service.preflightTarget(target.id);
  assert.equal(preflight.readyToPackage, false);
  assert.ok(preflight.blockers.some((row) => row.code === 'package-stale'));
  assert.equal(store.get('distribution_target', target.id).status, 'stale');
});

test('stale distribution package cannot be exported', async () => {
  const { service, project, target } = distributionFixture();
  const pkg = service.buildTargetPackage(target.id);
  service.updateMetadata(project.id, { subtitle: 'new metadata' });
  await assert.rejects(() => service.exportPackage(pkg.id), /stale/);
});

test('operator flow does not call Director complete when only the plan is locked', () => {
  const store = new InMemoryStore();
  put(store, { id: 'b1', type: 'book', projectId: 'p1' }); put(store, { id: 'ch1', type: 'chapter', projectId: 'p1', bookId: 'b1' });
  put(store, { id: 'ab', type: 'audio_bible', projectId: 'p1', bookId: 'b1', scope: 'book' });
  put(store, { id: 'n', type: 'character', projectId: 'p1', bibleId: 'ab', role: 'narrator' });
  put(store, { id: 'va', type: 'voice_assignment', projectId: 'p1', characterId: 'n', locked: true });
  put(store, { id: 'dp', type: 'director_plan', projectId: 'p1', bookId: 'b1', locked: true });
  put(store, { id: 'cue', type: 'director_cue', projectId: 'p1', planId: 'dp', locked: false });
  const status = buildOperatorFlowStatus(store, 'p1');
  assert.equal(status.currentStage, 'director');
  assert.match(status.stages.find((row) => row.key === 'director').detail, /0\/1/);
});

test('series voice-lock CLI help presents safety score as required', () => {
  let stderr = '';
  try {
    execFileSync(process.execPath, ['src/cli.js', 'series-continuity-lock-voice'], { cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (error) { stderr = String(error.stderr ?? ''); }
  assert.match(stderr, /--safety-score N/);
  assert.doesNotMatch(stderr, /\[--safety-score N\]/);
});


test('Production requires a real Director plan when the project is real', () => {
  const store = new InMemoryStore();
  put(store, { id: 'p1', type: 'project', status: 'analyzed', locked: false });
  put(store, { id: 'b1', type: 'book', projectId: 'p1' });
  const director = new AudiobookDirectorService(store);
  const engine = new ProductionEngineService(store, { directorService: director, providers: {} });
  assert.throws(() => engine.createPlan({ projectId: 'p1', bookId: 'b1', directorPlanId: 'missing-director', hardBudgetUsd: 5 }), /requires an Audiobook Director plan/);
});

test('distribution finalization fails open-to-rebuild when source drift invalidates a locked package', () => {
  const { store, service, project, target } = distributionFixture();
  const pkg = service.buildTargetPackage(target.id);
  store.update('distribution_target', target.id, (row) => Object.freeze({ ...row, status: 'packaged', packageId: pkg.id }));
  service.lockProject(project.id, { reviewer: 'operator' });
  assert.equal(store.get('distribution_project', project.id).locked, true);
  store.update('mastering_section', 's1', (row) => Object.freeze({ ...row, postAnalysis: { ...row.postAnalysis, durationSec: Number(row.postAnalysis.durationSec ?? 10) + 1 } }));
  const check = service.preflightTarget(target.id);
  assert.ok(check.blockers.some((row) => row.code === 'package-stale'));
  const refreshed = store.get('distribution_project', project.id);
  assert.equal(refreshed.locked, false);
  assert.equal(refreshed.status, 'stale');
  assert.match(refreshed.finalizationInvalidationReason, /source digest|distribution truth/i);
});
