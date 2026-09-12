import test from 'node:test';
import assert from 'node:assert/strict';
import {
  InMemoryStore,
  CostLedger,
  AudiobookDirectorService,
  ProductionEngineService,
  ElevenLabsProvider,
  modelCharacterLimit,
  productionCharacterCap,
  splitForTts,
  classifyProductionError,
  retryDelayMs
} from '../src/index.js';

function putCue(store, { id = `cue-${Math.random()}`, planId = 'director-1', text = 'A quiet line.', characterId = 'char-1', order = 1 } = {}) {
  return store.put(Object.freeze({
    id, type: 'director_cue', projectId: 'p1', planId, directorSceneId: 'ds1', sceneId: 's1',
    segmentId: `seg-${id}`, characterId, order, canonicalText: text,
    direction: Object.freeze({ emotion: 'neutral', intensity: 0.2, restraint: 0.8, pace: 'measured', volume: 'normal', tags: [] }),
    performanceBrief: Object.freeze({ emotion: 'neutral', pace: 'measured' }), revision: 1, locked: false
  }));
}

class FakeProvider {
  constructor({ failTimes = 0, failStatus = 429, delayMs = 0, costRate = 0.0001 } = {}) {
    this.name = 'elevenlabs';
    this.failTimes = failTimes;
    this.failStatus = failStatus;
    this.delayMs = delayMs;
    this.costRate = costRate;
    this.calls = [];
    this.active = 0;
    this.maxActive = 0;
  }
  async estimateCost({ text, model }) {
    return { amountUsd: Number((text.length * this.costRate).toFixed(6)), characters: text.length, model, estimated: true };
  }
  async render(input) {
    this.calls.push(input);
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    try {
      if (this.delayMs) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
      if (this.failTimes > 0) {
        this.failTimes -= 1;
        const err = new Error(`fake provider failed (${this.failStatus})`);
        err.status = this.failStatus;
        err.providerCode = this.failStatus === 429 ? 'rate_limit_exceeded' : 'invalid_api_key';
        throw err;
      }
      return {
        audio: new Uint8Array([1, 2, 3]), mediaType: 'audio/mpeg', provider: 'elevenlabs',
        voiceId: input.voiceId, model: input.model, outputFormat: input.outputFormat,
        requestId: `req-${this.calls.length}`, traceId: `trace-${this.calls.length}`,
        billedCharacters: input.text.length, estimatedCostUsd: Number((input.text.length * this.costRate).toFixed(6))
      };
    } finally { this.active -= 1; }
  }
}

function harness({ provider = new FakeProvider(), budget = 10, reserve = 0.25, concurrency = 2, maxAttempts = 4, assetSink = null, sleep = async () => {} } = {}) {
  const store = new InMemoryStore();
  const directorService = new AudiobookDirectorService(store);
  const ledger = new CostLedger();
  const sink = assetSink ?? (async (result, { job }) => ({
    id: `asset-${job.id}`, type: 'audio_asset', kind: 'take', storageLocator: `memory://${job.id}.mp3`,
    contentHash: `hash-${job.id}`, mediaType: result.mediaType
  }));
  const engine = new ProductionEngineService(store, {
    directorService, providers: { elevenlabs: provider }, ledger, assetSink: sink, sleep, random: () => 0.5
  });
  const plan = engine.createPlan({
    projectId: 'p1', bookId: 'b1', directorPlanId: 'director-1', provider: 'elevenlabs',
    model: 'eleven_multilingual_v2', hardBudgetUsd: budget, regenerationReserveRatio: reserve,
    concurrency, maxAttempts
  });
  return { store, directorService, ledger, engine, plan, provider };
}

async function planSingle(h, text = 'A quiet line.') {
  const cue = putCue(h.store, { id: `cue-${h.store.list('director_cue').length + 1}`, text });
  const jobs = await h.engine.planCues(h.plan.id, { cueIds: [cue.id], resolveVoice: () => ({ providerVoiceId: 'voice-1' }) });
  return { cue, jobs };
}

test('production caps remain below current model hard limits by default', () => {
  assert.equal(modelCharacterLimit('eleven_v3'), 5000);
  assert.equal(modelCharacterLimit('eleven_multilingual_v2'), 10000);
  assert.equal(modelCharacterLimit('eleven_flash_v2_5'), 40000);
  assert.equal(productionCharacterCap('eleven_v3'), 4000);
  assert.equal(productionCharacterCap('eleven_multilingual_v2'), 8000);
});

test('TTS chunking is lossless and never exceeds cap', () => {
  const source = 'One sentence. Two sentence! Three?\n\n' + 'x'.repeat(140);
  const chunks = splitForTts(source, { maxChars: 50 });
  assert.equal(chunks.join(''), source);
  assert.ok(chunks.length > 3);
  assert.ok(chunks.every((chunk) => chunk.length <= 50));
});

