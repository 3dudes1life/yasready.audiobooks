import test from 'node:test';
import assert from 'node:assert/strict';
import {
  YASREADY_AUDIOBOOKS_VERSION,
  sha256,
  stableJson,
  buildBookOneProductionPlan,
  verifyBookOneProductionPlan,
  verifyProductionPlanningSource,
  renderBookOneProductionPlanMarkdown,
  renderBookOneProductionBudgetCsv
} from '../src/index.js';

function lockFixture() {
  const core = {
    schemaVersion: 1,
    release: '0.14.3.12',
    artifact: 'book-one-narrator-production-lock',
    status: 'LOCKED_FOR_PRODUCTION_PLANNING',
    book: {
      id: 'book-one',
      title: 'Tres Amigos, Una Vida – A Throuple Love Story',
      author: 'D.C.W.',
      sourceHash: 'fixture-source-hash'
    },
    narrator: {
      provider: 'elevenlabs',
      providerVoiceId: 'rU18Fk3uSDhmg5Xh41o4',
      candidateName: 'Ryan Kurk - Pleasant and Smooth'
    },
    performanceProfile: {
      source: 'explicit-human-pace-ceiling-pass',
      baseDirectionId: 'playful-flirty',
      baseDirectionLabel: 'Playful + Flirty',
      emotionalVariantId: 'deep-controlled-emotion',
      emotionalVariantLabel: 'Deep Controlled Emotion',
      emotionalRange: 'strong-controlled',
      stability: 0.24,
      providerVoiceSettings: { speed: 1.20, stability: 0.24 },
      paceProfile: {
        providerNativeSpeed: 1.20,
        effectiveSpeed: 1.25,
        postProcessTempoMultiplier: 1.041667,
        postProcessRequired: true,
        postProcessKind: 'ffmpeg-atempo',
        pitchPreservingPostProcess: true
      },
      dynamicRangePolicy: { principle: 'emotion follows the scene' },
      originalHumanLearningNote: 'fixture',
      priorEmotionalNote: 'fixture',
      finalPaceCalibrationNote: '',
      restraint: "don't overplay the character voices",
      narrator: 'warm, contemporary, conversational',
      juan: 'playful and charismatic; never shouty',
      michael: 'warm and grounded; subtle Oklahoma coloration only',
      christopher: 'polished, playful, confident; contemporary California',
      identityInferenceFromAudio: false
    },
    readinessEvidence: {
      sourceEmotionalLiftPlanFingerprint: 'emotion-plan',
      paceCeilingPlanFingerprint: 'pace-plan',
      chapterTitle: 'Chapter 37',
      sceneOrder: 0,
      wordCount: 195,
      explicitHumanDecision: 'pass',
      winningVariantId: 'deep-controlled-emotion-effective-125'
    },
    productionArmed: false,
    fullBookGenerationArmed: false
  };
  return { ...core, lockDigest: sha256(stableJson(core)) };
}

function finalizationFixture() {
  const lock = lockFixture();
  return {
    schemaVersion: 1,
    release: '0.14.3.12',
    artifact: 'book-one-pace-ceiling-finalization',
    status: 'PASSED',
    decision: 'pass',
    book: lock.book,
    narratorProductionLockCreated: true,
    productionArmed: false,
    fullBookGenerationArmed: false,
    winner: {
      variantId: 'deep-controlled-emotion-effective-125',
      variantLabel: 'Deep Controlled Emotion — Effective 1.25'
    },
    narratorProductionLock: lock,
    nextAction: 'Build production plan.'
  };
}

function analysisFixture() {
  const textA = 'One warm line.\nAnother playful line.\nA third line with some emotion.';
  const textB = 'Second scene begins.\nJuan laughs.\nMichael answers naturally.';
  const textC = 'Chapter two lands softly.\nChristopher smiles.';
  const segment = (order, text, kind = 'narration') => ({ order, paragraphIndex: order, kind, text, speakerCandidate: null });
  return {
    schemaVersion: 3,
    source: {
      format: 'docx',
      filename: 'book_1.docx',
      sourceHash: 'fixture-source-hash',
      normalizedTextHash: 'normalized-fixture'
    },
    metadata: { title: 'Tres Amigos, Una Vida – A Throuple Love Story', author: 'D.C.W.', language: 'en' },
    metrics: {
      words: 28,
      sourceCharacters: 200,
      sourceCharactersNoWhitespace: 170,
      productionCharacters: textA.length + textB.length + textC.length + 2,
      estimatedMinutesAt155Wpm: 0.2,
      chapters: 2,
      scenes: 3,
      segments: 9,
      dialogueSegments: 2,
      narrationSegments: 7,
      dialogueCharacters: 20,
      narrationCharacters: 160
    },
    chapters: [
      {
        order: 0,
        title: 'Chapter 1',
        textHash: 'chapter-one-hash',
        scenes: [
          { order: 0, textHash: 'scene-a', segments: textA.split('\n').map((x, i) => segment(i, x, i === 1 ? 'dialogue' : 'narration')) },
          { order: 1, textHash: 'scene-b', segments: textB.split('\n').map((x, i) => segment(i, x, i === 1 ? 'dialogue' : 'narration')) }
        ]
      },
      {
        order: 1,
        title: 'Chapter 2',
        textHash: 'chapter-two-hash',
        scenes: [
          { order: 0, textHash: 'scene-c', segments: textC.split('\n').map((x, i) => segment(i, x)) }
        ]
      }
    ],
    warnings: []
  };
}

