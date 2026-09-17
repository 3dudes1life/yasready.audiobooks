import { withYasReadyPlatformUI } from '../ui/yasready-platform.js';
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { sha256, stableJson } from '../core/hash.js';
import { normalizeMoneyPolicy, moneyGuardDecision } from '../money/money-guard.js';
import { verifyEmotionalLiftPlan } from './book-one-emotional-lift-service.js';
import { YASREADY_AUDIOBOOKS_VERSION } from '../release.js';

const freeze = (value) => Object.freeze(value);
const clean = (value) => String(value ?? '').trim();
const round = (value) => Number(Number(value ?? 0).toFixed(6));
const ceilMoneyToCent = (value) => Number((Math.ceil((Number(value ?? 0) - Number.EPSILON) * 100) / 100).toFixed(2));

export const ELEVENLABS_NATIVE_SPEED_CEILING = 1.20;
export const PACE_CALIBRATION_EFFECTIVE_HARD_CEILING = 1.30;
export const PACE_CEILING_HARD_CEILING_USD = 1;

function browserSafeJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function sameBook(a, b) {
  const aId = clean(a?.id), bId = clean(b?.id);
  const aHash = clean(a?.sourceHash), bHash = clean(b?.sourceHash);
  if (aId && bId && aId !== bId) return false;
  if (aHash && bHash && aHash !== bHash) return false;
  return true;
}

function planCore(plan) {
  return {
    schemaVersion: plan.schemaVersion,
    release: plan.release,
    artifact: plan.artifact,
    status: plan.status,
    book: plan.book,
    sourceEmotionalLift: plan.sourceEmotionalLift,
    narrator: plan.narrator,
    sample: plan.sample,
    baselineDirection: plan.baselineDirection,
    requestedPace: plan.requestedPace,
    emotionalCandidates: plan.emotionalCandidates,
    providerRenders: plan.providerRenders,
    reviewVariants: plan.reviewVariants,
    model: plan.model,
    outputFormat: plan.outputFormat,
    cost: plan.cost,
    guardrails: plan.guardrails
  };
}

export function verifyPaceCeilingPlan(plan) {
  if (!plan || plan.artifact !== 'book-one-pace-ceiling-calibration-plan') throw new Error('Invalid Pace Ceiling Calibration plan');
  const expected = sha256(stableJson(planCore(plan)));
  if (expected !== plan.integrity?.planFingerprint) throw new Error('Pace Ceiling Calibration plan integrity check failed; rebuild before spending');
  if (!plan.confirmation?.token) throw new Error('Pace Ceiling Calibration plan is missing its confirmation token');
  return true;
}

function parseRequestedEffectiveSpeed(text) {
  const input = clean(text);
  const patterns = [
    /(?:do|try|use|set|make|speed|pace)[^\d]{0,12}(1\.\d{1,2})\s*(?:x|speed)?/gi,
    /\b(1\.\d{1,2})\s*(?:x\s*)?(?:speed|pace)\b/gi
  ];
  const values = [];
  for (const pattern of patterns) {
    for (const match of input.matchAll(pattern)) {
      const n = Number(match[1]);
      if (Number.isFinite(n)) values.push(n);
    }
  }
  return values.length ? Math.max(...values) : null;
}

export function derivePaceCeilingRequest(feedback) {
  if (!feedback || feedback.artifact !== 'book-one-emotional-lift-human-feedback') {
    throw new Error('Pace Ceiling Calibration requires emotional-lift-feedback.json');
  }
  const maybes = (feedback.feedback ?? []).filter((row) => clean(row.decision).toLowerCase() === 'maybe');
  if (!maybes.length) throw new Error('Pace Ceiling Calibration requires at least one MAYBE Emotional Lift variant');

  const requested = maybes
    .map((row) => ({ row, speed: parseRequestedEffectiveSpeed(row.notes) }))
    .filter((x) => Number.isFinite(x.speed));
  if (!requested.length) {
    throw new Error('Pace Ceiling Calibration needs a numeric human pace request in a MAYBE note, such as “do 1.25 speed”');
  }

  const requestedEffectiveSpeed = Math.max(...requested.map((x) => x.speed));
  if (requestedEffectiveSpeed <= ELEVENLABS_NATIVE_SPEED_CEILING) {
    throw new Error(`Requested speed ${requestedEffectiveSpeed.toFixed(2)} does not exceed the ElevenLabs native ceiling ${ELEVENLABS_NATIVE_SPEED_CEILING.toFixed(2)}; use native pace tuning instead`);
  }
  if (requestedEffectiveSpeed > PACE_CALIBRATION_EFFECTIVE_HARD_CEILING) {
    throw new Error(`Requested effective speed ${requestedEffectiveSpeed.toFixed(2)} exceeds YasReady's ${PACE_CALIBRATION_EFFECTIVE_HARD_CEILING.toFixed(2)} calibration safety ceiling`);
  }

  return freeze({
    requestedEffectiveSpeed,
    providerNativeSpeed: ELEVENLABS_NATIVE_SPEED_CEILING,
    postProcessTempoMultiplier: round(requestedEffectiveSpeed / ELEVENLABS_NATIVE_SPEED_CEILING),
    pitchPreservingPostProcess: true,
    evidence: freeze(requested.map((x) => freeze({
      variantId: x.row.variantId,
      variantLabel: x.row.variantLabel,
      note: clean(x.row.notes),
      requestedSpeed: x.speed
    })))
  });
}

function candidateScore(row, variant) {
  const note = clean(row?.notes).toLowerCase();
  let score = 0;
  if (clean(row?.decision).toLowerCase() === 'maybe') score += 100;
  if (/way too slow|too slow|\bslow\b/.test(note)) score += 30;
  if (parseRequestedEffectiveSpeed(note)) score += 40;
  if (variant?.id === 'gentle-emotional-lift') score += 5;
  if (variant?.id === 'deep-controlled-emotion') score += 5;
  return score;
}

