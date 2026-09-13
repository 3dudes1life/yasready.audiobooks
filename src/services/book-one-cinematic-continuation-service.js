import { YASREADY_AUDIOBOOKS_VERSION } from '../release.js';
import { sha256, stableJson } from '../core/hash.js';
import { splitForTts } from '../production/model-limits.js';
import {
  verifyBookOneCinematicNaturalismLock,
  verifyBookOneCinematicRebuildResult,
  compileCinematicNaturalismScene
} from './book-one-cinematic-naturalism-service.js';
import {
  cinematicRecipeFingerprint,
  verifyBookOneCinematicHumanReviewApproval
} from './book-one-cinematic-review-gate-service.js';

export const BOOK_ONE_CINEMATIC_CONTINUATION_START_CHAPTER = 11;
export const BOOK_ONE_CINEMATIC_CONTINUATION_MAX_CHAPTERS_PER_BATCH = 10;
export const BOOK_ONE_CINEMATIC_CONTINUATION_RETRY_RATIO = 0.20;

export const BOOK_ONE_CINEMATIC_CONTINUATION_STATES = Object.freeze([
  'NOT_STARTED',
  'PROVIDER_IN_FLIGHT',
  'PROVIDER_RESULT_UNKNOWN_DO_NOT_RERUN',
  'PROVIDER_COMPLETE',
  'LOCAL_TEMPO_FAILED_SAFE_TO_RERUN',
  'TEMPO_COMPLETE',
  'LOCAL_FINISH_FAILED_SAFE_TO_RERUN',
  'FINISH_COMPLETE',
  'ASSEMBLY_QA_FAILED_SAFE_TO_RERUN',
  'COMPLETE'
]);

const freeze = (value) => {
  if (Array.isArray(value)) { for (const child of value) freeze(child); return Object.freeze(value); }
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); return Object.freeze(value); }
  return value;
};
const clean = (value) => String(value ?? '').trim();
const round = (value, digits = 6) => {
  const factor = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
};
const ceilCents = (value) => Math.ceil((Number(value) - Number.EPSILON) * 100) / 100;

function headingText(title) {
  const value = clean(title);
  if (!value) throw new Error('Continuation chapter title is required');
  return /[.!?]$/.test(value) ? value : `${value}.`;
}

function blueprintCore(value) {
  return {
    schemaVersion: value.schemaVersion,
    release: value.release,
    artifact: value.artifact,
    status: value.status,
    book: value.book,
    source: value.source,
    profile: value.profile,
    progress: value.progress,
    workload: value.workload,
    plannedBatches: value.plannedBatches,
    chapters: value.chapters,
    resumability: value.resumability,
    outputContract: value.outputContract,
    humanGate: value.humanGate,
    guardrails: value.guardrails
  };
}

function previewCore(value) {
  return {
    schemaVersion: value.schemaVersion,
    release: value.release,
    artifact: value.artifact,
    status: value.status,
    source: value.source,
    liveProvider: value.liveProvider,
    candidateScope: value.candidateScope,
    budgetPreview: value.budgetPreview,
    humanGate: value.humanGate,
    guardrails: value.guardrails
  };
}

function transitionCore(value) {
  return {
    schemaVersion: value.schemaVersion,
    artifact: value.artifact,
    blueprintDigest: value.blueprintDigest,
    chapterNumber: value.chapterNumber,
    state: value.state,
    providerRequestId: value.providerRequestId,
    providerAudioDigest: value.providerAudioDigest,
    localTempoDigest: value.localTempoDigest,
    localFinishDigest: value.localFinishDigest,
    finalAudioDigest: value.finalAudioDigest,
    lastFailure: value.lastFailure
  };
}

function assertProductionPlanShape(productionPlan) {
  if (!productionPlan || productionPlan.artifact !== 'book-one-production-plan') throw new Error('Continuation requires the Book One production plan');
  if (!productionPlan.integrity?.productionPlanDigest) throw new Error('Continuation production plan digest missing');
  if (!productionPlan.source?.sourceHash) throw new Error('Continuation production plan source hash missing');
  if (!Array.isArray(productionPlan.manifest?.chapters) || productionPlan.manifest.chapters.length < BOOK_ONE_CINEMATIC_CONTINUATION_START_CHAPTER) {
    throw new Error('Continuation requires a complete narrative chapter manifest');
  }
  const cap = Number(productionPlan.manifest?.maxCharactersPerProviderCall);
  if (!Number.isInteger(cap) || cap < 1) throw new Error('Continuation requires a valid provider character cap');
  return true;
}

