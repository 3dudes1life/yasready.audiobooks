import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AudiobookDirectorService,
  CastingRoomService,
  ContinuityQaService,
  CostLedger,
  InMemoryStore,
  MasteringLabService,
  MoneyGuardService,
  ProductionEngineService,
  ProjectService,
  SeriesContinuityService,
  buildOperatorFlowStatus,
  buildSeriesContinuityPackage,
  refreshSeriesContinuityPackage,
  verifySeriesContinuityPackage,
  withSeriesRelationshipLock,
  withSeriesVoiceLock
} from '../src/index.js';
import { ReviewStudioService } from '../src/services/review-studio-service.js';

function voiceProfile(id = 'voice-1') {
  return {
    provider: 'elevenlabs', providerVoiceId: id, name: id, category: 'professional', language: 'en',
    noticePeriodDays: 365, verifiedLanguages: [{ language: 'en', locale: 'en-US', modelId: 'eleven_multilingual_v2' }],
    scheduledDisableAt: null, liveModerationEnabled: false, customRates: null, source: 'test'
  };
}

function lockedPrep() {
  return {
    schemaVersion: 7,
    release: '0.11.8',
    status: 'AUDIO_BIBLE_LOCKED',
    providerCallsPerformed: 0,
    book: { id: 'book-1', title: 'Series Book – Story', author: 'Author', language: 'en', sourceHash: 'source-hash' },
    audioBible: { id: 'bible-1', revision: 2, digest: 'digest-1', locked: true, lockRelease: '0.11.8' },
    characterPlan: [
      { canonicalName: 'Narrator', aliases: [], role: 'narrator', seriesCharacterKey: 'narrator', continuityScope: 'book', mentions: 0, averageConfidence: 1 },
      { canonicalName: 'Michael Rawlins', aliases: ['Michael'], role: 'primary', seriesCharacterKey: 'michael-rawlins', continuityScope: 'book', mentions: 20, averageConfidence: 0.98 },
      { canonicalName: 'Juan Delgado', aliases: ['Juan'], role: 'primary', seriesCharacterKey: 'juan-delgado', continuityScope: 'book', mentions: 20, averageConfidence: 0.98 }
    ],
    sceneLocalRoles: [],
    dialogueReview: { needsReview: 0, unresolved: 0 },
    pronunciationReview: { needsConfirmation: 0, candidates: [] },
    continuity: { unresolvedDialogueSegments: 0 },
    gates: { audioBibleLocked: true, productionReady: true },
    snapshot: {
      digest: 'digest-1',
      characters: [
        { id: 'n', canonicalName: 'Narrator', aliases: [], role: 'narrator', seriesCharacterKey: 'narrator', performanceProfile: {} },
        { id: 'm', canonicalName: 'Michael Rawlins', aliases: ['Michael'], role: 'primary', seriesCharacterKey: 'michael-rawlins', performanceProfile: {} },
        { id: 'j', canonicalName: 'Juan Delgado', aliases: ['Juan'], role: 'primary', seriesCharacterKey: 'juan-delgado', performanceProfile: {} }
      ],
      pronunciations: [], relationships: []
    }
  };
}

function seedQaStore() {
  const store = new InMemoryStore();
  store.put(Object.freeze({ id: 'session1', type: 'review_session', projectId: 'p1', bookId: 'b1', productionPlanId: 'prod1', status: 'approved', locked: true }));
  store.put(Object.freeze({ id: 'take1', type: 'review_take', sessionId: 'session1', chapterReviewId: 'cr1', jobId: 'job1', asset: { storageLocator: 'private://take.mp3' } }));
  store.put(Object.freeze({ id: 'job1', type: 'production_job', projectId: 'p1', bookId: 'b1', planId: 'prod1', provider: 'mock', cueId: 'cue1', languageCode: 'en' }));
  store.put(Object.freeze({ id: 'cue1', type: 'director_cue', canonicalText: 'Michael walked home.' }));
  return store;
}

test('production asset reuse is project-scoped and cannot cross tenants', () => {
  const store = new InMemoryStore();
  const director = new AudiobookDirectorService(store);
  const engine = new ProductionEngineService(store, { directorService: director });
  store.put(Object.freeze({ id: 'ready-a', type: 'production_job', projectId: 'project-a', fingerprint: 'same', status: 'ready', asset: { storageLocator: 'private://a.mp3' } }));
  const candidate = { id: 'candidate-b', projectId: 'project-b', fingerprint: 'same', reuseAllowed: true };
  assert.equal(engine.findReusable(candidate), null);
});

