import { withYasReadyPlatformUI } from '../ui/yasready-platform.js';
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { sha256, stableJson } from '../core/hash.js';
import { normalizeMoneyPolicy, moneyGuardDecision } from '../money/money-guard.js';
import { verifyProductionReadinessPlan } from './book-one-production-readiness-service.js';
import { YASREADY_AUDIOBOOKS_VERSION } from '../release.js';

const freeze = (value) => Object.freeze(value);
const clean = (value) => String(value ?? '').trim();
const round = (value) => Number(Number(value ?? 0).toFixed(6));
const ceilMoneyToCent = (value) => Number((Math.ceil((Number(value ?? 0) - Number.EPSILON) * 100) / 100).toFixed(2));

export const READINESS_TUNING_HARD_CEILING_USD = 1;

function browserSafeJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function tuningPlanCore(plan) {
  return {
    schemaVersion: plan.schemaVersion,
    release: plan.release,
    artifact: plan.artifact,
    status: plan.status,
    book: plan.book,
    sourceReadiness: plan.sourceReadiness,
    narrator: plan.narrator,
    sample: plan.sample,
    baselineDirection: plan.baselineDirection,
    operatorTuning: plan.operatorTuning,
    model: plan.model,
    outputFormat: plan.outputFormat,
    variants: plan.variants,
    cost: plan.cost,
    guardrails: plan.guardrails
  };
}

export function verifyReadinessTuningPlan(plan) {
  if (!plan || plan.artifact !== 'book-one-readiness-tuning-plan') throw new Error('Invalid Readiness Tuning plan');
  const expected = sha256(stableJson(tuningPlanCore(plan)));
  if (expected !== plan.integrity?.planFingerprint) throw new Error('Readiness Tuning plan integrity check failed; rebuild before spending');
  if (!plan.confirmation?.token) throw new Error('Readiness Tuning plan is missing its confirmation token');
  return true;
}

function sameBook(a, b) {
  const aId = clean(a?.id);
  const bId = clean(b?.id);
  const aHash = clean(a?.sourceHash);
  const bHash = clean(b?.sourceHash);
  if (aId && bId && aId !== bId) return false;
  if (aHash && bHash && aHash !== bHash) return false;
  return true;
}

export function deriveReadinessTuningSignals(note) {
  const text = clean(note).toLowerCase();
  const signals = [];
  if (/\b(?:faster|speed|pace|slow|too slow)\b/.test(text)) signals.push('increase-pace-slightly');
  if (/\b(?:emotion|emotions|emotional|expressive|expression|feeling|feelings)\b/.test(text)) signals.push('increase-emotional-expression-slightly');
  if (/\b(?:nice|good|works|like it|sounds really nice|sounds nice)\b/.test(text)) signals.push('preserve-core-performance');
  if (/\b(?:little|slightly|a bit)\b/.test(text)) signals.push('make-adjustments-subtle');
  return freeze([...new Set(signals)]);
}

function createVariants() {
  return freeze([
    freeze({
      id: 'faster-emotional',
      label: 'Faster + More Emotional',
      goal: 'Speed the same winning performance up slightly and allow a little more emotional range without becoming theatrical.',
      voiceSettings: freeze({ speed: 1.08, stability: 0.42 }),
      isolatedChange: 'pace + emotional range',
      seed: 73101
    }),
    freeze({
      id: 'faster-only',
      label: 'Faster Only',
      goal: 'Test whether pace was the main issue while otherwise preserving the winning performance.',
      voiceSettings: freeze({ speed: 1.08 }),
      isolatedChange: 'pace only',
      seed: 73102
    }),
    freeze({
      id: 'emotional-only',
      label: 'More Emotional Only',
      goal: 'Test a slightly broader emotional range while preserving the existing pace.',
      voiceSettings: freeze({ stability: 0.42 }),
      isolatedChange: 'emotional range only',
      seed: 73103
    })
  ]);
}

