import { randomUUID } from 'node:crypto';
import { sha256 } from '../core/hash.js';
import { FfmpegAdapter } from '../mastering/ffmpeg-adapter.js';
import { AudioBibleService } from './audio-bible-service.js';
import { CastingRoomService } from './casting-room-service.js';
import { AudiobookDirectorService } from './audiobook-director-service.js';
import { ProductionEngineService } from './production-engine-service.js';
import { ReviewStudioService } from './review-studio-service.js';
import { ContinuityQaService } from './continuity-qa-service.js';
import { MasteringLabService } from './mastering-lab-service.js';
import { DistributionBrainService } from './distribution-brain-service.js';
import { MoneyGuardService } from './money-guard-service.js';
import { ManuscriptService } from './manuscript-service.js';
import { ProjectService } from './project-service.js';
import {
  buildExternalBookSupermanReport,
  buildSyntheticExternalBookFixture,
  renderExternalSupermanMarkdown
} from '../superman/external-book-superman.js';

const freeze = (value) => Object.freeze(value);
const stage = (stageName, status, detail = null) => freeze({ stage: stageName, status, detail });

function safeVoice() {
  return freeze({
    provider: 'external-superman-dryrun', providerVoiceId: 'external-superman-probe-voice',
    name: 'External Superman Probe Voice', category: 'professional', language: 'en', locale: 'en-US',
    noticePeriodDays: 365, verifiedLanguages: freeze([{ language: 'en', locale: 'en-US', modelId: 'eleven_multilingual_v2' }]),
    disableAtUnix: null, hasCustomRate: false, liveModerationEnabled: false,
    previewUrl: 'dryrun://external-superman-preview', source: 'external-superman-dryrun'
  });
}

function firstCanonicalSegment(store, ingestResult) {
  const narration = ingestResult.segments.find((row) => row.kind === 'narration');
  const record = narration ?? ingestResult.segments[0] ?? null;
  if (!record) throw new Error('External Book Superman stack probe found no canonical segment');
  const chapter = store.get('chapter', record.chapterId);
  const scene = store.get('scene', record.sceneId);
  if (!chapter || !scene) throw new Error('External Book Superman stack probe could not resolve canonical chapter/scene');
  return { record, chapter, scene };
}

function syntheticMasterAnalysis(durationSec = 1) {
  return freeze({ durationSec, bitrateKbps: 192, sampleRateHz: 44100, channels: 1 });
}

export class ExternalBookSupermanService {
  constructor(store, {
    projectService = null,
    manuscriptService = null,
    ffmpeg = null,
    env = process.env
  } = {}) {
    if (!store) throw new Error('ExternalBookSupermanService requires a store');
    this.store = store;
    this.projects = projectService ?? new ProjectService(store);
    this.manuscripts = manuscriptService ?? new ManuscriptService(store);
    this.ffmpeg = ffmpeg ?? new FfmpegAdapter();
    this.env = env ?? {};
  }

  async runFile(filePath, options = {}) {
    if (!String(filePath ?? '').trim()) throw new Error('External Book Superman requires a manuscript file path');
    this.#seedForeignTruth();
    const project = this.projects.create({ name: options.projectName ?? 'External Book Superman' });
    const ingestOptions = {
      ...(options.title ? { title: options.title } : {}),
      ...(options.author ? { author: options.author } : {}),
      ...(options.language ? { language: options.language } : {})
    };
    const ingestResult = this.manuscripts.ingestFile(project.id, filePath, ingestOptions);
    return this.#report(project, ingestResult, options);
  }