test('Casting Room never reuses an audition take from another project', async () => {
  const store = new InMemoryStore();
  const room = new CastingRoomService(store);
  const a = room.stageCandidate({ projectId: 'p1', characterId: 'michael', voice: voiceProfile('same-voice') });
  const b = room.stageCandidate({ projectId: 'p2', characterId: 'michael', voice: voiceProfile('same-voice') });
  const p1 = room.createAuditionPlan({ projectId: 'p1', characterId: 'michael', candidateIds: [a.id], scripts: [{ id: 's', text: 'Same script' }] });
  const p2 = room.createAuditionPlan({ projectId: 'p2', characterId: 'michael', candidateIds: [b.id], scripts: [{ id: 's', text: 'Same script' }] });
  let calls = 0;
  const provider = {
    estimateCost: async () => ({ amountUsd: 0.1, characters: 11 }),
    render: async () => { calls += 1; return { estimatedCostUsd: 0.1, billedCharacters: 11, audio: new Uint8Array([1]) }; }
  };
  await room.renderAudition(p1.id, { providers: { elevenlabs: provider }, assetSink: async () => ({ storageLocator: 'private://p1.mp3' }) });
  const second = await room.renderAudition(p2.id, { providers: { elevenlabs: provider }, assetSink: async () => ({ storageLocator: 'private://p2.mp3' }) });
  assert.equal(calls, 2);
  assert.equal(second[0].projectId, 'p2');
  assert.equal(second[0].asset.storageLocator, 'private://p2.mp3');
});

test('Review Studio refuses a ready job from another project or production plan', () => {
  const store = new InMemoryStore();
  store.put(Object.freeze({ id: 'prod1', type: 'production_plan', projectId: 'p1', bookId: 'b1' }));
  const studio = new ReviewStudioService(store);
  const session = studio.createSession({ projectId: 'p1', bookId: 'b1', productionPlanId: 'prod1' });
  const chapter = studio.openChapter(session.id, { chapterId: 'c1' });
  store.put(Object.freeze({ id: 'foreign', type: 'production_job', projectId: 'p2', bookId: 'b1', planId: 'prod1', status: 'ready', asset: { storageLocator: 'private://foreign.mp3' } }));
  assert.throws(() => studio.registerTake(chapter.id, { jobId: 'foreign' }), /another project\/book\/production plan/);
});

test('Mastering Lab refuses approved upstream records from another project', () => {
  const store = new InMemoryStore();
  store.put(Object.freeze({ id: 's1', type: 'review_session', projectId: 'p2', bookId: 'b1', status: 'approved', locked: true }));
  store.put(Object.freeze({ id: 'q1', type: 'qa_run', projectId: 'p1', bookId: 'b1', reviewSessionId: 's1', status: 'approved', locked: true }));
  const service = new MasteringLabService(store);
  const plan = service.createPlan({ projectId: 'p1', bookId: 'b1', reviewSessionId: 's1', qaRunId: 'q1', title: 'Book', author: 'Author' });
  assert.throws(() => service.preflight(plan.id), /another project\/book/);
});

function productionHarness({ assetSink } = {}) {
  const store = new InMemoryStore();
  const ledger = new CostLedger();
  const money = new MoneyGuardService(store, { ledger });
  const guard = money.createGuard({ projectId: 'p1', hardCapUsd: 10, singleActionApprovalUsd: 0, estimateVarianceRatio: 0 });
  const director = new AudiobookDirectorService(store);
  let providerCalls = 0;
  const provider = {
    estimateCost: async ({ text }) => ({ amountUsd: text.length * 0.01, characters: text.length }),
    render: async ({ text }) => { providerCalls += 1; return { estimatedCostUsd: text.length * 0.01, billedCharacters: text.length, requestId: `req-${providerCalls}`, audio: new Uint8Array([1]) }; }
  };
  store.put(Object.freeze({
    id: 'cue1', type: 'director_cue', projectId: 'p1', planId: 'director1', directorSceneId: 'ds1', sceneId: 's1', segmentId: 'seg1', characterId: 'c1', order: 1,
    canonicalText: 'hello', direction: Object.freeze({ emotion: 'neutral', intensity: 0.1, restraint: 0.9, pace: 'measured', volume: 'normal', tags: [] }), performanceBrief: Object.freeze({ emotion: 'neutral' }), revision: 1, locked: false
  }));
  const engine = new ProductionEngineService(store, {
    directorService: director, providers: { elevenlabs: provider }, ledger, moneyGuard: money,
    assetSink: assetSink ?? (async () => ({ storageLocator: 'private://render.mp3' })), sleep: async () => {}
  });
  const plan = engine.createPlan({ projectId: 'p1', bookId: 'b1', directorPlanId: 'director1', provider: 'elevenlabs', hardBudgetUsd: 5, maxAttempts: 4 });
  return { store, ledger, money, guard, provider, engine, plan, providerCalls: () => providerCalls };
}