export function selectPaceCeilingEmotionalCandidates(emotionalPlan, feedback) {
  verifyEmotionalLiftPlan(emotionalPlan);
  if (!feedback || feedback.artifact !== 'book-one-emotional-lift-human-feedback') throw new Error('Invalid Emotional Lift feedback');
  if (feedback.planFingerprint !== emotionalPlan.integrity.planFingerprint) throw new Error('Emotional Lift feedback does not belong to this plan');
  if (!sameBook(emotionalPlan.book, feedback.book)) throw new Error('Emotional Lift feedback belongs to a different book');

  const ranked = (feedback.feedback ?? []).map((row) => {
    const variant = emotionalPlan.variants.find((v) => v.id === row.variantId);
    return { row, variant, score: variant ? candidateScore(row, variant) : -Infinity };
  }).filter((x) => x.variant && clean(x.row.decision).toLowerCase() === 'maybe');

  if (!ranked.length) throw new Error('No MAYBE emotional variants are available for pace ceiling calibration');
  ranked.sort((a, b) => b.score - a.score || a.variant.level - b.variant.level);
  return freeze(ranked.slice(0, 2).map(({ row, variant, score }) => freeze({
    emotionalVariantId: variant.id,
    emotionalVariantLabel: variant.label,
    emotionalRange: variant.emotionalRange,
    stability: Number(variant.voiceSettings.stability),
    priorSpeed: Number(variant.voiceSettings.speed),
    priorHumanNote: clean(row.notes),
    selectionScore: score
  })));
}

function makeProviderRender(candidate, index) {
  return freeze({
    id: `${candidate.emotionalVariantId}-native-120`,
    emotionalVariantId: candidate.emotionalVariantId,
    emotionalVariantLabel: candidate.emotionalVariantLabel,
    emotionalRange: candidate.emotionalRange,
    providerSpeed: ELEVENLABS_NATIVE_SPEED_CEILING,
    stability: candidate.stability,
    voiceSettings: freeze({ speed: ELEVENLABS_NATIVE_SPEED_CEILING, stability: candidate.stability }),
    seed: 91200 + index
  });
}

function makeReviewVariants(providerRenders, request) {
  const out = [];
  for (const render of providerRenders) {
    out.push(freeze({
      id: `${render.emotionalVariantId}-native-120`,
      label: `${render.emotionalVariantLabel} — Native 1.20`,
      emotionalVariantId: render.emotionalVariantId,
      emotionalVariantLabel: render.emotionalVariantLabel,
      emotionalRange: render.emotionalRange,
      sourceProviderRenderId: render.id,
      providerNativeSpeed: ELEVENLABS_NATIVE_SPEED_CEILING,
      effectiveSpeed: ELEVENLABS_NATIVE_SPEED_CEILING,
      postProcessTempoMultiplier: 1,
      pitchPreservingPostProcess: false,
      isDerived: false
    }));
    out.push(freeze({
      id: `${render.emotionalVariantId}-effective-${String(request.requestedEffectiveSpeed).replace('.', '')}`,
      label: `${render.emotionalVariantLabel} — Effective ${request.requestedEffectiveSpeed.toFixed(2)}`,
      emotionalVariantId: render.emotionalVariantId,
      emotionalVariantLabel: render.emotionalVariantLabel,
      emotionalRange: render.emotionalRange,
      sourceProviderRenderId: render.id,
      providerNativeSpeed: ELEVENLABS_NATIVE_SPEED_CEILING,
      effectiveSpeed: request.requestedEffectiveSpeed,
      postProcessTempoMultiplier: request.postProcessTempoMultiplier,
      pitchPreservingPostProcess: true,
      isDerived: true
    }));
  }
  return freeze(out);
}

