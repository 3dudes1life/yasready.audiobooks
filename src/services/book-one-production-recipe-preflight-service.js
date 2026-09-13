import { mkdir, statfs } from 'node:fs/promises';
import path from 'node:path';
import { YASREADY_AUDIOBOOKS_VERSION } from '../release.js';
import { sha256, stableJson } from '../core/hash.js';
import { verifyBookOneProductionPlan } from './book-one-production-plan-service.js';
import { extractElevenLabsQuota } from './book-one-production-pilot-service.js';

export const BOOK_ONE_FULL_BOOK_ACCEPTED_PLAN_RELEASES = Object.freeze([
  '0.14.3.13', '0.14.3.14', '0.14.3.14.1', '0.14.3.14.2', '0.14.3.15', '0.14.3.16', '0.14.3.17', '0.14.3.18', '0.14.3.18.1', '0.14.3.18.2', '0.14.3.19', '0.14.3.20', '0.14.3.20.1'
]);
export const BOOK_ONE_LOCAL_FINISH_ACCEPTED_RELEASES = Object.freeze(['0.14.3.14.2', '0.14.3.15', '0.14.3.16', '0.14.3.17', '0.14.3.18', '0.14.3.18.1', '0.14.3.18.2', '0.14.3.19', '0.14.3.20', '0.14.3.20.1']);
export const BOOK_ONE_FULL_BOOK_STORAGE_MIN_GIB = 5;
export const BOOK_ONE_FULL_BOOK_STORAGE_GIB_PER_FINISHED_HOUR = 1.5;

const freeze = (value) => {
  if (Array.isArray(value)) { for (const item of value) freeze(item); return Object.freeze(value); }
  if (value && typeof value === 'object') { for (const item of Object.values(value)) freeze(item); return Object.freeze(value); }
  return value;
};
const round = (value, digits = 6) => {
  const factor = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
};
const gib = (bytes) => round(Number(bytes) / (1024 ** 3), 3);

function finishCore(lock) {
  return {
    schemaVersion: lock.schemaVersion,
    release: lock.release,
    artifact: lock.artifact,
    status: lock.status,
    sourcePilotRenderDigest: lock.sourcePilotRenderDigest,
    narrator: lock.narrator,
    performanceUnchanged: lock.performanceUnchanged,
    providerVoiceSettingsUnchanged: lock.providerVoiceSettingsUnchanged,
    paceProfileUnchanged: lock.paceProfileUnchanged,
    selectedVariant: lock.selectedVariant,
    productionArmed: lock.productionArmed,
    fullBookGenerationArmed: lock.fullBookGenerationArmed
  };
}

export function verifyBookOneLocalVoiceFinishLock(lock) {
  if (!lock || lock.artifact !== 'book-one-local-voice-finish-lock') throw new Error('Production recipe requires book-one-local-voice-finish-lock.json');
  if (!BOOK_ONE_LOCAL_FINISH_ACCEPTED_RELEASES.includes(lock.release)) throw new Error('Local voice finish lock release is not accepted');
  if (lock.status !== 'LOCKED_FOR_PRODUCTION_PLANNING_ONLY') throw new Error('Local voice finish is not locked for production planning');
  if (lock.productionArmed !== false || lock.fullBookGenerationArmed !== false) throw new Error('Local voice finish lock must remain unarmed');
  if (lock.performanceUnchanged !== true) throw new Error('Local voice finish must preserve the approved narrator performance');
  if (!lock.finishDigest) throw new Error('Local voice finish digest missing');
  const expected = sha256(stableJson(finishCore(lock)));
  if (expected !== lock.finishDigest) throw new Error('Local voice finish digest mismatch');
  if (!lock.selectedVariant?.id || !lock.selectedVariant?.label) throw new Error('Local voice finish selected variant missing');
  return true;
}

