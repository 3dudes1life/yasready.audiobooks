import test from 'node:test';
import assert from 'node:assert/strict';
import {
  YASREADY_AUDIOBOOKS_VERSION,
  sha256,
  stableJson,
  buildBookOnePauseDeficitAudit,
  buildRecoveredCinematicResultFromState,
  verifyBookOneCinematicRebuildResult
} from '../src/index.js';

function makeOldResult() {
  const chapters = Array.from({ length: 10 }, (_, i) => ({
    chapterNumber: i + 1,
    title: `Chapter ${i + 1}`,
    outputs: { directMp3: `distribution/direct-owned/${String(i + 1).padStart(3, '0')}-chapter-${i + 1}.mp3` },
    digests: { directMp3: `old-${i + 1}` }
  }));

  const base = {
    schemaVersion: 1,
    release: YASREADY_AUDIOBOOKS_VERSION,
    artifact: 'book-one-cinematic-rebuild-result',
    status: 'READY_FOR_HUMAN_TEN_CHAPTER_REVIEW',
    book: { id: 'book-one', title: 'Fixture', sourceHash: 'source' },
    cinematicLockDigest: 'lock',
    source: {
      productionPlanDigest: 'plan',
      recipeDigest: 'recipe',
      originalBatchResultDigest: 'old-batch',
      targetDigest: 'target',
      outputRoot: '/tmp/old'
    },
    progress: { targetChapterCount: 10, completedChapterCount: 10, remainingChapterCount: 0, allTenComplete: true },
    latestArm: {},
    cost: {},
    chapters,
    guardrails: {
      originalBatchPreserved: true,
      originalsMayBeOverwritten: false,
      cinematicProfileLockedToA: true,
      plus2EscalationAllowed: false,
      humanTenChapterListenRequiredBeforeChapterEleven: true,
      chapterElevenMayBeGenerated: false,
      nextBatchArmed: false,
      fullBookGenerationArmed: false,
      automaticScaleUp: false
    }
  };

  const core = {
    schemaVersion: base.schemaVersion,
    release: base.release,
    artifact: base.artifact,
    status: base.status,
    book: base.book,
    cinematicLockDigest: base.cinematicLockDigest,
    source: base.source,
    progress: base.progress,
    latestArm: base.latestArm,
    cost: base.cost,
    chapters: base.chapters,
    guardrails: base.guardrails
  };

  return { ...base, integrity: { resultDigest: sha256(stableJson(core)) } };
}

function makePausePlan(resultDigest) {
  const base = {
    schemaVersion: 1,
    release: YASREADY_AUDIOBOOKS_VERSION,
    artifact: 'book-one-pause-fidelity-plan',
    status: 'PAUSE_FIDELITY_ANALYZED_PRODUCTION_GATE_STILL_CLOSED',
    book: { id: 'book-one', title: 'Fixture', sourceHash: 'source' },
    source: {
      manuscriptSourceHash: 'source',
      currentManuscriptSourceHash: 'source',
      normalizedTextHash: 'normalized',
      productionPlanDigest: 'plan',
      cinematicLockDigest: 'lock',
      cinematicResultDigest: resultDigest,
      paragraphLayoutAvailable: true
    },
    policy: { policy: 'minimum-total-boundary-silence-floor-not-blind-additive-padding' },
    reviewEvidence: { present: false },
    summary: { canonicalWordsChanged: false },
    chapters: Array.from({ length: 10 }, (_, i) => ({
      order: i,
      chapterNumber: i + 1,
      title: `Chapter ${i + 1}`,
      paragraphCount: 1,
      sceneCount: 1,
      boundaries: []
    })),
    repairAssessment: {},
    guardrails: {
      planningOnly: true,
      canonicalTextImmutable: true,
      canonicalWordsChanged: false,
      providerTtsCallsPerformed: 0,
      providerSpendUsd: 0,
      spendAuthorized: false,
      repairAudioWritten: false,
      existingTenChaptersMayBeOverwritten: false,
      chapterElevenMayBeGenerated: false,
      nextBatchArmed: false,
      fullBookGenerationArmed: false
    }
  };

  const core = {
    schemaVersion: base.schemaVersion,
    release: base.release,
    artifact: base.artifact,
    status: base.status,
    book: base.book,
    source: base.source,
    policy: base.policy,
    reviewEvidence: base.reviewEvidence,
    summary: base.summary,
    chapters: base.chapters,
    repairAssessment: base.repairAssessment,
    guardrails: base.guardrails
  };

  return { ...base, integrity: { pausePlanDigest: sha256(stableJson(core)) } };
}

