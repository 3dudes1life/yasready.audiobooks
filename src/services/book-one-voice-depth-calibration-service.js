import { copyFile, mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { YASREADY_AUDIOBOOKS_VERSION } from '../release.js';
import { sha256, stableJson } from '../core/hash.js';
import { evaluateMasterAgainstProfile } from '../mastering/profiles.js';

export const BOOK_ONE_VOICE_DEPTH_ACCEPTED_PILOT_RELEASES = Object.freeze(['0.14.3.14.1', '0.14.3.14.2', '0.14.3.15', '0.14.3.16']);
export const BOOK_ONE_VOICE_DEPTH_MASTERING_PROFILE = 'acx-2026';
export const BOOK_ONE_VOICE_DEPTH_SEMITONES = -0.5;
export const BOOK_ONE_VOICE_DEPTH_PITCH_FACTOR = Number((2 ** (BOOK_ONE_VOICE_DEPTH_SEMITONES / 12)).toFixed(9));
export const BOOK_ONE_VOICE_DEPTH_DURATION_COMPENSATION = Number((1 / BOOK_ONE_VOICE_DEPTH_PITCH_FACTOR).toFixed(9));

const VARIANTS = Object.freeze([
  Object.freeze({
    id: 'original-reference',
    label: 'Original Locked Pilot',
    kind: 'reference',
    goal: 'Keep the approved pace, emotion and current voice tone unchanged.',
    eq: null,
    semitones: 0,
    pitchFactor: 1,
    durationCompensation: 1
  }),
  Object.freeze({
    id: 'warm-detinned',
    label: 'Warm / De-Tin',
    kind: 'local-tone',
    goal: 'Keep pitch and pace unchanged while adding a little body and reducing metallic/tinny upper-mid presence.',
    eq: Object.freeze({ bodyHz: 180, bodyDb: 1.2, presenceHz: 3000, presenceDb: -1.6, airHz: 5200, airDb: -0.8 }),
    semitones: 0,
    pitchFactor: 1,
    durationCompensation: 1
  }),
  Object.freeze({
    id: 'warm-slightly-deeper',
    label: 'Warm + Slightly Deeper',
    kind: 'local-tone-and-pitch',
    goal: 'Use the same de-tin EQ plus a restrained half-semitone pitch drop while preserving the locked finished pace.',
    eq: Object.freeze({ bodyHz: 180, bodyDb: 1.2, presenceHz: 3000, presenceDb: -1.6, airHz: 5200, airDb: -0.8 }),
    semitones: BOOK_ONE_VOICE_DEPTH_SEMITONES,
    pitchFactor: BOOK_ONE_VOICE_DEPTH_PITCH_FACTOR,
    durationCompensation: BOOK_ONE_VOICE_DEPTH_DURATION_COMPENSATION
  })
]);

function freeze(value) {
  if (Array.isArray(value)) {
    for (const item of value) freeze(item);
    return Object.freeze(value);
  }
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    return Object.freeze(value);
  }
  return value;
}

function clean(value) { return String(value ?? '').trim(); }
function round(value, digits = 6) {
  const f = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * f) / f;
}
async function exists(file) { try { await stat(file); return true; } catch { return false; } }
async function fileDigest(file) {
  const bytes = await readFile(file);
  return sha256(bytes.toString('base64'));
}

function pilotCore(result) {
  return {
    schemaVersion: result.schemaVersion,
    release: result.release,
    artifact: result.artifact,
    status: result.status,
    book: result.book,
    armDigest: result.armDigest,
    productionPlanDigest: result.productionPlanDigest,
    chapter: result.chapter,
    narrator: result.narrator,
    lockedRecipe: result.lockedRecipe,
    provider: result.provider,
    localProcessing: result.localProcessing,
    cost: result.cost,
    technicalQa: result.technicalQa,
    outputs: result.outputs,
    guardrails: result.guardrails
  };
}