function recipeCore(lock) {
  return {
    schemaVersion: lock.schemaVersion,
    release: lock.release,
    artifact: lock.artifact,
    status: lock.status,
    book: lock.book,
    source: lock.source,
    narrator: lock.narrator,
    performance: lock.performance,
    provider: lock.provider,
    pace: lock.pace,
    localVoiceFinish: lock.localVoiceFinish,
    processingPipeline: lock.processingPipeline,
    workload: lock.workload,
    budget: lock.budget,
    resumability: lock.resumability,
    guardrails: lock.guardrails
  };
}

export function verifyBookOneProductionRecipeLock(lock) {
  if (!lock || lock.artifact !== 'book-one-production-recipe-lock') throw new Error('Invalid Book One production recipe lock');
  if (lock.release !== YASREADY_AUDIOBOOKS_VERSION) throw new Error('Production recipe lock release mismatch');
  if (lock.status !== 'LOCKED_FOR_FULL_BOOK_PREFLIGHT_ONLY') throw new Error('Production recipe is not in preflight-only state');
  if (lock.guardrails?.productionArmed !== false || lock.guardrails?.fullBookGenerationArmed !== false) throw new Error('Production recipe lock cannot arm production');
  if (lock.guardrails?.providerTtsCallsPerformed !== 0 || lock.guardrails?.providerTtsSpendUsd !== 0) throw new Error('Production recipe lock must be zero-TTS and zero-spend');
  if (!lock.integrity?.recipeDigest) throw new Error('Production recipe lock digest missing');
  if (sha256(stableJson(recipeCore(lock))) !== lock.integrity.recipeDigest) throw new Error('Production recipe lock integrity digest mismatch');
  return true;
}

