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

function accountedProviderCost(result, fallback = null) {
  const exact = Number(result?.actualCostUsd ?? result?.billedCostUsd);
  if (Number.isFinite(exact) && exact >= 0) return { amountUsd: roundMoney(exact), costBasis: 'provider-settled' };
  const estimatedFromBilling = Number(result?.estimatedCostUsd);
  if (Number.isFinite(estimatedFromBilling) && estimatedFromBilling >= 0) {
    return { amountUsd: roundMoney(estimatedFromBilling), costBasis: 'provider-billed-characters-estimate' };
  }
  const fallbackAmount = fallback === null || fallback === undefined || fallback === '' ? NaN : Number(fallback);
  return Number.isFinite(fallbackAmount) && fallbackAmount >= 0
    ? { amountUsd: roundMoney(fallbackAmount), costBasis: 'preflight-estimate' }
    : { amountUsd: null, costBasis: 'unknown' };
}

function assertAssetReference(asset) {
  if (!asset || typeof asset !== 'object') throw new Error('asset reference object is required');
  if (['audio', 'data', 'bytes', 'bytesData'].some((key) => key in asset)) throw new Error('production store accepts references only, not raw audio bytes');
  return asset;
}

export class ProductionEngineService {
  constructor(store, {
    directorService,
    providers = {},
    ledger = null,
    moneyGuard = null,
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
    this.moneyGuard = moneyGuard;
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
    const project = this.store.get('project', projectId);
    const book = this.store.get('book', bookId);
    const directorPlan = this.store.get('director_plan', directorPlanId);
    if (project && !book) throw new Error('production requires a book belonging to the project');
    if (book && book.projectId !== projectId) throw new Error('production book belongs to another project');
    if (project && !directorPlan) throw new Error('production requires an Audiobook Director plan belonging to the project/book');
    if (directorPlan && (directorPlan.projectId !== projectId || directorPlan.bookId !== bookId)) {
      throw new Error('production Director plan belongs to another project/book');
    }
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

  #assertDirectorTruth(plan, { cue = null, requireLocked = false } = {}) {
    const director = this.store.get('director_plan', plan.directorPlanId);
    if (this.store.get('project', plan.projectId) && !director) {
      throw new Error('production Audiobook Director plan is missing');
    }
    if (director) {
      if (director.projectId !== plan.projectId || director.bookId !== plan.bookId) {
        throw new Error('production Director plan belongs to another project/book');
      }
      if (requireLocked && !director.locked) throw new Error('production requires a locked Audiobook Director plan');
    }
    if (cue) {
      if (cue.planId !== plan.directorPlanId) throw new Error(`director_cue ${cue.id} belongs to another director plan`);
      if (cue.projectId && cue.projectId !== plan.projectId) throw new Error(`director_cue ${cue.id} belongs to another project`);
      if (director && requireLocked && !cue.locked) throw new Error(`production requires locked director_cue ${cue.id}`);
    }
    return director;
  }

  async planCues(planId, { cueIds, resolveVoice, pronunciationVersion = null, voiceSettings = null, languageCode = null } = {}) {
    const plan = this.getPlan(planId);
    if (plan.armed) throw new Error('cannot re-plan an armed production');
    if (!Array.isArray(cueIds) || !cueIds.length) throw new Error('planCues requires cueIds');
    if (typeof resolveVoice !== 'function') throw new Error('planCues requires resolveVoice');
    this.#assertDirectorTruth(plan, { requireLocked: true });
    const provider = this.providers[plan.provider];
    if (!provider) throw new Error(`provider ${plan.provider} is unavailable`);

    const jobs = [];
    for (const cueId of cueIds) {
      const cue = this.store.get('director_cue', cueId);
      if (!cue) throw new Error(`director_cue ${cueId} not found`);
      this.#assertDirectorTruth(plan, { cue, requireLocked: true });
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
          providerTraceId: null, billedCharacters: null, accountedCostUsd: null, actualCostUsd: null, costBasis: null, lastError: null, failureStage: null,
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

  arm(planId, { approvedBy, reason = null, moneyGuardId = null } = {}) {
    const plan = this.getPlan(planId);
    if (!String(approvedBy ?? '').trim()) throw new Error('arming production requires approvedBy');
    this.#assertDirectorTruth(plan, { requireLocked: true });
    for (const job of this.store.list('production_job', (row) => row.planId === planId)) {
      const cue = this.store.get('director_cue', job.cueId);
      if (cue) this.#assertDirectorTruth(plan, { cue, requireLocked: true });
    }
    const preflight = this.preflight(planId);
    if (!preflight.withinBudget) throw new Error(`production blocked: projected $${preflight.projectedTotalUsd.toFixed(2)} exceeds $${preflight.hardBudgetUsd.toFixed(2)} budget`);
    let moneyAuthorization = null;
    if (this.moneyGuard) {
      const guard = moneyGuardId ? this.moneyGuard.getGuard(moneyGuardId) : this.moneyGuard.activeGuardForProject(plan.projectId);
      if (!guard) throw new Error('Money Guard required for paid production but no active project guard exists');
      if (guard.projectId !== plan.projectId) throw new Error('Money Guard belongs to another project');
      moneyAuthorization = this.moneyGuard.authorize(guard.id, {
        provider: plan.provider, operation: 'production_render', estimatedCostUsd: preflight.projectedTotalUsd,
        approvedBy, reason: reason || 'Production Engine arm', metadata: { planId: plan.id, bookId: plan.bookId }
      });
    }
    return this.store.update('production_plan', planId, (current) => freeze({
      ...current, armed: true, status: 'armed', approvedBy, armReason: reason,
      moneyAuthorizationId: moneyAuthorization?.id ?? null, moneyGuardId: moneyAuthorization?.guardId ?? null,
      armedAt: nowIso(this.clock), updatedAt: nowIso(this.clock)
    }));
  }

  disarm(planId, { reason }) {
    if (!String(reason ?? '').trim()) throw new Error('disarming production requires a reason');
    const plan = this.getPlan(planId);
    if (this.moneyGuard && plan.moneyAuthorizationId) this.moneyGuard.release(plan.moneyAuthorizationId, { reason: `production disarmed: ${reason}` });
    return this.store.update('production_plan', planId, (current) => freeze({
      ...current, armed: false, status: 'paused', disarmReason: reason, updatedAt: nowIso(this.clock)
    }));
  }

  accountedSpend(planId) {
    return roundMoney(this.store.list('production_job', (job) => job.planId === planId)
      .reduce((sum, job) => sum + (job.accountedCostUsd ?? job.actualCostUsd ?? 0), 0));
  }

  actualSpend(planId) {
    return roundMoney(this.store.list('production_job', (job) => job.planId === planId)
      .reduce((sum, job) => sum + (Number.isFinite(Number(job.actualCostUsd)) ? Number(job.actualCostUsd) : 0), 0));
  }

  regenerationCommitted(planId) {
    return roundMoney(this.store.list('production_job', (job) => job.planId === planId && job.budgetClass === 'regeneration')
      .reduce((sum, job) => sum + (job.accountedCostUsd ?? job.actualCostUsd ?? job.estimatedCostUsd ?? 0), 0));
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
      providerRequestId: null, providerTraceId: null, billedCharacters: null, accountedCostUsd: null, actualCostUsd: null, costBasis: null,
      lastError: null, failureStage: null, createdAt: nowIso(this.clock), updatedAt: nowIso(this.clock)
    }));
  }