export async function buildPaceCeilingCalibrationPlan({
  emotionalPlan,
  emotionalFeedback,
  estimator,
  model = null,
  outputFormat = null
} = {}) {
  verifyEmotionalLiftPlan(emotionalPlan);
  if (typeof estimator !== 'function') throw new Error('Pace Ceiling Calibration planning requires a provider cost estimator');
  if (!emotionalFeedback || emotionalFeedback.artifact !== 'book-one-emotional-lift-human-feedback') {
    throw new Error('Pace Ceiling Calibration requires emotional-lift-feedback.json');
  }
  if (emotionalFeedback.planFingerprint !== emotionalPlan.integrity.planFingerprint) {
    throw new Error('Emotional Lift feedback does not belong to this plan');
  }

  const requestedPace = derivePaceCeilingRequest(emotionalFeedback);
  const emotionalCandidates = selectPaceCeilingEmotionalCandidates(emotionalPlan, emotionalFeedback);
  const providerRenders = freeze(emotionalCandidates.map(makeProviderRender));
  const reviewVariants = makeReviewVariants(providerRenders, requestedPace);
  const selectedModel = model ?? emotionalPlan.model ?? 'eleven_v3';
  const selectedOutputFormat = outputFormat ?? emotionalPlan.outputFormat ?? 'mp3_44100_128';

  const estimates = [];
  let estimateUsd = 0;
  for (const render of providerRenders) {
    const estimate = await estimator({ text: emotionalPlan.baselineDirection.directedText, model: selectedModel });
    if (!Number.isFinite(Number(estimate?.amountUsd))) throw new Error(`Provider cannot estimate Pace Ceiling Calibration cost for ${selectedModel}`);
    const amountUsd = round(estimate.amountUsd);
    estimateUsd = round(estimateUsd + amountUsd);
    estimates.push(freeze({
      providerRenderId: render.id,
      amountUsd,
      characters: estimate.characters ?? [...emotionalPlan.baselineDirection.directedText].length,
      rateUsdPer1k: estimate.rateUsdPer1k ?? null
    }));
  }

  const reserveUsd = round(Math.max(0.03, estimateUsd * 0.25));
  const suggestedMaxUsd = ceilMoneyToCent(estimateUsd + reserveUsd);
  if (suggestedMaxUsd > PACE_CEILING_HARD_CEILING_USD) {
    throw new Error(`Pace Ceiling Calibration exceeds the $${PACE_CEILING_HARD_CEILING_USD.toFixed(2)} hard ceiling`);
  }

  const base = {
    schemaVersion: 1,
    release: YASREADY_AUDIOBOOKS_VERSION,
    artifact: 'book-one-pace-ceiling-calibration-plan',
    status: 'READY_FOR_EXPLICIT_APPROVAL',
    sensitiveLocalArtifact: true,
    doNotCommit: true,
    book: emotionalPlan.book,
    sourceEmotionalLift: freeze({
      planFingerprint: emotionalPlan.integrity.planFingerprint,
      feedbackDigest: sha256(stableJson(emotionalFeedback.feedback ?? [])),
      failedVariantsExcluded: freeze((emotionalFeedback.feedback ?? [])
        .filter((x) => clean(x.decision).toLowerCase() === 'fail')
        .map((x) => x.variantId))
    }),
    narrator: emotionalPlan.narrator,
    sample: emotionalPlan.sample,
    baselineDirection: freeze({
      directionId: emotionalPlan.baselineDirection.directionId,
      directionLabel: emotionalPlan.baselineDirection.directionLabel,
      humanLearningNote: emotionalPlan.baselineDirection.humanLearningNote,
      scriptPolicy: emotionalPlan.baselineDirection.scriptPolicy,
      directedText: emotionalPlan.baselineDirection.directedText,
      directedTextDigest: emotionalPlan.baselineDirection.directedTextDigest,
      dynamicRangePolicy: emotionalPlan.emotionalPolicy?.dynamicRangePolicy ?? null
    }),
    requestedPace,
    emotionalCandidates,
    providerRenders,
    reviewVariants,
    model: selectedModel,
    outputFormat: selectedOutputFormat,
    cost: freeze({
      estimateUsd,
      reserveUsd,
      suggestedMaxUsd,
      hardCeilingUsd: PACE_CEILING_HARD_CEILING_USD,
      estimatedProviderGenerationCalls: providerRenders.length,
      localDerivedAudioCount: reviewVariants.filter((x) => x.isDerived).length,
      estimates: freeze(estimates),
      localTempoProcessingCostUsd: 0,
      roundingPolicy: 'protected-max-ceil-to-cent'
    }),
    guardrails: freeze({
      planningProviderGenerationCalls: 0,
      explicitApprovalRequired: true,
      exactPlanFingerprintRequired: true,
      maxUsdRequiredAtRender: true,
      providerSubscriptionPreflightRequired: true,
      ffmpegPreflightRequiredBeforePaidCalls: true,
      providerSpeedNeverExceedsNativeCeiling: true,
      failedEmotionalVariantsExcluded: true,
      localTempoIsPitchPreserving: true,
      resumablePaidBaseReuse: true,
      resumableLocalDerivativeReuse: true,
      humanPassRequiredForNarratorProductionLock: true,
      productionGenerationArmed: false,
      narratorProductionLockCreated: false,
      fullBookGenerationArmed: false,
      identityInferenceFromAudio: false
    })
  };

  const planFingerprint = sha256(stableJson(planCore(base)));
  const token = `PACE-${planFingerprint.slice(0, 10).toUpperCase()}`;
  return freeze({
    ...base,
    integrity: freeze({ planFingerprint }),
    confirmation: freeze({
      token,
      instruction: `Rendering is blocked unless the operator supplies ${token} and --max-usd of at least $${suggestedMaxUsd.toFixed(2)}.`
    })
  });
}

export function renderPaceCeilingPlanMarkdown(plan) {
  verifyPaceCeilingPlan(plan);
  const lines = [
    '# Book One Pace Ceiling Calibration', '',
    `**Status:** ${plan.status}`,
    `**Narrator:** ${plan.narrator.candidateName}`,
    `**Baseline direction:** ${plan.baselineDirection.directionLabel}`,
    `**Same readiness scene:** ${plan.sample.chapterTitle} — Scene ${plan.sample.sceneOrder}`,
    `**Human requested effective speed:** ${plan.requestedPace.requestedEffectiveSpeed.toFixed(2)}`,
    `**ElevenLabs native speed ceiling:** ${plan.requestedPace.providerNativeSpeed.toFixed(2)}`,
    `**Pitch-preserving local tempo step:** ${plan.requestedPace.postProcessTempoMultiplier.toFixed(6)}x`, '',
    '## Human evidence', ''
  ];
  for (const row of plan.requestedPace.evidence) lines.push(`- ${row.variantLabel}: “${row.note}”`);
  lines.push('', '## Emotional candidates kept', '');
  for (const c of plan.emotionalCandidates) {
    lines.push(`- **${c.emotionalVariantLabel}** — stability ${c.stability}; prior note: “${c.priorHumanNote}”`);
  }
  if (plan.sourceEmotionalLift.failedVariantsExcluded.length) {
    lines.push('', `Failed emotional variants excluded: ${plan.sourceEmotionalLift.failedVariantsExcluded.join(', ')}`);
  }
  lines.push('', '## What you will hear', '');
  for (const v of plan.reviewVariants) {
    lines.push(`- **${v.label}** — provider ${v.providerNativeSpeed.toFixed(2)}${v.isDerived ? ` + local pitch-preserving ${v.postProcessTempoMultiplier.toFixed(6)}x tempo = effective ${v.effectiveSpeed.toFixed(2)}` : ''}`);
  }
  lines.push(
    '', '## Spend gate', '',
    `- Estimated TTS total: **$${plan.cost.estimateUsd.toFixed(2)}**`,
    `- Protected maximum: **$${plan.cost.suggestedMaxUsd.toFixed(2)}**`,
    `- Provider generation calls if approved: **${plan.cost.estimatedProviderGenerationCalls}**`,
    `- Local derived comparisons: **${plan.cost.localDerivedAudioCount}**`,
    '- Local tempo processing cost: **$0.00 TTS**',
    `- Confirmation token: \`${plan.confirmation.token}\``,
    '- Planning generation calls: **0**', '',
    '> YasReady never sends speed 1.25 to ElevenLabs. It generates at the supported 1.20 ceiling, then creates the 1.25 comparison locally with pitch-preserving tempo processing. Full-book production stays unarmed.', ''
  );
  return lines.join('\n');
}

