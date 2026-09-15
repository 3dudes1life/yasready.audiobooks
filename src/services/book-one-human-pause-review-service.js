import { mkdir, readFile, writeFile, stat, rm, mkdtemp, readdir } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { YASREADY_AUDIOBOOKS_VERSION } from '../release.js';
import { sha256, stableJson } from '../core/hash.js';
import { FfmpegAdapter } from '../mastering/ffmpeg-adapter.js';
import { verifyBookOnePauseDeficitAudit } from './book-one-pause-deficit-audit-service.js';

export const BOOK_ONE_HUMAN_PAUSE_REVIEW_POLICY = Object.freeze({
  previewBeforeMs: 1750,
  previewAfterMs: 2750,
  repairVerificationToleranceMs: 20,
  actionableClassifications: Object.freeze([
    'LOCAL_REPAIR_SAFE',
    'DEFICIT_CANDIDATE_NEEDS_MANUAL_CONFIRMATION'
  ]),
  approvalClassification: 'LOCAL_REPAIR_SAFE',
  allowedDecisions: Object.freeze([
    'APPROVE_LOCAL_REPAIR',
    'LEAVE_AS_IS',
    'NEEDS_REVIEW'
  ]),
  policy: 'human-decision-required-local-preview-only-never-provider-regenerate'
});

const freeze = (value) => {
  if (Array.isArray(value)) { for (const child of value) freeze(child); return Object.freeze(value); }
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); return Object.freeze(value); }
  return value;
};
const round = (value, digits = 3) => {
  const factor = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
};
const exists = async (file) => { try { await stat(file); return true; } catch { return false; } };
const fileDigest = async (file) => sha256((await readFile(file)).toString('base64'));
const execFile = promisify(execFileCb);
const SEARCH_SKIP_DIRS = new Set(['.git', 'node_modules', '.next', 'dist', 'build', 'Library', '.Trash']);

function uniqueExistingSearchRoots(values = []) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    if (!value) continue;
    const resolved = path.resolve(String(value));
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    out.push(resolved);
  }
  return out;
}