export function buildBookOneProductionRecipeLock({ productionPlan, localVoiceFinishLock } = {}) {
  verifyBookOneProductionPlan(productionPlan, { acceptedReleases: BOOK_ONE_FULL_BOOK_ACCEPTED_PLAN_RELEASES });
  verifyBookOneLocalVoiceFinishLock(localVoiceFinishLock);
  if (productionPlan.guardrails?.productionArmed !== false || productionPlan.guardrails?.fullBookGenerationArmed !== false) throw new Error('Production recipe refuses an armed production plan');

  const recipe = productionPlan.productionRecipe;
  const finish = localVoiceFinishLock;
  if (recipe.providerVoiceId !== finish.narrator?.providerVoiceId) throw new Error('Local finish narrator voice does not match production plan');
  if (recipe.narratorName !== finish.narrator?.narratorName) throw new Error('Local finish narrator name does not match production plan');
  if (stableJson(recipe.providerVoiceSettings) !== stableJson(finish.providerVoiceSettingsUnchanged)) throw new Error('Local finish provider voice settings drifted from production plan');
  if (stableJson(recipe.paceProfile) !== stableJson(finish.paceProfileUnchanged)) throw new Error('Local finish pace profile drifted from production plan');

  const selected = finish.selectedVariant;
  const steps = [
    freeze({ order: 1, id: 'provider-tts', engine: recipe.provider, model: recipe.model, voiceId: recipe.providerVoiceId, providerVoiceSettings: recipe.providerVoiceSettings, paid: true }),
    ...(recipe.paceProfile?.postProcessRequired ? [freeze({ order: 2, id: 'pace-tempo', engine: 'ffmpeg', method: recipe.paceProfile.postProcessKind, multiplier: recipe.paceProfile.postProcessTempoMultiplier, targetEffectiveSpeed: recipe.paceProfile.effectiveSpeed, paid: false })] : []),
    freeze({ order: recipe.paceProfile?.postProcessRequired ? 3 : 2, id: 'local-voice-finish', engine: 'ffmpeg', variantId: selected.id, variantLabel: selected.label, eq: selected.eq ?? null, semitones: Number(selected.semitones ?? 0), pitchFactor: Number(selected.pitchFactor ?? 1), durationCompensation: Number(selected.durationCompensation ?? 1), formantPreservationClaimed: Boolean(selected.formantPreservationClaimed), paid: false }),
    freeze({ order: recipe.paceProfile?.postProcessRequired ? 4 : 3, id: 'chapter-assembly', engine: 'ffmpeg', paid: false }),
    freeze({ order: recipe.paceProfile?.postProcessRequired ? 5 : 4, id: 'mastering', engine: 'ffmpeg', profile: 'acx-2026', paid: false }),
    freeze({ order: recipe.paceProfile?.postProcessRequired ? 6 : 5, id: 'technical-qa', engine: 'yasready', paid: false })
  ];

  const base = {
    schemaVersion: 1,
    release: YASREADY_AUDIOBOOKS_VERSION,
    artifact: 'book-one-production-recipe-lock',
    status: 'LOCKED_FOR_FULL_BOOK_PREFLIGHT_ONLY',
    book: productionPlan.book,
    source: freeze({
      productionPlanRelease: productionPlan.release,
      productionPlanDigest: productionPlan.integrity.productionPlanDigest,
      narratorLockDigest: productionPlan.narratorLock.lockDigest,
      localVoiceFinishRelease: finish.release,
      localVoiceFinishDigest: finish.finishDigest,
      sourcePilotRenderDigest: finish.sourcePilotRenderDigest,
      manuscriptSourceHash: productionPlan.source.sourceHash
    }),
    narrator: freeze({ provider: recipe.provider, voiceId: recipe.providerVoiceId, name: recipe.narratorName }),
    performance: recipe.performanceDirection,
    provider: freeze({
      model: recipe.model,
      voiceSettings: recipe.providerVoiceSettings,
      elevenV3ContinuityContextPolicy: recipe.model === 'eleven_v3' ? 'omit-previous_text-and-next_text' : 'provider-supported-context-may-be-used'
    }),
    pace: recipe.paceProfile,
    localVoiceFinish: freeze({ ...selected, finishDigest: finish.finishDigest }),
    processingPipeline: freeze(steps),
    workload: productionPlan.workload,
    budget: productionPlan.budget,
    resumability: productionPlan.resumability,
    guardrails: freeze({
      recipeLocked: true,
      providerTtsCallsPerformed: 0,
      providerTtsSpendUsd: 0,
      productionArmed: false,
      fullBookGenerationArmed: false,
      explicitFullBookArmRequired: true,
      preflightTokenCannotAuthorizeSpend: true,
      exactProductionPlanDigestRequired: true,
      exactNarratorLockDigestRequired: true,
      exactLocalVoiceFinishDigestRequired: true,
      exactManuscriptSourceHashRequired: true
    })
  };
  const recipeDigest = sha256(stableJson(recipeCore(base)));
  const locked = freeze({ ...base, integrity: freeze({ recipeDigest }) });
  verifyBookOneProductionRecipeLock(locked);
  return locked;
}

export function estimateBookOneProductionStorage(productionPlan) {
  const hoursRaw = Number(productionPlan.workload?.paceAdjustedPlanningHours ?? productionPlan.workload?.estimatedFinishedHours ?? 0);
  const hours = Number.isFinite(hoursRaw) && hoursRaw > 0 ? hoursRaw : Math.max(0.1, Number(productionPlan.workload?.words ?? 0) / 155 / 60);
  const requiredGiB = Math.max(BOOK_ONE_FULL_BOOK_STORAGE_MIN_GIB, hours * BOOK_ONE_FULL_BOOK_STORAGE_GIB_PER_FINISHED_HOUR);
  return freeze({
    estimatedFinishedHours: round(hours, 3),
    requiredBytes: Math.ceil(requiredGiB * (1024 ** 3)),
    requiredGiB: round(requiredGiB, 3),
    policy: `conservative local workspace: max(${BOOK_ONE_FULL_BOOK_STORAGE_MIN_GIB} GiB, ${BOOK_ONE_FULL_BOOK_STORAGE_GIB_PER_FINISHED_HOUR} GiB per estimated finished hour)`,
    estimateOnly: true
  });
}

