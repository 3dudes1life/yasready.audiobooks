import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AudiobookDirectorService,
  CastingRoomService,
  CostLedger,
  InMemoryStore,
  MoneyGuardService,
  ProductionEngineService,
  normalizeMoneyPolicy
} from '../src/index.js';

function setup(policy = {}) {
  const store = new InMemoryStore();
  const ledger = new CostLedger();
  const money = new MoneyGuardService(store, { ledger });
  const guard = money.createGuard({ projectId: 'p1', hardCapUsd: 50, singleActionApprovalUsd: 5, estimateVarianceRatio: 0.1, ...policy });
  return { store, ledger, money, guard };
}

test('Money Guard policy rejects unsafe or nonsensical limits', () => {
  assert.throws(() => normalizeMoneyPolicy({ hardCapUsd: 0 }), /positive hardCapUsd/);
  assert.throws(() => normalizeMoneyPolicy({ hardCapUsd: 10, warningThresholdRatio: 1.2 }), /warningThresholdRatio/);
  assert.throws(() => normalizeMoneyPolicy({ hardCapUsd: 10, estimateVarianceRatio: -1 }), /estimateVarianceRatio/);
});

test('small paid action can be previewed without provider calls', () => {
  const { money, guard } = setup();
  const decision = money.preview(guard.id, { provider: 'elevenlabs', operation: 'audition_render', estimatedCostUsd: 1 });
  assert.equal(decision.status, 'SAFE');
  assert.equal(decision.reserveUsd, 1.1);
  assert.deepEqual(decision.reasons, []);
});

test('single-action approval threshold fails closed until approved', () => {
  const { money, guard } = setup();
  const blocked = money.preview(guard.id, { provider: 'elevenlabs', operation: 'production_render', estimatedCostUsd: 10 });
  assert.equal(blocked.status, 'BLOCKED');
  assert.ok(blocked.reasons.includes('approval-required'));
  const allowed = money.preview(guard.id, { provider: 'elevenlabs', operation: 'production_render', estimatedCostUsd: 10, approvedBy: 'operator' });
  assert.notEqual(allowed.status, 'BLOCKED');
});

test('open reservations count against hard cap before money is spent', () => {
  const { money, guard } = setup({ estimateVarianceRatio: 0 });
  money.authorize(guard.id, { provider: 'elevenlabs', operation: 'production_render', estimatedCostUsd: 30, approvedBy: 'operator' });
  const blocked = money.preview(guard.id, { provider: 'elevenlabs', operation: 'production_render', estimatedCostUsd: 21, approvedBy: 'operator' });
  assert.equal(blocked.status, 'BLOCKED');
  assert.ok(blocked.reasons.includes('project-hard-cap'));
});

test('provider ceilings and operation ceilings independently block authorizations', () => {
  const { money, guard } = setup({ providerCapsUsd: { elevenlabs: 12 }, operationCapsUsd: { audition: 3 }, estimateVarianceRatio: 0 });
  const providerBlocked = money.preview(guard.id, { provider: 'elevenlabs', operation: 'production_render', estimatedCostUsd: 13, approvedBy: 'operator' });
  assert.ok(providerBlocked.reasons.includes('provider-cap'));
  const opBlocked = money.preview(guard.id, { provider: 'other', operation: 'audition_render', estimatedCostUsd: 4 });
  assert.ok(opBlocked.reasons.includes('operation-cap'));
});

test('warning threshold requires approval when configured', () => {
  const { money, guard } = setup({ hardCapUsd: 10, warningThresholdRatio: 0.8, singleActionApprovalUsd: 100, estimateVarianceRatio: 0 });
  const warning = money.preview(guard.id, { provider: 'elevenlabs', operation: 'production_render', estimatedCostUsd: 8 });
  assert.equal(warning.status, 'BLOCKED');
  assert.ok(warning.reasons.includes('approval-required'));
  const approved = money.preview(guard.id, { provider: 'elevenlabs', operation: 'production_render', estimatedCostUsd: 8, approvedBy: 'operator' });
  assert.equal(approved.status, 'WARNING');
});

test('capture records actual spend and release returns unused reservation', () => {
  const { ledger, money, guard } = setup({ estimateVarianceRatio: 0.2 });
  const auth = money.authorize(guard.id, { provider: 'elevenlabs', operation: 'production_render', estimatedCostUsd: 10, approvedBy: 'operator' });
  money.capture(auth.id, { amountUsd: 7, units: 70000, unitType: 'characters' });
  let report = money.report(guard.id);
  assert.equal(report.capturedUsd, 7);
  assert.equal(report.reservedUsd, 5);
  assert.equal(report.committedUsd, 12);
  money.release(auth.id, { reason: 'unused reserve' });
  report = money.report(guard.id);
  assert.equal(report.capturedUsd, 7);
  assert.equal(report.reservedUsd, 0);
  assert.equal(report.availableUsd, 43);
  assert.equal(ledger.total('p1'), 7);
  assert.equal(report.paidGenerationArmed, false);
});