export function verifyVoiceDepthSource({ pilotResult, pilotFeedback } = {}) {
  if (!pilotResult || pilotResult.artifact !== 'book-one-chapter-one-pilot-render') throw new Error('Voice Depth Calibration requires chapter-one-pilot-result.json');
  if (!BOOK_ONE_VOICE_DEPTH_ACCEPTED_PILOT_RELEASES.includes(pilotResult.release)) throw new Error('Pilot result release is not accepted for Voice Depth Calibration');
  if (!['READY_FOR_HUMAN_PILOT_REVIEW', 'TECHNICAL_QA_REVIEW_REQUIRED'].includes(pilotResult.status)) throw new Error('Pilot result is not reviewable');
  if (!pilotResult.integrity?.renderDigest) throw new Error('Pilot result is missing render digest');
  if (sha256(stableJson(pilotCore(pilotResult))) !== pilotResult.integrity.renderDigest) throw new Error('Pilot render integrity digest mismatch');
  if (pilotResult.guardrails?.productionArmed !== false || pilotResult.guardrails?.fullBookGenerationArmed !== false) throw new Error('Voice Depth Calibration refuses an armed full-production state');
  if (!pilotFeedback || pilotFeedback.artifact !== 'book-one-chapter-one-pilot-human-feedback') throw new Error('Voice Depth Calibration requires chapter-one-pilot-feedback.json');
  if (pilotFeedback.renderDigest !== pilotResult.integrity.renderDigest) throw new Error('Pilot feedback does not belong to this pilot render');
  if (pilotFeedback.armDigest !== pilotResult.armDigest) throw new Error('Pilot feedback arm digest mismatch');
  if (clean(pilotFeedback.decision).toLowerCase() !== 'maybe') throw new Error('Voice Depth Calibration requires a MAYBE pilot decision');
  if (!clean(pilotFeedback.notes)) throw new Error('Voice Depth Calibration requires the human tuning note');
  return true;
}

function calibrationCore(result) {
  return {
    schemaVersion: result.schemaVersion,
    release: result.release,
    artifact: result.artifact,
    status: result.status,
    book: result.book,
    chapter: result.chapter,
    sourcePilot: result.sourcePilot,
    lockedPerformance: result.lockedPerformance,
    humanEvidence: result.humanEvidence,
    variants: result.variants,
    processing: result.processing,
    cost: result.cost,
    guardrails: result.guardrails
  };
}

export function verifyBookOneVoiceDepthCalibration(result) {
  if (!result || result.artifact !== 'book-one-voice-depth-calibration') throw new Error('Invalid Voice Depth Calibration result');
  if (result.release !== YASREADY_AUDIOBOOKS_VERSION) throw new Error('Voice Depth Calibration release mismatch');
  if (!['READY_FOR_HUMAN_VOICE_DEPTH_REVIEW', 'TECHNICAL_QA_REVIEW_REQUIRED'].includes(result.status)) throw new Error('Voice Depth Calibration status is invalid');
  if (result.cost?.providerTtsCalls !== 0 || result.cost?.providerTtsSpendUsd !== 0) throw new Error('Voice Depth Calibration must remain zero-TTS and zero-provider-spend');
  if (result.guardrails?.productionArmed !== false || result.guardrails?.fullBookGenerationArmed !== false) throw new Error('Voice Depth Calibration cannot arm full production');
  if (!result.integrity?.calibrationDigest) throw new Error('Voice Depth Calibration digest missing');
  if (sha256(stableJson(calibrationCore(result))) !== result.integrity.calibrationDigest) throw new Error('Voice Depth Calibration digest mismatch');
  return true;
}

