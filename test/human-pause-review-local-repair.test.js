import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  YASREADY_AUDIOBOOKS_VERSION,
  sha256,
  stableJson,
  buildBookOneHumanPauseReviewPlan,
  buildInitialBookOneHumanPauseReview,
  upsertBookOneHumanPauseDecision,
  verifyBookOneHumanPauseReview,
  buildBookOnePauseRepairPlan,
  renderBookOneHumanPauseReviewHtml,
  resolveBookOnePauseSourceAudio
} from '../src/index.js';

function auditCore(value) {
  return { schemaVersion: value.schemaVersion, release: value.release, artifact: value.artifact, status: value.status, source: value.source, policy: value.policy, summary: value.summary, chapters: value.chapters, repairAssessment: value.repairAssessment, guardrails: value.guardrails };
}

function fixtureAudit() {
  const base = {
    schemaVersion: 1,
    release: YASREADY_AUDIOBOOKS_VERSION,
    artifact: 'book-one-pause-localization-deficit-audit',
    status: 'PAUSE_DEFICIT_AUDIT_COMPLETE_REPAIR_GATE_CLOSED',
    source: { manuscriptSourceHash: 'manuscript', chapterAudioDigests: [{ chapterNumber: 1, digest: 'audio-digest' }] },
    policy: { silenceNoiseDb: -50, silenceDetectionMinMs: 60 },
    summary: { passNoChange: 6, localRepairSafe: 1, deficitCandidatesNeedingManualConfirmation: 1, unresolved: 1 },
    chapters: [{
      chapterNumber: 1,
      title: 'Chapter One',
      audio: { file: '/tmp/chapter-1.mp3', digest: 'audio-digest', durationMs: 120000 },
      boundaries: [
        { boundaryOrdinal: 0, kind: 'HEADING_TO_BODY', classification: 'LOCAL_REPAIR_SAFE', localizedTimestampMs: 2235, silenceStartMs: 1900, silenceEndMs: 2576, localizationConfidence: 0.98, actualSilenceMs: 676, minimumTotalSilenceMs: 900, deficitMs: 224, repairReady: true },
        { boundaryOrdinal: 1, kind: 'ORDINARY_PARAGRAPH', classification: 'DEFICIT_CANDIDATE_NEEDS_MANUAL_CONFIRMATION', localizedTimestampMs: 40000, silenceStartMs: 39960, silenceEndMs: 40080, localizationConfidence: 0.91, actualSilenceMs: 120, minimumTotalSilenceMs: 180, deficitMs: 60, repairReady: false },
        { boundaryOrdinal: 2, kind: 'ORDINARY_PARAGRAPH', classification: 'NEEDS_MANUAL_ALIGNMENT_REVIEW', localizedTimestampMs: null, localizationConfidence: 0.62, actualSilenceMs: null, minimumTotalSilenceMs: 180, deficitMs: null, repairReady: false }
      ]
    }],
    repairAssessment: { repairPerformed: false, repairAuthorizationCreated: false },
    guardrails: {
      readOnlyAudit: true, canonicalTextImmutable: true, canonicalWordsChanged: false,
      audioDigestsVerifiedBeforeMeasurement: true, providerCallsPerformed: 0, providerTtsCallsPerformed: 0,
      providerSpendUsd: 0, audioWritesPerformed: 0, repairAudioWritten: false, repairAuthorized: false,
      providerRegenerationAuthorized: false, chapterElevenMayBeGenerated: false, nextBatchArmed: false, fullBookGenerationArmed: false
    }
  };
  return { ...base, integrity: { auditDigest: sha256(stableJson(auditCore(base))) } };
}

test('0.14.3.20.5 is current application provenance', () => assert.equal(YASREADY_AUDIOBOOKS_VERSION, '0.14.3.20.5'));

test('Human Pause Review prioritizes the safe local repair and translates the operator label', () => {
  const plan = buildBookOneHumanPauseReviewPlan(fixtureAudit());
  assert.equal(plan.summary.localRepairSafe, 1);
  assert.equal(plan.summary.surgicalManual, 1);
  assert.equal(plan.summary.unresolved, 1);
  assert.equal(plan.candidates[0].classification, 'LOCAL_REPAIR_SAFE');
  assert.equal(plan.candidates[0].humanLabel, 'Chapter title → first paragraph');
  assert.equal(plan.candidates[0].proposedDeltaMs, 224);
});

