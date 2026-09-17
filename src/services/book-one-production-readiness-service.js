import { withYasReadyPlatformUI } from '../ui/yasready-platform.js';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { sha256, stableJson } from '../core/hash.js';
import { normalizeMoneyPolicy, moneyGuardDecision } from '../money/money-guard.js';
import { YASREADY_AUDIOBOOKS_VERSION } from '../release.js';

const freeze = (value) => Object.freeze(value);
const round = (value) => Number(Number(value ?? 0).toFixed(6));
const clean = (value) => String(value ?? '').trim();
const words = (text) => (String(text ?? '').match(/[\p{L}\p{N}]+(?:[’'-][\p{L}\p{N}]+)*/gu) ?? []).length;
const ceilMoneyToCent = (value) => Number((Math.ceil((Number(value ?? 0) - Number.EPSILON) * 100) / 100).toFixed(2));

export const PRODUCTION_READINESS_HARD_CEILING_USD = 1;
export const READINESS_MIN_WORDS = 155;
export const READINESS_MAX_WORDS = 235;
export const READINESS_TARGET_WORDS = 195;

function browserSafeJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function isProductionChapter(title) {
  return !/^(?:front matter|copyright|dedication|table of contents|acknowledg(?:e)?ments|author(?:'s)? note|afterword)$/i.test(clean(title));
}

function canonicalSpeakerName(segment) {
  return clean(segment?.speakerCandidate?.name).replace(/[’']s$/u, '');
}

function coreSpeakerKey(name) {
  const v = clean(name).toLowerCase();
  if (/juan|delgado/.test(v)) return 'juan';
  if (/michael|rawlins/.test(v)) return 'michael';
  if (/christopher|lancaster/.test(v)) return 'christopher';
  return null;
}

function candidateWindow({ chapter, scene, segments, start, end }) {
  const rows = segments.slice(start, end + 1);
  const wordCount = rows.reduce((sum, row) => sum + words(row.text), 0);
  const dialogue = rows.filter((row) => row.kind === 'dialogue');
  const narration = rows.filter((row) => row.kind === 'narration');
  const firstDialogueIndex = rows.findIndex((row) => row.kind === 'dialogue');
  let lastDialogueIndex = -1;
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    if (rows[i].kind === 'dialogue') { lastDialogueIndex = i; break; }
  }
  const narrationBeforeDialogue = firstDialogueIndex > 0 && rows.slice(0, firstDialogueIndex).some((row) => row.kind === 'narration');
  const narrationAfterDialogue = lastDialogueIndex >= 0 && rows.slice(lastDialogueIndex + 1).some((row) => row.kind === 'narration');
  const speakerNames = [...new Set(dialogue.map(canonicalSpeakerName).filter(Boolean))];
  const coreSpeakers = [...new Set(speakerNames.map(coreSpeakerKey).filter(Boolean))];
  const targetDistance = Math.abs(wordCount - READINESS_TARGET_WORDS);
  const score =
    (narrationBeforeDialogue ? 35 : 0) +
    (narrationAfterDialogue ? 35 : 0) +
    Math.min(dialogue.length, 6) * 4 +
    Math.min(narration.length, 6) * 2 +
    coreSpeakers.length * 20 +
    speakerNames.length * 4 -
    targetDistance * 0.25;

  return {
    chapterOrder: chapter.order,
    chapterTitle: chapter.title,
    sceneOrder: scene.order,
    startSegmentOrder: rows[0]?.order ?? start,
    endSegmentOrder: rows.at(-1)?.order ?? end,
    wordCount,
    estimatedSecondsAt155Wpm: Number(((wordCount / 155) * 60).toFixed(1)),
    dialogueSegments: dialogue.length,
    narrationSegments: narration.length,
    narrationBeforeDialogue,
    narrationAfterDialogue,
    speakerNames,
    coreSpeakers,
    score: Number(score.toFixed(2)),
    segments: rows.map((row) => ({
      order: row.order,
      kind: row.kind,
      text: row.text,
      speakerCandidate: row.speakerCandidate ?? null
    }))
  };
}

export function selectProductionReadinessSample(analysis, {
  minWords = READINESS_MIN_WORDS,
  maxWords = READINESS_MAX_WORDS
} = {}) {
  if (!analysis?.chapters?.length) throw new Error('Production Readiness requires analyzed manuscript chapters');
  const candidates = [];

  for (const chapter of analysis.chapters) {
    if (!isProductionChapter(chapter.title)) continue;
    for (const scene of chapter.scenes ?? []) {
      const segments = scene.segments ?? [];
      if (segments.length < 3) continue;
      for (let start = 0; start < segments.length; start += 1) {
        if (segments[start].kind !== 'narration') continue;
        let count = 0;
        for (let end = start; end < segments.length; end += 1) {
          count += words(segments[end].text);
          if (count > maxWords) break;
          if (count < minWords) continue;
          if (segments[end].kind !== 'narration') continue;
          const row = candidateWindow({ chapter, scene, segments, start, end });
          if (row.dialogueSegments < 2) continue;
          if (!row.narrationBeforeDialogue || !row.narrationAfterDialogue) continue;
          candidates.push(row);
        }
      }
    }
  }

  if (!candidates.length) {
    throw new Error(`No contiguous ${minWords}-${maxWords} word narration→dialogue→narration sample was found; choose a manuscript scene manually instead of weakening the readiness gate.`);
  }
  candidates.sort((a, b) =>
    b.coreSpeakers.length - a.coreSpeakers.length ||
    b.score - a.score ||
    Math.abs(a.wordCount - READINESS_TARGET_WORDS) - Math.abs(b.wordCount - READINESS_TARGET_WORDS) ||
    a.chapterOrder - b.chapterOrder ||
    a.sceneOrder - b.sceneOrder
  );
  return freeze(candidates[0]);
}

function directionTagForSegment(segment, seenSpeakers, narrationTagged) {
  if (segment.kind === 'narration') {
    if (!narrationTagged.value) {
      narrationTagged.value = true;
      return '[warmly]';
    }
    return null;
  }
  const speaker = coreSpeakerKey(canonicalSpeakerName(segment));
  if (speaker && seenSpeakers.has(speaker)) return null;
  if (speaker) seenSpeakers.add(speaker);
  if (speaker === 'juan') return '[playfully]';
  if (speaker === 'michael') return '[warmly]';
  if (speaker === 'christopher') return '[mischievously]';
  return '[softly]';
}

export function compileProductionReadinessScript(sample) {
  const seenSpeakers = new Set();
  const narrationTagged = { value: false };
  const pieces = [];
  const directionMap = [];
  for (const segment of sample.segments) {
    const tag = directionTagForSegment(segment, seenSpeakers, narrationTagged);
    const spoken = segment.kind === 'dialogue' ? `“${segment.text}”` : segment.text;
    pieces.push(`${tag ? `${tag} ` : ''}${spoken}`);
    directionMap.push(freeze({
      segmentOrder: segment.order,
      kind: segment.kind,
      speaker: canonicalSpeakerName(segment) || null,
      directionTag: tag
    }));
  }
  return freeze({
    directedText: pieces.join('\n\n'),
    directionMap: freeze(directionMap),
    policy: freeze({
      overallTarget: 'younger, playful, flirty, warm queer-romance energy',
      restraint: 'keep character voices natural and distinct without overplaying them',
      narrator: 'warm, contemporary, conversational',
      juan: 'playful and charismatic; never shouty',
      michael: 'warm and grounded; subtle Oklahoma coloration only',
      christopher: 'polished, playful, confident; contemporary California',
      identityInferenceFromAudio: false
    })
  });
}

function readinessPlanCore(plan) {
  return {
    schemaVersion: plan.schemaVersion,
    release: plan.release,
    artifact: plan.artifact,
    book: plan.book,
    learning: plan.learning,
    model: plan.model,
    outputFormat: plan.outputFormat,
    sample: plan.sample,
    script: plan.script,
    cost: plan.cost,
    guardrails: plan.guardrails
  };
}

export function verifyProductionReadinessPlan(plan) {
  if (!plan || plan.artifact !== 'book-one-production-readiness-plan') throw new Error('Invalid Production Readiness plan');
  const expected = sha256(stableJson(readinessPlanCore(plan)));
  if (expected !== plan.integrity?.planFingerprint) throw new Error('Production Readiness plan integrity check failed; rebuild before spending');
  if (!plan.confirmation?.token) throw new Error('Production Readiness plan is missing its confirmation token');
  return true;
}

export async function buildProductionReadinessPlan({
  learningSummary,
  analysis,
  estimator,
  model = 'eleven_v3',
  outputFormat = 'mp3_44100_128'
} = {}) {
  if (!learningSummary || learningSummary.artifact !== 'book-one-performance-direction-learning-summary') {
    throw new Error('Production Readiness requires the completed performance-direction-learning-summary.json');
  }
  if (learningSummary.status !== 'COMPLETE' || learningSummary.winner?.decision !== 'best') {
    throw new Error('Production Readiness requires an explicit human BEST performance-direction winner');
  }
  if (!learningSummary.winner?.providerVoiceId || !learningSummary.winner?.variantId) {
    throw new Error('Production Readiness winner is missing voice/direction identity');
  }
  if (typeof estimator !== 'function') throw new Error('Production Readiness planning requires a provider cost estimator');

  const manuscriptHash = clean(analysis?.source?.sourceHash);
  const expectedHash = clean(learningSummary.book?.sourceHash);
  if (expectedHash && manuscriptHash && expectedHash !== manuscriptHash) {
    throw new Error('Production Readiness manuscript source hash does not match the human-learning Book One source');
  }

  const sample = selectProductionReadinessSample(analysis);
  const script = compileProductionReadinessScript(sample);
  const estimate = await estimator({ text: script.directedText, model });
  if (!Number.isFinite(Number(estimate?.amountUsd))) throw new Error(`Provider cannot estimate Production Readiness cost for ${model}`);

  const estimateUsd = round(estimate.amountUsd);
  const reserveUsd = round(Math.max(0.02, estimateUsd * 0.25));
  const suggestedMaxUsd = ceilMoneyToCent(estimateUsd + reserveUsd);
  if (suggestedMaxUsd > PRODUCTION_READINESS_HARD_CEILING_USD) {
    throw new Error(`Production Readiness sample exceeds the $${PRODUCTION_READINESS_HARD_CEILING_USD.toFixed(2)} hard ceiling`);
  }

  const base = {
    schemaVersion: 1,
    release: YASREADY_AUDIOBOOKS_VERSION,
    artifact: 'book-one-production-readiness-plan',
    status: 'READY_FOR_EXPLICIT_APPROVAL',
    sensitiveLocalArtifact: true,
    doNotCommit: true,
    book: freeze({
      ...learningSummary.book,
      sourceHash: expectedHash || manuscriptHash || null
    }),
    learning: freeze({
      sourcePlanFingerprint: learningSummary.planFingerprint,
      providerVoiceId: learningSummary.winner.providerVoiceId,
      candidateName: learningSummary.winner.candidateName,
      preferredDirectionId: learningSummary.winner.variantId,
      preferredDirectionLabel: learningSummary.winner.variantLabel,
      humanNote: learningSummary.winner.notes,
      explicitHumanWinner: true
    }),
    model,
    outputFormat,
    sample,
    script,
    cost: freeze({
      estimateUsd,
      reserveUsd,
      suggestedMaxUsd,
      hardCeilingUsd: PRODUCTION_READINESS_HARD_CEILING_USD,
      estimatedCharacters: estimate.characters ?? [...script.directedText].length,
      estimatedGenerationCalls: 1,
      roundingPolicy: 'protected-max-ceil-to-cent'
    }),
    guardrails: freeze({
      planningProviderGenerationCalls: 0,
      explicitApprovalRequired: true,
      exactPlanFingerprintRequired: true,
      maxUsdRequiredAtRender: true,
      providerSubscriptionPreflightRequired: true,
      oneReadinessGenerationCallOnly: true,
      humanPassRequiredForNarratorProductionLock: true,
      productionGenerationArmed: false,
      narratorProductionLockCreated: false,
      fullBookGenerationArmed: false,
      identityInferenceFromAudio: false
    })
  };
  const planFingerprint = sha256(stableJson(readinessPlanCore(base)));
  const token = `READINESS-${planFingerprint.slice(0, 10).toUpperCase()}`;
  return freeze({
    ...base,
    integrity: freeze({ planFingerprint }),
    confirmation: freeze({
      token,
      instruction: `Rendering is blocked unless the operator supplies ${token} and --max-usd of at least $${suggestedMaxUsd.toFixed(2)}.`
    })
  });
}

export function renderProductionReadinessPlanMarkdown(plan) {
  verifyProductionReadinessPlan(plan);
  return [
    '# Book One Production Readiness Gate', '',
    `**Status:** ${plan.status}`,
    `**Narrator target:** ${plan.learning.candidateName}`,
    `**Performance target:** ${plan.learning.preferredDirectionLabel}`,
    `**Chapter:** ${plan.sample.chapterTitle}`,
    `**Scene:** ${plan.sample.sceneOrder}`,
    `**Sample length:** ${plan.sample.wordCount} words (~${plan.sample.estimatedSecondsAt155Wpm}s at 155 wpm)`,
    `**Dialogue segments:** ${plan.sample.dialogueSegments}`,
    `**Detected speakers:** ${plan.sample.speakerNames.join(', ') || 'unresolved'}`, '',
    '## Direction', '',
    `- Overall: ${plan.script.policy.overallTarget}`,
    `- Restraint: ${plan.script.policy.restraint}`,
    `- Juan: ${plan.script.policy.juan}`,
    `- Michael: ${plan.script.policy.michael}`,
    `- Christopher: ${plan.script.policy.christopher}`, '',
    '## Spend gate', '',
    `- Estimated cost: **$${plan.cost.estimateUsd.toFixed(2)}**`,
    `- Protected maximum: **$${plan.cost.suggestedMaxUsd.toFixed(2)}**`,
    `- Confirmation token: \`${plan.confirmation.token}\``,
    '- Generation calls if approved: **1**',
    '- Planning generation calls: **0**', '',
    '> This is a readiness sample only. Full-book production remains unarmed and no narrator production lock exists until a human PASS.', ''
  ].join('\n');
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

async function resolveReadinessVoiceId(provider, plan) {
  if (typeof provider.listSavedVoices !== 'function') return plan.learning.providerVoiceId;
  try {
    const saved = await provider.listSavedVoices({ search: plan.learning.candidateName, pageSize: 100 });
    const match = (saved?.voices ?? []).find((voice) =>
      voice.providerVoiceId === plan.learning.providerVoiceId ||
      clean(voice.name).toLowerCase().includes(clean(plan.learning.candidateName).toLowerCase())
    );
    return match?.providerVoiceId ?? plan.learning.providerVoiceId;
  } catch {
    return plan.learning.providerVoiceId;
  }
}

function reviewFeedbackShell(plan) {
  return {
    schemaVersion: 1,
    release: YASREADY_AUDIOBOOKS_VERSION,
    artifact: 'book-one-production-readiness-human-feedback',
    planFingerprint: plan.integrity.planFingerprint,
    book: plan.book,
    narrator: {
      providerVoiceId: plan.learning.providerVoiceId,
      candidateName: plan.learning.candidateName,
      directionId: plan.learning.preferredDirectionId,
      directionLabel: plan.learning.preferredDirectionLabel
    },
    decision: null,
    notes: '',
    exportedAt: null
  };
}

export function renderProductionReadinessReviewHtml(plan, result) {
  const data = browserSafeJson({
    release: YASREADY_AUDIOBOOKS_VERSION,
    book: plan.book,
    sample: plan.sample,
    learning: plan.learning,
    audio: result.outputRelativePath,
    feedback: reviewFeedbackShell(plan)
  });

  return withYasReadyPlatformUI(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>YasReady Production Readiness — ${String(plan.book.title ?? '').replace(/[<>&"]/g, '')}</title>
<style>
:root{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","Segoe UI",sans-serif;color-scheme:light dark;--bg:#f5f5f7;--card:#fff;--text:#1d1d1f;--muted:#6e6e73;--line:rgba(0,0,0,.1);--accent:#0071e3;--good:#248a3d;--warn:#b25000;--bad:#d70015}
@media(prefers-color-scheme:dark){:root{--bg:#000;--card:#1c1c1e;--text:#f5f5f7;--muted:#a1a1a6;--line:rgba(255,255,255,.14);--accent:#2997ff;--good:#30d158;--warn:#ff9f0a;--bad:#ff453a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text)}main{max-width:980px;margin:auto;padding:44px 22px 90px}.eyebrow{color:var(--accent);font-size:13px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}h1{font-size:clamp(42px,7vw,72px);line-height:.95;letter-spacing:-.055em;margin:8px 0 14px}.sub{font-size:18px;line-height:1.45;color:var(--muted);max-width:800px}.card{margin-top:24px;padding:24px;border-radius:28px;background:var(--card);border:1px solid var(--line)}.meta{display:flex;flex-wrap:wrap;gap:8px;margin:14px 0}.pill{border:1px solid var(--line);border-radius:999px;padding:7px 10px;font-size:12px;color:var(--muted)}audio{width:100%;margin:14px 0}.choices{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:18px 0}.choices button,.toolbar button{border:1px solid var(--line);border-radius:999px;padding:13px;font:inherit;font-weight:800;background:var(--bg);color:var(--text);cursor:pointer}.choices button.active.pass{background:var(--good);color:#fff}.choices button.active.tune{background:var(--warn);color:#fff}.choices button.active.fail{background:var(--bad);color:#fff}.toolbar{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}.primary{background:var(--accent)!important;color:#fff!important}.status{font-size:13px;color:var(--muted);min-height:20px;margin-top:8px}textarea{width:100%;min-height:100px;border:1px solid var(--line);border-radius:16px;padding:12px;background:var(--bg);color:var(--text);font:inherit}.foot{font-size:12px;color:var(--muted);line-height:1.5;margin-top:26px}@media(max-width:650px){.choices{grid-template-columns:1fr}}
</style></head><body><main>
<div class="eyebrow">YasReady Audiobooks ${YASREADY_AUDIOBOOKS_VERSION}</div>
<h1>Production Readiness</h1>
<div class="sub">One real contiguous Book One scene. One narrator. One winning direction. Pass this before the system is allowed to create the production narrator lock.</div>
<div class="card">
<h2>${String(plan.learning.candidateName).replace(/[<>&"]/g, '')} — ${String(plan.learning.preferredDirectionLabel).replace(/[<>&"]/g, '')}</h2>
<div class="meta"><span class="pill">${plan.sample.wordCount} words</span><span class="pill">~${plan.sample.estimatedSecondsAt155Wpm}s</span><span class="pill">${String(plan.sample.chapterTitle).replace(/[<>&"]/g, '')}</span></div>
<audio controls preload="metadata" src="${result.outputRelativePath}"></audio>
<div class="choices">
<button data-decision="pass">PASS — Lock it</button>
<button data-decision="needs-tuning">NEEDS TUNING</button>
<button data-decision="fail">FAIL — Return to casting</button>
</div>
<textarea id="notes" placeholder="Does this hold up as an actual audiobook scene? What should stay or change?"></textarea>
<div class="toolbar"><button id="download" class="primary">Download Feedback JSON</button><button id="copy">Copy Feedback JSON</button></div>
<div id="status" class="status"></div>
</div>
<div class="foot">A PASS creates the local narrator production lock and performance profile only after you run the finalize command. It still does not arm full-book generation.</div>
<script>
const DATA=${data}; const key='yasready-readiness:'+DATA.feedback.planFingerprint;
let feedback=structuredClone(DATA.feedback); try{const saved=localStorage.getItem(key);if(saved)feedback=JSON.parse(saved)}catch{}
const status=document.getElementById('status'), notes=document.getElementById('notes'); notes.value=feedback.notes||'';
function save(){localStorage.setItem(key,JSON.stringify(feedback))}
for(const btn of document.querySelectorAll('[data-decision]')){if(btn.dataset.decision===feedback.decision)btn.classList.add('active',btn.dataset.decision==='pass'?'pass':btn.dataset.decision==='needs-tuning'?'tune':'fail');btn.onclick=()=>{feedback.decision=btn.dataset.decision;for(const b of document.querySelectorAll('[data-decision]'))b.className='';btn.classList.add('active',btn.dataset.decision==='pass'?'pass':btn.dataset.decision==='needs-tuning'?'tune':'fail');save()}}
notes.oninput=()=>{feedback.notes=notes.value;save()};
function payload(){feedback.exportedAt=new Date().toISOString();save();return JSON.stringify(feedback,null,2)}
document.getElementById('copy').onclick=async()=>{try{await navigator.clipboard.writeText(payload());status.textContent='Copied. If Safari blocks the download, paste this JSON into a file named production-readiness-feedback.json.'}catch{status.textContent='Clipboard was blocked by the browser. Use Download Feedback JSON.'}};
document.getElementById('download').onclick=async()=>{const text=payload();try{if(window.showSaveFilePicker){const h=await window.showSaveFilePicker({suggestedName:'production-readiness-feedback.json',types:[{description:'JSON',accept:{'application/json':['.json']}}]});const w=await h.createWritable();await w.write(text);await w.close();status.textContent='Saved production-readiness-feedback.json successfully.';return}}catch(e){if(e?.name==='AbortError'){status.textContent='Save cancelled.';return}}
const blob=new Blob([text],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='production-readiness-feedback.json';a.style.display='none';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),3000);status.textContent='Download requested. Check your Downloads folder. If Safari suppresses it, use Copy Feedback JSON.'};
</script></main></body></html>`);
}

export async function renderProductionReadinessSample({
  plan,
  provider,
  outDir,
  approvalToken,
  maxUsd
} = {}) {
  verifyProductionReadinessPlan(plan);
  if (!provider?.render) throw new Error('Production Readiness rendering requires an audio provider');
  if (clean(approvalToken) !== plan.confirmation.token) throw new Error(`Explicit readiness approval token mismatch. Expected ${plan.confirmation.token}`);

  const cap = Number(maxUsd);
  if (!Number.isFinite(cap) || cap <= 0) throw new Error('--max-usd must be a positive number');
  if (cap < plan.cost.suggestedMaxUsd) throw new Error(`--max-usd must be at least $${plan.cost.suggestedMaxUsd.toFixed(2)}`);
  if (cap > PRODUCTION_READINESS_HARD_CEILING_USD) throw new Error(`--max-usd cannot exceed $${PRODUCTION_READINESS_HARD_CEILING_USD.toFixed(2)} for readiness`);

  const entitlement = await providerSubscriptionPreflight(provider);
  const tier = clean(entitlement?.tier ?? entitlement?.subscription?.tier).toLowerCase();
  if (entitlement.available && tier === 'free') {
    throw new Error('ElevenLabs Voice Library API readiness rendering requires a paid subscription. Account tier is Free. No audio was generated and no spend occurred.');
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
    approvedBy: 'explicit-readiness-confirmation'
  });
  if (guard.blocked) throw new Error(`Money Guard blocked Production Readiness: ${guard.reasons.join(', ')}`);

  const resolved = path.resolve(outDir);
  await mkdir(path.join(resolved, 'audio'), { recursive: true });
  const progressPath = path.join(resolved, 'production-readiness-progress.json');
  await writeFile(progressPath, JSON.stringify({
    status: 'STARTING',
    providerGenerationCalls: 0,
    productionGenerationCalls: 0,
    maxUsd: cap
  }, null, 2));

  let output;
  try {
    const resolvedVoiceId = await resolveReadinessVoiceId(provider, plan);
    output = await provider.render({
      voiceId: resolvedVoiceId,
      text: plan.script.directedText,
      model: plan.model,
      outputFormat: plan.outputFormat,
      languageCode: 'en',
      seed: 424242,
      applyTextNormalization: 'auto'
    });
  } catch (error) {
    await writeFile(progressPath, JSON.stringify({
      status: 'FAILED_BEFORE_SUCCESSFUL_CLIP',
      providerGenerationCalls: 0,
      productionGenerationCalls: 0,
      message: error.message
    }, null, 2));
    throw error;
  }

  const capturedUsd = Number.isFinite(Number(output.estimatedCostUsd))
    ? round(output.estimatedCostUsd)
    : plan.cost.estimateUsd;
  if (capturedUsd > cap) throw new Error(`Readiness spend reached $${capturedUsd.toFixed(2)}, exceeding $${cap.toFixed(2)} cap`);

  await writeFile(progressPath, JSON.stringify({
    status: 'PROVIDER_CALL_SUCCEEDED_ASSET_PENDING',
    providerGenerationCalls: 1,
    productionGenerationCalls: 0,
    capturedUsd,
    maxUsd: cap,
    requestId: output.requestId ?? null
  }, null, 2));

  const outputRelativePath = 'audio/book-one-production-readiness.mp3';
  try {
    await writeFile(path.join(resolved, outputRelativePath), output.audio);
  } catch (error) {
    await writeFile(progressPath, JSON.stringify({
      status: 'PAID_AUDIO_STORAGE_FAILED_DO_NOT_RERUN',
      providerGenerationCalls: 1,
      productionGenerationCalls: 0,
      capturedUsd,
      maxUsd: cap,
      requestId: output.requestId ?? null,
      message: error.message
    }, null, 2));
    throw error;
  }

  const result = freeze({
    schemaVersion: 1,
    release: YASREADY_AUDIOBOOKS_VERSION,
    artifact: 'book-one-production-readiness-result',
    status: 'READY_FOR_HUMAN_GATE',
    planFingerprint: plan.integrity.planFingerprint,
    book: plan.book,
    narrator: plan.learning,
    model: plan.model,
    provider: 'elevenlabs',
    outputRelativePath,
    providerGenerationCalls: 1,
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
    writeFile(path.join(resolved, 'production-readiness-result.json'), JSON.stringify(result, null, 2)),
    writeFile(path.join(resolved, 'production-readiness-review.html'), renderProductionReadinessReviewHtml(plan, result)),
    writeFile(path.join(resolved, 'production-readiness-feedback-template.json'), JSON.stringify(reviewFeedbackShell(plan), null, 2)),
    writeFile(progressPath, JSON.stringify({
      status: 'COMPLETE',
      providerGenerationCalls: 1,
      productionGenerationCalls: 0,
      capturedUsd,
      maxUsd: cap
    }, null, 2))
  ]);
  return result;
}

export function finalizeProductionReadiness({ plan, feedback } = {}) {
  verifyProductionReadinessPlan(plan);
  if (!feedback || feedback.artifact !== 'book-one-production-readiness-human-feedback') throw new Error('Invalid production-readiness-feedback.json');
  if (feedback.planFingerprint !== plan.integrity.planFingerprint) throw new Error('Readiness feedback does not belong to this plan');
  const decision = clean(feedback.decision).toLowerCase();
  if (!['pass', 'needs-tuning', 'fail'].includes(decision)) throw new Error('Readiness decision must be PASS, NEEDS TUNING, or FAIL');

  if (decision !== 'pass') {
    return freeze({
      schemaVersion: 1,
      release: YASREADY_AUDIOBOOKS_VERSION,
      artifact: 'book-one-production-readiness-finalization',
      status: decision === 'needs-tuning' ? 'NEEDS_TUNING' : 'FAILED',
      decision,
      book: plan.book,
      narratorProductionLockCreated: false,
      productionArmed: false,
      fullBookGenerationArmed: false,
      notes: clean(feedback.notes),
      nextAction: decision === 'needs-tuning'
        ? 'Tune the winning performance direction and run another readiness sample. Do not generate the full book.'
        : 'Return to casting/performance direction. Do not lock this narrator or generate the full book.'
    });
  }

  const lockCore = {
    schemaVersion: 1,
    release: YASREADY_AUDIOBOOKS_VERSION,
    artifact: 'book-one-narrator-production-lock',
    status: 'LOCKED_FOR_PRODUCTION_PLANNING',
    book: plan.book,
    narrator: freeze({
      provider: 'elevenlabs',
      providerVoiceId: plan.learning.providerVoiceId,
      candidateName: plan.learning.candidateName
    }),
    performanceProfile: freeze({
      source: 'explicit-human-readiness-pass',
      directionId: plan.learning.preferredDirectionId,
      directionLabel: plan.learning.preferredDirectionLabel,
      overallTarget: plan.script.policy.overallTarget,
      restraint: plan.script.policy.restraint,
      narrator: plan.script.policy.narrator,
      juan: plan.script.policy.juan,
      michael: plan.script.policy.michael,
      christopher: plan.script.policy.christopher,
      humanLearningNote: plan.learning.humanNote,
      readinessOperatorNote: clean(feedback.notes)
    }),
    readinessEvidence: freeze({
      planFingerprint: plan.integrity.planFingerprint,
      chapterTitle: plan.sample.chapterTitle,
      sceneOrder: plan.sample.sceneOrder,
      wordCount: plan.sample.wordCount,
      estimatedSecondsAt155Wpm: plan.sample.estimatedSecondsAt155Wpm,
      explicitHumanDecision: 'pass'
    }),
    productionArmed: false,
    fullBookGenerationArmed: false
  };
  const lockDigest = sha256(stableJson(lockCore));
  const lock = freeze({ ...lockCore, lockDigest });
  return freeze({
    schemaVersion: 1,
    release: YASREADY_AUDIOBOOKS_VERSION,
    artifact: 'book-one-production-readiness-finalization',
    status: 'PASSED',
    decision: 'pass',
    book: plan.book,
    narratorProductionLockCreated: true,
    productionArmed: false,
    fullBookGenerationArmed: false,
    narratorProductionLock: lock,
    nextAction: 'Narrator + performance profile are locked for production planning. Build the production plan and budget next; full-book generation still requires a separate explicit arm.'
  });
}

export function renderProductionReadinessFinalizationMarkdown(result) {
  const lines = [
    '# Book One Production Readiness Finalization', '',
    `**Status:** ${result.status}`,
    `**Decision:** ${String(result.decision).toUpperCase()}`,
    `**Narrator production lock created:** ${result.narratorProductionLockCreated ? 'YES' : 'NO'}`,
    `**Full-book generation armed:** ${result.fullBookGenerationArmed ? 'YES' : 'NO'}`, ''
  ];
  if (result.narratorProductionLock) {
    lines.push(
      '## Locked target', '',
      `- Narrator: **${result.narratorProductionLock.narrator.candidateName}**`,
      `- Voice ID: \`${result.narratorProductionLock.narrator.providerVoiceId}\``,
      `- Direction: **${result.narratorProductionLock.performanceProfile.directionLabel}**`,
      `- Restraint: ${result.narratorProductionLock.performanceProfile.restraint}`,
      `- Lock digest: \`${result.narratorProductionLock.lockDigest}\``, ''
    );
  }
  lines.push('## Next action', '', result.nextAction, '');
  return lines.join('\n');
}