export async function defaultProductionStorageProbe(outputRoot) {
  const resolved = path.resolve(outputRoot);
  await mkdir(resolved, { recursive: true });
  const stats = await statfs(resolved);
  const blockSize = Number(stats.bsize);
  const availableBlocks = Number(stats.bavail ?? stats.bfree);
  const availableBytes = blockSize * availableBlocks;
  return freeze({ root: resolved, availableBytes, availableGiB: gib(availableBytes) });
}

function preflightCore(result) {
  return {
    schemaVersion: result.schemaVersion,
    release: result.release,
    artifact: result.artifact,
    status: result.status,
    book: result.book,
    recipe: result.recipe,
    workload: result.workload,
    budget: result.budget,
    provider: result.provider,
    ffmpeg: result.ffmpeg,
    storage: result.storage,
    checks: result.checks,
    blockers: result.blockers,
    guardrails: result.guardrails
  };
}

export function verifyBookOneFullBookPreflight(result) {
  if (!result || result.artifact !== 'book-one-full-book-preflight') throw new Error('Invalid full-book preflight result');
  if (result.release !== YASREADY_AUDIOBOOKS_VERSION) throw new Error('Full-book preflight release mismatch');
  if (!['READY_FOR_EXPLICIT_FULL_BOOK_ARM', 'BLOCKED_NOT_READY_FOR_FULL_BOOK_ARM'].includes(result.status)) throw new Error('Full-book preflight status invalid');
  if (result.guardrails?.providerTtsCallsPerformed !== 0 || result.guardrails?.providerTtsSpendUsd !== 0) throw new Error('Full-book preflight must perform zero TTS and spend zero provider TTS dollars');
  if (result.guardrails?.productionArmed !== false || result.guardrails?.fullBookGenerationArmed !== false) throw new Error('Full-book preflight cannot arm production');
  if (!result.integrity?.preflightDigest) throw new Error('Full-book preflight digest missing');
  if (sha256(stableJson(preflightCore(result))) !== result.integrity.preflightDigest) throw new Error('Full-book preflight integrity digest mismatch');
  if (result.confirmation?.token !== `PREFLIGHT-${result.integrity.preflightDigest.slice(0, 10).toUpperCase()}`) throw new Error('Full-book preflight reference token mismatch');
  return true;
}

