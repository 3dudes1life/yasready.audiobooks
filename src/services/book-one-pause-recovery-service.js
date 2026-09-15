import { YASREADY_AUDIOBOOKS_VERSION } from '../release.js';
import { sha256, stableJson } from '../core/hash.js';
import { verifyBookOnePauseDeficitAudit } from './book-one-pause-deficit-audit-service.js';
import { verifyBookOneCinematicRebuildResult } from './book-one-cinematic-naturalism-service.js';

const freeze = (value) => {
  if (Array.isArray(value)) { for (const child of value) freeze(child); return Object.freeze(value); }
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); return Object.freeze(value); }
  return value;
};

function resultCore(result) {
  return {
    schemaVersion: result.schemaVersion,
    release: result.release,
    artifact: result.artifact,
    status: result.status,
    book: result.book,
    cinematicLockDigest: result.cinematicLockDigest,
    source: result.source,
    progress: result.progress,
    latestArm: result.latestArm,
    cost: result.cost,
    chapters: result.chapters,
    guardrails: result.guardrails
  };
}

export function buildRecoveredCinematicResultFromState({
  priorAudit,
  state,
  outputRoot,
  stateFileDigest
} = {}) {
  verifyBookOnePauseDeficitAudit(priorAudit);

  if (!state || state.artifact !== 'book-one-cinematic-rebuild-state') {
    throw new Error('Pause recovery state artifact is invalid');
  }
  if (Number(state.targetChapterCount) !== 10) {
    throw new Error(`Pause recovery state must target exactly 10 chapters; found ${state.targetChapterCount}`);
  }
  if (!state.productionPlanDigest || state.productionPlanDigest !== priorAudit.source?.productionPlanDigest) {
    throw new Error('Pause recovery state production-plan lineage mismatch');
  }
  if (!state.cinematicLockDigest || state.cinematicLockDigest !== priorAudit.source?.cinematicLockDigest) {
    throw new Error('Pause recovery state cinematic-lock lineage mismatch');
  }
  if (!state.recipeDigest || !state.targetDigest || !state.originalBatchResultDigest) {
    throw new Error('Pause recovery state is missing recipe/target/original-batch lineage');
  }
  if (!outputRoot) throw new Error('Pause recovery state requires its output root');
  if (!stateFileDigest) throw new Error('Pause recovery state requires a state-file digest');

  const chapters = Object.values(state.chapters ?? {})
    .filter((row) => row && Number(row.chapterNumber) >= 1 && Number(row.chapterNumber) <= 10)
    .sort((a, b) => Number(a.chapterNumber) - Number(b.chapterNumber));

  if (chapters.length !== 10) {
    throw new Error(`Pause recovery state requires 10 completed chapter records; found ${chapters.length}`);
  }
  const numbers = chapters.map((row) => Number(row.chapterNumber));
  if (stableJson(numbers) !== stableJson([1,2,3,4,5,6,7,8,9,10])) {
    throw new Error('Pause recovery state chapter numbering is incomplete or duplicated');
  }

  for (const chapter of chapters) {
    if (chapter.status !== 'COMPLETE') {
      throw new Error(`Pause recovery state Chapter ${chapter.chapterNumber} is not COMPLETE`);
    }
    if (!chapter.outputs?.directMp3 || !chapter.digests?.directMp3) {
      throw new Error(`Pause recovery state Chapter ${chapter.chapterNumber} lacks Direct MP3 path/digest evidence`);
    }
  }

  const anyQaFailure = chapters.some((chapter) =>
    chapter.qa?.archive?.passed === false || chapter.qa?.mp3?.passed === false
  );

  const base = {
    schemaVersion: 1,
    release: YASREADY_AUDIOBOOKS_VERSION,
    artifact: 'book-one-cinematic-rebuild-result',
    status: anyQaFailure ? 'TECHNICAL_QA_REVIEW_REQUIRED' : 'READY_FOR_HUMAN_TEN_CHAPTER_REVIEW',
    book: freeze({
      id: priorAudit.book?.id ?? null,
      title: priorAudit.book?.title ?? null,
      author: priorAudit.book?.author ?? null,
      sourceHash: priorAudit.source.manuscriptSourceHash
    }),
    cinematicLockDigest: state.cinematicLockDigest,
    source: freeze({
      productionPlanDigest: state.productionPlanDigest,
      recipeDigest: state.recipeDigest,
      originalBatchResultDigest: state.originalBatchResultDigest,
      targetDigest: state.targetDigest,
      outputRoot,
      recoverySource: 'CINEMATIC_REBUILD_STATE',
      recoveryStateDigest: stateFileDigest,
      recoveryOnlyNoProductionAuthorization: true
    }),
    progress: freeze({
      targetChapterCount: 10,
      completedChapterCount: 10,
      remainingChapterCount: 0,
      allTenComplete: true
    }),
    latestArm: freeze({
      armDigest: state.activeArmDigest ?? null,
      recoveredFromState: true,
      providerGenerationCallsThisRun: 0,
      localTempoTasksThisRun: 0,
      localFinishTasksThisRun: 0,
      requestIdsObservedThisRun: freeze([])
    }),
    cost: freeze({
      latestArmApprovedMaxUsd: 0,
      latestArmCapturedOrEstimatedBilledUsd: 0,
      totalCinematicCapturedOrEstimatedBilledUsd: 0,
      estimateNotInvoice: true,
      localProcessingUsd: 0,
      recoverySpendUsd: 0
    }),
    chapters: freeze(chapters.map((chapter) => freeze({ ...chapter }))),
    guardrails: freeze({
      originalBatchPreserved: true,
      originalsMayBeOverwritten: false,
      cinematicProfileLockedToA: true,
      plus2EscalationAllowed: false,
      humanTenChapterListenRequiredBeforeChapterEleven: true,
      chapterElevenMayBeGenerated: false,
      nextBatchArmed: false,
      fullBookGenerationArmed: false,
      automaticScaleUp: false,
      recoveryOnlyNoProductionAuthorization: true
    })
  };

  const result = freeze({
    ...base,
    integrity: freeze({ resultDigest: sha256(stableJson(resultCore(base))) })
  });
  verifyBookOneCinematicRebuildResult(result);
  return result;
}
