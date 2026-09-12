import { randomUUID } from 'node:crypto';
import {
  compareTranscript,
  findAdjacentDuplicates,
  pronunciationRisks,
  alignmentAnomalies,
  transcriptConfidenceFindings
} from '../qa/text-diff.js';

const freeze = (value) => Object.freeze(value);
const nowIso = (clock) => clock().toISOString();

const DEFAULT_THRESHOLDS = Object.freeze({
  maxWordErrorRate: 0.025,
  failOnDeletion: true,
  failOnSubstitution: true,
  maxWordLoss: 1.25,
  maxAverageLoss: 1.0,
  maxGapMs: 2200,
  minLanguageProbability: 0.75,
  minWordLogprob: -1.2
});

function cleanThresholds(input = {}) {
  return freeze({ ...DEFAULT_THRESHOLDS, ...(input ?? {}) });
}

function validateAssetPayload(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('assetLoader must return an audio payload object');
  const audio = payload.audio ?? payload.data ?? payload.bytes ?? null;
  const sourceUrl = payload.sourceUrl ?? payload.url ?? null;
  if (!audio && !sourceUrl) throw new Error('assetLoader must return audio bytes/blob or sourceUrl');
  return freeze({
    audio,
    sourceUrl,
    fileName: payload.fileName ?? 'audiobook-qa.mp3',
    mediaType: payload.mediaType ?? 'audio/mpeg'
  });
}

function accountedProviderCost(result, fallback = null) {
  const exact = Number(result?.actualCostUsd ?? result?.billedCostUsd);
  if (Number.isFinite(exact) && exact >= 0) return { amountUsd: exact, costBasis: 'provider-settled' };
  const estimated = Number(result?.estimatedCostUsd);
  if (Number.isFinite(estimated) && estimated >= 0) return { amountUsd: estimated, costBasis: 'provider-estimate' };
  const fallbackAmount = fallback === null || fallback === undefined || fallback === '' ? NaN : Number(fallback);
  return Number.isFinite(fallbackAmount) && fallbackAmount >= 0
    ? { amountUsd: fallbackAmount, costBasis: 'preflight-estimate' }
    : { amountUsd: null, costBasis: 'unknown' };
}

async function qaEstimate(provider, kind, explicitAmount, context) {
  const explicit = explicitAmount === null || explicitAmount === undefined || explicitAmount === '' ? NaN : Number(explicitAmount);
  if (Number.isFinite(explicit) && explicit >= 0) return explicit;
  const method = kind === 'alignment' ? provider?.estimateAlignmentCost : provider?.estimateTranscriptionCost;
  if (typeof method === 'function') {
    const result = await method.call(provider, context);
    const amount = Number(result?.amountUsd ?? result);
    if (Number.isFinite(amount) && amount >= 0) return amount;
  }
  throw new Error(`Money Guard requires an estimated ${kind} cost before the QA provider call`);
}

function severityRank(severity) {
  return ({ critical: 4, high: 3, medium: 2, low: 1, info: 0 })[severity] ?? 0;
}

function transcriptFindings(comparison, thresholds) {
  const findings = [];
  if (comparison.deletions > 0) {
    findings.push({
      type: 'canonical-words-missing',
      severity: thresholds.failOnDeletion ? 'critical' : 'high',
      count: comparison.deletions,
      examples: comparison.missingExamples
    });
  }
  if (comparison.substitutions > 0) {
    findings.push({
      type: 'word-substitutions',
      severity: thresholds.failOnSubstitution ? 'high' : 'medium',
      count: comparison.substitutions,
      examples: comparison.substitutionExamples
    });
  }
  if (comparison.insertions > 0) {
    findings.push({
      type: 'unexpected-spoken-words', severity: 'medium', count: comparison.insertions,
      examples: comparison.extraExamples
    });
  }
  if (comparison.wordErrorRate > Number(thresholds.maxWordErrorRate)) {
    findings.push({
      type: 'word-error-rate', severity: 'high', value: comparison.wordErrorRate,
      threshold: Number(thresholds.maxWordErrorRate)
    });
  }
  return findings;
}

function runStatus(findings) {
  const unresolved = findings.filter((item) => item.status !== 'resolved' && item.status !== 'waived');
  if (unresolved.some((item) => severityRank(item.severity) >= severityRank('high'))) return 'review_required';
  if (unresolved.length) return 'warning';
  return 'pass';
}

