import test from 'node:test';
import assert from 'node:assert/strict';
import {
  YASREADY_AUDIOBOOKS_VERSION,
  sha256,
  stableJson,
  buildBookOneCinematicHumanReviewSession,
  finalizeBookOneCinematicHumanReview,
  buildBookOneCinematicContinuationBlueprint,
  verifyBookOneCinematicContinuationBlueprint,
  buildBookOneCinematicContinuationPreview,
  verifyBookOneCinematicContinuationPreview,
  createBookOneCinematicContinuationChapterState,
  transitionBookOneCinematicContinuationChapterState,
  renderBookOneCinematicContinuationDashboardHtml
} from '../src/index.js';

function cinematicLockCore(lock) {
  return {
    schemaVersion: lock.schemaVersion,
    release: lock.release,
    artifact: lock.artifact,
    status: lock.status,
    profileId: lock.profileId,
    book: lock.book,
    source: lock.source,
    narrator: lock.narrator,
    lockedProductionChain: lock.lockedProductionChain,
    humanDecision: lock.humanDecision,
    rules: lock.rules,
    guardrails: lock.guardrails
  };
}

function lock() {
  const base = {
    schemaVersion: 1,
    release: YASREADY_AUDIOBOOKS_VERSION,
    artifact: 'book-one-cinematic-naturalism-lock',
    status: 'LOCKED_FOR_BATCH_ONE_CINEMATIC_REBUILD',
    profileId: 'cinematic-naturalism-a-v1',
    book: { id: 'book-one', title: 'Fixture Book', author: 'Fixture Author' },
    source: {
      productionPlanDigest: 'plan-digest',
      recipeDigest: 'recipe-digest',
      manuscriptSourceHash: 'fixture-source-hash'
    },
    narrator: {
      provider: 'elevenlabs',
      voiceId: 'rU18Fk3uSDhmg5Xh41o4',
      name: 'Ryan Kurk - Pleasant and Smooth'
    },
    lockedProductionChain: {
      baseDirection: 'Playful + Flirty',
      emotionalProfile: 'Deep Controlled Emotion',
      providerModel: 'eleven_v3',
      providerStability: 0.24,
      providerSpeed: 1.20,
      effectiveSpeed: 1.25,
      postProcessTempoMultiplier: 1.041667,
      localFinish: 'Warm + Slightly Deeper'
    },
    humanDecision: {
      selectedComparison: 'A_CURRENT_CINEMATIC',
      rejectedEscalation: 'B_CINEMATIC_PLUS2',
      decision: 'A_WINS_LOCK_ORIGINAL_CINEMATIC_NATURALISM',
      goal: 'Fixture'
    },
    rules: {
      evidenceSource: 'canonical manuscript text plus immediate neighboring segments only',
      canonicalTextImmutable: true,
      characterDifferentiation: 'delivery-not-impersonation',
      narrationBaseline: 'natural-unforced',
      emotionalMomentsEarnDirection: true,
      sceneCueCap: 7,
      minimumSegmentIndexGapBetweenCues: 2,
      perCueCap: 2,
      narrationCueCap: 2,
      allowedProviderCues: ['whispers', 'playfully', 'softly', 'angry', 'cautiously', 'slowly'],
      plus2EscalationAllowed: false,
      extraVoicesRequired: false,
      soundEffectsRequired: false,
      identityInferenceFromAudio: false
    },
    guardrails: {
      profileLocked: true,
      providerTtsCallsPerformed: 0,
      providerSpendUsd: 0,
      originalsMayBeOverwritten: false,
      chapterElevenMayBeGenerated: false,
      nextBatchArmed: false,
      fullBookGenerationArmed: false
    }
  };
  return {
    ...base,
    integrity: { lockDigest: sha256(stableJson(cinematicLockCore(base))) }
  };
}

