import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  YASREADY_AUDIOBOOKS_VERSION,
  loadStoredElevenLabsApiKey,
  ElevenLabsProvider,
  extractElevenLabsQuota,
  buildBookOneNextBatchReadiness,
  renderBookOneNextBatchReadinessMarkdown
} from './index.js';

const args = process.argv.slice(2);
function flag(name, fallback = null) { const i = args.indexOf(name); return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback; }
async function json(file) { return JSON.parse(await readFile(path.resolve(file), 'utf8')); }

const planPath = args[0];
const previousArmPath = flag('--previous-arm');
const previousResultPath = flag('--previous-result');
const out = flag('--out');
if (!planPath || !previousArmPath || !previousResultPath || !out) {
  console.error('Usage: node src/next-batch-readiness-cli.js <production-plan.json> --previous-arm FILE --previous-result FILE --out DIR');
  process.exitCode = 2;
} else {
  const [productionPlan, previousArm, previousResult] = await Promise.all([
    json(planPath),
    json(previousArmPath),
    json(previousResultPath)
  ]);
  await loadStoredElevenLabsApiKey();
  const provider = new ElevenLabsProvider();
  const health = await provider.healthCheck();
  if (!health?.ok) throw new Error(`Provider health failed during read-only next-batch readiness: ${health?.reason ?? health?.status ?? 'unknown'}`);
  const subscription = await provider.subscriptionPreflight();
  if (!subscription?.available || !subscription?.safeToContinue || !subscription.subscription) throw new Error(`Live provider quota is required for next-batch readiness (${subscription?.reason ?? 'unavailable'})`);
  const quota = extractElevenLabsQuota(subscription.subscription);
  const result = buildBookOneNextBatchReadiness({
    productionPlan,
    previousArm,
    previousResult,
    providerRemaining: quota.providerReportedRemaining,
    providerTier: quota.tier
  });
  const resolved = path.resolve(out);
  await mkdir(resolved, { recursive: true });
  const jsonPath = path.join(resolved, 'book-one-next-batch-readiness.json');
  const mdPath = path.join(resolved, 'book-one-next-batch-readiness.md');
  await Promise.all([
    writeFile(jsonPath, JSON.stringify(result, null, 2)),
    writeFile(mdPath, renderBookOneNextBatchReadinessMarkdown(result))
  ]);
  console.log(JSON.stringify({
    version: YASREADY_AUDIOBOOKS_VERSION,
    status: result.status,
    providerTtsCallsPerformed: 0,
    providerSpendUsd: 0,
    nextBatchArmed: false,
    fullBookGenerationArmed: false,
    candidateBatchOrdinal: result.candidateBatch.ordinal,
    candidateChapterCount: result.candidateBatch.chapterCount,
    candidateProviderCalls: result.candidateBatch.newProviderCalls,
    candidateProviderCharacters: result.candidateBatch.newProviderCharacters,
    providerRemaining: result.liveProvider.providerReportedRemaining,
    previewProtectedMaxUsd: result.budgetPreview.protectedMaxUsd,
    files: { json: jsonPath, markdown: mdPath }
  }, null, 2));
}