export function reconcileBookOneContinuationManuscriptIdentity({
  productionPlan,
  manuscriptAnalysis,
  cinematicResult,
  cinematicLock
} = {}) {
  assertProductionPlanShape(productionPlan);
  if (!manuscriptAnalysis?.source?.sourceHash || !manuscriptAnalysis?.source?.normalizedTextHash) {
    throw new Error('Continuation manuscript identity requires raw and normalized manuscript hashes');
  }

  verifyBookOneCinematicNaturalismLock(cinematicLock);
  verifyBookOneCinematicRebuildResult(cinematicResult);

  const planDigest = productionPlan.integrity?.productionPlanDigest ?? null;
  if (!planDigest ||
      cinematicLock?.source?.productionPlanDigest !== planDigest ||
      cinematicResult?.source?.productionPlanDigest !== planDigest) {
    throw new Error('Continuation historical production-plan lineage disagrees before current manuscript comparison');
  }

  const planSourceHash = productionPlan.source?.sourceHash ?? null;
  const lockSourceHash = cinematicLock?.source?.manuscriptSourceHash ?? null;
  const resultSourceHash = cinematicResult?.source?.manuscriptSourceHash ?? null;

  if (!planSourceHash || !lockSourceHash || planSourceHash !== lockSourceHash) {
    throw new Error('Continuation locked manuscript evidence disagrees before current manuscript comparison');
  }
  if (resultSourceHash && resultSourceHash !== planSourceHash) {
    throw new Error('Continuation historical cinematic result manuscript source hash conflicts with the locked production source');
  }

  const historicalResultSourceHashPresent = Boolean(resultSourceHash);
  const historicalResultSourceHashInherited = !historicalResultSourceHashPresent;
  const lockedContainerSourceHash = planSourceHash;
  const currentContainerSourceHash = manuscriptAnalysis.source.sourceHash;
  const planNormalizedTextHash = productionPlan.source?.normalizedTextHash ?? null;
  const currentNormalizedTextHash = manuscriptAnalysis.source.normalizedTextHash;

  if (!planNormalizedTextHash) {
    throw new Error('Continuation production plan is missing normalized manuscript text identity');
  }

  const plannedChapters = [...(productionPlan.manifest?.chapters ?? [])]
    .sort((a, b) => Number(a.order) - Number(b.order));
  const currentChapters = manuscriptAnalysis.chapters ?? [];

  if (currentChapters.length !== plannedChapters.length) {
    throw new Error(`Continuation canonical manuscript structure drifted: planned ${plannedChapters.length} chapter(s), current ${currentChapters.length}`);
  }

  const chapterMismatches = [];
  for (const planned of plannedChapters) {
    const order = Number(planned.order);
    const current = currentChapters[order];
    if (!current) {
      chapterMismatches.push(freeze({ order, chapterNumber: order + 1, reason: 'missing-current-chapter' }));
      continue;
    }
    if (planned.sourceTextHash && current.textHash !== planned.sourceTextHash) {
      chapterMismatches.push(freeze({
        order,
        chapterNumber: order + 1,
        reason: 'chapter-text-hash-mismatch',
        plannedTextHash: planned.sourceTextHash,
        currentTextHash: current.textHash
      }));
    }
  }

  if (currentNormalizedTextHash !== planNormalizedTextHash) {
    throw new Error(
      `Continuation canonical manuscript text drifted: normalized text hash mismatch; ${chapterMismatches.length} chapter hash mismatch(es)`
    );
  }

  if (chapterMismatches.length) {
    throw new Error(
      `Continuation canonical manuscript chapter identity drifted despite normalized-text match: ${chapterMismatches.length} chapter mismatch(es)`
    );
  }

  return freeze({
    lockedContainerSourceHash,
    currentContainerSourceHash,
    containerHashMatchesLocked: currentContainerSourceHash === lockedContainerSourceHash,
    planNormalizedTextHash,
    currentNormalizedTextHash,
    normalizedTextHashMatches: true,
    chapterCount: plannedChapters.length,
    chapterHashesVerified: plannedChapters.length,
    chapterHashMismatches: 0,
    canonicalTextVerified: true,
    historicalResultSourceHash: resultSourceHash,
    historicalResultSourceHashPresent,
    historicalResultSourceHashInherited,
    historicalResultSourceHashInheritanceBasis: historicalResultSourceHashInherited
      ? 'integrity-verified historical cinematic result + exact production-plan digest lineage + matching cinematic lock manuscript source'
      : null,
    reconciliationPolicy: historicalResultSourceHashInherited
      ? (currentContainerSourceHash === lockedContainerSourceHash
          ? 'legacy-cinematic-result-missing-source-hash-reconciled-by-integrity-digest-lineage-and-exact-current-source'
          : 'legacy-cinematic-result-missing-source-hash-reconciled-by-integrity-digest-lineage-normalized-text-and-all-chapter-hashes')
      : (currentContainerSourceHash === lockedContainerSourceHash
          ? 'exact-container-and-canonical-text-match'
          : 'docx-container-drift-accepted-only-because-normalized-text-and-every-planned-chapter-hash-match')
  });
}

function assertTenComplete(cinematicResult, cinematicLock) {
  verifyBookOneCinematicRebuildResult(cinematicResult);
  verifyBookOneCinematicNaturalismLock(cinematicLock);
  if (cinematicResult.status !== 'READY_FOR_HUMAN_TEN_CHAPTER_REVIEW') throw new Error('Continuation requires the completed ten-chapter cinematic result');
  if (Number(cinematicResult.progress?.completedChapterCount) !== 10 ||
      Number(cinematicResult.progress?.targetChapterCount) !== 10 ||
      Number(cinematicResult.progress?.remainingChapterCount) !== 0 ||
      cinematicResult.progress?.allTenComplete !== true) {
    throw new Error('Continuation requires exactly 10/10 completed cinematic chapters');
  }
  if ((cinematicResult.chapters ?? []).length !== 10) throw new Error('Continuation requires exactly ten completed cinematic chapter records');
  if (cinematicResult.cinematicLockDigest !== cinematicLock.integrity?.lockDigest) throw new Error('Continuation result does not belong to cinematic lock');
  if (cinematicResult.guardrails?.chapterElevenMayBeGenerated !== false ||
      cinematicResult.guardrails?.nextBatchArmed !== false ||
      cinematicResult.guardrails?.fullBookGenerationArmed !== false) {
    throw new Error('Continuation source must still have Chapter 11 and later production closed');
  }
  return true;
}

