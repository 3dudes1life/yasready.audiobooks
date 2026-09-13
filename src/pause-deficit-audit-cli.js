import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  YASREADY_AUDIOBOOKS_VERSION,
  extractManuscriptFile,
  analyzeManuscript,
  buildBookOnePauseFidelityPlan,
  inspectBookOnePauseAudio,
  buildBookOnePauseDeficitAudit,
  verifyBookOnePauseDeficitAudit,
  renderBookOnePauseDeficitAuditMarkdown,
  renderBookOnePauseDeficitAuditHtml
} from './index.js';

const args = process.argv.slice(2);
const command = args[0];
function flag(name, fallback = null) { const index = args.indexOf(name); return index >= 0 && index + 1 < args.length ? args[index + 1] : fallback; }
async function json(file) { return JSON.parse(await readFile(path.resolve(file), 'utf8')); }

async function audit() {
  const productionPlanPath = args[1];
  const manuscriptPath = flag('--manuscript');
  const cinematicResultPath = flag('--result');
  const cinematicLockPath = flag('--lock');
  const reviewPath = flag('--review');
  const audioRoot = flag('--audio-root');
  const out = flag('--out');
  if (!productionPlanPath || !manuscriptPath || !cinematicResultPath || !cinematicLockPath || !out) {
    throw new Error('Usage: node src/pause-deficit-audit-cli.js audit <production-plan.json> --manuscript FILE --result FILE --lock FILE [--review FILE] [--audio-root DIR] --out DIR');
  }

  const [productionPlan, cinematicResult, cinematicLock] = await Promise.all([
    json(productionPlanPath), json(cinematicResultPath), json(cinematicLockPath)
  ]);
  const humanReviewDecisions = reviewPath ? await json(reviewPath) : null;
  const extractedManuscript = extractManuscriptFile(path.resolve(manuscriptPath));
  const manuscriptAnalysis = analyzeManuscript(extractedManuscript);
  const pausePlan = buildBookOnePauseFidelityPlan({ extractedManuscript, manuscriptAnalysis, productionPlan, cinematicResult, cinematicLock, humanReviewDecisions });
  const audioEvidence = await inspectBookOnePauseAudio({ cinematicResult, audioRoot });
  const deficitAudit = buildBookOnePauseDeficitAudit({ pausePlan, cinematicResult, audioEvidence });
  verifyBookOnePauseDeficitAudit(deficitAudit);

  const root = path.resolve(out);
  await mkdir(root, { recursive: true });
  const pausePlanJson = path.join(root, 'source-pause-fidelity-plan.json');
  const auditJson = path.join(root, 'book-one-pause-deficit-audit.json');
  const auditMarkdown = path.join(root, 'book-one-pause-deficit-audit.md');
  const dashboardHtml = path.join(root, 'book-one-pause-deficit-dashboard.html');
  await Promise.all([
    writeFile(pausePlanJson, JSON.stringify(pausePlan, null, 2)),
    writeFile(auditJson, JSON.stringify(deficitAudit, null, 2)),
    writeFile(auditMarkdown, renderBookOnePauseDeficitAuditMarkdown(deficitAudit)),
    writeFile(dashboardHtml, renderBookOnePauseDeficitAuditHtml(deficitAudit))
  ]);

  console.log(JSON.stringify({
    version: YASREADY_AUDIOBOOKS_VERSION,
    status: deficitAudit.status,
    chaptersAudited: deficitAudit.summary.chaptersAudited,
    chapterAudioFilesDigestVerified: deficitAudit.summary.chapterAudioFilesDigestVerified,
    structuralBoundaries: deficitAudit.summary.structuralBoundaries,
    localizedHighConfidence: deficitAudit.summary.localizedHighConfidence,
    passNoChange: deficitAudit.summary.passNoChange,
    deficitCandidates: deficitAudit.summary.deficitCandidates,
    localRepairSafe: deficitAudit.summary.localRepairSafe,
    deficitCandidatesNeedingManualConfirmation: deficitAudit.summary.deficitCandidatesNeedingManualConfirmation,
    unresolved: deficitAudit.summary.unresolved,
    providerCallsPerformed: 0,
    providerTtsCallsPerformed: 0,
    providerSpendUsd: 0,
    audioWritesPerformed: 0,
    repairAuthorized: false,
    chapterElevenArmed: false,
    nextBatchArmed: false,
    fullBookGenerationArmed: false,
    files: { pausePlanJson, auditJson, auditMarkdown, dashboardHtml }
  }, null, 2));
}

try {
  if (command === 'audit') await audit();
  else throw new Error('Usage: node src/pause-deficit-audit-cli.js audit ...');
} catch (error) {
  console.error(`\n❌ ${error?.message ?? error}`);
  process.exitCode = 1;
}
