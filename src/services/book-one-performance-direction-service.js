import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { sha256, stableJson } from '../core/hash.js';
import { normalizeMoneyPolicy, moneyGuardDecision } from '../money/money-guard.js';
import { verifyRealAuditionPlan } from './book-one-real-audition-service.js';
import { YASREADY_AUDIOBOOKS_VERSION } from '../release.js';

const freeze = (value) => Object.freeze(value);
const round = (value) => Number(Number(value ?? 0).toFixed(6));
const ceilMoneyToCent = (value) => {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount) || amount < 0) throw new Error('money amount must be a non-negative finite number');
  return Number((Math.ceil((amount - Number.EPSILON) * 100) / 100).toFixed(2));
};

export const PERFORMANCE_DIRECTION_HARD_CEILING_USD = 2;

function clean(value) {
  return String(value ?? '').trim();
}

function slug(value) {
  return clean(value)
    .normalize('NFKD').replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-').replace(/-+/g, '-')
    .replace(/^-|-$/g, '').toLowerCase() || 'item';
}

function browserSafeJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function normalizeDecision(value) {
  const v = clean(value).toLowerCase();
  if (['keep', 'maybe', 'pass'].includes(v)) return v;
  return null;
}

function averageRatings(ratings = {}) {
  const values = Object.values(ratings ?? {}).map(Number).filter((x) => Number.isFinite(x) && x > 0);
  return values.length ? Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(2)) : null;
}

function feedbackRows(feedback) {
  if (!feedback || feedback.artifact !== 'book-one-real-audition-human-feedback') {
    throw new Error('Performance Direction requires exported real-audition-feedback.json from the 0.14.3.6+ review board');
  }
  if (!Array.isArray(feedback.feedback) || !feedback.feedback.length) throw new Error('Real audition feedback contains no voice decisions');
  return feedback.feedback;
}

function translatedSignals(note, decision) {
  const text = clean(note).toLowerCase();
  const signals = [];
  if (/\bgay(er)?\b|queer/.test(text)) {
    signals.push('increase-playful-flirty-queer-romance-energy');
  }
  if (/young(er)?|youthful/.test(text)) {
    signals.push('preserve-youthful-energy');
  }
  if (/yell|shout|loud|scream/.test(text)) {
    signals.push('reduce-volume-and-intensity');
  }
  if (/box|echo|reverb|hollow|roomy/.test(text)) {
    signals.push('audio-quality-rejection-boxy-or-echoey');
  }
  if (/flat|boring|stiff|straight-laced|straight laced/.test(text)) {
    signals.push('increase-personality-and-emotional-expression');
  }
  if (/warm|smooth|pleasant/.test(text)) {
    signals.push('preserve-warm-smooth-tone');
  }
  if (decision === 'keep') signals.push('preserve-core-voice-character');
  if (decision === 'pass') signals.push('do-not-auto-resurface-without-operator-reset');
  return [...new Set(signals)];
}

export function deriveHumanTasteLearning({ feedback, sourcePlan } = {}) {
  verifyRealAuditionPlan(sourcePlan);
  const rows = feedbackRows(feedback);
  if (feedback.planFingerprint !== sourcePlan.integrity.planFingerprint) {
    throw new Error('Human feedback does not belong to the supplied real audition plan');
  }

  const byId = new Map(sourcePlan.selectedCandidates.map((candidate) => [candidate.providerVoiceId, candidate]));
  const evidence = rows.map((row) => {
    const candidate = byId.get(row.providerVoiceId);
    if (!candidate) throw new Error(`Feedback voice ${row.providerVoiceId} is not part of the source audition plan`);
    const decision = normalizeDecision(row.decision);
    return freeze({
      candidateId: candidate.candidateId,
      providerVoiceId: candidate.providerVoiceId,
      name: candidate.name,
      decision,
      averageRating: averageRatings(row.ratings),
      ratings: row.ratings ?? {},
      operatorNote: clean(row.notes),
      derivedPerformanceSignals: freeze(translatedSignals(row.notes, decision)),
      source: 'explicit-human-real-script-audition-feedback'
    });
  });

  const keeps = evidence.filter((x) => x.decision === 'keep');
  const maybes = evidence.filter((x) => x.decision === 'maybe');
  const passes = evidence.filter((x) => x.decision === 'pass');

  const sortHuman = (a, b) => (b.averageRating ?? -1) - (a.averageRating ?? -1);
  keeps.sort(sortHuman);
  maybes.sort(sortHuman);

  const primary = keeps[0] ?? maybes[0] ?? null;
  if (!primary) throw new Error('Performance Direction needs at least one Keep or Maybe from the real audition round');

  const desiredSignals = [...new Set(
    evidence
      .filter((x) => ['keep', 'maybe'].includes(x.decision))
      .flatMap((x) => x.derivedPerformanceSignals)
      .filter((x) => !x.startsWith('do-not-'))
  )];

  return freeze({
    schemaVersion: 1,
    release: YASREADY_AUDIOBOOKS_VERSION,
    artifact: 'book-one-human-taste-learning-profile',
    status: 'HUMAN_FEEDBACK_INGESTED',
    sourcePlanFingerprint: sourcePlan.integrity.planFingerprint,
    book: sourcePlan.book,
    primaryVoice: freeze({
      providerVoiceId: primary.providerVoiceId,
      name: primary.name,
      decision: primary.decision,
      averageRating: primary.averageRating
    }),
    preferredVoiceIds: freeze(keeps.map((x) => x.providerVoiceId)),
    comparatorVoiceIds: freeze(maybes.map((x) => x.providerVoiceId)),
    rejectedVoiceIds: freeze(passes.map((x) => x.providerVoiceId)),
    desiredPerformanceSignals: freeze(desiredSignals),
    evidence: freeze(evidence),
    learningPolicy: freeze({
      source: 'explicit-human-feedback-only',
      metadataLearningAllowed: true,
      performanceDirectionLearningAllowed: true,
      acousticEmbeddingLearningPerformed: false,
      biometricIdentityLearningPerformed: false,
      ethnicityOrOrientationInferredFromAudio: false,
      operatorPhraseTranslation: 'Operator language may be translated into delivery traits (for example playful, flirty, warmer, softer, more expressive) but never into speaker identity.'
    })
  });
}

