import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { YASREADY_AUDIOBOOKS_VERSION } from '../release.js';
import { sha256, stableJson } from '../core/hash.js';
import { FfmpegAdapter } from '../mastering/ffmpeg-adapter.js';
import { verifyBookOnePauseFidelityPlan } from './book-one-pause-fidelity-service.js';
import { verifyBookOneCinematicRebuildResult } from './book-one-cinematic-naturalism-service.js';

export const BOOK_ONE_PAUSE_AUDIT_POLICY = Object.freeze({
  silenceNoiseDb: -50,
  silenceDetectionMinMs: 60,
  highConfidenceThreshold: 0.80,
  compliantToleranceMs: 12,
  headingSearchMaxMs: 30000,
  policy: 'read-only-local-waveform-localization-never-infer-deficit-from-layout-alone'
});

const freeze = (value) => {
  if (Array.isArray(value)) { for (const child of value) freeze(child); return Object.freeze(value); }
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); return Object.freeze(value); }
  return value;
};
const clean = (value) => String(value ?? '').trim();
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const round = (value, digits = 3) => {
  const factor = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
};
const exists = async (file) => { try { await stat(file); return true; } catch { return false; } };
const fileDigest = async (file) => sha256((await readFile(file)).toString('base64'));

function auditCore(value) {
  return {
    schemaVersion: value.schemaVersion,
    release: value.release,
    artifact: value.artifact,
    status: value.status,
    source: value.source,
    policy: value.policy,
    summary: value.summary,
    chapters: value.chapters,
    repairAssessment: value.repairAssessment,
    guardrails: value.guardrails
  };
}

function safeResolve(root, relative) {
  const resolvedRoot = path.resolve(root);
  const candidate = path.resolve(resolvedRoot, relative);
  if (candidate !== resolvedRoot && !candidate.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`Pause audit audio path escapes cinematic output root: ${relative}`);
  }
  return candidate;
}

export async function inspectBookOnePauseAudio({
  cinematicResult,
  ffmpeg = new FfmpegAdapter(),
  audioRoot = null,
  policy = BOOK_ONE_PAUSE_AUDIT_POLICY
} = {}) {
  verifyBookOneCinematicRebuildResult(cinematicResult);
  const health = await ffmpeg.healthCheck();
  if (!health?.ok) throw new Error(`Pause audit requires local FFmpeg + FFprobe: ${health?.reason ?? 'health check failed'}`);

  const root = path.resolve(audioRoot ?? cinematicResult.source?.outputRoot ?? '');
  if (!root || root === path.resolve('.')) throw new Error('Pause audit cinematic result is missing source.outputRoot');
  if (!(await exists(root))) throw new Error(`Pause audit cinematic output root no longer exists: ${root}`);

  const resultChapters = [...(cinematicResult.chapters ?? [])]
    .sort((a, b) => Number(a.chapterNumber) - Number(b.chapterNumber))
    .filter((chapter) => Number(chapter.chapterNumber) >= 1 && Number(chapter.chapterNumber) <= 10);
  if (resultChapters.length !== 10) throw new Error(`Pause audit requires exactly 10 completed cinematic chapters; found ${resultChapters.length}`);

  const chapters = [];
  for (const chapter of resultChapters) {
    const rel = chapter.outputs?.directMp3;
    const expectedDigest = chapter.digests?.directMp3;
    if (!rel || !expectedDigest) throw new Error(`Chapter ${chapter.chapterNumber} is missing locked Direct MP3 path/digest evidence`);
    const audioFile = safeResolve(root, rel);
    if (!(await exists(audioFile))) throw new Error(`Chapter ${chapter.chapterNumber} Direct MP3 is missing: ${audioFile}`);
    const actualDigest = await fileDigest(audioFile);
    if (actualDigest !== expectedDigest) {
      throw new Error(`Chapter ${chapter.chapterNumber} Direct MP3 digest mismatch; refusing waveform audit of changed audio`);
    }
    const detection = await ffmpeg.detectSilences(audioFile, {
      noiseDb: policy.silenceNoiseDb,
      minDurationMs: policy.silenceDetectionMinMs
    });
    if (!(Number(detection?.probe?.durationSec) > 0)) throw new Error(`Chapter ${chapter.chapterNumber} audio duration could not be measured`);
    chapters.push(freeze({
      chapterNumber: Number(chapter.chapterNumber),
      title: chapter.title,
      audioFile,
      audioFileUrl: pathToFileURL(audioFile).href,
      outputRelativePath: rel,
      expectedDigest,
      actualDigest,
      durationMs: round(Number(detection.probe.durationSec) * 1000, 3),
      silenceNoiseDb: policy.silenceNoiseDb,
      silenceDetectionMinMs: policy.silenceDetectionMinMs,
      silences: freeze((detection.silences ?? []).map((silence, index) => freeze({
        index,
        startMs: round(silence.startMs, 3),
        endMs: round(silence.endMs, 3),
        durationMs: round(silence.durationMs, 3),
        midpointMs: round((Number(silence.startMs) + Number(silence.endMs)) / 2, 3)
      })))
    }));
  }

  return freeze({
    root,
    ffmpeg: health,
    chapters: freeze(chapters),
    providerCallsPerformed: 0,
    providerSpendUsd: 0,
    audioWritesPerformed: 0
  });
}

