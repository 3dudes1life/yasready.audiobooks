import { withYasReadyPlatformUI } from '../ui/yasready-platform.js';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { sha256, stableJson } from '../core/hash.js';
import { normalizeMoneyPolicy, moneyGuardDecision } from '../money/money-guard.js';
import { YASREADY_AUDIOBOOKS_VERSION } from '../release.js';

const freeze = (value) => Object.freeze(value);
const round = (value) => Number(Number(value ?? 0).toFixed(6));
const ceilMoneyToCent = (value) => {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount) || amount < 0) throw new Error('money amount must be a non-negative finite number');
  return Number((Math.ceil((amount - Number.EPSILON) * 100) / 100).toFixed(2));
};
const AUDITION_HARD_CEILING_USD = 5;

function clean(value) {
  return String(value ?? '').trim();
}

function slug(value) {
  return clean(value)
    .normalize('NFKD').replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-').replace(/-+/g, '-')
    .replace(/^-|-$/g, '').toLowerCase() || 'voice';
}

function safeJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function decisionRows(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.decisions)) return payload.decisions;
  if (Array.isArray(payload.choices)) return payload.choices;
  if (Array.isArray(payload.selections)) return payload.selections;
  if (Array.isArray(payload.rows)) return payload.rows;
  if (payload.decisions && typeof payload.decisions === 'object') {
    return Object.entries(payload.decisions).map(([key, value]) => ({
      candidateId: key,
      ...(typeof value === 'string' ? { decision: value } : value)
    }));
  }
  return [];
}

function normalizedDecision(value) {
  const v = clean(value).toLowerCase();
  if (['keep', 'maybe', 'pass'].includes(v)) return v;
  return null;
}

function candidateIdentity(candidate) {
  return {
    candidateId: candidate.id ?? null,
    provider: candidate.voice?.provider ?? 'elevenlabs',
    providerVoiceId: candidate.voice?.providerVoiceId ?? null,
    publicOwnerId: candidate.voice?.publicOwnerId ?? null,
    name: candidate.voice?.name ?? 'Unnamed voice',
    description: candidate.voice?.description ?? null,
    age: candidate.voice?.age ?? null,
    accent: candidate.voice?.accent ?? null,
    locale: candidate.voice?.locale ?? null,
    useCase: candidate.voice?.useCase ?? null,
    previewUrl: candidate.voice?.previewUrl ?? null,
    combinedScore: candidate.combinedScore ?? null,
    recommendation: candidate.recommendation ?? null,
    culturalRequirementMet: candidate.culturalFit?.requirementMet ?? null,
    tasteFitScore: candidate.tasteFit?.score ?? null,
    tasteProfileVersion: candidate.tasteFit?.profileVersion ?? null
  };
}

function selectionReason(candidate, rows, explicitSet) {
  if (explicitSet.has(candidate.voice?.providerVoiceId) || explicitSet.has(candidate.id)) return 'explicit-operator-selection';
  const match = rows.find((row) =>
    [row.candidateId, row.id, row.providerVoiceId, row.voiceId, row.name]
      .filter(Boolean)
      .some((value) => [candidate.id, candidate.voice?.providerVoiceId, candidate.voice?.name].includes(value))
  );
  const decision = normalizedDecision(match?.decision ?? match?.choice ?? match?.status);
  return decision ? `human-review-${decision}` : null;
}

function assertDiscovery(discovery) {
  if (!discovery || discovery.schemaVersion !== 1) throw new Error('Real auditions require a valid casting-candidate-discovery.json');
  if (discovery.castingMode !== 'single-narrator') throw new Error('Real auditions currently require single-narrator casting mode');
  if (discovery.status !== 'READY_FOR_OPERATOR_REVIEW') throw new Error(`Casting discovery is not ready for operator review (${discovery.status ?? 'unknown'})`);
  if (discovery.auditionSamples?.status !== 'READY') throw new Error('Canonical single-narrator audition samples are not READY');
  const shortlist = discovery.shortlists?.find((row) => row.character === 'Narrator');
  if (!shortlist?.candidates?.length) throw new Error('Narrator shortlist is empty');
  if (!discovery.auditionSamples.samples?.[0]?.scripts?.length) throw new Error('Narrator audition scripts are missing');
  return shortlist;
}