export async function runBookOneFullBookPreflight({
  productionPlan,
  localVoiceFinishLock,
  provider,
  ffmpeg,
  outputRoot,
  storageProbe = defaultProductionStorageProbe
} = {}) {
  if (!provider?.healthCheck || !provider?.subscriptionPreflight) throw new Error('Full-book preflight requires provider health + subscription preflight support');
  if (!ffmpeg?.healthCheck) throw new Error('Full-book preflight requires FFmpeg health support');
  if (!outputRoot) throw new Error('Full-book preflight requires a production output root');
  const recipeLock = buildBookOneProductionRecipeLock({ productionPlan, localVoiceFinishLock });
  const storageEstimate = estimateBookOneProductionStorage(productionPlan);

  let providerHealth = null;
  let subscriptionPreflight = null;
  let quota = null;
  let providerError = null;
  try { providerHealth = await provider.healthCheck(); } catch (error) { providerError = error?.message ?? String(error); }
  try {
    subscriptionPreflight = await provider.subscriptionPreflight();
    if (subscriptionPreflight?.available && subscriptionPreflight?.subscription) quota = extractElevenLabsQuota(subscriptionPreflight.subscription);
  } catch (error) {
    providerError = providerError ?? (error?.message ?? String(error));
  }
  const ffmpegHealth = await ffmpeg.healthCheck();
  const disk = await storageProbe(outputRoot);

  const requiredCharacters = Number(productionPlan.manifest?.providerCharacters ?? productionPlan.workload?.providerCharacters ?? 0);
  const quotaRemaining = quota?.providerReportedRemaining ?? null;
  const quotaDeficit = quotaRemaining === null ? null : Math.max(0, requiredCharacters - quotaRemaining);
  const storageOk = Number(disk?.availableBytes) >= storageEstimate.requiredBytes;
  const providerHealthOk = providerHealth?.ok === true;
  const liveQuotaVerified = quotaRemaining !== null;
  const quotaOk = liveQuotaVerified && quotaRemaining >= requiredCharacters;
  const ffmpegOk = ffmpegHealth?.ok === true;

  const checks = freeze([
    freeze({ id: 'recipe-integrity', passed: true, detail: recipeLock.integrity.recipeDigest }),
    freeze({ id: 'production-plan-integrity', passed: true, detail: productionPlan.integrity.productionPlanDigest }),
    freeze({ id: 'local-finish-integrity', passed: true, detail: localVoiceFinishLock.finishDigest }),
    freeze({ id: 'provider-health', passed: providerHealthOk, detail: providerError ?? providerHealth?.status ?? providerHealth?.reason ?? null }),
    freeze({ id: 'live-provider-quota-verified', passed: liveQuotaVerified, detail: liveQuotaVerified ? `${quotaRemaining} provider-reported characters remaining` : (subscriptionPreflight?.reason ?? providerError ?? 'unavailable') }),
    freeze({ id: 'full-book-provider-quota', passed: quotaOk, detail: liveQuotaVerified ? `${requiredCharacters} required; ${quotaRemaining} remaining; ${quotaDeficit} deficit` : 'live quota unavailable' }),
    freeze({ id: 'ffmpeg-health', passed: ffmpegOk, detail: ffmpegHealth?.ffmpeg ?? ffmpegHealth?.reason ?? null }),
    freeze({ id: 'local-storage-headroom', passed: storageOk, detail: `${storageEstimate.requiredGiB} GiB estimated required; ${Number(disk?.availableGiB ?? gib(disk?.availableBytes ?? 0)).toFixed(3)} GiB available` }),
    freeze({ id: 'protected-budget-defined', passed: Number(productionPlan.budget?.protectedMaxUsd) >= Number(productionPlan.budget?.initialGenerationUsd) && Number(productionPlan.budget?.protectedMaxUsd) > 0, detail: `$${Number(productionPlan.budget?.protectedMaxUsd ?? 0).toFixed(2)} protected max` }),
    freeze({ id: 'zero-spend-preflight', passed: true, detail: '0 provider TTS calls / $0.00 provider TTS spend' }),
    freeze({ id: 'full-book-remains-unarmed', passed: true, detail: 'explicit future arm required' })
  ]);
  const blockers = freeze(checks.filter((check) => !check.passed).map((check) => freeze({ id: check.id, detail: check.detail })));
  const status = blockers.length ? 'BLOCKED_NOT_READY_FOR_FULL_BOOK_ARM' : 'READY_FOR_EXPLICIT_FULL_BOOK_ARM';

  const base = {
    schemaVersion: 1,
    release: YASREADY_AUDIOBOOKS_VERSION,
    artifact: 'book-one-full-book-preflight',
    status,
    book: productionPlan.book,
    recipe: freeze({
      recipeDigest: recipeLock.integrity.recipeDigest,
      productionPlanDigest: productionPlan.integrity.productionPlanDigest,
      narratorLockDigest: productionPlan.narratorLock.lockDigest,
      localVoiceFinishDigest: localVoiceFinishLock.finishDigest,
      manuscriptSourceHash: productionPlan.source.sourceHash,
      narrator: recipeLock.narrator,
      provider: recipeLock.provider,
      pace: recipeLock.pace,
      localVoiceFinish: recipeLock.localVoiceFinish,
      processingPipeline: recipeLock.processingPipeline
    }),
    workload: freeze({
      words: productionPlan.workload.words,
      chapters: productionPlan.workload.chapters,
      scenes: productionPlan.workload.scenes,
      providerGenerationCalls: productionPlan.manifest.providerGenerationCalls,
      providerCharacters: requiredCharacters,
      localTempoTasks: productionPlan.manifest.postProcessTasks,
      localVoiceFinishTasks: productionPlan.manifest.providerGenerationCalls,
      chapterAssemblyTasks: productionPlan.manifest.chapterAssemblyTasks
    }),
    budget: freeze({ ...productionPlan.budget, liveProviderQuotaIsNotDollarBudget: true }),
    provider: freeze({
      healthOk: providerHealthOk,
      healthStatus: providerHealth?.status ?? null,
      subscriptionAvailable: Boolean(subscriptionPreflight?.available),
      subscriptionSafeToContinue: Boolean(subscriptionPreflight?.safeToContinue),
      tier: quota?.tier ?? subscriptionPreflight?.tier ?? null,
      status: quota?.status ?? subscriptionPreflight?.status ?? null,
      providerReportedUsed: quota?.providerReportedUsed ?? null,
      providerReportedLimit: quota?.providerReportedLimit ?? null,
      providerReportedRemaining: quotaRemaining,
      requiredCharacters,
      deficitCharacters: quotaDeficit,
      nextResetUnix: quota?.nextResetUnix ?? null,
      canExtendCharacterLimit: quota?.canExtendCharacterLimit ?? null,
      maxCreditLimitExtension: quota?.maxCreditLimitExtension ?? null,
      currentOverage: quota?.currentOverage ?? null,
      creditsInferred: false,
      providerTtsCallsPerformed: 0
    }),
    ffmpeg: freeze({ ok: ffmpegOk, ffmpeg: ffmpegHealth?.ffmpeg ?? null, ffprobe: ffmpegHealth?.ffprobe ?? null, reason: ffmpegHealth?.reason ?? null }),
    storage: freeze({ ...storageEstimate, root: disk?.root ?? path.resolve(outputRoot), availableBytes: Number(disk?.availableBytes ?? 0), availableGiB: Number(disk?.availableGiB ?? gib(disk?.availableBytes ?? 0)), passed: storageOk }),
    checks,
    blockers,
    guardrails: freeze({
      providerTtsCallsPerformed: 0,
      providerTtsSpendUsd: 0,
      onlyReadOnlyProviderPreflightRequestsAllowed: true,
      productionArmed: false,
      fullBookGenerationArmed: false,
      explicitFullBookArmRequired: true,
      preflightTokenIsReferenceOnly: true,
      automaticScaleUp: false,
      chapterGenerationPerformed: 0
    })
  };
  const preflightDigest = sha256(stableJson(preflightCore(base)));
  const result = freeze({
    ...base,
    integrity: freeze({ preflightDigest }),
    confirmation: freeze({ token: `PREFLIGHT-${preflightDigest.slice(0, 10).toUpperCase()}`, semantics: 'REFERENCE_ONLY_NOT_SPEND_AUTHORIZATION' }),
    nextAction: status === 'READY_FOR_EXPLICIT_FULL_BOOK_ARM'
      ? 'All preflight gates are green. Build a separate explicit full-book production arm; this release still cannot generate chapters.'
      : 'Resolve every blocker, rerun this zero-spend preflight, and do not arm full-book generation yet.'
  });
  verifyBookOneFullBookPreflight(result);
  return freeze({ recipeLock, preflight: result });
}

