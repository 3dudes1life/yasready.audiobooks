import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  FfmpegAdapter,
  renderBookOneVoiceDepthCalibration,
  finalizeBookOneVoiceDepthCalibration,
  renderBookOneVoiceDepthFinalizationMarkdown,
  YASREADY_AUDIOBOOKS_VERSION
} from './index.js';

const args = process.argv.slice(2);
function flag(name, fallback = null) {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
}
async function json(file) { return JSON.parse(await readFile(path.resolve(file), 'utf8')); }

async function findMatchingPilotResult(root, renderDigest) {
  const base = path.resolve(root);
  const candidates = [];
  async function walk(dir, depth = 0) {
    if (depth > 3) return;
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full, depth + 1);
      else if (entry.isFile() && entry.name === 'chapter-one-pilot-result.json') {
        try {
          const value = await json(full);
          if (value?.integrity?.renderDigest === renderDigest) {
            const meta = await stat(full);
            candidates.push({ file: full, root: path.dirname(full), mtimeMs: meta.mtimeMs });
          }
        } catch {}
      }
    }
  }
  await walk(base);
  candidates.sort((a,b) => b.mtimeMs - a.mtimeMs);
  return candidates[0] ?? null;
}

async function runCalibration() {
  const feedbackPath = args[1];
  const pilotResultPath = flag('--pilot-result');
  const pilotRootFlag = flag('--pilot-root');
  const searchRoot = flag('--search-root', path.join(process.env.HOME ?? '', 'Desktop'));
  const out = flag('--out');
  if (!feedbackPath || !out) {
    console.error('Usage: node src/voice-depth-cli.js render <chapter-one-pilot-feedback.json> --out DIR [--pilot-result FILE --pilot-root DIR] [--search-root DIR]');
    process.exitCode = 2; return;
  }
  const feedback = await json(feedbackPath);
  let found = null;
  if (pilotResultPath) found = { file: path.resolve(pilotResultPath), root: path.resolve(pilotRootFlag ?? path.dirname(pilotResultPath)) };
  else found = await findMatchingPilotResult(searchRoot, feedback.renderDigest);
  if (!found) throw new Error(`Could not find chapter-one-pilot-result.json matching renderDigest ${feedback.renderDigest} under ${searchRoot}`);
  const pilotResult = await json(found.file);
  const ffmpeg = new FfmpegAdapter();
  const result = await renderBookOneVoiceDepthCalibration({ pilotResult, pilotFeedback: feedback, pilotRoot: found.root, ffmpeg, outDir: out });
  console.log(JSON.stringify({
    version: YASREADY_AUDIOBOOKS_VERSION,
    voiceDepthCalibration: result.status,
    sourcePilotRelease: result.sourcePilot.release,
    narrator: result.lockedPerformance.narrator.narratorName,
    effectiveSpeed: result.lockedPerformance.paceProfile.effectiveSpeed,
    providerTtsCalls: result.cost.providerTtsCalls,
    providerTtsSpendUsd: result.cost.providerTtsSpendUsd,
    variants: result.variants.map(v => ({ id:v.id, label:v.label, semitones:v.semitones, technicalQaPassed:v.technicalQa?.passed })),
    productionArmed: result.guardrails.productionArmed,
    fullBookGenerationArmed: result.guardrails.fullBookGenerationArmed,
    reviewBoard: path.join(path.resolve(out), 'voice-depth-review.html'),
    feedbackTemplate: path.join(path.resolve(out), 'voice-depth-feedback-template.json'),
    nextAction: result.nextAction
  }, null, 2));
}

async function runFinalize() {
  const feedbackPath = args[1];
  const calibrationPath = flag('--calibration');
  const out = flag('--out');
  if (!feedbackPath || !calibrationPath || !out) {
    console.error('Usage: node src/voice-depth-cli.js finalize <voice-depth-feedback.json> --calibration <voice-depth-calibration.json> --out DIR');
    process.exitCode = 2; return;
  }
  const [feedback, calibration] = await Promise.all([json(feedbackPath), json(calibrationPath)]);
  const result = finalizeBookOneVoiceDepthCalibration({ calibration, feedback });
  const resolved = path.resolve(out);
  await mkdir(resolved, { recursive: true });
  await Promise.all([
    writeFile(path.join(resolved, 'voice-depth-finalization.json'), JSON.stringify(result, null, 2)),
    writeFile(path.join(resolved, 'voice-depth-finalization.md'), renderBookOneVoiceDepthFinalizationMarkdown(result)),
    ...(result.localVoiceFinishLock ? [writeFile(path.join(resolved, 'local-voice-finish-lock.json'), JSON.stringify(result.localVoiceFinishLock, null, 2))] : [])
  ]);
  console.log(JSON.stringify({ version:YASREADY_AUDIOBOOKS_VERSION, status:result.status, decision:result.decision, localVoiceFinishLockCreated:result.localVoiceFinishLockCreated, winner:result.winner ?? null, productionArmed:result.productionArmed, fullBookGenerationArmed:result.fullBookGenerationArmed, nextAction:result.nextAction }, null, 2));
}

if (args[0] === 'render') await runCalibration();
else if (args[0] === 'finalize') await runFinalize();
else {
  console.error('Usage: node src/voice-depth-cli.js <render|finalize> ...');
  process.exitCode = 2;
}
