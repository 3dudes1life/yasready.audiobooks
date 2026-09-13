import { YASREADY_AUDIOBOOKS_VERSION } from '../release.js';
import { sha256, stableJson } from '../core/hash.js';
import { splitForTts } from '../production/model-limits.js';
import { verifyBookOneProductionPlan } from './book-one-production-plan-service.js';
import {
  BOOK_ONE_CINEMATIC_ALLOWED_PLAN_RELEASES,
  verifyBookOneCinematicNaturalismLock,
  verifyBookOneCinematicRebuildResult,
  compileCinematicNaturalismScene
} from './book-one-cinematic-naturalism-service.js';

export const BOOK_ONE_CINEMATIC_HUMAN_REVIEW_CHAPTERS = 10;
export const BOOK_ONE_CINEMATIC_NEXT_BATCH_MAX_CHAPTERS = 10;
export const BOOK_ONE_CINEMATIC_NEXT_BATCH_RETRY_RATIO = 0.20;
export const BOOK_ONE_CINEMATIC_CHAPTER_DECISIONS = Object.freeze(['PASS', 'MAYBE', 'FAIL']);
export const BOOK_ONE_CINEMATIC_OVERALL_DECISIONS = Object.freeze(['APPROVE_CINEMATIC_RECIPE', 'NEEDS_CHANGES']);

const freeze = (value) => {
  if (Array.isArray(value)) { for (const child of value) freeze(child); return Object.freeze(value); }
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); return Object.freeze(value); }
  return value;
};
const round = (value, digits = 6) => {
  const factor = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
};
const ceilCents = (value) => Math.ceil((Number(value) - Number.EPSILON) * 100) / 100;
const clean = (value) => String(value ?? '').trim();

function reviewSessionCore(session) {
  return {
    schemaVersion: session.schemaVersion,
    release: session.release,
    artifact: session.artifact,
    status: session.status,
    source: session.source,
    profile: session.profile,
    chapters: session.chapters,
    guardrails: session.guardrails
  };
}

function approvalCore(approval) {
  return {
    schemaVersion: approval.schemaVersion,
    release: approval.release,
    artifact: approval.artifact,
    status: approval.status,
    source: approval.source,
    profile: approval.profile,
    chapterReview: approval.chapterReview,
    humanDecision: approval.humanDecision,
    guardrails: approval.guardrails
  };
}

export function cinematicRecipeFingerprint(lock) {
  verifyBookOneCinematicNaturalismLock(lock);
  return sha256(stableJson({
    profileId: lock.profileId,
    narrator: lock.narrator,
    lockedProductionChain: lock.lockedProductionChain,
    humanDecision: {
      selectedComparison: lock.humanDecision?.selectedComparison,
      rejectedEscalation: lock.humanDecision?.rejectedEscalation,
      decision: lock.humanDecision?.decision
    },
    rules: {
      canonicalTextImmutable: lock.rules?.canonicalTextImmutable,
      characterDifferentiation: lock.rules?.characterDifferentiation,
      narrationBaseline: lock.rules?.narrationBaseline,
      emotionalMomentsEarnDirection: lock.rules?.emotionalMomentsEarnDirection,
      sceneCueCap: lock.rules?.sceneCueCap,
      minimumSegmentIndexGapBetweenCues: lock.rules?.minimumSegmentIndexGapBetweenCues,
      perCueCap: lock.rules?.perCueCap,
      narrationCueCap: lock.rules?.narrationCueCap,
      allowedProviderCues: lock.rules?.allowedProviderCues,
      plus2EscalationAllowed: lock.rules?.plus2EscalationAllowed,
      extraVoicesRequired: lock.rules?.extraVoicesRequired,
      soundEffectsRequired: lock.rules?.soundEffectsRequired,
      identityInferenceFromAudio: lock.rules?.identityInferenceFromAudio
    }
  }));
}