function directionVariantsForEvidence(row, primaryVoiceId) {
  if (row.decision === 'pass') return [];
  if (row.providerVoiceId === primaryVoiceId) {
    return [
      {
        id: 'natural-v3',
        label: 'Natural V3 Control',
        goal: 'Hear the preferred voice on Eleven v3 without added performance tags.',
        mode: 'control'
      },
      {
        id: 'playful-flirty',
        label: 'Playful + Flirty',
        goal: 'More cheeky, flirtatious, youthful queer-romance energy without changing or inferring speaker identity.',
        mode: 'playful'
      },
      {
        id: 'warm-romance',
        label: 'Warm Romance Narrator',
        goal: 'Warmer, more intimate emotional color with natural audiobook restraint rather than theatrical acting.',
        mode: 'romance'
      }
    ];
  }
  if (row.decision === 'maybe') {
    return [{
      id: 'corrective-restraint',
      label: 'Corrective Restraint',
      goal: row.derivedPerformanceSignals.includes('reduce-volume-and-intensity')
        ? 'Keep the core voice but reduce shouting, volume and intensity; aim for intimate conversational delivery.'
        : 'Give this Maybe voice one restrained, warmer, more conversational correction pass.',
      mode: 'restrained'
    }];
  }
  return [];
}

function tagFor(mode, scriptPurpose) {
  const purpose = clean(scriptPurpose).toLowerCase();
  if (mode === 'control') return '';
  if (mode === 'playful') {
    if (purpose.includes('juan')) return '[playfully] ';
    if (purpose.includes('christopher')) return '[mischievously] ';
    if (purpose.includes('michael')) return '[warmly] ';
    return '[warmly] ';
  }
  if (mode === 'romance') {
    if (purpose.includes('juan')) return '[mischievously] ';
    if (purpose.includes('christopher')) return '[playfully] ';
    if (purpose.includes('michael')) return '[softly] ';
    return '[warmly] ';
  }
  if (mode === 'restrained') {
    if (purpose.includes('juan') || purpose.includes('christopher')) return '[calm] ';
    return '[softly] ';
  }
  return '';
}

function planFingerprintCore(plan) {
  return {
    schemaVersion: plan.schemaVersion,
    release: plan.release,
    artifact: plan.artifact,
    sourcePlanFingerprint: plan.sourcePlanFingerprint,
    book: plan.book,
    model: plan.model,
    outputFormat: plan.outputFormat,
    learningProfile: plan.learningProfile,
    variants: plan.variants,
    renderItems: plan.renderItems,
    cost: plan.cost,
    guardrails: plan.guardrails
  };
}

export function verifyPerformanceDirectionPlan(plan) {
  if (!plan || plan.artifact !== 'book-one-performance-direction-plan') throw new Error('Invalid performance direction plan artifact');
  const expected = sha256(stableJson(planFingerprintCore(plan)));
  if (expected !== plan.integrity?.planFingerprint) throw new Error('Performance direction plan integrity check failed; rebuild the plan before spending');
  if (!plan.confirmation?.token) throw new Error('Performance direction plan is missing its explicit confirmation token');
  return true;
}