function analysis() {
  const chapters = [];
  for (let i = 0; i < 45; i += 1) {
    const segments = [
      { order: 0, paragraphIndex: 0, kind: 'narration', text: `Chapter ${i + 1} opens in a tense silence before the room settles.`, speakerCandidate: null },
      { order: 1, paragraphIndex: 1, kind: 'dialogue', text: '“You really think that is going to work?” Juan teased with a grin.', speakerCandidate: 'Juan' },
      { order: 2, paragraphIndex: 2, kind: 'narration', text: 'Michael hesitated, nervous but trying to look calm.', speakerCandidate: null },
      { order: 3, paragraphIndex: 3, kind: 'dialogue', text: '“Maybe,” Michael said, trying not to laugh.', speakerCandidate: 'Michael' },
      { order: 4, paragraphIndex: 4, kind: 'dialogue', text: '“Then let us find out,” Christopher said softly.', speakerCandidate: 'Christopher' },
      { order: 5, paragraphIndex: 5, kind: 'narration', text: 'The silence softened as the tension finally broke.', speakerCandidate: null }
    ];
    const text = segments.map((row) => row.text).join('\n');
    chapters.push({
      order: i,
      title: `Chapter ${i + 1}: Fixture`,
      textHash: sha256(text),
      scenes: [
        { order: 0, textHash: sha256(text), segments }
      ]
    });
  }
  return {
    schemaVersion: 3,
    source: {
      format: 'docx',
      filename: 'book.docx',
      sourceHash: 'fixture-source-hash',
      normalizedTextHash: 'fixture-normalized'
    },
    metadata: { title: 'Fixture Book', author: 'Fixture Author' },
    metrics: { words: 56000, chapters: 45, scenes: 45, segments: 270, estimatedMinutesAt155Wpm: 361 },
    chapters
  };
}

function productionPlan() {
  const a = analysis();
  return {
    schemaVersion: 1,
    release: '0.14.3.20.2',
    artifact: 'book-one-production-plan',
    status: 'READY_FOR_SEPARATE_PRODUCTION_ARM',
    book: { id: 'book-one', title: 'Fixture Book', author: 'Fixture Author' },
    source: { sourceHash: a.source.sourceHash, normalizedTextHash: a.source.normalizedTextHash },
    budget: { rateUsdPer1kCharacters: 0.10 },
    manifest: {
      maxCharactersPerProviderCall: 220,
      chapters: a.chapters.map((chapter) => ({
        order: chapter.order,
        title: chapter.title,
        sourceTextHash: chapter.textHash,
        providerCharacters: 1000,
        providerGenerationCalls: 2
      }))
    },
    guardrails: { productionArmed: false, fullBookGenerationArmed: false },
    integrity: { productionPlanDigest: 'plan-digest' }
  };
}

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

function cinematicResult(cinematicLock = lock()) {
  const a = analysis();
  const chapters = a.chapters.slice(0, 10).map((chapter, i) => ({
    status: 'COMPLETE',
    chapterNumber: i + 1,
    sourceChapterOrder: i,
    title: chapter.title,
    cueCount: 4,
    providerCalls: 2,
    providerCharacters: 1000,
    outputs: {
      directMp3: `distribution/direct-owned/${i + 1}.mp3`,
      archiveWav: `distribution/archive-wav/${i + 1}.wav`,
      acxMp3: `distribution/acx-audible/${i + 1}.mp3`
    },
    digests: {},
    qa: {
      archive: { passed: true, issues: [] },
      mp3: { passed: true, issues: [] }
    },
    analysis: {},
    completedAt: '2026-09-13T00:00:00Z'
  }));

  const base = {
    schemaVersion: 1,
    release: YASREADY_AUDIOBOOKS_VERSION,
    artifact: 'book-one-cinematic-rebuild-result',
    status: 'READY_FOR_HUMAN_TEN_CHAPTER_REVIEW',
    book: { id: 'book-one', title: 'Fixture Book', author: 'Fixture Author' },
    cinematicLockDigest: cinematicLock.integrity.lockDigest,
    source: {
      productionPlanDigest: 'plan-digest',
      recipeDigest: 'recipe-digest',
      originalBatchResultDigest: 'original-result-digest',
      targetDigest: 'target-digest',
      outputRoot: '/tmp/cinematic',
      manuscriptSourceHash: 'fixture-source-hash'
    },
    progress: {
      targetChapterCount: 10,
      completedChapterCount: 10,
      remainingChapterCount: 0,
      allTenComplete: true
    },
    latestArm: {},
    cost: { totalCinematicCapturedOrEstimatedBilledUsd: 4.1544 },
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
    },
    nextAction: 'Human review.'
  };
  return {
    ...base,
    integrity: { resultDigest: sha256(stableJson(resultCore(base))) }
  };
}