function verifyTenChapterSource(cinematicResult, cinematicLock) {
  verifyBookOneCinematicRebuildResult(cinematicResult);
  verifyBookOneCinematicNaturalismLock(cinematicLock);
  if (cinematicResult.status !== 'READY_FOR_HUMAN_TEN_CHAPTER_REVIEW') throw new Error('Ten-chapter human review requires READY_FOR_HUMAN_TEN_CHAPTER_REVIEW');
  if (Number(cinematicResult.progress?.completedChapterCount) !== BOOK_ONE_CINEMATIC_HUMAN_REVIEW_CHAPTERS ||
      Number(cinematicResult.progress?.targetChapterCount) !== BOOK_ONE_CINEMATIC_HUMAN_REVIEW_CHAPTERS ||
      Number(cinematicResult.progress?.remainingChapterCount) !== 0 ||
      cinematicResult.progress?.allTenComplete !== true) {
    throw new Error('Ten-chapter human review requires all ten cinematic chapters complete');
  }
  if ((cinematicResult.chapters ?? []).length !== BOOK_ONE_CINEMATIC_HUMAN_REVIEW_CHAPTERS) throw new Error('Ten-chapter human review requires exactly ten chapter results');
  if (cinematicResult.cinematicLockDigest !== cinematicLock.integrity?.lockDigest) throw new Error('Cinematic result does not belong to the supplied performance lock');
  if (cinematicResult.guardrails?.chapterElevenMayBeGenerated !== false ||
      cinematicResult.guardrails?.nextBatchArmed !== false ||
      cinematicResult.guardrails?.fullBookGenerationArmed !== false) {
    throw new Error('Ten-chapter review source guardrails are not closed');
  }
  for (const chapter of cinematicResult.chapters) {
    if (chapter?.status !== 'COMPLETE') throw new Error(`Cinematic chapter is not complete: ${chapter?.title ?? 'unknown'}`);
    if (chapter?.qa?.archive?.passed !== true || chapter?.qa?.mp3?.passed !== true) throw new Error(`Cinematic chapter technical QA is not green: ${chapter?.title ?? 'unknown'}`);
  }
  return true;
}

export function buildBookOneCinematicHumanReviewSession({ cinematicResult, cinematicLock } = {}) {
  verifyTenChapterSource(cinematicResult, cinematicLock);
  const recipeFingerprint = cinematicRecipeFingerprint(cinematicLock);
  const chapters = cinematicResult.chapters.map((chapter) => freeze({
    chapterNumber: Number(chapter.chapterNumber),
    sourceChapterOrder: Number(chapter.sourceChapterOrder),
    title: chapter.title,
    subtlePerformanceDirections: Number(chapter.cueCount ?? 0),
    audioRelativePath: chapter.outputs?.directMp3 ?? chapter.outputs?.acxMp3 ?? null,
    technicalQa: freeze({
      archivePassed: chapter.qa?.archive?.passed === true,
      mp3Passed: chapter.qa?.mp3?.passed === true
    }),
    decision: 'UNREVIEWED',
    notes: ''
  }));
  const base = {
    schemaVersion: 1,
    release: YASREADY_AUDIOBOOKS_VERSION,
    artifact: 'book-one-cinematic-human-review-session',
    status: 'AWAITING_TEN_CHAPTER_HUMAN_REVIEW',
    source: freeze({
      cinematicResultDigest: cinematicResult.integrity.resultDigest,
      cinematicLockDigest: cinematicLock.integrity.lockDigest,
      productionPlanDigest: cinematicResult.source?.productionPlanDigest ?? cinematicLock.source?.productionPlanDigest ?? null,
      manuscriptSourceHash: cinematicResult.source?.manuscriptSourceHash ?? cinematicLock.source?.manuscriptSourceHash ?? null,
      outputRoot: cinematicResult.source?.outputRoot ?? null
    }),
    profile: freeze({
      profileId: cinematicLock.profileId,
      recipeFingerprint,
      selectedComparison: cinematicLock.humanDecision.selectedComparison,
      rejectedEscalation: cinematicLock.humanDecision.rejectedEscalation,
      lockedProductionChain: cinematicLock.lockedProductionChain
    }),
    chapters: freeze(chapters),
    guardrails: freeze({
      providerTtsCallsPerformed: 0,
      providerSpendUsd: 0,
      originalBatchPreserved: true,
      canonicalTextImmutable: true,
      reviewDoesNotModifyAudio: true,
      noApprovalTokenCreated: true,
      chapterElevenMayBeGenerated: false,
      nextBatchArmed: false,
      fullBookGenerationArmed: false
    })
  };
  return freeze({ ...base, integrity: freeze({ reviewSessionDigest: sha256(stableJson(reviewSessionCore(base))) }) });
}