  retryFailedJob(jobId, { reason, approvedBy = 'operator' } = {}) {
    if (!String(reason ?? '').trim() || !String(approvedBy ?? '').trim()) throw new Error('retrying a failed production job requires approvedBy and reason');
    const job = this.store.get('production_job', jobId);
    if (!job) throw new Error(`production_job ${jobId} not found`);
    if (job.status !== 'failed') throw new Error('only failed production jobs may be retried');
    if (job.failureStage === 'asset-storage') {
      throw new Error('asset-storage failure crossed the billing boundary; recover the stored asset or request an explicit new paid take instead of silently re-calling the provider');
    }
    if (job.failureStage !== 'provider-render') throw new Error(`production retry is not supported for failure stage ${job.failureStage ?? 'unknown'}`);
    const plan = this.getPlan(job.planId);
    const cue = this.store.get('director_cue', job.cueId);
    if (cue) this.#assertDirectorTruth(plan, { cue, requireLocked: true });
    else this.#assertDirectorTruth(plan, { requireLocked: true });
    const history = [...(job.retryHistory ?? []), freeze({
      failedAt: job.failedAt ?? null, failureStage: job.failureStage, error: job.lastError ?? null,
      priorAttemptCount: job.attemptCount ?? 0, approvedBy: String(approvedBy).trim(), reason: String(reason).trim(), requeuedAt: nowIso(this.clock)
    })];
    return this.store.update('production_job', jobId, (current) => freeze({
      ...current, status: 'queued', attemptCount: 0, lastError: null, failureStage: null, failedAt: null,
      retryHistory: freeze(history), lastRetryReason: String(reason).trim(), retriedBy: String(approvedBy).trim(),
      updatedAt: nowIso(this.clock)
    }));
  }