export async function buildPerformanceDirectionPlan({
  sourcePlan,
  feedback,
  estimator,
  model = 'eleven_v3',
  outputFormat = 'mp3_44100_128'
} = {}) {
  verifyRealAuditionPlan(sourcePlan);
  if (typeof estimator !== 'function') throw new Error('Performance Direction planning requires a cost estimator');
  const learningProfile = deriveHumanTasteLearning({ feedback, sourcePlan });
  const evidenceById = new Map(learningProfile.evidence.map((row) => [row.providerVoiceId, row]));
  const candidateById = new Map(sourcePlan.selectedCandidates.map((row) => [row.providerVoiceId, row]));

  const variantRows = [];
  for (const evidence of learningProfile.evidence) {
    const candidate = candidateById.get(evidence.providerVoiceId);
    for (const variant of directionVariantsForEvidence(evidence, learningProfile.primaryVoice.providerVoiceId)) {
      variantRows.push(freeze({
        ...variant,
        provider: candidate.provider,
        providerVoiceId: candidate.providerVoiceId,
        publicOwnerId: candidate.publicOwnerId ?? null,
        candidateName: candidate.name,
        sourceDecision: evidence.decision,
        sourceOperatorNote: evidence.operatorNote,
        sourceSignals: evidence.derivedPerformanceSignals
      }));
    }
  }
  if (!variantRows.length) throw new Error('No performance-direction variants were produced from the human feedback');

  const renderItems = [];
  let estimateTotal = 0;
  for (const variant of variantRows) {
    const voiceSlug = `${slug(variant.candidateName)}-${clean(variant.providerVoiceId).slice(0, 8)}`;
    const variantSlug = slug(variant.id);
    for (const script of sourcePlan.scripts) {
      const prefix = tagFor(variant.mode, script.purpose);
      const directedText = `${prefix}${script.text}`;
      if (/\[(?:gay|queer|latino|hispanic|asian|black|white)[^\]]*\]/i.test(directedText)) {
        throw new Error('Performance direction attempted to encode a protected/identity label as an audio tag');
      }
      const estimate = await estimator({ text: directedText, model });
      if (estimate?.amountUsd === null || !Number.isFinite(Number(estimate?.amountUsd))) {
        throw new Error(`Provider could not estimate ${variant.candidateName} / ${variant.label} / ${script.label}`);
      }
      const amountUsd = round(estimate.amountUsd);
      estimateTotal += amountUsd;
      renderItems.push(freeze({
        providerVoiceId: variant.providerVoiceId,
        candidateName: variant.candidateName,
        variantId: variant.id,
        variantLabel: variant.label,
        variantGoal: variant.goal,
        scriptId: script.id,
        scriptLabel: script.label,
        scriptPurpose: script.purpose,
        canonicalText: script.text,
        directedText,
        directionTag: prefix.trim() || null,
        characters: estimate.characters ?? [...directedText].length,
        estimatedCostUsd: amountUsd,
        outputRelativePath: path.posix.join(
          'audio',
          voiceSlug,
          variantSlug,
          `${String(script.index).padStart(2, '0')}-${slug(script.label)}.mp3`
        )
      }));
    }
  }

  estimateTotal = round(estimateTotal);
  const reserveUsd = round(Math.max(0.02, estimateTotal * 0.25));
  const suggestedMaxUsd = ceilMoneyToCent(estimateTotal + reserveUsd);
  if (suggestedMaxUsd > PERFORMANCE_DIRECTION_HARD_CEILING_USD) {
    throw new Error(`Performance direction round exceeds its $${PERFORMANCE_DIRECTION_HARD_CEILING_USD.toFixed(2)} hard ceiling`);
  }

  const base = {
    schemaVersion: 1,
    release: YASREADY_AUDIOBOOKS_VERSION,
    artifact: 'book-one-performance-direction-plan',
    status: 'READY_FOR_EXPLICIT_APPROVAL',
    sensitiveLocalArtifact: true,
    doNotCommit: true,
    sourcePlanFingerprint: sourcePlan.integrity.planFingerprint,
    book: sourcePlan.book,
    castingMode: 'single-narrator',
    model,
    outputFormat,
    learningProfile,
    variants: freeze(variantRows),
    renderItems: freeze(renderItems),
    cost: freeze({
      estimateUsd: estimateTotal,
      reserveUsd,
      suggestedMaxUsd,
      roundingPolicy: 'protected-max-ceil-to-cent',
      hardCeilingUsd: PERFORMANCE_DIRECTION_HARD_CEILING_USD,
      estimatedCharacters: renderItems.reduce((sum, row) => sum + Number(row.characters ?? 0), 0),
      estimatedGenerationCalls: renderItems.length
    }),
    guardrails: freeze({
      planningProviderGenerationCalls: 0,
      explicitApprovalRequired: true,
      exactPlanFingerprintRequired: true,
      maxUsdRequiredAtRender: true,
      moneyGuardOperation: 'audition_render',
      providerSubscriptionPreflightRequired: true,
      productionGenerationArmed: false,
      castLockArmed: false,
      identityInferenceFromAudio: false,
      acousticEmbeddingLearningPerformed: false,
      passVoicesExcluded: true
    })
  };
  const fingerprint = sha256(stableJson(planFingerprintCore(base)));
  const token = `DIRECTION-${fingerprint.slice(0, 10).toUpperCase()}`;
  return freeze({
    ...base,
    integrity: freeze({ planFingerprint: fingerprint }),
    confirmation: freeze({
      token,
      instruction: `Rendering is blocked unless the operator explicitly supplies ${token} and --max-usd of at least $${suggestedMaxUsd.toFixed(2)}.`
    })
  });
}

