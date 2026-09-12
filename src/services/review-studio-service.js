import {
  createReviewSession, createChapterReview, createReviewTake, createReviewRegion,
  createReviewTiming, createReviewDecision, createRegenerationRequest
} from '../review/review-model.js';
import { sha256 } from '../core/hash.js';

const freeze = (value) => Object.freeze(value);
const nowIso = (clock) => clock().toISOString();

function nextTakeLabel(existing) {
  const used = new Set(existing.map((take) => take.label));
  for (let i = 0; i < 26; i += 1) {
    const label = String.fromCharCode(65 + i);
    if (!used.has(label)) return label;
  }
  throw new Error('review studio supports at most 26 labeled takes per chapter');
}

export class ReviewStudioService {
  constructor(store, { productionEngine = null, clock = () => new Date() } = {}) {
    if (!store) throw new Error('ReviewStudioService requires a store');
    this.store = store;
    this.productionEngine = productionEngine;
    this.clock = clock;
  }

  createSession(input) {
    const production = this.store.get('production_plan', input.productionPlanId);
    if (!production) throw new Error(`production_plan ${input.productionPlanId} not found`);
    if (production.projectId !== input.projectId || production.bookId !== input.bookId) {
      throw new Error('review session production plan must belong to the same project/book');
    }
    const existing = this.store.list('review_session', (row) => row.productionPlanId === input.productionPlanId)[0];
    if (existing && (existing.projectId !== input.projectId || existing.bookId !== input.bookId)) {
      throw new Error('existing review session belongs to another project/book');
    }
    return existing ?? this.store.put(createReviewSession(input, { clock: this.clock }));
  }

  getSession(sessionId) {
    const session = this.store.get('review_session', sessionId);
    if (!session) throw new Error(`review_session ${sessionId} not found`);
    return session;
  }

