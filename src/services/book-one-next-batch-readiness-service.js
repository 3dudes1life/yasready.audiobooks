import { sha256, stableJson } from '../core/hash.js';
import { verifyHistoricalBookOneBatchArm, verifyHistoricalBookOneBatchResult } from '../production/historical-batch-integrity.js';

export const NEXT_BATCH_READINESS_MAX_CHAPTERS = 10;
export const NEXT_BATCH_READINESS_RETRY_RATIO = 0.20;

const freeze = (value) => {
  if (Array.isArray(value)) { for (const child of value) freeze(child); return Object.freeze(value); }
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); return Object.freeze(value); }
  return value;
};
const round = (value, digits = 6) => {
  const factor = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
};
const ceilCents = (value) => Math.ceil((Number(value) - Number.EPSILON) * 100) / 100;
function headingText(title) {
  const clean = String(title ?? '').trim();
  if (!clean) throw new Error('Next-batch readiness requires every chapter to have a title');
  return /[.!?]$/.test(clean) ? clean : `${clean}.`;
}

function verifyInputs({ productionPlan, previousArm, previousResult }) {
  if (!productionPlan || productionPlan.artifact !== 'book-one-production-plan') throw new Error('Next-batch readiness requires the Book One production plan');
  if (!productionPlan.integrity?.productionPlanDigest) throw new Error('Production plan digest missing');
  if (!Array.isArray(productionPlan.manifest?.chapters) || productionPlan.manifest.chapters.length < 1) throw new Error('Production plan chapter manifest missing');
  if (productionPlan.guardrails?.productionArmed !== false || productionPlan.guardrails?.fullBookGenerationArmed !== false) throw new Error('Next-batch readiness refuses an already-armed production plan');
  verifyHistoricalBookOneBatchArm(previousArm);
  verifyHistoricalBookOneBatchResult(previousResult);
  if (previousResult.armDigest !== previousArm.integrity.armDigest) throw new Error('Previous batch result does not belong to the previous arm');
  if (previousArm.source?.productionPlanDigest !== productionPlan.integrity.productionPlanDigest) throw new Error('Previous batch arm does not belong to this production plan');
  if (previousResult.status === 'TECHNICAL_QA_REVIEW_REQUIRED') throw new Error('Next-batch readiness is blocked while the previous batch has unresolved technical QA');
}

