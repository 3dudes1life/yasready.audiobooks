import { randomUUID } from 'node:crypto';
import { sha256 } from '../core/hash.js';

const freeze = (value) => Object.freeze(value);
const timestamp = (clock) => clock().toISOString();

export const REVIEW_STATUSES = Object.freeze({
  SESSION: Object.freeze(['in_review', 'approved', 'paused']),
  CHAPTER: Object.freeze(['in_review', 'approved']),
  REGION: Object.freeze(['pending', 'approved'])
});

export function createReviewSession({ projectId, bookId, productionPlanId, name = 'Audiobook Review' }, { clock = () => new Date() } = {}) {
  if (!projectId || !bookId || !productionPlanId) throw new Error('review session requires projectId, bookId and productionPlanId');
  const now = timestamp(clock);
  return freeze({
    id: randomUUID(), type: 'review_session', projectId, bookId, productionPlanId, name,
    status: 'in_review', revision: 1, locked: false, createdAt: now, updatedAt: now
  });
}

export function createChapterReview({ sessionId, projectId, bookId, chapterId, order = 0, title = null }, { clock = () => new Date() } = {}) {
  if (!sessionId || !chapterId) throw new Error('chapter review requires sessionId and chapterId');
  const now = timestamp(clock);
  return freeze({
    id: randomUUID(), type: 'chapter_review', sessionId, projectId, bookId, chapterId,
    order, title, status: 'in_review', revision: 1, locked: false,
    approvedBy: null, approvedAt: null, createdAt: now, updatedAt: now
  });
}

export function createReviewTake({ sessionId, chapterReviewId, chapterId, jobId, label, asset, durationMs = null, waveformLocator = null, transcriptLocator = null }, { clock = () => new Date() } = {}) {
  if (!sessionId || !chapterReviewId || !chapterId || !jobId || !label || !asset) throw new Error('review take requires session/chapter/job/label/asset');
  if (['audio', 'data', 'bytesData'].some((key) => key in asset)) throw new Error('review takes store asset references, not raw audio bytes');
  const now = timestamp(clock);
  return freeze({
    id: randomUUID(), type: 'review_take', sessionId, chapterReviewId, chapterId, jobId, label,
    asset: freeze({ ...asset }), durationMs: durationMs == null ? null : Number(durationMs),
    waveformLocator, transcriptLocator, locked: false, createdAt: now, updatedAt: now
  });
}

export function createReviewRegion({ sessionId, chapterReviewId, chapterId, regionKey, order, canonicalText, cueId = null, segmentId = null }, { clock = () => new Date() } = {}) {
  if (!sessionId || !chapterReviewId || !chapterId || !regionKey || !String(canonicalText ?? '').trim()) throw new Error('review region requires session/chapter/key/text');
  const now = timestamp(clock);
  return freeze({
    id: randomUUID(), type: 'review_region', sessionId, chapterReviewId, chapterId, regionKey,
    order: Number(order), cueId, segmentId, canonicalText, canonicalTextHash: sha256(canonicalText),
    status: 'pending', selectedTakeId: null, rejectedTakeIds: freeze([]), locked: false,
    createdAt: now, updatedAt: now
  });
}

export function createReviewTiming({ sessionId, chapterReviewId, chapterId, takeId, regionId, startMs, endMs }, { clock = () => new Date() } = {}) {
  if (!sessionId || !takeId || !regionId) throw new Error('review timing requires session, take and region');
  const start = Number(startMs); const end = Number(endMs);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) throw new Error('review timing requires a valid positive time range');
  const now = timestamp(clock);
  return freeze({ id: randomUUID(), type: 'review_timing', sessionId, chapterReviewId, chapterId, takeId, regionId, startMs: start, endMs: end, createdAt: now, updatedAt: now });
}

export function createReviewDecision({ sessionId, chapterReviewId, chapterId, regionId = null, takeId = null, action, reviewer, reason = null, notes = null }, { clock = () => new Date() } = {}) {
  if (!sessionId || !chapterReviewId || !chapterId || !action || !String(reviewer ?? '').trim()) throw new Error('review decision requires session/chapter/action/reviewer');
  const now = timestamp(clock);
  return freeze({ id: randomUUID(), type: 'review_decision', sessionId, chapterReviewId, chapterId, regionId, takeId, action, reviewer, reason, notes, createdAt: now });
}

export function createRegenerationRequest({ sessionId, chapterReviewId, chapterId, regionId, takeId, sourceJobId, reason, requestedBy }, { clock = () => new Date() } = {}) {
  if (!sessionId || !chapterReviewId || !chapterId || !regionId || !takeId || !sourceJobId || !String(reason ?? '').trim() || !String(requestedBy ?? '').trim()) {
    throw new Error('regeneration request requires region/take/source job/reason/requestedBy');
  }
  const now = timestamp(clock);
  return freeze({
    id: randomUUID(), type: 'regeneration_request', sessionId, chapterReviewId, chapterId,
    regionId, takeId, sourceJobId, reason, requestedBy, status: 'requested', generatedJobId: null,
    createdAt: now, updatedAt: now
  });
}
