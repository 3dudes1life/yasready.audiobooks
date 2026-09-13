import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  ElevenLabsProvider,
  FfmpegAdapter,
  runBookOneFullBookPreflight,
  renderBookOneProductionRecipeLockMarkdown,
  renderBookOneFullBookPreflightMarkdown,
  YASREADY_AUDIOBOOKS_VERSION
} from './index.js';

const args = process.argv.slice(2);
function flag(name, fallback = null) { const i = args.indexOf(name); return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback; }
async function json(file) { return JSON.parse(await readFile(path.resolve(file), 'utf8')); }

async function run() {
  const planPath = args[0];
  const finishPath = flag('--finish-lock');
  const out = flag('--out');
  const productionRoot = flag('--production-root', path.join(process.env.HOME ?? '', 'Desktop', 'YasReady-Book-One-Full-Production'));
  if (!planPath || !finishPath || !out) {
    console.error('Usage: node src/full-book-preflight-cli.js <book-one-production-plan.json> --finish-lock <local-voice-finish-lock.json> --out DIR [--production-root DIR]');
    process.exitCode = 2; return;
  }
  const [productionPlan, localVoiceFinishLock] = await Promise.all([json(planPath), json(finishPath)]);
  const provider = new ElevenLabsProvider();
  const ffmpeg = new FfmpegAdapter();
  const { recipeLock, preflight } = await runBookOneFullBookPreflight({ productionPlan, localVoiceFinishLock, provider, ffmpeg, outputRoot: productionRoot });
  const resolved = path.resolve(out);
  await mkdir(resolved, { recursive: true });
  const files = {
    recipeJson: path.join(resolved, 'book-one-production-recipe-lock.json'),
    recipeMarkdown: path.join(resolved, 'book-one-production-recipe-lock.md'),
    preflightJson: path.join(resolved, 'book-one-full-book-preflight.json'),
    preflightMarkdown: path.join(resolved, 'book-one-full-book-preflight.md'),
    confirmation: path.join(resolved, 'full-book-preflight-reference.txt')
  };
  await Promise.all([
    writeFile(files.recipeJson, JSON.stringify(recipeLock, null, 2)),
    writeFile(files.recipeMarkdown, renderBookOneProductionRecipeLockMarkdown(recipeLock)),
    writeFile(files.preflightJson, JSON.stringify(preflight, null, 2)),
    writeFile(files.preflightMarkdown, renderBookOneFullBookPreflightMarkdown(preflight)),
    writeFile(files.confirmation, [preflight.confirmation.token, 'REFERENCE ONLY — NOT SPEND AUTHORIZATION', `Status: ${preflight.status}`, `Recipe digest: ${recipeLock.integrity.recipeDigest}`, 'Production armed: NO', 'Full-book generation armed: NO', ''].join('\n'))
  ]);
  console.log(JSON.stringify({
    version: YASREADY_AUDIOBOOKS_VERSION,
    productionRecipeLock: recipeLock.status,
    recipeDigest: recipeLock.integrity.recipeDigest,
    narrator: recipeLock.narrator.name,
    voiceId: recipeLock.narrator.voiceId,
    direction: recipeLock.performance.label,
    emotion: recipeLock.performance.emotionalVariantLabel,
    providerSpeed: recipeLock.pace.providerNativeSpeed,
    effectiveSpeed: recipeLock.pace.effectiveSpeed,
    localVoiceFinish: recipeLock.localVoiceFinish.label,
    localVoiceFinishDigest: recipeLock.source.localVoiceFinishDigest,
    fullBookPreflight: preflight.status,
    providerGenerationCallsPlanned: preflight.workload.providerGenerationCalls,
    providerCharactersPlanned: preflight.workload.providerCharacters,
    initialGenerationEstimateUsd: preflight.budget.initialGenerationUsd,
    retryReserveUsd: preflight.budget.retryReserveUsd,
    protectedMaxUsd: preflight.budget.protectedMaxUsd,
    providerReportedRemaining: preflight.provider.providerReportedRemaining,
    providerQuotaDeficitCharacters: preflight.provider.deficitCharacters,
    storageRequiredGiB: preflight.storage.requiredGiB,
    storageAvailableGiB: preflight.storage.availableGiB,
    ffmpegOk: preflight.ffmpeg.ok,
    blockers: preflight.blockers,
    providerTtsCallsPerformed: 0,
    providerTtsSpendUsd: 0,
    productionArmed: false,
    fullBookGenerationArmed: false,
    preflightReferenceToken: preflight.confirmation.token,
    nextAction: preflight.nextAction,
    files
  }, null, 2));
}

await run();