export async function renderBookOneVoiceDepthCalibration({
  pilotResult,
  pilotFeedback,
  pilotRoot,
  ffmpeg,
  outDir
} = {}) {
  verifyVoiceDepthSource({ pilotResult, pilotFeedback });
  if (!pilotRoot || !outDir) throw new Error('Voice Depth Calibration requires pilotRoot and outDir');
  if (!ffmpeg?.healthCheck || !ffmpeg?.voiceDepth || !ffmpeg?.master || !ffmpeg?.analyze) throw new Error('Voice Depth Calibration requires FFmpeg voiceDepth + mastering support');
  const health = await ffmpeg.healthCheck();
  if (!health?.ok) throw new Error(`FFmpeg preflight failed before local Voice Depth Calibration: ${health?.reason ?? 'unknown'}`);

  const pilotBase = path.resolve(pilotRoot);
  const assemblyPath = path.join(pilotBase, pilotResult.outputs.effectivePaceAssembly);
  const masterPath = path.join(pilotBase, pilotResult.outputs.masteredPilot);
  if (!(await exists(assemblyPath)) || !(await exists(masterPath))) throw new Error('Pilot source audio is missing; preserve the completed Chapter One pilot directory');
  const [assemblyDigest, masterDigest] = await Promise.all([fileDigest(assemblyPath), fileDigest(masterPath)]);
  if (assemblyDigest !== pilotResult.outputs.effectivePaceAssemblySha256) throw new Error('Pilot effective-pace assembly digest mismatch; refuse local calibration');
  if (masterDigest !== pilotResult.outputs.masteredPilotSha256) throw new Error('Pilot mastered audio digest mismatch; refuse local calibration');

  const resolved = path.resolve(outDir);
  const sourceDir = path.join(resolved, 'source');
  const workDir = path.join(resolved, 'work');
  const audioDir = path.join(resolved, 'audio');
  await Promise.all([mkdir(sourceDir, { recursive: true }), mkdir(workDir, { recursive: true }), mkdir(audioDir, { recursive: true })]);

  const referencePath = path.join(audioDir, '01-original-locked-pilot.mp3');
  await copyFile(masterPath, referencePath);
  const referenceAnalysis = await ffmpeg.analyze(referencePath);
  const referenceQa = evaluateMasterAgainstProfile(referenceAnalysis, BOOK_ONE_VOICE_DEPTH_MASTERING_PROFILE);
  const rendered = [{
    ...VARIANTS[0],
    outputRelativePath: path.relative(resolved, referencePath),
    audioSha256: await fileDigest(referencePath),
    technicalQa: referenceQa,
    analysis: referenceAnalysis
  }];

  for (const [index, variant] of VARIANTS.slice(1).entries()) {
    const processedWav = path.join(workDir, `${variant.id}.wav`);
    const outputMp3 = path.join(audioDir, `${String(index + 2).padStart(2, '0')}-${variant.id}.mp3`);
    const processing = await ffmpeg.voiceDepth(assemblyPath, processedWav, { mode: variant.id });
    await ffmpeg.master(processedWav, outputMp3, BOOK_ONE_VOICE_DEPTH_MASTERING_PROFILE);
    const analysis = await ffmpeg.analyze(outputMp3);
    const qa = evaluateMasterAgainstProfile(analysis, BOOK_ONE_VOICE_DEPTH_MASTERING_PROFILE);
    rendered.push({
      ...variant,
      processing,
      outputRelativePath: path.relative(resolved, outputMp3),
      audioSha256: await fileDigest(outputMp3),
      technicalQa: qa,
      analysis
    });
  }

  const anyQaFailure = rendered.some((variant) => !variant.technicalQa?.passed);
  const base = {
    schemaVersion: 1,
    release: YASREADY_AUDIOBOOKS_VERSION,
    artifact: 'book-one-voice-depth-calibration',
    status: anyQaFailure ? 'TECHNICAL_QA_REVIEW_REQUIRED' : 'READY_FOR_HUMAN_VOICE_DEPTH_REVIEW',
    book: pilotResult.book,
    chapter: pilotResult.chapter,
    sourcePilot: freeze({
      release: pilotResult.release,
      armDigest: pilotResult.armDigest,
      renderDigest: pilotResult.integrity.renderDigest,
      effectivePaceAssemblySha256: assemblyDigest,
      masteredPilotSha256: masterDigest
    }),
    lockedPerformance: freeze({
      narrator: pilotResult.narrator,
      direction: pilotResult.lockedRecipe.direction,
      providerVoiceSettings: pilotResult.lockedRecipe.providerVoiceSettings,
      paceProfile: pilotResult.lockedRecipe.paceProfile,
      unchangedByThisCalibration: true
    }),
    humanEvidence: freeze({
      pilotDecision: 'maybe',
      note: pilotFeedback.notes,
      preserve: freeze(['pace', 'emotional depth', 'overall performance']),
      calibrateOnly: 'local finished voice tone/depth'
    }),
    variants: freeze(rendered.map((variant) => freeze(variant))),
    processing: freeze({
      source: 'already-paid Chapter One pilot audio',
      providerGenerationRequired: false,
      eqPolicy: 'subtle local body lift + restrained upper-mid/air reduction; no provider voice recast',
      deeperPitchSemitones: BOOK_ONE_VOICE_DEPTH_SEMITONES,
      deeperPitchFactor: BOOK_ONE_VOICE_DEPTH_PITCH_FACTOR,
      durationCompensation: BOOK_ONE_VOICE_DEPTH_DURATION_COMPENSATION,
      finishedPacePreserved: true,
      formantPreservationClaimed: false,
      masteringProfile: BOOK_ONE_VOICE_DEPTH_MASTERING_PROFILE
    }),
    cost: freeze({ providerTtsCalls: 0, providerTtsSpendUsd: 0, localProcessingUsd: 0 }),
    guardrails: freeze({
      sourcePaidAudioReused: true,
      noProviderApiRequired: true,
      noNewTtsAllowed: true,
      productionArmed: false,
      fullBookGenerationArmed: false,
      chapterTwoOrLaterGenerated: false,
      humanPassRequiredForVoiceFinishLock: true,
      identityInferenceFromAudio: false
    })
  };
  const calibrationDigest = sha256(stableJson(calibrationCore(base)));
  const result = freeze({
    ...base,
    integrity: freeze({ calibrationDigest }),
    nextAction: anyQaFailure
      ? 'Review technical QA before locking any local voice finish. Full-book generation remains unarmed.'
      : 'Compare the three local variants and PASS at most one. Full-book generation remains unarmed.'
  });
  verifyBookOneVoiceDepthCalibration(result);

  await Promise.all([
    writeFile(path.join(resolved, 'voice-depth-calibration.json'), JSON.stringify(result, null, 2)),
    writeFile(path.join(resolved, 'voice-depth-review.html'), renderBookOneVoiceDepthReviewHtml(result)),
    writeFile(path.join(resolved, 'voice-depth-feedback-template.json'), JSON.stringify(bookOneVoiceDepthFeedbackTemplate(result), null, 2))
  ]);
  return result;
}

