import { randomUUID } from 'node:crypto';
import { renderFingerprint } from '../core/hash.js';
import { normalizeVoiceProfile, scoreSeriesSafety, rankVoiceCandidates } from '../casting/voice-profile.js';

const nowIso = (clock) => clock().toISOString();
const freeze = (value) => Object.freeze(value);

function requireValue(value, label) {
  if (value === undefined || value === null || value === '') throw new Error(`Casting Room requires ${label}`);
  return value;
}

function assertAssetReference(asset) {
  if (!asset || typeof asset !== 'object') throw new Error('Casting Room assetSink must return an asset reference object');
  if (['audio', 'data', 'bytes', 'bytesData'].some((key) => key in asset)) {
    throw new Error('Casting Room stores asset references, not raw audio bytes');
  }
  return asset;
}

function accountedProviderCost(result, fallback = null) {
  const exact = Number(result?.actualCostUsd ?? result?.billedCostUsd);
  if (Number.isFinite(exact) && exact >= 0) return { amountUsd: exact, costBasis: 'provider-settled' };
  const estimatedFromBilling = Number(result?.estimatedCostUsd);
  if (Number.isFinite(estimatedFromBilling) && estimatedFromBilling >= 0) {
    return { amountUsd: estimatedFromBilling, costBasis: 'provider-billed-characters-estimate' };
  }
  const fallbackAmount = fallback === null || fallback === undefined || fallback === '' ? NaN : Number(fallback);
  return Number.isFinite(fallbackAmount) && fallbackAmount >= 0
    ? { amountUsd: fallbackAmount, costBasis: 'preflight-estimate' }
    : { amountUsd: null, costBasis: 'unknown' };
}

export class CastingRoomService {
  constructor(store, { clock = () => new Date(), minimumSeriesSafety = 70 } = {}) {
    if (!store) throw new Error('CastingRoomService requires a store');
    this.store = store;
    this.clock = clock;
    this.minimumSeriesSafety = minimumSeriesSafety;
  }

