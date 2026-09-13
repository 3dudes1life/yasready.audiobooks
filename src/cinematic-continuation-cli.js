import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  YASREADY_AUDIOBOOKS_VERSION,
  extractManuscriptFile,
  analyzeManuscript,
  loadStoredElevenLabsApiKey,
  ElevenLabsProvider,
  extractElevenLabsQuota,
  buildBookOneCinematicContinuationBlueprint,
  buildBookOneCinematicContinuationPreview,
  reconcileBookOneContinuationManuscriptIdentity,
  renderBookOneCinematicContinuationBlueprintMarkdown,
  renderBookOneCinematicContinuationPreviewMarkdown,
  renderBookOneCinematicContinuationDashboardHtml
} from './index.js';

const args = process.argv.slice(2);
const command = args[0];

function flag(name, fallback = null) {
  const index = args.indexOf(name);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : fallback;
}
function hasFlag(name) { return args.includes(name); }
async function json(file) { return JSON.parse(await readFile(path.resolve(file), 'utf8')); }

async function identity() {
  const productionPlanPath = args[1];
  const manuscriptPath = flag('--manuscript');
  const cinematicResultPath = flag('--result');
  const cinematicLockPath = flag('--lock');

  if (!productionPlanPath || !manuscriptPath || !cinematicResultPath || !cinematicLockPath) {
    throw new Error('Usage: node src/cinematic-continuation-cli.js identity <production-plan.json> --manuscript FILE --result FILE --lock FILE');
  }

  const [productionPlan, cinematicResult, cinematicLock] = await Promise.all([
    json(productionPlanPath),
    json(cinematicResultPath),
    json(cinematicLockPath)
  ]);
  const extracted = extractManuscriptFile(path.resolve(manuscriptPath));
  const manuscriptAnalysis = analyzeManuscript(extracted);

  const identity = reconcileBookOneContinuationManuscriptIdentity({
    productionPlan,
    manuscriptAnalysis,
    cinematicResult,
    cinematicLock
  });

  console.log(JSON.stringify({
    version: YASREADY_AUDIOBOOKS_VERSION,
    status: 'CANONICAL_MANUSCRIPT_IDENTITY_VERIFIED',
    lockedContainerSourceHash: identity.lockedContainerSourceHash,
    currentContainerSourceHash: identity.currentContainerSourceHash,
    containerHashMatchesLocked: identity.containerHashMatchesLocked,
    planNormalizedTextHash: identity.planNormalizedTextHash,
    currentNormalizedTextHash: identity.currentNormalizedTextHash,
    normalizedTextHashMatches: identity.normalizedTextHashMatches,
    chapterCount: identity.chapterCount,
    chapterHashesVerified: identity.chapterHashesVerified,
    chapterHashMismatches: identity.chapterHashMismatches,
    canonicalTextVerified: identity.canonicalTextVerified,
    reconciliationPolicy: identity.reconciliationPolicy,
    providerTtsCallsPerformed: 0,
    providerSpendUsd: 0,
    chapterElevenArmed: false,
    nextBatchArmed: false,
    fullBookGenerationArmed: false
  }, null, 2));
}

async function plan() {
  const productionPlanPath = args[1];
  const manuscriptPath = flag('--manuscript');
  const cinematicResultPath = flag('--result');
  const cinematicLockPath = flag('--lock');
  const out = flag('--out');

  if (!productionPlanPath || !manuscriptPath || !cinematicResultPath || !cinematicLockPath || !out) {
    throw new Error('Usage: node src/cinematic-continuation-cli.js plan <production-plan.json> --manuscript FILE --result FILE --lock FILE --out DIR');
  }

  const [productionPlan, cinematicResult, cinematicLock] = await Promise.all([
    json(productionPlanPath),
    json(cinematicResultPath),
    json(cinematicLockPath)
  ]);
  const extracted = extractManuscriptFile(path.resolve(manuscriptPath));
  const manuscriptAnalysis = analyzeManuscript(extracted);

  const blueprint = buildBookOneCinematicContinuationBlueprint({
    productionPlan,
    manuscriptAnalysis,
    cinematicResult,
    cinematicLock
  });

  const root = path.resolve(out);
  await mkdir(root, { recursive: true });
  const blueprintJson = path.join(root, 'book-one-cinematic-continuation-blueprint.json');
  const blueprintMarkdown = path.join(root, 'book-one-cinematic-continuation-blueprint.md');
  const dashboardHtml = path.join(root, 'book-one-cinematic-continuation-dashboard.html');

  await Promise.all([
    writeFile(blueprintJson, JSON.stringify(blueprint, null, 2)),
    writeFile(blueprintMarkdown, renderBookOneCinematicContinuationBlueprintMarkdown(blueprint)),
    writeFile(dashboardHtml, renderBookOneCinematicContinuationDashboardHtml(blueprint))
  ]);

  console.log(JSON.stringify({
    version: YASREADY_AUDIOBOOKS_VERSION,
    status: blueprint.status,
    totalNarrativeChapters: blueprint.progress.totalNarrativeChapters,
    completedCinematicChapters: blueprint.progress.completedCinematicChapters,
    remainingCinematicChapters: blueprint.progress.remainingCinematicChapters,
    firstPendingChapterNumber: blueprint.progress.firstPendingChapterNumber,
    lastPendingChapterNumber: blueprint.progress.lastPendingChapterNumber,
    plannedProviderCalls: blueprint.workload.providerCalls,
    plannedProviderCharacters: blueprint.workload.providerCharacters,
    plannedSubtlePerformanceDirections: blueprint.workload.subtlePerformanceDirections,
    planningProtectedRemainderMaxUsd: blueprint.workload.protectedRemainderMaxUsd,
    providerTtsCallsPerformed: 0,
    providerSpendUsd: 0,
    approvalTokenCreated: false,
    chapterElevenArmed: false,
    nextBatchArmed: false,
    productionRuntimeConnected: false,
    fullBookGenerationArmed: false,
    files: { blueprintJson, blueprintMarkdown, dashboardHtml }
  }, null, 2));
}