function expectedBoundaryPosition(boundary, chapter, durationMs) {
  const paragraphCount = Number(chapter.paragraphCount ?? 0);
  const afterIndex = boundary.afterBodyParagraphIndex;
  if (Number.isInteger(Number(afterIndex)) && Number(afterIndex) >= 0 && paragraphCount > 0) {
    const ratio = clamp((Number(afterIndex) + 1) / (paragraphCount + 1), 0.001, 0.999);
    return freeze({ expectedMs: durationMs * ratio, ratio, basis: 'body-paragraph-ordinal' });
  }
  const sceneIndex = Number(boundary.sceneIndex);
  const sceneCount = Number(chapter.sceneCount ?? 0);
  if (Number.isInteger(sceneIndex) && sceneIndex > 0 && sceneCount > 1) {
    const ratio = clamp(sceneIndex / sceneCount, 0.001, 0.999);
    return freeze({ expectedMs: durationMs * ratio, ratio, basis: 'scene-ordinal' });
  }
  return null;
}

function internalSilences(audio) {
  const durationMs = Number(audio.durationMs);
  return (audio.silences ?? []).filter((silence) =>
    Number(silence.endMs) > 120 &&
    Number(silence.startMs) < durationMs - 120 &&
    !(Number(silence.startMs) <= 25)
  );
}

function confidenceFor({ boundary, distanceMs, secondDistanceMs, candidate, durationMs, expectedBasis }) {
  if (boundary.kind === 'HEADING_TO_BODY') {
    const max = Math.min(BOOK_ONE_PAUSE_AUDIT_POLICY.headingSearchMaxMs, durationMs * 0.10);
    if (candidate && candidate.startMs <= max) return 0.98;
    return 0.55;
  }
  const gap = Number.isFinite(secondDistanceMs) ? secondDistanceMs - distanceMs : Infinity;
  let score = 0.45;
  if (distanceMs <= 250 && gap >= 500) score = 0.96;
  else if (distanceMs <= 500 && gap >= 800) score = 0.90;
  else if (distanceMs <= 1000 && gap >= 1200) score = 0.82;
  else if (distanceMs <= 1800 && gap >= 1600) score = 0.74;
  else if (distanceMs <= 3000) score = 0.62;
  if (boundary.kind === 'SCENE_BOUNDARY' && expectedBasis === 'scene-ordinal') score = Math.min(0.90, score + 0.04);
  return round(score, 3);
}

