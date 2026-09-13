import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  YASREADY_AUDIOBOOKS_VERSION,
  loadStoredElevenLabsApiKey,
  ElevenLabsProvider,
  FfmpegAdapter,
  extractManuscriptFile,
  analyzeManuscript,
  buildBookOneCinematicRebuildArm,
  renderBookOneCinematicRebuild,
  renderCinematicNaturalismLockMarkdown,
  renderCinematicRebuildArmMarkdown
} from './index.js';

const args = process.argv.slice(2);
function flag(name, fallback = null) { const i = args.indexOf(name); return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback; }
async function json(file) { return JSON.parse(await readFile(path.resolve(file), 'utf8')); }

async function loadInputs({ needArm = false } = {}) {
  const planPath = args[1];
  const recipePath = flag('--recipe-lock');
  const manuscriptPath = flag('--manuscript');
  const previousArmPath = flag('--previous-arm');
  const previousResultPath = flag('--previous-result');
  const previousRoot = flag('--previous-root');
  const productionRoot = flag('--production-root');
  const out = flag('--out');
  const armPath = needArm ? flag('--arm') : null;
  if (!planPath || !recipePath || !manuscriptPath || !previousArmPath || !previousResultPath || !previousRoot || !productionRoot || (!needArm && !out) || (needArm && !armPath)) {
    throw new Error(needArm
      ? 'Usage: node src/cinematic-rebuild-cli.js render <plan.json> --recipe-lock FILE --manuscript FILE --previous-arm FILE --previous-result FILE --previous-root DIR --arm FILE --production-root DIR --token CINEMATIC-... --max-usd N'
      : 'Usage: node src/cinematic-rebuild-cli.js arm <plan.json> --recipe-lock FILE --manuscript FILE --previous-arm FILE --previous-result FILE --previous-root DIR --production-root DIR --out DIR');
  }
  const [productionPlan, recipeLock, previousArm, previousResult] = await Promise.all([
    json(planPath), json(recipePath), json(previousArmPath), json(previousResultPath)
  ]);
  const extracted = extractManuscriptFile(path.resolve(manuscriptPath));
  const manuscriptAnalysis = analyzeManuscript(extracted);
  return { productionPlan, recipeLock, manuscriptAnalysis, previousArm, previousResult, previousRoot: path.resolve(previousRoot), productionRoot: path.resolve(productionRoot), out: out ? path.resolve(out) : null, armPath: armPath ? path.resolve(armPath) : null };
}

async function providerAndFfmpeg() {
  await loadStoredElevenLabsApiKey();
  return { provider: new ElevenLabsProvider(), ffmpeg: new FfmpegAdapter() };
}

async function runArm() {
  const input = await loadInputs();
  const { provider, ffmpeg } = await providerAndFfmpeg();
  const { arm, cinematicLock } = await buildBookOneCinematicRebuildArm({
    ...input,
    outputRoot: input.productionRoot,
    provider,
    ffmpeg
  });
  await mkdir(input.out, { recursive: true });
  const armJson = path.join(input.out, 'book-one-cinematic-rebuild-arm.json');
  const armMarkdown = path.join(input.out, 'book-one-cinematic-rebuild-arm.md');
  const lockJson = path.join(input.out, 'book-one-cinematic-naturalism-lock.json');
  const lockMarkdown = path.join(input.out, 'book-one-cinematic-naturalism-lock.md');
  await Promise.all([
    writeFile(armJson, JSON.stringify(arm, null, 2)),
    writeFile(armMarkdown, renderCinematicRebuildArmMarkdown(arm)),
    writeFile(lockJson, JSON.stringify(cinematicLock, null, 2)),
    writeFile(lockMarkdown, renderCinematicNaturalismLockMarkdown(cinematicLock))
  ]);
  console.log(JSON.stringify({
    version: YASREADY_AUDIOBOOKS_VERSION,
    status: arm.status,
    profile: arm.profile.profileId,
    selectedComparison: arm.profile.humanDecision.selectedComparison,
    plus2Allowed: arm.profile.rules.plus2EscalationAllowed,
    completedBeforeArm: arm.rebuildTarget.completedBeforeArm,
    targetChapterCount: arm.rebuildTarget.chapterCount,
    selectedChapterCount: arm.batchScope.selectedChapterCount,
    firstChapterNumber: arm.batchScope.firstChapterNumber,
    lastChapterNumber: arm.batchScope.lastChapterNumber,
    providerCalls: arm.batchScope.newProviderCalls,
    providerCharacters: arm.batchScope.newProviderCharacters,
    retryReserveCharacters: arm.batchScope.retryReserveCharacters,
    providerRemaining: arm.liveProvider.providerReportedRemaining,
    protectedMaxUsd: arm.budget.protectedMaxUsd,
    providerTtsCallsPerformed: 0,
    providerSpendUsd: 0,
    originalBatchPreserved: true,
    chapterElevenArmed: false,
    nextBatchArmed: false,
    fullBookGenerationArmed: false,
    token: arm.confirmation?.token ?? null,
    files: { armJson, armMarkdown, lockJson, lockMarkdown }
  }, null, 2));
}