function planFingerprintCore(plan) {
  return {
    schemaVersion: plan.schemaVersion,
    release: plan.release,
    artifact: plan.artifact,
    sourceDiscoveryFingerprint: plan.sourceDiscoveryFingerprint,
    book: plan.book,
    model: plan.model,
    outputFormat: plan.outputFormat,
    selectedCandidates: plan.selectedCandidates,
    scripts: plan.scripts,
    renderItems: plan.renderItems,
    cost: plan.cost,
    guardrails: plan.guardrails
  };
}

export function verifyRealAuditionPlan(plan) {
  if (!plan || plan.artifact !== 'book-one-real-script-audition-plan') throw new Error('Invalid real audition plan artifact');
  const expected = sha256(stableJson(planFingerprintCore(plan)));
  if (expected !== plan.integrity?.planFingerprint) throw new Error('Audition plan integrity check failed; rebuild the plan before spending');
  if (!plan.confirmation?.token) throw new Error('Audition plan is missing its explicit confirmation token');
  return true;
}

export async function buildRealAuditionPlan({
  discovery,
  selectedVoiceIds = [],
  decisions = null,
  estimator,
  model = 'eleven_multilingual_v2',
  outputFormat = 'mp3_44100_128'
} = {}) {
  if (typeof estimator !== 'function') throw new Error('Real audition planning requires a cost estimator');
  const shortlist = assertDiscovery(discovery);
  const explicitSet = new Set((selectedVoiceIds ?? []).map(clean).filter(Boolean));
  const rows = decisionRows(decisions);
  const decisionSelected = rows.filter((row) => ['keep', 'maybe'].includes(normalizedDecision(row.decision ?? row.choice ?? row.status)));

  const selected = shortlist.candidates.filter((candidate) => {
    if (explicitSet.has(candidate.voice?.providerVoiceId) || explicitSet.has(candidate.id)) return true;
    return decisionSelected.some((row) =>
      [row.candidateId, row.id, row.providerVoiceId, row.voiceId, row.name]
        .filter(Boolean)
        .some((value) => [candidate.id, candidate.voice?.providerVoiceId, candidate.voice?.name].includes(value))
    );
  });

  if (!selected.length) {
    throw new Error('No audition voices selected. Provide --voice-id for each chosen candidate or --decisions with Keep/Maybe choices.');
  }
  if (selected.length > 6) throw new Error('Real audition planning is limited to 6 voices per run');

  const scripts = discovery.auditionSamples.samples[0].scripts.map((script, index) => freeze({
    index: index + 1,
    id: script.id,
    label: script.label,
    purpose: script.purpose,
    text: script.text,
    characters: [...String(script.text ?? '')].length,
    chapterOrder: script.chapterOrder ?? null,
    chapterTitle: script.chapterTitle ?? null,
    source: script.source ?? 'canonical-manuscript'
  }));

  const selectedCandidates = selected.map((candidate) => freeze({
    ...candidateIdentity(candidate),
    selectedBecause: selectionReason(candidate, rows, explicitSet),
    operatorOverrideOfCulturalGate: candidate.culturalFit?.requirementMet === false
  }));

  const renderItems = [];
  let estimateTotal = 0;
  for (const candidate of selectedCandidates) {
    const candidateSlug = `${slug(candidate.name)}-${clean(candidate.providerVoiceId).slice(0, 8)}`;
    for (const script of scripts) {
      const estimate = await estimator({ text: script.text, model });
      if (estimate?.amountUsd === null || !Number.isFinite(Number(estimate?.amountUsd))) {
        throw new Error(`Provider could not estimate audition cost for ${candidate.name} / ${script.label}`);
      }
      const amountUsd = round(estimate.amountUsd);
      estimateTotal += amountUsd;
      renderItems.push(freeze({
        candidateId: candidate.candidateId,
        providerVoiceId: candidate.providerVoiceId,
        candidateName: candidate.name,
        candidateSlug,
        scriptId: script.id,
        scriptLabel: script.label,
        scriptPurpose: script.purpose,
        text: script.text,
        characters: estimate.characters ?? script.characters,
        estimatedCostUsd: amountUsd,
        outputRelativePath: path.posix.join('audio', candidateSlug, `${String(script.index).padStart(2, '0')}-${slug(script.label)}.mp3`)
      }));
    }
  }

  estimateTotal = round(estimateTotal);
  const reserveUsd = round(Math.max(0.02, estimateTotal * 0.25));
  // The operator must be able to type the exact currency value YasReady displays.
  // Never round a protected spend maximum downward: ceiling the raw protected
  // amount to the next cent before fingerprinting, displaying, or validating it.
  const suggestedMaxUsd = ceilMoneyToCent(estimateTotal + reserveUsd);
  if (suggestedMaxUsd > AUDITION_HARD_CEILING_USD) {
    throw new Error(`Audition plan exceeds the $${AUDITION_HARD_CEILING_USD.toFixed(2)} hard audition ceiling`);
  }

  const base = {
    schemaVersion: 1,
    release: YASREADY_AUDIOBOOKS_VERSION,
    artifact: 'book-one-real-script-audition-plan',
    status: 'READY_FOR_EXPLICIT_APPROVAL',
    sensitiveLocalArtifact: true,
    doNotCommit: true,
    sourceDiscoveryFingerprint: discovery.artifactFingerprint,
    sourceDiscoveryRelease: discovery.release,
    book: discovery.book,
    castingMode: 'single-narrator',
    model,
    outputFormat,
    selectedCandidates: freeze(selectedCandidates),
    scripts: freeze(scripts),
    renderItems: freeze(renderItems),
    cost: freeze({
      estimateUsd: estimateTotal,
      reserveUsd,
      suggestedMaxUsd,
      roundingPolicy: 'protected-max-ceil-to-cent',
      hardCeilingUsd: AUDITION_HARD_CEILING_USD,
      estimatedCharacters: renderItems.reduce((sum, row) => sum + Number(row.characters ?? 0), 0),
      estimatedGenerationCalls: renderItems.length
    }),
    guardrails: freeze({
      planOnlyProviderGenerationCalls: 0,
      explicitApprovalRequired: true,
      exactPlanFingerprintRequired: true,
      maxUsdRequiredAtRender: true,
      maxUsdCannotExceedHardCeiling: true,
      moneyGuardOperation: 'audition_render',
      productionGenerationArmed: false,
      castLockArmed: false,
      culturalIdentityInferenceFromAudio: false,
      humanFeedbackAcousticSimilarityInference: false
    })
  };

  const fingerprint = sha256(stableJson(planFingerprintCore(base)));
  const token = `AUDITION-${fingerprint.slice(0, 10).toUpperCase()}`;
  return freeze({
    ...base,
    integrity: freeze({ planFingerprint: fingerprint }),
    confirmation: freeze({
      token,
      requiredCliFlag: '--approve-spend',
      instruction: `Rendering is blocked unless the operator explicitly supplies ${token} and a --max-usd value of at least $${suggestedMaxUsd.toFixed(2)}.`
    })
  });
}