function classifyLocalizedBoundary({ boundary, candidate, confidence, policy }) {
  if (!candidate || confidence < policy.highConfidenceThreshold) {
    return freeze({
      classification: 'NEEDS_MANUAL_ALIGNMENT_REVIEW',
      actualSilenceMs: candidate ? Number(candidate.durationMs) : null,
      deficitMs: null,
      repairReady: false,
      deficitProven: false
    });
  }
  const actual = Number(candidate.durationMs);
  const minimum = Number(boundary.minimumTotalSilenceMs ?? 0);
  const deficit = Math.max(0, minimum - actual);
  if (deficit <= Number(policy.compliantToleranceMs ?? 0)) {
    return freeze({
      classification: 'PASS_NO_CHANGE',
      actualSilenceMs: round(actual, 3),
      deficitMs: 0,
      repairReady: false,
      deficitProven: false
    });
  }
  if (boundary.repairMode === 'LOCAL_ASSEMBLY_REPAIR_CANDIDATE' && ['HEADING_TO_BODY', 'SCENE_BOUNDARY'].includes(boundary.kind)) {
    return freeze({
      classification: 'LOCAL_REPAIR_SAFE',
      actualSilenceMs: round(actual, 3),
      deficitMs: round(deficit, 3),
      repairReady: true,
      deficitProven: true
    });
  }
  return freeze({
    classification: 'DEFICIT_CANDIDATE_NEEDS_MANUAL_CONFIRMATION',
    actualSilenceMs: round(actual, 3),
    deficitMs: round(deficit, 3),
    repairReady: false,
    deficitProven: true
  });
}

function localizeChapter(chapter, audio, policy) {
  const candidates = internalSilences(audio);
  const used = new Set();
  const prepared = (chapter.boundaries ?? []).map((boundary) => {
    if (boundary.kind === 'HEADING_TO_BODY') {
      const first = candidates[0] ?? null;
      return { boundary, expected: first ? { expectedMs: first.midpointMs, ratio: first.midpointMs / audio.durationMs, basis: 'first-internal-silence-after-heading' } : null };
    }
    return { boundary, expected: expectedBoundaryPosition(boundary, chapter, Number(audio.durationMs)) };
  });

  prepared.sort((a, b) => Number(a.expected?.expectedMs ?? Infinity) - Number(b.expected?.expectedMs ?? Infinity));
  const rows = [];
  for (const item of prepared) {
    const { boundary, expected } = item;
    if (!expected) {
      rows.push(freeze({
        ...boundary,
        expectedTimestampMs: null,
        localizedTimestampMs: null,
        localizationBasis: null,
        localizationConfidence: 0,
        silenceCandidateIndex: null,
        classification: 'NEEDS_MANUAL_ALIGNMENT_REVIEW',
        actualSilenceMs: null,
        deficitMs: null,
        repairReady: false,
        deficitProven: false
      }));
      continue;
    }

    const available = candidates
      .filter((candidate) => !used.has(candidate.index))
      .map((candidate) => ({ candidate, distanceMs: Math.abs(Number(candidate.midpointMs) - Number(expected.expectedMs)) }))
      .sort((a, b) => a.distanceMs - b.distanceMs);
    const nearest = available[0] ?? null;
    const second = available[1] ?? null;
    if (!nearest) {
      rows.push(freeze({
        ...boundary,
        expectedTimestampMs: round(expected.expectedMs, 3),
        localizedTimestampMs: null,
        localizationBasis: expected.basis,
        localizationConfidence: 0,
        silenceCandidateIndex: null,
        classification: 'NEEDS_MANUAL_ALIGNMENT_REVIEW',
        actualSilenceMs: null,
        deficitMs: null,
        repairReady: false,
        deficitProven: false
      }));
      continue;
    }

    const confidence = confidenceFor({
      boundary,
      distanceMs: nearest.distanceMs,
      secondDistanceMs: second?.distanceMs ?? Infinity,
      candidate: nearest.candidate,
      durationMs: Number(audio.durationMs),
      expectedBasis: expected.basis
    });
    if (confidence >= policy.highConfidenceThreshold) used.add(nearest.candidate.index);
    const classification = classifyLocalizedBoundary({ boundary, candidate: nearest.candidate, confidence, policy });
    rows.push(freeze({
      ...boundary,
      expectedTimestampMs: round(expected.expectedMs, 3),
      localizedTimestampMs: round(nearest.candidate.midpointMs, 3),
      localizationDistanceMs: round(nearest.distanceMs, 3),
      localizationBasis: expected.basis,
      localizationConfidence: confidence,
      silenceCandidateIndex: nearest.candidate.index,
      silenceStartMs: round(nearest.candidate.startMs, 3),
      silenceEndMs: round(nearest.candidate.endMs, 3),
      ...classification
    }));
  }

  rows.sort((a, b) => Number(a.boundaryOrdinal) - Number(b.boundaryOrdinal));
  return freeze(rows);
}