function chapterPlanFromSource({ planned, sourceChapter, cinematicLock, maxChars }) {
  if (!sourceChapter) throw new Error(`Continuation manuscript chapter missing: ${planned.title}`);
  if (planned.sourceTextHash && sourceChapter.textHash !== planned.sourceTextHash) {
    throw new Error(`Continuation canonical manuscript drifted: ${planned.title}`);
  }

  const sceneRows = [];
  let providerCharacters = 0;
  let providerCalls = 0;
  let cueCount = 0;
  let narrationCueCount = 0;

  for (const scene of sourceChapter.scenes ?? []) {
    const compiled = compileCinematicNaturalismScene(scene.segments ?? [], cinematicLock);
    const chunks = splitForTts(compiled.providerText, { maxChars });
    providerCharacters += chunks.reduce((sum, chunk) => sum + [...chunk].length, 0);
    providerCalls += chunks.length;
    cueCount += Number(compiled.cueCount ?? 0);
    narrationCueCount += Number(compiled.narrationCueCount ?? 0);
    sceneRows.push(freeze({
      sceneOrder: Number(scene.order ?? sceneRows.length),
      canonicalDigest: compiled.canonicalDigest,
      providerDigest: compiled.providerDigest,
      subtlePerformanceDirections: Number(compiled.cueCount ?? 0),
      providerChunks: chunks.length,
      providerCharacters: chunks.reduce((sum, chunk) => sum + [...chunk].length, 0)
    }));
  }

  const heading = headingText(planned.title);
  const headingCharacters = [...heading].length;
  return freeze({
    order: Number(planned.order),
    chapterNumber: Number(planned.order) + 1,
    title: planned.title,
    sourceTextHash: planned.sourceTextHash ?? sourceChapter.textHash ?? null,
    canonicalChapterHash: sourceChapter.textHash ?? null,
    sceneCount: sceneRows.length,
    subtlePerformanceDirections: cueCount,
    narrationPerformanceDirections: narrationCueCount,
    spokenHeadingCharacters: headingCharacters,
    bodyProviderCharacters: providerCharacters,
    newProviderCharacters: headingCharacters + providerCharacters,
    spokenHeadingCalls: 1,
    bodyProviderCalls: providerCalls,
    newProviderCalls: 1 + providerCalls,
    scenes: freeze(sceneRows),
    plannedOutputs: freeze({
      providerMp3: 'provider-source-mp3',
      tempoAudio: 'tempo-processed-audio',
      warmSlightlyDeeperWav: 'warm-slightly-deeper-wav',
      assemblyWav: 'chapter-assembly-wav',
      archiveWav: 'archive-wav-2026',
      acxMp3: 'acx-2026',
      spotifyMp3: 'spotify-direct-2026',
      directOwnedMp3: 'direct-owned-mp3',
      appleWav: 'apple-partner-2026'
    })
  });
}

function sumChapters(chapters) {
  return freeze({
    chapterCount: chapters.length,
    providerCalls: chapters.reduce((sum, row) => sum + Number(row.newProviderCalls ?? 0), 0),
    providerCharacters: chapters.reduce((sum, row) => sum + Number(row.newProviderCharacters ?? 0), 0),
    subtlePerformanceDirections: chapters.reduce((sum, row) => sum + Number(row.subtlePerformanceDirections ?? 0), 0)
  });
}

