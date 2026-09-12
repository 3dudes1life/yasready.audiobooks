import { randomUUID } from 'node:crypto';
import { renderFingerprint, sha256 } from '../core/hash.js';
import { productionCharacterCap, splitForTts, neighboringText } from '../production/model-limits.js';

const freeze = (value) => Object.freeze(value);
const nowIso = (clock) => clock().toISOString();
const roundMoney = (value) => Number(Number(value).toFixed(6));

function requirePositiveNumber(value, label, { allowZero = false } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n) || (allowZero ? n < 0 : n <= 0)) throw new Error(`${label} must be ${allowZero ? 'non-negative' : 'positive'}`);
  return n;
}

function errorStatus(error) {
  if (Number.isInteger(error?.status)) return error.status;
  const match = String(error?.message ?? '').match(/\((\d{3})\)/);
  return match ? Number(match[1]) : null;
}

export function classifyProductionError(error) {
  const status = errorStatus(error);
  const code = String(error?.code ?? error?.providerCode ?? '').toLowerCase();
  const message = String(error?.message ?? '').toLowerCase();
  const nonRetryableCodes = ['quota_exceeded', 'invalid_api_key', 'voice_not_found', 'validation_error', 'invalid_request', 'max_character_limit_exceeded'];
  if (error?.retryable === false || nonRetryableCodes.some((item) => code.includes(item) || message.includes(item))) {
    return freeze({ retryable: false, status, code: code || null });
  }
  if (error?.retryable === true) return freeze({ retryable: true, status, code: code || null });
  if (status === 429 || (status !== null && status >= 500)) return freeze({ retryable: true, status, code: code || null });
  if (['rate_limit_exceeded', 'concurrent_limit_exceeded', 'system_busy', 'too_many_concurrent_requests'].some((item) => code.includes(item) || message.includes(item))) {
    return freeze({ retryable: true, status, code: code || null });
  }
  if (['econnreset', 'etimedout', 'timeout', 'network'].some((item) => code.includes(item) || message.includes(item))) {
    return freeze({ retryable: true, status, code: code || null });
  }
  return freeze({ retryable: false, status, code: code || null });
}

export function retryDelayMs(attempt, { baseMs = 750, maxMs = 10000, jitter = 0.2, random = Math.random } = {}) {
  const exponent = Math.max(0, Number(attempt) - 1);
  const raw = Math.min(maxMs, baseMs * (2 ** exponent));
  const jitterFactor = 1 + ((Number(random()) * 2 - 1) * jitter);
  return Math.max(0, Math.round(raw * jitterFactor));
}

function countStatuses(jobs) {
  const counts = {};
  for (const job of jobs) counts[job.status] = (counts[job.status] ?? 0) + 1;
  return counts;
}

export class ProductionEngineService {
  constructor(store, {
    directorService,
    providers = {},
    ledger = null,
    assetSink = null,
    clock = () => new Date(),
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    random = Math.random
  } = {}) {
    if (!store) throw new Error('ProductionEngineService requires a store');
    if (!directorService) throw new Error('ProductionEngineService requires directorService');
    this.store = store;
    this.directorService = directorService;
    this.providers = providers;
    this.ledger = ledger;
    this.assetSink = assetSink;
    this.clock = clock;
    this.sleep = sleep;
    this.random = random;
  }

  createPlan({
    projectId, bookId, directorPlanId, provider = 'elevenlabs', model = 'eleven_multilingual_v2',
    outputFormat = 'mp3_44100_128', hardBudgetUsd, regenerationReserveRatio = 0.25,
    concurrency = 2, maxAttempts = 4, chunkSafetyRatio = 0.8, notes = null
  }) {
    if (!projectId || !bookId || !directorPlanId) throw new Error('production plan requires projectId, bookId and directorPlanId');
    const budget = requirePositiveNumber(hardBudgetUsd, 'hardBudgetUsd');
    const reserveRatio = requirePositiveNumber(regenerationReserveRatio, 'regenerationReserveRatio', { allowZero: true });
    const workerCount = Math.max(1, Math.min(15, Math.floor(Number(concurrency) || 1)));
    const attempts = Math.max(1, Math.min(10, Math.floor(Number(maxAttempts) || 1)));
    const record = freeze({
      id: randomUUID(), type: 'production_plan', projectId, bookId, directorPlanId,
      provider, model, outputFormat, hardBudgetUsd: budget, regenerationReserveRatio: reserveRatio,
      concurrency: workerCount, maxAttempts: attempts, chunkSafetyRatio,
      characterCap: productionCharacterCap(model, { safetyRatio: chunkSafetyRatio }),
      notes, status: 'draft', armed: false, approvedBy: null,
      initialEstimateUsd: 0, reserveBudgetUsd: 0, projectedTotalUsd: 0,
      createdAt: nowIso(this.clock), updatedAt: nowIso(this.clock)
    });
    return this.store.put(record);
  }