async function providerSubscriptionPreflight(provider) {
  if (typeof provider.subscriptionPreflight === 'function') return provider.subscriptionPreflight();
  if (typeof provider.getSubscription !== 'function') return { available: false, safeToContinue: true, reason: 'unsupported' };
  try {
    const subscription = await provider.getSubscription();
    return { available: true, safeToContinue: true, subscription, tier: subscription?.tier ?? subscription?.plan ?? null };
  } catch (error) {
    const status = Number(error?.status ?? 0);
    const permissionStatus = error?.detail?.detail?.status ?? error?.detail?.status ?? null;
    if ([401, 403].includes(status) && permissionStatus === 'missing_permissions') {
      return { available: false, safeToContinue: true, reason: 'subscription-check-unavailable-missing-user-read' };
    }
    throw error;
  }
}

async function resolveVoiceId(provider, plan) {
  if (typeof provider.listSavedVoices !== 'function') return plan.narrator.providerVoiceId;
  try {
    const saved = await provider.listSavedVoices({ search: plan.narrator.candidateName, pageSize: 100 });
    const match = (saved?.voices ?? []).find((voice) =>
      voice.providerVoiceId === plan.narrator.providerVoiceId ||
      clean(voice.name).toLowerCase().includes(clean(plan.narrator.candidateName).toLowerCase())
    );
    return match?.providerVoiceId ?? plan.narrator.providerVoiceId;
  } catch {
    return plan.narrator.providerVoiceId;
  }
}

async function exists(filePath) {
  try {
    const s = await stat(filePath);
    return s.isFile() && s.size > 0;
  } catch {
    return false;
  }
}

async function readJsonIfExists(filePath) {
  try { return JSON.parse(await readFile(filePath, 'utf8')); } catch { return null; }
}

function feedbackShell(plan) {
  return {
    schemaVersion: 1,
    release: YASREADY_AUDIOBOOKS_VERSION,
    artifact: 'book-one-pace-ceiling-human-feedback',
    planFingerprint: plan.integrity.planFingerprint,
    book: plan.book,
    narrator: plan.narrator,
    requestedEffectiveSpeed: plan.requestedPace.requestedEffectiveSpeed,
    feedback: plan.reviewVariants.map((variant) => ({
      variantId: variant.id,
      variantLabel: variant.label,
      decision: null,
      notes: ''
    })),
    exportedAt: null
  };
}