export function renderPerformanceDirectionPlanMarkdown(plan) {
  verifyPerformanceDirectionPlan(plan);
  const lines = [
    '# Book One Performance Direction Plan', '',
    `**Status:** ${plan.status}`,
    `**Book:** ${plan.book.title}`,
    `**Model:** ${plan.model}`,
    `**Primary human choice:** ${plan.learningProfile.primaryVoice.name}`,
    `**Variants:** ${plan.variants.length}`,
    `**Generation calls:** ${plan.cost.estimatedGenerationCalls}`, '',
    '## What YasReady learned', ''
  ];
  for (const row of plan.learningProfile.evidence) {
    lines.push(`- **${row.name}** — ${(row.decision ?? 'undecided').toUpperCase()}${row.averageRating ? ` — ${row.averageRating}/5` : ''}`);
    if (row.operatorNote) lines.push(`  - Human note: ${row.operatorNote}`);
    if (row.derivedPerformanceSignals.length) lines.push(`  - Performance signals: ${row.derivedPerformanceSignals.join(', ')}`);
  }
  lines.push('', '## Direction variants', '');
  for (const v of plan.variants) {
    lines.push(`- **${v.candidateName} — ${v.label}:** ${v.goal}`);
  }
  lines.push(
    '', '## Spend approval', '',
    `- Estimated cost: **$${plan.cost.estimateUsd.toFixed(2)}**`,
    `- Reserve: $${plan.cost.reserveUsd.toFixed(2)}`,
    `- Protected maximum: **$${plan.cost.suggestedMaxUsd.toFixed(2)}**`,
    `- Hard ceiling for this direction round: $${plan.cost.hardCeilingUsd.toFixed(2)}`,
    `- Confirmation token: \`${plan.confirmation.token}\``, '',
    '> Plan creation performs zero TTS calls. Production remains unarmed.', '',
    '## Identity / human-learning boundary', '',
    '- Operator language is translated into delivery direction only.',
    '- YasReady does not infer sexual orientation, ethnicity, or identity from a voice.',
    '- No acoustic embedding or biometric similarity learning is performed.',
    '- Pass voices are excluded from this direction round unless the operator starts a new round explicitly.', ''
  );
  return lines.join('\n');
}

async function ensureSavedVoice(provider, variant) {
  if (!variant.publicOwnerId || typeof provider.importSharedVoice !== 'function') {
    return { voiceId: variant.providerVoiceId, imported: false };
  }
  try {
    const imported = await provider.importSharedVoice({
      publicOwnerId: variant.publicOwnerId,
      voiceId: variant.providerVoiceId,
      name: `YasReady Direction - ${variant.candidateName}`,
      bookmarked: true
    });
    return { voiceId: imported?.voice_id ?? imported?.voiceId ?? variant.providerVoiceId, imported: true };
  } catch (error) {
    const status = Number(error?.status ?? 0);
    if (![400, 409, 422].includes(status) || typeof provider.listSavedVoices !== 'function') throw error;
    const saved = await provider.listSavedVoices({ search: variant.candidateName, pageSize: 100 });
    const match = (saved.voices ?? []).find((voice) =>
      voice.providerVoiceId === variant.providerVoiceId ||
      clean(voice.name).toLowerCase().includes(clean(variant.candidateName).toLowerCase())
    );
    if (!match) throw error;
    return { voiceId: match.providerVoiceId, imported: false };
  }
}