test('storage failure after a billable render never re-calls the TTS provider', async () => {
  const h = productionHarness({ assetSink: async () => { throw new Error('network storage timeout'); } });
  const jobs = await h.engine.planCues(h.plan.id, { cueIds: ['cue1'], resolveVoice: () => ({ providerVoiceId: 'voice1' }) });
  h.engine.arm(h.plan.id, { approvedBy: 'operator', moneyGuardId: h.guard.id });
  const result = await h.engine.renderJob(jobs[0].id);
  assert.equal(result.status, 'failed');
  assert.equal(result.failureStage, 'asset-storage');
  assert.equal(h.providerCalls(), 1);
  assert.equal(h.money.report(h.guard.id).providerCallsPerformed, 1);
  assert.ok(result.accountedCostUsd > 0);
  assert.equal(result.actualCostUsd, null);
  assert.equal(result.costBasis, 'provider-billed-characters-estimate');
});

test('Casting Room releases unused Money Guard reservation when storage fails', async () => {
  const store = new InMemoryStore();
  const ledger = new CostLedger();
  const money = new MoneyGuardService(store, { ledger });
  const guard = money.createGuard({ projectId: 'p1', hardCapUsd: 10, singleActionApprovalUsd: 0, estimateVarianceRatio: 0.1 });
  const room = new CastingRoomService(store);
  const candidate = room.stageCandidate({ projectId: 'p1', characterId: 'michael', voice: voiceProfile() });
  const plan = room.createAuditionPlan({ projectId: 'p1', characterId: 'michael', candidateIds: [candidate.id], scripts: [{ text: 'hello' }] });
  const provider = { estimateCost: async () => ({ amountUsd: 1, characters: 5 }), render: async () => ({ estimatedCostUsd: 0.8, billedCharacters: 5, audio: new Uint8Array([1]) }) };
  await assert.rejects(() => room.renderAudition(plan.id, {
    providers: { elevenlabs: provider }, moneyGuard: money, moneyGuardId: guard.id, ledger,
    assetSink: async () => { throw new Error('storage down'); }
  }), /storage down/);
  const report = money.report(guard.id);
  assert.equal(report.capturedUsd, 0.8);
  assert.equal(report.reservedUsd, 0);
  assert.equal(report.providerCallsPerformed, 1);
  assert.equal(store.get('audition_plan', plan.id).status, 'needs_attention');
});

test('QA Money Guard blocks an over-cap provider call before alignment starts', async () => {
  const store = seedQaStore();
  const money = new MoneyGuardService(store);
  const guard = money.createGuard({ projectId: 'p1', hardCapUsd: 0.1, singleActionApprovalUsd: 0, estimateVarianceRatio: 0 });
  let calls = 0;
  const provider = { align: async () => { calls += 1; return {}; }, transcribe: async () => { calls += 1; return {}; } };
  const service = new ContinuityQaService(store, { providers: { mock: provider }, moneyGuard: money, assetLoader: async () => ({ audio: new Uint8Array([1]) }) });
  const run = service.createRun({ projectId: 'p1', bookId: 'b1', reviewSessionId: 'session1', productionPlanId: 'prod1' });
  await assert.rejects(() => service.inspectTake(run.id, {
    takeId: 'take1', runTranscription: false, moneyGuardId: guard.id, approvedBy: 'operator', estimatedAlignmentCostUsd: 0.2
  }), /Money Guard blocked/);
  assert.equal(calls, 0);
  assert.equal(money.report(guard.id).reservedUsd, 0);
});

