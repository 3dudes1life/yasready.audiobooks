import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  YASREADY_AUDIOBOOKS_VERSION,
  loadStoredElevenLabsApiKey,
  ElevenLabsProvider,
  extractElevenLabsQuota,
  extractManuscriptFile,
  analyzeManuscript,
  buildBookOneCinematicHumanReviewSession,
  renderBookOneCinematicHumanReviewHtml,
  renderBookOneCinematicHumanReviewSessionMarkdown,
  finalizeBookOneCinematicHumanReview,
  renderBookOneCinematicHumanReviewApprovalMarkdown,
  buildBookOneCinematicNextBatchReadiness,
  renderBookOneCinematicNextBatchReadinessMarkdown
} from './index.js';

const args = process.argv.slice(2);
const command = args[0];
function flag(name, fallback = null) { const i = args.indexOf(name); return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback; }
async function json(file) { return JSON.parse(await readFile(path.resolve(file), 'utf8')); }

async function prepare() {
  const resultPath = args[1];
  const lockPath = flag('--lock');
  const out = flag('--out');
  if (!resultPath || !lockPath || !out) throw new Error('Usage: node src/cinematic-review-gate-cli.js prepare <cinematic-result.json> --lock FILE --out DIR');
  const [cinematicResult, cinematicLock] = await Promise.all([json(resultPath), json(lockPath)]);
  const session = buildBookOneCinematicHumanReviewSession({ cinematicResult, cinematicLock });
  const root = path.resolve(out);
  await mkdir(root, { recursive: true });
  const sessionJson = path.join(root, 'cinematic-human-review-session.json');
  const sessionMd = path.join(root, 'cinematic-human-review-session.md');
  const reviewHtml = path.join(root, 'cinematic-human-review.html');
  await Promise.all([
    writeFile(sessionJson, JSON.stringify(session, null, 2)),
    writeFile(sessionMd, renderBookOneCinematicHumanReviewSessionMarkdown(session)),
    writeFile(reviewHtml, renderBookOneCinematicHumanReviewHtml(session))
  ]);
  console.log(JSON.stringify({
    version: YASREADY_AUDIOBOOKS_VERSION,
    status: session.status,
    chapters: session.chapters.length,
    providerTtsCallsPerformed: 0,
    providerSpendUsd: 0,
    chapterElevenArmed: false,
    nextBatchArmed: false,
    fullBookGenerationArmed: false,
    files: { sessionJson, sessionMd, reviewHtml }
  }, null, 2));
}

async function finalize() {
  const sessionPath = args[1];
  const decisionsPath = flag('--decisions');
  const out = flag('--out');
  if (!sessionPath || !decisionsPath || !out) throw new Error('Usage: node src/cinematic-review-gate-cli.js finalize <session.json> --decisions FILE --out DIR');
  const [session, decisions] = await Promise.all([json(sessionPath), json(decisionsPath)]);
  const approval = finalizeBookOneCinematicHumanReview({ session, decisions });
  const root = path.resolve(out);
  await mkdir(root, { recursive: true });
  const approvalJson = path.join(root, 'cinematic-human-review-approval.json');
  const approvalMd = path.join(root, 'cinematic-human-review-approval.md');
  await Promise.all([
    writeFile(approvalJson, JSON.stringify(approval, null, 2)),
    writeFile(approvalMd, renderBookOneCinematicHumanReviewApprovalMarkdown(approval))
  ]);
  console.log(JSON.stringify({
    version: YASREADY_AUDIOBOOKS_VERSION,
    status: approval.status,
    cinematicRecipeApproved: approval.humanDecision.cinematicRecipeApproved,
    passCount: approval.chapterReview.passCount,
    maybeCount: approval.chapterReview.maybeCount,
    failCount: approval.chapterReview.failCount,
    providerTtsCallsPerformed: 0,
    providerSpendUsd: 0,
    chapterElevenArmed: false,
    nextBatchArmed: false,
    fullBookGenerationArmed: false,
    files: { approvalJson, approvalMd }
  }, null, 2));
}

async function readiness() {
  const planPath = args[1];
  const manuscriptPath = flag('--manuscript');
  const resultPath = flag('--result');
  const lockPath = flag('--lock');
  const approvalPath = flag('--approval');
  const out = flag('--out');
  if (!planPath || !manuscriptPath || !resultPath || !lockPath || !approvalPath || !out) throw new Error('Usage: node src/cinematic-review-gate-cli.js readiness <production-plan.json> --manuscript FILE --result FILE --lock FILE --approval FILE --out DIR');
  const [productionPlan, cinematicResult, cinematicLock, humanReviewApproval] = await Promise.all([
    json(planPath), json(resultPath), json(lockPath), json(approvalPath)
  ]);
  const extracted = extractManuscriptFile(path.resolve(manuscriptPath));
  const manuscriptAnalysis = analyzeManuscript(extracted);
  await loadStoredElevenLabsApiKey();
  const provider = new ElevenLabsProvider();
  const health = await provider.healthCheck();
  if (!health?.ok) throw new Error(`Provider health failed during read-only cinematic next-batch readiness: ${health?.reason ?? health?.status ?? 'unknown'}`);
  const subscription = await provider.subscriptionPreflight();
  if (!subscription?.available || !subscription?.safeToContinue || !subscription.subscription) throw new Error(`Live provider quota is required for cinematic next-batch readiness (${subscription?.reason ?? 'unavailable'})`);
  const quota = extractElevenLabsQuota(subscription.subscription);
  const result = buildBookOneCinematicNextBatchReadiness({
    productionPlan,
    manuscriptAnalysis,
    cinematicResult,
    cinematicLock,
    humanReviewApproval,
    providerRemaining: quota.providerReportedRemaining,
    providerTier: quota.tier
  });
  const root = path.resolve(out);
  await mkdir(root, { recursive: true });
  const jsonPath = path.join(root, 'book-one-cinematic-next-batch-readiness.json');
  const mdPath = path.join(root, 'book-one-cinematic-next-batch-readiness.md');
  await Promise.all([
    writeFile(jsonPath, JSON.stringify(result, null, 2)),
    writeFile(mdPath, renderBookOneCinematicNextBatchReadinessMarkdown(result))
  ]);
  console.log(JSON.stringify({
    version: YASREADY_AUDIOBOOKS_VERSION,
    status: result.status,
    providerTtsCallsPerformed: 0,
    providerSpendUsd: 0,
    candidateChapterCount: result.candidateBatch.chapterCount,
    firstChapterNumber: result.candidateBatch.firstChapterNumber,
    lastChapterNumber: result.candidateBatch.lastChapterNumber,
    candidateProviderCalls: result.candidateBatch.newProviderCalls,
    candidateProviderCharacters: result.candidateBatch.newProviderCharacters,
    providerRemaining: result.liveProvider.providerReportedRemaining,
    previewProtectedMaxUsd: result.budgetPreview.protectedMaxUsd,
    chapterElevenArmed: false,
    nextBatchArmed: false,
    fullBookGenerationArmed: false,
    files: { json: jsonPath, markdown: mdPath }
  }, null, 2));
}

try {
  if (command === 'prepare') await prepare();
  else if (command === 'finalize') await finalize();
  else if (command === 'readiness') await readiness();
  else throw new Error('Usage: node src/cinematic-review-gate-cli.js <prepare|finalize|readiness> ...');
} catch (error) {
  console.error(`\n❌ ${error?.message ?? error}`);
  process.exitCode = 1;
}