function performanceFeedbackShell(plan) {
  const variants = plan.variants.map((variant) => ({
    providerVoiceId: variant.providerVoiceId,
    candidateName: variant.candidateName,
    variantId: variant.id,
    variantLabel: variant.label,
    decision: null,
    ratings: { narration: null, juan: null, michael: null, christopher: null, overall: null },
    notes: ''
  }));
  return {
    schemaVersion: 1,
    release: YASREADY_AUDIOBOOKS_VERSION,
    artifact: 'book-one-performance-direction-human-feedback',
    planFingerprint: plan.integrity.planFingerprint,
    book: plan.book,
    feedback: variants,
    learningPolicy: {
      explicitHumanJudgmentOnly: true,
      acousticEmbeddingLearningPerformed: false,
      identityInferredFromAudio: false
    }
  };
}

export function renderPerformanceDirectionReviewHtml(plan, result) {
  const data = browserSafeJson({
    release: YASREADY_AUDIOBOOKS_VERSION,
    planFingerprint: plan.integrity.planFingerprint,
    book: plan.book,
    learningProfile: plan.learningProfile,
    variants: plan.variants,
    rendered: result.rendered,
    cost: result.cost,
    feedbackTemplate: performanceFeedbackShell(plan)
  });

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>YasReady Performance Direction — ${String(plan.book.title).replace(/[<>&"]/g, '')}</title>
<style>
:root{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","Segoe UI",sans-serif;color-scheme:light dark;--bg:#f5f5f7;--card:rgba(255,255,255,.9);--text:#1d1d1f;--muted:#6e6e73;--line:rgba(0,0,0,.1);--accent:#0071e3;--good:#248a3d;--maybe:#b25000;--bad:#d70015}
@media(prefers-color-scheme:dark){:root{--bg:#000;--card:rgba(28,28,30,.95);--text:#f5f5f7;--muted:#a1a1a6;--line:rgba(255,255,255,.13);--accent:#2997ff;--good:#30d158;--maybe:#ff9f0a;--bad:#ff453a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text)}main{max-width:1180px;margin:auto;padding:38px 22px 90px}.eyebrow{font-size:13px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--accent)}h1{font-size:clamp(38px,6vw,68px);line-height:.94;letter-spacing:-.055em;margin:8px 0 14px}.sub{font-size:18px;color:var(--muted);max-width:860px;line-height:1.5}.learn{margin:22px 0;padding:18px;border:1px solid var(--line);border-radius:22px;background:var(--card)}.learn b{display:block;margin-bottom:6px}.chips{display:flex;flex-wrap:wrap;gap:7px}.chip{padding:6px 9px;border-radius:999px;border:1px solid var(--line);font-size:12px;color:var(--muted)}.toolbar{position:sticky;top:0;z-index:10;background:color-mix(in srgb,var(--bg) 88%,transparent);backdrop-filter:blur(20px);padding:12px 0;border-bottom:1px solid var(--line);display:flex;gap:10px}.toolbar button{border:0;border-radius:999px;padding:11px 15px;font:inherit;font-weight:750;cursor:pointer}.primary{background:var(--accent);color:white}.ghost{background:var(--card);color:var(--text);border:1px solid var(--line)!important}.voice{margin-top:34px}.voice>h2{font-size:32px;letter-spacing:-.04em;margin:0 0 6px}.source{color:var(--muted);font-size:13px;margin-bottom:15px}.variant{margin:14px 0;padding:20px;border-radius:26px;background:var(--card);border:1px solid var(--line)}.variant h3{font-size:23px;margin:0 0 4px;letter-spacing:-.025em}.goal{font-size:13px;color:var(--muted);line-height:1.45;margin-bottom:14px}.clips{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.clip{background:var(--bg);border:1px solid var(--line);border-radius:17px;padding:12px}.clip b{display:block;font-size:12px;margin-bottom:7px}.clip audio{width:100%}.decisions{display:flex;gap:8px;margin-top:16px}.decisions button{flex:1;border:1px solid var(--line);border-radius:999px;padding:11px;font:inherit;font-weight:800;background:var(--bg);color:var(--text);cursor:pointer}.decisions button.active.best{background:var(--good);color:#fff}.decisions button.active.maybe{background:var(--maybe);color:#fff}.decisions button.active.pass{background:var(--bad);color:#fff}.ratings{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-top:12px}.rating{padding:9px;background:var(--bg);border:1px solid var(--line);border-radius:14px}.rating label{display:block;font-size:11px;color:var(--muted);font-weight:700;margin-bottom:4px}.rating select{width:100%;border:0;background:transparent;color:var(--text);font:inherit}textarea{width:100%;margin-top:11px;min-height:68px;border:1px solid var(--line);border-radius:14px;padding:10px;background:var(--bg);color:var(--text);font:inherit}.foot{font-size:12px;color:var(--muted);line-height:1.5;margin-top:34px}@media(max-width:760px){.clips{grid-template-columns:1fr}.ratings{grid-template-columns:repeat(2,1fr)}}
</style></head><body><main>
<div class="eyebrow">YasReady Audiobooks ${YASREADY_AUDIOBOOKS_VERSION}</div>
<h1>Performance Direction</h1>
<div class="sub">Same Book One material. Same voice. Different direction. This round is about shaping performance — not searching the catalog again.</div>
<div class="learn"><b>Human taste signal</b><div class="chips" id="signals"></div></div>
<div class="toolbar"><button id="export" class="primary">Export Direction Feedback</button><button id="clear" class="ghost">Clear Local Feedback</button></div>
<div id="content"></div>
<div class="foot">Your explicit notes and ratings are the learning signal. YasReady does not infer orientation, ethnicity, identity, or biometric similarity from the audio. No production generation or cast lock occurs here.</div>
<script>
const DATA=${data}; const key='yasready-performance-direction:'+DATA.planFingerprint;
let feedback=structuredClone(DATA.feedbackTemplate); try{const saved=localStorage.getItem(key);if(saved)feedback=JSON.parse(saved)}catch{}
const signals=document.getElementById('signals');
for(const s of DATA.learningProfile.desiredPerformanceSignals){const x=document.createElement('span');x.className='chip';x.textContent=s.replaceAll('-',' ');signals.append(x)}
const content=document.getElementById('content');
const voiceIds=[...new Set(DATA.variants.map(v=>v.providerVoiceId))];
function entry(vid,varid){return feedback.feedback.find(x=>x.providerVoiceId===vid&&x.variantId===varid)}
function save(){localStorage.setItem(key,JSON.stringify(feedback))}
for(const vid of voiceIds){
 const variants=DATA.variants.filter(v=>v.providerVoiceId===vid), section=document.createElement('section');section.className='voice';
 const h=document.createElement('h2');h.textContent=variants[0].candidateName;section.append(h);
 const src=document.createElement('div');src.className='source';src.textContent='Round-one decision: '+variants[0].sourceDecision.toUpperCase()+(variants[0].sourceOperatorNote?' • '+variants[0].sourceOperatorNote:'');section.append(src);
 for(const v of variants){
  const row=entry(vid,v.id), card=document.createElement('div');card.className='variant';
  const h3=document.createElement('h3');h3.textContent=v.label;card.append(h3);const goal=document.createElement('div');goal.className='goal';goal.textContent=v.goal;card.append(goal);
  const clips=document.createElement('div');clips.className='clips';
  for(const r of DATA.rendered.filter(x=>x.providerVoiceId===vid&&x.variantId===v.id)){const c=document.createElement('div');c.className='clip';const b=document.createElement('b');b.textContent=r.scriptLabel;c.append(b);const a=document.createElement('audio');a.controls=true;a.preload='metadata';a.src=r.outputRelativePath;c.append(a);clips.append(c)}
  card.append(clips);
  const decisions=document.createElement('div');decisions.className='decisions';
  for(const [value,label] of [['best','Best'],['maybe','Maybe'],['pass','Pass']]){const btn=document.createElement('button');btn.textContent=label;btn.className=row.decision===value?'active '+value:'';btn.onclick=()=>{row.decision=value;[...decisions.children].forEach(x=>x.className='');btn.className='active '+value;save()};decisions.append(btn)} card.append(decisions);
  const ratings=document.createElement('div');ratings.className='ratings';
  for(const field of ['narration','juan','michael','christopher','overall']){const w=document.createElement('div');w.className='rating';const l=document.createElement('label');l.textContent=field[0].toUpperCase()+field.slice(1);const sel=document.createElement('select');sel.innerHTML='<option value="">—</option>'+[1,2,3,4,5].map(n=>'<option value="'+n+'">'+n+'/5</option>').join('');sel.value=row.ratings[field]??'';sel.onchange=()=>{row.ratings[field]=sel.value?Number(sel.value):null;save()};w.append(l,sel);ratings.append(w)}card.append(ratings);
  const ta=document.createElement('textarea');ta.placeholder='What got better? What still feels wrong?';ta.value=row.notes||'';ta.oninput=()=>{row.notes=ta.value;save()};card.append(ta);section.append(card)
 } content.append(section)
}
document.getElementById('clear').onclick=()=>{if(confirm('Clear all local direction feedback?')){localStorage.removeItem(key);location.reload()}};
document.getElementById('export').onclick=()=>{feedback.exportedAt=new Date().toISOString();const blob=new Blob([JSON.stringify(feedback,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='performance-direction-feedback.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)};
</script></main></body></html>`;
}

export async function renderPerformanceDirectionRound({
  plan,
  provider,
  outDir,
  approvalToken,
  maxUsd
} = {}) {
  verifyPerformanceDirectionPlan(plan);
  if (!provider?.render || !provider?.estimateCost) throw new Error('Performance Direction rendering requires an audio provider');
  if (clean(approvalToken) !== plan.confirmation.token) throw new Error(`Explicit spend approval token mismatch. Expected ${plan.confirmation.token}`);

  const cap = Number(maxUsd);
  if (!Number.isFinite(cap) || cap <= 0) throw new Error('--max-usd must be a positive number');
  if (cap < plan.cost.suggestedMaxUsd) throw new Error(`--max-usd must be at least $${plan.cost.suggestedMaxUsd.toFixed(2)}`);
  if (cap > PERFORMANCE_DIRECTION_HARD_CEILING_USD) throw new Error(`--max-usd cannot exceed $${PERFORMANCE_DIRECTION_HARD_CEILING_USD.toFixed(2)} for a direction round`);

  if (typeof provider.getSubscription === 'function') {
    const subscription = await provider.getSubscription();
    const tier = clean(subscription?.tier ?? subscription?.plan ?? subscription?.subscription?.tier).toLowerCase();
    if (tier === 'free') {
      throw new Error('ElevenLabs Voice Library API auditions require a paid subscription. Account tier is Free. No audio was generated and no spend occurred.');
    }
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
    approvedBy: 'explicit-cli-confirmation'
  });
  if (guard.blocked) throw new Error(`Money Guard blocked performance direction: ${guard.reasons.join(', ')}`);

  const resolved = path.resolve(outDir);
  await mkdir(resolved, { recursive: true });
  const saved = new Map();
  let imports = 0;
  for (const variant of plan.variants) {
    if (saved.has(variant.providerVoiceId)) continue;
    const result = await ensureSavedVoice(provider, variant);
    saved.set(variant.providerVoiceId, result.voiceId);
    if (result.imported) imports += 1;
  }

  const rendered = [];
  let capturedUsd = 0;
  let providerGenerationCalls = 0;
  const progressPath = path.join(resolved, 'performance-direction-progress.json');

  for (let i = 0; i < plan.renderItems.length; i += 1) {
    const item = plan.renderItems[i];
    const projected = round(capturedUsd + item.estimatedCostUsd);
    if (projected > cap) throw new Error(`Money Guard stopped before ${item.candidateName} / ${item.variantLabel}: projected $${projected.toFixed(2)} exceeds $${cap.toFixed(2)}`);

    let output;
    try {
      output = await provider.render({
        voiceId: saved.get(item.providerVoiceId) ?? item.providerVoiceId,
        text: item.directedText,
        model: plan.model,
        outputFormat: plan.outputFormat,
        languageCode: 'en',
        seed: 424242,
        applyTextNormalization: 'auto'
      });
      providerGenerationCalls += 1;
    } catch (error) {
      await writeFile(progressPath, JSON.stringify({
        status: 'PARTIAL_FAILED',
        completed: rendered.length,
        total: plan.renderItems.length,
        capturedUsd,
        failure: { itemIndex: i, candidateName: item.candidateName, variantLabel: item.variantLabel, scriptLabel: item.scriptLabel, message: error.message }
      }, null, 2));
      throw error;
    }

    const actual = Number.isFinite(Number(output.estimatedCostUsd)) ? round(output.estimatedCostUsd) : item.estimatedCostUsd;
    capturedUsd = round(capturedUsd + actual);
    if (capturedUsd > cap) throw new Error(`Direction spend reached $${capturedUsd.toFixed(2)}, exceeding $${cap.toFixed(2)} cap`);

    const absolute = path.join(resolved, item.outputRelativePath);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, output.audio);
    rendered.push(freeze({
      providerVoiceId: item.providerVoiceId,
      candidateName: item.candidateName,
      variantId: item.variantId,
      variantLabel: item.variantLabel,
      scriptId: item.scriptId,
      scriptLabel: item.scriptLabel,
      scriptPurpose: item.scriptPurpose,
      directionTag: item.directionTag,
      outputRelativePath: item.outputRelativePath,
      billedCharacters: output.billedCharacters ?? item.characters,
      estimatedCostUsd: actual,
      requestId: output.requestId ?? null
    }));
    await writeFile(progressPath, JSON.stringify({
      status: 'RENDERING',
      completed: rendered.length,
      total: plan.renderItems.length,
      capturedUsd,
      maxUsd: cap
    }, null, 2));
  }

  const result = freeze({
    schemaVersion: 1,
    release: YASREADY_AUDIOBOOKS_VERSION,
    artifact: 'book-one-performance-direction-results',
    status: 'READY_FOR_HUMAN_REVIEW',
    planFingerprint: plan.integrity.planFingerprint,
    book: plan.book,
    model: plan.model,
    provider: 'elevenlabs',
    providerVoiceImportsPerformed: imports,
    providerGenerationCalls,
    productionGenerationCalls: 0,
    castLocksCreated: 0,
    rendered: freeze(rendered),
    cost: freeze({
      estimateUsd: plan.cost.estimateUsd,
      capturedUsd,
      maxUsd: cap,
      headroomUsd: round(cap - capturedUsd)
    })
  });

  await Promise.all([
    writeFile(path.join(resolved, 'performance-direction-results.json'), JSON.stringify(result, null, 2)),
    writeFile(path.join(resolved, 'performance-direction-review.html'), renderPerformanceDirectionReviewHtml(plan, result)),
    writeFile(path.join(resolved, 'performance-direction-feedback-template.json'), JSON.stringify(performanceFeedbackShell(plan), null, 2)),
    writeFile(path.join(resolved, 'human-taste-learning-profile.json'), JSON.stringify(plan.learningProfile, null, 2)),
    writeFile(progressPath, JSON.stringify({ status: 'COMPLETE', completed: rendered.length, total: rendered.length, capturedUsd, maxUsd: cap }, null, 2))
  ]);
  return result;
}

export function summarizePerformanceDirectionFeedback({ feedback, plan } = {}) {
  verifyPerformanceDirectionPlan(plan);
  if (!feedback || feedback.artifact !== 'book-one-performance-direction-human-feedback') throw new Error('Invalid performance-direction-feedback.json');
  if (feedback.planFingerprint !== plan.integrity.planFingerprint) throw new Error('Direction feedback does not belong to this plan');

  const rows = (feedback.feedback ?? []).map((row) => ({
    providerVoiceId: row.providerVoiceId,
    candidateName: row.candidateName,
    variantId: row.variantId,
    variantLabel: row.variantLabel,
    decision: ['best', 'maybe', 'pass'].includes(clean(row.decision).toLowerCase()) ? clean(row.decision).toLowerCase() : null,
    ratings: row.ratings ?? {},
    averageRating: averageRatings(row.ratings),
    notes: clean(row.notes)
  }));
  const rank = { best: 3, maybe: 2, pass: 1, null: 0 };
  const ranked = [...rows].sort((a, b) =>
    (rank[b.decision] - rank[a.decision]) || ((b.averageRating ?? -1) - (a.averageRating ?? -1))
  );
  const winner = ranked.find((row) => row.decision === 'best') ?? ranked.find((row) => row.decision === 'maybe') ?? null;

  return freeze({
    schemaVersion: 1,
    release: YASREADY_AUDIOBOOKS_VERSION,
    artifact: 'book-one-performance-direction-learning-summary',
    status: rows.every((x) => x.decision) ? 'COMPLETE' : 'PARTIAL',
    planFingerprint: plan.integrity.planFingerprint,
    book: plan.book,
    winner,
    rankedHumanChoices: freeze(ranked),
    nextHumanTasteProfile: freeze({
      source: 'explicit-human-performance-direction-feedback',
      preferredVoiceId: winner?.providerVoiceId ?? plan.learningProfile.primaryVoice.providerVoiceId,
      preferredDirectionId: winner?.variantId ?? null,
      preferredDirectionLabel: winner?.variantLabel ?? null,
      priorRoundSignals: plan.learningProfile.desiredPerformanceSignals,
      acousticEmbeddingLearningPerformed: false,
      biometricIdentityLearningPerformed: false,
      identityInferredFromAudio: false
    }),
    nextAction: winner
      ? 'Use the winning voice + direction as the production performance target, but require a separate production-readiness gate before full-book generation.'
      : 'Complete Best/Maybe/Pass decisions before moving toward production.'
  });
}

export function renderPerformanceDirectionLearningMarkdown(summary) {
  const lines = [
    '# Book One Performance Direction Learning', '',
    `**Status:** ${summary.status}`,
    `**Winner:** ${summary.winner ? `${summary.winner.candidateName} — ${summary.winner.variantLabel}` : 'not selected'}`, '',
    '## Ranked human choices', ''
  ];
  for (const row of summary.rankedHumanChoices) {
    lines.push(`- **${row.candidateName} — ${row.variantLabel}** — ${(row.decision ?? 'undecided').toUpperCase()}${row.averageRating ? ` — ${row.averageRating}/5` : ''}${row.notes ? ` — ${row.notes}` : ''}`);
  }
  lines.push('', '## Boundary', '', '- Human feedback is explicit and durable.', '- No acoustic embedding, biometric identity, sexual-orientation inference, or ethnicity inference was performed.', '- This summary does not arm production or lock the narrator.', '', '## Next action', '', summary.nextAction, '');
  return lines.join('\n');
}
