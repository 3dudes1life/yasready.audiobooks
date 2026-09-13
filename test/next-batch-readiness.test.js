import test from 'node:test';
import assert from 'node:assert/strict';
import { sha256, stableJson } from '../src/core/hash.js';
import { historicalBatchArmCore, historicalBatchResultCore } from '../src/production/historical-batch-integrity.js';
import { buildBookOneNextBatchReadiness } from '../src/services/book-one-next-batch-readiness-service.js';

function historicalArm(planDigest) {
  const base = {
    schemaVersion: 1,
    release: '0.14.3.16',
    artifact: 'book-one-quota-aware-batch-arm',
    status: 'ARMED_FOR_EXACT_BATCH_ONLY',
    book: { id: 'book-one' },
    source: { productionPlanDigest: planDigest },
    liveProvider: { providerReportedRemaining: 118097 },
    batchScope: { ordinal: 1, selectedChapterCount: 10, firstChapterOrder: 0, lastChapterOrder: 9, chapters: [] },
    budget: { protectedMaxUsd: 8.34 },
    storage: {},
    outputContract: {},
    pilotReuse: {},
    guardrails: { batchArmed: true, fullBookGenerationArmed: false }
  };
  const armDigest = sha256(stableJson(historicalBatchArmCore(base)));
  return { ...base, integrity: { armDigest }, confirmation: { token: `BATCH-${armDigest.slice(0,10).toUpperCase()}` } };
}

function historicalResult(armDigest, { status = 'READY_FOR_HUMAN_BATCH_REVIEW', lastChapterOrder = 9 } = {}) {
  const base = {
    schemaVersion: 1,
    release: '0.14.3.16',
    artifact: 'book-one-batch-production-result',
    status,
    book: { id: 'book-one' },
    armDigest,
    recipeDigest: 'recipe',
    batch: { ordinal: 1, chapterCount: 10, firstChapterOrder: 0, lastChapterOrder },
    provider: {},
    cost: {},
    chapters: [],
    distribution: {},
    guardrails: { nextBatchArmed: false, fullBookGenerationArmed: false }
  };
  return { ...base, integrity: { resultDigest: sha256(stableJson(historicalBatchResultCore(base))) } };
}

function plan(planDigest) {
  return {
    artifact: 'book-one-production-plan',
    integrity: { productionPlanDigest: planDigest },
    guardrails: { productionArmed: false, fullBookGenerationArmed: false },
    budget: { rateUsdPer1kCharacters: 0.10 },
    manifest: {
      chapters: [
        ...Array.from({ length: 10 }, (_, order) => ({ order, title: `Old ${order + 1}`, providerCharacters: 1000, providerGenerationCalls: 1 })),
        { order: 10, title: 'Chapter 11', providerCharacters: 10000, providerGenerationCalls: 2 },
        { order: 11, title: 'Chapter 12', providerCharacters: 20000, providerGenerationCalls: 3 },
        { order: 12, title: 'Chapter 13', providerCharacters: 30000, providerGenerationCalls: 4 }
      ]
    }
  };
}

test('next-batch readiness previews only whole chapters and cannot authorize spend', () => {
  const planDigest = 'plan-digest';
  const arm = historicalArm(planDigest);
  const result = historicalResult(arm.integrity.armDigest);
  const readiness = buildBookOneNextBatchReadiness({
    productionPlan: plan(planDigest),
    previousArm: arm,
    previousResult: result,
    providerRemaining: 40000,
    providerTier: 'creator'
  });
  assert.equal(readiness.status, 'READINESS_CALCULATED_HUMAN_REVIEW_GATE_CLOSED');
  assert.equal(readiness.candidateBatch.ordinal, 2);
  assert.equal(readiness.candidateBatch.chapterCount, 2);
  assert.equal(readiness.candidateBatch.chapters[0].chapterNumber, 11);
  assert.equal(readiness.candidateBatch.chapters[1].chapterNumber, 12);
  assert.equal(readiness.guardrails.providerTtsCallsPerformed, 0);
  assert.equal(readiness.guardrails.noApprovalTokenCreated, true);
  assert.equal(readiness.guardrails.nextBatchArmed, false);
  assert.equal(readiness.budgetPreview.spendAuthorized, false);
  assert.ok(readiness.candidateBatch.quotaEnvelopeCharacters <= 40000);
});

test('next-batch readiness returns a clean quota blocker rather than selecting a partial chapter', () => {
  const planDigest = 'plan-digest';
  const arm = historicalArm(planDigest);
  const result = historicalResult(arm.integrity.armDigest);
  const readiness = buildBookOneNextBatchReadiness({
    productionPlan: plan(planDigest),
    previousArm: arm,
    previousResult: result,
    providerRemaining: 1000
  });
  assert.equal(readiness.status, 'INSUFFICIENT_QUOTA_FOR_NEXT_WHOLE_CHAPTER');
  assert.equal(readiness.candidateBatch.chapterCount, 0);
  assert.equal(readiness.guardrails.nextBatchArmed, false);
});

test('next-batch readiness blocks unresolved previous technical QA', () => {
  const planDigest = 'plan-digest';
  const arm = historicalArm(planDigest);
  const result = historicalResult(arm.integrity.armDigest, { status: 'TECHNICAL_QA_REVIEW_REQUIRED' });
  assert.throws(() => buildBookOneNextBatchReadiness({
    productionPlan: plan(planDigest),
    previousArm: arm,
    previousResult: result,
    providerRemaining: 50000
  }), /technical QA/);
});