export function buildBookOnePauseDeficitAudit({
  pausePlan,
  cinematicResult,
  audioEvidence,
  policy = BOOK_ONE_PAUSE_AUDIT_POLICY
} = {}) {
  verifyBookOnePauseFidelityPlan(pausePlan);
  verifyBookOneCinematicRebuildResult(cinematicResult);
  if (pausePlan.source?.cinematicResultDigest !== cinematicResult.integrity?.resultDigest) {
    throw new Error('Pause deficit audit result lineage does not match Pause Fidelity plan');
  }
  if (!audioEvidence || (audioEvidence.chapters ?? []).length !== 10) {
    throw new Error('Pause deficit audit requires verified local audio evidence for Chapters 1-10');
  }

  const audioByChapter = new Map(audioEvidence.chapters.map((row) => [Number(row.chapterNumber), row]));
  const firstTen = [...(pausePlan.chapters ?? [])]
    .filter((chapter) => Number(chapter.chapterNumber) >= 1 && Number(chapter.chapterNumber) <= 10)
    .sort((a, b) => Number(a.chapterNumber) - Number(b.chapterNumber));
  if (firstTen.length !== 10) throw new Error(`Pause deficit audit expected 10 narrative Pause Fidelity chapters; found ${firstTen.length}`);

  const chapters = firstTen.map((chapter) => {
    const audio = audioByChapter.get(Number(chapter.chapterNumber));
    if (!audio) throw new Error(`Pause deficit audit is missing verified audio for Chapter ${chapter.chapterNumber}`);
    const boundaries = localizeChapter(chapter, audio, policy);
    const count = (classification) => boundaries.filter((row) => row.classification === classification).length;
    return freeze({
      chapterNumber: Number(chapter.chapterNumber),
      sourceOrder: Number(chapter.order),
      title: chapter.title,
      paragraphCount: Number(chapter.paragraphCount ?? 0),
      sceneCount: Number(chapter.sceneCount ?? 0),
      audio: freeze({
        file: audio.audioFile,
        fileUrl: audio.audioFileUrl,
        digest: audio.actualDigest,
        durationMs: audio.durationMs,
        detectedSilenceIntervals: (audio.silences ?? []).length
      }),
      summary: freeze({
        structuralBoundaries: boundaries.length,
        localizedHighConfidence: boundaries.filter((row) => Number(row.localizationConfidence) >= policy.highConfidenceThreshold).length,
        passNoChange: count('PASS_NO_CHANGE'),
        localRepairSafe: count('LOCAL_REPAIR_SAFE'),
        deficitCandidatesNeedingManualConfirmation: count('DEFICIT_CANDIDATE_NEEDS_MANUAL_CONFIRMATION'),
        unresolved: count('NEEDS_MANUAL_ALIGNMENT_REVIEW')
      }),
      boundaries
    });
  });

  const all = chapters.flatMap((chapter) => chapter.boundaries);
  const count = (classification) => all.filter((row) => row.classification === classification).length;
  const base = {
    schemaVersion: 1,
    release: YASREADY_AUDIOBOOKS_VERSION,
    artifact: 'book-one-pause-localization-deficit-audit',
    status: 'PAUSE_DEFICIT_AUDIT_COMPLETE_REPAIR_GATE_CLOSED',
    source: freeze({
      pausePlanDigest: pausePlan.integrity.pausePlanDigest,
      productionPlanDigest: pausePlan.source.productionPlanDigest,
      cinematicLockDigest: pausePlan.source.cinematicLockDigest,
      cinematicResultDigest: pausePlan.source.cinematicResultDigest,
      manuscriptSourceHash: pausePlan.source.manuscriptSourceHash,
      chapterAudioDigests: freeze(audioEvidence.chapters.map((row) => freeze({ chapterNumber: row.chapterNumber, digest: row.actualDigest })))
    }),
    policy: freeze({ ...policy }),
    summary: freeze({
      chaptersAudited: chapters.length,
      chapterAudioFilesDigestVerified: audioEvidence.chapters.length,
      structuralBoundaries: all.length,
      localizedHighConfidence: all.filter((row) => Number(row.localizationConfidence) >= policy.highConfidenceThreshold).length,
      passNoChange: count('PASS_NO_CHANGE'),
      deficitCandidates: count('LOCAL_REPAIR_SAFE') + count('DEFICIT_CANDIDATE_NEEDS_MANUAL_CONFIRMATION'),
      localRepairSafe: count('LOCAL_REPAIR_SAFE'),
      deficitCandidatesNeedingManualConfirmation: count('DEFICIT_CANDIDATE_NEEDS_MANUAL_CONFIRMATION'),
      unresolved: count('NEEDS_MANUAL_ALIGNMENT_REVIEW'),
      providerRegenerationDecisionsMade: 0,
      canonicalWordsChanged: false,
      providerTtsCallsPerformed: 0,
      providerSpendUsd: 0,
      audioWritesPerformed: 0
    }),
    chapters: freeze(chapters),
    repairAssessment: freeze({
      repairPerformed: false,
      repairAuthorizationCreated: false,
      safeLocalAssemblyDeficits: count('LOCAL_REPAIR_SAFE'),
      surgicalCandidatesAwaitingHumanConfirmation: count('DEFICIT_CANDIDATE_NEEDS_MANUAL_CONFIRMATION'),
      unresolvedBoundaries: count('NEEDS_MANUAL_ALIGNMENT_REVIEW'),
      regenerationDecision: 'NOT_EVALUATED_AND_NOT_AUTHORIZED',
      nextAction: 'Review localized deficit candidates in the dashboard. Confirm ambiguous/surgical boundaries before any .20.5 repair build. Do not regenerate provider audio solely from this audit.'
    }),
    guardrails: freeze({
      readOnlyAudit: true,
      canonicalTextImmutable: true,
      canonicalWordsChanged: false,
      audioDigestsVerifiedBeforeMeasurement: true,
      providerCallsPerformed: 0,
      providerTtsCallsPerformed: 0,
      providerSpendUsd: 0,
      audioWritesPerformed: 0,
      repairAudioWritten: false,
      repairAuthorized: false,
      providerRegenerationAuthorized: false,
      chapterElevenMayBeGenerated: false,
      nextBatchArmed: false,
      fullBookGenerationArmed: false
    })
  };
  return freeze({ ...base, integrity: freeze({ auditDigest: sha256(stableJson(auditCore(base))) }) });
}