export function renderRealAuditionPlanMarkdown(plan) {
  verifyRealAuditionPlan(plan);
  const lines = [
    '# Book One Real Script Audition Plan', '',
    `**Status:** ${plan.status}`,
    `**Book:** ${plan.book.title}`,
    `**Voices selected:** ${plan.selectedCandidates.length}`,
    `**Scripts per voice:** ${plan.scripts.length}`,
    `**Estimated generation calls:** ${plan.cost.estimatedGenerationCalls}`, '',
    '## Spend approval', '',
    `- Estimated cost: **$${plan.cost.estimateUsd.toFixed(2)}**`,
    `- Reserve: $${plan.cost.reserveUsd.toFixed(2)}`,
    `- Suggested maximum: **$${plan.cost.suggestedMaxUsd.toFixed(2)}**`,
    `- Absolute audition ceiling: $${plan.cost.hardCeilingUsd.toFixed(2)}`,
    `- Confirmation token: \`${plan.confirmation.token}\``, '',
    '> Planning performed zero TTS calls. Rendering remains blocked until the exact confirmation token and max-spend cap are supplied.', '',
    '## Selected voices', ''
  ];
  for (const candidate of plan.selectedCandidates) {
    lines.push(
      `### ${candidate.name}`, '',
      `- Provider voice ID: ${candidate.providerVoiceId}`,
      `- Selected because: ${candidate.selectedBecause}`,
      `- Cultural metadata requirement met: ${candidate.culturalRequirementMet === true ? 'YES' : candidate.culturalRequirementMet === false ? 'NO — explicit human audition selection overrides auto-audition gating only' : 'unknown'}`,
      `- Human taste score: ${candidate.tasteFitScore ?? 'not available'}`, ''
    );
  }
  lines.push('## Canonical audition excerpts', '');
  for (const script of plan.scripts) lines.push(`- **${script.label}:** ${script.text}`);
  lines.push('', '## Safety', '', '- This is an audition only.', '- No production generation is armed.', '- No cast lock is created.', '- The resulting feedback remains human judgment; YasReady does not infer ethnicity or identity from the rendered audio.', '');
  return lines.join('\n');
}