function renderProgress({ arm, state }) {
  const target = Number(arm.rebuildTarget.chapterCount ?? 10);
  const done = Object.values(state?.chapters ?? {}).filter((chapter) => chapter?.status === 'COMPLETE').length;
  const chunks = Object.values(state?.chunks ?? {});
  const selectedChunkIds = new Set(arm.batchScope.chapters.flatMap((chapter) => chapter.chunkIds ?? []));
  const selectedRows = chunks.filter((row) => selectedChunkIds.has(row.id));
  const finished = selectedRows.filter((row) => row.status === 'COMPLETE').length;
  const total = selectedChunkIds.size || 1;
  const ratio = Math.min(1, Math.max(0, finished / total));
  const percent = Math.round(ratio * 100);
  const current = selectedRows.filter((row) => row.status !== 'COMPLETE').at(-1) ?? selectedRows.at(-1);
  const match = /^ch(\d+)-/.exec(String(current?.id ?? ''));
  const currentChapter = match ? Number(match[1]) : Math.min(target, done + 1);
  const spend = selectedRows.reduce((sum, row) => sum + Number(row?.capturedOrEstimatedBilledUsd ?? 0), 0);
  const filled = Math.round(20 * ratio);
  const bar = `${'█'.repeat(filled)}${'░'.repeat(20 - filled)}`;
  const stageMap = {
    PROVIDER_IN_FLIGHT: 'ElevenLabs performance render',
    PROVIDER_COMPLETE: 'pace processing',
    TEMPO_COMPLETE: 'Warm + Slightly Deeper finish',
    FINISH_COMPLETE: 'chapter assembly / mastering / QA',
    COMPLETE: 'complete',
    PROVIDER_RESULT_UNKNOWN_DO_NOT_RERUN: 'provider outcome unresolved — DO NOT RERUN',
    LOCAL_TEMPO_FAILED_SAFE_TO_RERUN: 'local tempo retry',
    LOCAL_FINISH_FAILED_SAFE_TO_RERUN: 'local finish retry'
  };
  return `[${bar}] ${String(percent).padStart(3)}% | Book ch ${currentChapter}/${target} | scope audio ${finished}/${total} | ${stageMap[current?.status] ?? 'queued'} | $${spend.toFixed(2)}/$${Number(arm.budget.protectedMaxUsd).toFixed(2)} max`;
}

function startProgress({ arm, statePath }) {
  let timer = null;
  let last = '';
  const tick = async () => {
    try {
      const state = JSON.parse(await readFile(statePath, 'utf8'));
      const line = renderProgress({ arm, state });
      if (line !== last) { process.stdout.write(`\r${line}`); last = line; }
    } catch {}
  };
  tick();
  timer = setInterval(tick, 2000);
  timer.unref?.();
  return async () => { if (timer) clearInterval(timer); await tick(); if (last) process.stdout.write('\n'); };
}

async function runRender() {
  const input = await loadInputs({ needArm: true });
  const arm = await json(input.armPath);
  const token = flag('--token');
  const maxUsd = Number(flag('--max-usd'));
  if (!token || !Number.isFinite(maxUsd)) throw new Error('Cinematic render requires --token CINEMATIC-... and --max-usd N');
  const { provider, ffmpeg } = await providerAndFfmpeg();
  const statePath = path.join(input.productionRoot, 'cinematic-rebuild-state.json');
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('CINEMATIC BATCH ONE REBUILD — LIVE PRODUCTION CONSOLE');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  const stopProgress = startProgress({ arm, statePath });
  let result;
  try {
    result = await renderBookOneCinematicRebuild({
      ...input,
      arm,
      outputRoot: input.productionRoot,
      provider,
      ffmpeg,
      approvalToken: token,
      maxUsd
    });
  } finally {
    await stopProgress();
  }
  console.log(JSON.stringify({
    version: YASREADY_AUDIOBOOKS_VERSION,
    status: result.status,
    completedChapterCount: result.progress.completedChapterCount,
    targetChapterCount: result.progress.targetChapterCount,
    remainingChapterCount: result.progress.remainingChapterCount,
    allTenComplete: result.progress.allTenComplete,
    latestArmProviderCallsThisRun: result.latestArm.providerGenerationCallsThisRun,
    latestArmCapturedOrEstimatedBilledUsd: result.cost.latestArmCapturedOrEstimatedBilledUsd,
    totalCinematicCapturedOrEstimatedBilledUsd: result.cost.totalCinematicCapturedOrEstimatedBilledUsd,
    originalBatchPreserved: true,
    chapterElevenArmed: false,
    nextBatchArmed: false,
    fullBookGenerationArmed: false,
    reviewBoard: path.join(input.productionRoot, 'cinematic-rebuild-review.html'),
    resultFile: path.join(input.productionRoot, 'cinematic-rebuild-result.json'),
    nextAction: result.nextAction
  }, null, 2));
}

try {
  if (args[0] === 'arm') await runArm();
  else if (args[0] === 'render') await runRender();
  else throw new Error('Usage: node src/cinematic-rebuild-cli.js <arm|render> ...');
} catch (error) {
  console.error(`\n❌ ${error?.message ?? error}`);
  process.exitCode = 1;
}