test('preflight includes regeneration reserve before production can be armed', async () => {
  const h = harness({ reserve: 0.5 });
  await planSingle(h, 'x'.repeat(1000));
  const preflight = h.engine.preflight(h.plan.id);
  assert.equal(preflight.initialEstimateUsd, 0.1);
  assert.equal(preflight.reserveBudgetUsd, 0.05);
  assert.equal(preflight.projectedTotalUsd, 0.15);
  assert.equal(preflight.withinBudget, true);
});

test('production cannot be armed when projected spend exceeds hard budget', async () => {
  const h = harness({ budget: 0.11, reserve: 0.25 });
  await planSingle(h, 'x'.repeat(1000));
  assert.throws(() => h.engine.arm(h.plan.id, { approvedBy: 'William' }), /projected .* exceeds/);
  assert.equal(h.engine.getPlan(h.plan.id).armed, false);
});

test('paid rendering fails closed until production is explicitly armed', async () => {
  const h = harness();
  const { jobs } = await planSingle(h);
  await assert.rejects(h.engine.renderJob(jobs[0].id), /not armed/);
  assert.equal(h.provider.calls.length, 0);
});

test('armed render stores only asset references and records provider billing metadata', async () => {
  const h = harness();
  const { jobs } = await planSingle(h, 'Hello there.');
  h.engine.arm(h.plan.id, { approvedBy: 'William' });
  const ready = await h.engine.renderJob(jobs[0].id);
  assert.equal(ready.status, 'ready');
  assert.equal(ready.providerRequestId, 'req-1');
  assert.equal(ready.billedCharacters, ready.renderText.length);
  assert.equal('audio' in ready.asset, false);
  assert.equal(h.ledger.list('p1').length, 1);
});

test('transient 429 errors retry with exponential backoff, permanent errors do not', async () => {
  const delays = [];
  const h = harness({ provider: new FakeProvider({ failTimes: 2, failStatus: 429 }), sleep: async (ms) => { delays.push(ms); } });
  const { jobs } = await planSingle(h);
  h.engine.arm(h.plan.id, { approvedBy: 'William' });
  const ready = await h.engine.renderJob(jobs[0].id);
  assert.equal(ready.status, 'ready');
  assert.equal(ready.attemptCount, 3);
  assert.deepEqual(delays, [750, 1500]);

  const h2 = harness({ provider: new FakeProvider({ failTimes: 1, failStatus: 401 }) });
  const { jobs: jobs2 } = await planSingle(h2);
  h2.engine.arm(h2.plan.id, { approvedBy: 'William' });
  const failed = await h2.engine.renderJob(jobs2[0].id);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.attemptCount, 1);
});

test('error classification recognizes provider concurrency and quota failures', () => {
  assert.equal(classifyProductionError(Object.assign(new Error('busy'), { status: 429, providerCode: 'concurrent_limit_exceeded' })).retryable, true);
  assert.equal(classifyProductionError(Object.assign(new Error('quota'), { status: 401, providerCode: 'quota_exceeded' })).retryable, false);
  assert.equal(retryDelayMs(3, { baseMs: 100, jitter: 0, random: () => 0.5 }), 400);
});

test('production runner honors configured concurrency ceiling', async () => {
  const h = harness({ provider: new FakeProvider({ delayMs: 15 }), concurrency: 2 });
  const cueIds = [];
  for (let i = 0; i < 6; i += 1) cueIds.push(putCue(h.store, { id: `c-${i}`, text: `Line ${i}.`, order: i }).id);
  await h.engine.planCues(h.plan.id, { cueIds, resolveVoice: () => ({ providerVoiceId: 'voice-1' }) });
  h.engine.arm(h.plan.id, { approvedBy: 'William' });
  const result = await h.engine.run(h.plan.id);
  assert.equal(result.manifest.completionPercent, 100);
  assert.ok(h.provider.maxActive <= 2);
  assert.ok(h.provider.maxActive >= 2);
});

test('identical completed audio is reused without paying provider twice', async () => {
  const h = harness();
  const cue = putCue(h.store, { id: 'same-cue', text: 'Same exact line.' });
  await h.engine.planCues(h.plan.id, { cueIds: [cue.id], resolveVoice: () => ({ providerVoiceId: 'voice-1' }) });
  h.engine.arm(h.plan.id, { approvedBy: 'William' });
  await h.engine.run(h.plan.id);
  assert.equal(h.provider.calls.length, 1);

  const second = h.engine.createPlan({ projectId: 'p1', bookId: 'b1', directorPlanId: 'director-1', provider: 'elevenlabs', model: 'eleven_multilingual_v2', hardBudgetUsd: 10 });
  const jobs2 = await h.engine.planCues(second.id, { cueIds: [cue.id], resolveVoice: () => ({ providerVoiceId: 'voice-1' }) });
  h.engine.arm(second.id, { approvedBy: 'William' });
  const reused = await h.engine.renderJob(jobs2[0].id);
  assert.equal(reused.status, 'ready');
  assert.equal(reused.actualCostUsd, 0);
  assert.ok(reused.reusedFromJobId);
  assert.equal(h.provider.calls.length, 1);
});