export function renderBookOneProductionRecipeLockMarkdown(lock) {
  verifyBookOneProductionRecipeLock(lock);
  const finish = lock.localVoiceFinish;
  return [
    '# Book One Production Recipe Lock', '',
    `**Release:** ${lock.release}`,
    `**Status:** ${lock.status}`,
    `**Production armed:** NO`,
    `**Full-book generation armed:** NO`, '',
    '## Immutable recipe', '',
    `- Narrator: **${lock.narrator.name}**`,
    `- Voice ID: \`${lock.narrator.voiceId}\``,
    `- Model: **${lock.provider.model}**`,
    `- Direction: **${lock.performance.label}**`,
    `- Emotion: **${lock.performance.emotionalVariantLabel}**`,
    `- Stability: **${lock.provider.voiceSettings.stability}**`,
    `- Provider speed: **${Number(lock.pace.providerNativeSpeed).toFixed(2)}**`,
    `- Effective speed: **${Number(lock.pace.effectiveSpeed).toFixed(2)}**`,
    `- Pace tempo: **${Number(lock.pace.postProcessTempoMultiplier).toFixed(6)}x**`,
    `- Local finish: **${finish.label}**`,
    `- Pitch: **${finish.semitones} semitone**`,
    `- Duration compensation: **${finish.durationCompensation}**`, '',
    '## Integrity', '',
    `- Narrator lock: \`${lock.source.narratorLockDigest}\``,
    `- Local finish: \`${lock.source.localVoiceFinishDigest}\``,
    `- Manuscript: \`${lock.source.manuscriptSourceHash}\``,
    `- Production recipe: \`${lock.integrity.recipeDigest}\``, '',
    'This artifact is a lock for preflight only. It cannot authorize provider spend or chapter generation.', ''
  ].join('\n');
}