  getPlan(planId) {
    const plan = this.store.get('production_plan', planId);
    if (!plan) throw new Error(`production_plan ${planId} not found`);
    return plan;
  }

  async planCues(planId, { cueIds, resolveVoice, pronunciationVersion = null, voiceSettings = null, languageCode = null } = {}) {
    const plan = this.getPlan(planId);
    if (plan.armed) throw new Error('cannot re-plan an armed production');
    if (!Array.isArray(cueIds) || !cueIds.length) throw new Error('planCues requires cueIds');
    if (typeof resolveVoice !== 'function') throw new Error('planCues requires resolveVoice');
    const provider = this.providers[plan.provider];
    if (!provider) throw new Error(`provider ${plan.provider} is unavailable`);

    const jobs = [];
    for (const cueId of cueIds) {
      const cue = this.store.get('director_cue', cueId);
      if (!cue) throw new Error(`director_cue ${cueId} not found`);
      if (cue.planId !== plan.directorPlanId) throw new Error(`director_cue ${cueId} belongs to another director plan`);
      const resolved = await resolveVoice(cue);
      const voiceId = resolved?.providerVoiceId ?? resolved?.voiceId ?? null;
      if (!voiceId) throw new Error(`no voice resolved for director_cue ${cueId}`);
      const compiled = this.directorService.compileCue(cueId, { provider: plan.provider, model: plan.model });
      const chunks = splitForTts(compiled.renderText, { maxChars: plan.characterCap });
      for (let i = 0; i < chunks.length; i += 1) {
        const renderText = chunks[i];
        const context = neighboringText(chunks, i);
        const estimate = await provider.estimateCost({ text: renderText, model: plan.model });
        if (estimate.amountUsd === null) throw new Error(`provider ${plan.provider} cannot estimate ${plan.model} production cost`);
        const settings = { outputFormat: plan.outputFormat, voiceSettings, languageCode, context };
        const fingerprint = renderFingerprint({
          text: renderText, provider: plan.provider, model: plan.model, voiceId,
          settings, pronunciationVersion,
          directorInstructions: cue.performanceBrief ?? cue.direction ?? null
        });
        const existing = this.store.list('production_job', (job) => job.planId === planId && job.fingerprint === fingerprint && job.budgetClass === 'initial')[0];
        if (existing) { jobs.push(existing); continue; }
        jobs.push(this.store.put(freeze({
          id: randomUUID(), type: 'production_job', planId, projectId: plan.projectId, bookId: plan.bookId,
          directorPlanId: plan.directorPlanId, cueId, sceneId: cue.sceneId, segmentId: cue.segmentId,
          characterId: cue.characterId ?? null, provider: plan.provider, model: plan.model,
          outputFormat: plan.outputFormat, voiceId, renderText, renderTextHash: sha256(renderText),
          canonicalTextHash: sha256(cue.canonicalText), fingerprint, pronunciationVersion,
          voiceSettings, languageCode, chunkIndex: i, chunkCount: chunks.length,
          previousText: context.previousText, nextText: context.nextText,
          estimatedCostUsd: roundMoney(estimate.amountUsd), estimatedCharacters: estimate.characters ?? renderText.length,
          budgetClass: 'initial', reuseAllowed: true, parentJobId: null, regenerationReason: null,
          status: 'queued', attemptCount: 0, asset: null, providerRequestId: null,
          providerTraceId: null, billedCharacters: null, actualCostUsd: null, lastError: null,
          createdAt: nowIso(this.clock), updatedAt: nowIso(this.clock)
        })));
      }
    }
    return freeze(jobs);
  }

  preflight(planId) {
    const plan = this.getPlan(planId);
    const jobs = this.store.list('production_job', (job) => job.planId === planId && job.budgetClass === 'initial');
    if (!jobs.length) throw new Error('production preflight requires planned jobs');
    const initial = roundMoney(jobs.reduce((sum, job) => sum + job.estimatedCostUsd, 0));
    const reserve = roundMoney(initial * plan.regenerationReserveRatio);
    const projected = roundMoney(initial + reserve);
    const withinBudget = projected <= plan.hardBudgetUsd;
    const updated = this.store.update('production_plan', planId, (current) => freeze({
      ...current, initialEstimateUsd: initial, reserveBudgetUsd: reserve, projectedTotalUsd: projected,
      status: withinBudget ? 'preflighted' : 'budget_blocked', updatedAt: nowIso(this.clock)
    }));
    return freeze({
      plan: updated, initialEstimateUsd: initial, reserveBudgetUsd: reserve,
      projectedTotalUsd: projected, hardBudgetUsd: plan.hardBudgetUsd, withinBudget,
      jobCount: jobs.length
    });
  }