function makeAudit() {
  const result = makeOldResult();
  const plan = makePausePlan(result.integrity.resultDigest);
  const audioEvidence = {
    chapters: Array.from({ length: 10 }, (_, i) => ({
      chapterNumber: i + 1,
      audioFile: `/tmp/old-${i + 1}.mp3`,
      audioFileUrl: `file:///tmp/old-${i + 1}.mp3`,
      actualDigest: `old-${i + 1}`,
      durationMs: 1000,
      silences: []
    }))
  };
  return buildBookOnePauseDeficitAudit({ pausePlan: plan, cinematicResult: result, audioEvidence });
}

function makeState(overrides = {}) {
  const chapters = Object.fromEntries(Array.from({ length: 10 }, (_, i) => {
    const n = i + 1;
    return [String(i), {
      status: 'COMPLETE',
      chapterNumber: n,
      sourceChapterOrder: i,
      title: `Chapter ${n}`,
      outputs: { directMp3: `distribution/direct-owned/${String(n).padStart(3, '0')}-chapter-${n}.mp3` },
      digests: { directMp3: `current-${n}` },
      qa: { archive: { passed: true }, mp3: { passed: true } },
      analysis: {}
    }];
  }));

  return {
    schemaVersion: 1,
    release: YASREADY_AUDIOBOOKS_VERSION,
    artifact: 'book-one-cinematic-rebuild-state',
    cinematicLockDigest: 'lock',
    productionPlanDigest: 'plan',
    recipeDigest: 'recipe',
    targetDigest: 'target',
    targetChapterCount: 10,
    originalBatchResultDigest: 'old-batch',
    activeArmDigest: null,
    chunks: {},
    chapters,
    ...overrides
  };
}

test('R6 builds recovery-only result from coherent state', () => {
  const recovered = buildRecoveredCinematicResultFromState({
    priorAudit: makeAudit(),
    state: makeState(),
    outputRoot: '/tmp/current',
    stateFileDigest: 'state-digest'
  });

  assert.equal(verifyBookOneCinematicRebuildResult(recovered), true);
  assert.equal(recovered.progress.allTenComplete, true);
  assert.equal(recovered.chapters.length, 10);
  assert.equal(recovered.source.recoverySource, 'CINEMATIC_REBUILD_STATE');
  assert.equal(recovered.source.recoveryOnlyNoProductionAuthorization, true);
  assert.equal(recovered.guardrails.chapterElevenMayBeGenerated, false);
  assert.equal(recovered.guardrails.fullBookGenerationArmed, false);
});

test('R6 rejects state production-plan drift', () => {
  assert.throws(() => buildRecoveredCinematicResultFromState({
    priorAudit: makeAudit(),
    state: makeState({ productionPlanDigest: 'other' }),
    outputRoot: '/tmp/current',
    stateFileDigest: 'state-digest'
  }), /production-plan lineage mismatch/i);
});

test('R6 rejects state cinematic-lock drift', () => {
  assert.throws(() => buildRecoveredCinematicResultFromState({
    priorAudit: makeAudit(),
    state: makeState({ cinematicLockDigest: 'other' }),
    outputRoot: '/tmp/current',
    stateFileDigest: 'state-digest'
  }), /cinematic-lock lineage mismatch/i);
});

test('R6 rejects incomplete state chapter', () => {
  const state = makeState();
  state.chapters['5'].status = 'FINISH_COMPLETE';

  assert.throws(() => buildRecoveredCinematicResultFromState({
    priorAudit: makeAudit(),
    state,
    outputRoot: '/tmp/current',
    stateFileDigest: 'state-digest'
  }), /not COMPLETE/i);
});

test('R6 rejects missing state lineage', () => {
  assert.throws(() => buildRecoveredCinematicResultFromState({
    priorAudit: makeAudit(),
    state: makeState({ recipeDigest: null }),
    outputRoot: '/tmp/current',
    stateFileDigest: 'state-digest'
  }), /missing recipe\/target\/original-batch lineage/i);
});
