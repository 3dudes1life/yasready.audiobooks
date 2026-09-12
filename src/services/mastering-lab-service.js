import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getMasteringProfile, safeSectionFileName, evaluateMasterAgainstProfile } from '../mastering/profiles.js';

const freeze = (value) => Object.freeze(value);
const nowIso = (clock) => clock().toISOString();

function assertAssetReference(asset) {
  if (!asset || typeof asset !== 'object') throw new Error('asset reference is required');
  if (['audio', 'data', 'bytes', 'bytesData'].some((key) => key in asset)) throw new Error('Mastering Lab stores asset references, not raw audio bytes');
  return asset;
}

function selectedRegions(store, chapterReviewId) {
  return store.list('review_region', (row) => row.chapterReviewId === chapterReviewId)
    .sort((a, b) => a.order - b.order);
}

export class MasteringLabService {
  constructor(store, {
    reviewStudio = null,
    qaService = null,
    ffmpeg = null,
    assetMaterializer = null,
    assetSink = null,
    clock = () => new Date()
  } = {}) {
    if (!store) throw new Error('MasteringLabService requires a store');
    this.store = store;
    this.reviewStudio = reviewStudio;
    this.qaService = qaService;
    this.ffmpeg = ffmpeg;
    this.assetMaterializer = assetMaterializer;
    this.assetSink = assetSink;
    this.clock = clock;
  }

  createPlan({
    projectId, bookId, reviewSessionId, qaRunId, profile = 'acx-2026',
    title, author, narrators = [], name = 'Mastering Lab'
  }) {
    if (!projectId || !bookId || !reviewSessionId || !qaRunId) throw new Error('mastering plan requires project/book/review/QA ids');
    if (!String(title ?? '').trim() || !String(author ?? '').trim()) throw new Error('mastering plan requires title and author');
    const masteringProfile = getMasteringProfile(profile);
    const existing = this.store.list('mastering_plan', (row) => row.reviewSessionId === reviewSessionId && row.profileId === masteringProfile.id)[0];
    if (existing) return existing;
    const now = nowIso(this.clock);
    return this.store.put(freeze({
      id: randomUUID(), type: 'mastering_plan', projectId, bookId, reviewSessionId, qaRunId,
      name, title: String(title).trim(), author: String(author).trim(), narrators: freeze([...narrators]),
      profileId: masteringProfile.id, profileRevisionDate: masteringProfile.revisionDate,
      status: 'draft', armed: false, approvedBy: null, locked: false,
      credits: this.creditScripts({ title, author, narrators }),
      createdAt: now, updatedAt: now
    }));
  }

  getPlan(planId) {
    const plan = this.store.get('mastering_plan', planId);
    if (!plan) throw new Error(`mastering_plan ${planId} not found`);
    return plan;
  }

  creditScripts({ title, author, narrators = [] }) {
    const names = narrators.filter(Boolean).join(' and ') || '[Narrator]';
    return freeze({
      opening: `${title}, written by ${author}, narrated by ${names}.`,
      closing: `You have been listening to ${title}, written by ${author}, narrated by ${names}.`
    });
  }

  attachCreditAsset(planId, kind, asset) {
    if (!['opening', 'closing'].includes(kind)) throw new Error('credit kind must be opening or closing');
    assertAssetReference(asset);
    const plan = this.getPlan(planId);
    if (plan.locked) throw new Error('mastering plan is locked');
    const existing = this.store.list('mastering_credit_asset', (row) => row.planId === planId && row.kind === kind)[0];
    const now = nowIso(this.clock);
    if (existing) return this.store.update('mastering_credit_asset', existing.id, (current) => freeze({ ...current, asset: freeze({ ...asset }), updatedAt: now }));
    return this.store.put(freeze({ id: randomUUID(), type: 'mastering_credit_asset', planId, kind, asset: freeze({ ...asset }), createdAt: now, updatedAt: now }));
  }