export function buildBookOneNextBatchReadiness({
  productionPlan,
  previousArm,
  previousResult,
  providerRemaining,
  providerTier = null,
  retryReserveRatio = NEXT_BATCH_READINESS_RETRY_RATIO,
  maxChapters = NEXT_BATCH_READINESS_MAX_CHAPTERS
} = {}) {
  verifyInputs({ productionPlan, previousArm, previousResult });
  const remaining = Number(providerRemaining);
  if (!Number.isFinite(remaining) || remaining < 0) throw new Error('Next-batch readiness requires verified live provider remaining quota');
  const reserveRatio = Number(retryReserveRatio);
  if (!(reserveRatio >= 0 && reserveRatio <= 1)) throw new Error('retryReserveRatio must be between 0 and 1');
  const chapterCap = Number(maxChapters);
  if (!Number.isInteger(chapterCap) || chapterCap < 1 || chapterCap > NEXT_BATCH_READINESS_MAX_CHAPTERS) throw new Error(`maxChapters must be between 1 and ${NEXT_BATCH_READINESS_MAX_CHAPTERS}`);

  const previousLastOrder = Number(previousResult.batch?.lastChapterOrder);
  if (!Number.isInteger(previousLastOrder)) throw new Error('Previous batch result is missing lastChapterOrder');
  const remainingChapters = [...productionPlan.manifest.chapters]
    .filter((chapter) => Number(chapter.order) > previousLastOrder)
    .sort((a, b) => Number(a.order) - Number(b.order));

  const selected = [];
  let newProviderCharacters = 0;
  let newProviderCalls = 0;
  for (const chapter of remainingChapters) {
    if (selected.length >= chapterCap) break;
    const spokenHeading = headingText(chapter.title);
    const chapterCharacters = Number(chapter.providerCharacters ?? 0) + spokenHeading.length;
    const chapterCalls = Number(chapter.providerGenerationCalls ?? 0) + 1;
    const candidateCharacters = newProviderCharacters + chapterCharacters;
    const candidateReserve = Math.ceil(candidateCharacters * reserveRatio);
    if (candidateCharacters + candidateReserve > remaining) break;
    selected.push(freeze({
      order: chapter.order,
      chapterNumber: Number(chapter.order) + 1,
      title: chapter.title,
      bodyProviderCharacters: Number(chapter.providerCharacters ?? 0),
      spokenHeadingCharacters: spokenHeading.length,
      newProviderCharacters: chapterCharacters,
      bodyProviderCalls: Number(chapter.providerGenerationCalls ?? 0),
      spokenHeadingCalls: 1,
      newProviderCalls: chapterCalls
    }));
    newProviderCharacters = candidateCharacters;
    newProviderCalls += chapterCalls;
  }

  const retryReserveCharacters = Math.ceil(newProviderCharacters * reserveRatio);
  const quotaEnvelopeCharacters = newProviderCharacters + retryReserveCharacters;
  const rate = Number(productionPlan.budget?.rateUsdPer1kCharacters ?? 0.10);
  const initialGenerationUsd = round((newProviderCharacters / 1000) * rate, 6);
  const retryReserveUsd = round(initialGenerationUsd * reserveRatio, 6);
  const protectedMaxUsd = ceilCents(initialGenerationUsd + retryReserveUsd);
  const noBookWorkLeft = remainingChapters.length === 0;
  const status = noBookWorkLeft
    ? 'BOOK_COMPLETE_NO_NEXT_BATCH'
    : selected.length === 0
      ? 'INSUFFICIENT_QUOTA_FOR_NEXT_WHOLE_CHAPTER'
      : 'READINESS_CALCULATED_HUMAN_REVIEW_GATE_CLOSED';

  const base = {
    schemaVersion: 1,
    artifact: 'book-one-next-batch-readiness',
    status,
    source: freeze({
      productionPlanDigest: productionPlan.integrity.productionPlanDigest,
      previousArmDigest: previousArm.integrity.armDigest,
      previousResultDigest: previousResult.integrity.resultDigest,
      previousBatchOrdinal: Number(previousResult.batch?.ordinal ?? 1),
      previousLastChapterOrder: previousLastOrder
    }),
    liveProvider: freeze({
      checkedAt: new Date().toISOString(),
      tier: providerTier,
      providerReportedRemaining: remaining,
      providerTtsCallsPerformed: 0,
      providerSpendUsd: 0
    }),
    candidateBatch: freeze({
      ordinal: Number(previousResult.batch?.ordinal ?? 1) + 1,
      wholeChaptersOnly: true,
      hardCap: chapterCap,
      chapterCount: selected.length,
      firstChapterOrder: selected[0]?.order ?? null,
      lastChapterOrder: selected.at(-1)?.order ?? null,
      chapters: freeze(selected),
      newProviderCalls,
      newProviderCharacters,
      retryReserveRatio: reserveRatio,
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
    humanReviewGate: freeze({
      previousBatchHumanListenRequired: true,
      previousBatchApproved: false,
      nextBatchMayBeArmedByThisArtifact: false,
      nextAction: selected.length
        ? 'Finish listening to the previous batch. A later explicit arm must recheck live quota and require a new exact spend token.'
        : noBookWorkLeft
          ? 'No narrative chapters remain.'
          : 'Wait for more provider quota or reduce nothing: partial chapters are not allowed.'
    }),
    guardrails: freeze({
      readOnlyReadinessOnly: true,
      providerTtsCallsPerformed: 0,
      providerSpendUsd: 0,
      noApprovalTokenCreated: true,
      nextBatchArmed: false,
      productionArmed: false,
      fullBookGenerationArmed: false,
      wholeChapterBoundaryRequired: true,
      automaticScaleUp: false
    })
  };
  return freeze({ ...base, integrity: freeze({ readinessDigest: sha256(stableJson(base)) }) });
}

export function renderBookOneNextBatchReadinessMarkdown(result) {
  const lines = [
    '# Book One — Next Batch Readiness',
    '',
    `**Status:** ${result.status}`,
    '**Provider TTS calls:** 0',
    '**Spend:** $0.00',
    '**Next batch armed:** NO',
    '**Full-book generation armed:** NO',
    '',
    '## Candidate scope',
    '',
    `- Candidate batch: **${result.candidateBatch.ordinal}**`,
    `- Whole chapters: **${result.candidateBatch.chapterCount}**`,
    `- New provider calls: **${result.candidateBatch.newProviderCalls}**`,
    `- New provider characters: **${result.candidateBatch.newProviderCharacters.toLocaleString()}**`,
    `- Retry reserve: **${result.candidateBatch.retryReserveCharacters.toLocaleString()} characters**`,
    `- Quota envelope: **${result.candidateBatch.quotaEnvelopeCharacters.toLocaleString()} / ${result.liveProvider.providerReportedRemaining.toLocaleString()} available**`,
    `- Preview protected max: **$${Number(result.budgetPreview.protectedMaxUsd).toFixed(2)}**`,
    ''
  ];
  for (const chapter of result.candidateBatch.chapters) lines.push(`- Chapter ${chapter.chapterNumber}: ${chapter.title} — ${chapter.newProviderCharacters.toLocaleString()} chars / ${chapter.newProviderCalls} calls`);
  lines.push('', '## Gate', '', 'This is a **read-only preview**. It creates no BATCH token and authorizes no spend.', result.humanReviewGate.nextAction, '');
  return lines.join('\n');
}
