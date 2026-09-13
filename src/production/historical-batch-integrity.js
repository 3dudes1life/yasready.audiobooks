import { sha256, stableJson } from '../core/hash.js';

export const BOOK_ONE_HISTORICAL_BATCH_RELEASES = Object.freeze(['0.14.3.16', '0.14.3.17', '0.14.3.18', '0.14.3.18.1']);

export function historicalBatchArmCore(arm) {
  return {
    schemaVersion: arm.schemaVersion,
    release: arm.release,
    artifact: arm.artifact,
    status: arm.status,
    book: arm.book,
    source: arm.source,
    liveProvider: arm.liveProvider,
    batchScope: arm.batchScope,
    budget: arm.budget,
    storage: arm.storage,
    outputContract: arm.outputContract,
    pilotReuse: arm.pilotReuse,
    guardrails: arm.guardrails
  };
}

export function historicalBatchResultCore(result) {
  return {
    schemaVersion: result.schemaVersion,
    release: result.release,
    artifact: result.artifact,
    status: result.status,
    book: result.book,
    armDigest: result.armDigest,
    recipeDigest: result.recipeDigest,
    batch: result.batch,
    provider: result.provider,
    cost: result.cost,
    chapters: result.chapters,
    distribution: result.distribution,
    guardrails: result.guardrails
  };
}

export function verifyHistoricalBookOneBatchArm(arm) {
  if (!arm || arm.artifact !== 'book-one-quota-aware-batch-arm') throw new Error('Invalid historical Book One batch arm');
  if (!BOOK_ONE_HISTORICAL_BATCH_RELEASES.includes(arm.release)) throw new Error(`Unsupported historical batch arm release: ${arm.release ?? 'missing'}`);
  if (arm.status !== 'ARMED_FOR_EXACT_BATCH_ONLY') throw new Error('Historical batch arm status invalid');
  if (!arm.integrity?.armDigest) throw new Error('Historical batch arm digest missing');
  const expected = sha256(stableJson(historicalBatchArmCore(arm)));
  if (expected !== arm.integrity.armDigest) throw new Error('Historical batch arm integrity digest mismatch');
  if (arm.confirmation?.token !== `BATCH-${expected.slice(0, 10).toUpperCase()}`) throw new Error('Historical batch arm token mismatch');
  if (arm.guardrails?.fullBookGenerationArmed !== false) throw new Error('Historical batch arm unexpectedly armed full-book generation');
  return true;
}

export function verifyHistoricalBookOneBatchResult(result) {
  if (!result || result.artifact !== 'book-one-batch-production-result') throw new Error('Invalid historical Book One batch result');
  if (!BOOK_ONE_HISTORICAL_BATCH_RELEASES.includes(result.release)) throw new Error(`Unsupported historical batch result release: ${result.release ?? 'missing'}`);
  if (!['READY_FOR_HUMAN_BATCH_REVIEW', 'TECHNICAL_QA_REVIEW_REQUIRED'].includes(result.status)) throw new Error('Historical batch result status invalid');
  if (!result.integrity?.resultDigest) throw new Error('Historical batch result digest missing');
  const expected = sha256(stableJson(historicalBatchResultCore(result)));
  if (expected !== result.integrity.resultDigest) throw new Error('Historical batch result integrity digest mismatch');
  if (result.guardrails?.nextBatchArmed !== false || result.guardrails?.fullBookGenerationArmed !== false) throw new Error('Historical batch result guardrails invalid');
  return true;
}
