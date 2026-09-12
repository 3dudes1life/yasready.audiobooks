import { randomUUID } from 'node:crypto';
import { renderFingerprint } from '../core/hash.js';
import { normalizeVoiceProfile, scoreSeriesSafety, rankVoiceCandidates } from '../casting/voice-profile.js';

const nowIso = (clock) => clock().toISOString();
const freeze = (value) => Object.freeze(value);

function requireValue(value, label) {
  if (value === undefined || value === null || value === '') throw new Error(`Casting Room requires ${label}`);
  return value;
}

export class CastingRoomService {
  constructor(store, { clock = () => new Date(), minimumSeriesSafety = 70 } = {}) {
    if (!store) throw new Error('CastingRoomService requires a store');
    this.store = store;
    this.clock = clock;
    this.minimumSeriesSafety = minimumSeriesSafety;
  }

  stageCandidate({ projectId, seriesId = null, bookId = null, characterId, voice, provider = voice?.provider ?? 'unknown', desiredLanguage = 'en', notes = null }) {
    requireValue(projectId, 'projectId');
    requireValue(characterId, 'characterId');
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
    if (moneyGuard) {
      const guard = moneyGuardId ? moneyGuard.getGuard(moneyGuardId) : moneyGuard.activeGuardForProject(plan.projectId);
      if (!guard) throw new Error('Money Guard required for paid audition but no active project guard exists');
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
        const existing = this.store.list('audition_take', (take) => take.fingerprint === fingerprint)[0];
        if (existing) { takes.push(existing); continue; }
        const moneyAuthorization = moneyAuthorizations.get(candidate.provider) ?? null;
        if (moneyAuthorization) {
          const guard = moneyGuard.getGuard(moneyAuthorization.guardId);
          if (guard.status !== 'active') throw new Error(`Money Guard is ${guard.status}; audition provider call blocked`);
        }
        const result = await provider.render({ voiceId: candidate.providerVoiceId, text: script.text, model: plan.model });
        const lineEstimate = estimate.lines.find((line) => line.candidateId === candidateId && line.scriptId === script.id);
        const estimatedLineCost = lineEstimate?.amountUsd ?? null;
        const actualCostUsd = Number.isFinite(Number(result.estimatedCostUsd)) ? Number(result.estimatedCostUsd) : estimatedLineCost;
        // Capture billable spend before writing the asset; a storage failure does not make a provider call free.
        if (moneyAuthorization && actualCostUsd !== null) {
          moneyGuard.capture(moneyAuthorization.id, { amountUsd: actualCostUsd, units: result.billedCharacters ?? script.text.length, unitType: 'characters', metadata: { planId, candidateId, scriptId: script.id, fingerprint } });
        } else if (ledger && actualCostUsd !== null) {
          ledger.record({ projectId: plan.projectId, provider: candidate.provider, operation: 'audition_render', amountUsd: actualCostUsd, metadata: { planId, candidateId, scriptId: script.id, fingerprint } });
        }
        const asset = await assetSink(result, { plan, candidate, script, fingerprint });
        const take = this.store.put(freeze({
          id: randomUUID(), type: 'audition_take', projectId: plan.projectId, planId,
          characterId: plan.characterId, candidateId, scriptId: script.id, fingerprint,
          asset, estimatedCostUsd: actualCostUsd, status: 'ready', createdAt: nowIso(this.clock)
        }));
        takes.push(take);
      }
    }
    for (const authorization of moneyAuthorizations.values()) moneyGuard.release(authorization.id, { reason: 'audition plan completed; unused estimate buffer released' });
    this.store.update('audition_plan', plan.id, (current) => freeze({ ...current, status: 'rendered', moneyAuthorizationIds: freeze([...moneyAuthorizations.values()].map((row) => row.id)), updatedAt: nowIso(this.clock) }));
    return freeze(takes);
  }

  lockCast({ projectId, seriesId = null, bookId = null, characterId, candidateId, scope = seriesId ? 'series' : 'book', approvedBy = 'operator', overrideRisk = false, reason = null }) {
    const candidate = this.store.get('voice_candidate', candidateId);
    if (!candidate || candidate.projectId !== projectId || candidate.characterId !== characterId) throw new Error('candidate does not belong to this project/character');
    if (scope === 'series' && !seriesId) throw new Error('series cast lock requires seriesId');
    if (!['series', 'book'].includes(scope)) throw new Error('cast scope must be series or book');
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