  async runFixture(options = {}) {
    this.#seedForeignTruth();
    const project = this.projects.create({ name: options.projectName ?? 'External Book Superman Synthetic Fixture' });
    const text = buildSyntheticExternalBookFixture(options.fixture ?? {});
    const ingestResult = this.manuscripts.ingestExtracted(project.id, {
      format: 'txt', filename: 'external-book-superman-fixture.txt', sourceHash: sha256(text),
      metadata: { title: 'The Glass Harbor', author: 'Jordan Vale', language: 'en' }, text
    }, {});
    return this.#report(project, ingestResult, { ...options, label: options.label ?? 'External Book Superman — Synthetic Fixture' });
  }

  #seedForeignTruth() {
    if (this.store.get('project', 'external-superman-foreign-project')) return;
    this.store.put(freeze({ id: 'external-superman-foreign-project', type: 'project', name: 'Book One Foreign Sentinel', status: 'analyzed', locked: false }));
    this.store.put(freeze({ id: 'external-superman-foreign-book', type: 'book', projectId: 'external-superman-foreign-project', title: 'Tres Amigos, Una Vida – A Throuple Love Story' }));
    this.store.put(freeze({ id: 'external-superman-foreign-bible', type: 'audio_bible', projectId: 'external-superman-foreign-project', name: 'Foreign Bible', scope: 'book', bookId: 'external-superman-foreign-book' }));
    this.store.put(freeze({ id: 'external-superman-foreign-character', type: 'character', projectId: 'external-superman-foreign-project', bibleId: 'external-superman-foreign-bible', canonicalName: 'Michael Rawlins', aliases: freeze(['Michael', 'Rawlins']), role: 'primary' }));
    this.store.put(freeze({ id: 'external-superman-foreign-assignment', type: 'voice_assignment', projectId: 'external-superman-foreign-project', bookId: 'external-superman-foreign-book', characterId: 'external-superman-foreign-character', scope: 'book', provider: 'sentinel', providerVoiceId: 'foreign-voice', locked: true }));
  }

  #foreignReferenceLeaks(projectId) {
    const ids = [
      'external-superman-foreign-project', 'external-superman-foreign-book',
      'external-superman-foreign-bible', 'external-superman-foreign-character',
      'external-superman-foreign-assignment'
    ];
    const types = [
      'book', 'chapter', 'scene', 'segment', 'audio_bible', 'character', 'voice_candidate', 'voice_assignment',
      'director_plan', 'director_scene', 'director_cue', 'production_plan', 'production_job', 'review_session',
      'chapter_review', 'qa_run', 'mastering_plan', 'distribution_project', 'distribution_target', 'money_guard'
    ];
    const leaks = [];
    for (const type of types) {
      for (const row of this.store.list(type, (item) => item.projectId === projectId)) {
        const text = JSON.stringify(row);
        for (const id of ids) if (text.includes(id)) leaks.push(`${type}:${row.id}->${id}`);
      }
    }
    return freeze([...new Set(leaks)]);
  }

  async #zeroSpendStackProbe(project, ingestResult) {
    const stages = [];
    let estimateCalls = 0;
    try {
      const bookId = ingestResult.book.id;
      const target = firstCanonicalSegment(this.store, ingestResult);
      const title = ingestResult.analysis.metadata.title ?? ingestResult.book.title ?? 'External Superman Dry Run';
      const author = ingestResult.analysis.metadata.author ?? 'External Superman Metadata Probe';
      const language = ingestResult.analysis.metadata.language ?? 'en';

      const audioBible = new AudioBibleService(this.store);
      const bible = audioBible.createBible({ projectId: project.id, bookId, scope: 'book', name: `${title} — External Superman Probe Bible` });
      const character = audioBible.addCharacter(bible.id, {
        canonicalName: 'External Superman Probe', role: 'minor', aliases: [],
        performanceProfile: { source: 'external-superman-dryrun' }
      });
      stages.push(stage('audio-bible', 'PASS', 'Exact external-book Bible created with no inherited Book One profile.'));

      const casting = new CastingRoomService(this.store);
      const candidate = casting.stageCandidate({ projectId: project.id, bookId, characterId: character.id, voice: safeVoice(), provider: 'external-superman-dryrun' });
      const assignment = casting.lockCast({ projectId: project.id, bookId, characterId: character.id, candidateId: candidate.id, scope: 'book', approvedBy: 'external-superman' });
      if (!assignment.locked || assignment.bookId !== bookId) throw new Error('Casting probe did not produce an exact-book locked assignment');
      stages.push(stage('casting-room', 'PASS', 'Book-scoped dry-run cast locked against the exact external book.'));

      if (target.record.kind === 'dialogue' && !target.record.characterId) {
        this.store.update('segment', target.record.id, (row) => freeze({ ...row, characterId: character.id }));
        target.record = this.store.get('segment', target.record.id);
      }

      const director = new AudiobookDirectorService(this.store);
      const directorPlan = director.createPlan({ projectId: project.id, bookId, bibleId: bible.id, notes: 'External Superman zero-spend wiring probe' });
      const directed = await director.directScene({
        planId: directorPlan.id, chapterId: target.chapter.id, sceneId: target.scene.id,
        segments: [this.store.get('segment', target.record.id)]
      });
      director.lockPlan(directorPlan.id);
      const cue = this.store.get('director_cue', directed.cues[0].id);
      if (!cue?.locked) throw new Error('Director probe cue did not lock transitively');
      stages.push(stage('audiobook-director', 'PASS', 'Canonical external segment directed and transitively locked.'));

      const dryProvider = {
        async estimateCost({ text }) {
          estimateCalls += 1;
          return { amountUsd: Math.max(0.000001, String(text ?? '').length / 100000), characters: String(text ?? '').length, model: 'eleven_multilingual_v2' };
        }
      };
      const money = new MoneyGuardService(this.store);
      const guard = money.createGuard({
        projectId: project.id, hardCapUsd: 25, warningThresholdRatio: 0.8,
        singleActionApprovalUsd: 10, estimateVarianceRatio: 0.15,
        providerCapsUsd: { 'external-superman-dryrun': 20 }, operationCapsUsd: { production: 20 }
      });
      const production = new ProductionEngineService(this.store, {
        directorService: director, providers: { 'external-superman-dryrun': dryProvider }, moneyGuard: money
      });
      const productionPlan = production.createPlan({
        projectId: project.id, bookId, directorPlanId: directorPlan.id,
        provider: 'external-superman-dryrun', model: 'eleven_multilingual_v2', hardBudgetUsd: 20
      });
      const jobs = await production.planCues(productionPlan.id, {
        cueIds: [cue.id], resolveVoice: () => ({ providerVoiceId: assignment.providerVoiceId })
      });
      const productionPreflight = production.preflight(productionPlan.id);
      const moneyDecision = money.preview(guard.id, {
        provider: 'external-superman-dryrun', operation: 'production_render',
        estimatedCostUsd: productionPreflight.projectedTotalUsd, approvedBy: 'external-superman'
      });
      if (!productionPreflight.withinBudget || moneyDecision.blocked) throw new Error('Production/Money Guard dry-run preflight unexpectedly blocked');
      if (this.store.get('production_plan', productionPlan.id).armed) throw new Error('External Superman must never arm production');
      if (money.authorizations(guard.id).length) throw new Error('External Superman must not reserve paid spend during preflight');
      stages.push(stage('production-money-guard', 'PASS', `Preflighted ${jobs.length} job(s); no spend authorization created.`));

      // From this point onward the probe uses synthetic *references* only. No audio bytes exist and no provider is called.
      const readyJob = this.store.update('production_job', jobs[0].id, (row) => freeze({
        ...row, status: 'ready', asset: freeze({ storageLocator: `dryrun://external-superman/${row.id}.mp3`, mediaType: 'audio/mpeg' }),
        accountedCostUsd: 0, actualCostUsd: 0, costBasis: 'external-superman-synthetic'
      }));
      const review = new ReviewStudioService(this.store, { productionEngine: production });
      const session = review.createSession({ projectId: project.id, bookId, productionPlanId: productionPlan.id });
      const chapterReview = review.openChapter(session.id, { chapterId: target.chapter.id, order: target.chapter.order, title: target.chapter.title });
      const take = review.registerTake(chapterReview.id, { jobId: readyJob.id, durationMs: 1000 });
      review.registerTimeline(chapterReview.id, take.id, [{
        regionKey: 'external-superman-probe', canonicalText: cue.canonicalText,
        cueId: cue.id, segmentId: cue.segmentId, startMs: 0, endMs: 1000
      }]);
      const region = this.store.list('review_region', (row) => row.chapterReviewId === chapterReview.id)[0];
      review.approveRegion(region.id, { takeId: take.id, reviewer: 'external-superman' });
      review.approveChapter(chapterReview.id, { reviewer: 'external-superman' });
      review.lockSession(session.id, { reviewer: 'external-superman' });
      stages.push(stage('review-studio', 'PASS', 'Synthetic reference take completed the real Review Studio approval gates.'));

      const qa = new ContinuityQaService(this.store, { audioBibleService: audioBible });
      const qaRun = qa.createRun({ projectId: project.id, bookId, reviewSessionId: session.id, productionPlanId: productionPlan.id, bibleId: bible.id, name: 'External Superman QA Wiring Probe' });
      this.store.put(freeze({
        id: randomUUID(), type: 'qa_report', runId: qaRun.id, takeId: take.id,
        jobId: readyJob.id, status: 'pass', providerCallsPerformed: 0,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
      }));
      qa.lockRun(qaRun.id, { reviewer: 'external-superman' });
      stages.push(stage('continuity-qa', 'PASS', 'Exact-run QA coverage gate locked using a synthetic zero-call report.'));

      const mastering = new MasteringLabService(this.store, { reviewStudio: review, qaService: qa });
      const masteringPlan = mastering.createPlan({
        projectId: project.id, bookId, reviewSessionId: session.id, qaRunId: qaRun.id,
        profile: 'acx-2026', title, author, narrators: ['External Superman Probe']
      });
      mastering.attachCreditAsset(masteringPlan.id, 'opening', { storageLocator: 'dryrun://external-superman/opening.mp3', mediaType: 'audio/mpeg' });
      mastering.attachCreditAsset(masteringPlan.id, 'closing', { storageLocator: 'dryrun://external-superman/closing.mp3', mediaType: 'audio/mpeg' });
      const masteringPreflight = mastering.preflight(masteringPlan.id);
      if (!masteringPreflight.readyToArm) throw new Error('Mastering preflight did not become ready with synthetic credit references');
      stages.push(stage('mastering-lab', 'PASS', 'Real mastering preflight accepted exact Review/QA truth; no mastering executed.'));

      this.store.update('mastering_plan', masteringPlan.id, (row) => freeze({ ...row, status: 'mastered', locked: true, armed: false }));
      this.store.put(freeze({
        id: randomUUID(), type: 'mastering_section', planId: masteringPlan.id, chapterReviewId: chapterReview.id,
        chapterId: target.chapter.id, title: target.chapter.title ?? 'External Superman Probe Chapter',
        outputFileName: '001-external-superman-probe.mp3', status: 'passed',
        asset: freeze({ storageLocator: 'dryrun://external-superman/master.mp3', mediaType: 'audio/mpeg' }),
        postAnalysis: syntheticMasterAnalysis(1)
      }));
      this.store.put(freeze({
        id: randomUUID(), type: 'mastering_credit_section', planId: masteringPlan.id, kind: 'opening',
        outputFileName: '000-opening-credits.mp3', status: 'passed',
        asset: freeze({ storageLocator: 'dryrun://external-superman/opening-master.mp3', mediaType: 'audio/mpeg' }),
        postAnalysis: syntheticMasterAnalysis(1)
      }));
      this.store.put(freeze({
        id: randomUUID(), type: 'mastering_credit_section', planId: masteringPlan.id, kind: 'closing',
        outputFileName: '999-closing-credits.mp3', status: 'passed',
        asset: freeze({ storageLocator: 'dryrun://external-superman/closing-master.mp3', mediaType: 'audio/mpeg' }),
        postAnalysis: syntheticMasterAnalysis(1)
      }));

      const distribution = new DistributionBrainService(this.store);
      const distributionProject = distribution.createProject({
        projectId: project.id, bookId, masteringPlanId: masteringPlan.id,
        metadata: { title, author, narrators: ['External Superman Probe'], language },
        digitalNarration: false
      });
      distribution.confirmRights(distributionProject.id, { confirmedBy: 'external-superman', territories: 'TEST-ONLY' });
      const targetDistribution = distribution.addTarget(distributionProject.id, 'w3c-audiobook-2020');
      const distributionPreflight = distribution.preflightTarget(targetDistribution.id);
      if (!distributionPreflight.readyToPackage) throw new Error(`Distribution dry-run preflight blocked: ${distributionPreflight.blockers.map((x) => x.code).join(', ')}`);
      const pkg = distribution.buildTargetPackage(targetDistribution.id);
      stages.push(stage('distribution-brain', 'PASS', `W3C dry-run package built (${pkg.files.length} synthetic audio reference(s)); nothing exported.`));

      const foreignLeaks = this.#foreignReferenceLeaks(project.id);
      if (foreignLeaks.length) throw new Error(`Cross-project sentinel leaked into external project: ${foreignLeaks.join(', ')}`);
      stages.push(stage('cross-project-isolation', 'PASS', 'Foreign Book One sentinel remained isolated from the external project.'));

      return freeze({
        status: 'PASS', providerCallsPerformed: 0, estimateCalls,
        syntheticAssetReferences: true, audioQualityValidated: false,
        productionArmed: false, masteringExecuted: false, packageExported: false,
        stages: freeze(stages), foreignReferenceLeaks: freeze([]),
        projectId: project.id, bookId,
        ids: freeze({ bibleId: bible.id, castAssignmentId: assignment.id, directorPlanId: directorPlan.id, productionPlanId: productionPlan.id, reviewSessionId: session.id, qaRunId: qaRun.id, masteringPlanId: masteringPlan.id, distributionPackageId: pkg.id })
      });
    } catch (error) {
      stages.push(stage('failure', 'BLOCKED', String(error?.message ?? error)));
      return freeze({
        status: 'BLOCKED', providerCallsPerformed: 0, estimateCalls,
        syntheticAssetReferences: true, audioQualityValidated: false,
        productionArmed: false, masteringExecuted: false, packageExported: false,
        error: String(error?.message ?? error), stages: freeze(stages)
      });
    }
  }

  async #report(project, ingestResult, options) {
    const ffmpegHealth = this.ffmpeg?.healthCheck ? await this.ffmpeg.healthCheck() : { ok: false, reason: 'FFmpeg adapter not configured' };
    const stackProbe = await this.#zeroSpendStackProbe(project, ingestResult);
    const report = buildExternalBookSupermanReport(ingestResult, {
      model: options.model ?? 'eleven_multilingual_v2',
      apiKeyPresent: Boolean(this.env.ELEVENLABS_API_KEY),
      ffmpegHealth,
      nodeVersion: process.versions.node,
      regenerationReserveRatio: options.regenerationReserveRatio ?? 0.25,
      auditionAllowanceUsd: options.auditionAllowanceUsd ?? 5,
      baselineSourceHash: options.baselineSourceHash ?? null,
      label: options.label ?? 'External Book Superman',
      stackProbe
    });
    return freeze({ project, ingestResult, report, markdown: renderExternalSupermanMarkdown(report) });
  }
}
