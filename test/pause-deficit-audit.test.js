import test from 'node:test';
import assert from 'node:assert/strict';
import {
  YASREADY_AUDIOBOOKS_VERSION,
  sha256,
  stableJson,
  parseSilenceIntervals,
  buildBookOnePauseDeficitAudit,
  verifyBookOnePauseDeficitAudit
} from '../src/index.js';

function pausePlan() {
  const base = {
    schemaVersion: 1,
    release: YASREADY_AUDIOBOOKS_VERSION,
    artifact: 'book-one-pause-fidelity-plan',
    status: 'PAUSE_FIDELITY_ANALYZED_PRODUCTION_GATE_STILL_CLOSED',
    book: { id: 'book-one', title: 'Fixture' },
    source: { manuscriptSourceHash: 'source', currentManuscriptSourceHash: 'source', normalizedTextHash: 'normalized', productionPlanDigest: 'plan', cinematicLockDigest: 'lock', cinematicResultDigest: 'result', paragraphLayoutAvailable: true },
    policy: { policy: 'minimum-total-boundary-silence-floor-not-blind-additive-padding' },
    reviewEvidence: { present: false },
    summary: { canonicalWordsChanged: false },
    chapters: Array.from({ length: 10 }, (_, index) => ({
      order: index,
      chapterNumber: index + 1,
      title: `Chapter ${index + 1}`,
      paragraphCount: 3,
      sceneCount: 1,
      boundaries: index === 0 ? [
        { boundaryOrdinal: 0, chapterNumber: 1, afterBodyParagraphIndex: 0, kind: 'HEADING_TO_BODY', minimumTotalSilenceMs: 900, repairMode: 'LOCAL_ASSEMBLY_REPAIR_CANDIDATE', additivePaddingForbidden: true },
        { boundaryOrdinal: 1, chapterNumber: 1, afterBodyParagraphIndex: 1, kind: 'ORDINARY_PARAGRAPH', minimumTotalSilenceMs: 180, repairMode: 'NEEDS_BOUNDARY_LOCALIZATION', additivePaddingForbidden: true },
        { boundaryOrdinal: 2, chapterNumber: 1, afterBodyParagraphIndex: 2, kind: 'ORDINARY_PARAGRAPH', minimumTotalSilenceMs: 180, repairMode: 'NEEDS_BOUNDARY_LOCALIZATION', additivePaddingForbidden: true }
      ] : []
    })),
    repairAssessment: {},
    guardrails: { planningOnly: true, canonicalTextImmutable: true, canonicalWordsChanged: false, providerTtsCallsPerformed: 0, providerSpendUsd: 0, spendAuthorized: false, repairAudioWritten: false, existingTenChaptersMayBeOverwritten: false, chapterElevenMayBeGenerated: false, nextBatchArmed: false, fullBookGenerationArmed: false }
  };
  return { ...base, integrity: { pausePlanDigest: sha256(stableJson({ schemaVersion: base.schemaVersion, release: base.release, artifact: base.artifact, status: base.status, book: base.book, source: base.source, policy: base.policy, reviewEvidence: base.reviewEvidence, summary: base.summary, chapters: base.chapters, repairAssessment: base.repairAssessment, guardrails: base.guardrails })) } };
}

function cinematicResult() {
  const base = { schemaVersion: 1, release: YASREADY_AUDIOBOOKS_VERSION, artifact: 'book-one-cinematic-rebuild-result', status: 'READY_FOR_HUMAN_TEN_CHAPTER_REVIEW', book: {}, cinematicLockDigest: 'lock', source: { productionPlanDigest: 'plan', recipeDigest: 'recipe', originalBatchResultDigest: 'old', targetDigest: 'target', outputRoot: '/tmp' }, progress: { targetChapterCount: 10, completedChapterCount: 10, remainingChapterCount: 0, allTenComplete: true }, latestArm: {}, cost: {}, chapters: Array.from({ length: 10 }, (_, i) => ({ chapterNumber: i + 1 })), guardrails: { originalBatchPreserved: true, originalsMayBeOverwritten: false, cinematicProfileLockedToA: true, plus2EscalationAllowed: false, humanTenChapterListenRequiredBeforeChapterEleven: true, chapterElevenMayBeGenerated: false, nextBatchArmed: false, fullBookGenerationArmed: false, automaticScaleUp: false } };
  return { ...base, integrity: { resultDigest: sha256(stableJson({ schemaVersion: base.schemaVersion, release: base.release, artifact: base.artifact, status: base.status, book: base.book, cinematicLockDigest: base.cinematicLockDigest, source: base.source, progress: base.progress, latestArm: base.latestArm, cost: base.cost, chapters: base.chapters, guardrails: base.guardrails })) } };
}