export async function buildReadinessTuningPlan({
  readinessPlan,
  readinessFinalization,
  estimator,
  model = null,
  outputFormat = null
} = {}) {
  verifyProductionReadinessPlan(readinessPlan);
  if (!readinessFinalization || readinessFinalization.artifact !== 'book-one-production-readiness-finalization') {
    throw new Error('Readiness Tuning requires production-readiness-finalization.json');
  }
  if (readinessFinalization.status !== 'NEEDS_TUNING' || clean(readinessFinalization.decision).toLowerCase() !== 'needs-tuning') {
    throw new Error('Readiness Tuning requires a NEEDS_TUNING Production Readiness finalization');
  }
  if (!sameBook(readinessPlan.book, readinessFinalization.book)) {
    throw new Error('Readiness Tuning finalization does not belong to this Book One readiness plan');
  }
  if (typeof estimator !== 'function') throw new Error('Readiness Tuning planning requires a provider cost estimator');

  const operatorNote = clean(readinessFinalization.notes);
  if (!operatorNote) throw new Error('Readiness Tuning requires the operator note explaining what needs tuning');

  const variants = createVariants();
  const selectedModel = model ?? readinessPlan.model ?? 'eleven_v3';
  const selectedOutputFormat = outputFormat ?? readinessPlan.outputFormat ?? 'mp3_44100_128';
  const estimates = [];
  let estimateUsd = 0;

  for (const variant of variants) {
    const estimate = await estimator({ text: readinessPlan.script.directedText, model: selectedModel });
    if (!Number.isFinite(Number(estimate?.amountUsd))) {
      throw new Error(`Provider cannot estimate Readiness Tuning cost for ${selectedModel}`);
    }
    const amountUsd = round(estimate.amountUsd);
    estimateUsd = round(estimateUsd + amountUsd);
    estimates.push(freeze({
      variantId: variant.id,
      amountUsd,
      characters: estimate.characters ?? [...readinessPlan.script.directedText].length,
      rateUsdPer1k: estimate.rateUsdPer1k ?? null
    }));
  }

  const reserveUsd = round(Math.max(0.03, estimateUsd * 0.25));
  const suggestedMaxUsd = ceilMoneyToCent(estimateUsd + reserveUsd);
  if (suggestedMaxUsd > READINESS_TUNING_HARD_CEILING_USD) {
    throw new Error(`Readiness Tuning round exceeds the $${READINESS_TUNING_HARD_CEILING_USD.toFixed(2)} hard ceiling`);
  }

  const base = {
    schemaVersion: 1,
    release: YASREADY_AUDIOBOOKS_VERSION,
    artifact: 'book-one-readiness-tuning-plan',
    status: 'READY_FOR_EXPLICIT_APPROVAL',
    sensitiveLocalArtifact: true,
    doNotCommit: true,
    book: readinessPlan.book,
    sourceReadiness: freeze({
      planFingerprint: readinessPlan.integrity.planFingerprint,
      finalizationRelease: readinessFinalization.release ?? null,
      finalizationStatus: readinessFinalization.status,
      finalizationDecision: readinessFinalization.decision,
      legacyFinalizationPlanFingerprintMissing: !readinessFinalization.planFingerprint
    }),
    narrator: freeze({
      provider: 'elevenlabs',
      providerVoiceId: readinessPlan.learning.providerVoiceId,
      candidateName: readinessPlan.learning.candidateName
    }),
    sample: readinessPlan.sample,
    baselineDirection: freeze({
      directionId: readinessPlan.learning.preferredDirectionId,
      directionLabel: readinessPlan.learning.preferredDirectionLabel,
      humanLearningNote: readinessPlan.learning.humanNote,
      scriptPolicy: readinessPlan.script.policy,
      directedText: readinessPlan.script.directedText,
      directedTextDigest: sha256(readinessPlan.script.directedText)
    }),
    operatorTuning: freeze({
      note: operatorNote,
      signals: deriveReadinessTuningSignals(operatorNote),
      policy: freeze({
        preserveNarratorVoice: true,
        preserveWinningDirection: true,
        preserveSameScene: true,
        noNewCastingSearch: true,
        noIdentityInferenceFromAudio: true,
        avoidTheatricalOvercorrection: true
      })
    }),
    model: selectedModel,
    outputFormat: selectedOutputFormat,
    variants,
    cost: freeze({
      estimateUsd,
      reserveUsd,
      suggestedMaxUsd,
      hardCeilingUsd: READINESS_TUNING_HARD_CEILING_USD,
      estimatedGenerationCalls: variants.length,
      estimates: freeze(estimates),
      roundingPolicy: 'protected-max-ceil-to-cent'
    }),
    guardrails: freeze({
      planningProviderGenerationCalls: 0,
      explicitApprovalRequired: true,
      exactPlanFingerprintRequired: true,
      maxUsdRequiredAtRender: true,
      providerSubscriptionPreflightRequired: true,
      sameNarratorRequired: true,
      sameSceneRequired: true,
      exactlyThreeTuningVariants: true,
      resumableCompletedVariantReuse: true,
      humanPassRequiredForNarratorProductionLock: true,
      productionGenerationArmed: false,
      narratorProductionLockCreated: false,
      fullBookGenerationArmed: false,
      identityInferenceFromAudio: false
    })
  };

  const planFingerprint = sha256(stableJson(tuningPlanCore(base)));
  const token = `TUNING-${planFingerprint.slice(0, 10).toUpperCase()}`;
  return freeze({
    ...base,
    integrity: freeze({ planFingerprint }),
    confirmation: freeze({
      token,
      instruction: `Rendering is blocked unless the operator supplies ${token} and --max-usd of at least $${suggestedMaxUsd.toFixed(2)}.`
    })
  });
}