export function buildBookOneCinematicContinuationBlueprint({
  productionPlan,
  manuscriptAnalysis,
  cinematicResult,
  cinematicLock,
  maxChaptersPerPlannedBatch = BOOK_ONE_CINEMATIC_CONTINUATION_MAX_CHAPTERS_PER_BATCH,
  retryReserveRatio = BOOK_ONE_CINEMATIC_CONTINUATION_RETRY_RATIO
} = {}) {
  assertProductionPlanShape(productionPlan);
  assertTenComplete(cinematicResult, cinematicLock);

  if (productionPlan.integrity.productionPlanDigest !== cinematicLock.source?.productionPlanDigest ||
      productionPlan.integrity.productionPlanDigest !== cinematicResult.source?.productionPlanDigest) {
    throw new Error('Continuation production plan digest drifted');
  }
  const manuscriptIdentity = reconcileBookOneContinuationManuscriptIdentity({
    productionPlan,
    manuscriptAnalysis,
    cinematicResult,
    cinematicLock
  });

  const batchCap = Number(maxChaptersPerPlannedBatch);
  if (!Number.isInteger(batchCap) || batchCap < 1 || batchCap > BOOK_ONE_CINEMATIC_CONTINUATION_MAX_CHAPTERS_PER_BATCH) {
    throw new Error(`maxChaptersPerPlannedBatch must be 1-${BOOK_ONE_CINEMATIC_CONTINUATION_MAX_CHAPTERS_PER_BATCH}`);
  }
  const reserveRatio = Number(retryReserveRatio);
  if (!(reserveRatio >= 0 && reserveRatio <= 1)) throw new Error('retryReserveRatio must be between 0 and 1');

  const maxChars = Number(productionPlan.manifest.maxCharactersPerProviderCall);
  const plannedChapters = [...productionPlan.manifest.chapters].sort((a, b) => Number(a.order) - Number(b.order));
  const remaining = plannedChapters.filter((chapter) => Number(chapter.order) >= 10);
  if (!remaining.length) throw new Error('Continuation found no chapters after Chapter 10');

  const chapters = remaining.map((planned) => chapterPlanFromSource({
    planned,
    sourceChapter: manuscriptAnalysis.chapters?.[Number(planned.order)],
    cinematicLock,
    maxChars
  }));

  const rate = Number(productionPlan.budget?.rateUsdPer1kCharacters ?? 0.10);
  const totals = sumChapters(chapters);
  const initialGenerationUsd = round((totals.providerCharacters / 1000) * rate, 6);
  const retryReserveCharacters = Math.ceil(totals.providerCharacters * reserveRatio);
  const retryReserveUsd = round(initialGenerationUsd * reserveRatio, 6);
  const protectedRemainderMaxUsd = ceilCents(initialGenerationUsd + retryReserveUsd);

  const plannedBatches = [];
  for (let i = 0; i < chapters.length; i += batchCap) {
    const rows = chapters.slice(i, i + batchCap);
    const subtotal = sumChapters(rows);
    const batchInitial = round((subtotal.providerCharacters / 1000) * rate, 6);
    const batchReserveChars = Math.ceil(subtotal.providerCharacters * reserveRatio);
    plannedBatches.push(freeze({
      ordinal: plannedBatches.length + 2,
      planningOnly: true,
      firstChapterNumber: rows[0].chapterNumber,
      lastChapterNumber: rows.at(-1).chapterNumber,
      chapterCount: rows.length,
      providerCalls: subtotal.providerCalls,
      providerCharacters: subtotal.providerCharacters,
      retryReserveCharacters: batchReserveChars,
      quotaEnvelopeCharacters: subtotal.providerCharacters + batchReserveChars,
      initialEstimateUsd: batchInitial,
      retryReserveUsd: round(batchInitial * reserveRatio, 6),
      protectedMaxUsd: ceilCents(batchInitial * (1 + reserveRatio))
    }));
  }

  const recipeFingerprint = cinematicRecipeFingerprint(cinematicLock);
  const base = {
    schemaVersion: 1,
    release: YASREADY_AUDIOBOOKS_VERSION,
    artifact: 'book-one-cinematic-continuation-blueprint',
    status: 'GATE_CLOSED_PENDING_TEN_CHAPTER_HUMAN_APPROVAL',
    book: productionPlan.book,
    source: freeze({
      productionPlanDigest: productionPlan.integrity.productionPlanDigest,
      cinematicResultDigest: cinematicResult.integrity.resultDigest,
      cinematicLockDigest: cinematicLock.integrity.lockDigest,
      manuscriptSourceHash: productionPlan.source.sourceHash,
      normalizedTextHash: productionPlan.source.normalizedTextHash,
      currentManuscriptContainerHash: manuscriptAnalysis.source.sourceHash,
      manuscriptIdentity
    }),
    profile: freeze({
      profileId: cinematicLock.profileId,
      recipeFingerprint,
      selectedComparison: cinematicLock.humanDecision?.selectedComparison,
      rejectedEscalation: cinematicLock.humanDecision?.rejectedEscalation,
      lockedProductionChain: cinematicLock.lockedProductionChain
    }),
    progress: freeze({
      totalNarrativeChapters: plannedChapters.length,
      completedCinematicChapters: 10,
      remainingCinematicChapters: chapters.length,
      firstPendingChapterNumber: chapters[0].chapterNumber,
      lastPendingChapterNumber: chapters.at(-1).chapterNumber
    }),
    workload: freeze({
      providerCalls: totals.providerCalls,
      providerCharacters: totals.providerCharacters,
      subtlePerformanceDirections: totals.subtlePerformanceDirections,
      retryReserveRatio: reserveRatio,
      retryReserveCharacters,
      quotaEnvelopeCharacters: totals.providerCharacters + retryReserveCharacters,
      rateUsdPer1kCharacters: rate,
      initialEstimateUsd: initialGenerationUsd,
      retryReserveUsd,
      protectedRemainderMaxUsd,
      estimateNotInvoice: true
    }),
    plannedBatches: freeze(plannedBatches),
    chapters: freeze(chapters),
    resumability: freeze({
      stateMachine: BOOK_ONE_CINEMATIC_CONTINUATION_STATES,
      providerInFlightMeansDoNotRerun: true,
      providerUnknownOutcomeMeansDoNotRerun: true,
      missingSettledProviderAudioDigestMeansDoNotRerun: true,
      deterministicProviderClientFailureMayRetry: true,
      providerTimeoutOr5xxOutcomeIsUnknown: true,
      localTempoFailureSafeToRerun: true,
      localFinishFailureSafeToRerun: true,
      localAssemblyQaFailureSafeToRerun: true,
      chapterStateMustBeDigestBoundToBlueprint: true
    }),
    outputContract: freeze({
      perChapter: freeze({
        archive: 'WAV 44.1 kHz / 24-bit',
        audibleAcx: 'MP3 44.1 kHz / 192 kbps CBR conservative master',
        spotify: 'MP3 44.1 kHz / 192 kbps CBR',
        directOwned: 'downloadable chapter MP3',
        apple: 'WAV partner package'
      }),
      fullBookAssembly: freeze({
        allowedBeforeAllNarrativeChaptersComplete: false,
        m4bAllowedBeforeFullBookComplete: false,
        finalDistributionManifestAllowedBeforeFullBookComplete: false
      })
    }),
    humanGate: freeze({
      tenChapterHumanReviewRequired: true,
      approvalArtifactRequired: 'book-one-cinematic-human-review-approval',
      requiredApprovalStatus: 'APPROVED_FOR_NEXT_BATCH_READINESS',
      approvalPresent: false,
      gateOpen: false,
      chapterElevenReason: 'The continuation engine is prepared, but real Chapter 11+ generation requires the explicit human ten-chapter approval artifact.'
    }),
    guardrails: freeze({
      planningOnly: true,
      providerTtsCallsPerformed: 0,
      providerSpendUsd: 0,
      approvalTokenCreated: false,
      spendAuthorized: false,
      existingTenChaptersMayBeRegenerated: false,
      existingTenChaptersMayBeOverwritten: false,
      canonicalTextImmutable: true,
      cinematicProfileLockedToA: true,
      plus2EscalationAllowed: false,
      chapterElevenMayBeGenerated: false,
      nextBatchArmed: false,
      fullBookGenerationArmed: false,
      productionRuntimeConnected: false,
      pauseFidelityProductionRuntimeConnected: false,
      pauseFidelityPlanRequiredBeforePaidContinuation: true,
      automaticScaleUp: false
    })
  };

  return freeze({ ...base, integrity: freeze({ blueprintDigest: sha256(stableJson(blueprintCore(base))) }) });
}

