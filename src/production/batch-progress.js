import { readFile } from 'node:fs/promises';
import path from 'node:path';

const PROVIDER_SECURED = new Set([
  'PROVIDER_COMPLETE',
  'PROVIDER_COMPLETE_IMPORTED_PILOT',
  'LOCAL_TEMPO_FAILED_SAFE_TO_RERUN',
  'TEMPO_COMPLETE',
  'LOCAL_FINISH_FAILED_SAFE_TO_RERUN',
  'FINISH_COMPLETE',
  'COMPLETE'
]);
const TEMPO_SECURED = new Set(['TEMPO_COMPLETE', 'LOCAL_FINISH_FAILED_SAFE_TO_RERUN', 'FINISH_COMPLETE', 'COMPLETE']);
const FINISH_SECURED = new Set(['FINISH_COMPLETE', 'COMPLETE']);

function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
function money(value) { return Number(value ?? 0).toFixed(2); }
function plural(value, unit) { return `${value}${unit}`; }
function humanDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const rounded = Math.max(0, Math.round(seconds));
  if (rounded < 60) return plural(rounded, 's');
  const minutes = Math.round(rounded / 60);
  if (minutes < 60) return plural(minutes, 'm');
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins ? `${hours}h ${mins}m` : `${hours}h`;
}
function stageLabel(status) {
  switch (status) {
    case 'PLANNED': return 'queued';
    case 'PROVIDER_IN_FLIGHT': return 'ElevenLabs';
    case 'PROVIDER_COMPLETE': return 'provider saved';
    case 'PROVIDER_COMPLETE_IMPORTED_PILOT': return 'pilot audio reused';
    case 'PROVIDER_FAILED_SAFE_TO_RETRY': return 'provider retry needed';
    case 'PROVIDER_RESULT_UNKNOWN_DO_NOT_RERUN': return 'provider outcome unresolved — DO NOT RERUN';
    case 'LOCAL_TEMPO_FAILED_SAFE_TO_RERUN': return 'tempo retry needed';
    case 'TEMPO_COMPLETE': return 'voice finish';
    case 'LOCAL_FINISH_FAILED_SAFE_TO_RERUN': return 'voice finish retry needed';
    case 'FINISH_COMPLETE': return 'chapter assembly / mastering / QA';
    case 'COMPLETE': return 'complete';
    default: return status ? String(status).toLowerCase().replaceAll('_', ' ') : 'waiting';
  }
}
function chapterNumberFromChunkId(id) {
  const match = /^ch(\d+)-/.exec(String(id ?? ''));
  return match ? Number(match[1]) : null;
}
function chunkScore(status) {
  if (FINISH_SECURED.has(status)) return 3;
  if (TEMPO_SECURED.has(status)) return 2;
  if (PROVIDER_SECURED.has(status)) return 1;
  return 0;
}

export function buildBatchProgressSnapshot({ arm, state, now = Date.now() } = {}) {
  const chapters = arm?.batchScope?.chapters ?? [];
  const totalChapters = Number(arm?.batchScope?.selectedChapterCount ?? chapters.length ?? 0);
  const totalChunks = chapters.reduce((sum, chapter) => sum + Number(chapter?.chunkIds?.length ?? 0), 0);
  const chunkRows = Object.values(state?.chunks ?? {});
  const chapterRows = Object.values(state?.chapters ?? {});
  const completedChapters = chapterRows.length;
  const securedProviderAudio = chunkRows.filter((row) => PROVIDER_SECURED.has(row?.status)).length;
  const finishedChunks = chunkRows.filter((row) => FINISH_SECURED.has(row?.status)).length;
  const completeChunks = chunkRows.filter((row) => row?.status === 'COMPLETE').length;
  const capturedOrEstimatedBilledUsd = chunkRows.reduce((sum, row) => sum + Number(row?.capturedOrEstimatedBilledUsd ?? 0), 0);
  const approvedMaxUsd = Number(arm?.budget?.protectedMaxUsd ?? 0);
  const progressUnits = chunkRows.reduce((sum, row) => sum + chunkScore(row?.status), 0) + completedChapters;
  const totalUnits = Math.max(1, totalChunks * 3 + totalChapters);
  const progressRatio = clamp(progressUnits / totalUnits, 0, 1);
  const progressPercent = Math.round(progressRatio * 100);
  const unfinished = chunkRows.filter((row) => row?.status !== 'COMPLETE');
  const current = unfinished.at(-1) ?? chunkRows.at(-1) ?? null;
  const currentChapterNumber = chapterNumberFromChunkId(current?.id)
    ?? (completedChapters < totalChapters ? Number(chapters[completedChapters]?.order ?? completedChapters) + 1 : totalChapters || null);
  const createdAtMs = state?.createdAt ? Date.parse(state.createdAt) : NaN;
  const elapsedSeconds = Number.isFinite(createdAtMs) ? Math.max(0, (Number(now) - createdAtMs) / 1000) : null;
  let etaSeconds = null;
  if (elapsedSeconds !== null && progressRatio >= 0.05 && progressRatio < 0.995) {
    etaSeconds = Math.max(0, elapsedSeconds * ((1 - progressRatio) / progressRatio));
  }
  return Object.freeze({
    batchOrdinal: Number(arm?.batchScope?.ordinal ?? 1),
    totalChapters,
    completedChapters,
    currentChapterNumber,
    totalChunks,
    trackedChunks: chunkRows.length,
    securedProviderAudio,
    finishedChunks,
    completeChunks,
    currentChunkId: current?.id ?? null,
    currentStatus: current?.status ?? (completedChapters === totalChapters && totalChapters > 0 ? 'COMPLETE' : 'WAITING'),
    currentStage: stageLabel(current?.status ?? (completedChapters === totalChapters && totalChapters > 0 ? 'COMPLETE' : null)),
    capturedOrEstimatedBilledUsd,
    approvedMaxUsd,
    progressRatio,
    progressPercent,
    elapsedSeconds,
    etaSeconds,
    updatedAt: state?.updatedAt ?? null
  });
}