test('QA Money Guard captures both provider calls and releases reservations', async () => {
  const store = seedQaStore();
  const ledger = new CostLedger();
  const money = new MoneyGuardService(store, { ledger });
  const guard = money.createGuard({ projectId: 'p1', hardCapUsd: 5, singleActionApprovalUsd: 0, estimateVarianceRatio: 0 });
  const provider = {
    align: async () => ({ loss: 0.1, words: [], requestId: 'a1' }),
    transcribe: async () => ({ language_code: 'en', language_probability: 0.99, text: 'Michael walked home.', words: [], requestId: 't1' })
  };
  const service = new ContinuityQaService(store, { providers: { mock: provider }, moneyGuard: money, ledger, assetLoader: async () => ({ audio: new Uint8Array([1]) }) });
  const run = service.createRun({ projectId: 'p1', bookId: 'b1', reviewSessionId: 'session1', productionPlanId: 'prod1' });
  const result = await service.inspectTake(run.id, {
    takeId: 'take1', moneyGuardId: guard.id, approvedBy: 'operator', estimatedAlignmentCostUsd: 0.1, estimatedTranscriptionCostUsd: 0.2
  });
  const report = money.report(guard.id);
  assert.equal(report.capturedUsd, 0.3);
  assert.equal(report.reservedUsd, 0);
  assert.equal(report.providerCallsPerformed, 2);
  assert.equal(result.report.providerCallsPerformed, 2);
  assert.equal(ledger.total('p1'), 0.3);
});

test('series voice lock requires a Casting Room safety score and blocks unsafe voices', () => {
  const pkg = buildSeriesContinuityPackage(lockedPrep());
  assert.throws(() => withSeriesVoiceLock(pkg, { seriesCharacterKey: 'michael-rawlins', provider: 'elevenlabs', providerVoiceId: 'v1' }), /requires safetyScore/);
  assert.throws(() => withSeriesVoiceLock(pkg, { seriesCharacterKey: 'michael-rawlins', provider: 'elevenlabs', providerVoiceId: 'v1', safetyScore: 50 }), /safety score 50\/70/);
  const overridden = withSeriesVoiceLock(pkg, { seriesCharacterKey: 'michael-rawlins', provider: 'elevenlabs', providerVoiceId: 'v1', safetyScore: 50, override: true, reason: 'author accepted risk' });
  assert.equal(overridden.voiceContinuity.lockedCount, 1);
});

test('materialized Series Continuity voice locks become real Casting Room assignments', () => {
  const store = new InMemoryStore();
  const project = new ProjectService(store).create({ name: 'Series materialization' });
  let pkg = buildSeriesContinuityPackage(lockedPrep());
  pkg = withSeriesVoiceLock(pkg, { seriesCharacterKey: 'michael-rawlins', provider: 'elevenlabs', providerVoiceId: 'voice-safe', safetyScore: 94 });
  const service = new SeriesContinuityService(store);
  const materialized = service.materializeSeriesBible({ projectId: project.id, seriesPackage: pkg });
  const michael = materialized.characterByKey.get('michael-rawlins');
  const resolved = new CastingRoomService(store).resolveCast({ projectId: project.id, characterId: michael.id, seriesId: materialized.series.id });
  assert.equal(materialized.voiceAssignments.length, 1);
  assert.equal(resolved.assignment.providerVoiceId, 'voice-safe');
  assert.equal(resolved.assignment.safetySnapshot.score, 94);
});

test('safe Series Continuity refresh preserves operator relationship and voice locks', () => {
  const prep = lockedPrep();
  let pkg = buildSeriesContinuityPackage(prep);
  pkg = withSeriesRelationshipLock(pkg, { fromSeriesCharacterKey: 'michael-rawlins', toSeriesCharacterKey: 'juan-delgado', kind: 'partner', label: 'romantic partner', approvedBy: 'author' });
  pkg = withSeriesVoiceLock(pkg, { seriesCharacterKey: 'michael-rawlins', provider: 'elevenlabs', providerVoiceId: 'voice-safe', safetyScore: 95 });
  const refreshed = refreshSeriesContinuityPackage(prep, pkg);
  assert.equal(refreshed.relationshipContinuity.lockedCount, 1);
  assert.equal(refreshed.voiceContinuity.lockedCount, 1);
  assert.equal(refreshed.voiceContinuity.assignments[0].providerVoiceId, 'voice-safe');
  assert.equal(refreshed.refresh.preservedRelationshipLocks, 1);
  assert.equal(refreshed.refresh.preservedVoiceLocks, 1);
  assert.equal(verifySeriesContinuityPackage(refreshed).valid, true);
});