export function verifyBookOnePauseDeficitAudit(audit) {
  if (!audit || audit.artifact !== 'book-one-pause-localization-deficit-audit') throw new Error('Invalid Book One pause deficit audit');
  if (audit.status !== 'PAUSE_DEFICIT_AUDIT_COMPLETE_REPAIR_GATE_CLOSED') throw new Error('Pause deficit audit status drifted');
  if (audit.guardrails?.readOnlyAudit !== true || audit.guardrails?.audioDigestsVerifiedBeforeMeasurement !== true ||
      audit.guardrails?.providerCallsPerformed !== 0 || audit.guardrails?.providerTtsCallsPerformed !== 0 ||
      audit.guardrails?.providerSpendUsd !== 0 || audit.guardrails?.audioWritesPerformed !== 0 ||
      audit.guardrails?.repairAudioWritten !== false || audit.guardrails?.repairAuthorized !== false ||
      audit.guardrails?.providerRegenerationAuthorized !== false || audit.guardrails?.chapterElevenMayBeGenerated !== false ||
      audit.guardrails?.nextBatchArmed !== false || audit.guardrails?.fullBookGenerationArmed !== false) {
    throw new Error('Pause deficit audit guardrails drifted');
  }
  if (!audit.integrity?.auditDigest) throw new Error('Pause deficit audit digest missing');
  if (sha256(stableJson(auditCore(audit))) !== audit.integrity.auditDigest) throw new Error('Pause deficit audit digest mismatch');
  return true;
}