export function verifyBookOneCinematicHumanReviewSession(session) {
  if (!session || session.artifact !== 'book-one-cinematic-human-review-session') throw new Error('Invalid cinematic human review session');
  if (session.status !== 'AWAITING_TEN_CHAPTER_HUMAN_REVIEW') throw new Error('Cinematic human review session status invalid');
  if ((session.chapters ?? []).length !== BOOK_ONE_CINEMATIC_HUMAN_REVIEW_CHAPTERS) throw new Error('Cinematic human review session must contain ten chapters');
  if (!session.integrity?.reviewSessionDigest || sha256(stableJson(reviewSessionCore(session))) !== session.integrity.reviewSessionDigest) throw new Error('Cinematic human review session digest mismatch');
  if (session.guardrails?.chapterElevenMayBeGenerated !== false || session.guardrails?.nextBatchArmed !== false || session.guardrails?.fullBookGenerationArmed !== false) throw new Error('Cinematic human review session guardrails invalid');
  return true;
}

export function renderBookOneCinematicHumanReviewHtml(session) {
  verifyBookOneCinematicHumanReviewSession(session);
  const data = JSON.stringify({
    reviewSessionDigest: session.integrity.reviewSessionDigest,
    cinematicResultDigest: session.source.cinematicResultDigest,
    cinematicLockDigest: session.source.cinematicLockDigest,
    recipeFingerprint: session.profile.recipeFingerprint,
    chapters: session.chapters
  }).replace(/</g, '\\u003c');
  const cards = session.chapters.map((chapter) => `
    <section class="card" data-chapter="${chapter.chapterNumber}">
      <div class="eyebrow">Chapter ${chapter.chapterNumber} of 10</div>
      <h2>${escapeHtml(chapter.title)}</h2>
      <p class="muted">${chapter.subtlePerformanceDirections} subtle performance direction(s) · technical QA PASS</p>
      ${chapter.audioRelativePath ? `<audio controls preload="metadata" src="${escapeHtml(chapter.audioRelativePath)}"></audio>` : '<p class="warning">Audio path unavailable.</p>'}
      <div class="decision-row" role="group" aria-label="Chapter ${chapter.chapterNumber} decision">
        <button data-decision="PASS">Pass</button>
        <button data-decision="MAYBE">Maybe</button>
        <button data-decision="FAIL">Needs changes</button>
      </div>
      <textarea rows="3" placeholder="Optional note for this chapter"></textarea>
    </section>`).join('');

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Book One — Ten-Chapter Human Review</title><style>
  :root{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text",Inter,system-ui,sans-serif;background:#f5f5f7;color:#111}*{box-sizing:border-box}body{margin:0;padding:28px}.wrap{max-width:980px;margin:auto}.hero,.card{background:#fff;border:1px solid #e5e5ea;border-radius:24px;box-shadow:0 12px 36px rgba(0,0,0,.06)}.hero{padding:30px;position:sticky;top:12px;z-index:5}.card{padding:22px;margin-top:16px}h1{margin:0 0 8px;font-size:34px;letter-spacing:-.03em}h2{margin:4px 0 8px}.muted{color:#6e6e73}.eyebrow{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#6e6e73;font-weight:700}audio{width:100%;margin:12px 0}.decision-row{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}.decision-row button,.overall button,#export{border:1px solid #d2d2d7;background:#f5f5f7;border-radius:999px;padding:10px 14px;font-weight:700;cursor:pointer}.decision-row button.selected,.overall button.selected{background:#111;color:#fff}textarea{width:100%;border:1px solid #d2d2d7;border-radius:14px;padding:12px;font:inherit;resize:vertical}.gate{background:#fff3cd;border-radius:16px;padding:14px;margin-top:14px}.overall{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}#export{background:#111;color:#fff;margin-top:12px}.count{font-weight:700}
  </style></head><body><div class="wrap"><div class="hero"><div class="muted">YasReady Audiobooks ${escapeHtml(session.release)}</div><h1>Ten-Chapter Human Review</h1><p>Listen straight through and mark each chapter. This review changes no audio and spends $0.00.</p><div class="gate"><strong>Chapter 11 stays OFF.</strong> Next-batch readiness cannot open until all ten chapters are reviewed and you explicitly approve the Cinematic Naturalism A recipe.</div><p><span class="count" id="count">0/10 reviewed</span></p><div class="overall"><button data-overall="APPROVE_CINEMATIC_RECIPE">Approve Cinematic Recipe</button><button data-overall="NEEDS_CHANGES">Needs Changes</button></div><textarea id="overall-notes" rows="3" placeholder="Optional overall note"></textarea><button id="export">Export Review JSON</button></div>${cards}</div><script>
  const SOURCE=${data};
  const KEY='yasready-cinematic-review:'+SOURCE.reviewSessionDigest;
  const blank={chapters:{},overallDecision:null,overallNotes:''};
  let state=Object.assign(blank,JSON.parse(localStorage.getItem(KEY)||'{}'));
  state.chapters=state.chapters||{};
  function save(){localStorage.setItem(KEY,JSON.stringify(state));render();}
  function render(){
    document.querySelectorAll('.card').forEach(card=>{
      const n=Number(card.dataset.chapter); const row=state.chapters[n]||{};
      card.querySelectorAll('[data-decision]').forEach(b=>b.classList.toggle('selected',b.dataset.decision===row.decision));
      card.querySelector('textarea').value=row.notes||'';
    });
    document.querySelectorAll('[data-overall]').forEach(b=>b.classList.toggle('selected',b.dataset.overall===state.overallDecision));
    document.getElementById('overall-notes').value=state.overallNotes||'';
    const reviewed=SOURCE.chapters.filter(ch=>['PASS','MAYBE','FAIL'].includes(state.chapters[ch.chapterNumber]?.decision)).length;
    document.getElementById('count').textContent=reviewed+'/10 reviewed';
  }
  document.querySelectorAll('.card').forEach(card=>{
    const n=Number(card.dataset.chapter);
    card.querySelectorAll('[data-decision]').forEach(b=>b.addEventListener('click',()=>{state.chapters[n]={...(state.chapters[n]||{}),decision:b.dataset.decision};save();}));
    card.querySelector('textarea').addEventListener('input',e=>{state.chapters[n]={...(state.chapters[n]||{}),notes:e.target.value};localStorage.setItem(KEY,JSON.stringify(state));});
  });
  document.querySelectorAll('[data-overall]').forEach(b=>b.addEventListener('click',()=>{state.overallDecision=b.dataset.overall;save();}));
  document.getElementById('overall-notes').addEventListener('input',e=>{state.overallNotes=e.target.value;localStorage.setItem(KEY,JSON.stringify(state));});
  document.getElementById('export').addEventListener('click',()=>{
    const chapters=SOURCE.chapters.map(ch=>({chapterNumber:ch.chapterNumber,decision:state.chapters[ch.chapterNumber]?.decision||'UNREVIEWED',notes:state.chapters[ch.chapterNumber]?.notes||''}));
    const heardAllTen=chapters.every(ch=>['PASS','MAYBE','FAIL'].includes(ch.decision));
    const payload={schemaVersion:1,artifact:'book-one-cinematic-human-review-decisions',source:{reviewSessionDigest:SOURCE.reviewSessionDigest,cinematicResultDigest:SOURCE.cinematicResultDigest,cinematicLockDigest:SOURCE.cinematicLockDigest,recipeFingerprint:SOURCE.recipeFingerprint},heardAllTen,overallDecision:state.overallDecision,overallNotes:state.overallNotes||'',chapters};
    const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='cinematic-human-review-decisions.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  });
  render();
  </script></body></html>`;
}

export function renderBookOneCinematicHumanReviewSessionMarkdown(session) {
  verifyBookOneCinematicHumanReviewSession(session);
  return [
    '# Book One — Ten-Chapter Human Review Gate',
    '',
    `**Release:** ${session.release}`,
    '**Status:** AWAITING_TEN_CHAPTER_HUMAN_REVIEW',
    '**Provider TTS calls:** 0',
    '**Spend:** $0.00',
    '**Chapter 11:** OFF',
    '**Next batch armed:** NO',
    '**Full-book generation armed:** NO',
    '',
    'Listen to all ten Cinematic Naturalism A chapters. Mark PASS / MAYBE / NEEDS CHANGES per chapter, then explicitly approve the recipe or request changes.',
    '',
    `Recipe fingerprint: \`${session.profile.recipeFingerprint}\``,
    `Review session digest: \`${session.integrity.reviewSessionDigest}\``,
    ''
  ].join('\n');
}

export function finalizeBookOneCinematicHumanReview({ session, decisions } = {}) {
  verifyBookOneCinematicHumanReviewSession(session);
  if (!decisions || decisions.artifact !== 'book-one-cinematic-human-review-decisions') throw new Error('Cinematic review finalization requires exported review decisions');
  if (decisions.source?.reviewSessionDigest !== session.integrity.reviewSessionDigest) throw new Error('Review decisions do not belong to this review session');
  if (decisions.source?.cinematicResultDigest !== session.source.cinematicResultDigest ||
      decisions.source?.cinematicLockDigest !== session.source.cinematicLockDigest ||
      decisions.source?.recipeFingerprint !== session.profile.recipeFingerprint) throw new Error('Review decision source digests drifted');
  const rows = decisions.chapters ?? [];
  if (rows.length !== BOOK_ONE_CINEMATIC_HUMAN_REVIEW_CHAPTERS) throw new Error('All ten chapter decisions are required');
  const byNumber = new Map();
  for (const row of rows) {
    const number = Number(row?.chapterNumber);
    const decision = String(row?.decision ?? '').toUpperCase();
    if (!Number.isInteger(number) || number < 1 || number > 10 || byNumber.has(number)) throw new Error('Chapter review numbers must be unique 1-10');
    if (!BOOK_ONE_CINEMATIC_CHAPTER_DECISIONS.includes(decision)) throw new Error(`Chapter ${number} is still unreviewed`);
    byNumber.set(number, freeze({ chapterNumber: number, decision, notes: clean(row?.notes) }));
  }
  if (byNumber.size !== 10 || decisions.heardAllTen !== true) throw new Error('Human must confirm all ten chapters were heard');
  const overallDecision = String(decisions.overallDecision ?? '').toUpperCase();
  if (!BOOK_ONE_CINEMATIC_OVERALL_DECISIONS.includes(overallDecision)) throw new Error('Explicit overall Approve Cinematic Recipe or Needs Changes decision is required');
  const ordered = Array.from({ length: 10 }, (_, i) => byNumber.get(i + 1));
  const failCount = ordered.filter((row) => row.decision === 'FAIL').length;
  if (overallDecision === 'APPROVE_CINEMATIC_RECIPE' && failCount > 0) throw new Error('Cannot approve the cinematic recipe while a chapter is marked NEEDS CHANGES');
  const approved = overallDecision === 'APPROVE_CINEMATIC_RECIPE';
  const base = {
    schemaVersion: 1,
    release: YASREADY_AUDIOBOOKS_VERSION,
    artifact: 'book-one-cinematic-human-review-approval',
    status: approved ? 'APPROVED_FOR_NEXT_BATCH_READINESS' : 'HUMAN_CHANGES_REQUIRED',
    source: freeze({
      reviewSessionDigest: session.integrity.reviewSessionDigest,
      cinematicResultDigest: session.source.cinematicResultDigest,
      cinematicLockDigest: session.source.cinematicLockDigest,
      productionPlanDigest: session.source.productionPlanDigest,
      manuscriptSourceHash: session.source.manuscriptSourceHash
    }),
    profile: session.profile,
    chapterReview: freeze({
      heardAllTen: true,
      passCount: ordered.filter((row) => row.decision === 'PASS').length,
      maybeCount: ordered.filter((row) => row.decision === 'MAYBE').length,
      failCount,
      chapters: freeze(ordered)
    }),
    humanDecision: freeze({
      overallDecision,
      cinematicRecipeApproved: approved,
      notes: clean(decisions.overallNotes)
    }),
    guardrails: freeze({
      providerTtsCallsPerformed: 0,
      providerSpendUsd: 0,
      approvalCreatesNoSpendToken: true,
      originalBatchPreserved: true,
      cinematicBatchOnePreserved: true,
      nextBatchReadinessMayBeCalculated: approved,
      chapterElevenMayBeGenerated: false,
      nextBatchArmed: false,
      fullBookGenerationArmed: false,
      automaticScaleUp: false
    })
  };
  return freeze({ ...base, integrity: freeze({ approvalDigest: sha256(stableJson(approvalCore(base))) }) });
}

export function verifyBookOneCinematicHumanReviewApproval(approval) {
  if (!approval || approval.artifact !== 'book-one-cinematic-human-review-approval') throw new Error('Invalid cinematic human review approval');
  if (!['APPROVED_FOR_NEXT_BATCH_READINESS', 'HUMAN_CHANGES_REQUIRED'].includes(approval.status)) throw new Error('Cinematic human review approval status invalid');
  if (!approval.integrity?.approvalDigest || sha256(stableJson(approvalCore(approval))) !== approval.integrity.approvalDigest) throw new Error('Cinematic human review approval digest mismatch');
  if (approval.guardrails?.chapterElevenMayBeGenerated !== false || approval.guardrails?.nextBatchArmed !== false || approval.guardrails?.fullBookGenerationArmed !== false) throw new Error('Cinematic human review approval guardrails invalid');
  return true;
}

export function renderBookOneCinematicHumanReviewApprovalMarkdown(approval) {
  verifyBookOneCinematicHumanReviewApproval(approval);
  return [
    '# Book One — Cinematic Human Review Decision',
    '',
    `**Status:** ${approval.status}`,
    `**Overall decision:** ${approval.humanDecision.overallDecision}`,
    `**PASS / MAYBE / NEEDS CHANGES:** ${approval.chapterReview.passCount} / ${approval.chapterReview.maybeCount} / ${approval.chapterReview.failCount}`,
    '**Provider TTS calls:** 0',
    '**Spend:** $0.00',
    '**Chapter 11 generated:** NO',
    '**Next batch armed:** NO',
    '**Full-book generation armed:** NO',
    '',
    approval.humanDecision.cinematicRecipeApproved
      ? 'The human review gate is open for a **read-only next-batch readiness calculation only**. A later release must still create a separate exact arm and spend token.'
      : 'The cinematic recipe is not approved for additional production.',
    '',
    `Approval digest: \`${approval.integrity.approvalDigest}\``,
    ''
  ].join('\n');
}

function headingText(title) {
  const value = clean(title);
  if (!value) throw new Error('Cinematic next-batch readiness requires a chapter title');
  return /[.!?]$/.test(value) ? value : `${value}.`;
}

export function buildBookOneCinematicNextBatchReadiness({
  productionPlan,
  manuscriptAnalysis,
  cinematicResult,
  cinematicLock,
  humanReviewApproval,
  providerRemaining,
  providerTier = null,
  retryReserveRatio = BOOK_ONE_CINEMATIC_NEXT_BATCH_RETRY_RATIO,
  maxChapters = BOOK_ONE_CINEMATIC_NEXT_BATCH_MAX_CHAPTERS
} = {}) {
  verifyBookOneProductionPlan(productionPlan, { acceptedReleases: BOOK_ONE_CINEMATIC_ALLOWED_PLAN_RELEASES });
  verifyTenChapterSource(cinematicResult, cinematicLock);
  verifyBookOneCinematicHumanReviewApproval(humanReviewApproval);
  if (humanReviewApproval.status !== 'APPROVED_FOR_NEXT_BATCH_READINESS' || humanReviewApproval.humanDecision?.cinematicRecipeApproved !== true) throw new Error('Next-batch readiness requires explicit ten-chapter cinematic recipe approval');
  if (humanReviewApproval.source?.cinematicResultDigest !== cinematicResult.integrity.resultDigest ||
      humanReviewApproval.source?.cinematicLockDigest !== cinematicLock.integrity.lockDigest ||
      humanReviewApproval.profile?.recipeFingerprint !== cinematicRecipeFingerprint(cinematicLock)) throw new Error('Human review approval does not belong to this cinematic production recipe');
  if (productionPlan.integrity?.productionPlanDigest !== cinematicLock.source?.productionPlanDigest ||
      productionPlan.integrity?.productionPlanDigest !== cinematicResult.source?.productionPlanDigest) throw new Error('Cinematic next-batch readiness production plan digest drifted');
  if (manuscriptAnalysis?.source?.sourceHash !== productionPlan.source?.sourceHash ||
      manuscriptAnalysis?.source?.sourceHash !== cinematicLock.source?.manuscriptSourceHash) throw new Error('Cinematic next-batch readiness manuscript source hash drifted');

  const remaining = Number(providerRemaining);
  if (!Number.isFinite(remaining) || remaining < 0) throw new Error('Cinematic next-batch readiness requires verified live provider remaining quota');
  const reserveRatio = Number(retryReserveRatio);
  if (!(reserveRatio >= 0 && reserveRatio <= 1)) throw new Error('retryReserveRatio must be between 0 and 1');
  const chapterCap = Number(maxChapters);
  if (!Number.isInteger(chapterCap) || chapterCap < 1 || chapterCap > BOOK_ONE_CINEMATIC_NEXT_BATCH_MAX_CHAPTERS) throw new Error(`maxChapters must be between 1 and ${BOOK_ONE_CINEMATIC_NEXT_BATCH_MAX_CHAPTERS}`);
  const cap = Number(productionPlan.manifest?.maxCharactersPerProviderCall);
  if (!Number.isInteger(cap) || cap < 1) throw new Error('Production plan is missing a valid provider chunk cap');

  const completedOrders = cinematicResult.chapters.map((chapter) => Number(chapter.sourceChapterOrder));
  const lastCompletedOrder = Math.max(...completedOrders);
  if (lastCompletedOrder !== 9) throw new Error('Cinematic next-batch readiness expects the first ten narrative chapters complete');

  const remainingPlans = [...(productionPlan.manifest?.chapters ?? [])]
    .filter((chapter) => Number(chapter.order) > lastCompletedOrder)
    .sort((a, b) => Number(a.order) - Number(b.order));

  const candidates = [];
  for (const planned of remainingPlans) {
    const chapter = manuscriptAnalysis.chapters?.[planned.order];
    if (!chapter) throw new Error(`Cinematic next-batch source chapter missing: ${planned.title}`);
    if (planned.sourceTextHash && chapter.textHash !== planned.sourceTextHash) throw new Error(`Cinematic next-batch chapter source drifted: ${planned.title}`);
    const heading = headingText(planned.title);
    let bodyCharacters = 0;
    let bodyCalls = 0;
    let directionCount = 0;
    for (const scene of chapter.scenes ?? []) {
      const compiled = compileCinematicNaturalismScene(scene.segments ?? [], cinematicLock);
      directionCount += compiled.cueCount;
      for (const chunk of splitForTts(compiled.providerText, { maxChars: cap })) {
        bodyCharacters += [...chunk].length;
        bodyCalls += 1;
      }
    }
    candidates.push(freeze({
      order: Number(planned.order),
      chapterNumber: Number(planned.order) + 1,
      title: planned.title,
      subtlePerformanceDirections: directionCount,
      spokenHeadingCharacters: [...heading].length,
      bodyProviderCharacters: bodyCharacters,
      newProviderCharacters: [...heading].length + bodyCharacters,
      spokenHeadingCalls: 1,
      bodyProviderCalls: bodyCalls,
      newProviderCalls: 1 + bodyCalls
    }));
  }

  const selected = [];
  let chars = 0;
  let calls = 0;
  for (const chapter of candidates) {
    if (selected.length >= chapterCap) break;
    const candidateChars = chars + chapter.newProviderCharacters;
    const reserve = Math.ceil(candidateChars * reserveRatio);
    if (candidateChars + reserve > remaining) break;
    selected.push(chapter);
    chars = candidateChars;
    calls += chapter.newProviderCalls;
  }

  const retryReserveCharacters = Math.ceil(chars * reserveRatio);
  const quotaEnvelopeCharacters = chars + retryReserveCharacters;
  const rate = Number(productionPlan.budget?.rateUsdPer1kCharacters ?? 0.10);
  const initialGenerationUsd = round((chars / 1000) * rate, 6);
  const retryReserveUsd = round(initialGenerationUsd * reserveRatio, 6);
  const protectedMaxUsd = ceilCents(initialGenerationUsd + retryReserveUsd);
  const noBookWorkLeft = candidates.length === 0;
  const status = noBookWorkLeft
    ? 'BOOK_COMPLETE_NO_NEXT_BATCH'
    : selected.length === 0
      ? 'INSUFFICIENT_QUOTA_FOR_NEXT_WHOLE_CINEMATIC_CHAPTER'
      : 'READINESS_CALCULATED_HUMAN_GATE_OPEN';

  const base = {
    schemaVersion: 1,
    release: YASREADY_AUDIOBOOKS_VERSION,
    artifact: 'book-one-cinematic-next-batch-readiness',
    status,
    source: freeze({
      productionPlanDigest: productionPlan.integrity.productionPlanDigest,
      cinematicResultDigest: cinematicResult.integrity.resultDigest,
      cinematicLockDigest: cinematicLock.integrity.lockDigest,
      humanReviewApprovalDigest: humanReviewApproval.integrity.approvalDigest,
      recipeFingerprint: humanReviewApproval.profile.recipeFingerprint,
      manuscriptSourceHash: manuscriptAnalysis.source.sourceHash,
      previousLastChapterOrder: lastCompletedOrder
    }),
    liveProvider: freeze({
      checkedAt: new Date().toISOString(),
      tier: providerTier,
      providerReportedRemaining: remaining,
      providerTtsCallsPerformed: 0,
      providerSpendUsd: 0
    }),
    candidateBatch: freeze({
      wholeChaptersOnly: true,
      chapterCount: selected.length,
      firstChapterNumber: selected[0]?.chapterNumber ?? null,
      lastChapterNumber: selected.at(-1)?.chapterNumber ?? null,
      chapters: freeze(selected),
      newProviderCalls: calls,
      newProviderCharacters: chars,
      retryReserveRatio: reserveRatio,
      retryReserveCharacters,
      quotaEnvelopeCharacters,
      quotaHeadroomAfterEnvelope: remaining - quotaEnvelopeCharacters
    }),
    budgetPreview: freeze({
      currency: 'USD',
      rateUsdPer1kCharacters: rate,
      initialGenerationUsd,
      retryReserveUsd,
      protectedMaxUsd,
      estimateNotInvoice: true,
      spendAuthorized: false
    }),
    humanReviewGate: freeze({
      tenChapterListenCompleted: true,
      cinematicRecipeApproved: true,
      approvalDigest: humanReviewApproval.integrity.approvalDigest,
      nextBatchMayBeArmedByThisArtifact: false,
      nextAction: selected.length
        ? 'Readiness only. Build a later exact cinematic production arm that rechecks live quota and requires a new spend token.'
        : noBookWorkLeft
          ? 'No narrative chapters remain.'
          : 'Wait for more provider quota; partial chapters are never selected.'
    }),
    guardrails: freeze({
      readOnlyReadinessOnly: true,
      providerTtsCallsPerformed: 0,
      providerSpendUsd: 0,
      noApprovalTokenCreated: true,
      chapterElevenMayBeGenerated: false,
      nextBatchArmed: false,
      productionArmed: false,
      fullBookGenerationArmed: false,
      wholeChapterBoundaryRequired: true,
      automaticScaleUp: false
    })
  };
  return freeze({ ...base, integrity: freeze({ readinessDigest: sha256(stableJson(base)) }) });
}

export function renderBookOneCinematicNextBatchReadinessMarkdown(result) {
  if (!result || result.artifact !== 'book-one-cinematic-next-batch-readiness') throw new Error('Invalid cinematic next-batch readiness');
  const lines = [
    '# Book One — Cinematic Next-Batch Readiness',
    '',
    `**Status:** ${result.status}`,
    '**Provider TTS calls:** 0',
    '**Spend:** $0.00',
    '**Approval token created:** NO',
    '**Chapter 11 generated:** NO',
    '**Next batch armed:** NO',
    '**Full-book generation armed:** NO',
    '',
    '## Candidate scope',
    '',
    `- Whole chapters: **${result.candidateBatch.chapterCount}**`,
    `- New provider calls: **${result.candidateBatch.newProviderCalls}**`,
    `- New provider characters: **${result.candidateBatch.newProviderCharacters.toLocaleString()}**`,
    `- Retry reserve: **${result.candidateBatch.retryReserveCharacters.toLocaleString()} characters**`,
    `- Quota envelope: **${result.candidateBatch.quotaEnvelopeCharacters.toLocaleString()} / ${result.liveProvider.providerReportedRemaining.toLocaleString()} available**`,
    `- Preview protected max: **$${Number(result.budgetPreview.protectedMaxUsd).toFixed(2)}**`,
    ''
  ];
  for (const chapter of result.candidateBatch.chapters) lines.push(`- Chapter ${chapter.chapterNumber}: ${chapter.title} — ${chapter.newProviderCharacters.toLocaleString()} chars / ${chapter.newProviderCalls} calls / ${chapter.subtlePerformanceDirections} subtle performance direction(s)`);
  lines.push('', '## Gate', '', 'This is **read-only readiness**. It cannot generate Chapter 11 or create a spend token.', result.humanReviewGate.nextAction, '');
  return lines.join('\n');
}

function escapeHtml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
