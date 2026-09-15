import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { homedir } from 'node:os';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import {
  YASREADY_AUDIOBOOKS_VERSION,
  sha256,
  verifyBookOnePauseDeficitAudit,
  verifyBookOneCinematicRebuildResult,
  inspectBookOnePauseAudio,
  relocalizeBookOnePauseDeficitAudit,
  renderBookOnePauseDeficitAuditMarkdown,
  renderBookOnePauseDeficitAuditHtml,
  buildRecoveredCinematicResultFromState
} from './index.js';

const execFile = promisify(execFileCb);
const args = process.argv.slice(2);
const command = args[0];

function flag(name, fallback = null) {
  const index = args.indexOf(name);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : fallback;
}

async function exists(file) {
  try { await stat(file); return true; } catch { return false; }
}

async function json(file) {
  return JSON.parse(await readFile(path.resolve(file), 'utf8'));
}

async function digest(file) {
  return sha256((await readFile(file)).toString('base64'));
}

function unique(values) {
  return [...new Set(values.filter(Boolean).map((value) => path.resolve(String(value))))];
}

async function boundedCommand(commandName, commandArgs, timeoutMs) {
  try {
    const { stdout } = await execFile(commandName, commandArgs, {
      timeout: timeoutMs,
      killSignal: 'SIGKILL',
      maxBuffer: 16 * 1024 * 1024
    });
    return String(stdout ?? '').split('\n').map((row) => row.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

async function discoverExactName(name) {
  const found = [];
  const add = (value) => { if (value) found.push(path.resolve(value)); };

  if (process.platform === 'darwin') {
    const escaped = String(name).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    for (const row of await boundedCommand('mdfind', [`kMDItemFSName == "${escaped}"c`], 3000)) add(row);
  }

  const home = homedir();
  const fastRoots = [
    path.join(home, 'Desktop'),
    path.join(home, 'Downloads'),
    path.join(home, 'Documents')
  ];

  for (const root of fastRoots) {
    if (!(await exists(root))) continue;
    for (const row of await boundedCommand('/usr/bin/find', [root, '-type', 'f', '-name', name], 2500)) add(row);
  }

  if (await exists(home)) {
    for (const row of await boundedCommand('/usr/bin/find', [home, '-type', 'f', '-name', name], 6000)) add(row);
  }

  if (await exists('/Volumes')) {
    for (const row of await boundedCommand('/usr/bin/find', ['/Volumes', '-type', 'f', '-name', name], 5000)) add(row);
  }

  return unique(found);
}

function safeResolve(root, relative) {
  const base = path.resolve(root);
  const resolved = path.resolve(base, relative);
  if (resolved !== base && !resolved.startsWith(`${base}${path.sep}`)) {
    throw new Error(`Current cinematic audio path escapes candidate root: ${relative}`);
  }
  return resolved;
}

function deriveRootFromLocatedFile(file, relative) {
  const segments = path.normalize(relative).split(path.sep).filter(Boolean);
  let root = path.resolve(file);
  for (let i = 0; i < segments.length; i += 1) root = path.dirname(root);
  return root;
}

async function candidateRootsForResult(resultFile, result, explicitAudioRoot = null) {
  const roots = [];
  if (explicitAudioRoot) roots.push(explicitAudioRoot);
  if (result.source?.outputRoot) roots.push(result.source.outputRoot);

  let current = path.dirname(path.resolve(resultFile));
  for (let i = 0; i < 6; i += 1) {
    roots.push(current);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  const first = [...(result.chapters ?? [])]
    .sort((a, b) => Number(a.chapterNumber) - Number(b.chapterNumber))[0];
  const rel = first?.outputs?.directMp3;
  if (rel) {
    const basename = path.basename(rel);
    for (const located of await discoverExactName(basename)) {
      roots.push(deriveRootFromLocatedFile(located, rel));
    }
  }
  return unique(roots);
}

async function verifyResultAudioRoot(result, root) {
  const chapters = [...(result.chapters ?? [])]
    .filter((row) => Number(row.chapterNumber) >= 1 && Number(row.chapterNumber) <= 10)
    .sort((a, b) => Number(a.chapterNumber) - Number(b.chapterNumber));

  if (chapters.length !== 10) return { ok: false, reason: `result has ${chapters.length}/10 chapters` };

  for (const chapter of chapters) {
    const rel = chapter.outputs?.directMp3;
    const expected = chapter.digests?.directMp3;
    if (!rel || !expected) {
      return { ok: false, reason: `Chapter ${chapter.chapterNumber} lacks Direct MP3 lineage` };
    }

    let file;
    try { file = safeResolve(root, rel); }
    catch (error) { return { ok: false, reason: error.message }; }

    if (!(await exists(file))) {
      return { ok: false, reason: `Chapter ${chapter.chapterNumber} missing under candidate root` };
    }

    const actual = await digest(file);
    if (actual !== expected) {
      return { ok: false, reason: `Chapter ${chapter.chapterNumber} Direct MP3 digest mismatch` };
    }
  }

  return { ok: true };
}

function lineageReason(priorAudit, result) {
  if (result.progress?.allTenComplete !== true || (result.chapters ?? []).length !== 10) {
    return 'not a complete ten-chapter result';
  }
  if (result.source?.productionPlanDigest !== priorAudit.source?.productionPlanDigest) {
    return 'production-plan digest does not match prior audit';
  }
  if (result.cinematicLockDigest !== priorAudit.source?.cinematicLockDigest) {
    return 'cinematic-lock digest does not match prior audit';
  }
  if (result.book?.sourceHash !== priorAudit.source?.manuscriptSourceHash) {
    return 'manuscript source hash does not match prior audit';
  }
  return null;
}

async function discoverResultSources(priorAudit, explicitResult, explicitAudioRoot) {
  const files = explicitResult
    ? [path.resolve(explicitResult)]
    : await discoverExactName('cinematic-rebuild-result.json');

  const diagnostics = [];
  const valid = [];

  for (const file of files) {
    try {
      const result = await json(file);
      verifyBookOneCinematicRebuildResult(result);

      const lineage = lineageReason(priorAudit, result);
      if (lineage) {
        diagnostics.push({ file, accepted: false, reason: lineage });
        continue;
      }

      const roots = await candidateRootsForResult(file, result, explicitAudioRoot);
      let matchedRoot = null;
      const rootDiagnostics = [];

      for (const root of roots) {
        const check = await verifyResultAudioRoot(result, root);
        rootDiagnostics.push({ root, ...check });
        if (check.ok) {
          matchedRoot = root;
          break;
        }
      }

      if (!matchedRoot) {
        diagnostics.push({
          file,
          accepted: false,
          reason: 'no root contains all 10 digest-matching Direct MP3s',
          roots: rootDiagnostics
        });
        continue;
      }

      const fileStat = await stat(file);
      valid.push({
        file,
        result,
        audioRoot: matchedRoot,
        mtimeMs: Number(fileStat.mtimeMs ?? 0),
        sourceKind: 'CINEMATIC_RESULT_JSON'
      });
      diagnostics.push({
        file,
        accepted: true,
        sourceKind: 'CINEMATIC_RESULT_JSON',
        audioRoot: matchedRoot,
        resultDigest: result.integrity.resultDigest
      });
    } catch (error) {
      diagnostics.push({ file, accepted: false, reason: error?.message ?? String(error) });
    }
  }

  valid.sort((a, b) => b.mtimeMs - a.mtimeMs || a.file.localeCompare(b.file));
  return { files, diagnostics, valid };
}

async function discoverStateSources(priorAudit, explicitAudioRoot) {
  const files = await discoverExactName('cinematic-rebuild-state.json');
  const diagnostics = [];
  const valid = [];

  for (const file of files) {
    try {
      const state = await json(file);
      const stateFileDigest = await digest(file);
      const initialRoot = path.dirname(path.resolve(file));

      const initialSnapshot = buildRecoveredCinematicResultFromState({
        priorAudit,
        state,
        outputRoot: initialRoot,
        stateFileDigest
      });

      const roots = await candidateRootsForResult(file, initialSnapshot, explicitAudioRoot);
      let matchedRoot = null;
      const rootDiagnostics = [];

      for (const root of roots) {
        const check = await verifyResultAudioRoot(initialSnapshot, root);
        rootDiagnostics.push({ root, ...check });
        if (check.ok) {
          matchedRoot = root;
          break;
        }
      }

      if (!matchedRoot) {
        diagnostics.push({
          file,
          accepted: false,
          reason: 'state lineage matched but no root contains all 10 digest-matching Direct MP3s',
          stateFileDigest,
          roots: rootDiagnostics
        });
        continue;
      }

      const snapshot = buildRecoveredCinematicResultFromState({
        priorAudit,
        state,
        outputRoot: matchedRoot,
        stateFileDigest
      });

      const fileStat = await stat(file);
      valid.push({
        file,
        result: snapshot,
        audioRoot: matchedRoot,
        mtimeMs: Number(fileStat.mtimeMs ?? 0),
        sourceKind: 'RECOVERED_CINEMATIC_STATE',
        stateFileDigest
      });

      diagnostics.push({
        file,
        accepted: true,
        sourceKind: 'RECOVERED_CINEMATIC_STATE',
        audioRoot: matchedRoot,
        stateFileDigest,
        resultDigest: snapshot.integrity.resultDigest
      });
    } catch (error) {
      diagnostics.push({ file, accepted: false, reason: error?.message ?? String(error) });
    }
  }

  valid.sort((a, b) => b.mtimeMs - a.mtimeMs || a.file.localeCompare(b.file));
  return { files, diagnostics, valid };
}

async function discoverRecoverySource(priorAudit, explicitResult = null, explicitAudioRoot = null) {
  const resultSources = await discoverResultSources(priorAudit, explicitResult, explicitAudioRoot);

  if (resultSources.valid.length) {
    return {
      selected: resultSources.valid[0],
      diagnostics: resultSources.diagnostics,
      validCount: resultSources.valid.length,
      resultCandidateCount: resultSources.files.length,
      stateCandidateCount: 0
    };
  }

  const stateSources = await discoverStateSources(priorAudit, explicitAudioRoot);

  if (stateSources.valid.length) {
    return {
      selected: stateSources.valid[0],
      diagnostics: [...resultSources.diagnostics, ...stateSources.diagnostics],
      validCount: stateSources.valid.length,
      resultCandidateCount: resultSources.files.length,
      stateCandidateCount: stateSources.files.length
    };
  }

  const chapterOneCandidates = await discoverExactName('001-Chapter-1-Departure.mp3');

  const error = new Error(
    `No coherent cinematic recovery source was found. ` +
    `YasReady checked ${resultSources.files.length} cinematic result candidate(s), ` +
    `${stateSources.files.length} cinematic state candidate(s), and observed ` +
    `${chapterOneCandidates.length} Chapter 1 Direct-MP3 filename candidate(s). ` +
    `Recovery requires either a valid final result or a valid state with exact plan + lock lineage ` +
    `and all 10 current Direct MP3 digests to verify.`
  );

  error.diagnostics = [
    ...resultSources.diagnostics,
    ...stateSources.diagnostics,
    {
      forensicInventory: true,
      cinematicResultCandidates: resultSources.files.length,
      cinematicStateCandidates: stateSources.files.length,
      chapterOneFilenameCandidates: chapterOneCandidates
    }
  ];

  throw error;
}

async function recover() {
  const priorAuditPath = args[1];
  const out = flag('--out');
  const explicitResult = flag('--result');
  const explicitAudioRoot = flag('--audio-root');

  if (!priorAuditPath || !out) {
    throw new Error(
      'Usage: node src/pause-recovery-cli.js recover <prior-audit.json> --out DIR [--result FILE] [--audio-root DIR]'
    );
  }

  const root = path.resolve(out);
  await mkdir(root, { recursive: true });

  const priorAudit = await json(priorAuditPath);
  verifyBookOnePauseDeficitAudit(priorAudit);

  let discovery;
  try {
    discovery = await discoverRecoverySource(priorAudit, explicitResult, explicitAudioRoot);
  } catch (error) {
    await writeFile(
      path.join(root, 'pause-recovery-failure.json'),
      JSON.stringify({
        version: YASREADY_AUDIOBOOKS_VERSION,
        status: 'PAUSE_RECOVERY_BLOCKED_NO_COHERENT_CURRENT_CINEMATIC_SOURCE',
        priorAudit: path.resolve(priorAuditPath),
        error: error?.message ?? String(error),
        diagnostics: error?.diagnostics ?? [],
        providerTtsCallsPerformed: 0,
        providerSpendUsd: 0,
        audioWritesPerformed: 0
      }, null, 2)
    );
    throw error;
  }

  const { selected } = discovery;

  const audioEvidence = await inspectBookOnePauseAudio({
    cinematicResult: selected.result,
    audioRoot: selected.audioRoot
  });

  const recovered = relocalizeBookOnePauseDeficitAudit({
    priorAudit,
    cinematicResult: selected.result,
    audioEvidence
  });

  verifyBookOnePauseDeficitAudit(recovered);

  const auditJson = path.join(root, 'book-one-pause-deficit-audit.json');
  const auditMd = path.join(root, 'book-one-pause-deficit-audit.md');
  const auditHtml = path.join(root, 'book-one-pause-deficit-dashboard.html');
  const reportJson = path.join(root, 'pause-recovery-report.json');

  await Promise.all([
    writeFile(auditJson, JSON.stringify(recovered, null, 2)),
    writeFile(auditMd, renderBookOnePauseDeficitAuditMarkdown(recovered)),
    writeFile(auditHtml, renderBookOnePauseDeficitAuditHtml(recovered)),
    writeFile(reportJson, JSON.stringify({
      version: YASREADY_AUDIOBOOKS_VERSION,
      status: 'FRESH_PAUSE_AUDIT_RECOVERED_FROM_CURRENT_VERIFIED_CINEMATIC_AUDIO',
      priorAudit: path.resolve(priorAuditPath),
      priorAuditDigest: priorAudit.integrity.auditDigest,
      selectedCinematicResult: selected.file,
      selectedRecoverySourceKind: selected.sourceKind,
      selectedCinematicResultDigest: selected.result.integrity.resultDigest,
      selectedAudioRoot: selected.audioRoot,
      coherentResultCandidates: discovery.validCount,
      resultCandidateCount: discovery.resultCandidateCount,
      stateCandidateCount: discovery.stateCandidateCount,
      diagnostics: discovery.diagnostics,
      freshAudit: auditJson,
      freshAuditDigest: recovered.integrity.auditDigest,
      priorTimingEvidenceReused: false,
      providerTtsCallsPerformed: 0,
      providerSpendUsd: 0,
      audioWritesPerformed: 0,
      chapterElevenArmed: false,
      nextBatchArmed: false,
      fullBookGenerationArmed: false
    }, null, 2))
  ]);

  console.log(JSON.stringify({
    version: YASREADY_AUDIOBOOKS_VERSION,
    status: 'FRESH_PAUSE_AUDIT_RECOVERED_FROM_CURRENT_VERIFIED_CINEMATIC_AUDIO',
    selectedCinematicResult: selected.file,
    selectedRecoverySourceKind: selected.sourceKind,
    selectedAudioRoot: selected.audioRoot,
    freshAudit: auditJson,
    freshAuditDigest: recovered.integrity.auditDigest,
    chaptersAudited: recovered.summary.chaptersAudited,
    localRepairSafe: recovered.summary.localRepairSafe,
    manualConfirmation: recovered.summary.deficitCandidatesNeedingManualConfirmation,
    unresolved: recovered.summary.unresolved,
    priorTimingEvidenceReused: false,
    providerTtsCallsPerformed: 0,
    providerSpendUsd: 0,
    audioWritesPerformed: 0
  }, null, 2));
}

try {
  if (command === 'recover') await recover();
  else throw new Error('Usage: node src/pause-recovery-cli.js recover <prior-audit.json> --out DIR');
} catch (error) {
  console.error(`\n❌ ${error?.message ?? error}`);
  process.exitCode = 1;
}