async function preview() {
  const blueprintPath = args[1];
  const approvalPath = flag('--approval');
  const out = flag('--out');
  if (!blueprintPath || !out) {
    throw new Error('Usage: node src/cinematic-continuation-cli.js preview <blueprint.json> [--approval FILE] --out DIR');
  }

  const blueprint = await json(blueprintPath);
  const humanReviewApproval = approvalPath ? await json(approvalPath) : null;

  await loadStoredElevenLabsApiKey();
  const provider = new ElevenLabsProvider();
  const health = await provider.healthCheck();
  if (!health?.ok) {
    throw new Error(`Provider health failed during read-only continuation preview: ${health?.reason ?? health?.status ?? 'unknown'}`);
  }
  const subscription = await provider.subscriptionPreflight();
  if (!subscription?.available || !subscription?.safeToContinue || !subscription.subscription) {
    throw new Error(`Live provider quota is required for continuation preview (${subscription?.reason ?? 'unavailable'})`);
  }
  const quota = extractElevenLabsQuota(subscription.subscription);

  const preview = buildBookOneCinematicContinuationPreview({
    blueprint,
    providerRemaining: quota.providerReportedRemaining,
    providerTier: quota.tier,
    humanReviewApproval
  });

  const root = path.resolve(out);
  await mkdir(root, { recursive: true });
  const previewJson = path.join(root, 'book-one-cinematic-continuation-preview.json');
  const previewMarkdown = path.join(root, 'book-one-cinematic-continuation-preview.md');

  await Promise.all([
    writeFile(previewJson, JSON.stringify(preview, null, 2)),
    writeFile(previewMarkdown, renderBookOneCinematicContinuationPreviewMarkdown(preview))
  ]);

  console.log(JSON.stringify({
    version: YASREADY_AUDIOBOOKS_VERSION,
    status: preview.status,
    providerRemaining: preview.liveProvider.providerReportedRemaining,
    candidateChapterCount: preview.candidateScope.chapterCount,
    firstChapterNumber: preview.candidateScope.firstChapterNumber,
    lastChapterNumber: preview.candidateScope.lastChapterNumber,
    candidateProviderCalls: preview.candidateScope.newProviderCalls,
    candidateProviderCharacters: preview.candidateScope.newProviderCharacters,
    retryReserveCharacters: preview.candidateScope.retryReserveCharacters,
    quotaEnvelopeCharacters: preview.candidateScope.quotaEnvelopeCharacters,
    previewProtectedMaxUsd: preview.budgetPreview.protectedMaxUsd,
    humanGateOpen: preview.humanGate.gateOpen,
    providerTtsCallsPerformed: 0,
    providerSpendUsd: 0,
    approvalTokenCreated: false,
    chapterElevenArmed: false,
    nextBatchArmed: false,
    productionRuntimeConnected: false,
    fullBookGenerationArmed: false,
    files: { previewJson, previewMarkdown }
  }, null, 2));
}

try {
  if (command === 'identity') await identity();
  else if (command === 'plan') await plan();
  else if (command === 'preview') await preview();
  else throw new Error('Usage: node src/cinematic-continuation-cli.js <identity|plan|preview> ...');
} catch (error) {
  console.error(`\n❌ ${error?.message ?? error}`);
  process.exitCode = 1;
}
