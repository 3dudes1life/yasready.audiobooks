import { createServer } from 'node:http';
import { readFile, writeFile, rename, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import {
  YASREADY_AUDIOBOOKS_VERSION,
  verifyBookOnePauseDeficitAudit,
  buildInitialBookOneHumanPauseReview,
  verifyBookOneHumanPauseReview,
  upsertBookOneHumanPauseDecision,
  prepareBookOneHumanPauseReview,
  renderBookOneHumanPauseReviewHtml,
  applyBookOneApprovedPauseRepairs,
  verifyBookOneApprovedPauseRepairResult,
  renderBookOnePauseRepairResultMarkdown
} from './index.js';

const args = process.argv.slice(2);
const command = args[0];
function flag(name, fallback = null) { const index = args.indexOf(name); return index >= 0 && index + 1 < args.length ? args[index + 1] : fallback; }
async function json(file) { return JSON.parse(await readFile(path.resolve(file), 'utf8')); }
async function exists(file) { try { await stat(file); return true; } catch { return false; } }
async function atomicJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  await writeFile(tmp, JSON.stringify(value, null, 2));
  await rename(tmp, file);
}
function contentType(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.md' || ext === '.txt') return 'text/plain; charset=utf-8';
  if (ext === '.wav') return 'audio/wav';
  if (ext === '.mp3') return 'audio/mpeg';
  return 'application/octet-stream';
}
function safeResolve(root, relative) {
  const base = path.resolve(root);
  const resolved = path.resolve(base, relative);
  if (resolved !== base && !resolved.startsWith(`${base}${path.sep}`)) throw new Error('Path escapes Human Pause Review output root');
  return resolved;
}
async function readBody(req, max = 1024 * 1024) {
  let total = 0; const chunks = [];
  for await (const chunk of req) { total += chunk.length; if (total > max) throw new Error('Request body too large'); chunks.push(chunk); }
  return Buffer.concat(chunks).toString('utf8');
}
function openBrowser(url) {
  if (process.platform !== 'darwin') return;
  const child = spawn('open', [url], { detached: true, stdio: 'ignore' });
  child.unref();
}

async function prepare({ serverMode = false } = {}) {
  const auditPath = args[1];
  const out = flag('--out');
  if (!auditPath || !out) throw new Error('Usage: node src/human-pause-review-cli.js prepare <book-one-pause-deficit-audit.json> --out DIR');
  const audit = await json(auditPath);
  verifyBookOnePauseDeficitAudit(audit);
  const root = path.resolve(out);
  await mkdir(root, { recursive: true });
  const prepared = await prepareBookOneHumanPauseReview({ audit, outDir: root });
  const reviewPath = path.join(root, 'book-one-human-pause-review.json');
  let review = buildInitialBookOneHumanPauseReview(audit);
  if (await exists(reviewPath)) {
    try { const existing = await json(reviewPath); verifyBookOneHumanPauseReview(existing, audit); review = existing; } catch { /* fail closed to a fresh review rather than trusting invalid state */ }
  }
  await atomicJson(reviewPath, review);
  const manifestPath = path.join(root, 'book-one-human-pause-preview-manifest.json');
  await atomicJson(manifestPath, prepared.manifest);
  const dashboardPath = path.join(root, 'book-one-human-pause-review.html');
  await writeFile(dashboardPath, renderBookOneHumanPauseReviewHtml({ audit, previewManifest: prepared.manifest, serverMode }));
  return { audit, root, reviewPath, dashboardPath, manifestPath, manifest: prepared.manifest };
}

async function prepareCommand() {
  const result = await prepare({ serverMode: false });
  console.log(JSON.stringify({
    version: YASREADY_AUDIOBOOKS_VERSION,
    status: 'HUMAN_PAUSE_REVIEW_PACKAGE_READY',
    providerTtsCallsPerformed: 0,
    providerSpendUsd: 0,
    sourceAudioOverwritten: 0,
    dashboard: result.dashboardPath,
    reviewJson: result.reviewPath,
    previewManifest: result.manifestPath
  }, null, 2));
}