export function bookOneVoiceDepthFeedbackTemplate(calibration) {
  verifyBookOneVoiceDepthCalibration(calibration);
  return {
    schemaVersion: 1,
    release: YASREADY_AUDIOBOOKS_VERSION,
    artifact: 'book-one-voice-depth-human-feedback',
    calibrationDigest: calibration.integrity.calibrationDigest,
    sourcePilotRenderDigest: calibration.sourcePilot.renderDigest,
    feedback: calibration.variants.map((variant) => ({
      variantId: variant.id,
      variantLabel: variant.label,
      decision: '',
      notes: ''
    })),
    exportedAt: null
  };
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function renderBookOneVoiceDepthReviewHtml(calibration) {
  verifyBookOneVoiceDepthCalibration(calibration);
  const template = JSON.stringify(bookOneVoiceDepthFeedbackTemplate(calibration)).replace(/</g, '\\u003c');
  const cards = calibration.variants.map((variant, index) => `
  <section class="card">
    <div class="num">${index + 1}</div><h2>${escapeHtml(variant.label)}</h2>
    <p>${escapeHtml(variant.goal)}</p>
    <audio controls preload="metadata" src="${escapeHtml(variant.outputRelativePath)}"></audio>
    <div class="meta">Pitch: ${variant.semitones === 0 ? 'unchanged' : `${variant.semitones} semitone`} · Pace: unchanged at effective ${Number(calibration.lockedPerformance.paceProfile.effectiveSpeed).toFixed(2)}x · QA: ${variant.technicalQa?.passed ? 'PASS' : 'REVIEW'}</div>
    <div class="decisions" data-variant="${escapeHtml(variant.id)}">
      <button data-decision="pass">PASS — Lock this</button><button data-decision="maybe">MAYBE</button><button data-decision="fail">FAIL</button>
    </div>
    <textarea data-notes="${escapeHtml(variant.id)}" placeholder="Optional notes for this version"></textarea>
  </section>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Book One Voice Depth Calibration</title>
<style>:root{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text",Inter,system-ui,sans-serif;color:#111;background:#f5f5f7}body{margin:0;padding:28px}.wrap{max-width:960px;margin:auto}.hero,.card{background:rgba(255,255,255,.96);border:1px solid #e5e5ea;border-radius:24px;box-shadow:0 12px 40px rgba(0,0,0,.06)}.hero{padding:30px}.card{padding:24px;margin-top:18px;position:relative}.num{position:absolute;right:22px;top:18px;font-size:30px;font-weight:800;color:#d1d1d6}h1{font-size:34px;letter-spacing:-.03em;margin:0 0 8px}h2{font-size:22px;margin:0 0 8px}.muted,.meta{color:#6e6e73}.pill{display:inline-block;padding:7px 11px;border-radius:999px;background:#efeff4;margin:6px 6px 0 0;font-size:13px}audio{width:100%;margin:14px 0}.decisions{display:flex;gap:9px;flex-wrap:wrap;margin:12px 0}.decisions button{border:0;border-radius:13px;padding:11px 15px;font-weight:700;cursor:pointer;background:#e9e9ee}.decisions button.selected{outline:3px solid #111}.decisions button[data-decision=pass]{background:#dff7e6}.decisions button[data-decision=maybe]{background:#fff1c9}.decisions button[data-decision=fail]{background:#ffe0e0}textarea{width:100%;min-height:72px;border:1px solid #d2d2d7;border-radius:14px;padding:12px;font:inherit;box-sizing:border-box}.download{margin-top:18px;background:#111;color:#fff;border:0;border-radius:14px;padding:13px 18px;font-weight:750;cursor:pointer}.warning{background:#fff5d6;border-radius:16px;padding:14px;margin-top:14px}</style></head>
<body><div class="wrap"><div class="hero"><div class="muted">YasReady Audiobooks ${escapeHtml(calibration.release)}</div><h1>Voice Depth Calibration</h1><p>Same Ryan performance. Same pace. Same emotional depth. We are changing only the local finished voice tone so you can judge the “tinny” concern without buying another TTS take.</p><span class="pill">${escapeHtml(calibration.lockedPerformance.narrator.narratorName)}</span><span class="pill">Deep Controlled Emotion</span><span class="pill">Effective ${Number(calibration.lockedPerformance.paceProfile.effectiveSpeed).toFixed(2)}x</span><span class="pill">$0 new TTS spend</span><div class="warning"><strong>PASS at most one.</strong> A PASS locks only the local voice finish recipe. Full-book generation stays OFF.</div></div>${cards}<button class="download" id="download">Download Voice Depth Feedback</button></div>
<script>const data=${template};const decisions=new Map();document.querySelectorAll('.decisions button').forEach(btn=>btn.addEventListener('click',()=>{const box=btn.closest('.decisions');const id=box.dataset.variant;box.querySelectorAll('button').forEach(x=>x.classList.remove('selected'));btn.classList.add('selected');decisions.set(id,btn.dataset.decision)}));document.getElementById('download').addEventListener('click',()=>{data.feedback=data.feedback.map(row=>({...row,decision:decisions.get(row.variantId)||'',notes:document.querySelector('[data-notes="'+row.variantId+'"]').value||''}));const passes=data.feedback.filter(x=>x.decision==='pass').length;if(passes>1){alert('PASS at most one version.');return;}data.exportedAt=new Date().toISOString();const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='voice-depth-feedback.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)});</script></body></html>`;
}

export function finalizeBookOneVoiceDepthCalibration({ calibration, feedback } = {}) {
  verifyBookOneVoiceDepthCalibration(calibration);
  if (!feedback || feedback.artifact !== 'book-one-voice-depth-human-feedback') throw new Error('Invalid voice-depth-feedback.json');
  if (feedback.calibrationDigest !== calibration.integrity.calibrationDigest) throw new Error('Voice Depth feedback does not belong to this calibration');
  const rows = calibration.variants.map((variant) => {
    const source = (feedback.feedback ?? []).find((x) => x.variantId === variant.id);
    const decision = clean(source?.decision).toLowerCase() || null;
    if (decision && !['pass', 'maybe', 'fail'].includes(decision)) throw new Error(`Unknown Voice Depth decision for ${variant.id}: ${decision}`);
    return { variant, decision, notes: clean(source?.notes) };
  });
  const passes = rows.filter((row) => row.decision === 'pass');
  if (passes.length > 1) throw new Error('Voice Depth Calibration allows only one PASS');
  if (!passes.length) {
    const anyMaybe = rows.some((row) => row.decision === 'maybe');
    const allFail = rows.every((row) => row.decision === 'fail');
    return freeze({
      schemaVersion: 1,
      release: YASREADY_AUDIOBOOKS_VERSION,
      artifact: 'book-one-voice-depth-finalization',
      status: anyMaybe ? 'NEEDS_TUNING' : allFail ? 'FAILED' : 'INCOMPLETE',
      decision: anyMaybe ? 'maybe' : allFail ? 'fail' : 'incomplete',
      localVoiceFinishLockCreated: false,
      productionArmed: false,
      fullBookGenerationArmed: false,
      choices: freeze(rows.map((row) => freeze({ variantId: row.variant.id, variantLabel: row.variant.label, decision: row.decision, notes: row.notes }))),
      nextAction: anyMaybe ? 'Keep tuning local voice finish only; narrator performance and pace remain locked.' : 'Do not scale production. Full-book generation remains off.'
    });
  }
  const winner = passes[0];
  if (!winner.variant.technicalQa?.passed) throw new Error('Cannot PASS a Voice Depth variant with blocking technical QA');
  const finishCore = {
    schemaVersion: 1,
    release: YASREADY_AUDIOBOOKS_VERSION,
    artifact: 'book-one-local-voice-finish-lock',
    status: 'LOCKED_FOR_PRODUCTION_PLANNING_ONLY',
    sourcePilotRenderDigest: calibration.sourcePilot.renderDigest,
    narrator: calibration.lockedPerformance.narrator,
    performanceUnchanged: true,
    providerVoiceSettingsUnchanged: calibration.lockedPerformance.providerVoiceSettings,
    paceProfileUnchanged: calibration.lockedPerformance.paceProfile,
    selectedVariant: {
      id: winner.variant.id,
      label: winner.variant.label,
      kind: winner.variant.kind,
      eq: winner.variant.eq,
      semitones: winner.variant.semitones,
      pitchFactor: winner.variant.pitchFactor,
      durationCompensation: winner.variant.durationCompensation,
      formantPreservationClaimed: false
    },
    productionArmed: false,
    fullBookGenerationArmed: false
  };
  const finishDigest = sha256(stableJson(finishCore));
  return freeze({
    schemaVersion: 1,
    release: YASREADY_AUDIOBOOKS_VERSION,
    artifact: 'book-one-voice-depth-finalization',
    status: 'PASSED',
    decision: 'pass',
    localVoiceFinishLockCreated: true,
    productionArmed: false,
    fullBookGenerationArmed: false,
    winner: freeze({ variantId: winner.variant.id, variantLabel: winner.variant.label, notes: winner.notes }),
    localVoiceFinishLock: freeze({ ...finishCore, finishDigest }),
    nextAction: 'Local voice finish is reproducibly locked. Full-book generation remains unarmed; next release may integrate this finish into production planning.'
  });
}

export function renderBookOneVoiceDepthFinalizationMarkdown(result) {
  const lines = ['# Book One Voice Depth Finalization', '', `**Status:** ${result.status}`, `**Decision:** ${String(result.decision).toUpperCase()}`, `**Local voice finish lock created:** ${result.localVoiceFinishLockCreated ? 'YES' : 'NO'}`, `**Full-book generation armed:** ${result.fullBookGenerationArmed ? 'YES' : 'NO'}`, ''];
  if (result.localVoiceFinishLock) {
    const v = result.localVoiceFinishLock.selectedVariant;
    lines.push('## Locked local finish', '', `- Variant: **${v.label}**`, `- Pitch change: **${v.semitones} semitone**`, `- Pitch factor: **${v.pitchFactor}**`, `- Duration compensation: **${v.durationCompensation}**`, `- Performance unchanged: **YES**`, `- Provider settings unchanged: **YES**`, `- Effective pace unchanged: **YES**`, `- Finish digest: \`${result.localVoiceFinishLock.finishDigest}\``, '');
  }
  lines.push('## Next action', '', result.nextAction, '');
  return lines.join('\n');
}