async function ensureSavedVoice(provider, candidate) {
  if (!candidate.publicOwnerId) return { voiceId: candidate.providerVoiceId, imported: false, fallback: 'no-public-owner-id' };
  try {
    const imported = await provider.importSharedVoice({
      publicOwnerId: candidate.publicOwnerId,
      voiceId: candidate.providerVoiceId,
      name: `YasReady Audition - ${candidate.name}`,
      bookmarked: true
    });
    return {
      voiceId: imported?.voice_id ?? imported?.voiceId ?? candidate.providerVoiceId,
      imported: true,
      fallback: null
    };
  } catch (error) {
    const status = Number(error?.status ?? 0);
    if (![400, 409, 422].includes(status)) throw error;
    const saved = await provider.listSavedVoices({ search: candidate.name, pageSize: 100 });
    const match = (saved.voices ?? []).find((voice) =>
      voice.providerVoiceId === candidate.providerVoiceId ||
      clean(voice.name).toLowerCase().includes(clean(candidate.name).toLowerCase())
    );
    if (!match) throw error;
    return { voiceId: match.providerVoiceId, imported: false, fallback: 'already-saved' };
  }
}

function feedbackShell(plan) {
  return {
    schemaVersion: 1,
    release: YASREADY_AUDIOBOOKS_VERSION,
    artifact: 'book-one-real-audition-human-feedback',
    planFingerprint: plan.integrity.planFingerprint,
    book: plan.book,
    castingMode: 'single-narrator',
    feedback: plan.selectedCandidates.map((candidate) => ({
      candidateId: candidate.candidateId,
      providerVoiceId: candidate.providerVoiceId,
      name: candidate.name,
      decision: null,
      ratings: { narration: null, juan: null, michael: null, christopher: null, overall: null },
      notes: ''
    })),
    learningPolicy: {
      humanJudgmentOnly: true,
      acousticSimilarityInferred: false,
      identityInferredFromAudio: false,
      allowedFutureUse: 'Use explicit decisions/ratings to remember tested voice IDs and operator preferences. Do not treat ratings as biometric or ethnicity inference.'
    }
  };
}