  #assertUpstreamApproved(plan) {
    const session = this.store.get('review_session', plan.reviewSessionId);
    if (!session || session.status !== 'approved' || !session.locked) throw new Error('mastering requires an approved, locked Review Studio session');
    const qaRun = this.store.get('qa_run', plan.qaRunId);
    if (!qaRun || qaRun.status !== 'approved' || !qaRun.locked) throw new Error('mastering requires an approved, locked QA run');
    return { session, qaRun };
  }

  preflight(planId) {
    const plan = this.getPlan(planId);
    const profile = getMasteringProfile(plan.profileId);
    this.#assertUpstreamApproved(plan);
    const chapters = this.store.list('chapter_review', (row) => row.sessionId === plan.reviewSessionId)
      .sort((a, b) => a.order - b.order);
    if (!chapters.length) throw new Error('mastering preflight found no reviewed chapters');
    const sections = [];
    for (const chapter of chapters) {
      if (chapter.status !== 'approved' || !chapter.locked) throw new Error(`chapter ${chapter.chapterId} is not approved and locked`);
      const regions = selectedRegions(this.store, chapter.id);
      if (!regions.length || regions.some((region) => region.status !== 'approved' || !region.selectedTakeId || !region.locked)) {
        throw new Error(`chapter ${chapter.chapterId} has unapproved review regions`);
      }
      const sources = [];
      for (const region of regions) {
        const take = this.store.get('review_take', region.selectedTakeId);
        if (!take || !take.locked) throw new Error(`selected take for region ${region.id} is not locked`);
        const timing = this.store.list('review_timing', (row) => row.takeId === take.id && row.regionId === region.id)[0];
        if (!timing) throw new Error(`region ${region.id} has no synchronized timing`);
        if (this.qaService) {
          const gate = this.qaService.gateTake(take.id);
          if (!gate.canApprove) throw new Error(`take ${take.id} has not passed QA`);
        }
        sources.push(freeze({
          regionId: region.id, takeId: take.id, jobId: take.jobId, asset: take.asset,
          startMs: timing.startMs, endMs: timing.endMs, canonicalTextHash: region.canonicalTextHash
        }));
      }
      sections.push(freeze({
        chapterReviewId: chapter.id, chapterId: chapter.chapterId, order: chapter.order,
        title: chapter.title ?? `Chapter ${chapter.order + 1}`, sources: freeze(sources),
        outputFileName: safeSectionFileName(chapter.order + 1, chapter.title ?? `Chapter ${chapter.order + 1}`, profile.output.format)
      }));
    }
    const credits = this.store.list('mastering_credit_asset', (row) => row.planId === planId);
    const missingCredits = [];
    if (profile.openingCreditsRequired && !credits.some((row) => row.kind === 'opening')) missingCredits.push('opening');
    if (profile.closingCreditsRequired && !credits.some((row) => row.kind === 'closing')) missingCredits.push('closing');
    const result = freeze({ planId, profileId: profile.id, chapters: freeze(sections), chapterCount: sections.length, missingCredits: freeze(missingCredits), readyToArm: missingCredits.length === 0 });
    this.store.update('mastering_plan', planId, (current) => freeze({ ...current, status: result.readyToArm ? 'preflighted' : 'credits_required', updatedAt: nowIso(this.clock) }));
    return result;
  }

  arm(planId, { approvedBy }) {
    if (!String(approvedBy ?? '').trim()) throw new Error('arming mastering requires approvedBy');
    const preflight = this.preflight(planId);
    if (!preflight.readyToArm) throw new Error(`mastering requires credit audio: ${preflight.missingCredits.join(', ')}`);
    return this.store.update('mastering_plan', planId, (current) => freeze({
      ...current, armed: true, status: 'armed', approvedBy, armedAt: nowIso(this.clock), updatedAt: nowIso(this.clock)
    }));
  }

  disarm(planId, { reason }) {
    if (!String(reason ?? '').trim()) throw new Error('disarming mastering requires a reason');
    return this.store.update('mastering_plan', planId, (current) => freeze({ ...current, armed: false, status: 'paused', disarmReason: reason, updatedAt: nowIso(this.clock) }));
  }

  async #materialize(asset, context) {
    if (typeof this.assetMaterializer !== 'function') throw new Error('Mastering Lab requires assetMaterializer');
    const localPath = await this.assetMaterializer(assertAssetReference(asset), context);
    if (!String(localPath ?? '').trim()) throw new Error('assetMaterializer must return a local file path');
    return localPath;
  }

  async masterChapter(planId, chapterReviewId) {
    const plan = this.getPlan(planId);
    if (!plan.armed) throw new Error('mastering plan is not armed');
    if (!this.ffmpeg) throw new Error('Mastering Lab requires FFmpeg adapter');
    if (typeof this.assetSink !== 'function') throw new Error('Mastering Lab requires assetSink');
    const profile = getMasteringProfile(plan.profileId);
    const preflight = this.preflight(planId);
    const section = preflight.chapters.find((row) => row.chapterReviewId === chapterReviewId);
    if (!section) throw new Error(`chapter review ${chapterReviewId} is not in mastering plan`);

    const prior = this.store.list('mastering_section', (row) => row.planId === planId && row.chapterReviewId === chapterReviewId && row.status === 'passed')[0];
    if (prior) return prior;

    const health = await this.ffmpeg.healthCheck();
    if (!health?.ok) throw new Error(`FFmpeg unavailable: ${health?.reason ?? 'health check failed'}`);
    const dir = await mkdtemp(path.join(tmpdir(), 'yasready-master-'));
    try {
      const pieces = [];
      for (let i = 0; i < section.sources.length; i += 1) {
        const source = section.sources[i];
        const sourcePath = await this.#materialize(source.asset, { plan, section, source });
        const piece = path.join(dir, `piece-${String(i).padStart(4, '0')}.wav`);
        await this.ffmpeg.extract(sourcePath, { startMs: source.startMs, endMs: source.endMs, outputPath: piece });
        pieces.push(piece);
      }
      const assembled = path.join(dir, 'assembled.wav');
      await this.ffmpeg.concat(pieces, assembled);
      const preAnalysis = await this.ffmpeg.analyze(assembled);
      const outputPath = path.join(dir, section.outputFileName);
      await this.ffmpeg.master(assembled, outputPath, profile);
      const postAnalysis = await this.ffmpeg.analyze(outputPath);
      const evaluation = evaluateMasterAgainstProfile(postAnalysis, profile);
      if (!evaluation.passed) {
        const failed = freeze({
          id: randomUUID(), type: 'mastering_section', planId, chapterReviewId, chapterId: section.chapterId,
          title: section.title, outputFileName: section.outputFileName, status: 'failed',
          preAnalysis: freeze({ ...preAnalysis }), postAnalysis: freeze({ ...postAnalysis }), evaluation,
          asset: null, createdAt: nowIso(this.clock), updatedAt: nowIso(this.clock)
        });
        this.store.put(failed);
        throw new Error(`mastered section failed ${profile.id}: ${evaluation.issues.map((x) => x.code).join(', ')}`);
      }
      const asset = await this.assetSink(outputPath, { plan, section, profile, analysis: postAnalysis, evaluation });
      assertAssetReference(asset);
      return this.store.put(freeze({
        id: randomUUID(), type: 'mastering_section', planId, chapterReviewId, chapterId: section.chapterId,
        title: section.title, outputFileName: section.outputFileName, status: 'passed',
        preAnalysis: freeze({ ...preAnalysis }), postAnalysis: freeze({ ...postAnalysis }), evaluation,
        asset: freeze({ ...asset }), createdAt: nowIso(this.clock), updatedAt: nowIso(this.clock)
      }));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  async masterCredit(planId, kind) {
    if (!['opening', 'closing'].includes(kind)) throw new Error('credit kind must be opening or closing');
    const plan = this.getPlan(planId);
    if (!plan.armed) throw new Error('mastering plan is not armed');
    if (!this.ffmpeg) throw new Error('Mastering Lab requires FFmpeg adapter');
    if (typeof this.assetSink !== 'function') throw new Error('Mastering Lab requires assetSink');
    const profile = getMasteringProfile(plan.profileId);
    const source = this.store.list('mastering_credit_asset', (row) => row.planId === planId && row.kind === kind)[0];
    if (!source) throw new Error(`${kind} credit audio is not attached`);
    const prior = this.store.list('mastering_credit_section', (row) => row.planId === planId && row.kind === kind && row.status === 'passed')[0];
    if (prior) return prior;
    const health = await this.ffmpeg.healthCheck();
    if (!health?.ok) throw new Error(`FFmpeg unavailable: ${health?.reason ?? 'health check failed'}`);
    const dir = await mkdtemp(path.join(tmpdir(), 'yasready-credit-master-'));
    try {
      const sourcePath = await this.#materialize(source.asset, { plan, kind, credit: source });
      const preAnalysis = await this.ffmpeg.analyze(sourcePath);
      const outputFileName = safeSectionFileName(kind === 'opening' ? 0 : 999, `${kind}-credits`, profile.output.format);
      const outputPath = path.join(dir, outputFileName);
      await this.ffmpeg.master(sourcePath, outputPath, profile);
      const postAnalysis = await this.ffmpeg.analyze(outputPath);
      const evaluation = evaluateMasterAgainstProfile(postAnalysis, profile);
      if (!evaluation.passed) {
        const failed = freeze({
          id: randomUUID(), type: 'mastering_credit_section', planId, kind, outputFileName,
          status: 'failed', preAnalysis: freeze({ ...preAnalysis }), postAnalysis: freeze({ ...postAnalysis }),
          evaluation, asset: null, createdAt: nowIso(this.clock), updatedAt: nowIso(this.clock)
        });
        this.store.put(failed);
        throw new Error(`mastered ${kind} credits failed ${profile.id}: ${evaluation.issues.map((x) => x.code).join(', ')}`);
      }
      const asset = await this.assetSink(outputPath, { plan, kind, profile, analysis: postAnalysis, evaluation, credit: true });
      assertAssetReference(asset);
      return this.store.put(freeze({
        id: randomUUID(), type: 'mastering_credit_section', planId, kind, outputFileName,
        status: 'passed', preAnalysis: freeze({ ...preAnalysis }), postAnalysis: freeze({ ...postAnalysis }),
        evaluation, asset: freeze({ ...asset }), createdAt: nowIso(this.clock), updatedAt: nowIso(this.clock)
      }));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  async masterAll(planId) {
    const plan = this.getPlan(planId);
    if (!plan.armed) throw new Error('mastering plan is not armed');
    const profile = getMasteringProfile(plan.profileId);
    const preflight = this.preflight(planId);
    const output = { opening: null, chapters: [], closing: null };
    if (profile.openingCreditsRequired) output.opening = await this.masterCredit(planId, 'opening');
    for (const chapter of preflight.chapters) output.chapters.push(await this.masterChapter(planId, chapter.chapterReviewId));
    if (profile.closingCreditsRequired) output.closing = await this.masterCredit(planId, 'closing');
    return freeze({ opening: output.opening, chapters: freeze(output.chapters), closing: output.closing });
  }

  summary(planId) {
    const plan = this.getPlan(planId);
    const preflight = this.preflight(planId);
    const profile = getMasteringProfile(plan.profileId);
    const sections = this.store.list('mastering_section', (row) => row.planId === planId);
    const creditSections = this.store.list('mastering_credit_section', (row) => row.planId === planId);
    const passed = sections.filter((row) => row.status === 'passed').length;
    const masteredCreditKinds = new Set(creditSections.filter((row) => row.status === 'passed').map((row) => row.kind));
    const creditsMastered = (!profile.openingCreditsRequired || masteredCreditKinds.has('opening'))
      && (!profile.closingCreditsRequired || masteredCreditKinds.has('closing'));
    return freeze({
      plan, profile, expectedChapters: preflight.chapterCount, masteredChapters: passed,
      failedChapters: sections.filter((row) => row.status === 'failed').length,
      missingCredits: preflight.missingCredits,
      masteredCredits: freeze([...masteredCreditKinds]),
      complete: passed === preflight.chapterCount && !preflight.missingCredits.length && creditsMastered
    });
  }

  finalize(planId, { reviewer }) {
    if (!String(reviewer ?? '').trim()) throw new Error('finalizing mastering requires reviewer');
    const plan = this.getPlan(planId);
    if (!plan.armed) throw new Error('mastering plan is not armed');
    const summary = this.summary(planId);
    if (!summary.complete) throw new Error('mastering cannot finalize until every chapter and required credit file passes');
    return this.store.update('mastering_plan', planId, (current) => freeze({
      ...current, status: 'mastered', locked: true, armed: false, finalizedBy: reviewer,
      finalizedAt: nowIso(this.clock), updatedAt: nowIso(this.clock)
    }));
  }
}