  #assertSessionOpen(sessionId) {
    const session = this.getSession(sessionId);
    if (session.locked) throw new Error('review session is locked');
    return session;
  }

  openChapter(sessionId, { chapterId, order = 0, title = null }) {
    const session = this.#assertSessionOpen(sessionId);
    const existing = this.store.list('chapter_review', (row) => row.sessionId === sessionId && row.chapterId === chapterId)[0];
    return existing ?? this.store.put(createChapterReview({
      sessionId, projectId: session.projectId, bookId: session.bookId, chapterId, order, title
    }, { clock: this.clock }));
  }

  getChapter(chapterReviewId) {
    const chapter = this.store.get('chapter_review', chapterReviewId);
    if (!chapter) throw new Error(`chapter_review ${chapterReviewId} not found`);
    return chapter;
  }

  #assertChapterEditable(chapterReviewId) {
    const chapter = this.getChapter(chapterReviewId);
    this.#assertSessionOpen(chapter.sessionId);
    if (chapter.locked) throw new Error('chapter review is locked');
    return chapter;
  }

  registerTake(chapterReviewId, { jobId, label = null, durationMs = null, waveformLocator = null, transcriptLocator = null }) {
    const chapter = this.#assertChapterEditable(chapterReviewId);
    const existing = this.store.list('review_take', (row) => row.chapterReviewId === chapterReviewId && row.jobId === jobId)[0];
    if (existing) return existing;
    const job = this.store.get('production_job', jobId);
    if (!job) throw new Error(`production_job ${jobId} not found`);
    if (job.status !== 'ready') throw new Error('only ready production jobs may enter Review Studio');
    const session = this.getSession(chapter.sessionId);
    if (job.projectId !== session.projectId || job.bookId !== session.bookId || job.planId !== session.productionPlanId) {
      throw new Error('production job belongs to another project/book/production plan');
    }
    if (!job.asset) throw new Error('ready production job has no asset reference');
    const takes = this.store.list('review_take', (row) => row.chapterReviewId === chapterReviewId);
    const resolvedLabel = label ?? nextTakeLabel(takes);
    if (takes.some((take) => take.label === resolvedLabel)) throw new Error(`take label ${resolvedLabel} already exists in chapter`);
    return this.store.put(createReviewTake({
      sessionId: chapter.sessionId, chapterReviewId, chapterId: chapter.chapterId, jobId,
      label: resolvedLabel, asset: job.asset, durationMs, waveformLocator, transcriptLocator
    }, { clock: this.clock }));
  }

  updateTakePresentation(takeId, { durationMs, waveformLocator, transcriptLocator } = {}) {
    const take = this.store.get('review_take', takeId);
    if (!take) throw new Error(`review_take ${takeId} not found`);
    this.#assertChapterEditable(take.chapterReviewId);
    if (take.locked) throw new Error('review take is locked');
    return this.store.update('review_take', takeId, (current) => freeze({
      ...current,
      ...(durationMs !== undefined ? { durationMs: Number(durationMs) } : {}),
      ...(waveformLocator !== undefined ? { waveformLocator } : {}),
      ...(transcriptLocator !== undefined ? { transcriptLocator } : {}),
      updatedAt: nowIso(this.clock)
    }));
  }

  registerTimeline(chapterReviewId, takeId, entries) {
    const chapter = this.#assertChapterEditable(chapterReviewId);
    const take = this.store.get('review_take', takeId);
    if (!take || take.chapterReviewId !== chapterReviewId) throw new Error('timeline take does not belong to chapter');
    if (!Array.isArray(entries) || !entries.length) throw new Error('timeline requires entries');

    const sorted = [...entries].sort((a, b) => Number(a.startMs) - Number(b.startMs));
    let previousEnd = -1;
    for (const entry of sorted) {
      const start = Number(entry.startMs); const end = Number(entry.endMs);
      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) throw new Error('timeline contains invalid time range');
      if (start < previousEnd) throw new Error('timeline regions overlap');
      if (take.durationMs != null && end > take.durationMs) throw new Error('timeline exceeds take duration');
      previousEnd = end;
    }

    const timings = [];
    for (let i = 0; i < sorted.length; i += 1) {
      const entry = sorted[i];
      const regionKey = String(entry.regionKey ?? entry.cueId ?? entry.segmentId ?? `region-${i + 1}`);
      let region = this.store.list('review_region', (row) => row.chapterReviewId === chapterReviewId && row.regionKey === regionKey)[0];
      if (!region) {
        region = this.store.put(createReviewRegion({
          sessionId: chapter.sessionId, chapterReviewId, chapterId: chapter.chapterId,
          regionKey, order: entry.order ?? i, canonicalText: entry.canonicalText,
          cueId: entry.cueId ?? null, segmentId: entry.segmentId ?? null
        }, { clock: this.clock }));
      } else if (region.canonicalTextHash !== sha256(entry.canonicalText)) {
        throw new Error(`canonical text mismatch for review region ${regionKey}`);
      }

      const prior = this.store.list('review_timing', (row) => row.takeId === takeId && row.regionId === region.id)[0];
      if (prior) {
        timings.push(this.store.update('review_timing', prior.id, (current) => freeze({
          ...current, startMs: Number(entry.startMs), endMs: Number(entry.endMs), updatedAt: nowIso(this.clock)
        })));
      } else {
        timings.push(this.store.put(createReviewTiming({
          sessionId: chapter.sessionId, chapterReviewId, chapterId: chapter.chapterId,
          takeId, regionId: region.id, startMs: entry.startMs, endMs: entry.endMs
        }, { clock: this.clock })));
      }
    }
    return freeze(timings);
  }

  approveRegion(regionId, { takeId, reviewer, notes = null }) {
    const region = this.store.get('review_region', regionId);
    if (!region) throw new Error(`review_region ${regionId} not found`);
    this.#assertChapterEditable(region.chapterReviewId);
    if (region.locked) throw new Error('review region is locked');
    const take = this.store.get('review_take', takeId);
    if (!take || take.chapterReviewId !== region.chapterReviewId) throw new Error('selected take does not belong to region chapter');
    const timing = this.store.list('review_timing', (row) => row.takeId === takeId && row.regionId === regionId)[0];
    if (!timing) throw new Error('selected take has no synchronized timing for region');
    const updated = this.store.update('review_region', regionId, (current) => freeze({
      ...current, status: 'approved', selectedTakeId: takeId, updatedAt: nowIso(this.clock)
    }));
    this.store.put(createReviewDecision({
      sessionId: region.sessionId, chapterReviewId: region.chapterReviewId, chapterId: region.chapterId,
      regionId, takeId, action: 'approve-region', reviewer, notes
    }, { clock: this.clock }));
    return updated;
  }

  rejectTake(regionId, { takeId, reviewer, reason, requestRegeneration = true }) {
    if (!String(reason ?? '').trim()) throw new Error('rejecting a take requires a reason');
    const region = this.store.get('review_region', regionId);
    if (!region) throw new Error(`review_region ${regionId} not found`);
    this.#assertChapterEditable(region.chapterReviewId);
    if (region.locked) throw new Error('review region is locked');
    const take = this.store.get('review_take', takeId);
    if (!take || take.chapterReviewId !== region.chapterReviewId) throw new Error('rejected take does not belong to region chapter');
    const rejected = [...new Set([...(region.rejectedTakeIds ?? []), takeId])];
    const updated = this.store.update('review_region', regionId, (current) => freeze({
      ...current, rejectedTakeIds: freeze(rejected),
      ...(current.selectedTakeId === takeId ? { selectedTakeId: null, status: 'pending' } : {}),
      updatedAt: nowIso(this.clock)
    }));
    this.store.put(createReviewDecision({
      sessionId: region.sessionId, chapterReviewId: region.chapterReviewId, chapterId: region.chapterId,
      regionId, takeId, action: 'reject-take', reviewer, reason
    }, { clock: this.clock }));
    let regeneration = null;
    if (requestRegeneration) {
      regeneration = this.store.put(createRegenerationRequest({
        sessionId: region.sessionId, chapterReviewId: region.chapterReviewId, chapterId: region.chapterId,
        regionId, takeId, sourceJobId: take.jobId, reason, requestedBy: reviewer
      }, { clock: this.clock }));
    }
    return freeze({ region: updated, regeneration });
  }

  queueRegeneration(requestId) {
    const request = this.store.get('regeneration_request', requestId);
    if (!request) throw new Error(`regeneration_request ${requestId} not found`);
    if (request.status !== 'requested') return request;
    if (!this.productionEngine) throw new Error('Review Studio has no Production Engine attached');
    const job = this.productionEngine.requestRegeneration(request.sourceJobId, { reason: request.reason });
    return this.store.update('regeneration_request', requestId, (current) => freeze({
      ...current, status: 'queued', generatedJobId: job.id, queuedAt: nowIso(this.clock), updatedAt: nowIso(this.clock)
    }));
  }

  chapterProgress(chapterReviewId) {
    const chapter = this.getChapter(chapterReviewId);
    const regions = this.store.list('review_region', (row) => row.chapterReviewId === chapterReviewId);
    const approved = regions.filter((row) => row.status === 'approved' && row.selectedTakeId).length;
    const rejectedAttempts = this.store.list('review_decision', (row) => row.chapterReviewId === chapterReviewId && row.action === 'reject-take').length;
    const total = regions.length;
    return freeze({
      chapterReviewId, chapterId: chapter.chapterId, status: chapter.status,
      totalRegions: total, approvedRegions: approved, pendingRegions: total - approved,
      rejectedAttempts, completionPct: total ? Math.round((approved / total) * 100) : 0
    });
  }

  approveChapter(chapterReviewId, { reviewer }) {
    const chapter = this.#assertChapterEditable(chapterReviewId);
    if (!String(reviewer ?? '').trim()) throw new Error('chapter approval requires reviewer');
    const regions = this.store.list('review_region', (row) => row.chapterReviewId === chapterReviewId);
    if (!regions.length) throw new Error('chapter cannot be approved without review regions');
    if (regions.some((region) => region.status !== 'approved' || !region.selectedTakeId)) throw new Error('chapter cannot be approved until every region has an approved take');
    const selectedTakeIds = [...new Set(regions.map((region) => region.selectedTakeId))];
    for (const region of regions) this.store.update('review_region', region.id, (current) => freeze({ ...current, locked: true, updatedAt: nowIso(this.clock) }));
    for (const takeId of selectedTakeIds) this.store.update('review_take', takeId, (current) => freeze({ ...current, locked: true, updatedAt: nowIso(this.clock) }));
    this.store.put(createReviewDecision({
      sessionId: chapter.sessionId, chapterReviewId, chapterId: chapter.chapterId,
      action: 'approve-chapter', reviewer
    }, { clock: this.clock }));
    return this.store.update('chapter_review', chapterReviewId, (current) => freeze({
      ...current, status: 'approved', locked: true, approvedBy: reviewer,
      approvedAt: nowIso(this.clock), updatedAt: nowIso(this.clock)
    }));
  }

  unlockChapter(chapterReviewId, { reviewer, reason }) {
    const chapter = this.getChapter(chapterReviewId);
    this.#assertSessionOpen(chapter.sessionId);
    if (!String(reviewer ?? '').trim() || !String(reason ?? '').trim()) throw new Error('unlocking chapter requires reviewer and reason');
    const regions = this.store.list('review_region', (row) => row.chapterReviewId === chapterReviewId);
    const takeIds = [...new Set(regions.map((row) => row.selectedTakeId).filter(Boolean))];
    for (const region of regions) this.store.update('review_region', region.id, (current) => freeze({ ...current, locked: false, updatedAt: nowIso(this.clock) }));
    for (const takeId of takeIds) this.store.update('review_take', takeId, (current) => freeze({ ...current, locked: false, updatedAt: nowIso(this.clock) }));
    this.store.put(createReviewDecision({
      sessionId: chapter.sessionId, chapterReviewId, chapterId: chapter.chapterId,
      action: 'unlock-chapter', reviewer, reason
    }, { clock: this.clock }));
    return this.store.update('chapter_review', chapterReviewId, (current) => freeze({
      ...current, status: 'in_review', locked: false, approvedBy: null, approvedAt: null,
      revision: (current.revision ?? 1) + 1, lastUnlockReason: reason, updatedAt: nowIso(this.clock)
    }));
  }

  takeMatrix(chapterReviewId) {
    const chapter = this.getChapter(chapterReviewId);
    const takes = this.store.list('review_take', (row) => row.chapterReviewId === chapterReviewId).sort((a, b) => a.label.localeCompare(b.label));
    const regions = this.store.list('review_region', (row) => row.chapterReviewId === chapterReviewId).sort((a, b) => a.order - b.order);
    const timings = this.store.list('review_timing', (row) => row.chapterReviewId === chapterReviewId);
    return freeze({ chapter, takes: freeze(takes), regions: freeze(regions), timings: freeze(timings), progress: this.chapterProgress(chapterReviewId) });
  }

  lockSession(sessionId, { reviewer }) {
    const session = this.#assertSessionOpen(sessionId);
    if (!String(reviewer ?? '').trim()) throw new Error('session approval requires reviewer');
    const chapters = this.store.list('chapter_review', (row) => row.sessionId === sessionId);
    if (!chapters.length || chapters.some((chapter) => chapter.status !== 'approved' || !chapter.locked)) {
      throw new Error('review session cannot be approved until every chapter is approved');
    }
    return this.store.update('review_session', sessionId, (current) => freeze({
      ...current, status: 'approved', locked: true, approvedBy: reviewer,
      approvedAt: nowIso(this.clock), updatedAt: nowIso(this.clock)
    }));
  }

  unlockSession(sessionId, { reviewer, reason }) {
    const session = this.getSession(sessionId);
    if (!String(reviewer ?? '').trim() || !String(reason ?? '').trim()) throw new Error('unlocking review session requires reviewer and reason');
    return this.store.update('review_session', sessionId, (current) => freeze({
      ...current, status: 'in_review', locked: false, approvedBy: null, approvedAt: null,
      revision: (current.revision ?? 1) + 1, lastUnlockReason: reason, updatedAt: nowIso(this.clock)
    }));
  }

  sessionSummary(sessionId) {
    const session = this.getSession(sessionId);
    const chapters = this.store.list('chapter_review', (row) => row.sessionId === sessionId).sort((a, b) => a.order - b.order);
    const progress = chapters.map((chapter) => this.chapterProgress(chapter.id));
    const totalRegions = progress.reduce((sum, item) => sum + item.totalRegions, 0);
    const approvedRegions = progress.reduce((sum, item) => sum + item.approvedRegions, 0);
    return freeze({
      session, chapters: freeze(chapters), progress: freeze(progress),
      approvedChapters: chapters.filter((row) => row.status === 'approved').length,
      totalChapters: chapters.length, totalRegions, approvedRegions,
      completionPct: totalRegions ? Math.round((approvedRegions / totalRegions) * 100) : 0
    });
  }
}