export function verifyBookOneCinematicContinuationBlueprint(blueprint) {
  if (!blueprint || blueprint.artifact !== 'book-one-cinematic-continuation-blueprint') throw new Error('Invalid cinematic continuation blueprint');
  if (blueprint.status !== 'GATE_CLOSED_PENDING_TEN_CHAPTER_HUMAN_APPROVAL') throw new Error('Continuation blueprint must remain gate closed');
  if (Number(blueprint.progress?.completedCinematicChapters) !== 10) throw new Error('Continuation blueprint must preserve the first ten completed chapters');
  if (blueprint.source?.manuscriptIdentity?.canonicalTextVerified !== true ||
      blueprint.source?.manuscriptIdentity?.normalizedTextHashMatches !== true ||
      Number(blueprint.source?.manuscriptIdentity?.chapterHashMismatches) !== 0) {
    throw new Error('Continuation blueprint canonical manuscript identity is not verified');
  }
  if (Number(blueprint.progress?.firstPendingChapterNumber) !== 11) throw new Error('Continuation blueprint must begin at Chapter 11');
  if (blueprint.guardrails?.providerTtsCallsPerformed !== 0 ||
      blueprint.guardrails?.providerSpendUsd !== 0 ||
      blueprint.guardrails?.approvalTokenCreated !== false ||
      blueprint.guardrails?.spendAuthorized !== false ||
      blueprint.guardrails?.chapterElevenMayBeGenerated !== false ||
      blueprint.guardrails?.nextBatchArmed !== false ||
      blueprint.guardrails?.fullBookGenerationArmed !== false ||
      blueprint.guardrails?.productionRuntimeConnected !== false) {
    throw new Error('Continuation blueprint guardrails drifted open');
  }
  if (!blueprint.integrity?.blueprintDigest ||
      sha256(stableJson(blueprintCore(blueprint))) !== blueprint.integrity.blueprintDigest) {
    throw new Error('Continuation blueprint digest mismatch');
  }
  return true;
}

export function buildBookOneCinematicContinuationPreview({
  blueprint,
  providerRemaining,
  providerTier = null,
  humanReviewApproval = null,
  maxChapters = BOOK_ONE_CINEMATIC_CONTINUATION_MAX_CHAPTERS_PER_BATCH
} = {}) {
  verifyBookOneCinematicContinuationBlueprint(blueprint);

  const remaining = Number(providerRemaining);
  if (!Number.isFinite(remaining) || remaining < 0) throw new Error('Continuation preview requires verified live provider remaining quota');

  let gateOpen = false;
  let approvalDigest = null;
  if (humanReviewApproval) {
    verifyBookOneCinematicHumanReviewApproval(humanReviewApproval);
    if (humanReviewApproval.status === 'APPROVED_FOR_NEXT_BATCH_READINESS' &&
        humanReviewApproval.humanDecision?.cinematicRecipeApproved === true &&
        humanReviewApproval.source?.cinematicResultDigest === blueprint.source.cinematicResultDigest &&
        humanReviewApproval.source?.cinematicLockDigest === blueprint.source.cinematicLockDigest &&
        humanReviewApproval.profile?.recipeFingerprint === blueprint.profile.recipeFingerprint) {
      gateOpen = true;
      approvalDigest = humanReviewApproval.integrity.approvalDigest;
    }
  }

  const cap = Number(maxChapters);
  if (!Number.isInteger(cap) || cap < 1 || cap > BOOK_ONE_CINEMATIC_CONTINUATION_MAX_CHAPTERS_PER_BATCH) {
    throw new Error(`maxChapters must be 1-${BOOK_ONE_CINEMATIC_CONTINUATION_MAX_CHAPTERS_PER_BATCH}`);
  }

  const reserveRatio = Number(blueprint.workload.retryReserveRatio);
  const selected = [];
  let providerCharacters = 0;
  let providerCalls = 0;

  for (const chapter of blueprint.chapters) {
    if (selected.length >= cap) break;
    const candidateChars = providerCharacters + Number(chapter.newProviderCharacters);
    const reserveChars = Math.ceil(candidateChars * reserveRatio);
    if (candidateChars + reserveChars > remaining) break;
    selected.push(chapter);
    providerCharacters = candidateChars;
    providerCalls += Number(chapter.newProviderCalls);
  }

  const retryReserveCharacters = Math.ceil(providerCharacters * reserveRatio);
  const quotaEnvelopeCharacters = providerCharacters + retryReserveCharacters;
  const rate = Number(blueprint.workload.rateUsdPer1kCharacters);
  const initialGenerationUsd = round((providerCharacters / 1000) * rate, 6);
  const retryReserveUsd = round(initialGenerationUsd * reserveRatio, 6);
  const protectedMaxUsd = ceilCents(initialGenerationUsd + retryReserveUsd);

  const status = selected.length === 0
    ? 'INSUFFICIENT_QUOTA_FOR_NEXT_WHOLE_CINEMATIC_CHAPTER'
    : gateOpen
      ? 'CANDIDATE_SCOPE_READY_GATE_OPEN_NOT_ARMED'
      : 'CANDIDATE_SCOPE_PREVIEW_GATE_CLOSED';

  const base = {
    schemaVersion: 1,
    release: YASREADY_AUDIOBOOKS_VERSION,
    artifact: 'book-one-cinematic-continuation-preview',
    status,
    source: freeze({
      blueprintDigest: blueprint.integrity.blueprintDigest,
      cinematicResultDigest: blueprint.source.cinematicResultDigest,
      cinematicLockDigest: blueprint.source.cinematicLockDigest,
      recipeFingerprint: blueprint.profile.recipeFingerprint
    }),
    liveProvider: freeze({
      tier: providerTier,
      providerReportedRemaining: remaining,
      providerTtsCallsPerformed: 0,
      providerSpendUsd: 0
    }),
    candidateScope: freeze({
      wholeChaptersOnly: true,
      maxChapters: cap,
      chapterCount: selected.length,
      firstChapterNumber: selected[0]?.chapterNumber ?? null,
      lastChapterNumber: selected.at(-1)?.chapterNumber ?? null,
      chapters: freeze(selected.map((chapter) => freeze({
        chapterNumber: chapter.chapterNumber,
        title: chapter.title,
        newProviderCalls: chapter.newProviderCalls,
        newProviderCharacters: chapter.newProviderCharacters,
        subtlePerformanceDirections: chapter.subtlePerformanceDirections
      }))),
      newProviderCalls: providerCalls,
      newProviderCharacters: providerCharacters,
      retryReserveCharacters,
      quotaEnvelopeCharacters,
      quotaHeadroomAfterEnvelope: remaining - quotaEnvelopeCharacters
    }),
    budgetPreview: freeze({
      currency: 'USD',
      rateUsdPer1kCharacters: rate,
      initialGenerationUsd,
      retryReserveUsd,
      protectedMaxUsd,
      estimateNotInvoice: true,
      spendAuthorized: false
    }),
    humanGate: freeze({
      approvalPresent: Boolean(humanReviewApproval),
      approvalAccepted: gateOpen,
      approvalDigest,
      gateOpen,
      requiredApprovalStatus: 'APPROVED_FOR_NEXT_BATCH_READINESS',
      nextAction: gateOpen
        ? 'Candidate scope is ready, but this release deliberately cannot create a spend token or run provider TTS. Build the separate production arm next.'
        : 'Finish and explicitly approve the ten-chapter human review before any Chapter 11+ production arm can exist.'
    }),
    guardrails: freeze({
      readOnlyPreviewOnly: true,
      providerTtsCallsPerformed: 0,
      providerSpendUsd: 0,
      approvalTokenCreated: false,
      spendAuthorized: false,
      existingTenChaptersMayBeRegenerated: false,
      chapterElevenMayBeGenerated: false,
      nextBatchArmed: false,
      productionRuntimeConnected: false,
      fullBookGenerationArmed: false
    })
  };

  return freeze({ ...base, integrity: freeze({ previewDigest: sha256(stableJson(previewCore(base))) }) });
}