test('0.14.3.18.1 is current application provenance', () => {
  assert.equal(YASREADY_AUDIOBOOKS_VERSION, '0.14.3.18.1');
});

test('locked Ryan production recipe validates without arming production', () => {
  const finalization = finalizationFixture();
  assert.equal(verifyProductionPlanningSource(finalization), true);
  assert.equal(finalization.narratorProductionLock.performanceProfile.emotionalVariantLabel, 'Deep Controlled Emotion');
  assert.equal(finalization.narratorProductionLock.performanceProfile.stability, 0.24);
  assert.equal(finalization.narratorProductionLock.performanceProfile.paceProfile.providerNativeSpeed, 1.20);
  assert.equal(finalization.narratorProductionLock.performanceProfile.paceProfile.effectiveSpeed, 1.25);
});

test('production plan is deterministic, zero-spend and full-book generation stays off', () => {
  const args = {
    paceCeilingFinalization: finalizationFixture(),
    manuscriptAnalysis: analysisFixture(),
    rateUsdPer1kCharacters: 0.10,
    retryReserveRatio: 0.20,
    explicitChunkCap: 50
  };
  const a = buildBookOneProductionPlan(args);
  const b = buildBookOneProductionPlan(args);
  assert.equal(a.integrity.productionPlanDigest, b.integrity.productionPlanDigest);
  assert.equal(a.guardrails.planningProviderGenerationCalls, 0);
  assert.equal(a.guardrails.planningSpendUsd, 0);
  assert.equal(a.guardrails.productionArmed, false);
  assert.equal(a.guardrails.fullBookGenerationArmed, false);
  assert.equal(a.budget.planningSpendUsd, 0);
  assert.equal(a.confirmation.semantics, 'REFERENCE_ONLY_NOT_SPEND_AUTHORIZATION');
  assert.match(a.confirmation.token, /^PLAN-[A-F0-9]{10}$/);
  assert.equal(verifyBookOneProductionPlan(a), true);
});

test('manifest respects provider chunk cap and creates local tempo task for every paid base', () => {
  const plan = buildBookOneProductionPlan({
    paceCeilingFinalization: finalizationFixture(),
    manuscriptAnalysis: analysisFixture(),
    explicitChunkCap: 50
  });
  const chunks = plan.manifest.chapters.flatMap((chapter) => chapter.chunks);
  assert.ok(chunks.length >= 3);
  assert.ok(chunks.every((chunk) => chunk.characters <= 50));
  assert.ok(chunks.every((chunk) => /^[a-f0-9]{64}$/.test(chunk.generationDigest)));
  assert.equal(plan.manifest.postProcessTasks, plan.manifest.providerGenerationCalls);
  assert.equal(plan.workload.postProcessTasks, plan.workload.providerGenerationCalls);
});

test('budget includes retry reserve and never fabricates a provider credit count', () => {
  const plan = buildBookOneProductionPlan({
    paceCeilingFinalization: finalizationFixture(),
    manuscriptAnalysis: analysisFixture(),
    rateUsdPer1kCharacters: 0.10,
    retryReserveRatio: 0.20
  });
  assert.ok(plan.budget.initialGenerationUsd > 0);
  assert.ok(plan.budget.retryReserveUsd > 0);
  assert.ok(plan.budget.protectedMaxUsd >= plan.budget.initialGenerationUsd + plan.budget.retryReserveUsd - 0.01);
  assert.equal(plan.budget.providerCreditsEstimated, null);
  assert.match(plan.budget.providerCreditsPolicy, /Do not infer provider credits/i);
});

test('wrong manuscript hash fails closed before any production can be planned', () => {
  const analysis = analysisFixture();
  analysis.source.sourceHash = 'wrong-book';
  assert.throws(
    () => buildBookOneProductionPlan({ paceCeilingFinalization: finalizationFixture(), manuscriptAnalysis: analysis }),
    /source hash does not match/i
  );
});

test('tampered narrator production lock fails integrity verification', () => {
  const finalization = finalizationFixture();
  finalization.narratorProductionLock.performanceProfile.stability = 0.99;
  assert.throws(() => verifyProductionPlanningSource(finalization), /lock digest mismatch/i);
});

test('tampered production plan fails plan digest verification', () => {
  const plan = buildBookOneProductionPlan({
    paceCeilingFinalization: finalizationFixture(),
    manuscriptAnalysis: analysisFixture()
  });
  const clone = JSON.parse(JSON.stringify(plan));
  clone.budget.protectedMaxUsd += 1;
  assert.throws(() => verifyBookOneProductionPlan(clone), /integrity digest mismatch/i);
});

test('markdown and budget CSV are operator-readable and preserve no-arm state', () => {
  const plan = buildBookOneProductionPlan({
    paceCeilingFinalization: finalizationFixture(),
    manuscriptAnalysis: analysisFixture()
  });
  const markdown = renderBookOneProductionPlanMarkdown(plan);
  const csv = renderBookOneProductionBudgetCsv(plan);
  assert.match(markdown, /0\.14\.3\.18\.1 cannot generate production audio/i);
  assert.match(markdown, /Ryan Kurk - Pleasant and Smooth/);
  assert.match(markdown, /Deep Controlled Emotion/);
  assert.match(markdown, /Full-book generation armed:\*\* NO/i);
  assert.match(csv, /chapter_order,chapter_title/);
  assert.match(csv, /TOTAL/);
});