  arm(planId, { approvedBy, reason = null } = {}) {
    const plan = this.getPlan(planId);
    if (!String(approvedBy ?? '').trim()) throw new Error('arming production requires approvedBy');
    const preflight = this.preflight(planId);
    if (!preflight.withinBudget) throw new Error(`production blocked: projected $${preflight.projectedTotalUsd.toFixed(2)} exceeds $${preflight.hardBudgetUsd.toFixed(2)} budget`);
    return this.store.update('production_plan', planId, (current) => freeze({
      ...current, armed: true, status: 'armed', approvedBy, armReason: reason,
      armedAt: nowIso(this.clock), updatedAt: nowIso(this.clock)
    }));
  }

  disarm(planId, { reason }) {
    if (!String(reason ?? '').trim()) throw new Error('disarming production requires a reason');
    return this.store.update('production_plan', planId, (current) => freeze({
      ...current, armed: false, status: 'paused', disarmReason: reason, updatedAt: nowIso(this.clock)
    }));
  }

  actualSpend(planId) {
    return roundMoney(this.store.list('production_job', (job) => job.planId === planId && job.status === 'ready')
      .reduce((sum, job) => sum + (job.actualCostUsd ?? job.estimatedCostUsd ?? 0), 0));
  }

  regenerationCommitted(planId) {
    return roundMoney(this.store.list('production_job', (job) => job.planId === planId && job.budgetClass === 'regeneration')
      .reduce((sum, job) => sum + (job.actualCostUsd ?? job.estimatedCostUsd ?? 0), 0));
  }

  requestRegeneration(sourceJobId, { reason } = {}) {
    if (!String(reason ?? '').trim()) throw new Error('regeneration requires a reason');
    const source = this.store.get('production_job', sourceJobId);
    if (!source) throw new Error(`production_job ${sourceJobId} not found`);
    if (source.status !== 'ready') throw new Error('only ready jobs may be regenerated');
    const plan = this.getPlan(source.planId);
    const committed = this.regenerationCommitted(plan.id);
    if (roundMoney(committed + source.estimatedCostUsd) > plan.reserveBudgetUsd) {
      throw new Error(`regeneration reserve exceeded: $${plan.reserveBudgetUsd.toFixed(2)} reserved`);
    }
    return this.store.put(freeze({
      ...source, id: randomUUID(), parentJobId: source.id, budgetClass: 'regeneration', reuseAllowed: false,
      regenerationReason: reason, status: 'queued', attemptCount: 0, asset: null,
      providerRequestId: null, providerTraceId: null, billedCharacters: null, actualCostUsd: null,
      lastError: null, createdAt: nowIso(this.clock), updatedAt: nowIso(this.clock)
    }));
  }

  findReusable(job) {
    if (!job.reuseAllowed) return null;
    return this.store.list('production_job', (candidate) =>
      candidate.id !== job.id && candidate.fingerprint === job.fingerprint && candidate.status === 'ready' && candidate.asset
    )[0] ?? null;
  }