async function applyCommand() {
  const auditPath = args[1];
  const reviewPath = flag('--review');
  const out = flag('--out');
  if (!auditPath || !reviewPath || !out) throw new Error('Usage: node src/human-pause-review-cli.js apply <book-one-pause-deficit-audit.json> --review FILE --out DIR');
  const [audit, review] = await Promise.all([json(auditPath), json(reviewPath)]);
  verifyBookOnePauseDeficitAudit(audit);
  verifyBookOneHumanPauseReview(review, audit);
  const result = await applyBookOneApprovedPauseRepairs({ audit, review, outDir: path.resolve(out) });
  verifyBookOneApprovedPauseRepairResult(result);
  const resultJson = path.join(path.resolve(out), 'book-one-pause-repair-result.json');
  const resultMd = path.join(path.resolve(out), 'book-one-pause-repair-result.md');
  await atomicJson(resultJson, result);
  await writeFile(resultMd, renderBookOnePauseRepairResultMarkdown(result));
  console.log(JSON.stringify({
    version: YASREADY_AUDIOBOOKS_VERSION,
    status: result.status,
    chaptersRepaired: result.summary.chaptersRepaired,
    boundariesRepaired: result.summary.boundariesRepaired,
    boundariesVerified: result.summary.boundariesVerified,
    providerTtsCallsPerformed: 0,
    providerSpendUsd: 0,
    sourceAudioFilesOverwritten: 0,
    files: { resultJson, resultMd, repairedAudio: result.chapters.map((row) => row.repairedAudioFile) }
  }, null, 2));
}

async function serveCommand() {
  if (!args[1] || !flag('--out')) throw new Error('Usage: node src/human-pause-review-cli.js serve <book-one-pause-deficit-audit.json> --out DIR [--port PORT]');
  const prepared = await prepare({ serverMode: true });
  const audit = prepared.audit;
  const root = prepared.root;
  const reviewPath = prepared.reviewPath;
  const repairResultPath = path.join(root, 'book-one-pause-repair-result.json');
  const portArg = Number(flag('--port', '0'));
  if (!Number.isInteger(portArg) || portArg < 0 || portArg > 65535) throw new Error('--port must be 0-65535');

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
        const html = await readFile(prepared.dashboardPath);
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); res.end(html); return;
      }
      if (req.method === 'GET' && url.pathname === '/api/state') {
        const review = await json(reviewPath); verifyBookOneHumanPauseReview(review, audit);
        let repairResult = null;
        if (await exists(repairResultPath)) { try { repairResult = await json(repairResultPath); verifyBookOneApprovedPauseRepairResult(repairResult); } catch { repairResult = null; } }
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify({ review, repairResult })); return;
      }
      if (req.method === 'POST' && url.pathname === '/api/decision') {
        const body = JSON.parse(await readBody(req));
        const current = await json(reviewPath); verifyBookOneHumanPauseReview(current, audit);
        const next = upsertBookOneHumanPauseDecision({ audit, review: current, chapterNumber: body.chapterNumber, boundaryOrdinal: body.boundaryOrdinal, decision: body.decision, note: body.note });
        await atomicJson(reviewPath, next);
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(next)); return;
      }
      if (req.method === 'POST' && url.pathname === '/api/apply') {
        const review = await json(reviewPath); verifyBookOneHumanPauseReview(review, audit);
        const result = await applyBookOneApprovedPauseRepairs({ audit, review, outDir: root });
        verifyBookOneApprovedPauseRepairResult(result);
        await atomicJson(repairResultPath, result);
        await writeFile(path.join(root, 'book-one-pause-repair-result.md'), renderBookOnePauseRepairResultMarkdown(result));
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(result)); return;
      }
      if (req.method === 'GET' && url.pathname.startsWith('/files/')) {
        const rel = decodeURIComponent(url.pathname.slice('/files/'.length));
        const file = safeResolve(root, rel);
        if (!(await exists(file))) { res.writeHead(404); res.end('Not found'); return; }
        const data = await readFile(file);
        res.writeHead(200, { 'content-type': contentType(file), 'cache-control': 'no-store' }); res.end(data); return;
      }
      res.writeHead(404); res.end('Not found');
    } catch (error) {
      res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
      res.end(error?.message ?? String(error));
    }
  });

  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(portArg, '127.0.0.1', resolve); });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : portArg;
  const url = `http://127.0.0.1:${port}/`;
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`YasReady Audiobooks ${YASREADY_AUDIOBOOKS_VERSION} — Human Pause Review`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`Review page: ${url}`);
  console.log(`Autosave JSON: ${reviewPath}`);
  console.log('0 provider calls / 0 TTS / source audio immutable / Chapter 11 OFF');
  console.log('Keep this Terminal window open while using the review page. Press Control-C when finished.\n');
  openBrowser(url);
  const shutdown = () => server.close(() => process.exit(0));
  process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
}

try {
  if (command === 'prepare') await prepareCommand();
  else if (command === 'apply') await applyCommand();
  else if (command === 'serve') await serveCommand();
  else throw new Error('Usage: node src/human-pause-review-cli.js <prepare|serve|apply> ...');
} catch (error) {
  console.error(`\n❌ ${error?.message ?? error}`);
  process.exitCode = 1;
}
