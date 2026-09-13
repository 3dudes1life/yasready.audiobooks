import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  YASREADY_AUDIOBOOKS_VERSION,
  extractManuscriptFile,
  analyzeManuscript,
  buildBookOnePauseFidelityPlan,
  renderBookOnePauseFidelityMarkdown,
  renderBookOnePauseFidelityHtml
} from './index.js';

const args = process.argv.slice(2);
const command = args[0];

function flag(name, fallback = null) {
  const index = args.indexOf(name);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : fallback;
}
async function json(file) { return JSON.parse(await readFile(path.resolve(file), 'utf8')); }

async function plan() {
  const productionPlanPath = args[1];
  const manuscriptPath = flag('--manuscript');
  const cinematicResultPath = flag('--result');
  const cinematicLockPath = flag('--lock');
  const reviewPath = flag('--review');
  const out = flag('--out');

  if (!productionPlanPath || !manuscriptPath || !cinematicResultPath || !cinematicLockPath || !out) {
    throw new Error('Usage: node src/pause-fidelity-cli.js plan <production-plan.json> --manuscript FILE --result FILE --lock FILE [--review FILE] --out DIR');
  }

  const [productionPlan, cinematicResult, cinematicLock] = await Promise.all([
    json(productionPlanPath),
    json(cinematicResultPath),
    json(cinematicLockPath)
  ]);
  const humanReviewDecisions = reviewPath ? await json(reviewPath) : null;
  const extractedManuscript = extractManuscriptFile(path.resolve(manuscriptPath));
  const manuscriptAnalysis = analyzeManuscript(extractedManuscript);

  const pausePlan = buildBookOnePauseFidelityPlan({
    extractedManuscript,
    manuscriptAnalysis,
    productionPlan,
    cinematicResult,
    cinematicLock,
    humanReviewDecisions
  });

  const root = path.resolve(out);
  await mkdir(root, { recursive: true });
  const planJson = path.join(root, 'book-one-pause-fidelity-plan.json');
  const planMarkdown = path.join(root, 'book-one-pause-fidelity-plan.md');
  const dashboardHtml = path.join(root, 'book-one-pause-fidelity-dashboard.html');

  await Promise.all([
    writeFile(planJson, JSON.stringify(pausePlan, null, 2)),
    writeFile(planMarkdown, renderBookOnePauseFidelityMarkdown(pausePlan)),
    writeFile(dashboardHtml, renderBookOnePauseFidelityHtml(pausePlan))
  ]);

  console.log(JSON.stringify({
    version: YASREADY_AUDIOBOOKS_VERSION,
    status: pausePlan.status,
    paragraphLayoutAvailable: pausePlan.source.paragraphLayoutAvailable,
    firstTenStructuralBoundaries: pausePlan.summary.firstTenStructuralBoundaries,
    firstTenLocalAssemblyRepairCandidates: pausePlan.summary.firstTenLocalAssemblyRepairCandidates,
    firstTenBoundariesNeedingLocalization: pausePlan.summary.firstTenBoundariesNeedingLocalization,
    reviewPresent: pausePlan.reviewEvidence.present,
    heardAllTen: pausePlan.reviewEvidence.heardAllTen,
    reviewCounts: pausePlan.reviewEvidence.chapterCounts,
    canonicalWordsChanged: false,
    providerTtsCallsPerformed: 0,
    providerSpendUsd: 0,
    repairAudioWritten: false,
    chapterElevenArmed: false,
    nextBatchArmed: false,
    fullBookGenerationArmed: false,
    files: { planJson, planMarkdown, dashboardHtml }
  }, null, 2));
}

try {
  if (command === 'plan') await plan();
  else throw new Error('Usage: node src/pause-fidelity-cli.js plan ...');
} catch (error) {
  console.error(`\n❌ ${error?.message ?? error}`);
  process.exitCode = 1;
}