test('Series Continuity refresh fails closed when the canonical source hash changed', () => {
  const prep = lockedPrep();
  const pkg = buildSeriesContinuityPackage(prep);
  const changed = JSON.parse(JSON.stringify(prep));
  changed.book.sourceHash = 'different-source';
  assert.throws(() => refreshSeriesContinuityPackage(changed, pkg), /source hash changed/);
});

test('operator flow keeps Casting open until every narrator/primary voice is locked', () => {
  const store = new InMemoryStore();
  store.put(Object.freeze({ id: 'b1', type: 'book', projectId: 'p1' }));
  store.put(Object.freeze({ id: 'c1', type: 'chapter', projectId: 'p1', bookId: 'b1' }));
  store.put(Object.freeze({ id: 'ab', type: 'audio_bible', projectId: 'p1', bookId: 'b1', scope: 'book' }));
  store.put(Object.freeze({ id: 'n', type: 'character', projectId: 'p1', bibleId: 'ab', role: 'narrator' }));
  store.put(Object.freeze({ id: 'm', type: 'character', projectId: 'p1', bibleId: 'ab', role: 'primary' }));
  store.put(Object.freeze({ id: 'va-n', type: 'voice_assignment', projectId: 'p1', characterId: 'n', locked: true }));
  let status = buildOperatorFlowStatus(store, 'p1');
  assert.equal(status.currentStage, 'casting');
  assert.match(status.stages.find((x) => x.key === 'casting').detail, /1\/2/);
  assert.equal(status.safety.moneyGuard.status, 'not-configured');
  store.put(Object.freeze({ id: 'va-m', type: 'voice_assignment', projectId: 'p1', characterId: 'm', locked: true }));
  store.put(Object.freeze({ id: 'dp', type: 'director_plan', projectId: 'p1', bookId: 'b1', locked: false }));
  store.put(Object.freeze({ id: 'dc', type: 'director_cue', projectId: 'p1', planId: 'dp' }));
  status = buildOperatorFlowStatus(store, 'p1');
  assert.equal(status.currentStage, 'director');
  assert.match(status.stages.find((x) => x.key === 'director').detail, /still open/);
});

test('Money Guard reports real provider-call captures without counting simulations', () => {
  const store = new InMemoryStore();
  const money = new MoneyGuardService(store);
  const guard = money.createGuard({ projectId: 'p1', hardCapUsd: 10, singleActionApprovalUsd: 0, estimateVarianceRatio: 0 });
  const a = money.authorize(guard.id, { provider: 'mock', operation: 'production_render', estimatedCostUsd: 1 });
  money.capture(a.id, { amountUsd: 0.5, providerCall: false, costBasis: 'simulation' });
  money.release(a.id);
  const b = money.authorize(guard.id, { provider: 'mock', operation: 'production_render', estimatedCostUsd: 1 });
  money.capture(b.id, { amountUsd: 0.5, providerCall: true, costBasis: 'provider-estimate' });
  assert.equal(money.report(guard.id).providerCallsPerformed, 1);
  assert.equal(money.report(guard.id).accountedCapturedUsd, 1);
});

test('QA Money Guard refuses unknown-cost QA instead of assuming a zero-dollar call', async () => {
  const store = seedQaStore();
  const money = new MoneyGuardService(store);
  const guard = money.createGuard({ projectId: 'p1', hardCapUsd: 5, singleActionApprovalUsd: 0, estimateVarianceRatio: 0 });
  let calls = 0;
  const provider = { align: async () => { calls += 1; return {}; }, transcribe: async () => { calls += 1; return {}; } };
  const service = new ContinuityQaService(store, { providers: { mock: provider }, moneyGuard: money, assetLoader: async () => ({ audio: new Uint8Array([1]) }) });
  const run = service.createRun({ projectId: 'p1', bookId: 'b1', reviewSessionId: 'session1', productionPlanId: 'prod1' });
  await assert.rejects(() => service.inspectTake(run.id, { takeId: 'take1', runTranscription: false, moneyGuardId: guard.id, approvedBy: 'operator' }), /requires an estimated alignment cost/);
  assert.equal(calls, 0);
});