  recoverStoredAsset(jobId, { asset, reason, approvedBy = 'operator' } = {}) {
    if (!String(reason ?? '').trim() || !String(approvedBy ?? '').trim()) throw new Error('recovering a production asset requires approvedBy and reason');
    const job = this.store.get('production_job', jobId);
    if (!job) throw new Error(`production_job ${jobId} not found`);
    if (job.status !== 'failed' || job.failureStage !== 'asset-storage') throw new Error('asset recovery is only valid after an asset-storage failure');
    const reference = assertAssetReference(asset);
    return this.store.update('production_job', jobId, (current) => freeze({
      ...current, status: 'ready', asset: freeze({ ...reference }), lastError: null, failureStage: null,
      recoveredBy: String(approvedBy).trim(), recoveryReason: String(reason).trim(), recoveredAt: nowIso(this.clock),
      completedAt: nowIso(this.clock), updatedAt: nowIso(this.clock)
    }));
  }

  findReusable(job) {
    if (!job.reuseAllowed) return null;
    return this.store.list('production_job', (candidate) =>
      candidate.id !== job.id && candidate.projectId === job.projectId && candidate.fingerprint === job.fingerprint && candidate.status === 'ready' && candidate.asset
    )[0] ?? null;
  }

  async renderJob(jobId) {
    const job = this.store.get('production_job', jobId);
    if (!job) throw new Error(`production_job ${jobId} not found`);
    const plan = this.getPlan(job.planId);
    if (!plan.armed) throw new Error('production plan is not armed');
    const directorCue = this.store.get('director_cue', job.cueId);
    if (directorCue) this.#assertDirectorTruth(plan, { cue: directorCue, requireLocked: true });
    else this.#assertDirectorTruth(plan, { requireLocked: true });
    if (!['queued', 'retrying'].includes(job.status)) return job;

    const reusable = this.findReusable(job);
    if (reusable) {
      return this.store.update('production_job', job.id, (current) => freeze({
        ...current, status: 'ready', asset: reusable.asset, reusedFromJobId: reusable.id,
        accountedCostUsd: 0, actualCostUsd: 0, costBasis: 'reused', billedCharacters: 0, failureStage: null, updatedAt: nowIso(this.clock)
      }));
    }

    if (this.accountedSpend(plan.id) + job.estimatedCostUsd > plan.hardBudgetUsd) {
      return this.store.update('production_job', job.id, (current) => freeze({
        ...current, status: 'budget_blocked', lastError: 'hard production budget would be exceeded', updatedAt: nowIso(this.clock)
      }));
    }
    if (this.moneyGuard && plan.moneyAuthorizationId) {
      const auth = this.store.get('money_authorization', plan.moneyAuthorizationId);
      if (!auth) throw new Error('Money Guard authorization missing; provider call blocked');
      const guard = this.moneyGuard.getGuard(auth.guardId);
      if (guard.status !== 'active') {
        return this.store.update('production_job', job.id, (current) => freeze({
          ...current, status: 'budget_blocked', lastError: `Money Guard is ${guard.status}`, updatedAt: nowIso(this.clock)
        }));
      }
    }
    const provider = this.providers[job.provider];
    if (!provider) throw new Error(`provider ${job.provider} is unavailable`);
    if (typeof this.assetSink !== 'function') throw new Error('production rendering requires assetSink');

    let lastError = null;
    let providerResult = null;
    let billedCharacters = null;
    let accountedCost = null;

    // Retry only the provider request. Once the provider returns successfully, YasReady has crossed
    // the billing boundary and must never call TTS again merely because downstream storage failed.
    for (let attempt = job.attemptCount + 1; attempt <= plan.maxAttempts; attempt += 1) {
      this.store.update('production_job', job.id, (current) => freeze({
        ...current, status: attempt === 1 ? 'rendering' : 'retrying', attemptCount: attempt,
        failureStage: null, updatedAt: nowIso(this.clock)
      }));
      try {
        providerResult = await provider.render({
          voiceId: job.voiceId, text: job.renderText, model: job.model, outputFormat: job.outputFormat,
          voiceSettings: job.voiceSettings, languageCode: job.languageCode,
          previousText: job.previousText, nextText: job.nextText
        });
        billedCharacters = Number.isFinite(Number(providerResult.billedCharacters)) ? Number(providerResult.billedCharacters) : job.estimatedCharacters;
        accountedCost = accountedProviderCost(providerResult, job.estimatedCostUsd);

        if (this.moneyGuard && plan.moneyAuthorizationId && accountedCost.amountUsd !== null) {
          this.moneyGuard.capture(plan.moneyAuthorizationId, {
            amountUsd: accountedCost.amountUsd, units: billedCharacters, unitType: 'characters',
            providerCall: true, costBasis: accountedCost.costBasis,
            metadata: { planId: plan.id, jobId: job.id, cueId: job.cueId, requestId: providerResult.requestId ?? null, fingerprint: job.fingerprint, budgetClass: job.budgetClass }
          });
        } else if (this.ledger && accountedCost.amountUsd !== null) {
          this.ledger.record({
            projectId: plan.projectId, provider: job.provider, operation: job.budgetClass === 'regeneration' ? 'production_regeneration' : 'production_render',
            amountUsd: accountedCost.amountUsd, units: billedCharacters, unitType: 'characters',
            metadata: { planId: plan.id, jobId: job.id, cueId: job.cueId, requestId: providerResult.requestId ?? null, fingerprint: job.fingerprint, providerCall: true, costBasis: accountedCost.costBasis }
          });
        }

        this.store.update('production_job', job.id, (current) => freeze({
          ...current, status: 'rendered_pending_storage', providerRequestId: providerResult.requestId ?? null,
          providerTraceId: providerResult.traceId ?? null, billedCharacters,
          accountedCostUsd: accountedCost.amountUsd,
          actualCostUsd: accountedCost.costBasis === 'provider-settled' ? accountedCost.amountUsd : null,
          costBasis: accountedCost.costBasis, providerCompletedAt: nowIso(this.clock), lastError: null,
          failureStage: null, updatedAt: nowIso(this.clock)
        }));
        break;
      } catch (error) {
        lastError = error;
        providerResult = null;
        const classification = classifyProductionError(error);
        if (!classification.retryable || attempt >= plan.maxAttempts) break;
        const delay = retryDelayMs(attempt, { random: this.random });
        await this.sleep(delay);
      }
    }

    if (!providerResult) {
      return this.store.update('production_job', job.id, (current) => freeze({
        ...current, status: 'failed', lastError: String(lastError?.message ?? lastError ?? 'render failed'),
        failureStage: 'provider-render', failedAt: nowIso(this.clock), updatedAt: nowIso(this.clock)
      }));
    }

    try {
      const asset = assertAssetReference(await this.assetSink(providerResult, { plan, job: this.store.get('production_job', job.id) }));
      return this.store.update('production_job', job.id, (current) => freeze({
        ...current, status: 'ready', asset: freeze({ ...asset }),
        completedAt: nowIso(this.clock), lastError: null, failureStage: null, updatedAt: nowIso(this.clock)
      }));
    } catch (error) {
      return this.store.update('production_job', job.id, (current) => freeze({
        ...current, status: 'failed', lastError: String(error?.message ?? error ?? 'asset storage failed'),
        failureStage: 'asset-storage', failedAt: nowIso(this.clock), updatedAt: nowIso(this.clock)
      }));
    }
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
    const accountedSpendUsd = this.accountedSpend(planId);
    const providerSettledSpendUsd = this.actualSpend(planId);
    const estimatedOrUnsettledSpendUsd = roundMoney(Math.max(0, accountedSpendUsd - providerSettledSpendUsd));
    const actualSpendUsd = estimatedOrUnsettledSpendUsd === 0 ? providerSettledSpendUsd : null;
    const failed = jobs.filter((job) => job.status === 'failed').map((job) => ({ id: job.id, cueId: job.cueId, error: job.lastError, failureStage: job.failureStage ?? null }));
    return freeze({
      planId, status: plan.status, armed: plan.armed, totalJobs: total, counts: freeze(counts),
      completionPercent: total ? Number(((ready / total) * 100).toFixed(2)) : 0,
      initialEstimateUsd: plan.initialEstimateUsd, reserveBudgetUsd: plan.reserveBudgetUsd,
      projectedTotalUsd: plan.projectedTotalUsd, hardBudgetUsd: plan.hardBudgetUsd,
      accountedSpendUsd, providerSettledSpendUsd, estimatedOrUnsettledSpendUsd, actualSpendUsd,
      spendBasis: estimatedOrUnsettledSpendUsd === 0 ? 'provider-settled' : 'accounted-estimate',
      remainingHardBudgetUsd: roundMoney(Math.max(0, plan.hardBudgetUsd - accountedSpendUsd)),
      regenerationCommittedUsd: this.regenerationCommitted(planId),
      moneyGuard: this.moneyGuard && plan.moneyGuardId ? this.moneyGuard.report(plan.moneyGuardId) : null,
      failed: freeze(failed)
    });
  }
}