export function verifyBookOneCinematicContinuationPreview(preview) {
  if (!preview || preview.artifact !== 'book-one-cinematic-continuation-preview') throw new Error('Invalid cinematic continuation preview');
  if (preview.guardrails?.providerTtsCallsPerformed !== 0 ||
      preview.guardrails?.providerSpendUsd !== 0 ||
      preview.guardrails?.approvalTokenCreated !== false ||
      preview.guardrails?.spendAuthorized !== false ||
      preview.guardrails?.chapterElevenMayBeGenerated !== false ||
      preview.guardrails?.nextBatchArmed !== false ||
      preview.guardrails?.productionRuntimeConnected !== false) {
    throw new Error('Continuation preview guardrails drifted open');
  }
  if (!preview.integrity?.previewDigest ||
      sha256(stableJson(previewCore(preview))) !== preview.integrity.previewDigest) {
    throw new Error('Continuation preview digest mismatch');
  }
  return true;
}

export function createBookOneCinematicContinuationChapterState({ blueprint, chapterNumber } = {}) {
  verifyBookOneCinematicContinuationBlueprint(blueprint);
  const number = Number(chapterNumber);
  const chapter = blueprint.chapters.find((row) => Number(row.chapterNumber) === number);
  if (!chapter) throw new Error(`Continuation chapter ${chapterNumber} is not in the blueprint`);
  const base = {
    schemaVersion: 1,
    artifact: 'book-one-cinematic-continuation-chapter-state',
    blueprintDigest: blueprint.integrity.blueprintDigest,
    chapterNumber: number,
    state: 'NOT_STARTED',
    providerRequestId: null,
    providerAudioDigest: null,
    localTempoDigest: null,
    localFinishDigest: null,
    finalAudioDigest: null,
    lastFailure: null
  };
  return freeze({ ...base, integrity: freeze({ stateDigest: sha256(stableJson(transitionCore(base))) }) });
}