  #characterVisibleToBook({ projectId, characterBibleId, bookId }) {
    const bookBibles = this.store.list('audio_bible', (bible) =>
      bible.projectId === projectId && bible.scope === 'book' && bible.bookId === bookId
    );
    for (const bookBible of bookBibles) {
      const seen = new Set();
      let current = bookBible;
      while (current && current.projectId === projectId && !seen.has(current.id)) {
        if (current.id === characterBibleId) return true;
        seen.add(current.id);
        current = current.parentBibleId ? this.store.get('audio_bible', current.parentBibleId) : null;
      }
    }
    return false;
  }

  #assertCharacterOwnership({ projectId, characterId, seriesId = null, bookId = null }) {
    const project = this.store.get('project', projectId);
    const character = this.store.get('character', characterId);
    if (project && !character) throw new Error('Casting Room character was not found in this project');
    if (character && character.projectId !== projectId) throw new Error('Casting Room character belongs to another project');

    let characterBible = null;
    if (character?.bibleId) {
      characterBible = this.store.get('audio_bible', character.bibleId);
      if (project && !characterBible) throw new Error('Casting Room character Audio Bible was not found in this project');
      if (characterBible && characterBible.projectId !== projectId) throw new Error('Casting Room character Audio Bible belongs to another project');
    }
    if (seriesId) {
      const series = this.store.get('series', seriesId);
      if (project && !series) throw new Error('Casting Room series was not found in this project');
      if (series && series.projectId !== projectId) throw new Error('Casting Room series belongs to another project');
      if (project && character && (!characterBible || characterBible.seriesId !== seriesId)) {
        throw new Error('Casting Room character does not belong to this series');
      }
    }
    if (bookId) {
      const book = this.store.get('book', bookId);
      if (project && !book) throw new Error('Casting Room book was not found in this project');
      if (book && book.projectId !== projectId) throw new Error('Casting Room book belongs to another project');
      if (project && character && (!characterBible || !this.#characterVisibleToBook({ projectId, characterBibleId: characterBible.id, bookId }))) {
        throw new Error('Casting Room character is not visible to this book');
      }
    }
    return character;
  }

  stageCandidate({ projectId, seriesId = null, bookId = null, characterId, voice, provider = voice?.provider ?? 'unknown', desiredLanguage = 'en', notes = null }) {
    requireValue(projectId, 'projectId');
    requireValue(characterId, 'characterId');
    this.#assertCharacterOwnership({ projectId, characterId, seriesId, bookId });
    const normalized = voice?.providerVoiceId ? voice : normalizeVoiceProfile(voice, { provider });
    requireValue(normalized.providerVoiceId, 'providerVoiceId');
    const safety = scoreSeriesSafety(normalized, { desiredLanguage });
    const duplicate = this.store.list('voice_candidate', (item) => item.projectId === projectId && item.characterId === characterId && item.provider === provider && item.providerVoiceId === normalized.providerVoiceId)[0];
    if (duplicate) return duplicate;
    return this.store.put(freeze({
      id: randomUUID(), type: 'voice_candidate', projectId, seriesId, bookId, characterId,
      provider, providerVoiceId: normalized.providerVoiceId, voice: normalized, safety, notes,
      status: 'staged', createdAt: nowIso(this.clock), updatedAt: nowIso(this.clock)
    }));
  }

  rankCandidates({ projectId, characterId, desiredLanguage = 'en' }) {
    const candidates = this.store.list('voice_candidate', (item) => item.projectId === projectId && item.characterId === characterId);
    const ranked = rankVoiceCandidates(candidates.map((item) => item.voice), { desiredLanguage });
    const byVoice = new Map(candidates.map((item) => [item.providerVoiceId, item]));
    return ranked.map(({ voice, safety }) => freeze({ candidate: byVoice.get(voice.providerVoiceId), safety }));
  }

  createAuditionPlan({ projectId, characterId, candidateIds, scripts, model = 'eleven_multilingual_v2', maxSpendUsd = 2 }) {
    requireValue(projectId, 'projectId');
    requireValue(characterId, 'characterId');
    this.#assertCharacterOwnership({ projectId, characterId });
    if (!Array.isArray(candidateIds) || candidateIds.length < 1) throw new Error('audition plan requires at least one candidate');
    if (!Array.isArray(scripts) || scripts.length < 1) throw new Error('audition plan requires at least one script');
    const normalizedScripts = scripts.map((script, index) => ({
      id: script.id ?? `script-${index + 1}`,
      label: script.label ?? `Sample ${index + 1}`,
      text: String(script.text ?? '').trim(),
      purpose: script.purpose ?? 'general'
    }));
    if (normalizedScripts.some((script) => !script.text)) throw new Error('audition scripts cannot be empty');
    for (const id of candidateIds) {
      const candidate = this.store.get('voice_candidate', id);
      if (!candidate || candidate.projectId !== projectId || candidate.characterId !== characterId) throw new Error(`candidate ${id} is not valid for this character`);
    }
    return this.store.put(freeze({
      id: randomUUID(), type: 'audition_plan', projectId, characterId,
      candidateIds: freeze([...candidateIds]), scripts: freeze(normalizedScripts.map(freeze)), model,
      maxSpendUsd: Number(maxSpendUsd), status: 'planned', createdAt: nowIso(this.clock), updatedAt: nowIso(this.clock)
    }));
  }

  async estimateAudition(planId, providers) {
    const plan = this.store.get('audition_plan', planId);
    if (!plan) throw new Error(`audition plan ${planId} not found`);
    let total = 0;
    const lines = [];
    for (const candidateId of plan.candidateIds) {
      const candidate = this.store.get('voice_candidate', candidateId);
      const provider = providers[candidate.provider];
      if (!provider) throw new Error(`provider ${candidate.provider} is unavailable`);
      for (const script of plan.scripts) {
        const estimate = await provider.estimateCost({ text: script.text, model: plan.model });
        if (estimate.amountUsd === null) throw new Error(`provider ${candidate.provider} cannot estimate audition cost for ${plan.model}`);
        total += estimate.amountUsd;
        lines.push({ candidateId, scriptId: script.id, ...estimate });
      }
    }
    return freeze({ planId, amountUsd: Number(total.toFixed(6)), withinBudget: total <= plan.maxSpendUsd, lines: freeze(lines.map(freeze)) });
  }

  async renderAudition(planId, { providers, assetSink, ledger = null, moneyGuard = null, moneyGuardId = null, approvedBy = null, allowOverBudget = false } = {}) {
    const plan = this.store.get('audition_plan', planId);
    if (!plan) throw new Error(`audition plan ${planId} not found`);
    if (typeof assetSink !== 'function') throw new Error('renderAudition requires assetSink');
    const estimate = await this.estimateAudition(planId, providers);
    if (!estimate.withinBudget && !allowOverBudget) {
      throw new Error(`audition estimate $${estimate.amountUsd.toFixed(2)} exceeds $${plan.maxSpendUsd.toFixed(2)} budget`);
    }

    const moneyAuthorizations = new Map();
    let completed = false;
    try {
      if (moneyGuard) {
        const guard = moneyGuardId ? moneyGuard.getGuard(moneyGuardId) : moneyGuard.activeGuardForProject(plan.projectId);
        if (!guard) throw new Error('Money Guard required for paid audition but no active project guard exists');
        if (guard.projectId !== plan.projectId) throw new Error('Money Guard belongs to another project');
        const byProvider = new Map();
        for (const line of estimate.lines) {
          const candidate = this.store.get('voice_candidate', line.candidateId);
          byProvider.set(candidate.provider, Number(((byProvider.get(candidate.provider) ?? 0) + line.amountUsd).toFixed(6)));
        }
        for (const [providerName, amountUsd] of byProvider.entries()) {
          const authorization = moneyGuard.authorize(guard.id, {
            provider: providerName, operation: 'audition_render', estimatedCostUsd: amountUsd,
            approvedBy, reason: 'Casting Room audition plan', metadata: { planId: plan.id, characterId: plan.characterId }
          });
          moneyAuthorizations.set(providerName, authorization);
        }
      }

      const takes = [];
      for (const candidateId of plan.candidateIds) {
        const candidate = this.store.get('voice_candidate', candidateId);
        const provider = providers[candidate.provider];
        for (const script of plan.scripts) {
          const fingerprint = renderFingerprint({ text: script.text, provider: candidate.provider, model: plan.model, voiceId: candidate.providerVoiceId, settings: { audition: true, purpose: script.purpose } });
          const existing = this.store.list('audition_take', (take) =>
            take.projectId === plan.projectId && take.planId === plan.id && take.candidateId === candidateId && take.scriptId === script.id && take.fingerprint === fingerprint && take.status === 'ready'
          )[0];
          if (existing) { takes.push(existing); continue; }

          const moneyAuthorization = moneyAuthorizations.get(candidate.provider) ?? null;
          if (moneyAuthorization) {
            const guard = moneyGuard.getGuard(moneyAuthorization.guardId);
            if (guard.status !== 'active') throw new Error(`Money Guard is ${guard.status}; audition provider call blocked`);
          }

          const result = await provider.render({ voiceId: candidate.providerVoiceId, text: script.text, model: plan.model });
          const lineEstimate = estimate.lines.find((line) => line.candidateId === candidateId && line.scriptId === script.id);
          const accounted = accountedProviderCost(result, lineEstimate?.amountUsd ?? null);
          if (moneyAuthorization && accounted.amountUsd !== null) {
            moneyGuard.capture(moneyAuthorization.id, {
              amountUsd: accounted.amountUsd,
              units: result.billedCharacters ?? script.text.length,
              unitType: 'characters',
              providerCall: true,
              costBasis: accounted.costBasis,
              metadata: { planId, candidateId, scriptId: script.id, fingerprint, requestId: result.requestId ?? null }
            });
          } else if (ledger && accounted.amountUsd !== null) {
            ledger.record({
              projectId: plan.projectId, provider: candidate.provider, operation: 'audition_render', amountUsd: accounted.amountUsd,
              units: result.billedCharacters ?? script.text.length, unitType: 'characters',
              metadata: { planId, candidateId, scriptId: script.id, fingerprint, providerCall: true, costBasis: accounted.costBasis, requestId: result.requestId ?? null }
            });
          }

          const asset = assertAssetReference(await assetSink(result, { plan, candidate, script, fingerprint }));
          const take = this.store.put(freeze({
            id: randomUUID(), type: 'audition_take', projectId: plan.projectId, planId,
            characterId: plan.characterId, candidateId, scriptId: script.id, fingerprint,
            asset: freeze({ ...asset }), accountedCostUsd: accounted.amountUsd,
            actualCostUsd: accounted.costBasis === 'provider-settled' ? accounted.amountUsd : null,
            costBasis: accounted.costBasis, status: 'ready', createdAt: nowIso(this.clock)
          }));
          takes.push(take);
        }
      }
      completed = true;
      this.store.update('audition_plan', plan.id, (current) => freeze({
        ...current, status: 'rendered', moneyAuthorizationIds: freeze([...moneyAuthorizations.values()].map((row) => row.id)), updatedAt: nowIso(this.clock)
      }));
      return freeze(takes);
    } catch (error) {
      this.store.update('audition_plan', plan.id, (current) => freeze({
        ...current, status: 'needs_attention', lastError: String(error?.message ?? error),
        moneyAuthorizationIds: freeze([...moneyAuthorizations.values()].map((row) => row.id)), updatedAt: nowIso(this.clock)
      }));
      throw error;
    } finally {
      if (moneyGuard) {
        for (const authorization of moneyAuthorizations.values()) {
          const current = this.store.get('money_authorization', authorization.id);
          if (current && ['authorized', 'partially_captured', 'captured'].includes(current.status)) {
            moneyGuard.release(authorization.id, { reason: completed ? 'audition plan completed; unused estimate buffer released' : 'audition plan stopped; unused reservation released' });
          }
        }
      }
    }
  }

  lockCast({ projectId, seriesId = null, bookId = null, characterId, candidateId, scope = seriesId ? 'series' : 'book', approvedBy = 'operator', overrideRisk = false, reason = null }) {
    if (!['series', 'book'].includes(scope)) throw new Error('cast scope must be series or book');
    if (scope === 'series' && !seriesId) throw new Error('series cast lock requires seriesId');
    if (scope === 'book' && !bookId) throw new Error('book cast lock requires bookId');
    this.#assertCharacterOwnership({ projectId, characterId, seriesId, bookId });
    const candidate = this.store.get('voice_candidate', candidateId);
    if (!candidate || candidate.projectId !== projectId || candidate.characterId !== characterId) throw new Error('candidate does not belong to this project/character');
    if (candidate.safety.score < this.minimumSeriesSafety && scope === 'series' && !overrideRisk) {
      throw new Error(`series cast lock blocked: safety score ${candidate.safety.score}/${this.minimumSeriesSafety}`);
    }
    if (overrideRisk && !String(reason ?? '').trim()) throw new Error('risk override requires a reason');

    const existing = this.store.list('voice_assignment', (item) => item.projectId === projectId && item.characterId === characterId && item.scope === scope && (scope !== 'series' || item.seriesId === seriesId) && (scope !== 'book' || item.bookId === bookId))[0];
    if (existing?.locked) throw new Error('cast assignment is locked; unlock it explicitly before recasting');
    const record = freeze({
      id: existing?.id ?? randomUUID(), type: 'voice_assignment', projectId, seriesId, bookId,
      characterId, scope, provider: candidate.provider, providerVoiceId: candidate.providerVoiceId,
      candidateId, safetySnapshot: candidate.safety, locked: true, approvedBy,
      riskOverride: Boolean(overrideRisk), riskOverrideReason: reason,
      source: 'casting-room',
      createdAt: existing?.createdAt ?? nowIso(this.clock), updatedAt: nowIso(this.clock)
    });
    return existing ? this.store.update('voice_assignment', existing.id, () => record) : this.store.put(record);
  }

  importSeriesAssignment({
    projectId, seriesId, characterId, provider, providerVoiceId, safetyScore,
    approvedBy = 'series-continuity', overrideRisk = false, reason = null
  }) {
    requireValue(projectId, 'projectId');
    requireValue(seriesId, 'seriesId');
    requireValue(characterId, 'characterId');
    this.#assertCharacterOwnership({ projectId, characterId, seriesId });
    requireValue(provider, 'provider');
    requireValue(providerVoiceId, 'providerVoiceId');
    const score = Number(safetyScore);
    if (!Number.isFinite(score) || score < 0 || score > 100) throw new Error('imported series voice requires safetyScore between 0 and 100');
    if (score < this.minimumSeriesSafety && !overrideRisk) {
      throw new Error(`series cast import blocked: safety score ${score}/${this.minimumSeriesSafety}`);
    }
    if (overrideRisk && !String(reason ?? '').trim()) throw new Error('risk override requires a reason');

    const existing = this.store.list('voice_assignment', (item) =>
      item.projectId === projectId && item.seriesId === seriesId && item.characterId === characterId && item.scope === 'series'
    )[0];
    if (existing?.locked) {
      if (existing.provider === provider && existing.providerVoiceId === providerVoiceId) return existing;
      throw new Error('series cast assignment is locked; explicit Casting Room unlock is required before recasting');
    }
    const record = freeze({
      id: existing?.id ?? randomUUID(), type: 'voice_assignment', projectId, seriesId, bookId: null,
      characterId, scope: 'series', provider, providerVoiceId, candidateId: null,
      safetySnapshot: freeze({ score, source: 'series-continuity-package' }), locked: true, approvedBy,
      riskOverride: Boolean(overrideRisk), riskOverrideReason: reason,
      source: 'series-continuity-package',
      createdAt: existing?.createdAt ?? nowIso(this.clock), updatedAt: nowIso(this.clock)
    });
    return existing ? this.store.update('voice_assignment', existing.id, () => record) : this.store.put(record);
  }

  unlockCast(assignmentId, { reason, approvedBy = 'operator' } = {}) {
    if (!String(reason ?? '').trim()) throw new Error('unlocking cast requires a reason');
    return this.store.update('voice_assignment', assignmentId, (current) => freeze({
      ...current, locked: false, unlockReason: reason, unlockedBy: approvedBy, updatedAt: nowIso(this.clock)
    }));
  }

  resolveCast({ projectId, characterId, seriesId = null, bookId = null }) {
    const assignments = this.store.list('voice_assignment', (item) => item.projectId === projectId && item.characterId === characterId && item.locked);
    const book = assignments.find((item) => item.scope === 'book' && bookId && item.bookId === bookId);
    if (book) return freeze({ assignment: book, source: 'book' });
    const series = assignments.find((item) => item.scope === 'series' && seriesId && item.seriesId === seriesId);
    return series ? freeze({ assignment: series, source: 'series' }) : null;
  }
}
