import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  YASREADY_AUDIOBOOKS_VERSION,
  sha256,
  stableJson,
  buildBookOnePauseDeficitAudit,
  verifyBookOnePauseDeficitAudit,
  relocalizeBookOnePauseDeficitAudit
} from '../src/index.js';

function pausePlan(resultDigest) {
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
    chapters: Array.from({ length: 10 }, (_, index) => ({
      order: index,
      chapterNumber: index + 1,
      title: `Chapter ${index + 1}`,
      paragraphCount: 2,
      sceneCount: 1,
      boundaries: index === 0 ? [{
        boundaryOrdinal: 0,
        chapterNumber: 1,
        afterBodyParagraphIndex: 0,
        kind: 'HEADING_TO_BODY',
        minimumTotalSilenceMs: 900,
        repairMode: 'LOCAL_ASSEMBLY_REPAIR_CANDIDATE',
        additivePaddingForbidden: true
      }] : []
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
    schemaVersion: base.schemaVersion, release: base.release, artifact: base.artifact, status: base.status,
    book: base.book, source: base.source, policy: base.policy, reviewEvidence: base.reviewEvidence,
    summary: base.summary, chapters: base.chapters, repairAssessment: base.repairAssessment, guardrails: base.guardrails
  };
  return { ...base, integrity: { pausePlanDigest: sha256(stableJson(core)) } };
}

function cinematicResult({ marker = 'old', plan = 'plan', lock = 'lock', sourceHash = 'source' } = {}) {
  const chapters = Array.from({ length: 10 }, (_, i) => ({
    chapterNumber: i + 1,
    title: `Chapter ${i + 1}`,
    outputs: { directMp3: `distribution/direct-owned/${String(i + 1).padStart(3, '0')}-chapter-${i + 1}.mp3` },
    digests: { directMp3: `${marker}-digest-${i + 1}` }
  }));
  const base = {
    schemaVersion: 1,
    release: YASREADY_AUDIOBOOKS_VERSION,
    artifact: 'book-one-cinematic-rebuild-result',
    status: 'READY_FOR_HUMAN_TEN_CHAPTER_REVIEW',
    book: { id: 'book-one', title: 'Fixture', sourceHash },
    cinematicLockDigest: lock,
    source: { productionPlanDigest: plan, recipeDigest: 'recipe', originalBatchResultDigest: 'old', targetDigest: 'target', outputRoot: `/tmp/${marker}` },
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
    schemaVersion: base.schemaVersion, release: base.release, artifact: base.artifact, status: base.status,
    book: base.book, cinematicLockDigest: base.cinematicLockDigest, source: base.source, progress: base.progress,
    latestArm: base.latestArm, cost: base.cost, chapters: base.chapters, guardrails: base.guardrails
  };
  return { ...base, integrity: { resultDigest: sha256(stableJson(core)) } };
}

function audioEvidence(marker, firstSilenceMs) {
  return {
    chapters: Array.from({ length: 10 }, (_, i) => ({
      chapterNumber: i + 1,
      audioFile: `/tmp/${marker}/chapter-${i + 1}.mp3`,
      audioFileUrl: `file:///tmp/${marker}/chapter-${i + 1}.mp3`,
      actualDigest: `${marker}-digest-${i + 1}`,
      durationMs: 4000,
      silences: i === 0 ? [{
        index: 0,
        startMs: 200,
        endMs: 200 + firstSilenceMs,
        durationMs: firstSilenceMs,
        midpointMs: 200 + firstSilenceMs / 2
      }] : []
    }))
  };
}

function priorAudit() {
  const oldResult = cinematicResult({ marker: 'old' });
  const p = pausePlan(oldResult.integrity.resultDigest);
  return buildBookOnePauseDeficitAudit({
    pausePlan: p,
    cinematicResult: oldResult,
    audioEvidence: audioEvidence('old', 676)
  });
}

test('R5 fresh recovery discards old timing and re-localizes from current waveform', () => {
  const prior = priorAudit();
  assert.equal(prior.chapters[0].boundaries[0].classification, 'LOCAL_REPAIR_SAFE');
  const currentResult = cinematicResult({ marker: 'current' });
  const recovered = relocalizeBookOnePauseDeficitAudit({
    priorAudit: prior,
    cinematicResult: currentResult,
    audioEvidence: audioEvidence('current', 950)
  });
  assert.equal(verifyBookOnePauseDeficitAudit(recovered), true);
  assert.equal(recovered.chapters[0].boundaries[0].classification, 'PASS_NO_CHANGE');
  assert.equal(recovered.chapters[0].audio.digest, 'current-digest-1');
  assert.equal(recovered.source.cinematicResultDigest, currentResult.integrity.resultDigest);
  assert.equal(recovered.source.recoveredFromAuditDigest, prior.integrity.auditDigest);
  assert.equal(recovered.source.priorTimingEvidenceReused, false);
  assert.equal(recovered.guardrails.priorTimingEvidenceReused, false);
  assert.notEqual(recovered.chapters[0].boundaries[0].silenceEndMs, prior.chapters[0].boundaries[0].silenceEndMs);
});

test('R5 recovery refuses production-plan lineage drift', () => {
  assert.throws(() => relocalizeBookOnePauseDeficitAudit({
    priorAudit: priorAudit(),
    cinematicResult: cinematicResult({ marker: 'current', plan: 'other-plan' }),
    audioEvidence: audioEvidence('current', 950)
  }), /production-plan lineage mismatch/i);
});

test('R5 recovery refuses cinematic-lock lineage drift', () => {
  assert.throws(() => relocalizeBookOnePauseDeficitAudit({
    priorAudit: priorAudit(),
    cinematicResult: cinematicResult({ marker: 'current', lock: 'other-lock' }),
    audioEvidence: audioEvidence('current', 950)
  }), /cinematic-lock lineage mismatch/i);
});

test('R5 recovery refuses manuscript lineage drift', () => {
  assert.throws(() => relocalizeBookOnePauseDeficitAudit({
    priorAudit: priorAudit(),
    cinematicResult: cinematicResult({ marker: 'current', sourceHash: 'other-source' }),
    audioEvidence: audioEvidence('current', 950)
  }), /manuscript source hash mismatch/i);
});

test('R5 recovery refuses audio evidence not locked by current cinematic result', () => {
  const evidence = audioEvidence('current', 950);
  evidence.chapters[0].actualDigest = 'wrong-digest';
  assert.throws(() => relocalizeBookOnePauseDeficitAudit({
    priorAudit: priorAudit(),
    cinematicResult: cinematicResult({ marker: 'current' }),
    audioEvidence: evidence
  }), /Direct MP3 digest evidence disagrees/i);
});

test('R5 recovery remains zero-spend and keeps every production gate closed', () => {
  const recovered = relocalizeBookOnePauseDeficitAudit({
    priorAudit: priorAudit(),
    cinematicResult: cinematicResult({ marker: 'current' }),
    audioEvidence: audioEvidence('current', 950)
  });
  assert.equal(recovered.guardrails.providerCallsPerformed, 0);
  assert.equal(recovered.guardrails.providerTtsCallsPerformed, 0);
  assert.equal(recovered.guardrails.audioWritesPerformed, 0);
  assert.equal(recovered.guardrails.chapterElevenMayBeGenerated, false);
  assert.equal(recovered.guardrails.nextBatchArmed, false);
  assert.equal(recovered.guardrails.fullBookGenerationArmed, false);
});

test('R5 recovery CLI uses bounded discovery and exact three-part lineage', async () => {
  const text = await readFile(new URL('../src/pause-recovery-cli.js', import.meta.url), 'utf8');
  assert.match(text, /timeout:\s*timeoutMs/);
  assert.match(text, /productionPlanDigest/);
  assert.match(text, /cinematicLockDigest/);
  assert.match(text, /manuscriptSourceHash/);
  assert.match(text, /all 10 current Direct MP3 digests/i);
});