export function renderBookOneFullBookPreflightMarkdown(result) {
  verifyBookOneFullBookPreflight(result);
  const p = result.provider;
  const lines = [
    '# Book One Full-Book Preflight', '',
    `**Release:** ${result.release}`,
    `**Status:** ${result.status}`,
    `**Provider TTS calls performed:** 0`,
    `**Provider TTS spend:** $0.00`,
    `**Production armed:** NO`,
    `**Full-book generation armed:** NO`, '',
    '## Full-book workload', '',
    `- Chapters: **${result.workload.chapters}**`,
    `- Provider calls planned: **${result.workload.providerGenerationCalls}**`,
    `- Provider characters: **${result.workload.providerCharacters.toLocaleString()}**`,
    `- Pace-tempo tasks: **${result.workload.localTempoTasks}**`,
    `- Voice-finish tasks: **${result.workload.localVoiceFinishTasks}**`, '',
    '## Live provider quota', '',
    `- Tier: **${p.tier ?? 'unknown'}**`,
    `- Provider-reported remaining: **${p.providerReportedRemaining === null ? 'unavailable' : p.providerReportedRemaining.toLocaleString()}**`,
    `- Required for planned full book: **${p.requiredCharacters.toLocaleString()}**`,
    `- Deficit: **${p.deficitCharacters === null ? 'unavailable' : p.deficitCharacters.toLocaleString()}**`,
    '- Credits are **not inferred** from dollar estimates.', '',
    '## Budget', '',
    `- Initial generation estimate: **$${Number(result.budget.initialGenerationUsd).toFixed(2)}**`,
    `- Retry reserve: **$${Number(result.budget.retryReserveUsd).toFixed(2)}**`,
    `- Protected max: **$${Number(result.budget.protectedMaxUsd).toFixed(2)}**`, '',
    '## Local machine preflight', '',
    `- FFmpeg: **${result.ffmpeg.ok ? 'PASS' : 'BLOCKED'}**`,
    `- Storage estimate: **${result.storage.requiredGiB.toFixed(3)} GiB required / ${result.storage.availableGiB.toFixed(3)} GiB available**`, '',
    '## Gates', ''
  ];
  for (const check of result.checks) lines.push(`- ${check.passed ? '✅' : '❌'} **${check.id}** — ${check.detail ?? ''}`);
  if (result.blockers.length) {
    lines.push('', '## Blockers', '');
    for (const blocker of result.blockers) lines.push(`- **${blocker.id}** — ${blocker.detail ?? ''}`);
  }
  lines.push('', '## Reference token', '', `\`${result.confirmation.token}\` — reference only; **not spend authorization**.`, '', '## Next action', '', result.nextAction, '');
  return lines.join('\n');
}
