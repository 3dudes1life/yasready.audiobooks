import test from 'node:test';
import assert from 'node:assert/strict';
import {
  YASREADY_AUDIOBOOKS_VERSION,
  sha256,
  stableJson,
  reconcileBookOneContinuationManuscriptIdentity,
  buildBookOneCinematicContinuationBlueprint,
  verifyBookOneCinematicContinuationBlueprint
} from '../src/index.js';

function lockCore(lock) {
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

function manuscript({ sourceHash = 'current-docx-container-hash', normalizedTextHash = 'normalized-canonical-hash', mutateChapter = null } = {}) {
  const chapters = Array.from({ length: 45 }, (_, order) => {
    const text = `Canonical chapter ${order + 1} text.`;
    const textHash = sha256(text);
    return {
      order,
      title: `Chapter ${order + 1}: Fixture`,
      textHash: mutateChapter === order ? 'mutated-chapter-hash' : textHash,
      scenes: [{
        order: 0,
        textHash,
        segments: [
          { order: 0, paragraphIndex: 0, kind: 'narration', text: 'A tense silence settled over the room.', speakerCandidate: null },
          { order: 1, paragraphIndex: 1, kind: 'dialogue', text: 'You really think that is going to work?', speakerCandidate: { name: 'Juan', confidence: 0.9, evidence: 'fixture' } },
          { order: 2, paragraphIndex: 2, kind: 'narration', text: 'Michael hesitated, nervous but trying to look calm.', speakerCandidate: null }
        ]
      }]
    };
  });
  return {
    schemaVersion: 3,
    source: {
      format: 'docx',
      filename: 'book_1.docx',
      sourceHash,
      normalizedTextHash
    },
    metadata: { title: 'Fixture Book', author: 'Fixture Author', language: 'en' },
    metrics: { words: 56000, chapters: 45, scenes: 45, segments: 135, estimatedMinutesAt155Wpm: 361 },
    chapters
  };
}

function plan() {
  const a = manuscript({ sourceHash: 'locked-docx-container-hash' });
  return {
    schemaVersion: 1,
    release: YASREADY_AUDIOBOOKS_VERSION,
    artifact: 'book-one-production-plan',
    status: 'READY_FOR_SEPARATE_PRODUCTION_ARM',
    book: {
      id: 'book-one',
      title: 'Fixture Book',
      author: 'Fixture Author',
      sourceHash: 'locked-docx-container-hash'
    },
    source: {
      format: 'docx',
      filename: 'book_1.docx',
      sourceHash: 'locked-docx-container-hash',
      normalizedTextHash: 'normalized-canonical-hash',
      analyzerSchemaVersion: 3,
      warnings: []
    },
    budget: { rateUsdPer1kCharacters: 0.10 },
    manifest: {
      maxCharactersPerProviderCall: 500,
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

function cinematicLock() {
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
      manuscriptSourceHash: 'locked-docx-container-hash'
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
  return { ...base, integrity: { lockDigest: sha256(stableJson(lockCore(base))) } };
}

function cinematicResult(lock) {
  const chapters = Array.from({ length: 10 }, (_, i) => ({
    status: 'COMPLETE',
    chapterNumber: i + 1,
    sourceChapterOrder: i,
    title: `Chapter ${i + 1}: Fixture`,
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
    cinematicLockDigest: lock.integrity.lockDigest,
    source: {
      productionPlanDigest: 'plan-digest',
      recipeDigest: 'recipe-digest',
      originalBatchResultDigest: 'original-result-digest',
      targetDigest: 'target-digest',
      outputRoot: '/tmp/cinematic',
      manuscriptSourceHash: 'locked-docx-container-hash'
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
  return { ...base, integrity: { resultDigest: sha256(stableJson(resultCore(base))) } };
}

test('0.14.3.20.3 is current application provenance', () => {
  assert.equal(YASREADY_AUDIOBOOKS_VERSION, '0.14.3.20.3');
});

test('DOCX container-byte drift is accepted only when canonical normalized text and every chapter hash match', () => {
  const p = plan();
  const l = cinematicLock();
  const r = cinematicResult(l);
  const a = manuscript({
    sourceHash: 'different-current-docx-container-hash',
    normalizedTextHash: 'normalized-canonical-hash'
  });

  const identity = reconcileBookOneContinuationManuscriptIdentity({
    productionPlan: p,
    manuscriptAnalysis: a,
    cinematicResult: r,
    cinematicLock: l
  });

  assert.equal(identity.containerHashMatchesLocked, false);
  assert.equal(identity.normalizedTextHashMatches, true);
  assert.equal(identity.chapterHashesVerified, 45);
  assert.equal(identity.chapterHashMismatches, 0);
  assert.equal(identity.canonicalTextVerified, true);
  assert.match(identity.reconciliationPolicy, /container-drift-accepted/i);
});

test('real normalized manuscript text drift remains fail-closed', () => {
  const p = plan();
  const l = cinematicLock();
  const r = cinematicResult(l);
  const a = manuscript({
    sourceHash: 'different-current-docx-container-hash',
    normalizedTextHash: 'changed-normalized-text-hash',
    mutateChapter: 17
  });

  assert.throws(
    () => reconcileBookOneContinuationManuscriptIdentity({
      productionPlan: p,
      manuscriptAnalysis: a,
      cinematicResult: r,
      cinematicLock: l
    }),
    /canonical manuscript text drifted.*normalized text hash mismatch/i
  );
});

test('chapter hash mismatch remains fail-closed even if a forged normalized hash claims equality', () => {
  const p = plan();
  const l = cinematicLock();
  const r = cinematicResult(l);
  const a = manuscript({
    sourceHash: 'different-current-docx-container-hash',
    normalizedTextHash: 'normalized-canonical-hash',
    mutateChapter: 22
  });

  assert.throws(
    () => reconcileBookOneContinuationManuscriptIdentity({
      productionPlan: p,
      manuscriptAnalysis: a,
      cinematicResult: r,
      cinematicLock: l
    }),
    /chapter identity drifted/i
  );
});

test('continuation blueprint records reconciled container drift while preserving the locked manuscript source identity', () => {
  const p = plan();
  const l = cinematicLock();
  const r = cinematicResult(l);
  const a = manuscript({
    sourceHash: 'different-current-docx-container-hash',
    normalizedTextHash: 'normalized-canonical-hash'
  });

  const blueprint = buildBookOneCinematicContinuationBlueprint({
    productionPlan: p,
    manuscriptAnalysis: a,
    cinematicResult: r,
    cinematicLock: l
  });

  assert.equal(verifyBookOneCinematicContinuationBlueprint(blueprint), true);
  assert.equal(blueprint.source.manuscriptSourceHash, 'locked-docx-container-hash');
  assert.equal(blueprint.source.currentManuscriptContainerHash, 'different-current-docx-container-hash');
  assert.equal(blueprint.source.manuscriptIdentity.canonicalTextVerified, true);
  assert.equal(blueprint.source.manuscriptIdentity.containerHashMatchesLocked, false);
  assert.equal(blueprint.progress.firstPendingChapterNumber, 11);
  assert.equal(blueprint.guardrails.providerTtsCallsPerformed, 0);
  assert.equal(blueprint.guardrails.chapterElevenMayBeGenerated, false);
});


test('legacy 0.14.3.18.2 result may omit manuscriptSourceHash when integrity + plan lineage + current canonical source all agree', () => {
  const p = plan();
  const l = cinematicLock();
  const r = cinematicResult(l);
  delete r.source.manuscriptSourceHash;
  r.integrity.resultDigest = sha256(stableJson(resultCore(r)));
  const a = manuscript({
    sourceHash: 'locked-docx-container-hash',
    normalizedTextHash: 'normalized-canonical-hash'
  });

  const identity = reconcileBookOneContinuationManuscriptIdentity({
    productionPlan: p,
    manuscriptAnalysis: a,
    cinematicResult: r,
    cinematicLock: l
  });

  assert.equal(identity.canonicalTextVerified, true);
  assert.equal(identity.historicalResultSourceHash, null);
  assert.equal(identity.historicalResultSourceHashPresent, false);
  assert.equal(identity.historicalResultSourceHashInherited, true);
  assert.match(identity.reconciliationPolicy, /legacy-cinematic-result-missing-source-hash/i);
});

test('present historical cinematic result manuscriptSourceHash still blocks when it conflicts with locked source', () => {
  const p = plan();
  const l = cinematicLock();
  const r = cinematicResult(l);
  r.source.manuscriptSourceHash = 'conflicting-historical-source';
  r.integrity.resultDigest = sha256(stableJson(resultCore(r)));
  const a = manuscript({
    sourceHash: 'locked-docx-container-hash',
    normalizedTextHash: 'normalized-canonical-hash'
  });

  assert.throws(() => reconcileBookOneContinuationManuscriptIdentity({
    productionPlan: p,
    manuscriptAnalysis: a,
    cinematicResult: r,
    cinematicLock: l
  }), /conflicts with the locked production source/i);
});


test('44 narrated chapters + Front Matter reconcile without weakening chapter hashes', () => {
  const p = plan();
  const l = cinematicLock();
  const r = cinematicResult(l);
  const base = manuscript({
    sourceHash: 'locked-docx-container-hash',
    normalizedTextHash: 'normalized-canonical-hash'
  });
  const narrative = base.chapters.slice(0, 44);
  const current = {
    ...base,
    metrics: { ...base.metrics, chapters: 45 },
    chapters: [
      {
        order: 0,
        title: 'Front Matter',
        textHash: sha256('Print-only front matter.'),
        scenes: [{ order: 0, textHash: sha256('Print-only front matter.'), segments: [{ order: 0, paragraphIndex: 0, kind: 'narration', text: 'Print-only front matter.', speakerCandidate: null }] }]
      },
      ...narrative.map((chapter, index) => ({ ...chapter, order: index + 1 }))
    ]
  };
  p.manifest.chapters = p.manifest.chapters.slice(0, 44).map((chapter, index) => ({
    ...chapter,
    order: index + 1
  }));

  const identity = reconcileBookOneContinuationManuscriptIdentity({
    productionPlan: p,
    manuscriptAnalysis: current,
    cinematicResult: r,
    cinematicLock: l
  });

  assert.equal(identity.sourceSectionCount, 45);
  assert.equal(identity.narrativeChapterCount, 44);
  assert.equal(identity.excludedNonNarrativeSectionCount, 1);
  assert.equal(identity.excludedNonNarrativeSections[0].sourceOrder, 0);
  assert.equal(identity.excludedNonNarrativeSections[0].title, 'Front Matter');
  assert.equal(identity.chapterHashesVerified, 44);
  assert.equal(identity.chapterHashMismatches, 0);
  assert.equal(identity.canonicalTextVerified, true);

  const blueprint = buildBookOneCinematicContinuationBlueprint({
    productionPlan: p,
    manuscriptAnalysis: current,
    cinematicResult: r,
    cinematicLock: l
  });
  assert.equal(blueprint.progress.totalNarrativeChapters, 44);
  assert.equal(blueprint.progress.completedCinematicChapters, 10);
  assert.equal(blueprint.progress.remainingCinematicChapters, 34);
  assert.equal(blueprint.progress.firstPendingChapterNumber, 11);
  assert.equal(blueprint.progress.lastPendingChapterNumber, 44);
  assert.equal(blueprint.chapters[0].chapterNumber, 11);
  assert.equal(blueprint.chapters[0].order, 11);
});

test('an omitted non-Front-Matter source section still fails closed', () => {
  const p = plan();
  const l = cinematicLock();
  const r = cinematicResult(l);
  const base = manuscript({
    sourceHash: 'locked-docx-container-hash',
    normalizedTextHash: 'normalized-canonical-hash'
  });
  const narrative = base.chapters.slice(0, 44);
  const current = {
    ...base,
    chapters: [
      {
        order: 0,
        title: 'Preface',
        textHash: sha256('Narrative preface.'),
        scenes: [{ order: 0, textHash: sha256('Narrative preface.'), segments: [{ order: 0, paragraphIndex: 0, kind: 'narration', text: 'Narrative preface.', speakerCandidate: null }] }]
      },
      ...narrative.map((chapter, index) => ({ ...chapter, order: index + 1 }))
    ]
  };
  p.manifest.chapters = p.manifest.chapters.slice(0, 44).map((chapter, index) => ({
    ...chapter,
    order: index + 1
  }));

  assert.throws(() => reconcileBookOneContinuationManuscriptIdentity({
    productionPlan: p,
    manuscriptAnalysis: current,
    cinematicResult: r,
    cinematicLock: l
  }), /omits .*non-Front-Matter source section/i);
});