  async renderJob(jobId) {
    const job = this.store.get('production_job', jobId);
    if (!job) throw new Error(`production_job ${jobId} not found`);
    const plan = this.getPlan(job.planId);
    if (!plan.armed) throw new Error('production plan is not armed');
    if (!['queued', 'retrying'].includes(job.status)) return job;

    const reusable = this.findReusable(job);
    if (reusable) {
      return this.store.update('production_job', job.id, (current) => freeze({
        ...current, status: 'ready', asset: reusable.asset, reusedFromJobId: reusable.id,
        actualCostUsd: 0, billedCharacters: 0, updatedAt: nowIso(this.clock)
      }));
    }

    if (this.actualSpend(plan.id) + job.estimatedCostUsd > plan.hardBudgetUsd) {
      return this.store.update('production_job', job.id, (current) => freeze({
        ...current, status: 'budget_blocked', lastError: 'hard production budget would be exceeded', updatedAt: nowIso(this.clock)
      }));
    }
    const provider = this.providers[job.provider];
    if (!provider) throw new Error(`provider ${job.provider} is unavailable`);
    if (typeof this.assetSink !== 'function') throw new Error('production rendering requires assetSink');

    let lastError = null;
    for (let attempt = job.attemptCount + 1; attempt <= plan.maxAttempts; attempt += 1) {
      this.store.update('production_job', job.id, (current) => freeze({
        ...current, status: attempt === 1 ? 'rendering' : 'retrying', attemptCount: attempt, updatedAt: nowIso(this.clock)
      }));
      try {
        const result = await provider.render({
          voiceId: job.voiceId, text: job.renderText, model: job.model, outputFormat: job.outputFormat,
          voiceSettings: job.voiceSettings, languageCode: job.languageCode,
          previousText: job.previousText, nextText: job.nextText
        });
        const asset = await this.assetSink(result, { plan, job: this.store.get('production_job', job.id) });
        if (!asset || typeof asset !== 'object') throw new Error('assetSink must return an asset reference object');
        if ('audio' in asset || 'data' in asset || 'bytesData' in asset) throw new Error('assetSink returned raw audio bytes; production store accepts references only');
        const billedCharacters = Number.isFinite(Number(result.billedCharacters)) ? Number(result.billedCharacters) : job.estimatedCharacters;
        let actualCostUsd = Number.isFinite(Number(result.estimatedCostUsd)) ? Number(result.estimatedCostUsd) : job.estimatedCostUsd;
        actualCostUsd = roundMoney(actualCostUsd);
        if (this.ledger) {
          this.ledger.record({
            projectId: plan.projectId, provider: job.provider, operation: job.budgetClass === 'regeneration' ? 'production_regeneration' : 'production_render',
            amountUsd: actualCostUsd, units: billedCharacters, unitType: 'characters',
            metadata: { planId: plan.id, jobId: job.id, cueId: job.cueId, requestId: result.requestId ?? null, fingerprint: job.fingerprint }
          });
        }
        return this.store.update('production_job', job.id, (current) => freeze({
          ...current, status: 'ready', asset, providerRequestId: result.requestId ?? null,
          providerTraceId: result.traceId ?? null, billedCharacters, actualCostUsd,
          completedAt: nowIso(this.clock), lastError: null, updatedAt: nowIso(this.clock)
        }));
      } catch (error) {
        lastError = error;
        const classification = classifyProductionError(error);
        if (!classification.retryable || attempt >= plan.maxAttempts) break;
        const delay = retryDelayMs(attempt, { random: this.random });
        await this.sleep(delay);
      }
    }
    return this.store.update('production_job', job.id, (current) => freeze({
      ...current, status: 'failed', lastError: String(lastError?.message ?? lastError ?? 'render failed'),
      failedAt: nowIso(this.clock), updatedAt: nowIso(this.clock)
    }));
  }

  async run(planId, { maxJobs = null } = {}) {
    const plan = this.getPlan(planId);
    if (!plan.armed) throw new Error('production plan is not armed');
    this.store.update('production_plan', planId, (current) => freeze({ ...current, status: 'producing', updatedAt: nowIso(this.clock) }));
    let queue = this.store.list('production_job', (job) => job.planId === planId && job.status === 'queued');
    if (Number.isInteger(maxJobs) && maxJobs >= 0) queue = queue.slice(0, maxJobs);
    let cursor = 0;
    const results = [];
    const workers = Array.from({ length: Math.min(plan.concurrency, queue.length || 1) }, async () => {
      while (cursor < queue.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await this.renderJob(queue[index].id);
      }
    });
    await Promise.all(workers);
    const manifest = this.manifest(planId);
    const terminal = manifest.counts.failed ? 'needs_attention' : ((manifest.counts.queued ?? 0) + (manifest.counts.budget_blocked ?? 0) > 0 ? 'producing' : 'produced');
    this.store.update('production_plan', planId, (current) => freeze({ ...current, status: terminal, updatedAt: nowIso(this.clock) }));
    return freeze({ results: freeze(results), manifest: this.manifest(planId) });
  }

  manifest(planId) {
    const plan = this.getPlan(planId);
    const jobs = this.store.list('production_job', (job) => job.planId === planId);
    const counts = countStatuses(jobs);
    const ready = counts.ready ?? 0;
    const total = jobs.length;
    const actualSpendUsd = this.actualSpend(planId);
    const failed = jobs.filter((job) => job.status === 'failed').map((job) => ({ id: job.id, cueId: job.cueId, error: job.lastError }));
    return freeze({
      planId, status: plan.status, armed: plan.armed, totalJobs: total, counts: freeze(counts),
      completionPercent: total ? Number(((ready / total) * 100).toFixed(2)) : 0,
      initialEstimateUsd: plan.initialEstimateUsd, reserveBudgetUsd: plan.reserveBudgetUsd,
      projectedTotalUsd: plan.projectedTotalUsd, hardBudgetUsd: plan.hardBudgetUsd,
      actualSpendUsd, remainingHardBudgetUsd: roundMoney(Math.max(0, plan.hardBudgetUsd - actualSpendUsd)),
      regenerationCommittedUsd: this.regenerationCommitted(planId), failed: freeze(failed)
    });
  }
}