function audioEvidence() {
  return { chapters: Array.from({ length: 10 }, (_, i) => ({
    chapterNumber: i + 1,
    audioFile: `/tmp/ch${i + 1}.mp3`, audioFileUrl: `file:///tmp/ch${i + 1}.mp3`, actualDigest: `digest-${i + 1}`,
    durationMs: 4000,
    silences: i === 0 ? [
      { index: 0, startMs: 200, endMs: 1200, durationMs: 1000, midpointMs: 700 },
      { index: 1, startMs: 1900, endMs: 2000, durationMs: 100, midpointMs: 1950 }
    ] : []
  })) };
}

test('0.14.3.20.5 is current application provenance', () => assert.equal(YASREADY_AUDIOBOOKS_VERSION, '0.14.3.20.5'));

test('silencedetect parser preserves measured start/end/duration', () => {
  const parsed = parseSilenceIntervals('[silencedetect @ x] silence_start: 1.2\n[silencedetect @ x] silence_end: 2.05 | silence_duration: 0.85\n', 5000);
  assert.deepEqual(parsed, [{ startMs: 1200, endMs: 2050, durationMs: 850 }]);
});

test('Pause Localization audit never calls provider or writes audio and distinguishes pass/deficit/unresolved', () => {
  const p = pausePlan();
  const r = cinematicResult();
  p.source.cinematicResultDigest = r.integrity.resultDigest;
  p.integrity.pausePlanDigest = sha256(stableJson({ schemaVersion: p.schemaVersion, release: p.release, artifact: p.artifact, status: p.status, book: p.book, source: p.source, policy: p.policy, reviewEvidence: p.reviewEvidence, summary: p.summary, chapters: p.chapters, repairAssessment: p.repairAssessment, guardrails: p.guardrails }));
  const audit = buildBookOnePauseDeficitAudit({ pausePlan: p, cinematicResult: r, audioEvidence: audioEvidence() });
  assert.equal(verifyBookOnePauseDeficitAudit(audit), true);
  assert.equal(audit.guardrails.providerCallsPerformed, 0);
  assert.equal(audit.guardrails.audioWritesPerformed, 0);
  assert.equal(audit.guardrails.chapterElevenMayBeGenerated, false);
  assert.ok(audit.summary.passNoChange >= 1);
  assert.ok(audit.summary.deficitCandidatesNeedingManualConfirmation >= 1);
  assert.ok(audit.summary.unresolved >= 1);
  const chapterOne = audit.chapters[0];
  assert.equal(chapterOne.boundaries[0].classification, 'PASS_NO_CHANGE');
  assert.equal(chapterOne.boundaries[1].classification, 'DEFICIT_CANDIDATE_NEEDS_MANUAL_CONFIRMATION');
  assert.equal(chapterOne.boundaries[2].classification, 'NEEDS_MANUAL_ALIGNMENT_REVIEW');
});

test('Pause deficit audit digest detects tampering', () => {
  const p = pausePlan(); const r = cinematicResult();
  p.source.cinematicResultDigest = r.integrity.resultDigest;
  p.integrity.pausePlanDigest = sha256(stableJson({ schemaVersion: p.schemaVersion, release: p.release, artifact: p.artifact, status: p.status, book: p.book, source: p.source, policy: p.policy, reviewEvidence: p.reviewEvidence, summary: p.summary, chapters: p.chapters, repairAssessment: p.repairAssessment, guardrails: p.guardrails }));
  const audit = JSON.parse(JSON.stringify(buildBookOnePauseDeficitAudit({ pausePlan: p, cinematicResult: r, audioEvidence: audioEvidence() })));
  audit.summary.passNoChange += 1;
  assert.throws(() => verifyBookOnePauseDeficitAudit(audit), /digest mismatch/i);
});
