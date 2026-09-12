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
    clock = () => new Date()
  } = {}) {
    if (!store) throw new Error('ContinuityQaService requires a store');
    this.store = store;
    this.providers = providers;
    this.audioBibleService = audioBibleService;
    this.assetLoader = assetLoader;
    this.ledger = ledger;
    this.clock = clock;
  }

  createRun({ projectId, bookId, reviewSessionId, productionPlanId = null, bibleId = null, thresholds = {}, name = 'Continuity + QA' }) {
    if (!projectId || !bookId || !reviewSessionId) throw new Error('QA run requires projectId, bookId and reviewSessionId');
    const existing = this.store.list('qa_run', (row) => row.reviewSessionId === reviewSessionId && !row.locked)[0];
    if (existing) return existing;
    const now = nowIso(this.clock);
    return this.store.put(freeze({
      id: randomUUID(), type: 'qa_run', projectId, bookId, reviewSessionId, productionPlanId,
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
    biasTranscriptionWithPronunciations = false
  } = {}) {
    const run = this.#assertOpen(runId);
    const take = this.store.get('review_take', takeId);
    if (!take) throw new Error(`review_take ${takeId} not found`);
    if (take.sessionId !== run.reviewSessionId) throw new Error('review take belongs to another QA session');
    const job = this.store.get('production_job', take.jobId);
    if (!job) throw new Error(`production_job ${take.jobId} not found`);
    const provider = this.providers[job.provider];
    if (!provider) throw new Error(`QA provider ${job.provider} is unavailable`);
    if (typeof this.assetLoader !== 'function') throw new Error('QA inspection requires assetLoader');

    const canonical = this.#canonicalForTake(take, job, canonicalText);
    const pronunciations = this.#pronunciations(run);
    const loaded = validateAssetPayload(await this.assetLoader(take.asset, { run, take, job }));

    let alignment = null;
    let transcription = null;
    if (runAlignment) {
      alignment = await provider.align({
        audio: loaded.audio, sourceUrl: loaded.sourceUrl, text: canonical,
        fileName: loaded.fileName, mediaType: loaded.mediaType
      });
    }
    if (runTranscription) {
      transcription = await provider.transcribe({
        audio: loaded.audio, sourceUrl: loaded.sourceUrl,
        fileName: loaded.fileName, mediaType: loaded.mediaType,
        model: sttModel, languageCode: languageCode ?? job.languageCode ?? null,
        diarize: false, tagAudioEvents: false, timestampsGranularity: 'word',
        keyterms: biasTranscriptionWithPronunciations ? pronunciations.map((p) => p.term).slice(0, 1000) : []
      });
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
      comparison, findingCount: findings.length, status,
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
    const reports = this.store.list('qa_report', (row) => row.runId === runId);
    if (!reports.length) throw new Error('QA run cannot be locked without reports');
    const unresolvedBlocking = reports.some((report) => !this.reportSummary(report.id).canApprove);
    if (unresolvedBlocking) throw new Error('QA run has unresolved high/critical findings');
    return this.store.update('qa_run', runId, (current) => freeze({
      ...current, status: 'approved', locked: true, approvedBy: reviewer,
      approvedAt: nowIso(this.clock), updatedAt: nowIso(this.clock)
    }));
  }
}

export { DEFAULT_THRESHOLDS as QA_DEFAULT_THRESHOLDS };