export function transitionBookOneCinematicContinuationChapterState(state, nextState, evidence = {}) {
  if (!state || state.artifact !== 'book-one-cinematic-continuation-chapter-state') throw new Error('Invalid continuation chapter state');
  if (!state.integrity?.stateDigest || sha256(stableJson(transitionCore(state))) !== state.integrity.stateDigest) throw new Error('Continuation chapter state digest mismatch');
  if (!BOOK_ONE_CINEMATIC_CONTINUATION_STATES.includes(nextState)) throw new Error(`Unsupported continuation state: ${nextState}`);

  const allowed = {
    NOT_STARTED: ['PROVIDER_IN_FLIGHT'],
    PROVIDER_IN_FLIGHT: ['PROVIDER_COMPLETE', 'PROVIDER_RESULT_UNKNOWN_DO_NOT_RERUN'],
    PROVIDER_RESULT_UNKNOWN_DO_NOT_RERUN: [],
    PROVIDER_COMPLETE: ['TEMPO_COMPLETE', 'LOCAL_TEMPO_FAILED_SAFE_TO_RERUN'],
    LOCAL_TEMPO_FAILED_SAFE_TO_RERUN: ['TEMPO_COMPLETE'],
    TEMPO_COMPLETE: ['FINISH_COMPLETE', 'LOCAL_FINISH_FAILED_SAFE_TO_RERUN'],
    LOCAL_FINISH_FAILED_SAFE_TO_RERUN: ['FINISH_COMPLETE'],
    FINISH_COMPLETE: ['COMPLETE', 'ASSEMBLY_QA_FAILED_SAFE_TO_RERUN'],
    ASSEMBLY_QA_FAILED_SAFE_TO_RERUN: ['COMPLETE'],
    COMPLETE: []
  };

  if (!(allowed[state.state] ?? []).includes(nextState)) {
    throw new Error(`Unsafe continuation transition ${state.state} -> ${nextState}`);
  }

  const next = {
    ...state,
    state: nextState,
    providerRequestId: evidence.providerRequestId ?? state.providerRequestId,
    providerAudioDigest: evidence.providerAudioDigest ?? state.providerAudioDigest,
    localTempoDigest: evidence.localTempoDigest ?? state.localTempoDigest,
    localFinishDigest: evidence.localFinishDigest ?? state.localFinishDigest,
    finalAudioDigest: evidence.finalAudioDigest ?? state.finalAudioDigest,
    lastFailure: evidence.lastFailure ?? (
      ['LOCAL_TEMPO_FAILED_SAFE_TO_RERUN', 'LOCAL_FINISH_FAILED_SAFE_TO_RERUN', 'ASSEMBLY_QA_FAILED_SAFE_TO_RERUN', 'PROVIDER_RESULT_UNKNOWN_DO_NOT_RERUN'].includes(nextState)
        ? nextState
        : null
    )
  };
  delete next.integrity;

  if (nextState === 'PROVIDER_IN_FLIGHT' && !next.providerRequestId) throw new Error('Provider in-flight state requires provider request id');
  if (nextState === 'PROVIDER_COMPLETE' && !next.providerAudioDigest) throw new Error('Provider complete state requires settled provider audio digest');
  if (nextState === 'TEMPO_COMPLETE' && !next.localTempoDigest) throw new Error('Tempo complete state requires local tempo digest');
  if (nextState === 'FINISH_COMPLETE' && !next.localFinishDigest) throw new Error('Finish complete state requires local finish digest');
  if (nextState === 'COMPLETE' && !next.finalAudioDigest) throw new Error('Complete state requires final audio digest');

  return freeze({ ...next, integrity: freeze({ stateDigest: sha256(stableJson(transitionCore(next))) }) });
}

export function renderBookOneCinematicContinuationBlueprintMarkdown(blueprint) {
  verifyBookOneCinematicContinuationBlueprint(blueprint);
  const lines = [
    '# Book One — Cinematic Continuation Engine',
    '',
    `**Release:** ${blueprint.release}`,
    `**Status:** ${blueprint.status}`,
    '**Provider TTS calls:** 0',
    '**Provider spend:** $0.00',
    '**Chapter 11 generation:** OFF',
    '**Next batch armed:** NO',
    '**Full-book generation:** OFF',
    '',
    '## Progress',
    '',
    `- Cinematic chapters complete: **${blueprint.progress.completedCinematicChapters}/${blueprint.progress.totalNarrativeChapters}**`,
    `- Remaining: **${blueprint.progress.remainingCinematicChapters}**`,
    `- Prepared continuation: **Chapter ${blueprint.progress.firstPendingChapterNumber} → Chapter ${blueprint.progress.lastPendingChapterNumber}**`,
    `- Canonical manuscript verified: **YES**`,
    `- DOCX container hash exact match: **${blueprint.source.manuscriptIdentity.containerHashMatchesLocked ? 'YES' : 'NO — reconciled by canonical text + chapter hashes'}**`,
    '',
    '## Remainder production model',
    '',
    `- Provider calls: **${blueprint.workload.providerCalls}**`,
    `- Provider characters: **${blueprint.workload.providerCharacters.toLocaleString()}**`,
    `- Subtle performance directions: **${blueprint.workload.subtlePerformanceDirections}**`,
    `- Retry reserve: **${blueprint.workload.retryReserveCharacters.toLocaleString()} characters**`,
    `- Planning-only protected remainder max: **$${blueprint.workload.protectedRemainderMaxUsd.toFixed(2)}**`,
    '',
    '## Planned whole-chapter windows',
    ''
  ];
  for (const batch of blueprint.plannedBatches) {
    lines.push(`- Chapters ${batch.firstChapterNumber}–${batch.lastChapterNumber}: ${batch.chapterCount} chapters / ${batch.providerCalls} calls / ${batch.providerCharacters.toLocaleString()} chars / planning max $${batch.protectedMaxUsd.toFixed(2)}`);
  }
  lines.push(
    '',
    '## Human gate',
    '',
    'The continuation engine is prepared, but **no Chapter 11+ production can run** until the ten-chapter human review is explicitly approved.',
    'This release creates no production token and has no provider TTS runtime connected.',
    ''
  );
  return lines.join('\n');
}