export function renderRealAuditionReviewHtml(plan, result) {
  const data = safeJson({
    release: YASREADY_AUDIOBOOKS_VERSION,
    planFingerprint: plan.integrity.planFingerprint,
    book: plan.book,
    candidates: plan.selectedCandidates,
    scripts: plan.scripts,
    rendered: result.rendered,
    cost: result.cost,
    feedbackTemplate: feedbackShell(plan)
  });
  return withYasReadyPlatformUI(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>YasReady Real Audition Review — ${String(plan.book.title).replace(/[<>&"]/g, '')}</title>
<style>
:root{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","Segoe UI",sans-serif;color-scheme:light dark;--bg:#f5f5f7;--card:rgba(255,255,255,.9);--text:#1d1d1f;--muted:#6e6e73;--line:rgba(0,0,0,.1);--accent:#0071e3;--good:#248a3d;--maybe:#b25000;--bad:#d70015}
@media(prefers-color-scheme:dark){:root{--bg:#000;--card:rgba(28,28,30,.94);--text:#f5f5f7;--muted:#a1a1a6;--line:rgba(255,255,255,.13);--accent:#2997ff;--good:#30d158;--maybe:#ff9f0a;--bad:#ff453a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text)}main{max-width:1120px;margin:auto;padding:38px 22px 90px}h1{font-size:clamp(36px,6vw,64px);line-height:.95;letter-spacing:-.05em;margin:8px 0 14px}.eyebrow{color:var(--accent);font-size:13px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}.sub{font-size:18px;color:var(--muted);max-width:820px;line-height:1.5}.cost{display:flex;gap:9px;flex-wrap:wrap;margin:20px 0}.pill{border:1px solid var(--line);border-radius:999px;padding:8px 11px;font-size:13px;background:var(--card)}.toolbar{position:sticky;top:0;z-index:9;padding:12px 0;background:color-mix(in srgb,var(--bg) 88%,transparent);backdrop-filter:blur(20px);border-bottom:1px solid var(--line);display:flex;gap:10px;align-items:center}.toolbar button{border:0;border-radius:999px;padding:11px 15px;font:inherit;font-weight:750;cursor:pointer}.primary{background:var(--accent);color:#fff}.ghost{background:var(--card);color:var(--text);border:1px solid var(--line)!important}.voice{margin-top:28px;padding:20px;background:var(--card);border:1px solid var(--line);border-radius:26px}.voice h2{font-size:28px;letter-spacing:-.035em;margin:0 0 4px}.meta{color:var(--muted);font-size:13px;margin-bottom:18px}.clips{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:11px}.clip{background:var(--bg);border:1px solid var(--line);border-radius:18px;padding:13px}.clip b{display:block;font-size:13px;margin-bottom:8px}.clip audio{width:100%}.decision{display:flex;gap:8px;margin-top:18px}.decision button{flex:1;border:1px solid var(--line);border-radius:999px;padding:11px;background:var(--bg);color:var(--text);font:inherit;font-weight:800;cursor:pointer}.decision button.active.keep{background:var(--good);color:#fff}.decision button.active.maybe{background:var(--maybe);color:#fff}.decision button.active.pass{background:var(--bad);color:#fff}.ratings{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-top:14px}.rating{background:var(--bg);border:1px solid var(--line);border-radius:15px;padding:10px}.rating label{display:block;font-size:11px;color:var(--muted);font-weight:700;margin-bottom:5px}.rating select{width:100%;font:inherit;background:transparent;color:var(--text);border:0}textarea{width:100%;margin-top:12px;border:1px solid var(--line);background:var(--bg);color:var(--text);border-radius:14px;min-height:70px;padding:10px;font:inherit}.note{color:var(--muted);font-size:12px;line-height:1.5;margin-top:28px}@media(max-width:760px){.clips{grid-template-columns:1fr}.ratings{grid-template-columns:repeat(2,1fr)}}
</style></head><body><main>
<div class="eyebrow">YasReady Audiobooks ${YASREADY_AUDIOBOOKS_VERSION}</div><h1>Real Script Auditions</h1>
<div class="sub">Listen to the same Book One narration and character excerpts in every voice. Rate what your ears actually hear — not what the catalog metadata promised.</div>
<div class="cost"><span class="pill">Actual/estimated billed cost: $${Number(result.cost.capturedUsd ?? 0).toFixed(2)}</span><span class="pill">${result.rendered.length} clips rendered</span><span class="pill">Production: NOT ARMED</span></div>
<div class="toolbar"><button id="export" class="primary">Export Human Feedback</button><button id="clear" class="ghost">Clear Local Feedback</button></div>
<div id="voices"></div>
<div class="note">Feedback is stored only in this browser until exported. YasReady records your explicit decisions and ratings; it does not infer ethnicity, identity, or biometric similarity from the audio.</div>
</main><script>
const DATA=${data}; const key='yasready-real-audition:'+DATA.planFingerprint;
let feedback=structuredClone(DATA.feedbackTemplate); try{const saved=localStorage.getItem(key);if(saved)feedback=JSON.parse(saved)}catch{}
const root=document.getElementById('voices');
function entry(id){return feedback.feedback.find(x=>x.providerVoiceId===id)}
function save(){localStorage.setItem(key,JSON.stringify(feedback))}
for(const c of DATA.candidates){
 const box=document.createElement('section');box.className='voice';
 box.innerHTML='<h2></h2><div class="meta"></div><div class="clips"></div><div class="decision"></div><div class="ratings"></div><textarea placeholder="What worked? What felt wrong? Could he carry the whole book?"></textarea>';
 box.querySelector('h2').textContent=c.name;
 box.querySelector('.meta').textContent=[c.age,c.accent,c.useCase,c.selectedBecause].filter(Boolean).join(' • ');
 const clips=box.querySelector('.clips');
 for(const r of DATA.rendered.filter(x=>x.providerVoiceId===c.providerVoiceId)){
  const clip=document.createElement('div');clip.className='clip';
  const b=document.createElement('b');b.textContent=r.scriptLabel;clip.append(b);
  const audio=document.createElement('audio');audio.controls=true;audio.preload='metadata';audio.src=r.outputRelativePath;clip.append(audio);clips.append(clip);
 }
 const row=entry(c.providerVoiceId), decisions=box.querySelector('.decision');
 for(const d of ['keep','maybe','pass']){const btn=document.createElement('button');btn.textContent=d[0].toUpperCase()+d.slice(1);btn.className=row.decision===d?'active '+d:'';btn.onclick=()=>{row.decision=d;[...decisions.children].forEach(x=>x.className='');btn.className='active '+d;save()};decisions.append(btn)}
 const ratings=box.querySelector('.ratings');
 for(const field of ['narration','juan','michael','christopher','overall']){
  const wrap=document.createElement('div');wrap.className='rating';const lab=document.createElement('label');lab.textContent=field[0].toUpperCase()+field.slice(1);
  const sel=document.createElement('select');sel.innerHTML='<option value="">—</option>'+[1,2,3,4,5].map(n=>'<option value="'+n+'">'+n+'/5</option>').join('');sel.value=row.ratings[field]??'';sel.onchange=()=>{row.ratings[field]=sel.value?Number(sel.value):null;save()};wrap.append(lab,sel);ratings.append(wrap)
 }
 const ta=box.querySelector('textarea');ta.value=row.notes||'';ta.oninput=()=>{row.notes=ta.value;save()};root.append(box)
}
document.getElementById('clear').onclick=()=>{if(confirm('Clear every local audition decision and rating?')){localStorage.removeItem(key);location.reload()}};
document.getElementById('export').onclick=()=>{feedback.exportedAt=new Date().toISOString();const blob=new Blob([JSON.stringify(feedback,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='real-audition-feedback.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)};
</script></body></html>`);
}

function resultMarkdown(plan, result) {
  const lines = [
    '# Book One Real Script Audition Results', '',
    `**Status:** ${result.status}`,
    `**Voices:** ${plan.selectedCandidates.length}`,
    `**Rendered clips:** ${result.rendered.length}`,
    `**Provider generation calls:** ${result.providerGenerationCalls}`,
    `**Estimated plan cost:** $${plan.cost.estimateUsd.toFixed(2)}`,
    `**Captured/estimated billed cost:** $${Number(result.cost.capturedUsd ?? 0).toFixed(2)}`,
    `**Approved maximum:** $${result.cost.maxUsd.toFixed(2)}`, '',
    '## Next action', '',
    'Open `real-audition-review.html`. Listen to every candidate on the same Book One material, rate Narration/Juan/Michael/Christopher/Overall, choose Keep/Maybe/Pass, then export `real-audition-feedback.json`.', '',
    '> Production remains unarmed. No narrator has been cast or locked.', ''
  ];
  return lines.join('\n');
}

export async function renderRealAuditions({
  plan,
  provider,
  outDir,
  approvalToken,
  maxUsd
} = {}) {
  verifyRealAuditionPlan(plan);
  if (!provider?.render || !provider?.estimateCost) throw new Error('Real audition rendering requires an audio provider with render() and estimateCost()');
  if (clean(approvalToken) !== plan.confirmation.token) {
    throw new Error(`Explicit spend approval token mismatch. Expected ${plan.confirmation.token}`);
  }

  const cap = Number(maxUsd);
  if (!Number.isFinite(cap) || cap <= 0) throw new Error('--max-usd must be a positive number');
  if (cap < plan.cost.suggestedMaxUsd) throw new Error(`--max-usd must be at least the plan's suggested protected maximum of $${plan.cost.suggestedMaxUsd.toFixed(2)}`);
  if (cap > AUDITION_HARD_CEILING_USD) throw new Error(`--max-usd cannot exceed the audition hard ceiling of $${AUDITION_HARD_CEILING_USD.toFixed(2)}`);

  const policy = normalizeMoneyPolicy({
    hardCapUsd: cap,
    warningThresholdRatio: 1,
    singleActionApprovalUsd: 0,
    estimateVarianceRatio: 0,
    operationCapsUsd: { audition: cap },
    providerCapsUsd: { elevenlabs: cap },
    requireApprovalAtWarning: false
  });
  const guard = moneyGuardDecision({
    policy,
    capturedUsd: 0,
    reservedUsd: 0,
    providerCapturedUsd: 0,
    providerReservedUsd: 0,
    operationCapturedUsd: 0,
    operationReservedUsd: 0,
    estimatedCostUsd: plan.cost.suggestedMaxUsd,
    provider: 'elevenlabs',
    operation: 'audition_render',
    approvedBy: 'explicit-cli-confirmation'
  });
  if (guard.blocked) throw new Error(`Money Guard blocked audition render: ${guard.reasons.join(', ')}`);

  const resolved = path.resolve(outDir);
  await mkdir(resolved, { recursive: true });
  await mkdir(path.join(resolved, 'audio'), { recursive: true });

  if (typeof provider.subscriptionPreflight === 'function') {
    const entitlement = await provider.subscriptionPreflight();
    const tier = String(entitlement?.tier ?? entitlement?.subscription?.tier ?? '').trim().toLowerCase();
    if (entitlement?.available && tier === 'free') {
      throw new Error('ElevenLabs Voice Library API auditions require a paid subscription. Account tier is Free. No audio was generated and no spend occurred.');
    }
  } else if (typeof provider.getSubscription === 'function') {
    const subscription = await provider.getSubscription();
    const tier = String(subscription?.tier ?? subscription?.plan ?? subscription?.subscription?.tier ?? '').trim().toLowerCase();
    if (tier === 'free') {
      throw new Error('ElevenLabs Voice Library API auditions require a paid subscription. Account tier is Free. No audio was generated and no spend occurred.');
    }
  }

  const health = typeof provider.healthCheck === 'function' ? await provider.healthCheck() : { ok: true };
  if (health?.ok === false) throw new Error(`ElevenLabs health check failed: ${health.reason ?? health.status ?? 'unknown'}`);

  const savedVoiceIds = new Map();
  let importsPerformed = 0;
  for (const candidate of plan.selectedCandidates) {
    const saved = await ensureSavedVoice(provider, candidate);
    savedVoiceIds.set(candidate.providerVoiceId, saved.voiceId);
    if (saved.imported) importsPerformed += 1;
  }

  const rendered = [];
  let capturedUsd = 0;
  let providerGenerationCalls = 0;
  const progressPath = path.join(resolved, 'audition-render-progress.json');

  for (const [index, item] of plan.renderItems.entries()) {
    const nextProjected = round(capturedUsd + item.estimatedCostUsd);
    if (nextProjected > cap) {
      throw new Error(`Money Guard stopped before ${item.candidateName} / ${item.scriptLabel}: projected $${nextProjected.toFixed(2)} exceeds $${cap.toFixed(2)} cap`);
    }
    const voiceId = savedVoiceIds.get(item.providerVoiceId) ?? item.providerVoiceId;
    let output;
    try {
      output = await provider.render({
        voiceId,
        text: item.text,
        model: plan.model,
        outputFormat: plan.outputFormat,
        languageCode: 'en',
        seed: 424242,
        applyTextNormalization: 'auto'
      });
      providerGenerationCalls += 1;
    } catch (error) {
      const partial = {
        schemaVersion: 1,
        release: YASREADY_AUDIOBOOKS_VERSION,
        artifact: 'book-one-real-script-audition-results',
        status: 'PARTIAL_FAILED',
        planFingerprint: plan.integrity.planFingerprint,
        rendered,
        providerGenerationCalls,
        cost: { estimateUsd: plan.cost.estimateUsd, capturedUsd, maxUsd: cap },
        failure: { itemIndex: index, candidateName: item.candidateName, scriptLabel: item.scriptLabel, message: error.message }
      };
      await writeFile(progressPath, JSON.stringify(partial, null, 2));
      throw error;
    }

    const actual = Number.isFinite(Number(output.estimatedCostUsd)) ? round(output.estimatedCostUsd) : item.estimatedCostUsd;
    capturedUsd = round(capturedUsd + actual);
    if (capturedUsd > cap) {
      const partial = { status: 'CAP_EXCEEDED_AFTER_PROVIDER_RESPONSE', capturedUsd, maxUsd: cap, rendered };
      await writeFile(progressPath, JSON.stringify(partial, null, 2));
      throw new Error(`Audition spend reached $${capturedUsd.toFixed(2)}, exceeding operator cap $${cap.toFixed(2)}. Rendering stopped.`);
    }

    const absolute = path.join(resolved, item.outputRelativePath);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, output.audio);
    rendered.push(freeze({
      candidateId: item.candidateId,
      providerVoiceId: item.providerVoiceId,
      renderedVoiceId: voiceId,
      candidateName: item.candidateName,
      scriptId: item.scriptId,
      scriptLabel: item.scriptLabel,
      scriptPurpose: item.scriptPurpose,
      outputRelativePath: item.outputRelativePath,
      characters: output.billedCharacters ?? item.characters,
      estimatedCostUsd: actual,
      requestId: output.requestId ?? null,
      traceId: output.traceId ?? null,
      mediaType: output.mediaType ?? 'audio/mpeg'
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
    artifact: 'book-one-real-script-audition-results',
    status: 'READY_FOR_HUMAN_REVIEW',
    sensitiveLocalArtifact: true,
    doNotCommit: true,
    planFingerprint: plan.integrity.planFingerprint,
    sourceDiscoveryFingerprint: plan.sourceDiscoveryFingerprint,
    book: plan.book,
    provider: 'elevenlabs',
    providerVoiceImportsPerformed: importsPerformed,
    providerGenerationCalls,
    productionGenerationCalls: 0,
    castLocksCreated: 0,
    rendered: freeze(rendered),
    cost: freeze({
      estimateUsd: plan.cost.estimateUsd,
      capturedUsd,
      maxUsd: cap,
      headroomUsd: round(cap - capturedUsd)
    }),
    humanFeedback: freeze({
      status: 'NOT_REVIEWED',
      reviewBoard: 'real-audition-review.html',
      exportFileName: 'real-audition-feedback.json',
      acousticSimilarityInferred: false,
      identityInferredFromAudio: false
    })
  });

  await writeFile(path.join(resolved, 'real-audition-results.json'), JSON.stringify(result, null, 2));
  await writeFile(path.join(resolved, 'real-audition-results.md'), resultMarkdown(plan, result));
  await writeFile(path.join(resolved, 'real-audition-feedback-template.json'), JSON.stringify(feedbackShell(plan), null, 2));
  await writeFile(path.join(resolved, 'real-audition-review.html'), renderRealAuditionReviewHtml(plan, result));
  await writeFile(progressPath, JSON.stringify({ status: 'COMPLETE', completed: rendered.length, total: rendered.length, capturedUsd, maxUsd: cap }, null, 2));
  return result;
}

export function summarizeRealAuditionFeedback(feedback, plan = null) {
  if (!feedback || feedback.artifact !== 'book-one-real-audition-human-feedback') throw new Error('Invalid real audition feedback artifact');
  if (plan) {
    verifyRealAuditionPlan(plan);
    if (feedback.planFingerprint !== plan.integrity.planFingerprint) throw new Error('Feedback does not belong to this audition plan');
  }
  const rows = (feedback.feedback ?? []).map((row) => ({
    providerVoiceId: row.providerVoiceId,
    name: row.name,
    decision: normalizedDecision(row.decision),
    ratings: row.ratings ?? {},
    notes: clean(row.notes)
  }));
  const decided = rows.filter((row) => row.decision);
  const keep = decided.filter((row) => row.decision === 'keep');
  const maybe = decided.filter((row) => row.decision === 'maybe');
  const pass = decided.filter((row) => row.decision === 'pass');
  const winners = [...keep, ...maybe]
    .map((row) => {
      const values = Object.values(row.ratings ?? {}).map(Number).filter(Number.isFinite);
      return { ...row, averageRating: values.length ? Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(2)) : null };
    })
    .sort((a, b) => (b.averageRating ?? -1) - (a.averageRating ?? -1));
  return freeze({
    schemaVersion: 1,
    release: YASREADY_AUDIOBOOKS_VERSION,
    artifact: 'book-one-real-audition-feedback-summary',
    status: decided.length === rows.length ? 'COMPLETE' : 'PARTIAL',
    planFingerprint: feedback.planFingerprint,
    counts: freeze({ keep: keep.length, maybe: maybe.length, pass: pass.length, undecided: rows.length - decided.length }),
    rankedHumanChoices: freeze(winners),
    rejectedVoiceIds: freeze(pass.map((row) => row.providerVoiceId)),
    futureTasteSignal: freeze({
      source: 'explicit-human-real-script-audition-feedback',
      acousticSimilarityInferred: false,
      identityInferredFromAudio: false,
      recommendedUse: 'Persist explicit tested voice IDs and ratings. Prefer Keep/Maybe IDs in future Book One narrator decisions and avoid Pass IDs unless operator resets feedback.'
    })
  });
}

export function renderRealAuditionFeedbackSummaryMarkdown(summary) {
  const lines = [
    '# Book One Real Audition Human Feedback', '',
    `**Status:** ${summary.status}`,
    `**Keep:** ${summary.counts.keep}`,
    `**Maybe:** ${summary.counts.maybe}`,
    `**Pass:** ${summary.counts.pass}`,
    `**Undecided:** ${summary.counts.undecided}`, '',
    '## Human-ranked choices', ''
  ];
  if (!summary.rankedHumanChoices.length) lines.push('- No Keep/Maybe voice has been selected yet.');
  for (const row of summary.rankedHumanChoices) {
    lines.push(`- **${row.name}** — ${row.decision.toUpperCase()}${row.averageRating === null ? '' : ` — ${row.averageRating}/5 average rating`}`);
  }
  lines.push('', '> These are explicit human judgments from real Book One script auditions. YasReady does not claim acoustic identity, biometric similarity, or cultural inference from the audio.', '');
  return lines.join('\n');
}

export { AUDITION_HARD_CEILING_USD };