function approval(cinematicLock, result) {
  const session = buildBookOneCinematicHumanReviewSession({ cinematicResult: result, cinematicLock });
  const decisions = {
    schemaVersion: 1,
    artifact: 'book-one-cinematic-human-review-decisions',
    source: {
      reviewSessionDigest: session.integrity.reviewSessionDigest,
      cinematicResultDigest: session.source.cinematicResultDigest,
      cinematicLockDigest: session.source.cinematicLockDigest,
      recipeFingerprint: session.profile.recipeFingerprint
    },
    heardAllTen: true,
    overallDecision: 'APPROVE_CINEMATIC_RECIPE',
    overallNotes: 'Fixture approval.',
    chapters: Array.from({ length: 10 }, (_, i) => ({
      chapterNumber: i + 1,
      decision: 'PASS',
      notes: ''
    }))
  };
  return finalizeBookOneCinematicHumanReview({ session, decisions });
}

test('0.14.3.20.2 is current application provenance', () => {
  assert.equal(YASREADY_AUDIOBOOKS_VERSION, '0.14.3.20.2');
});

test('continuation blueprint prepares Chapters 11-45 without spending or arming production', () => {
  const cinematicLock = lock();
  const result = cinematicResult(cinematicLock);
  const blueprint = buildBookOneCinematicContinuationBlueprint({
    productionPlan: productionPlan(),
    manuscriptAnalysis: analysis(),
    cinematicResult: result,
    cinematicLock
  });

  assert.equal(verifyBookOneCinematicContinuationBlueprint(blueprint), true);
  assert.equal(blueprint.status, 'GATE_CLOSED_PENDING_TEN_CHAPTER_HUMAN_APPROVAL');
  assert.equal(blueprint.progress.totalNarrativeChapters, 45);
  assert.equal(blueprint.progress.completedCinematicChapters, 10);
  assert.equal(blueprint.progress.remainingCinematicChapters, 35);
  assert.equal(blueprint.progress.firstPendingChapterNumber, 11);
  assert.equal(blueprint.progress.lastPendingChapterNumber, 45);
  assert.equal(blueprint.chapters.length, 35);
  assert.equal(blueprint.chapters[0].chapterNumber, 11);
  assert.equal(blueprint.chapters.at(-1).chapterNumber, 45);
  assert.equal(blueprint.plannedBatches.length, 4);
  assert.deepEqual(
    blueprint.plannedBatches.map((row) => [row.firstChapterNumber, row.lastChapterNumber]),
    [[11, 20], [21, 30], [31, 40], [41, 45]]
  );
  assert.ok(blueprint.workload.providerCalls > 0);
  assert.ok(blueprint.workload.providerCharacters > 0);
  assert.ok(blueprint.workload.subtlePerformanceDirections > 0);
  assert.equal(blueprint.guardrails.providerTtsCallsPerformed, 0);
  assert.equal(blueprint.guardrails.providerSpendUsd, 0);
  assert.equal(blueprint.guardrails.approvalTokenCreated, false);
  assert.equal(blueprint.guardrails.spendAuthorized, false);
  assert.equal(blueprint.guardrails.chapterElevenMayBeGenerated, false);
  assert.equal(blueprint.guardrails.nextBatchArmed, false);
  assert.equal(blueprint.guardrails.productionRuntimeConnected, false);
  assert.equal(blueprint.guardrails.fullBookGenerationArmed, false);
});