test('listening/preview state creates no repair approval', () => {
  const audit = fixtureAudit();
  const review = buildInitialBookOneHumanPauseReview(audit);
  assert.equal(verifyBookOneHumanPauseReview(review, audit), true);
  assert.equal(review.summary.approvedLocalRepairs, 0);
  assert.equal(review.guardrails.listeningIsNotApproval, true);
  assert.equal(review.guardrails.previewIsNotApproval, true);
});

test('only LOCAL_REPAIR_SAFE can receive explicit auto-repair approval', () => {
  const audit = fixtureAudit();
  const initial = buildInitialBookOneHumanPauseReview(audit);
  assert.throws(() => upsertBookOneHumanPauseDecision({ audit, review: initial, chapterNumber: 1, boundaryOrdinal: 1, decision: 'APPROVE_LOCAL_REPAIR' }), /not LOCAL_REPAIR_SAFE/i);
  const approved = upsertBookOneHumanPauseDecision({ audit, review: initial, chapterNumber: 1, boundaryOrdinal: 0, decision: 'APPROVE_LOCAL_REPAIR', note: 'Title runs into body.' });
  assert.equal(approved.summary.approvedLocalRepairs, 1);
  const plan = buildBookOnePauseRepairPlan({ audit, review: approved });
  assert.equal(plan.approvedRepairs, 1);
  assert.equal(plan.chapters[0].repairs[0].deltaMs, 224);
  assert.equal(plan.chapters[0].repairs[0].silenceEndMs, 2576);
});

test('review dashboard exposes bounded A/B actions and explicit decisions', () => {
  const audit = fixtureAudit();
  const previewManifest = { previews: [{ chapterNumber: 1, boundaryOrdinal: 0, originalRelativePath: 'previews/original.wav', fixedRelativePath: 'previews/fixed.wav' }, { chapterNumber: 1, boundaryOrdinal: 1, originalRelativePath: 'previews/surgical.wav', fixedRelativePath: null }] };
  const html = renderBookOneHumanPauseReviewHtml({ audit, previewManifest, serverMode: true });
  assert.match(html, /Play Original/);
  assert.match(html, /Preview Fix/);
  assert.match(html, /Approve Fix/);
  assert.match(html, /Apply Approved Fixes/);
  assert.match(html, /Listening never counts as approval/);
  assert.match(html, /12|1 boundaries YasReady could not safely localize/);
});

test('stale absolute source path relocates only through an exact digest match', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'yasready-pause-relocate-'));
  try {
    const movedDir = path.join(root, 'moved', 'distribution', 'direct-owned');
    await mkdir(movedDir, { recursive: true });
    const moved = path.join(movedDir, '001-Chapter-1-Departure.mp3');
    const bytes = Buffer.from('digest-locked-audio-fixture');
    await writeFile(moved, bytes);
    const digest = sha256(bytes.toString('base64'));
    const resolved = await resolveBookOnePauseSourceAudio({
      storedPath: path.join(root, 'deleted-old-location', '001-Chapter-1-Departure.mp3'),
      expectedDigest: digest,
      chapterNumber: 1,
      searchRoots: [root]
    });
    assert.equal(resolved.file, moved);
    assert.equal(resolved.relocated, true);
    assert.equal(resolved.resolution, 'RELOCATED_DIGEST_MATCH');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('relocation refuses same-name audio when the digest does not match', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'yasready-pause-relocate-wrong-'));
  try {
    const moved = path.join(root, '001-Chapter-1-Departure.mp3');
    await writeFile(moved, Buffer.from('wrong-audio'));
    await assert.rejects(
      resolveBookOnePauseSourceAudio({
        storedPath: path.join(root, 'gone', '001-Chapter-1-Departure.mp3'),
        expectedDigest: sha256(Buffer.from('expected-audio').toString('base64')),
        chapterNumber: 1,
        searchRoots: [root]
      }),
      /no digest-matching relocated copy/i
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