test('regeneration requires an audit reason and is limited by reserved budget', async () => {
  const h = harness({ reserve: 1.0 });
  const { jobs } = await planSingle(h, 'x'.repeat(100));
  h.engine.arm(h.plan.id, { approvedBy: 'William' });
  const ready = await h.engine.renderJob(jobs[0].id);
  assert.throws(() => h.engine.requestRegeneration(ready.id, { reason: '' }), /requires a reason/);
  const regen = h.engine.requestRegeneration(ready.id, { reason: 'Too dramatic' });
  assert.equal(regen.budgetClass, 'regeneration');
  assert.equal(regen.reuseAllowed, false);
  const regenerated = await h.engine.renderJob(regen.id);
  assert.equal(regenerated.status, 'ready');
  assert.equal(h.provider.calls.length, 2);
  assert.throws(() => h.engine.requestRegeneration(ready.id, { reason: 'Another take' }), /reserve exceeded/);
});

test('asset sink cannot leak raw audio bytes into durable production records', async () => {
  const h = harness({ assetSink: async () => ({ id: 'bad', audio: new Uint8Array([1]) }) });
  const { jobs } = await planSingle(h);
  h.engine.arm(h.plan.id, { approvedBy: 'William' });
  const failed = await h.engine.renderJob(jobs[0].id);
  assert.equal(failed.status, 'failed');
  assert.match(failed.lastError, /raw audio bytes/);
});

test('neighboring chunk context is passed to the provider to support continuity', async () => {
  const h = harness();
  h.store.put(Object.freeze({
    id: 'long-cue', type: 'director_cue', projectId: 'p1', planId: 'director-1', directorSceneId: 'ds1', sceneId: 's1', segmentId: 'seg-long',
    characterId: 'char-1', order: 1, canonicalText: 'x'.repeat(8500),
    direction: Object.freeze({ emotion: 'neutral', intensity: 0.1, restraint: 0.9, pace: 'measured', volume: 'normal', tags: [] }),
    performanceBrief: Object.freeze({ emotion: 'neutral' }), revision: 1, locked: false
  }));
  const jobs = await h.engine.planCues(h.plan.id, { cueIds: ['long-cue'], resolveVoice: () => ({ providerVoiceId: 'voice-1' }) });
  assert.equal(jobs.length, 2);
  h.engine.arm(h.plan.id, { approvedBy: 'William' });
  await h.engine.run(h.plan.id);
  assert.equal(h.provider.calls[0].previousText, null);
  assert.ok(h.provider.calls[0].nextText);
  assert.ok(h.provider.calls[1].previousText);
});

test('manifest exposes completion, failures and money state', async () => {
  const h = harness();
  const { jobs } = await planSingle(h, 'Manifest line.');
  h.engine.arm(h.plan.id, { approvedBy: 'William' });
  await h.engine.renderJob(jobs[0].id);
  const manifest = h.engine.manifest(h.plan.id);
  assert.equal(manifest.totalJobs, 1);
  assert.equal(manifest.completionPercent, 100);
  assert.equal(manifest.counts.ready, 1);
  assert.ok(manifest.accountedSpendUsd > 0);
  assert.equal(manifest.actualSpendUsd, null);
  assert.ok(manifest.estimatedOrUnsettledSpendUsd > 0);
  assert.equal(manifest.spendBasis, 'accounted-estimate');
  assert.ok(manifest.remainingHardBudgetUsd < manifest.hardBudgetUsd);
});

test('ElevenLabs provider sends continuity context and captures billing headers', async () => {
  let payload = null;
  const fetchImpl = async (_url, options) => {
    payload = JSON.parse(options.body);
    return new Response(new Uint8Array([9, 8, 7]), {
      status: 200,
      headers: { 'content-type': 'audio/mpeg', 'character-cost': '123', 'request-id': 'req-real', 'x-trace-id': 'trace-real' }
    });
  };
  const provider = new ElevenLabsProvider({ apiKey: 'test-key', fetchImpl, pricingUsdPer1k: { eleven_multilingual_v2: 0.1 } });
  const result = await provider.render({
    voiceId: 'voice', text: 'Hello.', model: 'eleven_multilingual_v2',
    previousText: 'Before.', nextText: 'After.', previousRequestIds: ['1', '2', '3', '4'], nextRequestIds: ['5']
  });
  assert.equal(payload.previous_text, 'Before.');
  assert.equal(payload.next_text, 'After.');
  assert.deepEqual(payload.previous_request_ids, ['2', '3', '4']);
  assert.equal(result.requestId, 'req-real');
  assert.equal(result.traceId, 'trace-real');
  assert.equal(result.billedCharacters, 123);
  assert.equal(result.estimatedCostUsd, 0.0123);
});