export function renderPaceCeilingReviewHtml(plan, result) {
  const data = browserSafeJson({
    release: YASREADY_AUDIOBOOKS_VERSION,
    planFingerprint: plan.integrity.planFingerprint,
    narrator: plan.narrator,
    sample: plan.sample,
    requestedPace: plan.requestedPace,
    reviewVariants: plan.reviewVariants,
    rendered: result.rendered,
    feedback: feedbackShell(plan)
  });
  return withYasReadyPlatformUI(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>YasReady Pace Ceiling Calibration</title>
<style>
:root{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","Segoe UI",sans-serif;color-scheme:light dark;--bg:#f5f5f7;--card:#fff;--text:#1d1d1f;--muted:#6e6e73;--line:rgba(0,0,0,.1);--accent:#0071e3;--good:#248a3d;--maybe:#b25000;--bad:#d70015}
@media(prefers-color-scheme:dark){:root{--bg:#000;--card:#1c1c1e;--text:#f5f5f7;--muted:#a1a1a6;--line:rgba(255,255,255,.14);--accent:#2997ff;--good:#30d158;--maybe:#ff9f0a;--bad:#ff453a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text)}main{max-width:1080px;margin:auto;padding:42px 22px 90px}.eyebrow{font-size:13px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--accent)}h1{font-size:clamp(42px,7vw,72px);line-height:.95;letter-spacing:-.055em;margin:8px 0 14px}.sub{font-size:18px;line-height:1.5;color:var(--muted);max-width:880px}.notice,.variant{margin-top:18px;padding:22px;border-radius:26px;background:var(--card);border:1px solid var(--line)}.variant h2{font-size:25px;letter-spacing:-.035em;margin:0 0 7px}.small{font-size:13px;color:var(--muted);line-height:1.45}.chips{display:flex;flex-wrap:wrap;gap:7px;margin:12px 0}.chip{font-size:12px;color:var(--muted);border:1px solid var(--line);border-radius:999px;padding:6px 9px}audio{width:100%;margin:10px 0}.choices{display:grid;grid-template-columns:repeat(3,1fr);gap:9px;margin:12px 0}.choices button,.toolbar button{border:1px solid var(--line);border-radius:999px;padding:12px;font:inherit;font-weight:800;background:var(--bg);color:var(--text);cursor:pointer}.choices button.active.pass{background:var(--good);color:#fff}.choices button.active.maybe{background:var(--maybe);color:#fff}.choices button.active.fail{background:var(--bad);color:#fff}textarea{width:100%;min-height:72px;border:1px solid var(--line);border-radius:14px;padding:10px;background:var(--bg);color:var(--text);font:inherit}.toolbar{position:sticky;bottom:0;display:flex;gap:10px;flex-wrap:wrap;margin-top:25px;padding:12px 0;background:color-mix(in srgb,var(--bg) 90%,transparent);backdrop-filter:blur(18px)}.primary{background:var(--accent)!important;color:#fff!important}.status{font-size:13px;color:var(--muted);min-height:20px}.foot{font-size:12px;color:var(--muted);line-height:1.5;margin-top:28px}@media(max-width:680px){.choices{grid-template-columns:1fr}}
</style></head><body><main>
<div class="eyebrow">YasReady Audiobooks ${YASREADY_AUDIOBOOKS_VERSION}</div>
<h1>Is 1.25 actually the pace?</h1>
<div class="sub">You asked for ${plan.requestedPace.requestedEffectiveSpeed.toFixed(2)}. ElevenLabs stops at ${plan.requestedPace.providerNativeSpeed.toFixed(2)}, so YasReady gives you both the real provider ceiling and a pitch-preserved local ${plan.requestedPace.requestedEffectiveSpeed.toFixed(2)} version of the exact same take.</div>
<div class="notice"><b>Only two emotional directions survived.</b><div class="small">Warm + Expressive was rejected and is gone. Compare Gentle Emotional Lift and Deep Controlled Emotion at native 1.20 and effective ${plan.requestedPace.requestedEffectiveSpeed.toFixed(2)}. Pick the version that sounds like an audiobook, not a speed test.</div></div>
<div id="content"></div>
<div class="toolbar"><button id="download" class="primary">Download Pace Feedback</button><button id="copy">Copy Feedback JSON</button></div>
<div id="status" class="status"></div>
<div class="foot">PASS — Lock may be used on at most one version. A derived ${plan.requestedPace.requestedEffectiveSpeed.toFixed(2)} PASS records both provider speed ${plan.requestedPace.providerNativeSpeed.toFixed(2)} and the exact post-process tempo multiplier so production can reproduce it later. Full-book generation remains off.</div>
<script>
const DATA=${data},key='yasready-pace-ceiling:'+DATA.planFingerprint;
let feedback=structuredClone(DATA.feedback);try{const saved=localStorage.getItem(key);if(saved)feedback=JSON.parse(saved)}catch{}
const content=document.getElementById('content'),status=document.getElementById('status');
function save(){localStorage.setItem(key,JSON.stringify(feedback))}function row(id){return feedback.feedback.find(x=>x.variantId===id)}
function repaint(){for(const card of document.querySelectorAll('[data-variant]')){const r=row(card.dataset.variant);for(const b of card.querySelectorAll('[data-decision]'))b.className=(r.decision===b.dataset.decision)?'active '+b.dataset.decision:''}}
for(const v of DATA.reviewVariants){
 const r=row(v.id),card=document.createElement('section');card.className='variant';card.dataset.variant=v.id;
 const h=document.createElement('h2');h.textContent=v.label;card.append(h);
 const chips=document.createElement('div');chips.className='chips';
 for(const text of ['provider '+v.providerNativeSpeed.toFixed(2),'effective '+v.effectiveSpeed.toFixed(2),v.emotionalRange,v.isDerived?'pitch-preserved local tempo':'native provider audio']){const c=document.createElement('span');c.className='chip';c.textContent=text;chips.append(c)}card.append(chips);
 const audio=DATA.rendered.find(x=>x.variantId===v.id);const a=document.createElement('audio');a.controls=true;a.preload='metadata';a.src=audio.outputRelativePath;card.append(a);
 const choices=document.createElement('div');choices.className='choices';
 for(const [value,label] of [['pass','PASS — Lock'],['maybe','MAYBE'],['fail','FAIL']]){const b=document.createElement('button');b.dataset.decision=value;b.textContent=label;b.onclick=()=>{if(value==='pass'){for(const x of feedback.feedback){if(x.variantId!==v.id&&x.decision==='pass')x.decision=null}}r.decision=value;save();repaint()};choices.append(b)}card.append(choices);
 const ta=document.createElement('textarea');ta.placeholder='Pace, emotion, naturalness — what works or does not?';ta.value=r.notes||'';ta.oninput=()=>{r.notes=ta.value;save()};card.append(ta);content.append(card)
}
repaint();
function payload(){feedback.exportedAt=new Date().toISOString();save();return JSON.stringify(feedback,null,2)}
document.getElementById('copy').onclick=async()=>{try{await navigator.clipboard.writeText(payload());status.textContent='Copied pace feedback JSON.'}catch{status.textContent='Clipboard blocked. Use Download Pace Feedback.'}};
document.getElementById('download').onclick=async()=>{const text=payload();try{if(window.showSaveFilePicker){const h=await window.showSaveFilePicker({suggestedName:'pace-ceiling-feedback.json',types:[{description:'JSON',accept:{'application/json':['.json']}}]});const w=await h.createWritable();await w.write(text);await w.close();status.textContent='Saved pace-ceiling-feedback.json.';return}}catch(e){if(e?.name==='AbortError'){status.textContent='Save cancelled.';return}}const blob=new Blob([text],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='pace-ceiling-feedback.json';a.style.display='none';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),3000);status.textContent='Download requested. Check Downloads; use Copy Feedback JSON if Safari suppresses it.'};
</script></main></body></html>`);
}

export async function renderPaceCeilingCalibration({
  plan,
  provider,
  tempoProcessor,
  outDir,
  approvalToken,
  maxUsd
} = {}) {
  verifyPaceCeilingPlan(plan);
  if (!provider?.render) throw new Error('Pace Ceiling Calibration rendering requires an audio provider');
  if (!tempoProcessor?.healthCheck || !tempoProcessor?.process) throw new Error('Pace Ceiling Calibration requires a pitch-preserving tempo processor');
  if (clean(approvalToken) !== plan.confirmation.token) throw new Error(`Explicit Pace Ceiling approval token mismatch. Expected ${plan.confirmation.token}`);

  const cap = Number(maxUsd);
  if (!Number.isFinite(cap) || cap <= 0) throw new Error('--max-usd must be a positive number');
  if (cap < plan.cost.suggestedMaxUsd) throw new Error(`--max-usd must be at least $${plan.cost.suggestedMaxUsd.toFixed(2)}`);
  if (cap > PACE_CEILING_HARD_CEILING_USD) throw new Error(`--max-usd cannot exceed $${PACE_CEILING_HARD_CEILING_USD.toFixed(2)} for Pace Ceiling Calibration`);

  const tempoHealth = await tempoProcessor.healthCheck();
  if (tempoHealth?.ok === false) throw new Error(`FFmpeg tempo preflight failed before any paid TTS call: ${tempoHealth.reason ?? 'ffmpeg unavailable'}`);

  const entitlement = await providerSubscriptionPreflight(provider);
  const tier = clean(entitlement?.tier ?? entitlement?.subscription?.tier).toLowerCase();
  if (entitlement.available && tier === 'free') throw new Error('ElevenLabs Pace Ceiling rendering requires a paid subscription. Account tier is Free. No audio was generated and no spend occurred.');

  const providerHealth = typeof provider.healthCheck === 'function' ? await provider.healthCheck() : { ok: true };
  if (providerHealth?.ok === false) throw new Error(`ElevenLabs health check failed: ${providerHealth.reason ?? providerHealth.status ?? 'unknown'}`);

  const policy = normalizeMoneyPolicy({
    hardCapUsd: cap, warningThresholdRatio: 1, singleActionApprovalUsd: 0, estimateVarianceRatio: 0,
    providerCapsUsd: { elevenlabs: cap }, operationCapsUsd: { audition: cap }, requireApprovalAtWarning: false
  });
  const guard = moneyGuardDecision({
    policy, estimatedCostUsd: plan.cost.suggestedMaxUsd, provider: 'elevenlabs',
    operation: 'audition_render', approvedBy: 'explicit-pace-ceiling-confirmation'
  });
  if (guard.blocked) throw new Error(`Money Guard blocked Pace Ceiling Calibration: ${guard.reasons.join(', ')}`);

  const resolved = path.resolve(outDir);
  const audioDir = path.join(resolved, 'audio');
  const progressPath = path.join(resolved, 'pace-ceiling-progress.json');
  const resultPath = path.join(resolved, 'pace-ceiling-result.json');
  await mkdir(audioDir, { recursive: true });

  const existingResult = await readJsonIfExists(resultPath);
  if (existingResult?.status === 'READY_FOR_HUMAN_PACE_REVIEW' &&
      existingResult?.planFingerprint === plan.integrity.planFingerprint &&
      (await Promise.all((existingResult.rendered ?? []).map((x) => exists(path.join(resolved, x.outputRelativePath))))).every(Boolean)) {
    return freeze({ ...existingResult, currentRunProviderGenerationCalls: 0, reusedPaidBaseClips: plan.providerRenders.length, localDerivativesBuiltThisRun: 0 });
  }

  let progress = await readJsonIfExists(progressPath);
  if (progress?.planFingerprint && progress.planFingerprint !== plan.integrity.planFingerprint) throw new Error('Output directory contains a different Pace Ceiling plan');
  if (progress?.status === 'PAID_AUDIO_STORAGE_FAILED_DO_NOT_RERUN') throw new Error('A prior paid provider call succeeded but local base-audio storage failed. DO NOT RERUN this directory.');
  if (progress?.status === 'PAID_SPEND_CAP_EXCEEDED_DO_NOT_RERUN') throw new Error('A prior provider call exceeded the approved cap after success. DO NOT RERUN this directory.');

  const paidBases = [];
  for (const row of progress?.paidBases ?? []) {
    if (plan.providerRenders.some((x) => x.id === row.providerRenderId) && await exists(path.join(resolved, row.outputRelativePath))) paidBases.push(row);
  }
  const localDerivatives = [];
  for (const row of progress?.localDerivatives ?? []) {
    if (plan.reviewVariants.some((x) => x.id === row.variantId) && await exists(path.join(resolved, row.outputRelativePath))) localDerivatives.push(row);
  }

  let capturedUsd = round(paidBases.reduce((sum, x) => sum + Number(x.capturedUsd ?? 0), 0));
  let providerCallsThisRun = 0;
  let localBuildsThisRun = 0;
  const resolvedVoiceId = await resolveVoiceId(provider, plan);

  const persist = async (status, extras = {}) => writeFile(progressPath, JSON.stringify({
    schemaVersion: 1,
    release: YASREADY_AUDIOBOOKS_VERSION,
    artifact: 'book-one-pace-ceiling-progress',
    planFingerprint: plan.integrity.planFingerprint,
    status,
    paidBases,
    localDerivatives,
    capturedUsd,
    approvedMaxUsd: cap,
    providerCallsThisRun,
    localBuildsThisRun,
    productionGenerationCalls: 0,
    ...extras
  }, null, 2));

  await persist((paidBases.length || localDerivatives.length) ? 'RESUMING' : 'STARTING');

  for (let i = 0; i < plan.providerRenders.length; i += 1) {
    const render = plan.providerRenders[i];
    if (paidBases.some((x) => x.providerRenderId === render.id)) continue;

    let output;
    try {
      output = await provider.render({
        voiceId: resolvedVoiceId,
        text: plan.baselineDirection.directedText,
        model: plan.model,
        outputFormat: plan.outputFormat,
        voiceSettings: render.voiceSettings,
        languageCode: 'en',
        seed: render.seed,
        applyTextNormalization: 'auto'
      });
    } catch (error) {
      await persist('PARTIAL_PROVIDER_FAILED', { failedProviderRenderId: render.id, message: error.message });
      throw error;
    }

    providerCallsThisRun += 1;
    const estimateLine = plan.cost.estimates.find((x) => x.providerRenderId === render.id);
    const clipCost = Number.isFinite(Number(output.estimatedCostUsd)) ? round(output.estimatedCostUsd) : Number(estimateLine?.amountUsd ?? 0);
    capturedUsd = round(capturedUsd + clipCost);
    if (capturedUsd > cap) {
      await persist('PAID_SPEND_CAP_EXCEEDED_DO_NOT_RERUN', { paidProviderRenderId: render.id, requestId: output.requestId ?? null });
      throw new Error(`Pace Ceiling spend reached $${capturedUsd.toFixed(2)}, exceeding $${cap.toFixed(2)} after a successful provider call. Do not blindly rerun.`);
    }

    const outputRelativePath = `audio/${String(i + 1).padStart(2, '0')}-${render.emotionalVariantId}-native-120.mp3`;
    await persist('PROVIDER_CALL_SUCCEEDED_ASSET_PENDING', { paidProviderRenderId: render.id, requestId: output.requestId ?? null });
    try {
      await writeFile(path.join(resolved, outputRelativePath), output.audio);
    } catch (error) {
      await persist('PAID_AUDIO_STORAGE_FAILED_DO_NOT_RERUN', { paidProviderRenderId: render.id, requestId: output.requestId ?? null, message: error.message });
      throw error;
    }

    paidBases.push({
      providerRenderId: render.id,
      emotionalVariantId: render.emotionalVariantId,
      outputRelativePath,
      capturedUsd: clipCost,
      requestId: output.requestId ?? null,
      billedCharacters: output.billedCharacters ?? null,
      voiceSettings: render.voiceSettings
    });
    await persist('BASE_AUDIO_STORED');
  }

  for (const variant of plan.reviewVariants.filter((x) => x.isDerived)) {
    if (localDerivatives.some((x) => x.variantId === variant.id)) continue;
    const base = paidBases.find((x) => x.providerRenderId === variant.sourceProviderRenderId);
    if (!base) throw new Error(`Missing paid base for ${variant.id}`);
    const outputRelativePath = `audio/${variant.id}.mp3`;
    try {
      await tempoProcessor.process(
        path.join(resolved, base.outputRelativePath),
        path.join(resolved, outputRelativePath),
        variant.postProcessTempoMultiplier
      );
    } catch (error) {
      await persist('LOCAL_TEMPO_FAILED_SAFE_TO_RERUN', { failedVariantId: variant.id, message: error.message });
      throw error;
    }
    localBuildsThisRun += 1;
    localDerivatives.push({
      variantId: variant.id,
      sourceProviderRenderId: variant.sourceProviderRenderId,
      outputRelativePath,
      postProcessTempoMultiplier: variant.postProcessTempoMultiplier,
      effectiveSpeed: variant.effectiveSpeed,
      pitchPreservingPostProcess: true
    });
    await persist('LOCAL_DERIVATIVE_STORED');
  }

  const rendered = [];
  for (const variant of plan.reviewVariants) {
    if (variant.isDerived) {
      const local = localDerivatives.find((x) => x.variantId === variant.id);
      if (!local) throw new Error(`Missing local pace derivative ${variant.id}`);
      rendered.push(freeze({ variantId: variant.id, variantLabel: variant.label, outputRelativePath: local.outputRelativePath, effectiveSpeed: variant.effectiveSpeed, isDerived: true }));
    } else {
      const base = paidBases.find((x) => x.providerRenderId === variant.sourceProviderRenderId);
      if (!base) throw new Error(`Missing native provider audio ${variant.id}`);
      rendered.push(freeze({ variantId: variant.id, variantLabel: variant.label, outputRelativePath: base.outputRelativePath, effectiveSpeed: variant.effectiveSpeed, isDerived: false }));
    }
  }

  const result = freeze({
    schemaVersion: 1,
    release: YASREADY_AUDIOBOOKS_VERSION,
    artifact: 'book-one-pace-ceiling-result',
    status: 'READY_FOR_HUMAN_PACE_REVIEW',
    planFingerprint: plan.integrity.planFingerprint,
    book: plan.book,
    narrator: plan.narrator,
    rendered: freeze(rendered),
    providerGenerationCalls: paidBases.length,
    currentRunProviderGenerationCalls: providerCallsThisRun,
    reusedPaidBaseClips: paidBases.length - providerCallsThisRun,
    localDerivedAudioCount: localDerivatives.length,
    localDerivativesBuiltThisRun: localBuildsThisRun,
    productionGenerationCalls: 0,
    narratorProductionLockCreated: false,
    fullBookGenerationArmed: false,
    cost: freeze({
      estimateUsd: plan.cost.estimateUsd,
      capturedUsd,
      maxUsd: cap,
      headroomUsd: round(cap - capturedUsd),
      localTempoProcessingCostUsd: 0
    })
  });

  await Promise.all([
    writeFile(resultPath, JSON.stringify(result, null, 2)),
    writeFile(path.join(resolved, 'pace-ceiling-review.html'), renderPaceCeilingReviewHtml(plan, result)),
    writeFile(path.join(resolved, 'pace-ceiling-feedback-template.json'), JSON.stringify(feedbackShell(plan), null, 2)),
    persist('COMPLETE')
  ]);
  return result;
}

export function finalizePaceCeilingCalibration({ plan, feedback } = {}) {
  verifyPaceCeilingPlan(plan);
  if (!feedback || feedback.artifact !== 'book-one-pace-ceiling-human-feedback') throw new Error('Invalid pace-ceiling-feedback.json');
  if (feedback.planFingerprint !== plan.integrity.planFingerprint) throw new Error('Pace Ceiling feedback does not belong to this plan');

  const rows = plan.reviewVariants.map((variant) => {
    const source = (feedback.feedback ?? []).find((x) => x.variantId === variant.id);
    return { variant, decision: clean(source?.decision).toLowerCase() || null, notes: clean(source?.notes) };
  });
  for (const row of rows) {
    if (row.decision && !['pass', 'maybe', 'fail'].includes(row.decision)) throw new Error(`Unknown Pace Ceiling decision for ${row.variant.id}: ${row.decision}`);
  }
  const passes = rows.filter((x) => x.decision === 'pass');
  if (passes.length > 1) throw new Error('Pace Ceiling Calibration allows only one PASS — Lock variant');

  if (!passes.length) {
    const anyMaybe = rows.some((x) => x.decision === 'maybe');
    const allFail = rows.every((x) => x.decision === 'fail');
    return freeze({
      schemaVersion: 1,
      release: YASREADY_AUDIOBOOKS_VERSION,
      artifact: 'book-one-pace-ceiling-finalization',
      status: anyMaybe ? 'NEEDS_TUNING' : allFail ? 'FAILED' : 'INCOMPLETE',
      decision: anyMaybe ? 'maybe' : allFail ? 'fail' : 'incomplete',
      book: plan.book,
      narratorProductionLockCreated: false,
      productionArmed: false,
      fullBookGenerationArmed: false,
      choices: freeze(rows.map((x) => freeze({ variantId: x.variant.id, variantLabel: x.variant.label, decision: x.decision, notes: x.notes }))),
      nextAction: anyMaybe
        ? 'Keep calibrating pace/emotion. No narrator lock was created and full-book generation remains off.'
        : allFail
          ? 'Return to performance direction; no narrator lock was created.'
          : 'Finish the Pace Ceiling review before finalizing.'
    });
  }

  const winner = passes[0];
  const candidate = plan.emotionalCandidates.find((x) => x.emotionalVariantId === winner.variant.emotionalVariantId);
  const paceProfile = freeze({
    providerNativeSpeed: winner.variant.providerNativeSpeed,
    effectiveSpeed: winner.variant.effectiveSpeed,
    postProcessTempoMultiplier: winner.variant.postProcessTempoMultiplier,
    postProcessRequired: winner.variant.isDerived,
    postProcessKind: winner.variant.isDerived ? 'ffmpeg-atempo' : null,
    pitchPreservingPostProcess: winner.variant.pitchPreservingPostProcess
  });
  const lockCore = {
    schemaVersion: 1,
    release: YASREADY_AUDIOBOOKS_VERSION,
    artifact: 'book-one-narrator-production-lock',
    status: 'LOCKED_FOR_PRODUCTION_PLANNING',
    book: plan.book,
    narrator: plan.narrator,
    performanceProfile: freeze({
      source: 'explicit-human-pace-ceiling-pass',
      baseDirectionId: plan.baselineDirection.directionId,
      baseDirectionLabel: plan.baselineDirection.directionLabel,
      emotionalVariantId: candidate.emotionalVariantId,
      emotionalVariantLabel: candidate.emotionalVariantLabel,
      emotionalRange: candidate.emotionalRange,
      stability: candidate.stability,
      providerVoiceSettings: freeze({ speed: ELEVENLABS_NATIVE_SPEED_CEILING, stability: candidate.stability }),
      paceProfile,
      dynamicRangePolicy: plan.baselineDirection.dynamicRangePolicy,
      originalHumanLearningNote: plan.baselineDirection.humanLearningNote,
      priorEmotionalNote: candidate.priorHumanNote,
      finalPaceCalibrationNote: winner.notes,
      restraint: plan.baselineDirection.scriptPolicy.restraint,
      narrator: plan.baselineDirection.scriptPolicy.narrator,
      juan: plan.baselineDirection.scriptPolicy.juan,
      michael: plan.baselineDirection.scriptPolicy.michael,
      christopher: plan.baselineDirection.scriptPolicy.christopher,
      identityInferenceFromAudio: false
    }),
    readinessEvidence: freeze({
      sourceEmotionalLiftPlanFingerprint: plan.sourceEmotionalLift.planFingerprint,
      paceCeilingPlanFingerprint: plan.integrity.planFingerprint,
      chapterTitle: plan.sample.chapterTitle,
      sceneOrder: plan.sample.sceneOrder,
      wordCount: plan.sample.wordCount,
      explicitHumanDecision: 'pass',
      winningVariantId: winner.variant.id
    }),
    productionArmed: false,
    fullBookGenerationArmed: false
  };
  const lockDigest = sha256(stableJson(lockCore));
  const lock = freeze({ ...lockCore, lockDigest });

  return freeze({
    schemaVersion: 1,
    release: YASREADY_AUDIOBOOKS_VERSION,
    artifact: 'book-one-pace-ceiling-finalization',
    status: 'PASSED',
    decision: 'pass',
    book: plan.book,
    narratorProductionLockCreated: true,
    productionArmed: false,
    fullBookGenerationArmed: false,
    winner: freeze({
      variantId: winner.variant.id,
      variantLabel: winner.variant.label,
      emotionalVariantId: candidate.emotionalVariantId,
      emotionalVariantLabel: candidate.emotionalVariantLabel,
      stability: candidate.stability,
      paceProfile,
      notes: winner.notes
    }),
    narratorProductionLock: lock,
    nextAction: 'Narrator, emotional range and reproducible pace profile are locked for production planning. Build the production plan and budget next; full-book generation still requires a separate explicit arm.'
  });
}

export function renderPaceCeilingFinalizationMarkdown(result) {
  const lines = [
    '# Book One Pace Ceiling Calibration Finalization', '',
    `**Status:** ${result.status}`,
    `**Decision:** ${String(result.decision).toUpperCase()}`,
    `**Narrator production lock created:** ${result.narratorProductionLockCreated ? 'YES' : 'NO'}`,
    `**Full-book generation armed:** ${result.fullBookGenerationArmed ? 'YES' : 'NO'}`, ''
  ];
  if (result.winner && result.narratorProductionLock) {
    lines.push(
      '## Locked target', '',
      `- Narrator: **${result.narratorProductionLock.narrator.candidateName}**`,
      `- Emotion: **${result.winner.emotionalVariantLabel}**`,
      `- Stability: **${result.winner.stability}**`,
      `- Provider speed: **${result.winner.paceProfile.providerNativeSpeed.toFixed(2)}**`,
      `- Effective speed: **${result.winner.paceProfile.effectiveSpeed.toFixed(2)}**`,
      `- Post-process required: **${result.winner.paceProfile.postProcessRequired ? 'YES' : 'NO'}**`,
      ...(result.winner.paceProfile.postProcessRequired
        ? [`- Tempo multiplier: **${result.winner.paceProfile.postProcessTempoMultiplier.toFixed(6)}x**`, '- Tempo method: **FFmpeg atempo (pitch-preserving)**']
        : []),
      `- Lock digest: \`${result.narratorProductionLock.lockDigest}\``, ''
    );
  }
  lines.push('## Next action', '', result.nextAction, '');
  return lines.join('\n');
}