test('unexpected provider overrun is recorded and locks future spend', () => {
  const { money, guard } = setup({ hardCapUsd: 10, singleActionApprovalUsd: 0, estimateVarianceRatio: 0 });
  const auth = money.authorize(guard.id, { provider: 'elevenlabs', operation: 'production_render', estimatedCostUsd: 9, approvedBy: 'operator' });
  money.capture(auth.id, { amountUsd: 11 });
  assert.equal(money.getGuard(guard.id).status, 'locked_overrun');
  assert.throws(() => money.authorize(guard.id, { provider: 'elevenlabs', operation: 'production_render', estimatedCostUsd: 0.1 }), /locked_overrun/);
});

test('manual lockdown blocks all new paid authorizations until explicit reopen', () => {
  const { money, guard } = setup();
  money.lockdown(guard.id, { reason: 'operator emergency stop' });
  assert.throws(() => money.authorize(guard.id, { provider: 'elevenlabs', operation: 'audition_render', estimatedCostUsd: 1 }), /locked/);
  assert.throws(() => money.reopen(guard.id, { approvedBy: '', reason: 'x' }), /approvedBy and reason/);
  money.reopen(guard.id, { approvedBy: 'operator', reason: 'reviewed budget' });
  assert.equal(money.getGuard(guard.id).status, 'active');
});

function voiceProfile(id = 'voice-1') {
  return {
    provider: 'elevenlabs', providerVoiceId: id, name: id, category: 'professional', language: 'en',
    noticePeriodDays: 365, verifiedLanguages: [{ language: 'en', locale: 'en-US', modelId: 'eleven_multilingual_v2' }],
    scheduledDisableAt: null, liveModerationEnabled: false, customRates: null, source: 'test'
  };
}

test('Casting Room Money Guard blocks an over-cap audition before render', async () => {
  const { store, money, guard } = setup({ hardCapUsd: 0.5, singleActionApprovalUsd: 0, estimateVarianceRatio: 0 });
  const room = new CastingRoomService(store);
  const candidate = room.stageCandidate({ projectId: 'p1', characterId: 'michael', voice: voiceProfile() });
  const plan = room.createAuditionPlan({ projectId: 'p1', characterId: 'michael', candidateIds: [candidate.id], scripts: [{ text: 'hello' }], maxSpendUsd: 2 });
  let renders = 0;
  const provider = { estimateCost: async () => ({ amountUsd: 1, characters: 5, model: 'x' }), render: async () => { renders += 1; return { estimatedCostUsd: 1 }; } };
  await assert.rejects(() => room.renderAudition(plan.id, { providers: { elevenlabs: provider }, assetSink: async () => ({}), moneyGuard: money, moneyGuardId: guard.id }), /Money Guard blocked/);
  assert.equal(renders, 0);
});

test('Casting Room Money Guard captures actual audition spend once and releases buffer', async () => {
  const { store, ledger, money, guard } = setup({ hardCapUsd: 10, singleActionApprovalUsd: 0 });
  const room = new CastingRoomService(store);
  const candidate = room.stageCandidate({ projectId: 'p1', characterId: 'michael', voice: voiceProfile() });
  const plan = room.createAuditionPlan({ projectId: 'p1', characterId: 'michael', candidateIds: [candidate.id], scripts: [{ text: 'hello' }], maxSpendUsd: 2 });
  const provider = {
    estimateCost: async () => ({ amountUsd: 1, characters: 5, model: 'x' }),
    render: async () => ({ estimatedCostUsd: 0.8, billedCharacters: 5, audio: new Uint8Array([1]) })
  };
  await room.renderAudition(plan.id, { providers: { elevenlabs: provider }, assetSink: async () => ({ storageLocator: 'memory://take' }), moneyGuard: money, moneyGuardId: guard.id, ledger });
  const report = money.report(guard.id);
  assert.equal(report.capturedUsd, 0.8);
  assert.equal(report.reservedUsd, 0);
  assert.equal(ledger.total('p1'), 0.8);
});