export class ContinuityQaService {
  constructor(store, {
    providers = {},
    audioBibleService = null,
    assetLoader = null,
    ledger = null,
    moneyGuard = null,
    clock = () => new Date()
  } = {}) {
    if (!store) throw new Error('ContinuityQaService requires a store');
    this.store = store;
    this.providers = providers;
    this.audioBibleService = audioBibleService;
    this.assetLoader = assetLoader;
    this.ledger = ledger;
    this.moneyGuard = moneyGuard;
    this.clock = clock;
  }

  createRun({ projectId, bookId, reviewSessionId, productionPlanId = null, bibleId = null, thresholds = {}, name = 'Continuity + QA' }) {
    if (!projectId || !bookId || !reviewSessionId) throw new Error('QA run requires projectId, bookId and reviewSessionId');
    const session = this.store.get('review_session', reviewSessionId);
    if (!session) throw new Error(`review_session ${reviewSessionId} not found`);
    if (session.projectId !== projectId || session.bookId !== bookId) throw new Error('QA review session must belong to the same project/book');
    const resolvedProductionPlanId = productionPlanId ?? session.productionPlanId ?? null;
    if (resolvedProductionPlanId && session.productionPlanId && resolvedProductionPlanId !== session.productionPlanId) throw new Error('QA production plan does not match review session');
    if (resolvedProductionPlanId) {
      const production = this.store.get('production_plan', resolvedProductionPlanId);
      if (production && (production.projectId !== projectId || production.bookId !== bookId)) throw new Error('QA production plan belongs to another project/book');
    }
    if (bibleId) {
      const bible = this.store.get('audio_bible', bibleId);
      const project = this.store.get('project', projectId);
      if (project && !bible) throw new Error('QA Audio Bible was not found in this project');
      if (bible && bible.projectId !== projectId) throw new Error('QA Audio Bible belongs to another project');
      if (bible?.scope === 'book' && bible.bookId && bible.bookId !== bookId) throw new Error('QA Audio Bible belongs to another book');
    }
    const existing = this.store.list('qa_run', (row) => row.reviewSessionId === reviewSessionId && !row.locked)[0];
    if (existing) {
      if (existing.projectId !== projectId || existing.bookId !== bookId || existing.productionPlanId !== resolvedProductionPlanId || existing.bibleId !== bibleId) {
        throw new Error('existing QA run configuration does not match the requested project/book/production/Bible');
      }
      return existing;
    }
    const now = nowIso(this.clock);
    return this.store.put(freeze({
      id: randomUUID(), type: 'qa_run', projectId, bookId, reviewSessionId, productionPlanId: resolvedProductionPlanId,
      bibleId, name, thresholds: cleanThresholds(thresholds), status: 'in_progress', locked: false,
      reportCount: 0, createdAt: now, updatedAt: now
    }));
  }

  getRun(runId) {
    const run = this.store.get('qa_run', runId);
    if (!run) throw new Error(`qa_run ${runId} not found`);
    return run;
  }