export function renderBookOneCinematicContinuationPreviewMarkdown(preview) {
  verifyBookOneCinematicContinuationPreview(preview);
  const lines = [
    '# Book One — Cinematic Continuation Live Quota Preview',
    '',
    `**Status:** ${preview.status}`,
    '**Provider TTS calls:** 0',
    '**Spend:** $0.00',
    '**Approval token created:** NO',
    '**Chapter 11 generated:** NO',
    '**Next batch armed:** NO',
    '',
    `- Live provider remaining: **${preview.liveProvider.providerReportedRemaining.toLocaleString()} characters**`,
    `- Candidate whole chapters: **${preview.candidateScope.chapterCount}**`,
    `- Candidate scope: **${preview.candidateScope.firstChapterNumber ?? 'none'} → ${preview.candidateScope.lastChapterNumber ?? 'none'}**`,
    `- Candidate provider calls: **${preview.candidateScope.newProviderCalls}**`,
    `- Candidate provider characters: **${preview.candidateScope.newProviderCharacters.toLocaleString()}**`,
    `- Retry reserve: **${preview.candidateScope.retryReserveCharacters.toLocaleString()}**`,
    `- Quota envelope: **${preview.candidateScope.quotaEnvelopeCharacters.toLocaleString()}**`,
    `- Preview protected max: **$${preview.budgetPreview.protectedMaxUsd.toFixed(2)}**`,
    '',
    `Human gate open: **${preview.humanGate.gateOpen ? 'YES' : 'NO'}**`,
    preview.humanGate.nextAction,
    ''
  ];
  return lines.join('\n');
}

export function renderBookOneCinematicContinuationDashboardHtml(blueprint) {
  verifyBookOneCinematicContinuationBlueprint(blueprint);
  const completed = Array.from({ length: 10 }, (_, i) => ({
    chapterNumber: i + 1,
    title: `Chapter ${i + 1}`,
    status: 'CINEMATIC COMPLETE',
    detail: 'Human review in progress'
  }));
  const pending = blueprint.chapters.map((chapter) => ({
    chapterNumber: chapter.chapterNumber,
    title: chapter.title,
    status: 'READY IN BLUEPRINT · GATE CLOSED',
    detail: `${chapter.newProviderCalls} calls · ${chapter.newProviderCharacters.toLocaleString()} chars · ${chapter.subtlePerformanceDirections} subtle performance directions`
  }));
  const rows = [...completed, ...pending].map((row) => `
    <article class="chapter ${row.chapterNumber <= 10 ? 'done' : 'locked'}">
      <div class="number">${row.chapterNumber}</div>
      <div class="copy"><h3>${escapeHtml(row.title)}</h3><p>${escapeHtml(row.status)}</p><span>${escapeHtml(row.detail)}</span></div>
    </article>`).join('');

  const batches = blueprint.plannedBatches.map((batch) => `
    <div class="batch"><strong>Chapters ${batch.firstChapterNumber}–${batch.lastChapterNumber}</strong><span>${batch.chapterCount} chapters · ${batch.providerCalls} calls · ${batch.providerCharacters.toLocaleString()} chars · planning max $${batch.protectedMaxUsd.toFixed(2)}</span></div>`).join('');

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Book One Cinematic Continuation</title><style>
  :root{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text",Inter,system-ui,sans-serif;background:#f5f5f7;color:#111}*{box-sizing:border-box}body{margin:0;padding:28px}.wrap{max-width:1060px;margin:auto}.hero,.panel{background:#fff;border:1px solid #e5e5ea;border-radius:26px;box-shadow:0 12px 36px rgba(0,0,0,.06)}.hero{padding:32px}.panel{padding:22px;margin-top:18px}h1{font-size:38px;letter-spacing:-.04em;margin:4px 0 8px}h2{margin:0 0 14px}.eyebrow,.muted{color:#6e6e73}.eyebrow{text-transform:uppercase;font-size:12px;font-weight:800;letter-spacing:.09em}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:20px}.stat{background:#f5f5f7;padding:15px;border-radius:18px}.stat strong{display:block;font-size:24px}.gate{margin-top:18px;background:#fff3cd;border-radius:18px;padding:16px}.batch{display:flex;justify-content:space-between;gap:16px;padding:13px 0;border-bottom:1px solid #eee}.batch span{color:#6e6e73;text-align:right}.chapter{display:flex;gap:15px;padding:15px 0;border-bottom:1px solid #eee}.number{width:38px;height:38px;border-radius:12px;display:grid;place-items:center;font-weight:800;background:#f5f5f7}.done .number{background:#e9f8ee}.locked .number{background:#fff3cd}.copy h3{margin:0;font-size:16px}.copy p{margin:4px 0;font-size:12px;font-weight:800}.copy span{color:#6e6e73;font-size:13px}@media(max-width:700px){body{padding:14px}.stats{grid-template-columns:1fr 1fr}.batch{display:block}.batch span{display:block;text-align:left;margin-top:4px}}
  </style></head><body><main class="wrap"><section class="hero"><div class="eyebrow">YasReady Audiobooks ${escapeHtml(blueprint.release)}</div><h1>Cinematic Continuation Engine</h1><p class="muted">The rest of Book One is mapped with the exact approved Cinematic Naturalism A production recipe. Real Chapter 11+ generation remains locked behind your ten-chapter human review.</p><div class="stats"><div class="stat"><strong>10/${blueprint.progress.totalNarrativeChapters}</strong><span>cinematic complete</span></div><div class="stat"><strong>${blueprint.progress.remainingCinematicChapters}</strong><span>prepared chapters</span></div><div class="stat"><strong>${blueprint.workload.providerCalls}</strong><span>planned provider calls</span></div><div class="stat"><strong>$${blueprint.workload.protectedRemainderMaxUsd.toFixed(2)}</strong><span>planning max</span></div></div><div class="gate"><strong>Human gate CLOSED.</strong> Provider TTS calls: 0 · Spend: $0.00 · Chapter 11 generation: OFF · No production token exists.</div><p class="muted">Canonical manuscript identity: VERIFIED · DOCX container hash: ${blueprint.source.manuscriptIdentity.containerHashMatchesLocked ? 'exact match' : 'changed container, canonical text unchanged and every chapter hash verified'}</p></section><section class="panel"><h2>Planned production windows</h2>${batches}</section><section class="panel"><h2>Book progress</h2>${rows}</section></main></body></html>`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