export function renderReadinessTuningPlanMarkdown(plan) {
  verifyReadinessTuningPlan(plan);
  const lines = [
    '# Book One Readiness Tuning Loop', '',
    `**Status:** ${plan.status}`,
    `**Narrator:** ${plan.narrator.candidateName}`,
    `**Baseline direction:** ${plan.baselineDirection.directionLabel}`,
    `**Same readiness scene:** ${plan.sample.chapterTitle} — Scene ${plan.sample.sceneOrder}`,
    `**Sample length:** ${plan.sample.wordCount} words (~${plan.sample.estimatedSecondsAt155Wpm}s)`, '',
    '## Human tuning request', '',
    `> ${plan.operatorTuning.note}`, '',
    `Signals: ${plan.operatorTuning.signals.join(', ') || 'operator note preserved verbatim; no automatic signal matched'}`, '',
    '## Controlled variants', ''
  ];
  for (const variant of plan.variants) {
    const settings = Object.entries(variant.voiceSettings).map(([k, v]) => `${k}=${v}`).join(', ');
    lines.push(`- **${variant.label}** — ${variant.goal} (${settings})`);
  }
  lines.push(
    '', '## Spend gate', '',
    `- Estimated total: **$${plan.cost.estimateUsd.toFixed(2)}**`,
    `- Protected maximum: **$${plan.cost.suggestedMaxUsd.toFixed(2)}**`,
    `- Hard ceiling: $${plan.cost.hardCeilingUsd.toFixed(2)}`,
    `- Confirmation token: \`${plan.confirmation.token}\``,
    `- Generation calls if approved: **${plan.cost.estimatedGenerationCalls}**`,
    '- Planning generation calls: **0**', '',
    '> Same Ryan. Same scene. Same Playful + Flirty base direction. Only pace/emotional-range controls change. Full-book production stays unarmed.', ''
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
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function feedbackShell(plan) {
  return {
    schemaVersion: 1,
    release: YASREADY_AUDIOBOOKS_VERSION,
    artifact: 'book-one-readiness-tuning-human-feedback',
    planFingerprint: plan.integrity.planFingerprint,
    book: plan.book,
    narrator: plan.narrator,
    baselineDirection: {
      directionId: plan.baselineDirection.directionId,
      directionLabel: plan.baselineDirection.directionLabel
    },
    feedback: plan.variants.map((variant) => ({
      variantId: variant.id,
      variantLabel: variant.label,
      decision: null,
      notes: ''
    })),
    exportedAt: null
  };
}

export function renderReadinessTuningReviewHtml(plan, result) {
  const data = browserSafeJson({
    release: YASREADY_AUDIOBOOKS_VERSION,
    planFingerprint: plan.integrity.planFingerprint,
    book: plan.book,
    narrator: plan.narrator,
    sample: plan.sample,
    operatorTuning: plan.operatorTuning,
    variants: plan.variants,
    rendered: result.rendered,
    feedback: feedbackShell(plan)
  });
  return withYasReadyPlatformUI(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>YasReady Readiness Tuning — ${String(plan.book.title ?? '').replace(/[<>&"]/g, '')}</title>
<style>
:root{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","Segoe UI",sans-serif;color-scheme:light dark;--bg:#f5f5f7;--card:#fff;--text:#1d1d1f;--muted:#6e6e73;--line:rgba(0,0,0,.1);--accent:#0071e3;--good:#248a3d;--maybe:#b25000;--bad:#d70015}
@media(prefers-color-scheme:dark){:root{--bg:#000;--card:#1c1c1e;--text:#f5f5f7;--muted:#a1a1a6;--line:rgba(255,255,255,.14);--accent:#2997ff;--good:#30d158;--maybe:#ff9f0a;--bad:#ff453a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text)}main{max-width:1060px;margin:auto;padding:42px 22px 90px}.eyebrow{font-size:13px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--accent)}h1{font-size:clamp(40px,7vw,70px);line-height:.95;letter-spacing:-.055em;margin:8px 0 14px}.sub{font-size:18px;line-height:1.5;color:var(--muted);max-width:860px}.note{margin:22px 0;padding:18px;border-radius:22px;background:var(--card);border:1px solid var(--line)}.variant{margin-top:18px;padding:22px;border-radius:26px;background:var(--card);border:1px solid var(--line)}.variant h2{font-size:27px;letter-spacing:-.035em;margin:0 0 7px}.goal{color:var(--muted);font-size:14px;line-height:1.45}.chips{display:flex;flex-wrap:wrap;gap:7px;margin:12px 0}.chip{font-size:12px;color:var(--muted);border:1px solid var(--line);border-radius:999px;padding:6px 9px}audio{width:100%;margin:10px 0}.choices{display:grid;grid-template-columns:repeat(3,1fr);gap:9px;margin:12px 0}.choices button,.toolbar button{border:1px solid var(--line);border-radius:999px;padding:12px;font:inherit;font-weight:800;background:var(--bg);color:var(--text);cursor:pointer}.choices button.active.pass{background:var(--good);color:white}.choices button.active.maybe{background:var(--maybe);color:white}.choices button.active.fail{background:var(--bad);color:white}textarea{width:100%;min-height:72px;border:1px solid var(--line);border-radius:14px;padding:10px;background:var(--bg);color:var(--text);font:inherit}.toolbar{position:sticky;bottom:0;display:flex;gap:10px;flex-wrap:wrap;margin-top:25px;padding:12px 0;background:color-mix(in srgb,var(--bg) 90%,transparent);backdrop-filter:blur(18px)}.primary{background:var(--accent)!important;color:white!important}.status{font-size:13px;color:var(--muted);min-height:20px}.foot{font-size:12px;color:var(--muted);line-height:1.5;margin-top:28px}@media(max-width:680px){.choices{grid-template-columns:1fr}}
</style></head><body><main>
<div class="eyebrow">YasReady Audiobooks ${YASREADY_AUDIOBOOKS_VERSION}</div>
<h1>Readiness Tuning</h1>
<div class="sub">Same Ryan. Same Book One scene. Same Playful + Flirty base. Three controlled changes so you can hear whether the problem was pace, emotion, or both.</div>
<div class="note"><b>Your note</b><br>${String(plan.operatorTuning.note).replace(/[<>&"]/g, '')}</div>
<div id="content"></div>
<div class="toolbar"><button id="download" class="primary">Download Tuning Feedback</button><button id="copy">Copy Feedback JSON</button></div>
<div id="status" class="status"></div>
<div class="foot">Choose PASS — Lock on at most one variant. MAYBE means keep tuning. FAIL rejects that variant. A PASS only creates the narrator production lock after the finalize command; full-book generation stays off.</div>
<script>
const DATA=${data}; const key='yasready-readiness-tuning:'+DATA.planFingerprint;
let feedback=structuredClone(DATA.feedback);try{const saved=localStorage.getItem(key);if(saved)feedback=JSON.parse(saved)}catch{}
const content=document.getElementById('content'),status=document.getElementById('status');
function save(){localStorage.setItem(key,JSON.stringify(feedback))}
function row(id){return feedback.feedback.find(x=>x.variantId===id)}
function repaint(){
 for(const card of document.querySelectorAll('[data-variant]')){
  const r=row(card.dataset.variant);
  for(const b of card.querySelectorAll('[data-decision]')){
   b.className=(r.decision===b.dataset.decision)?'active '+b.dataset.decision:'';
  }
 }
}
for(const v of DATA.variants){
 const r=row(v.id),card=document.createElement('section');card.className='variant';card.dataset.variant=v.id;
 const h=document.createElement('h2');h.textContent=v.label;card.append(h);
 const g=document.createElement('div');g.className='goal';g.textContent=v.goal;card.append(g);
 const chips=document.createElement('div');chips.className='chips';
 for(const [k,val] of Object.entries(v.voiceSettings)){const c=document.createElement('span');c.className='chip';c.textContent=k+' '+val;chips.append(c)}card.append(chips);
 const audio=DATA.rendered.find(x=>x.variantId===v.id);const a=document.createElement('audio');a.controls=true;a.preload='metadata';a.src=audio.outputRelativePath;card.append(a);
 const choices=document.createElement('div');choices.className='choices';
 for(const [value,label] of [['pass','PASS — Lock'],['maybe','MAYBE'],['fail','FAIL']]){
  const b=document.createElement('button');b.dataset.decision=value;b.textContent=label;b.onclick=()=>{
   if(value==='pass'){for(const x of feedback.feedback){if(x.variantId!==v.id&&x.decision==='pass')x.decision=null}}
   r.decision=value;save();repaint()
  };choices.append(b)
 }card.append(choices);
 const ta=document.createElement('textarea');ta.placeholder='What changed? Better or worse?';ta.value=r.notes||'';ta.oninput=()=>{r.notes=ta.value;save()};card.append(ta);content.append(card)
}
repaint();
function payload(){feedback.exportedAt=new Date().toISOString();save();return JSON.stringify(feedback,null,2)}
document.getElementById('copy').onclick=async()=>{try{await navigator.clipboard.writeText(payload());status.textContent='Copied tuning feedback JSON.'}catch{status.textContent='Clipboard was blocked. Use Download Tuning Feedback.'}};
document.getElementById('download').onclick=async()=>{const text=payload();try{if(window.showSaveFilePicker){const h=await window.showSaveFilePicker({suggestedName:'readiness-tuning-feedback.json',types:[{description:'JSON',accept:{'application/json':['.json']}}]});const w=await h.createWritable();await w.write(text);await w.close();status.textContent='Saved readiness-tuning-feedback.json successfully.';return}}catch(e){if(e?.name==='AbortError'){status.textContent='Save cancelled.';return}}
const blob=new Blob([text],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='readiness-tuning-feedback.json';a.style.display='none';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),3000);status.textContent='Download requested. Check Downloads; use Copy Feedback JSON if Safari suppresses it.'};
</script></main></body></html>`);
}

export async function renderReadinessTuningRound({
  plan,
  provider,
  outDir,
  approvalToken,
  maxUsd
} = {}) {
  verifyReadinessTuningPlan(plan);
  if (!provider?.render) throw new Error('Readiness Tuning rendering requires an audio provider');
  if (clean(approvalToken) !== plan.confirmation.token) throw new Error(`Explicit tuning approval token mismatch. Expected ${plan.confirmation.token}`);

  const cap = Number(maxUsd);
  if (!Number.isFinite(cap) || cap <= 0) throw new Error('--max-usd must be a positive number');
  if (cap < plan.cost.suggestedMaxUsd) throw new Error(`--max-usd must be at least $${plan.cost.suggestedMaxUsd.toFixed(2)}`);
  if (cap > READINESS_TUNING_HARD_CEILING_USD) throw new Error(`--max-usd cannot exceed $${READINESS_TUNING_HARD_CEILING_USD.toFixed(2)} for tuning`);

  const entitlement = await providerSubscriptionPreflight(provider);
  const tier = clean(entitlement?.tier ?? entitlement?.subscription?.tier).toLowerCase();
  if (entitlement.available && tier === 'free') {
    throw new Error('ElevenLabs Voice Library API tuning requires a paid subscription. Account tier is Free. No audio was generated and no spend occurred.');
  }
  const health = typeof provider.healthCheck === 'function' ? await provider.healthCheck() : { ok: true };
  if (health?.ok === false) throw new Error(`ElevenLabs health check failed: ${health.reason ?? health.status ?? 'unknown'}`);

  const policy = normalizeMoneyPolicy({
    hardCapUsd: cap,
    warningThresholdRatio: 1,
    singleActionApprovalUsd: 0,
    estimateVarianceRatio: 0,
    providerCapsUsd: { elevenlabs: cap },
    operationCapsUsd: { audition: cap },
    requireApprovalAtWarning: false
  });
  const guard = moneyGuardDecision({
    policy,
    estimatedCostUsd: plan.cost.suggestedMaxUsd,
    provider: 'elevenlabs',
    operation: 'audition_render',
    approvedBy: 'explicit-readiness-tuning-confirmation'
  });
  if (guard.blocked) throw new Error(`Money Guard blocked Readiness Tuning: ${guard.reasons.join(', ')}`);

  const resolved = path.resolve(outDir);
  const audioDir = path.join(resolved, 'audio');
  const progressPath = path.join(resolved, 'readiness-tuning-progress.json');
  const resultPath = path.join(resolved, 'readiness-tuning-result.json');
  await mkdir(audioDir, { recursive: true });

  const existingResult = await readJsonIfExists(resultPath);
  if (existingResult?.status === 'READY_FOR_HUMAN_TUNING_REVIEW' &&
      existingResult?.planFingerprint === plan.integrity.planFingerprint &&
      (await Promise.all((existingResult.rendered ?? []).map((x) => exists(path.join(resolved, x.outputRelativePath))))).every(Boolean)) {
    return freeze({ ...existingResult, currentRunProviderGenerationCalls: 0, reusedClips: existingResult.rendered.length });
  }

  let progress = await readJsonIfExists(progressPath);
  if (progress?.planFingerprint && progress.planFingerprint !== plan.integrity.planFingerprint) {
    throw new Error('Output directory contains a different tuning plan. Use a new output directory instead of mixing paid artifacts.');
  }
  if (progress?.status === 'PAID_AUDIO_STORAGE_FAILED_DO_NOT_RERUN') {
    throw new Error('A prior tuning provider call succeeded but local audio storage failed. DO NOT RERUN this directory; recover the paid asset or start a deliberately new tuning round.');
  }

  const completed = [];
  for (const row of progress?.completed ?? []) {
    if (plan.variants.some((v) => v.id === row.variantId) && await exists(path.join(resolved, row.outputRelativePath))) {
      completed.push(row);
    }
  }

  let capturedUsd = round(completed.reduce((sum, row) => sum + Number(row.capturedUsd ?? 0), 0));
  let attemptedThisRun = 0;
  let successfulThisRun = 0;
  const resolvedVoiceId = await resolveVoiceId(provider, plan);

  const persist = async (status, extras = {}) => writeFile(progressPath, JSON.stringify({
    schemaVersion: 1,
    release: YASREADY_AUDIOBOOKS_VERSION,
    artifact: 'book-one-readiness-tuning-progress',
    planFingerprint: plan.integrity.planFingerprint,
    status,
    completed,
    capturedUsd,
    approvedMaxUsd: cap,
    attemptedProviderCallsThisRun: attemptedThisRun,
    successfulProviderCallsThisRun: successfulThisRun,
    productionGenerationCalls: 0,
    ...extras
  }, null, 2));

  await persist(completed.length ? 'RESUMING' : 'STARTING');

  for (let i = 0; i < plan.variants.length; i += 1) {
    const variant = plan.variants[i];
    if (completed.some((row) => row.variantId === variant.id)) continue;

    attemptedThisRun += 1;
    let output;
    try {
      output = await provider.render({
        voiceId: resolvedVoiceId,
        text: plan.baselineDirection.directedText,
        model: plan.model,
        outputFormat: plan.outputFormat,
        voiceSettings: variant.voiceSettings,
        languageCode: 'en',
        seed: variant.seed,
        applyTextNormalization: 'auto'
      });
    } catch (error) {
      await persist('PARTIAL_FAILED', { failedVariantId: variant.id, message: error.message });
      throw error;
    }

    successfulThisRun += 1;
    const estimateLine = plan.cost.estimates.find((x) => x.variantId === variant.id);
    const clipCost = Number.isFinite(Number(output.estimatedCostUsd))
      ? round(output.estimatedCostUsd)
      : Number(estimateLine?.amountUsd ?? 0);
    capturedUsd = round(capturedUsd + clipCost);
    if (capturedUsd > cap) {
      await persist('PAID_SPEND_CAP_EXCEEDED_DO_NOT_RERUN', {
        paidVariantId: variant.id,
        requestId: output.requestId ?? null
      });
      throw new Error(`Tuning spend reached $${capturedUsd.toFixed(2)}, exceeding $${cap.toFixed(2)} cap after a successful provider call. Do not blindly rerun.`);
    }

    const outputRelativePath = `audio/${String(i + 1).padStart(2, '0')}-${variant.id}.mp3`;
    await persist('PROVIDER_CALL_SUCCEEDED_ASSET_PENDING', {
      paidVariantId: variant.id,
      requestId: output.requestId ?? null
    });
    try {
      await writeFile(path.join(resolved, outputRelativePath), output.audio);
    } catch (error) {
      await persist('PAID_AUDIO_STORAGE_FAILED_DO_NOT_RERUN', {
        paidVariantId: variant.id,
        requestId: output.requestId ?? null,
        message: error.message
      });
      throw error;
    }

    completed.push({
      variantId: variant.id,
      variantLabel: variant.label,
      outputRelativePath,
      capturedUsd: clipCost,
      billedCharacters: output.billedCharacters ?? null,
      requestId: output.requestId ?? null,
      voiceSettings: variant.voiceSettings
    });
    await persist('RENDERING');
  }

  const ordered = plan.variants.map((variant) => completed.find((row) => row.variantId === variant.id)).filter(Boolean);
  if (ordered.length !== plan.variants.length) throw new Error('Readiness Tuning did not produce every planned variant');

  const result = freeze({
    schemaVersion: 1,
    release: YASREADY_AUDIOBOOKS_VERSION,
    artifact: 'book-one-readiness-tuning-result',
    status: 'READY_FOR_HUMAN_TUNING_REVIEW',
    planFingerprint: plan.integrity.planFingerprint,
    book: plan.book,
    narrator: plan.narrator,
    baselineDirection: {
      directionId: plan.baselineDirection.directionId,
      directionLabel: plan.baselineDirection.directionLabel
    },
    rendered: freeze(ordered.map(freeze)),
    providerGenerationCalls: ordered.length,
    currentRunProviderGenerationCalls: successfulThisRun,
    reusedClips: ordered.length - successfulThisRun,
    productionGenerationCalls: 0,
    narratorProductionLockCreated: false,
    fullBookGenerationArmed: false,
    subscriptionPreflight: freeze({
      available: Boolean(entitlement.available),
      reason: entitlement.reason ?? null,
      tier: entitlement.available ? tier || null : null
    }),
    cost: freeze({
      estimateUsd: plan.cost.estimateUsd,
      capturedUsd,
      maxUsd: cap,
      headroomUsd: round(cap - capturedUsd)
    })
  });

  await Promise.all([
    writeFile(resultPath, JSON.stringify(result, null, 2)),
    writeFile(path.join(resolved, 'readiness-tuning-review.html'), renderReadinessTuningReviewHtml(plan, result)),
    writeFile(path.join(resolved, 'readiness-tuning-feedback-template.json'), JSON.stringify(feedbackShell(plan), null, 2)),
    persist('COMPLETE')
  ]);
  return result;
}

export function finalizeReadinessTuning({ plan, feedback } = {}) {
  verifyReadinessTuningPlan(plan);
  if (!feedback || feedback.artifact !== 'book-one-readiness-tuning-human-feedback') {
    throw new Error('Invalid readiness-tuning-feedback.json');
  }
  if (feedback.planFingerprint !== plan.integrity.planFingerprint) {
    throw new Error('Readiness Tuning feedback does not belong to this plan');
  }
  const rows = plan.variants.map((variant) => {
    const source = (feedback.feedback ?? []).find((x) => x.variantId === variant.id);
    return {
      variant,
      decision: clean(source?.decision).toLowerCase() || null,
      notes: clean(source?.notes)
    };
  });
  for (const row of rows) {
    if (row.decision && !['pass', 'maybe', 'fail'].includes(row.decision)) {
      throw new Error(`Unknown tuning decision for ${row.variant.id}: ${row.decision}`);
    }
  }
  const passes = rows.filter((row) => row.decision === 'pass');
  if (passes.length > 1) throw new Error('Readiness Tuning allows only one PASS — Lock variant');

  if (passes.length === 0) {
    const anyMaybe = rows.some((row) => row.decision === 'maybe');
    const allFail = rows.every((row) => row.decision === 'fail');
    return freeze({
      schemaVersion: 1,
      release: YASREADY_AUDIOBOOKS_VERSION,
      artifact: 'book-one-readiness-tuning-finalization',
      status: anyMaybe ? 'NEEDS_TUNING' : allFail ? 'FAILED' : 'INCOMPLETE',
      decision: anyMaybe ? 'maybe' : allFail ? 'fail' : 'incomplete',
      book: plan.book,
      narratorProductionLockCreated: false,
      productionArmed: false,
      fullBookGenerationArmed: false,
      choices: freeze(rows.map((row) => freeze({
        variantId: row.variant.id,
        variantLabel: row.variant.label,
        decision: row.decision,
        notes: row.notes
      }))),
      nextAction: anyMaybe
        ? 'Keep tuning the preferred variant. No narrator lock was created and full-book generation remains off.'
        : allFail
          ? 'Return to performance direction before production. No narrator lock was created.'
          : 'Finish the human tuning review before finalizing.'
    });
  }

  const winner = passes[0];
  const lockCore = {
    schemaVersion: 1,
    release: YASREADY_AUDIOBOOKS_VERSION,
    artifact: 'book-one-narrator-production-lock',
    status: 'LOCKED_FOR_PRODUCTION_PLANNING',
    book: plan.book,
    narrator: plan.narrator,
    performanceProfile: freeze({
      source: 'explicit-human-readiness-tuning-pass',
      baseDirectionId: plan.baselineDirection.directionId,
      baseDirectionLabel: plan.baselineDirection.directionLabel,
      tuningVariantId: winner.variant.id,
      tuningVariantLabel: winner.variant.label,
      voiceSettings: winner.variant.voiceSettings,
      tuningGoal: winner.variant.goal,
      originalHumanLearningNote: plan.baselineDirection.humanLearningNote,
      priorReadinessTuningRequest: plan.operatorTuning.note,
      finalTuningOperatorNote: winner.notes,
      restraint: plan.baselineDirection.scriptPolicy.restraint,
      narrator: plan.baselineDirection.scriptPolicy.narrator,
      juan: plan.baselineDirection.scriptPolicy.juan,
      michael: plan.baselineDirection.scriptPolicy.michael,
      christopher: plan.baselineDirection.scriptPolicy.christopher,
      identityInferenceFromAudio: false
    }),
    readinessEvidence: freeze({
      sourceReadinessPlanFingerprint: plan.sourceReadiness.planFingerprint,
      tuningPlanFingerprint: plan.integrity.planFingerprint,
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
    artifact: 'book-one-readiness-tuning-finalization',
    status: 'PASSED',
    decision: 'pass',
    book: plan.book,
    narratorProductionLockCreated: true,
    productionArmed: false,
    fullBookGenerationArmed: false,
    winner: freeze({
      variantId: winner.variant.id,
      variantLabel: winner.variant.label,
      voiceSettings: winner.variant.voiceSettings,
      notes: winner.notes
    }),
    narratorProductionLock: lock,
    nextAction: 'Narrator + tuned performance profile are locked for production planning. Build the production plan and budget next; full-book generation still requires a separate explicit arm.'
  });
}

export function renderReadinessTuningFinalizationMarkdown(result) {
  const lines = [
    '# Book One Readiness Tuning Finalization', '',
    `**Status:** ${result.status}`,
    `**Decision:** ${String(result.decision).toUpperCase()}`,
    `**Narrator production lock created:** ${result.narratorProductionLockCreated ? 'YES' : 'NO'}`,
    `**Full-book generation armed:** ${result.fullBookGenerationArmed ? 'YES' : 'NO'}`, ''
  ];
  if (result.winner && result.narratorProductionLock) {
    lines.push(
      '## Locked tuning target', '',
      `- Narrator: **${result.narratorProductionLock.narrator.candidateName}**`,
      `- Base direction: **${result.narratorProductionLock.performanceProfile.baseDirectionLabel}**`,
      `- Winning tune: **${result.winner.variantLabel}**`,
      `- Voice settings: \`${JSON.stringify(result.winner.voiceSettings)}\``,
      `- Lock digest: \`${result.narratorProductionLock.lockDigest}\``, ''
    );
  }
  lines.push('## Next action', '', result.nextAction, '');
  return lines.join('\n');
}