function fmtMs(ms) {
  if (!Number.isFinite(Number(ms))) return '—';
  const total = Math.max(0, Number(ms));
  const minutes = Math.floor(total / 60000);
  const seconds = (total - minutes * 60000) / 1000;
  return `${minutes}:${seconds.toFixed(3).padStart(6, '0')}`;
}

export function renderBookOnePauseDeficitAuditMarkdown(audit) {
  verifyBookOnePauseDeficitAudit(audit);
  const s = audit.summary;
  const lines = [
    '# Book One — Pause Localization & Deficit Audit', '',
    `**Status:** ${audit.status}`,
    `**Release:** ${audit.release}`, '',
    '## Read-only safety', '',
    '- Existing Chapters 1–10 were digest-verified before measurement.',
    '- Local FFmpeg waveform analysis only.',
    '- Provider/TTS calls: **0**.',
    '- Audio writes: **0**.',
    '- Chapter 11: **OFF**.', '',
    '## Audit summary', '',
    `- Structural boundaries: **${s.structuralBoundaries}**`,
    `- High-confidence localized: **${s.localizedHighConfidence}**`,
    `- PASS — no change: **${s.passNoChange}**`,
    `- Proven deficits: **${s.deficitCandidates}**`,
    `- Safe local assembly repairs: **${s.localRepairSafe}**`,
    `- Surgical deficit candidates awaiting confirmation: **${s.deficitCandidatesNeedingManualConfirmation}**`,
    `- Unresolved / alignment review: **${s.unresolved}**`, '',
    '## Chapters', ''
  ];
  for (const chapter of audit.chapters) {
    lines.push(`### Chapter ${chapter.chapterNumber} — ${chapter.title}`, '');
    lines.push(`- Duration: ${fmtMs(chapter.audio.durationMs)}`);
    lines.push(`- Structural boundaries: ${chapter.summary.structuralBoundaries}`);
    lines.push(`- PASS: ${chapter.summary.passNoChange}`);
    lines.push(`- Local repair safe: ${chapter.summary.localRepairSafe}`);
    lines.push(`- Surgical candidates: ${chapter.summary.deficitCandidatesNeedingManualConfirmation}`);
    lines.push(`- Unresolved: ${chapter.summary.unresolved}`, '');
    const attention = chapter.boundaries.filter((row) => row.classification !== 'PASS_NO_CHANGE');
    if (attention.length) {
      lines.push('| Boundary | Kind | Time | Confidence | Actual | Minimum | Deficit | Classification |', '|---:|---|---:|---:|---:|---:|---:|---|');
      for (const row of attention) {
        lines.push(`| ${row.boundaryOrdinal + 1} | ${row.kind} | ${fmtMs(row.localizedTimestampMs)} | ${Math.round(Number(row.localizationConfidence ?? 0) * 100)}% | ${Number.isFinite(Number(row.actualSilenceMs)) ? `${Math.round(row.actualSilenceMs)} ms` : '—'} | ${row.minimumTotalSilenceMs} ms | ${Number.isFinite(Number(row.deficitMs)) ? `${Math.round(row.deficitMs)} ms` : '—'} | ${row.classification} |`);
      }
      lines.push('');
    }
  }
  lines.push('## Next action', '', audit.repairAssessment.nextAction, '');
  return lines.join('\n');
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

export function renderBookOnePauseDeficitAuditHtml(audit) {
  verifyBookOnePauseDeficitAudit(audit);
  const chapterCards = audit.chapters.map((chapter) => {
    const attention = chapter.boundaries.filter((row) => row.classification !== 'PASS_NO_CHANGE');
    const rows = attention.map((row) => {
      const timeSec = Number.isFinite(Number(row.localizedTimestampMs)) ? Math.max(0, Number(row.localizedTimestampMs) / 1000 - 1.5) : null;
      const stopSec = Number.isFinite(Number(row.localizedTimestampMs)) ? Math.min(Number(chapter.audio.durationMs) / 1000, Number(row.localizedTimestampMs) / 1000 + 2.75) : null;
      const play = timeSec == null ? '<span class="muted">Unlocalized</span>' : `<button class="play" data-player="audio-${chapter.chapterNumber}" data-time="${timeSec.toFixed(3)}" data-stop="${stopSec.toFixed(3)}">Play boundary</button>`;
      return `<tr data-class="${escapeHtml(row.classification)}"><td>${row.boundaryOrdinal + 1}</td><td>${escapeHtml(row.kind)}</td><td>${escapeHtml(row.classification)}</td><td>${fmtMs(row.localizedTimestampMs)}</td><td>${Math.round(Number(row.localizationConfidence ?? 0) * 100)}%</td><td>${Number.isFinite(Number(row.actualSilenceMs)) ? `${Math.round(row.actualSilenceMs)} ms` : '—'}</td><td>${row.minimumTotalSilenceMs} ms</td><td>${Number.isFinite(Number(row.deficitMs)) ? `${Math.round(row.deficitMs)} ms` : '—'}</td><td>${play}</td></tr>`;
    }).join('');
    return `<section class="chapter"><div class="chapterHead"><div><div class="eyebrow">Chapter ${chapter.chapterNumber}</div><h2>${escapeHtml(chapter.title)}</h2></div><div class="chapterStats"><span>${chapter.summary.passNoChange} pass</span><span>${chapter.summary.localRepairSafe} local</span><span>${chapter.summary.deficitCandidatesNeedingManualConfirmation} surgical</span><span>${chapter.summary.unresolved} unresolved</span></div></div><audio id="audio-${chapter.chapterNumber}" controls preload="metadata" src="${escapeHtml(chapter.audio.fileUrl)}"></audio><div class="tableWrap"><table><thead><tr><th>#</th><th>Kind</th><th>Status</th><th>Time</th><th>Confidence</th><th>Actual</th><th>Minimum</th><th>Deficit</th><th>Listen</th></tr></thead><tbody>${rows || '<tr><td colspan="9">No attention-required boundaries in this chapter.</td></tr>'}</tbody></table></div></section>`;
  }).join('');
  const s = audit.summary;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Book One — Pause Localization & Deficit Audit</title><style>
  :root{color-scheme:dark;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","Helvetica Neue",sans-serif;background:#0b0b0c;color:#f5f5f7}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at top,#242429 0,#0b0b0c 44%);padding:32px}.wrap{max-width:1380px;margin:auto}.hero{padding:34px;border:1px solid #303036;border-radius:28px;background:rgba(24,24,27,.88);box-shadow:0 20px 60px rgba(0,0,0,.35)}.eyebrow{font-size:12px;text-transform:uppercase;letter-spacing:.15em;color:#a1a1aa}h1{font-size:38px;margin:6px 0 10px}h2{margin:4px 0 8px}.muted{color:#a1a1aa}.grid{display:grid;grid-template-columns:repeat(6,1fr);gap:12px;margin:20px 0}.metric{padding:16px;border-radius:18px;background:#161618;border:1px solid #2b2b31}.metric b{display:block;font-size:26px}.metric span{font-size:12px;color:#a1a1aa}.safety{margin-top:16px;padding:14px 16px;border-radius:16px;background:#101b14;border:1px solid #25402d;color:#b9f6ca}.chapter{margin-top:20px;padding:24px;border-radius:24px;background:#141416;border:1px solid #2b2b31}.chapterHead{display:flex;justify-content:space-between;gap:20px;align-items:flex-start}.chapterStats{display:flex;gap:8px;flex-wrap:wrap}.chapterStats span{font-size:12px;padding:7px 10px;border-radius:99px;background:#222226;border:1px solid #34343b}audio{width:100%;margin:12px 0 18px}.tableWrap{overflow:auto}table{width:100%;border-collapse:collapse;font-size:13px}th,td{padding:10px;border-bottom:1px solid #29292e;text-align:left;white-space:nowrap}th{color:#a1a1aa;font-weight:600}.play{border:1px solid #4c4c56;background:#26262c;color:#fff;padding:7px 10px;border-radius:10px;cursor:pointer}.play:hover{background:#34343b}.foot{margin:24px 0;color:#a1a1aa;font-size:13px}@media(max-width:900px){body{padding:16px}.grid{grid-template-columns:repeat(2,1fr)}.chapterHead{display:block}.hero{padding:22px}h1{font-size:30px}}</style></head><body><main class="wrap"><section class="hero"><div class="eyebrow">YasReady Audiobooks ${escapeHtml(audit.release)}</div><h1>Pause Localization & Deficit Audit</h1><p class="muted">Read-only waveform evidence for the preserved Cinematic Naturalism A Chapters 1–10. Layout alone never creates a deficit.</p><div class="grid"><div class="metric"><b>${s.structuralBoundaries}</b><span>structural boundaries</span></div><div class="metric"><b>${s.localizedHighConfidence}</b><span>high-confidence localized</span></div><div class="metric"><b>${s.passNoChange}</b><span>pass — no change</span></div><div class="metric"><b>${s.deficitCandidates}</b><span>deficit candidates</span></div><div class="metric"><b>${s.localRepairSafe}</b><span>safe local repairs</span></div><div class="metric"><b>${s.unresolved}</b><span>alignment review</span></div></div><div class="safety">10/10 audio files digest verified · 0 provider calls · 0 TTS · $0 spend · 0 audio writes · Chapter 11 OFF</div></section>${chapterCards}<p class="foot">${escapeHtml(audit.repairAssessment.nextAction)}</p></main><script>let activeBoundary=null;function playBoundary(btn){const audio=document.getElementById(btn.dataset.player);if(!audio)return;const start=Number(btn.dataset.time||0),stop=Number(btn.dataset.stop||start+4.25);const go=()=>{audio.pause();audio.currentTime=start;activeBoundary={audio,stop};audio.play();};if(audio.readyState>=1)go();else audio.addEventListener('loadedmetadata',go,{once:true});}document.querySelectorAll('.play').forEach(btn=>btn.addEventListener('click',()=>playBoundary(btn)));document.querySelectorAll('audio').forEach(audio=>audio.addEventListener('timeupdate',()=>{if(activeBoundary?.audio===audio&&audio.currentTime>=activeBoundary.stop){audio.pause();activeBoundary=null;}}));</script></body></html>`;
}