async function firstExistingAncestor(file) {
  if (!file) return null;
  let current = path.resolve(String(file));
  while (true) {
    if (await exists(current)) {
      try {
        const s = await stat(current);
        return s.isDirectory() ? current : path.dirname(current);
      } catch { return null; }
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function looksLikeChapterAudio(name, chapterNumber, expectedBasename) {
  if (name === expectedBasename) return 0;
  const lower = String(name).toLowerCase();
  if (!lower.endsWith('.mp3')) return null;
  const padded = String(Number(chapterNumber)).padStart(3, '0');
  if (lower.startsWith(`${padded}-`)) return 1;
  if (new RegExp(`(?:^|[-_.\\s])chapter[-_.\\s]*0*${Number(chapterNumber)}(?:[-_.\\s]|$)`, 'i').test(name)) return 2;
  return null;
}

async function discoverRelocatedAudioCandidates(root, { chapterNumber, expectedBasename, maxEntries = 12000, maxCandidates = 250 } = {}) {
  if (!root || !(await exists(root))) return [];
  const queue = [path.resolve(root)];
  const candidates = [];
  let visited = 0;
  while (queue.length && visited < maxEntries && candidates.length < maxCandidates) {
    const dir = queue.shift();
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      visited += 1;
      if (visited > maxEntries) break;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SEARCH_SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) queue.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const rank = looksLikeChapterAudio(entry.name, chapterNumber, expectedBasename);
      if (rank != null) candidates.push({ file: full, rank });
      if (candidates.length >= maxCandidates) break;
    }
  }
  return candidates.sort((a, b) => a.rank - b.rank || a.file.localeCompare(b.file));
}


function candidateRankFromPath(file, chapterNumber, expectedBasename) {
  return looksLikeChapterAudio(path.basename(file), chapterNumber, expectedBasename);
}

async function runCandidateCommand(command, args, { maxBuffer = 8 * 1024 * 1024, timeoutMs = 2500 } = {}) {
  try {
    const { stdout } = await execFile(command, args, { maxBuffer, timeout: timeoutMs, killSignal: 'SIGKILL' });
    return String(stdout ?? '').split('\n').map((x) => x.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

async function discoverMacWideAudioCandidates({ chapterNumber, expectedBasename } = {}) {
  const out = [];
  const seen = new Set();
  const add = (file, source) => {
    if (!file) return;
    const resolved = path.resolve(file);
    if (seen.has(resolved)) return;
    const rank = candidateRankFromPath(resolved, chapterNumber, expectedBasename);
    if (rank == null) return;
    seen.add(resolved);
    out.push({ file: resolved, rank, source });
  };

  if (process.platform === 'darwin') {
    const escapedBase = String(expectedBasename ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const chapter = Number(chapterNumber);
    const padded = String(chapter).padStart(3, '0');
    const queries = [
      escapedBase ? `kMDItemFSName == "${escapedBase}"c` : null,
      `kMDItemFSName == "${padded}-*.mp3"c`,
      `kMDItemFSName == "*Chapter*${chapter}*.mp3"c`
    ].filter(Boolean);
    for (const query of queries) {
      const rows = await runCandidateCommand('mdfind', [query]);
      for (const row of rows) add(row, 'SPOTLIGHT');
    }
  }

  const roots = [homedir(), '/Volumes'];
  const expected = String(expectedBasename ?? '');
  const padded = String(Number(chapterNumber)).padStart(3, '0');
  for (const root of roots) {
    if (!(await exists(root))) continue;
    const args = [root, '-type', 'f', '('];
    if (expected) args.push('-iname', expected, '-o');
    args.push('-iname', `${padded}-*.mp3`, '-o', '-iname', `*chapter*${Number(chapterNumber)}*.mp3`, ')');
    const rows = await runCandidateCommand('/usr/bin/find', args, { maxBuffer: 16 * 1024 * 1024, timeoutMs: 4000 });
    for (const row of rows) add(row, root === '/Volumes' ? 'MOUNTED_VOLUME_FIND' : 'HOME_FIND');
  }

  return out.sort((a, b) => a.rank - b.rank || a.file.localeCompare(b.file));
}

export async function resolveBookOnePauseSourceAudio({ storedPath, expectedDigest, chapterNumber, searchRoots = [], allowMacWideSearch = true } = {}) {
  const original = storedPath ? path.resolve(String(storedPath)) : null;
  if (!expectedDigest) throw new Error(`Chapter ${chapterNumber} source audio digest is missing`);
  if (original && await exists(original)) {
    const digest = await fileDigest(original);
    if (digest !== expectedDigest) {
      throw new Error(`Chapter ${chapterNumber} source audio exists but its digest changed; relocation search refused`);
    }
    return freeze({ file: original, digest, relocated: false, resolution: 'AUDIT_PATH_DIGEST_MATCH', storedPath: original, searchedRoots: freeze([]) });
  }

  const ancestor = original ? await firstExistingAncestor(original) : null;
  const roots = uniqueExistingSearchRoots([ancestor, ...searchRoots]);
  const basename = original ? path.basename(original) : '';
  const checked = new Set();

  const tryCandidate = async (file, resolution, searchedRoots = roots) => {
    const resolved = path.resolve(file);
    if (checked.has(resolved) || !(await exists(resolved))) return null;
    checked.add(resolved);
    const digest = await fileDigest(resolved);
    if (digest !== expectedDigest) return null;
    return freeze({
      file: resolved,
      digest,
      relocated: original ? resolved !== original : true,
      resolution,
      storedPath: original,
      searchedRoots: freeze(searchedRoots)
    });
  };

  for (const root of roots) {
    const candidates = await discoverRelocatedAudioCandidates(root, { chapterNumber, expectedBasename: basename });
    for (const candidate of candidates) {
      const hit = await tryCandidate(candidate.file, 'RELOCATED_DIGEST_MATCH');
      if (hit) return hit;
    }
  }

  if (allowMacWideSearch) {
    const macWide = await discoverMacWideAudioCandidates({ chapterNumber, expectedBasename: basename });
    for (const candidate of macWide) {
      const hit = await tryCandidate(candidate.file, `MAC_WIDE_${candidate.source}_DIGEST_MATCH`, [...roots, 'macOS Spotlight', 'bounded home-folder search', 'bounded mounted-volume search']);
      if (hit) return hit;
    }
  }

  const searched = roots.length ? roots.join(', ') : '(no usable configured roots)';
  if (!allowMacWideSearch) {
    throw new Error(`Chapter ${chapterNumber} source audio is missing from its audit path and no digest-matching relocated copy was found. Stored path: ${original ?? '—'}. Searched: ${searched}.`);
  }
  throw new Error(
    `Chapter ${chapterNumber} audited source audio is truly unavailable after exact-digest recovery. ` +
    `Stored path: ${original ?? '—'}. Checked configured roots: ${searched}. ` +
    `Also checked bounded macOS Spotlight, home-folder search, and mounted-volume search. ` +
    `YasReady will not substitute a different MP3 for an old timing audit. ` +
    `Create a fresh Pause Deficit Audit from the current Chapter ${chapterNumber} cinematic audio before reviewing or repairing this boundary.`
  );
}
const decisionKey = (chapterNumber, boundaryOrdinal) => `${Number(chapterNumber)}:${Number(boundaryOrdinal)}`;
const safeSlug = (value) => String(value ?? '').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'item';
const htmlEscape = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

function reviewCore(value) {
  return {
    schemaVersion: value.schemaVersion,
    release: value.release,
    artifact: value.artifact,
    status: value.status,
    source: value.source,
    policy: value.policy,
    summary: value.summary,
    decisions: value.decisions,
    guardrails: value.guardrails
  };
}

function repairResultCore(value) {
  return {
    schemaVersion: value.schemaVersion,
    release: value.release,
    artifact: value.artifact,
    status: value.status,
    source: value.source,
    summary: value.summary,
    chapters: value.chapters,
    guardrails: value.guardrails
  };
}

function auditBoundary(audit, chapterNumber, boundaryOrdinal) {
  const chapter = (audit.chapters ?? []).find((row) => Number(row.chapterNumber) === Number(chapterNumber));
  if (!chapter) throw new Error(`Pause review chapter ${chapterNumber} does not exist in source audit`);
  const boundary = (chapter.boundaries ?? []).find((row) => Number(row.boundaryOrdinal) === Number(boundaryOrdinal));
  if (!boundary) throw new Error(`Pause review boundary ${chapterNumber}:${boundaryOrdinal} does not exist in source audit`);
  return { chapter, boundary };
}

function actionableBoundary(boundary) {
  return BOOK_ONE_HUMAN_PAUSE_REVIEW_POLICY.actionableClassifications.includes(boundary.classification);
}

function humanLabel(kind) {
  switch (kind) {
    case 'HEADING_TO_BODY': return 'Chapter title → first paragraph';
    case 'SCENE_BOUNDARY': return 'Scene break';
    case 'EXPLICIT_BLANK_SPACING': return 'Intentional blank-space transition';
    case 'STYLED_SPACING': return 'Styled spacing transition';
    case 'ORDINARY_PARAGRAPH': return 'Paragraph transition';
    default: return String(kind ?? 'Pause boundary').replaceAll('_', ' ').toLowerCase();
  }
}

export function buildBookOneHumanPauseReviewPlan(audit) {
  verifyBookOnePauseDeficitAudit(audit);
  const candidates = [];
  const unresolved = [];
  for (const chapter of audit.chapters ?? []) {
    for (const boundary of chapter.boundaries ?? []) {
      const row = freeze({
        chapterNumber: Number(chapter.chapterNumber),
        chapterTitle: chapter.title,
        boundaryOrdinal: Number(boundary.boundaryOrdinal),
        humanLabel: humanLabel(boundary.kind),
        kind: boundary.kind,
        classification: boundary.classification,
        localizedTimestampMs: Number.isFinite(Number(boundary.localizedTimestampMs)) ? Number(boundary.localizedTimestampMs) : null,
        silenceStartMs: Number.isFinite(Number(boundary.silenceStartMs)) ? Number(boundary.silenceStartMs) : null,
        silenceEndMs: Number.isFinite(Number(boundary.silenceEndMs)) ? Number(boundary.silenceEndMs) : null,
        localizationConfidence: Number(boundary.localizationConfidence ?? 0),
        actualSilenceMs: Number.isFinite(Number(boundary.actualSilenceMs)) ? Number(boundary.actualSilenceMs) : null,
        minimumTotalSilenceMs: Number(boundary.minimumTotalSilenceMs ?? 0),
        proposedDeltaMs: Number.isFinite(Number(boundary.deficitMs)) ? Math.max(0, Math.ceil(Number(boundary.deficitMs))) : null,
        repairReady: boundary.repairReady === true,
        sourceAudioFile: chapter.audio?.file,
        sourceAudioDigest: chapter.audio?.digest,
        sourceDurationMs: Number(chapter.audio?.durationMs ?? 0)
      });
      if (actionableBoundary(boundary)) candidates.push(row);
      else if (boundary.classification === 'NEEDS_MANUAL_ALIGNMENT_REVIEW') unresolved.push(row);
    }
  }
  const priority = (classification) => classification === 'LOCAL_REPAIR_SAFE' ? 0 : 1;
  candidates.sort((a, b) => priority(a.classification) - priority(b.classification)
    || a.chapterNumber - b.chapterNumber
    || a.boundaryOrdinal - b.boundaryOrdinal);
  unresolved.sort((a, b) => a.chapterNumber - b.chapterNumber || a.boundaryOrdinal - b.boundaryOrdinal);
  return freeze({
    release: YASREADY_AUDIOBOOKS_VERSION,
    sourceAuditDigest: audit.integrity.auditDigest,
    candidates: freeze(candidates),
    unresolved: freeze(unresolved),
    summary: freeze({
      actionable: candidates.length,
      localRepairSafe: candidates.filter((row) => row.classification === 'LOCAL_REPAIR_SAFE').length,
      surgicalManual: candidates.filter((row) => row.classification === 'DEFICIT_CANDIDATE_NEEDS_MANUAL_CONFIRMATION').length,
      unresolved: unresolved.length,
      passNoChange: Number(audit.summary?.passNoChange ?? 0)
    })
  });
}

export function buildInitialBookOneHumanPauseReview(audit) {
  const plan = buildBookOneHumanPauseReviewPlan(audit);
  return finalizeReview(audit, []);
}

function finalizeReview(audit, decisionRows) {
  verifyBookOnePauseDeficitAudit(audit);
  const plan = buildBookOneHumanPauseReviewPlan(audit);
  const unique = new Map();
  for (const incoming of decisionRows ?? []) {
    const chapterNumber = Number(incoming.chapterNumber);
    const boundaryOrdinal = Number(incoming.boundaryOrdinal);
    const { boundary } = auditBoundary(audit, chapterNumber, boundaryOrdinal);
    if (!actionableBoundary(boundary) && boundary.classification !== 'NEEDS_MANUAL_ALIGNMENT_REVIEW') {
      throw new Error(`Boundary ${chapterNumber}:${boundaryOrdinal} is not human-review actionable`);
    }
    const decision = incoming.decision == null || incoming.decision === '' ? null : String(incoming.decision);
    if (decision && !BOOK_ONE_HUMAN_PAUSE_REVIEW_POLICY.allowedDecisions.includes(decision)) {
      throw new Error(`Unsupported human pause decision: ${decision}`);
    }
    if (decision === 'APPROVE_LOCAL_REPAIR' && boundary.classification !== BOOK_ONE_HUMAN_PAUSE_REVIEW_POLICY.approvalClassification) {
      throw new Error(`Boundary ${chapterNumber}:${boundaryOrdinal} is not LOCAL_REPAIR_SAFE and cannot be auto-approved`);
    }
    const row = freeze({
      chapterNumber,
      boundaryOrdinal,
      kind: boundary.kind,
      classificationAtReview: boundary.classification,
      localizedTimestampMs: Number.isFinite(Number(boundary.localizedTimestampMs)) ? Number(boundary.localizedTimestampMs) : null,
      actualSilenceMs: Number.isFinite(Number(boundary.actualSilenceMs)) ? Number(boundary.actualSilenceMs) : null,
      minimumTotalSilenceMs: Number(boundary.minimumTotalSilenceMs ?? 0),
      proposedDeltaMs: Number.isFinite(Number(boundary.deficitMs)) ? Math.max(0, Math.ceil(Number(boundary.deficitMs))) : null,
      localizationConfidence: Number(boundary.localizationConfidence ?? 0),
      sourceAudioDigest: audit.chapters.find((c) => Number(c.chapterNumber) === chapterNumber)?.audio?.digest ?? null,
      decision,
      note: String(incoming.note ?? '').slice(0, 4000),
      decidedAt: incoming.decidedAt ?? new Date().toISOString()
    });
    unique.set(decisionKey(chapterNumber, boundaryOrdinal), row);
  }
  const decisions = [...unique.values()].sort((a, b) => a.chapterNumber - b.chapterNumber || a.boundaryOrdinal - b.boundaryOrdinal);
  const decidedActionable = decisions.filter((row) => row.decision && plan.candidates.some((candidate) => decisionKey(candidate.chapterNumber, candidate.boundaryOrdinal) === decisionKey(row.chapterNumber, row.boundaryOrdinal))).length;
  const base = {
    schemaVersion: 1,
    release: YASREADY_AUDIOBOOKS_VERSION,
    artifact: 'book-one-human-pause-review',
    status: decidedActionable >= plan.candidates.length && plan.candidates.length > 0
      ? 'HUMAN_PAUSE_REVIEW_COMPLETE'
      : 'HUMAN_PAUSE_REVIEW_IN_PROGRESS',
    source: freeze({
      auditDigest: audit.integrity.auditDigest,
      auditRelease: audit.release,
      manuscriptSourceHash: audit.source?.manuscriptSourceHash ?? null,
      chapterAudioDigests: freeze((audit.source?.chapterAudioDigests ?? []).map((row) => freeze({ ...row })))
    }),
    policy: BOOK_ONE_HUMAN_PAUSE_REVIEW_POLICY.policy,
    summary: freeze({
      actionableBoundaries: plan.candidates.length,
      decidedActionableBoundaries: decidedActionable,
      approvedLocalRepairs: decisions.filter((row) => row.decision === 'APPROVE_LOCAL_REPAIR').length,
      leaveAsIs: decisions.filter((row) => row.decision === 'LEAVE_AS_IS').length,
      needsReview: decisions.filter((row) => row.decision === 'NEEDS_REVIEW').length,
      undecidedActionableBoundaries: Math.max(0, plan.candidates.length - decidedActionable),
      providerTtsCallsPerformed: 0,
      providerSpendUsd: 0
    }),
    decisions: freeze(decisions),
    guardrails: freeze({
      listeningIsNotApproval: true,
      previewIsNotApproval: true,
      approvalRequiresExplicitDecision: true,
      onlyLocalRepairSafeMayAutoRepair: true,
      manualAlignmentMayAutoRepair: false,
      surgicalCandidateMayAutoRepair: false,
      canonicalTextImmutable: true,
      providerRegenerationAuthorized: false,
      providerTtsCallsPerformed: 0,
      providerSpendUsd: 0,
      sourceAudioMayBeOverwritten: false,
      chapterElevenMayBeGenerated: false,
      nextBatchArmed: false,
      fullBookGenerationArmed: false
    })
  };
  return freeze({ ...base, integrity: freeze({ reviewDigest: sha256(stableJson(reviewCore(base))) }) });
}

export function upsertBookOneHumanPauseDecision({ audit, review, chapterNumber, boundaryOrdinal, decision = null, note = '' } = {}) {
  verifyBookOneHumanPauseReview(review, audit);
  const rows = (review.decisions ?? []).map((row) => ({ ...row }));
  const key = decisionKey(chapterNumber, boundaryOrdinal);
  const existing = rows.findIndex((row) => decisionKey(row.chapterNumber, row.boundaryOrdinal) === key);
  const next = {
    chapterNumber: Number(chapterNumber),
    boundaryOrdinal: Number(boundaryOrdinal),
    decision: decision == null || decision === '' ? null : String(decision),
    note: String(note ?? ''),
    decidedAt: new Date().toISOString()
  };
  if (existing >= 0) rows[existing] = next;
  else rows.push(next);
  return finalizeReview(audit, rows);
}

export function verifyBookOneHumanPauseReview(review, audit = null) {
  if (!review || review.artifact !== 'book-one-human-pause-review') throw new Error('Invalid Book One human pause review');
  if (!['HUMAN_PAUSE_REVIEW_IN_PROGRESS', 'HUMAN_PAUSE_REVIEW_COMPLETE'].includes(review.status)) throw new Error('Human pause review status invalid');
  if (!review.integrity?.reviewDigest || sha256(stableJson(reviewCore(review))) !== review.integrity.reviewDigest) throw new Error('Human pause review digest mismatch');
  if (review.guardrails?.listeningIsNotApproval !== true || review.guardrails?.previewIsNotApproval !== true ||
      review.guardrails?.approvalRequiresExplicitDecision !== true || review.guardrails?.onlyLocalRepairSafeMayAutoRepair !== true ||
      review.guardrails?.manualAlignmentMayAutoRepair !== false || review.guardrails?.surgicalCandidateMayAutoRepair !== false ||
      review.guardrails?.providerTtsCallsPerformed !== 0 || review.guardrails?.sourceAudioMayBeOverwritten !== false ||
      review.guardrails?.chapterElevenMayBeGenerated !== false || review.guardrails?.nextBatchArmed !== false ||
      review.guardrails?.fullBookGenerationArmed !== false) {
    throw new Error('Human pause review guardrails drifted');
  }
  if (audit) {
    verifyBookOnePauseDeficitAudit(audit);
    if (review.source?.auditDigest !== audit.integrity.auditDigest) throw new Error('Human pause review does not belong to this pause audit');
    for (const row of review.decisions ?? []) {
      const { boundary, chapter } = auditBoundary(audit, row.chapterNumber, row.boundaryOrdinal);
      if (row.classificationAtReview !== boundary.classification) throw new Error(`Human pause review classification drifted for ${row.chapterNumber}:${row.boundaryOrdinal}`);
      if (row.sourceAudioDigest !== chapter.audio?.digest) throw new Error(`Human pause review audio digest drifted for Chapter ${row.chapterNumber}`);
      if (row.decision === 'APPROVE_LOCAL_REPAIR' && boundary.classification !== 'LOCAL_REPAIR_SAFE') {
        throw new Error(`Unsafe auto-repair approval for ${row.chapterNumber}:${row.boundaryOrdinal}`);
      }
    }
  }
  return true;
}

async function writeFixedPreview({ ffmpeg, originalPreviewPath, fixedPreviewPath, insertAtMs, deltaMs }) {
  const probe = await ffmpeg.probe(originalPreviewPath);
  const layout = Number(probe.channels) === 1 ? 'mono' : 'stereo';
  const insertSec = Math.max(0, Number(insertAtMs)) / 1000;
  const deltaSec = Math.max(1, Number(deltaMs)) / 1000;
  const filter = [
    `[0:a]atrim=start=0:end=${insertSec.toFixed(6)},asetpts=PTS-STARTPTS[a0]`,
    `anullsrc=r=44100:cl=${layout}:d=${deltaSec.toFixed(6)}[silence]`,
    `[0:a]atrim=start=${insertSec.toFixed(6)},asetpts=PTS-STARTPTS[a1]`,
    '[a0][silence][a1]concat=n=3:v=0:a=1[out]'
  ].join(';');
  await ffmpeg.execFile(ffmpeg.ffmpegPath, [
    '-y', '-hide_banner', '-loglevel', 'error', '-i', originalPreviewPath,
    '-filter_complex', filter, '-map', '[out]', '-c:a', 'pcm_s24le', '-ar', '44100', fixedPreviewPath
  ], { maxBuffer: 8 * 1024 * 1024 });
}

export async function prepareBookOneHumanPauseReview({ audit, outDir, ffmpeg = new FfmpegAdapter(), audioSearchRoots = [] } = {}) {
  const plan = buildBookOneHumanPauseReviewPlan(audit);
  const health = await ffmpeg.healthCheck();
  if (!health?.ok) throw new Error(`Human Pause Review requires local FFmpeg + FFprobe: ${health?.reason ?? 'health check failed'}`);
  const root = path.resolve(outDir ?? '');
  if (!root) throw new Error('Human Pause Review requires an output directory');
  const previewDir = path.join(root, 'previews');
  await mkdir(previewDir, { recursive: true });
  const previewRows = [];
  const resolvedByChapter = new Map();

  for (const candidate of plan.candidates) {
    const sourceKey = `${candidate.chapterNumber}:${candidate.sourceAudioDigest}`;
    let resolvedSource = resolvedByChapter.get(sourceKey);
    if (!resolvedSource) {
      resolvedSource = await resolveBookOnePauseSourceAudio({
        storedPath: candidate.sourceAudioFile,
        expectedDigest: candidate.sourceAudioDigest,
        chapterNumber: candidate.chapterNumber,
        searchRoots: audioSearchRoots
      });
      resolvedByChapter.set(sourceKey, resolvedSource);
    }
    if (!Number.isFinite(candidate.silenceStartMs) || !Number.isFinite(candidate.silenceEndMs)) continue;
    const startMs = Math.max(0, candidate.silenceStartMs - BOOK_ONE_HUMAN_PAUSE_REVIEW_POLICY.previewBeforeMs);
    const endMs = Math.min(candidate.sourceDurationMs, candidate.silenceEndMs + BOOK_ONE_HUMAN_PAUSE_REVIEW_POLICY.previewAfterMs);
    const stem = `chapter-${String(candidate.chapterNumber).padStart(2, '0')}-boundary-${String(candidate.boundaryOrdinal + 1).padStart(3, '0')}-${safeSlug(candidate.kind)}`;
    const originalFile = path.join(previewDir, `${stem}-original.wav`);
    await ffmpeg.extract(resolvedSource.file, { startMs, endMs, outputPath: originalFile });
    let fixedFile = null;
    if (candidate.classification === 'LOCAL_REPAIR_SAFE' && Number(candidate.proposedDeltaMs) > 0) {
      fixedFile = path.join(previewDir, `${stem}-preview-fix.wav`);
      const insertAtMs = candidate.silenceEndMs - startMs;
      await writeFixedPreview({ ffmpeg, originalPreviewPath: originalFile, fixedPreviewPath: fixedFile, insertAtMs, deltaMs: candidate.proposedDeltaMs });
    }
    previewRows.push(freeze({
      chapterNumber: candidate.chapterNumber,
      boundaryOrdinal: candidate.boundaryOrdinal,
      originalRelativePath: path.relative(root, originalFile).split(path.sep).join('/'),
      fixedRelativePath: fixedFile ? path.relative(root, fixedFile).split(path.sep).join('/') : null,
      previewStartMs: round(startMs),
      previewEndMs: round(endMs),
      sourceAudioDigest: candidate.sourceAudioDigest,
      sourceAuditAudioFile: candidate.sourceAudioFile,
      resolvedSourceAudioFile: resolvedSource.file,
      sourceAudioRelocated: resolvedSource.relocated,
      sourceAudioResolution: resolvedSource.resolution
    }));
  }

  const manifest = freeze({
    schemaVersion: 1,
    release: YASREADY_AUDIOBOOKS_VERSION,
    artifact: 'book-one-human-pause-review-preview-manifest',
    sourceAuditDigest: audit.integrity.auditDigest,
    generatedAt: new Date().toISOString(),
    previews: freeze(previewRows),
    summary: freeze({
      originalPreviewClips: previewRows.length,
      fixedPreviewClips: previewRows.filter((row) => row.fixedRelativePath).length,
      providerTtsCallsPerformed: 0,
      providerSpendUsd: 0,
      sourceAudioWritesPerformed: 0,
      derivativePreviewWritesPerformed: previewRows.length + previewRows.filter((row) => row.fixedRelativePath).length,
      relocatedSourceAudioFiles: new Set(previewRows.filter((row) => row.sourceAudioRelocated).map((row) => row.resolvedSourceAudioFile)).size
    }),
    guardrails: freeze({
      sourceAudioImmutable: true,
      previewClipsAreDerivativeOnly: true,
      previewDoesNotAuthorizeRepair: true,
      providerRegenerationAuthorized: false,
      providerTtsCallsPerformed: 0,
      chapterElevenMayBeGenerated: false,
      nextBatchArmed: false,
      fullBookGenerationArmed: false
    })
  });
  return freeze({ plan, manifest });
}

export function buildBookOnePauseRepairPlan({ audit, review } = {}) {
  verifyBookOnePauseDeficitAudit(audit);
  verifyBookOneHumanPauseReview(review, audit);
  const approved = (review.decisions ?? []).filter((row) => row.decision === 'APPROVE_LOCAL_REPAIR');
  const chapters = new Map();
  for (const row of approved) {
    const { chapter, boundary } = auditBoundary(audit, row.chapterNumber, row.boundaryOrdinal);
    if (boundary.classification !== 'LOCAL_REPAIR_SAFE' || boundary.repairReady !== true) {
      throw new Error(`Approved boundary ${row.chapterNumber}:${row.boundaryOrdinal} is not repair-safe`);
    }
    if (!Number.isFinite(Number(boundary.silenceStartMs)) || !Number.isFinite(Number(boundary.silenceEndMs)) || !(Number(boundary.deficitMs) > 0)) {
      throw new Error(`Approved boundary ${row.chapterNumber}:${row.boundaryOrdinal} is missing exact local silence coordinates`);
    }
    const list = chapters.get(Number(row.chapterNumber)) ?? [];
    list.push(freeze({
      chapterNumber: Number(row.chapterNumber),
      boundaryOrdinal: Number(row.boundaryOrdinal),
      kind: boundary.kind,
      silenceStartMs: Number(boundary.silenceStartMs),
      silenceEndMs: Number(boundary.silenceEndMs),
      actualSilenceMs: Number(boundary.actualSilenceMs),
      minimumTotalSilenceMs: Number(boundary.minimumTotalSilenceMs),
      deltaMs: Math.max(1, Math.ceil(Number(boundary.deficitMs))),
      localizationConfidence: Number(boundary.localizationConfidence),
      sourceAudioFile: chapter.audio.file,
      sourceAudioDigest: chapter.audio.digest,
      sourceDurationMs: Number(chapter.audio.durationMs)
    }));
    chapters.set(Number(row.chapterNumber), list);
  }
  const chapterPlans = [...chapters.entries()].map(([chapterNumber, repairs]) => freeze({
    chapterNumber,
    repairs: freeze(repairs.sort((a, b) => a.silenceEndMs - b.silenceEndMs))
  })).sort((a, b) => a.chapterNumber - b.chapterNumber);
  return freeze({
    sourceAuditDigest: audit.integrity.auditDigest,
    sourceReviewDigest: review.integrity.reviewDigest,
    approvedRepairs: approved.length,
    chapters: freeze(chapterPlans)
  });
}

async function createSilenceWav(ffmpeg, outputPath, durationMs, channels) {
  const layout = Number(channels) === 1 ? 'mono' : 'stereo';
  await ffmpeg.execFile(ffmpeg.ffmpegPath, [
    '-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi',
    '-i', `anullsrc=r=44100:cl=${layout}`, '-t', (Number(durationMs) / 1000).toFixed(6),
    '-c:a', 'pcm_s24le', '-ar', '44100', outputPath
  ], { maxBuffer: 8 * 1024 * 1024 });
}

function nearestSilence(silences, expectedMidpointMs) {
  return [...(silences ?? [])]
    .map((row) => ({ row, distance: Math.abs(((Number(row.startMs) + Number(row.endMs)) / 2) - expectedMidpointMs) }))
    .sort((a, b) => a.distance - b.distance)[0]?.row ?? null;
}

export async function applyBookOneApprovedPauseRepairs({ audit, review, outDir, ffmpeg = new FfmpegAdapter(), audioSearchRoots = [] } = {}) {
  const repairPlan = buildBookOnePauseRepairPlan({ audit, review });
  if (repairPlan.approvedRepairs < 1) throw new Error('No APPROVE_LOCAL_REPAIR decisions are present; nothing will be written');
  const health = await ffmpeg.healthCheck();
  if (!health?.ok) throw new Error(`Pause repair requires local FFmpeg + FFprobe: ${health?.reason ?? 'health check failed'}`);
  const root = path.resolve(outDir ?? '');
  if (!root) throw new Error('Pause repair requires an output directory');
  const repairedDir = path.join(root, 'repaired-audio');
  await mkdir(repairedDir, { recursive: true });
  const chapterResults = [];

  for (const chapterPlan of repairPlan.chapters) {
    const first = chapterPlan.repairs[0];
    const resolvedSource = await resolveBookOnePauseSourceAudio({
      storedPath: first.sourceAudioFile,
      expectedDigest: first.sourceAudioDigest,
      chapterNumber: chapterPlan.chapterNumber,
      searchRoots: audioSearchRoots
    });
    const sourceFile = resolvedSource.file;
    const probe = await ffmpeg.probe(sourceFile);
    const temp = await mkdtemp(path.join(tmpdir(), `yasready-pause-repair-ch${chapterPlan.chapterNumber}-`));
    const outputFile = path.join(repairedDir, `chapter-${String(chapterPlan.chapterNumber).padStart(2, '0')}-pause-repaired.mp3`);
    try {
      const parts = [];
      let cursorMs = 0;
      for (let index = 0; index < chapterPlan.repairs.length; index += 1) {
        const repair = chapterPlan.repairs[index];
        const insertionMs = Number(repair.silenceEndMs);
        if (insertionMs <= cursorMs || insertionMs >= first.sourceDurationMs) throw new Error(`Invalid repair insertion coordinate for Chapter ${chapterPlan.chapterNumber}`);
        const segment = path.join(temp, `segment-${String(parts.length).padStart(3, '0')}.wav`);
        await ffmpeg.extract(sourceFile, { startMs: cursorMs, endMs: insertionMs, outputPath: segment });
        parts.push(segment);
        const silence = path.join(temp, `silence-${String(index).padStart(3, '0')}.wav`);
        await createSilenceWav(ffmpeg, silence, repair.deltaMs, probe.channels);
        parts.push(silence);
        cursorMs = insertionMs;
      }
      if (cursorMs < first.sourceDurationMs) {
        const tail = path.join(temp, `segment-${String(parts.length).padStart(3, '0')}.wav`);
        await ffmpeg.extract(sourceFile, { startMs: cursorMs, endMs: first.sourceDurationMs, outputPath: tail });
        parts.push(tail);
      }
      const combined = path.join(temp, 'combined.wav');
      await ffmpeg.concat(parts, combined);
      const bitrate = Number(probe.bitrateKbps) > 0 ? Number(probe.bitrateKbps) : 128;
      await ffmpeg.execFile(ffmpeg.ffmpegPath, [
        '-y', '-hide_banner', '-loglevel', 'error', '-i', combined,
        '-c:a', 'libmp3lame', '-ar', '44100', '-b:a', `${Math.round(bitrate)}k`, outputFile
      ], { maxBuffer: 16 * 1024 * 1024 });

      const detection = await ffmpeg.detectSilences(outputFile, {
        noiseDb: Number(audit.policy?.silenceNoiseDb ?? -50),
        minDurationMs: Number(audit.policy?.silenceDetectionMinMs ?? 60)
      });
      let cumulativeBefore = 0;
      const verifiedRepairs = [];
      for (const repair of chapterPlan.repairs) {
        const expectedMidpoint = ((repair.silenceStartMs + repair.silenceEndMs) / 2) + cumulativeBefore + (repair.deltaMs / 2);
        const measured = nearestSilence(detection.silences, expectedMidpoint);
        if (!measured) throw new Error(`Post-repair waveform verification could not relocalize Chapter ${chapterPlan.chapterNumber} boundary ${repair.boundaryOrdinal + 1}`);
        const requiredFloor = repair.minimumTotalSilenceMs - BOOK_ONE_HUMAN_PAUSE_REVIEW_POLICY.repairVerificationToleranceMs;
        if (Number(measured.durationMs) < requiredFloor) {
          throw new Error(`Post-repair verification failed Chapter ${chapterPlan.chapterNumber} boundary ${repair.boundaryOrdinal + 1}: measured ${Math.round(measured.durationMs)} ms, required at least ${Math.round(requiredFloor)} ms`);
        }
        verifiedRepairs.push(freeze({
          boundaryOrdinal: repair.boundaryOrdinal,
          kind: repair.kind,
          addedSilenceMs: repair.deltaMs,
          targetMinimumSilenceMs: repair.minimumTotalSilenceMs,
          measuredSilenceMs: round(measured.durationMs),
          verified: true
        }));
        cumulativeBefore += repair.deltaMs;
      }
      const outputDigest = await fileDigest(outputFile);
      chapterResults.push(freeze({
        chapterNumber: chapterPlan.chapterNumber,
        sourceAudioFile: sourceFile,
        sourceAuditAudioFile: first.sourceAudioFile,
        sourceAudioRelocated: resolvedSource.relocated,
        sourceAudioResolution: resolvedSource.resolution,
        sourceAudioDigest: first.sourceAudioDigest,
        repairedAudioFile: outputFile,
        repairedAudioRelativePath: path.relative(root, outputFile).split(path.sep).join('/'),
        repairedAudioDigest: outputDigest,
        repairs: freeze(verifiedRepairs),
        providerTtsCallsPerformed: 0,
        providerSpendUsd: 0
      }));
    } catch (error) {
      await rm(outputFile, { force: true });
      throw error;
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  }

  const base = {
    schemaVersion: 1,
    release: YASREADY_AUDIOBOOKS_VERSION,
    artifact: 'book-one-approved-local-pause-repair-result',
    status: 'APPROVED_LOCAL_PAUSE_REPAIRS_APPLIED_AND_VERIFIED',
    source: freeze({
      auditDigest: audit.integrity.auditDigest,
      reviewDigest: review.integrity.reviewDigest,
      manuscriptSourceHash: audit.source?.manuscriptSourceHash ?? null
    }),
    summary: freeze({
      chaptersRepaired: chapterResults.length,
      boundariesRepaired: chapterResults.reduce((sum, chapter) => sum + chapter.repairs.length, 0),
      boundariesVerified: chapterResults.reduce((sum, chapter) => sum + chapter.repairs.filter((row) => row.verified).length, 0),
      providerTtsCallsPerformed: 0,
      providerSpendUsd: 0,
      sourceAudioFilesOverwritten: 0,
      relocatedSourceAudioFiles: chapterResults.filter((row) => row.sourceAudioRelocated).length
    }),
    chapters: freeze(chapterResults),
    guardrails: freeze({
      explicitHumanApprovalRequired: true,
      onlyLocalRepairSafeApplied: true,
      sourceAudioImmutable: true,
      canonicalTextImmutable: true,
      providerRegenerationAuthorized: false,
      providerTtsCallsPerformed: 0,
      providerSpendUsd: 0,
      postRepairWaveformVerificationRequired: true,
      allAppliedRepairsVerified: true,
      chapterElevenMayBeGenerated: false,
      nextBatchArmed: false,
      fullBookGenerationArmed: false
    })
  };
  return freeze({ ...base, integrity: freeze({ repairResultDigest: sha256(stableJson(repairResultCore(base))) }) });
}

export function verifyBookOneApprovedPauseRepairResult(result) {
  if (!result || result.artifact !== 'book-one-approved-local-pause-repair-result') throw new Error('Invalid Book One local pause repair result');
  if (result.status !== 'APPROVED_LOCAL_PAUSE_REPAIRS_APPLIED_AND_VERIFIED') throw new Error('Pause repair result status invalid');
  if (result.guardrails?.explicitHumanApprovalRequired !== true || result.guardrails?.onlyLocalRepairSafeApplied !== true ||
      result.guardrails?.sourceAudioImmutable !== true || result.guardrails?.providerTtsCallsPerformed !== 0 ||
      result.guardrails?.postRepairWaveformVerificationRequired !== true || result.guardrails?.allAppliedRepairsVerified !== true ||
      result.guardrails?.chapterElevenMayBeGenerated !== false || result.guardrails?.nextBatchArmed !== false ||
      result.guardrails?.fullBookGenerationArmed !== false) {
    throw new Error('Pause repair result guardrails drifted');
  }
  if (!result.integrity?.repairResultDigest || sha256(stableJson(repairResultCore(result))) !== result.integrity.repairResultDigest) {
    throw new Error('Pause repair result digest mismatch');
  }
  return true;
}

function jsonForScript(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

export function renderBookOneHumanPauseReviewHtml({ audit, previewManifest, serverMode = false } = {}) {
  verifyBookOnePauseDeficitAudit(audit);
  const plan = buildBookOneHumanPauseReviewPlan(audit);
  const previews = new Map((previewManifest?.previews ?? []).map((row) => [decisionKey(row.chapterNumber, row.boundaryOrdinal), row]));
  const cards = plan.candidates.map((candidate) => {
    const preview = previews.get(decisionKey(candidate.chapterNumber, candidate.boundaryOrdinal));
    const local = candidate.classification === 'LOCAL_REPAIR_SAFE';
    const statusText = local ? `Needs +${Math.round(candidate.proposedDeltaMs ?? 0)} ms pause` : 'Human confirmation required';
    const originalUrl = preview?.originalRelativePath ? `${serverMode ? '/files/' : './'}${preview.originalRelativePath}` : null;
    const fixedUrl = preview?.fixedRelativePath ? `${serverMode ? '/files/' : './'}${preview.fixedRelativePath}` : null;
    const listenOriginal = originalUrl ? `<button class="secondary listen" data-src="${htmlEscape(originalUrl)}">Play Original</button>` : '<button class="secondary" disabled>Original unavailable</button>';
    const previewFix = fixedUrl ? `<button class="secondary listen" data-src="${htmlEscape(fixedUrl)}">Preview Fix</button>` : '';
    const approve = local ? '<button class="decision approve" data-decision="APPROVE_LOCAL_REPAIR">Approve Fix</button>' : '';
    return `<article class="reviewCard" data-key="${candidate.chapterNumber}:${candidate.boundaryOrdinal}" data-chapter="${candidate.chapterNumber}" data-boundary="${candidate.boundaryOrdinal}">
      <div class="cardTop"><div><div class="eyebrow">Chapter ${candidate.chapterNumber}</div><h3>${htmlEscape(candidate.humanLabel)}</h3><div class="recommendation">${htmlEscape(statusText)}</div></div><div class="confidence">${Math.round(candidate.localizationConfidence * 100)}% confidence</div></div>
      <div class="numbers"><div><span>Current</span><b>${candidate.actualSilenceMs == null ? '—' : `${Math.round(candidate.actualSilenceMs)} ms`}</b></div><div><span>Target</span><b>${Math.round(candidate.minimumTotalSilenceMs)} ms</b></div><div><span>Recommended</span><b>${candidate.proposedDeltaMs == null ? 'Review' : `+${Math.round(candidate.proposedDeltaMs)} ms`}</b></div></div>
      <div class="actions audioActions">${listenOriginal}${previewFix}</div>
      <div class="actions decisionActions">${approve}<button class="decision" data-decision="LEAVE_AS_IS">Leave As-Is</button><button class="decision warn" data-decision="NEEDS_REVIEW">Needs Review</button></div>
      <label class="noteLabel">Optional note<textarea placeholder="What did you hear?" maxlength="4000"></textarea></label>
      <div class="saveState" aria-live="polite">Not decided</div>
      <details><summary>Technical details</summary><dl><dt>Classification</dt><dd>${htmlEscape(candidate.classification)}</dd><dt>Boundary</dt><dd>${htmlEscape(candidate.kind)}</dd><dt>Localized time</dt><dd>${candidate.localizedTimestampMs == null ? '—' : `${(candidate.localizedTimestampMs / 1000).toFixed(3)} s`}</dd><dt>Source digest</dt><dd class="mono">${htmlEscape(candidate.sourceAudioDigest)}</dd></dl></details>
    </article>`;
  }).join('');
  const unresolved = plan.unresolved.map((row) => `<li>Chapter ${row.chapterNumber} · ${htmlEscape(row.humanLabel)} · ${Math.round(row.localizationConfidence * 100)}% confidence</li>`).join('');
  const payload = jsonForScript({ auditDigest: audit.integrity.auditDigest, plan, serverMode });
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>YasReady — Human Pause Review</title><style>
  :root{color-scheme:dark;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","Helvetica Neue",sans-serif;background:#08090b;color:#f5f5f7}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 20% 0,#20222a 0,#0a0b0e 45%,#07080a 100%);min-height:100vh;padding:28px}.wrap{max-width:1180px;margin:auto}.hero,.reviewCard,.collapsed{background:rgba(19,20,24,.88);border:1px solid #2b2d35;box-shadow:0 20px 60px rgba(0,0,0,.28);backdrop-filter:blur(18px)}.hero{border-radius:30px;padding:32px}.eyebrow{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#a0a4b0}h1{font-size:42px;line-height:1.05;margin:7px 0 10px}h2{margin:26px 0 12px}h3{font-size:23px;margin:4px 0 5px}.lede,.muted{color:#aeb2bd;line-height:1.5}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:22px}.metric{padding:15px;border-radius:18px;background:#111217;border:1px solid #292b33}.metric b{font-size:27px;display:block}.metric span{font-size:12px;color:#9ba0ac}.safety{margin-top:15px;padding:13px 15px;border-radius:16px;border:1px solid #23452f;background:#0e1b13;color:#c3f5d0}.reviewCard{margin-top:14px;border-radius:24px;padding:22px}.cardTop{display:flex;justify-content:space-between;gap:20px}.recommendation{color:#d1d4dc}.confidence{align-self:start;font-size:12px;border:1px solid #3a3d47;border-radius:999px;padding:7px 10px;color:#c9ccd5}.numbers{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:18px 0}.numbers div{padding:13px 14px;background:#0e0f12;border:1px solid #282a31;border-radius:15px}.numbers span{display:block;font-size:11px;color:#959aa6;text-transform:uppercase;letter-spacing:.08em}.numbers b{display:block;font-size:20px;margin-top:3px}.actions{display:flex;gap:9px;flex-wrap:wrap}.audioActions{margin-bottom:10px}button{font:inherit;cursor:pointer;border-radius:12px;border:1px solid #3c3f49;padding:10px 14px;background:#24262d;color:#fff}button:hover{background:#30333c}button:disabled{opacity:.45;cursor:not-allowed}.approve{background:#0f5d36;border-color:#217a4d}.approve:hover{background:#167043}.warn{border-color:#755f27}.selected{outline:2px solid #f5f5f7;outline-offset:2px}.noteLabel{display:block;margin-top:14px;color:#aeb2bd;font-size:12px}textarea{display:block;width:100%;min-height:72px;margin-top:7px;border-radius:14px;border:1px solid #30333b;background:#0d0e11;color:#f5f5f7;padding:11px;resize:vertical;font:inherit}.saveState{font-size:12px;color:#8f95a2;margin-top:8px}.saveState.ok{color:#8ce3ad}.saveState.error{color:#ff9e9e}details{margin-top:13px;color:#aeb2bd}summary{cursor:pointer}dl{display:grid;grid-template-columns:max-content 1fr;gap:6px 12px;font-size:12px}.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;word-break:break-all}.collapsed{margin:18px 0 100px;padding:18px 20px;border-radius:20px}.toolbar{display:flex;gap:10px;flex-wrap:wrap;margin-top:18px}.primary{background:#f5f5f7;color:#111;border-color:#f5f5f7;font-weight:700}.primary:hover{background:#ddd}.statusBanner{margin-top:14px;font-size:13px;color:#aeb2bd}.statusBanner.ok{color:#8ce3ad}.statusBanner.error{color:#ff9e9e}.repairList audio{width:100%;margin-top:8px}@media(max-width:760px){body{padding:14px}.hero{padding:22px}h1{font-size:32px}.metrics{grid-template-columns:repeat(2,1fr)}.numbers{grid-template-columns:1fr}.cardTop{display:block}.confidence{display:inline-block;margin-top:8px}}</style></head><body><main class="wrap"><section class="hero"><div class="eyebrow">YasReady Audiobooks ${htmlEscape(YASREADY_AUDIOBOOKS_VERSION)}</div><h1>Human Pause Review</h1><p class="lede">Hear the exact boundary, compare a local silence-only preview when it is safe, and make an explicit decision. Listening never counts as approval.</p><div class="metrics"><div class="metric"><b>${plan.summary.localRepairSafe}</b><span>safe local repairs</span></div><div class="metric"><b>${plan.summary.surgicalManual}</b><span>manual confirmation</span></div><div class="metric"><b>${plan.summary.unresolved}</b><span>unresolved</span></div><div class="metric"><b>${plan.summary.passNoChange}</b><span>already pass</span></div></div><div class="safety">Source MP3s stay untouched · Preview clips are local derivatives only · 0 provider calls · 0 TTS · Chapter 11 remains OFF</div><div class="toolbar"><button id="downloadReview" class="secondary">Export Human Review JSON</button>${serverMode ? '<button id="applyRepairs" class="primary">Apply Approved Fixes</button>' : ''}</div><div id="globalStatus" class="statusBanner">${serverMode ? 'Autosave is active through the local YasReady review server.' : 'Static mode: decisions are saved in this browser when possible; export JSON before closing.'}</div><div id="repairList" class="repairList"></div></section><h2>Action Queue</h2>${cards || '<p class="muted">No actionable pause boundaries.</p>'}<details class="collapsed"><summary>${plan.summary.unresolved} boundaries YasReady could not safely localize</summary><p class="muted">These remain human-review items and can never quietly become automatic edits.</p><ul>${unresolved || '<li>None</li>'}</ul></details></main><script id="payload" type="application/json">${payload}</script><script>
  const cfg=JSON.parse(document.getElementById('payload').textContent);const state=new Map();let activeAudio=null;const status=document.getElementById('globalStatus');
  function key(ch,b){return ch+':'+b} function cards(){return [...document.querySelectorAll('.reviewCard')]} function setStatus(msg,kind=''){status.textContent=msg;status.className='statusBanner '+kind}
  function localLoad(){try{return JSON.parse(localStorage.getItem('yasready.pauseReview.'+cfg.auditDigest)||'{}')}catch{return {}}} function localSave(obj){try{localStorage.setItem('yasready.pauseReview.'+cfg.auditDigest,JSON.stringify(obj));return true}catch{return false}}
  function hydrate(review){const rows=review?.decisions||[];for(const row of rows){state.set(key(row.chapterNumber,row.boundaryOrdinal),row)}for(const card of cards()){const k=card.dataset.key,row=state.get(k);if(!row)continue;card.querySelector('textarea').value=row.note||'';for(const btn of card.querySelectorAll('.decision'))btn.classList.toggle('selected',btn.dataset.decision===row.decision);const s=card.querySelector('.saveState');s.textContent=row.decision?('Saved: '+row.decision.replaceAll('_',' ')):'Note saved';s.className='saveState ok'}}
  async function loadServerState(){if(!cfg.serverMode)return false;try{const r=await fetch('/api/state');if(!r.ok)throw new Error(await r.text());const body=await r.json();hydrate(body.review);if(body.repairResult)showRepairResult(body.repairResult);return true}catch(e){setStatus('Autosave server unavailable: '+e.message,'error');return false}}
  async function saveDecision(card,decision,note){const ch=Number(card.dataset.chapter),b=Number(card.dataset.boundary),s=card.querySelector('.saveState');s.textContent='Saving…';s.className='saveState';if(cfg.serverMode){try{const r=await fetch('/api/decision',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chapterNumber:ch,boundaryOrdinal:b,decision,note})});if(!r.ok)throw new Error(await r.text());const review=await r.json();state.clear();hydrate(review);setStatus('Human review autosaved. Listening and previews still do not count as approval.','ok');return}catch(e){s.textContent='Save failed: '+e.message;s.className='saveState error';setStatus('Autosave failed. Export before closing.','error')}}const obj=localLoad();obj[key(ch,b)]={chapterNumber:ch,boundaryOrdinal:b,decision,note,decidedAt:new Date().toISOString()};localSave(obj);state.set(key(ch,b),obj[key(ch,b)]);hydrate({decisions:[...state.values()]})}
  for(const btn of document.querySelectorAll('.listen'))btn.addEventListener('click',()=>{if(activeAudio){activeAudio.pause();activeAudio=null}activeAudio=new Audio(btn.dataset.src);activeAudio.play().catch(e=>setStatus('Could not play preview: '+e.message,'error'))});
  for(const card of cards()){const note=card.querySelector('textarea');let noteTimer=null;note.addEventListener('input',()=>{clearTimeout(noteTimer);noteTimer=setTimeout(()=>{const row=state.get(card.dataset.key);saveDecision(card,row?.decision||null,note.value)},450)});for(const btn of card.querySelectorAll('.decision'))btn.addEventListener('click',()=>saveDecision(card,btn.dataset.decision,note.value))}
  document.getElementById('downloadReview').addEventListener('click',async()=>{let review=null;if(cfg.serverMode){try{const r=await fetch('/api/state');review=(await r.json()).review}catch{}}if(!review){const rows=[...state.values()];review={schemaVersion:1,release:'${YASREADY_AUDIOBOOKS_VERSION}',artifact:'book-one-human-pause-review-browser-export',source:{auditDigest:cfg.auditDigest},decisions:rows,notice:'Static-browser export. Run through YasReady serve mode for server-signed review integrity before applying repairs.'}}const blob=new Blob([JSON.stringify(review,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='book-one-human-pause-review.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)});
  function showRepairResult(result){const box=document.getElementById('repairList');if(!result)return;box.innerHTML='<h2>Verified repaired derivatives</h2>'+result.chapters.map(ch=>'<div class="reviewCard"><b>Chapter '+ch.chapterNumber+'</b><div class="muted">'+ch.repairs.length+' approved pause repair(s), waveform verified.</div><audio controls src="/files/'+ch.repairedAudioRelativePath+'"></audio></div>').join('')}
  const apply=document.getElementById('applyRepairs');if(apply)apply.addEventListener('click',async()=>{apply.disabled=true;setStatus('Applying only explicitly approved LOCAL_REPAIR_SAFE fixes…');try{const r=await fetch('/api/apply',{method:'POST'});const text=await r.text();if(!r.ok)throw new Error(text);const result=JSON.parse(text);showRepairResult(result);setStatus('Approved fixes applied to new derivative copies and waveform-verified. Originals are untouched.','ok')}catch(e){setStatus('Repair blocked: '+e.message,'error')}finally{apply.disabled=false}});
  (async()=>{if(!(await loadServerState())){const local=localLoad();hydrate({decisions:Object.values(local)})}})();
</script></body></html>`;
}

export function renderBookOnePauseRepairResultMarkdown(result) {
  verifyBookOneApprovedPauseRepairResult(result);
  const lines = ['# Book One — Approved Local Pause Repair Result', '', `**Status:** ${result.status}`, `**Release:** ${result.release}`, '', `- Chapters repaired: **${result.summary.chaptersRepaired}**`, `- Boundaries repaired: **${result.summary.boundariesRepaired}**`, `- Boundaries waveform-verified: **${result.summary.boundariesVerified}**`, '- Provider/TTS calls: **0**', '- Source audio overwritten: **0**', '- Chapter 11: **OFF**', ''];
  for (const chapter of result.chapters) {
    lines.push(`## Chapter ${chapter.chapterNumber}`, '', `Repaired derivative: \`${chapter.repairedAudioFile}\``, '');
    for (const repair of chapter.repairs) lines.push(`- Boundary ${repair.boundaryOrdinal + 1} (${repair.kind}): +${repair.addedSilenceMs} ms → measured ${Math.round(repair.measuredSilenceMs)} ms (target ${repair.targetMinimumSilenceMs} ms) ✅`);
    lines.push('');
  }
  return lines.join('\n');
}