test('continuation blueprint preserves canonical chapter hashes and locks Cinematic Naturalism A', () => {
  const cinematicLock = lock();
  const a = analysis();
  const blueprint = buildBookOneCinematicContinuationBlueprint({
    productionPlan: productionPlan(),
    manuscriptAnalysis: a,
    cinematicResult: cinematicResult(cinematicLock),
    cinematicLock
  });

  for (const chapter of blueprint.chapters) {
    assert.equal(chapter.canonicalChapterHash, a.chapters[chapter.order].textHash);
    assert.equal(chapter.sourceTextHash, a.chapters[chapter.order].textHash);
    assert.ok(chapter.subtlePerformanceDirections > 0);
  }
  assert.equal(blueprint.profile.profileId, 'cinematic-naturalism-a-v1');
  assert.equal(blueprint.profile.selectedComparison, 'A_CURRENT_CINEMATIC');
  assert.equal(blueprint.profile.rejectedEscalation, 'B_CINEMATIC_PLUS2');
});

test('live quota preview may calculate Chapter 11+ scope while human gate stays closed and creates no token', () => {
  const cinematicLock = lock();
  const blueprint = buildBookOneCinematicContinuationBlueprint({
    productionPlan: productionPlan(),
    manuscriptAnalysis: analysis(),
    cinematicResult: cinematicResult(cinematicLock),
    cinematicLock
  });

  const preview = buildBookOneCinematicContinuationPreview({
    blueprint,
    providerRemaining: 100000,
    providerTier: 'creator'
  });

  assert.equal(verifyBookOneCinematicContinuationPreview(preview), true);
  assert.equal(preview.status, 'CANDIDATE_SCOPE_PREVIEW_GATE_CLOSED');
  assert.equal(preview.candidateScope.firstChapterNumber, 11);
  assert.ok(preview.candidateScope.chapterCount > 0);
  assert.equal(preview.humanGate.gateOpen, false);
  assert.equal(preview.guardrails.approvalTokenCreated, false);
  assert.equal(preview.guardrails.spendAuthorized, false);
  assert.equal(preview.guardrails.providerTtsCallsPerformed, 0);
  assert.equal(preview.guardrails.chapterElevenMayBeGenerated, false);
  assert.equal(preview.guardrails.productionRuntimeConnected, false);
});

test('approved human gate changes preview readiness only; 0.14.3.20.2 still cannot arm or generate Chapter 11', () => {
  const cinematicLock = lock();
  const result = cinematicResult(cinematicLock);
  const blueprint = buildBookOneCinematicContinuationBlueprint({
    productionPlan: productionPlan(),
    manuscriptAnalysis: analysis(),
    cinematicResult: result,
    cinematicLock
  });

  const preview = buildBookOneCinematicContinuationPreview({
    blueprint,
    providerRemaining: 100000,
    providerTier: 'creator',
    humanReviewApproval: approval(cinematicLock, result)
  });

  assert.equal(preview.status, 'CANDIDATE_SCOPE_READY_GATE_OPEN_NOT_ARMED');
  assert.equal(preview.humanGate.gateOpen, true);
  assert.equal(preview.guardrails.approvalTokenCreated, false);
  assert.equal(preview.guardrails.spendAuthorized, false);
  assert.equal(preview.guardrails.chapterElevenMayBeGenerated, false);
  assert.equal(preview.guardrails.nextBatchArmed, false);
  assert.equal(preview.guardrails.productionRuntimeConnected, false);
});

test('insufficient quota never selects a partial continuation chapter', () => {
  const cinematicLock = lock();
  const blueprint = buildBookOneCinematicContinuationBlueprint({
    productionPlan: productionPlan(),
    manuscriptAnalysis: analysis(),
    cinematicResult: cinematicResult(cinematicLock),
    cinematicLock
  });
  const preview = buildBookOneCinematicContinuationPreview({
    blueprint,
    providerRemaining: 1
  });
  assert.equal(preview.status, 'INSUFFICIENT_QUOTA_FOR_NEXT_WHOLE_CINEMATIC_CHAPTER');
  assert.equal(preview.candidateScope.chapterCount, 0);
  assert.equal(preview.candidateScope.firstChapterNumber, null);
  assert.equal(preview.guardrails.chapterElevenMayBeGenerated, false);
});