export function renderBatchProgressLine(snapshot, { width = 22 } = {}) {
  const cells = Math.max(8, Number(width) || 22);
  const filled = Math.round(cells * Number(snapshot?.progressRatio ?? 0));
  const bar = `${'█'.repeat(filled)}${'░'.repeat(Math.max(0, cells - filled))}`;
  const chapter = snapshot?.currentChapterNumber
    ? `Ch ${snapshot.currentChapterNumber}/${snapshot.totalChapters}`
    : `Ch ${snapshot.completedChapters}/${snapshot.totalChapters}`;
  const eta = snapshot?.etaSeconds === null || snapshot?.etaSeconds === undefined ? 'ETA —' : `ETA ~${humanDuration(snapshot.etaSeconds)}`;
  const elapsed = snapshot?.elapsedSeconds === null || snapshot?.elapsedSeconds === undefined ? 'elapsed —' : `elapsed ${humanDuration(snapshot.elapsedSeconds)}`;
  return `[${bar}] ${String(snapshot?.progressPercent ?? 0).padStart(3)}% | ${chapter} | audio ${snapshot?.securedProviderAudio ?? 0}/${snapshot?.totalChunks ?? 0} | ${snapshot?.currentStage ?? 'waiting'} | $${money(snapshot?.capturedOrEstimatedBilledUsd)}/$${money(snapshot?.approvedMaxUsd)} max | ${elapsed} | ${eta}`;
}

async function readJsonMaybe(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch (error) {
    if (error?.code === 'ENOENT' || error instanceof SyntaxError) return null;
    throw error;
  }
}

export function startBatchProgressConsole({ arm, statePath, intervalMs = 2500, output = process.stdout, now = () => Date.now() } = {}) {
  if (!arm?.batchScope) throw new Error('Production console requires a batch arm');
  if (!statePath) throw new Error('Production console requires a state path');
  const resolved = path.resolve(statePath);
  let stopped = false;
  let lastLine = '';
  let lastWidth = 0;
  let timer = null;

  const writeLine = (line) => {
    if (!output?.write) return;
    const padded = line.padEnd(Math.max(lastWidth, line.length));
    output.write(`\r${padded}`);
    lastWidth = Math.max(lastWidth, line.length);
  };
  const tick = async () => {
    if (stopped) return;
    const state = await readJsonMaybe(resolved);
    const line = state
      ? renderBatchProgressLine(buildBatchProgressSnapshot({ arm, state, now: now() }))
      : '[░░░░░░░░░░░░░░░░░░░░░░]   0% | waiting for production state…';
    if (line !== lastLine) { writeLine(line); lastLine = line; }
  };
  const safeTick = () => { void tick().catch(() => {}); };
  safeTick();
  timer = setInterval(safeTick, Math.max(500, Number(intervalMs) || 2500));
  timer.unref?.();

  return Object.freeze({
    statePath: resolved,
    async stop({ newline = true } = {}) {
      if (stopped) return;
      if (timer) clearInterval(timer);
      const finalState = await readJsonMaybe(resolved).catch(() => null);
      if (finalState) {
        const finalLine = renderBatchProgressLine(buildBatchProgressSnapshot({ arm, state: finalState, now: now() }));
        if (finalLine !== lastLine) writeLine(finalLine);
      }
      stopped = true;
      if (newline && output?.write) output.write('\n');
    }
  });
}