  #assertOpen(runId) {
    const run = this.getRun(runId);
    if (run.locked) throw new Error('QA run is locked');
    return run;
  }

  #pronunciations(run) {
    if (!run.bibleId || !this.audioBibleService) return [];
    return this.audioBibleService.listPronunciations(run.bibleId);
  }

  #canonicalForTake(take, job, explicitText) {
    if (String(explicitText ?? '').trim()) return String(explicitText);
    const cue = job?.cueId ? this.store.get('director_cue', job.cueId) : null;
    if (cue?.canonicalText) return cue.canonicalText;
    const region = this.store.list('review_region', (row) => row.chapterReviewId === take.chapterReviewId && row.selectedTakeId === take.id)[0]
      ?? this.store.list('review_region', (row) => row.chapterReviewId === take.chapterReviewId && row.cueId && row.cueId === job?.cueId)[0];
    if (region?.canonicalText) return region.canonicalText;
    throw new Error('QA could not resolve canonical manuscript text for take');
  }

  async inspectTake(runId, {
    takeId,
    canonicalText = null,
    languageCode = null,
    runAlignment = true,
    runTranscription = true,
    sttModel = 'scribe_v2',
    biasTranscriptionWithPronunciations = false,
    moneyGuardId = null, approvedBy = null,
    estimatedAlignmentCostUsd = null, estimatedTranscriptionCostUsd = null
  } = {}) {
    const run = this.#assertOpen(runId);
    const take = this.store.get('review_take', takeId);
    if (!take) throw new Error(`review_take ${takeId} not found`);
    if (take.sessionId !== run.reviewSessionId) throw new Error('review take belongs to another QA session');
    const job = this.store.get('production_job', take.jobId);
    if (!job) throw new Error(`production_job ${take.jobId} not found`);
    if (job.projectId !== run.projectId || job.bookId !== run.bookId || (run.productionPlanId && job.planId !== run.productionPlanId)) {
      throw new Error('QA production job belongs to another project/book/production plan');
    }
    const provider = this.providers[job.provider];
    if (!provider) throw new Error(`QA provider ${job.provider} is unavailable`);
    if (typeof this.assetLoader !== 'function') throw new Error('QA inspection requires assetLoader');

    const canonical = this.#canonicalForTake(take, job, canonicalText);
    const pronunciations = this.#pronunciations(run);
    const loaded = validateAssetPayload(await this.assetLoader(take.asset, { run, take, job }));

    let alignment = null;
    let transcription = null;
    const authorizations = new Map();
    let alignmentEstimate = null;
    let transcriptionEstimate = null;
    let providerCallsPerformed = 0;

    try {
      if (this.moneyGuard && (runAlignment || runTranscription)) {
        const guard = moneyGuardId ? this.moneyGuard.getGuard(moneyGuardId) : this.moneyGuard.activeGuardForProject(run.projectId);
        if (!guard) throw new Error('Money Guard required for paid QA but no active project guard exists');
        if (guard.projectId !== run.projectId) throw new Error('Money Guard belongs to another project');
        if (runAlignment) {
          alignmentEstimate = await qaEstimate(provider, 'alignment', estimatedAlignmentCostUsd, { take, job, canonical, loaded });
          authorizations.set('alignment', this.moneyGuard.authorize(guard.id, {
            provider: job.provider, operation: 'qa_alignment', estimatedCostUsd: alignmentEstimate,
            approvedBy, reason: 'Continuity + QA forced alignment', metadata: { runId, takeId, jobId: job.id }
          }));
        }
        if (runTranscription) {
          transcriptionEstimate = await qaEstimate(provider, 'transcription', estimatedTranscriptionCostUsd, { take, job, canonical, loaded, sttModel });
          authorizations.set('transcription', this.moneyGuard.authorize(guard.id, {
            provider: job.provider, operation: 'qa_transcription', estimatedCostUsd: transcriptionEstimate,
            approvedBy, reason: 'Continuity + QA transcription', metadata: { runId, takeId, jobId: job.id, sttModel }
          }));
        }
      }

      if (runAlignment) {
        const auth = authorizations.get('alignment') ?? null;
        if (auth && this.moneyGuard.getGuard(auth.guardId).status !== 'active') throw new Error('Money Guard blocked QA alignment provider call');
        alignment = await provider.align({
          audio: loaded.audio, sourceUrl: loaded.sourceUrl, text: canonical,
          fileName: loaded.fileName, mediaType: loaded.mediaType
        });
        providerCallsPerformed += 1;
        const accounted = accountedProviderCost(alignment, alignmentEstimate);
        if (auth && accounted.amountUsd !== null) {
          this.moneyGuard.capture(auth.id, {
            amountUsd: accounted.amountUsd, providerCall: true, costBasis: accounted.costBasis,
            metadata: { runId, takeId, jobId: job.id, operation: 'qa_alignment', requestId: alignment?.requestId ?? null }
          });
        } else if (this.ledger && accounted.amountUsd !== null) {
          this.ledger.record({ projectId: run.projectId, provider: job.provider, operation: 'qa_alignment', amountUsd: accounted.amountUsd, metadata: { runId, takeId, jobId: job.id, providerCall: true, costBasis: accounted.costBasis } });
        }
      }
      if (runTranscription) {
        const auth = authorizations.get('transcription') ?? null;
        if (auth && this.moneyGuard.getGuard(auth.guardId).status !== 'active') throw new Error('Money Guard blocked QA transcription provider call');
        transcription = await provider.transcribe({
          audio: loaded.audio, sourceUrl: loaded.sourceUrl,
          fileName: loaded.fileName, mediaType: loaded.mediaType,
          model: sttModel, languageCode: languageCode ?? job.languageCode ?? null,
          diarize: false, tagAudioEvents: false, timestampsGranularity: 'word',
          keyterms: biasTranscriptionWithPronunciations ? pronunciations.map((p) => p.term).slice(0, 1000) : []
        });
        providerCallsPerformed += 1;
        const accounted = accountedProviderCost(transcription, transcriptionEstimate);
        if (auth && accounted.amountUsd !== null) {
          this.moneyGuard.capture(auth.id, {
            amountUsd: accounted.amountUsd, providerCall: true, costBasis: accounted.costBasis,
            metadata: { runId, takeId, jobId: job.id, operation: 'qa_transcription', requestId: transcription?.requestId ?? null, sttModel }
          });
        } else if (this.ledger && accounted.amountUsd !== null) {
          this.ledger.record({ projectId: run.projectId, provider: job.provider, operation: 'qa_transcription', amountUsd: accounted.amountUsd, metadata: { runId, takeId, jobId: job.id, providerCall: true, costBasis: accounted.costBasis, sttModel } });
        }
      }
    } finally {
      if (this.moneyGuard) {
        for (const auth of authorizations.values()) {
          const current = this.store.get('money_authorization', auth.id);
          if (current && ['authorized', 'partially_captured', 'captured'].includes(current.status)) {
            this.moneyGuard.release(auth.id, { reason: 'QA operation finished; unused reservation released' });
          }
        }
      }
    }

    const comparison = transcription ? compareTranscript(canonical, transcription.text ?? '') : null;
    const rawFindings = [];
    if (comparison) rawFindings.push(...transcriptFindings(comparison, run.thresholds));
    if (transcription) {
      for (const dup of findAdjacentDuplicates(transcription.text ?? '')) {
        rawFindings.push({ type: 'adjacent-duplicate-audio', severity: dup.phraseWords >= 2 ? 'high' : 'medium', ...dup });
      }
      for (const risk of pronunciationRisks(canonical, transcription.text ?? '', pronunciations)) {
        rawFindings.push({ type: 'pronunciation-risk', severity: 'medium', ...risk });
      }
      rawFindings.push(...transcriptConfidenceFindings(transcription, run.thresholds));
    }
    if (alignment) rawFindings.push(...alignmentAnomalies(alignment, run.thresholds));

    const reportId = randomUUID();
    const findings = rawFindings.map((finding) => {
      const { type: findingType, ...detail } = finding;
      return this.store.put(freeze({
        id: randomUUID(), type: 'qa_finding', findingType, runId, reportId, takeId,
        chapterReviewId: take.chapterReviewId, status: 'open', ...detail,
        createdAt: nowIso(this.clock), updatedAt: nowIso(this.clock)
      }));
    });
    const status = runStatus(findings);
    const report = this.store.put(freeze({
      id: reportId, type: 'qa_report', runId, takeId, jobId: job.id, chapterReviewId: take.chapterReviewId,
      provider: job.provider, canonicalText: canonical, canonicalCharacterCount: [...canonical].length,
      alignment: alignment ? freeze({ loss: alignment.loss ?? null, wordCount: alignment.words?.length ?? 0 }) : null,
      transcription: transcription ? freeze({
        model: sttModel, languageCode: transcription.language_code ?? null,
        languageProbability: transcription.language_probability ?? null,
        text: transcription.text ?? '', wordCount: transcription.words?.filter?.((w) => !w.type || w.type === 'word')?.length ?? null
      }) : null,
      comparison, findingCount: findings.length, status, providerCallsPerformed,
      biasTranscriptionWithPronunciations: Boolean(biasTranscriptionWithPronunciations),
      createdAt: nowIso(this.clock), updatedAt: nowIso(this.clock)
    }));
    this.store.update('qa_run', runId, (current) => freeze({
      ...current, reportCount: (current.reportCount ?? 0) + 1,
      status: status === 'review_required' ? 'review_required' : current.status,
      updatedAt: nowIso(this.clock)
    }));
    return freeze({ report, findings: freeze(findings), alignment, transcription });
  }

  resolveFinding(findingId, { reviewer, resolution = 'resolved', notes = null } = {}) {
    if (!String(reviewer ?? '').trim()) throw new Error('resolving QA finding requires reviewer');
    if (!['resolved', 'waived'].includes(resolution)) throw new Error('QA finding resolution must be resolved or waived');
    const finding = this.store.get('qa_finding', findingId);
    if (!finding) throw new Error(`qa_finding ${findingId} not found`);
    this.#assertOpen(finding.runId);
    return this.store.update('qa_finding', findingId, (current) => freeze({
      ...current, status: resolution, reviewedBy: reviewer, reviewNotes: notes,
      resolvedAt: nowIso(this.clock), updatedAt: nowIso(this.clock)
    }));
  }

  reportSummary(reportId) {
    const report = this.store.get('qa_report', reportId);
    if (!report) throw new Error(`qa_report ${reportId} not found`);
    const findings = this.store.list('qa_finding', (row) => row.reportId === reportId);
    const open = findings.filter((row) => !['resolved', 'waived'].includes(row.status));
    const bySeverity = {};
    for (const finding of open) bySeverity[finding.severity] = (bySeverity[finding.severity] ?? 0) + 1;
    return freeze({
      reportId, takeId: report.takeId, totalFindings: findings.length, openFindings: open.length,
      bySeverity: freeze(bySeverity), status: runStatus(findings), canApprove: !open.some((row) => severityRank(row.severity) >= severityRank('high'))
    });
  }

  gateTakeForRun(runId, takeId) {
    const run = this.getRun(runId);
    const reports = this.store.list('qa_report', (row) => row.runId === run.id && row.takeId === takeId);
    if (!reports.length) return freeze({ runId, takeId, status: 'not_checked', canApprove: false, reason: 'no QA report in this run' });
    const latest = reports.at(-1);
    const summary = this.reportSummary(latest.id);
    return freeze({ runId, takeId, status: summary.status, canApprove: summary.canApprove, reportId: latest.id, openFindings: summary.openFindings });
  }

  coverage(runId) {
    const run = this.getRun(runId);
    const selectedRegions = this.store.list('review_region', (row) => row.sessionId === run.reviewSessionId && row.selectedTakeId && row.status === 'approved');
    const fallbackTakes = this.store.list('review_take', (row) => row.sessionId === run.reviewSessionId);
    const expectedTakeIds = [...new Set((selectedRegions.length ? selectedRegions.map((row) => row.selectedTakeId) : fallbackTakes.map((row) => row.id)).filter(Boolean))];
    const gates = expectedTakeIds.map((takeId) => this.gateTakeForRun(runId, takeId));
    const missingTakeIds = gates.filter((row) => row.status === 'not_checked').map((row) => row.takeId);
    const blockingTakeIds = gates.filter((row) => row.status !== 'not_checked' && !row.canApprove).map((row) => row.takeId);
    return freeze({
      runId, reviewSessionId: run.reviewSessionId,
      expectedTakeIds: freeze(expectedTakeIds), expectedTakeCount: expectedTakeIds.length,
      reportedTakeCount: expectedTakeIds.length - missingTakeIds.length,
      missingTakeIds: freeze(missingTakeIds), blockingTakeIds: freeze(blockingTakeIds),
      complete: expectedTakeIds.length > 0 && missingTakeIds.length === 0,
      canLock: expectedTakeIds.length > 0 && missingTakeIds.length === 0 && blockingTakeIds.length === 0
    });
  }

  gateTake(takeId) {
    const reports = this.store.list('qa_report', (row) => row.takeId === takeId);
    if (!reports.length) return freeze({ takeId, status: 'not_checked', canApprove: false, reason: 'no QA report' });
    const latest = reports.at(-1);
    const summary = this.reportSummary(latest.id);
    return freeze({ takeId, status: summary.status, canApprove: summary.canApprove, reportId: latest.id, openFindings: summary.openFindings });
  }

  lockRun(runId, { reviewer } = {}) {
    const run = this.#assertOpen(runId);
    if (!String(reviewer ?? '').trim()) throw new Error('locking QA run requires reviewer');
    const session = this.store.get('review_session', run.reviewSessionId);
    if (!session || session.projectId !== run.projectId || session.bookId !== run.bookId || session.status !== 'approved' || !session.locked) {
      throw new Error('QA run cannot lock until the exact Review Studio session is approved and locked');
    }
    const coverage = this.coverage(runId);
    if (!coverage.expectedTakeCount) throw new Error('QA run cannot be locked without selected review takes');
    if (coverage.missingTakeIds.length) throw new Error(`QA run has incomplete coverage: ${coverage.missingTakeIds.length} selected take(s) have no QA report`);
    if (coverage.blockingTakeIds.length) throw new Error('QA run has unresolved high/critical findings');
    return this.store.update('qa_run', runId, (current) => freeze({
      ...current, status: 'approved', locked: true, approvedBy: reviewer,
      coverage: freeze({ expectedTakeCount: coverage.expectedTakeCount, reportedTakeCount: coverage.reportedTakeCount }),
      approvedAt: nowIso(this.clock), updatedAt: nowIso(this.clock)
    }));
  }
}

export { DEFAULT_THRESHOLDS as QA_DEFAULT_THRESHOLDS };