function productionHarness({ hardCapUsd = 10 } = {}) {
  const store = new InMemoryStore();
  const ledger = new CostLedger();
  const money = new MoneyGuardService(store, { ledger });
  const guard = money.createGuard({ projectId: 'p1', hardCapUsd, singleActionApprovalUsd: 0, estimateVarianceRatio: 0 });
  const director = new AudiobookDirectorService(store);
  const provider = {
    calls: 0,
    estimateCost: async ({ text }) => ({ amountUsd: text.length * 0.01, characters: text.length, model: 'x' }),
    render: async ({ text }) => { provider.calls += 1; return { estimatedCostUsd: text.length * 0.01, billedCharacters: text.length, requestId: `r${provider.calls}`, audio: new Uint8Array([1]) }; }
  };
  store.put(Object.freeze({
    id: 'cue-1', type: 'director_cue', projectId: 'p1', planId: 'director-1', directorSceneId: 'ds1', sceneId: 's1', segmentId: 'seg1',
    characterId: 'char1', order: 1, canonicalText: 'hello', direction: Object.freeze({ emotion: 'neutral', intensity: 0.1, restraint: 0.9, pace: 'measured', volume: 'normal', tags: [] }),
    performanceBrief: Object.freeze({ emotion: 'neutral' }), revision: 1, locked: false
  }));
  const engine = new ProductionEngineService(store, { directorService: director, providers: { elevenlabs: provider }, ledger, moneyGuard: money, assetSink: async () => ({ storageLocator: `memory://${provider.calls}` }), sleep: async () => {} });
  const plan = engine.createPlan({ projectId: 'p1', bookId: 'b1', directorPlanId: 'director-1', provider: 'elevenlabs', model: 'eleven_multilingual_v2', hardBudgetUsd: 5, regenerationReserveRatio: 0.25 });
  return { store, ledger, money, guard, director, provider, engine, plan };
}

test('Production Engine reserves Money Guard envelope when armed and captures render spend', async () => {
  const h = productionHarness();
  await h.engine.planCues(h.plan.id, { cueIds: ['cue-1'], resolveVoice: () => ({ providerVoiceId: 'voice-1' }) });
  const armed = h.engine.arm(h.plan.id, { approvedBy: 'operator', moneyGuardId: h.guard.id });
  assert.ok(armed.moneyAuthorizationId);
  const before = h.money.report(h.guard.id);
  assert.ok(before.reservedUsd > 0);
  await h.engine.run(h.plan.id);
  const after = h.money.report(h.guard.id);
  assert.ok(after.capturedUsd > 0);
  assert.equal(h.ledger.total('p1'), after.capturedUsd);
  assert.equal(h.provider.calls, 1);
});

test('Production Engine refuses provider calls after Money Guard emergency lockdown', async () => {
  const h = productionHarness();
  const jobs = await h.engine.planCues(h.plan.id, { cueIds: ['cue-1'], resolveVoice: () => ({ providerVoiceId: 'voice-1' }) });
  h.engine.arm(h.plan.id, { approvedBy: 'operator', moneyGuardId: h.guard.id });
  h.money.lockdown(h.guard.id, { reason: 'stop spend' });
  const result = await h.engine.renderJob(jobs[0].id);
  assert.equal(result.status, 'budget_blocked');
  assert.equal(h.provider.calls, 0);
});

test('Money Guard keeps real production spend even when asset storage fails after provider billing', async () => {
  const h = productionHarness();
  h.engine.assetSink = async () => { throw new Error('storage unavailable'); };
  const jobs = await h.engine.planCues(h.plan.id, { cueIds: ['cue-1'], resolveVoice: () => ({ providerVoiceId: 'voice-1' }) });
  h.engine.arm(h.plan.id, { approvedBy: 'operator', moneyGuardId: h.guard.id });
  const failed = await h.engine.renderJob(jobs[0].id);
  assert.equal(failed.status, 'failed');
  assert.equal(h.provider.calls, 1);
  assert.ok(h.money.report(h.guard.id).capturedUsd > 0);
  assert.ok(h.ledger.total('p1') > 0);
});

test('Money Guard keeps real audition spend even when take storage fails after provider billing', async () => {
  const { store, ledger, money, guard } = setup({ hardCapUsd: 10, singleActionApprovalUsd: 0 });
  const room = new CastingRoomService(store);
  const candidate = room.stageCandidate({ projectId: 'p1', characterId: 'michael', voice: voiceProfile() });
  const plan = room.createAuditionPlan({ projectId: 'p1', characterId: 'michael', candidateIds: [candidate.id], scripts: [{ text: 'hello' }], maxSpendUsd: 2 });
  const provider = {
    estimateCost: async () => ({ amountUsd: 1, characters: 5, model: 'x' }),
    render: async () => ({ estimatedCostUsd: 0.8, billedCharacters: 5, audio: new Uint8Array([1]) })
  };
  await assert.rejects(() => room.renderAudition(plan.id, { providers: { elevenlabs: provider }, assetSink: async () => { throw new Error('storage unavailable'); }, moneyGuard: money, moneyGuardId: guard.id, ledger }), /storage unavailable/);
  assert.equal(money.report(guard.id).capturedUsd, 0.8);
  assert.equal(ledger.total('p1'), 0.8);
});