test('provider unknown outcome is fail-closed and cannot be rerun through state transitions', () => {
  const cinematicLock = lock();
  const blueprint = buildBookOneCinematicContinuationBlueprint({
    productionPlan: productionPlan(),
    manuscriptAnalysis: analysis(),
    cinematicResult: cinematicResult(cinematicLock),
    cinematicLock
  });
  let state = createBookOneCinematicContinuationChapterState({ blueprint, chapterNumber: 11 });
  state = transitionBookOneCinematicContinuationChapterState(state, 'PROVIDER_IN_FLIGHT', { providerRequestId: 'req-11' });
  state = transitionBookOneCinematicContinuationChapterState(state, 'PROVIDER_RESULT_UNKNOWN_DO_NOT_RERUN', { lastFailure: 'timeout-after-send' });
  assert.equal(state.state, 'PROVIDER_RESULT_UNKNOWN_DO_NOT_RERUN');
  assert.throws(
    () => transitionBookOneCinematicContinuationChapterState(state, 'PROVIDER_IN_FLIGHT', { providerRequestId: 'req-12' }),
    /Unsafe continuation transition/
  );
});

test('local processing failures are safe to resume without rerunning provider', () => {
  const cinematicLock = lock();
  const blueprint = buildBookOneCinematicContinuationBlueprint({
    productionPlan: productionPlan(),
    manuscriptAnalysis: analysis(),
    cinematicResult: cinematicResult(cinematicLock),
    cinematicLock
  });
  let state = createBookOneCinematicContinuationChapterState({ blueprint, chapterNumber: 11 });
  state = transitionBookOneCinematicContinuationChapterState(state, 'PROVIDER_IN_FLIGHT', { providerRequestId: 'req-11' });
  state = transitionBookOneCinematicContinuationChapterState(state, 'PROVIDER_COMPLETE', { providerAudioDigest: 'provider-audio' });
  state = transitionBookOneCinematicContinuationChapterState(state, 'LOCAL_TEMPO_FAILED_SAFE_TO_RERUN', { lastFailure: 'ffmpeg-temp' });
  state = transitionBookOneCinematicContinuationChapterState(state, 'TEMPO_COMPLETE', { localTempoDigest: 'tempo' });
  state = transitionBookOneCinematicContinuationChapterState(state, 'LOCAL_FINISH_FAILED_SAFE_TO_RERUN', { lastFailure: 'local-finish' });
  state = transitionBookOneCinematicContinuationChapterState(state, 'FINISH_COMPLETE', { localFinishDigest: 'finish' });
  state = transitionBookOneCinematicContinuationChapterState(state, 'ASSEMBLY_QA_FAILED_SAFE_TO_RERUN', { lastFailure: 'qa' });
  state = transitionBookOneCinematicContinuationChapterState(state, 'COMPLETE', { finalAudioDigest: 'final' });
  assert.equal(state.state, 'COMPLETE');
  assert.equal(state.providerAudioDigest, 'provider-audio');
});

test('dashboard makes the 10/45 state and closed human gate unmistakable', () => {
  const cinematicLock = lock();
  const blueprint = buildBookOneCinematicContinuationBlueprint({
    productionPlan: productionPlan(),
    manuscriptAnalysis: analysis(),
    cinematicResult: cinematicResult(cinematicLock),
    cinematicLock
  });
  const html = renderBookOneCinematicContinuationDashboardHtml(blueprint);
  assert.match(html, /10\/45/);
  assert.match(html, /Human gate CLOSED/);
  assert.match(html, /Chapter 11/);
  assert.match(html, /No production token exists/);
  assert.match(html, /subtle performance directions/);
});

test('tampered continuation blueprint is rejected before any later operation', () => {
  const cinematicLock = lock();
  const blueprint = JSON.parse(JSON.stringify(buildBookOneCinematicContinuationBlueprint({
    productionPlan: productionPlan(),
    manuscriptAnalysis: analysis(),
    cinematicResult: cinematicResult(cinematicLock),
    cinematicLock
  })));
  blueprint.progress.firstPendingChapterNumber = 12;
  assert.throws(() => verifyBookOneCinematicContinuationBlueprint(blueprint), /Chapter 11|digest/i);
});
