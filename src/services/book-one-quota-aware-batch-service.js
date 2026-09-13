import { mkdir, readFile, writeFile, copyFile, stat, statfs } from 'node:fs/promises';
import path from 'node:path';
import { YASREADY_AUDIOBOOKS_VERSION } from '../release.js';
import { sha256, stableJson } from '../core/hash.js';
import { splitForTts } from '../production/model-limits.js';
import { verifyBookOneProductionPlan } from './book-one-production-plan-service.js';
import { extractElevenLabsQuota } from './book-one-production-pilot-service.js';
import { safeSectionFileName, evaluateMasterAgainstProfile, getMasteringProfile } from '../mastering/profiles.js';
import { getDistributionProfile } from '../distribution/profiles.js';

export const BOOK_ONE_BATCH_ACCEPTED_PLAN_RELEASES = Object.freeze([
  '0.14.3.13', '0.14.3.14', '0.14.3.14.1', '0.14.3.14.2', '0.14.3.15', '0.14.3.16', '0.14.3.17', '0.14.3.18', '0.14.3.18.1', '0.14.3.18.2', '0.14.3.19', '0.14.3.20', '0.14.3.20.1', '0.14.3.20.2'
]);
export const BOOK_ONE_BATCH_ACCEPTED_RECIPE_RELEASES = Object.freeze(['0.14.3.15', '0.14.3.16', '0.14.3.17', '0.14.3.18', '0.14.3.18.1', '0.14.3.18.2', '0.14.3.19', '0.14.3.20', '0.14.3.20.1', '0.14.3.20.2']);
export const BOOK_ONE_BATCH_ACCEPTED_PREFLIGHT_RELEASES = Object.freeze(['0.14.3.15', '0.14.3.16', '0.14.3.17', '0.14.3.18', '0.14.3.18.1', '0.14.3.18.2', '0.14.3.19', '0.14.3.20', '0.14.3.20.1', '0.14.3.20.2']);
export const BOOK_ONE_BATCH_RETRY_RESERVE_RATIO = 0.20;
export const BOOK_ONE_BATCH_MAX_CHAPTERS = 10;
export const BOOK_ONE_BATCH_MIN_STORAGE_GIB = 2;
export const BOOK_ONE_BATCH_ACX_PROFILE = 'acx-2026';
export const BOOK_ONE_BATCH_SPOTIFY_PROFILE = 'spotify-direct-2026';
export const BOOK_ONE_BATCH_ARCHIVE_PROFILE = 'archive-wav-2026';

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
const exists = async (file) => { try { await stat(file); return true; } catch { return false; } };
const fileDigest = async (file) => sha256((await readFile(file)).toString('base64'));
const gib = (bytes) => round(Number(bytes) / (1024 ** 3), 3);

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

export function verifyBookOneBatchRecipeSnapshot(lock) {
  if (!lock || lock.artifact !== 'book-one-production-recipe-lock') throw new Error('Batch production requires book-one-production-recipe-lock.json');
  if (!BOOK_ONE_BATCH_ACCEPTED_RECIPE_RELEASES.includes(lock.release)) throw new Error('Production recipe release is not accepted for batch production');
  if (lock.status !== 'LOCKED_FOR_FULL_BOOK_PREFLIGHT_ONLY') throw new Error('Production recipe lock is not in the expected preflight state');
  if (lock.guardrails?.productionArmed !== false || lock.guardrails?.fullBookGenerationArmed !== false) throw new Error('Batch production refuses an already-armed recipe');
  if (!lock.integrity?.recipeDigest || sha256(stableJson(recipeCore(lock))) !== lock.integrity.recipeDigest) throw new Error('Production recipe lock integrity digest mismatch');
  if (lock.localVoiceFinish?.id !== 'warm-slightly-deeper') throw new Error('Batch One requires the confirmed Warm + Slightly Deeper finish lock');
  return true;
}

export function verifyBookOneBatchPreflightSnapshot(preflight) {
  if (!preflight || preflight.artifact !== 'book-one-full-book-preflight') throw new Error('Batch production requires book-one-full-book-preflight.json');
  if (!BOOK_ONE_BATCH_ACCEPTED_PREFLIGHT_RELEASES.includes(preflight.release)) throw new Error('Full-book preflight release is not accepted for batch production');
  if (!['READY_FOR_EXPLICIT_FULL_BOOK_ARM', 'BLOCKED_NOT_READY_FOR_FULL_BOOK_ARM'].includes(preflight.status)) throw new Error('Full-book preflight status invalid');
  if (preflight.guardrails?.providerTtsCallsPerformed !== 0 || preflight.guardrails?.providerTtsSpendUsd !== 0) throw new Error('Full-book preflight must be zero-spend evidence');
  if (preflight.guardrails?.productionArmed !== false || preflight.guardrails?.fullBookGenerationArmed !== false) throw new Error('Full-book preflight must remain unarmed');
  if (!preflight.integrity?.preflightDigest || sha256(stableJson(preflightCore(preflight))) !== preflight.integrity.preflightDigest) throw new Error('Full-book preflight integrity digest mismatch');
  const nonQuotaBlockers = (preflight.blockers ?? []).filter((row) => row.id !== 'full-book-provider-quota');
  if (nonQuotaBlockers.length) throw new Error(`Batch production cannot bypass non-quota full-book blockers: ${nonQuotaBlockers.map((x) => x.id).join(', ')}`);
  return true;
}

function assertSourceAgreement({ productionPlan, recipeLock, preflight }) {
  verifyBookOneProductionPlan(productionPlan, { acceptedReleases: BOOK_ONE_BATCH_ACCEPTED_PLAN_RELEASES });
  verifyBookOneBatchRecipeSnapshot(recipeLock);
  verifyBookOneBatchPreflightSnapshot(preflight);
  if (recipeLock.source.productionPlanDigest !== productionPlan.integrity.productionPlanDigest) throw new Error('Recipe lock does not belong to production plan');
  if (preflight.recipe.productionPlanDigest !== productionPlan.integrity.productionPlanDigest) throw new Error('Full-book preflight does not belong to production plan');
  if (preflight.recipe.recipeDigest !== recipeLock.integrity.recipeDigest) throw new Error('Full-book preflight recipe digest mismatch');
  if (recipeLock.source.manuscriptSourceHash !== productionPlan.source.sourceHash || preflight.recipe.manuscriptSourceHash !== productionPlan.source.sourceHash) throw new Error('Manuscript source hash drifted between plan, recipe and preflight');
  return true;
}

export function buildBookOneDistributionOutputContract() {
  const acx = getDistributionProfile(BOOK_ONE_BATCH_ACX_PROFILE);
  const spotify = getDistributionProfile(BOOK_ONE_BATCH_SPOTIFY_PROFILE);
  const apple = getDistributionProfile('apple-partner-2026');
  const archive = getMasteringProfile(BOOK_ONE_BATCH_ARCHIVE_PROFILE);
  const acxMaster = getMasteringProfile(BOOK_ONE_BATCH_ACX_PROFILE);
  const spotifyMaster = getMasteringProfile(BOOK_ONE_BATCH_SPOTIFY_PROFILE);

  const base = {
    schemaVersion: 1,
    artifact: 'book-one-distribution-output-contract',
    policyDate: '2026-09-13',
    canonicalMaster: freeze({
      profile: archive.id,
      format: archive.output.format,
      codec: archive.output.codec,
      sampleRateHz: archive.output.sampleRateHz,
      bitDepth: archive.output.bitDepth,
      purpose: 'lossless source master used to derive current/future retailer encodes'
    }),
    sharedRetailChapterMaster: freeze({
      profile: acxMaster.id,
      format: acxMaster.output.format,
      bitrateKbps: acxMaster.output.bitrateKbps,
      sampleRateHz: acxMaster.output.sampleRateHz,
      cbr: Boolean(acxMaster.output.cbr),
      oneChapterOrSectionPerFile: true,
      spokenChapterOrSectionHeadingIncluded: true,
      maxDurationSec: 7200,
      edgeSilenceMs: acxMaster.edgeSilence,
      reuseForSpotifyWhenSpotifyQaPasses: true
    }),
    targets: freeze([
      freeze({
        id: 'direct-owned-2026',
        label: 'Direct Edition',
        route: 'direct-to-consumer-primary',
        chapterAsset: 'verified chapter MP3 plus lossless archive source; final chapterized M4B is created only after the full audiobook is complete',
        eligibility: 'PRIMARY_OWNED_CUSTOMER_RELATIONSHIP_CHANNEL',
        coreBusinessRule: 'Retailers give us reach. Direct gives us the relationship.',
        finalPackageRequirements: freeze(['complete audiobook', 'chapter MP3 package', 'chapterized M4B', 'cover art', 'metadata', 'direct entitlement record', 'verified purchase restore flow']),
        batchChapterFilesCanBeTechnicallyReady: true,
        finalSubmissionCompleteInBatch: false
      }),
      freeze({
        id: acx.id,
        label: acx.label,
        route: acx.route,
        chapterAsset: '192+ kbps CBR MP3 / 44.1 kHz / one chapter or section per file / <=120 minutes',
        eligibility: 'BLOCKED_UNLESS_ACX_AUDIBLE_EXPLICITLY_AUTHORIZES_DIGITAL_NARRATION',
        finalPackageRequirements: freeze(['opening credits', 'closing credits', 'retail sample <=5 minutes sourced from the audiobook', 'cover art', 'metadata', 'consistent mono/stereo', 'explicit ACX/Audible authorization for this digital narration route']),
        batchChapterFilesCanBeTechnicallyReady: true,
        finalSubmissionCompleteInBatch: false
      }),
      freeze({
        id: spotify.id,
        label: spotify.label,
        route: spotify.route,
        chapterAsset: 'MP3 192+ kbps (YasReady emits conservative 192 CBR / 44.1 kHz) / one chapter per file / <=120 minutes',
        eligibility: 'DIGITAL_NARRATION_ACCEPTED_WITH_DISCLOSURE',
        finalPackageRequirements: freeze(['opening/front matter audio', 'closing/back matter audio', 'sample file', 'square cover', 'title/author/narrator/language', 'audiobook ISBN-13 if supplied (must be unique to audiobook edition)', 'BISAC', 'territories', 'USD pricing', 'digital voice disclosure', 'consistent mono/stereo']),
        batchChapterFilesCanBeTechnicallyReady: true,
        finalSubmissionCompleteInBatch: false
      }),
      freeze({
        id: apple.id,
        label: apple.label,
        route: apple.route,
        chapterAsset: 'lossless 44.1 kHz / 24-bit WAV source master for preferred-partner handoff',
        eligibility: 'PREFERRED_PARTNER_AND_DIGITAL_NARRATION_POLICY_VALIDATION_REQUIRED',
        finalPackageRequirements: freeze(['preferred distribution partner', 'partner-specific audio/metadata validation', 'cover art', 'metadata', 'digital narration eligibility confirmed by selected partner/Apple route']),
        batchChapterFilesCanBeTechnicallyReady: false,
        finalSubmissionCompleteInBatch: false
      })
    ]),
    sources: freeze({
      acx: 'https://help.acx.com/s/article/what-are-the-acx-audio-submission-requirements',
      spotifyUpload: 'https://support.spotify.com/us/authors/article/uploading-audiobooks/',
      spotifyAlerts: 'https://support.spotify.com/us/authors/article/troubleshooting-audiobook-alerts/',
      spotifyDigitalVoice: 'https://support.spotify.com/us/authors/article/digital-voice-narration/',
      apple: 'https://itunespartner.apple.com/books/support/45-sell-audiobooks-apple-books'
    }),
    guardrails: freeze({
      retailerAcceptanceNeverInferredFromTechnicalEncode: true,
      applePartnerRulesRemainAuthoritative: true,
      acxDigitalNarrationEligibilityMustBeConfirmed: true,
      spotifyDigitalVoiceDisclosureRequired: true,
      directIsPrimaryCustomerRelationshipChannel: true,
      spokenChapterOrSectionHeadingRequiredForRetailerSafeMaster: true
    })
  };
  return freeze({ ...base, integrity: freeze({ contractDigest: sha256(stableJson(base)) }) });
}

function spokenChapterHeadingText(chapter) {
  const title = clean(chapter?.title);
  if (!title) throw new Error('Retailer-safe chapter production requires a spoken chapter/section heading');
  return /[.!?]$/.test(title) ? title : `${title}.`;
}

function chapterNewWork(chapter, reusableIds) {
  const chunks = chapter.chunks ?? [];
  const missing = chunks.filter((chunk) => !reusableIds.has(chunk.id));
  const headingText = spokenChapterHeadingText(chapter);
  const headingCharacters = headingText.length;
  return {
    headingText,
    headingCharacters,
    headingProviderCalls: 1,
    bodyNewProviderCharacters: missing.reduce((sum, chunk) => sum + Number(chunk.characters ?? 0), 0),
    bodyNewProviderCalls: missing.length,
    newProviderCharacters: headingCharacters + missing.reduce((sum, chunk) => sum + Number(chunk.characters ?? 0), 0),
    newProviderCalls: 1 + missing.length,
    reusableProviderCharacters: chunks.filter((chunk) => reusableIds.has(chunk.id)).reduce((sum, chunk) => sum + Number(chunk.characters ?? 0), 0),
    reusableProviderCalls: chunks.filter((chunk) => reusableIds.has(chunk.id)).length
  };
}

export function selectBookOneWholeChapterBatch({ productionPlan, providerRemaining, retryReserveRatio = BOOK_ONE_BATCH_RETRY_RESERVE_RATIO, reusableChunks = [], maxChapters = BOOK_ONE_BATCH_MAX_CHAPTERS } = {}) {
  verifyBookOneProductionPlan(productionPlan, { acceptedReleases: BOOK_ONE_BATCH_ACCEPTED_PLAN_RELEASES });
  const remaining = Number(providerRemaining);
  const reserveRatio = Number(retryReserveRatio);
  if (!Number.isFinite(remaining) || remaining < 0) throw new Error('Batch selection requires verified provider remaining quota');
  if (!(reserveRatio >= 0 && reserveRatio <= 1)) throw new Error('Batch retry reserve ratio must be between 0 and 1');
  const chapterCap = Number(maxChapters);
  if (!Number.isInteger(chapterCap) || chapterCap < 1) throw new Error('Batch maxChapters must be a positive integer');
  const reusableIds = new Set((reusableChunks ?? []).map((row) => row.id));
  const selected = [];
  let newChars = 0;
  let newCalls = 0;
  let reusedChars = 0;
  let reusedCalls = 0;

  for (const chapter of [...(productionPlan.manifest?.chapters ?? [])].sort((a,b) => a.order - b.order)) {
    if (selected.length >= chapterCap) break;
    const work = chapterNewWork(chapter, reusableIds);
    const candidateChars = newChars + work.newProviderCharacters;
    const candidateReserve = Math.ceil(candidateChars * reserveRatio);
    if (candidateChars + candidateReserve > remaining) break;
    selected.push(freeze({
      order: chapter.order,
      title: chapter.title,
      sourceTextHash: chapter.sourceTextHash,
      providerCharacters: chapter.providerCharacters,
      providerGenerationCalls: chapter.providerGenerationCalls,
      spokenChapterHeading: freeze({ text: work.headingText, characters: work.headingCharacters, providerCalls: work.headingProviderCalls }),
      narratedProviderCharacters: Number(chapter.providerCharacters ?? 0) + work.headingCharacters,
      narratedProviderGenerationCalls: Number(chapter.providerGenerationCalls ?? 0) + work.headingProviderCalls,
      bodyNewProviderCharacters: work.bodyNewProviderCharacters,
      bodyNewProviderCalls: work.bodyNewProviderCalls,
      newProviderCharacters: work.newProviderCharacters,
      newProviderCalls: work.newProviderCalls,
      reusableProviderCharacters: work.reusableProviderCharacters,
      reusableProviderCalls: work.reusableProviderCalls,
      chunkIds: freeze(chapter.chunks.map((chunk) => chunk.id)),
      generationDigests: freeze(chapter.chunks.map((chunk) => chunk.generationDigest))
    }));
    newChars = candidateChars;
    newCalls += work.newProviderCalls;
    reusedChars += work.reusableProviderCharacters;
    reusedCalls += work.reusableProviderCalls;
  }
  if (!selected.length) throw new Error('Live quota cannot safely fit even one complete chapter with retry reserve');
  const retryReserveCharacters = Math.ceil(newChars * reserveRatio);
  return freeze({
    wholeChaptersOnly: true,
    maxChapters: chapterCap,
    selectedChapters: freeze(selected),
    selectedChapterCount: selected.length,
    firstChapterOrder: selected[0].order,
    lastChapterOrder: selected.at(-1).order,
    newProviderCharacters: newChars,
    newProviderCalls: newCalls,
    reusableProviderCharacters: reusedChars,
    reusableProviderCalls: reusedCalls,
    retryReserveRatio: reserveRatio,
    retryReserveCharacters,
    quotaEnvelopeCharacters: newChars + retryReserveCharacters,
    providerRemainingAtSelection: remaining,
    quotaHeadroomAfterEnvelope: remaining - newChars - retryReserveCharacters
  });
}

function pilotResultCore(result) {
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

// Internal pilot reuse inspector that avoids requiring a preflight object.
export async function inspectBookOnePilotReuse({ productionPlan, recipeLock, pilotResult, pilotState, pilotRoot } = {}) {
  verifyBookOneProductionPlan(productionPlan, { acceptedReleases: BOOK_ONE_BATCH_ACCEPTED_PLAN_RELEASES });
  verifyBookOneBatchRecipeSnapshot(recipeLock);
  if (!pilotResult || pilotResult.artifact !== 'book-one-chapter-one-pilot-render') return freeze({ available:false, reason:'pilot result missing', reusableChunks:freeze([]), sourcePilotRenderDigest:null });
  if (!pilotResult.integrity?.renderDigest || sha256(stableJson(pilotResultCore(pilotResult))) !== pilotResult.integrity.renderDigest) throw new Error('Pilot result integrity digest mismatch');
  if (recipeLock.source.sourcePilotRenderDigest !== pilotResult.integrity.renderDigest) throw new Error('Pilot result does not match the production recipe source pilot');
  if (!pilotState || pilotState.artifact !== 'book-one-chapter-one-pilot-state') throw new Error('Pilot state missing or invalid');
  if (pilotState.armDigest !== pilotResult.armDigest) throw new Error('Pilot state arm digest mismatch');
  const first = [...productionPlan.manifest.chapters].sort((a,b)=>a.order-b.order)[0];
  if (!first) return freeze({ available:false, reason:'production plan has no chapters', reusableChunks:freeze([]), sourcePilotRenderDigest:pilotResult.integrity.renderDigest });
  const reusable = [];
  for (const chunk of first.chunks ?? []) {
    const row = pilotState.chunks?.[chunk.id];
    if (!row || row.generationDigest !== chunk.generationDigest || !row.providerRelativePath || !row.audioSha256) continue;
    if (!['PROVIDER_COMPLETE','TEMPO_COMPLETE','COMPLETE','LOCAL_TEMPO_FAILED_SAFE_TO_RERUN'].includes(row.status)) continue;
    const providerPath = path.join(path.resolve(pilotRoot), row.providerRelativePath);
    if (!(await exists(providerPath))) continue;
    const actual = await fileDigest(providerPath);
    if (actual !== row.audioSha256) throw new Error(`Pilot paid audio digest mismatch for ${chunk.id}; refuse reuse`);
    reusable.push(freeze({ id:chunk.id, generationDigest:chunk.generationDigest, audioSha256:actual, characters:chunk.characters, sourceProviderPath:providerPath }));
  }
  return freeze({
    available: reusable.length > 0,
    reason: reusable.length ? null : 'no verified paid pilot chunks found',
    sourcePilotRenderDigest: pilotResult.integrity.renderDigest,
    chapterOrder: first.order,
    reusableChunks: freeze(reusable),
    reusableCharacters: reusable.reduce((sum,row)=>sum+Number(row.characters??0),0),
    reusableCalls: reusable.length
  });
}

async function defaultStorageProbe(root) {
  const resolved = path.resolve(root);
  await mkdir(resolved, { recursive:true });
  const stats = await statfs(resolved);
  const availableBytes = Number(stats.bsize) * Number(stats.bavail ?? stats.bfree);
  return freeze({ root:resolved, availableBytes, availableGiB:gib(availableBytes) });
}

function armCore(arm) {
  return {
    schemaVersion: arm.schemaVersion,
    release: arm.release,
    artifact: arm.artifact,
    status: arm.status,
    book: arm.book,
    source: arm.source,
    liveProvider: arm.liveProvider,
    batchScope: arm.batchScope,
    budget: arm.budget,
    storage: arm.storage,
    outputContract: arm.outputContract,
    pilotReuse: arm.pilotReuse,
    guardrails: arm.guardrails
  };
}

export function verifyBookOneQuotaAwareBatchArm(arm) {
  if (!arm || arm.artifact !== 'book-one-quota-aware-batch-arm') throw new Error('Invalid quota-aware batch arm');
  if (arm.release !== YASREADY_AUDIOBOOKS_VERSION) throw new Error('Batch arm release mismatch');
  if (arm.status !== 'ARMED_FOR_EXACT_BATCH_ONLY') throw new Error('Batch arm status invalid');
  if (arm.guardrails?.batchArmed !== true || arm.guardrails?.fullBookGenerationArmed !== false) throw new Error('Batch arm scope guardrails invalid');
  if (arm.guardrails?.armProviderTtsCalls !== 0 || arm.guardrails?.armProviderTtsSpendUsd !== 0) throw new Error('Batch arm must be zero-TTS and zero-spend');
  const selectedCount = Number(arm.batchScope?.selectedChapterCount);
  const declaredCap = Number(arm.batchScope?.maxChapters);
  if (!Number.isInteger(selectedCount) || selectedCount < 1 || selectedCount > BOOK_ONE_BATCH_MAX_CHAPTERS) throw new Error('Batch arm selected chapter count exceeds the bounded safety cap');
  if (!Number.isInteger(declaredCap) || declaredCap < 1 || declaredCap > BOOK_ONE_BATCH_MAX_CHAPTERS || selectedCount > declaredCap) throw new Error('Batch arm chapter cap is invalid');
  if (arm.guardrails?.maxChaptersPerBatch !== BOOK_ONE_BATCH_MAX_CHAPTERS) throw new Error('Batch arm maximum chapter guardrail drifted');
  if (arm.guardrails?.spokenChapterHeadingRequired !== true || arm.batchScope?.chapters?.some((chapter) => !chapter.spokenChapterHeading?.generationDigest)) throw new Error('Batch arm spoken chapter heading contract is incomplete');
  if (!arm.integrity?.armDigest || sha256(stableJson(armCore(arm))) !== arm.integrity.armDigest) throw new Error('Batch arm integrity digest mismatch');
  if (arm.confirmation?.token !== `BATCH-${arm.integrity.armDigest.slice(0,10).toUpperCase()}`) throw new Error('Batch approval token mismatch');
  if (!(Number(arm.budget?.protectedMaxUsd) >= Number(arm.budget?.initialGenerationUsd))) throw new Error('Batch budget protection invalid');
  return true;
}

export async function buildBookOneQuotaAwareBatchArm({
  productionPlan,
  recipeLock,
  preflight,
  provider,
  ffmpeg,
  outputRoot,
  pilotReuse = null,
  retryReserveRatio = BOOK_ONE_BATCH_RETRY_RESERVE_RATIO,
  storageProbe = defaultStorageProbe
} = {}) {
  assertSourceAgreement({ productionPlan, recipeLock, preflight });
  if (!provider?.healthCheck || !provider?.subscriptionPreflight) throw new Error('Batch arm requires provider health + subscription preflight support');
  if (!ffmpeg?.healthCheck) throw new Error('Batch arm requires FFmpeg health support');
  if (!outputRoot) throw new Error('Batch arm requires an output root');
  const providerHealth = await provider.healthCheck();
  if (!providerHealth?.ok) throw new Error(`Provider health failed before batch arm: ${providerHealth?.reason ?? providerHealth?.status ?? 'unknown'}`);
  const subscription = await provider.subscriptionPreflight();
  if (!subscription?.available || !subscription?.safeToContinue || !subscription.subscription) throw new Error(`Live provider quota is required before batch arm (${subscription?.reason ?? 'unavailable'})`);
  const quota = extractElevenLabsQuota(subscription.subscription);
  const reusable = pilotReuse?.available ? pilotReuse.reusableChunks : [];
  const selection = selectBookOneWholeChapterBatch({ productionPlan, providerRemaining:quota.providerReportedRemaining, retryReserveRatio, reusableChunks:reusable });
  const ffmpegHealth = await ffmpeg.healthCheck();
  if (!ffmpegHealth?.ok) throw new Error(`FFmpeg preflight failed before batch arm: ${ffmpegHealth?.reason ?? 'unknown'}`);
  const disk = await storageProbe(outputRoot);
  const fullChars = Number(productionPlan.manifest.providerCharacters || 1);
  const selectedAllChars = selection.selectedChapters.reduce((sum,ch)=>sum+Number(ch.providerCharacters||0),0);
  const fullRequiredGiB = Number(preflight.storage?.requiredGiB ?? 5);
  const requiredGiB = Math.max(BOOK_ONE_BATCH_MIN_STORAGE_GIB, round((selectedAllChars/fullChars)*fullRequiredGiB + 0.5, 3));
  if (Number(disk.availableGiB ?? gib(disk.availableBytes)) < requiredGiB) throw new Error(`Insufficient local storage for Batch One: ${requiredGiB} GiB required, ${Number(disk.availableGiB ?? gib(disk.availableBytes)).toFixed(3)} GiB available`);
  const rate = Number(productionPlan.budget.rateUsdPer1kCharacters);
  const initialGenerationUsd = round((selection.newProviderCharacters/1000)*rate,6);
  const retryReserveUsd = round(initialGenerationUsd*Number(retryReserveRatio),6);
  const protectedMaxUsd = ceilCents(initialGenerationUsd+retryReserveUsd);
  const outputContract = buildBookOneDistributionOutputContract();
  const scopedChapters = freeze(selection.selectedChapters.map((chapter) => {
    const headingText = chapter.spokenChapterHeading.text;
    const headingId = `ch${String(chapter.order + 1).padStart(2, '0')}-heading`;
    const textDigest = sha256(headingText);
    const generationDigest = sha256(stableJson({
      kind: 'spoken-chapter-heading-v1',
      productionPlanDigest: productionPlan.integrity.productionPlanDigest,
      recipeDigest: recipeLock.integrity.recipeDigest,
      manuscriptSourceHash: productionPlan.source.sourceHash,
      chapterOrder: chapter.order,
      chapterTitle: chapter.title,
      headingId,
      textDigest,
      provider: recipeLock.narrator.provider,
      model: recipeLock.provider.model,
      voiceId: recipeLock.narrator.voiceId,
      voiceSettings: recipeLock.provider.voiceSettings,
      pace: recipeLock.pace,
      localVoiceFinishDigest: recipeLock.source.localVoiceFinishDigest
    }));
    const heading = freeze({ ...chapter.spokenChapterHeading, id: headingId, textDigest, generationDigest });
    return freeze({
      ...chapter,
      spokenChapterHeading: heading,
      chunkIds: freeze([headingId, ...(chapter.chunkIds ?? [])]),
      generationDigests: freeze([generationDigest, ...(chapter.generationDigests ?? [])])
    });
  }));
  const pilotSnapshot = pilotReuse?.available ? freeze({
    available:true,
    sourcePilotRenderDigest:pilotReuse.sourcePilotRenderDigest,
    reusableCalls:pilotReuse.reusableCalls,
    reusableCharacters:pilotReuse.reusableCharacters,
    chunks:freeze(pilotReuse.reusableChunks.map((row)=>freeze({id:row.id,generationDigest:row.generationDigest,audioSha256:row.audioSha256,characters:row.characters})))
  }) : freeze({available:false,sourcePilotRenderDigest:recipeLock.source.sourcePilotRenderDigest,reusableCalls:0,reusableCharacters:0,chunks:freeze([])});

  const base = {
    schemaVersion:1,
    release:YASREADY_AUDIOBOOKS_VERSION,
    artifact:'book-one-quota-aware-batch-arm',
    status:'ARMED_FOR_EXACT_BATCH_ONLY',
    book:productionPlan.book,
    source:freeze({
      productionPlanRelease:productionPlan.release,
      productionPlanDigest:productionPlan.integrity.productionPlanDigest,
      recipeRelease:recipeLock.release,
      recipeDigest:recipeLock.integrity.recipeDigest,
      preflightRelease:preflight.release,
      preflightDigest:preflight.integrity.preflightDigest,
      manuscriptSourceHash:productionPlan.source.sourceHash,
      localVoiceFinishDigest:recipeLock.source.localVoiceFinishDigest
    }),
    liveProvider:freeze({
      checkedAt:new Date().toISOString(),
      tier:quota.tier,
      status:quota.status,
      providerReportedUsed:quota.providerReportedUsed,
      providerReportedLimit:quota.providerReportedLimit,
      providerReportedRemaining:quota.providerReportedRemaining,
      creditsInferred:false,
      providerTtsCallsPerformed:0
    }),
    batchScope:freeze({
      ordinal:1,
      wholeChaptersOnly:true,
      maxChapters:selection.maxChapters,
      selectedChapterCount:selection.selectedChapterCount,
      firstChapterOrder:selection.firstChapterOrder,
      lastChapterOrder:selection.lastChapterOrder,
      chapters:scopedChapters,
      newProviderCharacters:selection.newProviderCharacters,
      newProviderCalls:selection.newProviderCalls,
      reusableProviderCharacters:selection.reusableProviderCharacters,
      reusableProviderCalls:selection.reusableProviderCalls,
      retryReserveCharacters:selection.retryReserveCharacters,
      quotaEnvelopeCharacters:selection.quotaEnvelopeCharacters,
      quotaHeadroomAfterEnvelope:selection.quotaHeadroomAfterEnvelope
    }),
    budget:freeze({currency:'USD',rateUsdPer1kCharacters:rate,initialGenerationUsd,retryReserveRatio:Number(retryReserveRatio),retryReserveUsd,protectedMaxUsd,estimateNotInvoice:true,localProcessingUsd:0}),
    storage:freeze({root:path.resolve(outputRoot),requiredGiB,availableGiB:Number(disk.availableGiB ?? gib(disk.availableBytes)),passed:true}),
    outputContract,
    pilotReuse:pilotSnapshot,
    guardrails:freeze({
      batchArmed:true,
      armProviderTtsCalls:0,
      armProviderTtsSpendUsd:0,
      exactBatchTokenRequired:true,
      exactProtectedMaxBound:true,
      liveQuotaRecheckAtRender:true,
      maxChaptersPerBatch:BOOK_ONE_BATCH_MAX_CHAPTERS,
      wholeChapterBoundaryRequired:true,
      spokenChapterHeadingRequired:true,
      chaptersOutsideBatchBlocked:true,
      automaticNextBatch:false,
      productionArmed:false,
      fullBookGenerationArmed:false,
      acxEligibilityNotAssumed:true,
      applePartnerAcceptanceNotAssumed:true
    })
  };
  const armDigest=sha256(stableJson(armCore(base)));
  const arm=freeze({...base,integrity:freeze({armDigest}),confirmation:freeze({token:`BATCH-${armDigest.slice(0,10).toUpperCase()}`,semantics:'EXACT_BATCH_SPEND_AUTHORIZATION_ONLY',protectedMaxUsd}),nextAction:`Type the exact BATCH token to authorize only these ${selection.selectedChapterCount} whole chapter(s) up to $${protectedMaxUsd.toFixed(2)}. Full-book generation remains off.`});
  verifyBookOneQuotaAwareBatchArm(arm);
  return arm;
}

function materializeBatchTexts({ productionPlan, manuscriptAnalysis, arm }) {
  if (!manuscriptAnalysis?.source?.sourceHash || manuscriptAnalysis.source.sourceHash !== productionPlan.source.sourceHash) throw new Error('Batch manuscript source hash does not match production plan');
  const cap=Number(productionPlan.manifest.maxCharactersPerProviderCall);
  const out=[];
  for(const selected of arm.batchScope.chapters){
    const planned=(productionPlan.manifest.chapters??[]).find((ch)=>ch.order===selected.order);
    const chapter=manuscriptAnalysis.chapters?.[selected.order];
    if(!planned||!chapter) throw new Error(`Selected chapter ${selected.order} is missing from plan/manuscript`);
    if(planned.sourceTextHash && planned.sourceTextHash!==chapter.textHash) throw new Error(`Chapter source hash drifted: ${planned.title}`);
    const heading = selected.spokenChapterHeading;
    const expectedHeadingText = spokenChapterHeadingText(planned);
    if (!heading || heading.text !== expectedHeadingText || heading.textDigest !== sha256(expectedHeadingText)) throw new Error(`Spoken chapter heading drifted: ${planned.title}`);
    const rebuilt=[freeze({
      id: heading.id,
      chapterOrder: planned.order,
      sceneOrder: -1,
      sceneChunkOrder: 0,
      characters: heading.characters,
      words: 0,
      textDigest: heading.textDigest,
      generationDigest: heading.generationDigest,
      kind: 'spoken-chapter-heading',
      text: heading.text
    })];
    let bodyChunkCount=0;
    for(let sceneIndex=0;sceneIndex<chapter.scenes.length;sceneIndex+=1){
      const text=(chapter.scenes[sceneIndex].segments??[]).map((s)=>clean(s.text)).filter(Boolean).join('\n');
      if(!text) continue;
      const chunks=splitForTts(text,{maxChars:cap});
      for(let sceneChunkIndex=0;sceneChunkIndex<chunks.length;sceneChunkIndex+=1){
        const chunkText=chunks[sceneChunkIndex];
        const id=`ch${String(selected.order+1).padStart(2,'0')}-sc${String(sceneIndex+1).padStart(2,'0')}-c${String(sceneChunkIndex+1).padStart(2,'0')}`;
        const p=(planned.chunks??[]).find((x)=>x.id===id);
        if(!p) throw new Error(`Materialized chunk not present in production plan: ${id}`);
        if(sha256(chunkText)!==p.textDigest) throw new Error(`Materialized text digest mismatch: ${id}`);
        rebuilt.push(freeze({...p,text:chunkText,kind:'chapter-body'}));
        bodyChunkCount += 1;
      }
    }
    if(bodyChunkCount!==(planned.chunks??[]).length) throw new Error(`Chapter body chunk count mismatch for ${planned.title}`);
    out.push(freeze({chapter:planned,chunks:freeze(rebuilt)}));
  }
  return freeze(out);
}

async function loadBatchState(file, arm) {
  if(!(await exists(file))) return {schemaVersion:1,release:YASREADY_AUDIOBOOKS_VERSION,artifact:'book-one-batch-production-state',armDigest:arm.integrity.armDigest,productionPlanDigest:arm.source.productionPlanDigest,chunks:{},chapters:{},createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
  const state=JSON.parse(await readFile(file,'utf8'));
  if(state.armDigest!==arm.integrity.armDigest||state.productionPlanDigest!==arm.source.productionPlanDigest) throw new Error('Existing batch state belongs to a different arm/plan');
  return state;
}
async function persistState(file,state){state.updatedAt=new Date().toISOString();await writeFile(file,JSON.stringify(state,null,2));}
function safeProviderFailure(error){
  if(error?.name!=='ElevenLabsApiError') return false;
  const status=Number(error?.status);
  if(!Number.isInteger(status)) return false;
  // Deterministic client/rate-limit responses are safe to retry because no durable audio was returned.
  // Timeouts and 5xx responses are deliberately treated as UNKNOWN to prevent accidental double spend.
  if(status===408 || status>=500) return false;
  return status>=400 && status<500;
}
function isProviderReady(row,file){return row&&['PROVIDER_COMPLETE','PROVIDER_COMPLETE_IMPORTED_PILOT','LOCAL_TEMPO_FAILED_SAFE_TO_RERUN','TEMPO_COMPLETE','LOCAL_FINISH_FAILED_SAFE_TO_RERUN','FINISH_COMPLETE','COMPLETE'].includes(row.status)&&file;}

function resultCore(result){return{schemaVersion:result.schemaVersion,release:result.release,artifact:result.artifact,status:result.status,book:result.book,armDigest:result.armDigest,recipeDigest:result.recipeDigest,batch:result.batch,provider:result.provider,cost:result.cost,chapters:result.chapters,distribution:result.distribution,guardrails:result.guardrails};}
export function verifyBookOneBatchProductionResult(result){
  if(!result||result.artifact!=='book-one-batch-production-result')throw new Error('Invalid batch production result');
  if(result.release!==YASREADY_AUDIOBOOKS_VERSION)throw new Error('Batch production result release mismatch');
  if(!['READY_FOR_HUMAN_BATCH_REVIEW','TECHNICAL_QA_REVIEW_REQUIRED'].includes(result.status))throw new Error('Batch production result status invalid');
  if(result.guardrails?.fullBookGenerationArmed!==false||result.guardrails?.nextBatchArmed!==false)throw new Error('Batch result cannot arm the rest of the book');
  if(!result.integrity?.resultDigest||sha256(stableJson(resultCore(result)))!==result.integrity.resultDigest)throw new Error('Batch production result integrity digest mismatch');
  return true;
}

export async function renderBookOneQuotaAwareBatch({
  productionPlan,
  recipeLock,
  preflight,
  arm,
  manuscriptAnalysis,
  provider,
  ffmpeg,
  outputRoot,
  approvalToken,
  maxUsd,
  pilotReuse=null
}={}){
  assertSourceAgreement({productionPlan,recipeLock,preflight});
  verifyBookOneQuotaAwareBatchArm(arm);
  if(arm.source.productionPlanDigest!==productionPlan.integrity.productionPlanDigest||arm.source.recipeDigest!==recipeLock.integrity.recipeDigest)throw new Error('Batch arm source digest mismatch');
  if(approvalToken!==arm.confirmation.token)throw new Error('Exact BATCH approval token required');
  const cap=Number(maxUsd);
  if(!Number.isFinite(cap)||Math.abs(cap-Number(arm.budget.protectedMaxUsd))>1e-9)throw new Error(`Batch max USD must exactly equal protected max $${Number(arm.budget.protectedMaxUsd).toFixed(2)}`);
  if(!provider?.render||!provider?.subscriptionPreflight||!provider?.healthCheck)throw new Error('Batch render requires provider render + live quota support');
  if(!ffmpeg?.healthCheck||!ffmpeg?.tempo||!ffmpeg?.voiceDepth||!ffmpeg?.concat||!ffmpeg?.master||!ffmpeg?.analyze)throw new Error('Batch render requires complete FFmpeg production support');
  const ffmpegHealth=await ffmpeg.healthCheck();if(!ffmpegHealth?.ok)throw new Error(`FFmpeg failed before paid batch work: ${ffmpegHealth?.reason??'unknown'}`);
  const providerHealth=await provider.healthCheck();if(!providerHealth?.ok)throw new Error(`Provider health failed before paid batch work: ${providerHealth?.reason??providerHealth?.status??'unknown'}`);
  const sub=await provider.subscriptionPreflight();if(!sub?.available||!sub?.safeToContinue||!sub.subscription)throw new Error('Live provider quota recheck failed before batch render');
  const quota=extractElevenLabsQuota(sub.subscription);

  const materialized=materializeBatchTexts({productionPlan,manuscriptAnalysis,arm});
  const root=path.resolve(outputRoot);await mkdir(root,{recursive:true});
  const dirs={provider:path.join(root,'provider'),tempo:path.join(root,'tempo'),finish:path.join(root,'finish'),assembly:path.join(root,'assembly'),archive:path.join(root,'distribution','archive-wav'),acx:path.join(root,'distribution','acx-audible'),spotify:path.join(root,'distribution','spotify'),apple:path.join(root,'distribution','apple-preferred-partner'),qa:path.join(root,'qa')};
  await Promise.all(Object.values(dirs).map((d)=>mkdir(d,{recursive:true})));
  const statePath=path.join(root,'batch-one-production-state.json');
  const state=await loadBatchState(statePath,arm);
  const pilotMap=new Map((pilotReuse?.available?pilotReuse.reusableChunks:[]).map((row)=>[row.id,row]));
  if (Number(arm.batchScope.reusableProviderCalls ?? 0) > 0) {
    if (!pilotReuse?.available) throw new Error('Batch arm depends on verified paid pilot reuse; refusing to repurchase those chunks');
    for (const snapshot of arm.pilotReuse?.chunks ?? []) {
      const runtime = pilotMap.get(snapshot.id);
      if (!runtime) throw new Error(`Batch arm paid-pilot reuse chunk is unavailable: ${snapshot.id}`);
      if (runtime.generationDigest !== snapshot.generationDigest || runtime.audioSha256 !== snapshot.audioSha256) {
        throw new Error(`Batch arm paid-pilot reuse evidence drifted: ${snapshot.id}`);
      }
    }
  }
  const allChunks=materialized.flatMap((row)=>row.chunks);
  const missingNewChars=allChunks.filter((chunk)=>{
    const row=state.chunks[chunk.id];
    return !row||!['PROVIDER_COMPLETE','PROVIDER_COMPLETE_IMPORTED_PILOT','LOCAL_TEMPO_FAILED_SAFE_TO_RERUN','TEMPO_COMPLETE','LOCAL_FINISH_FAILED_SAFE_TO_RERUN','FINISH_COMPLETE','COMPLETE'].includes(row.status);
  }).filter((chunk)=>!pilotMap.has(chunk.id)).reduce((sum,chunk)=>sum+Number(chunk.characters||0),0);
  const remainingRetryReserveCharacters=Math.ceil(missingNewChars*Number(arm.budget.retryReserveRatio??BOOK_ONE_BATCH_RETRY_RESERVE_RATIO));
  const remainingQuotaEnvelope=missingNewChars+remainingRetryReserveCharacters;
  if(quota.providerReportedRemaining<remainingQuotaEnvelope)throw new Error(`Live provider quota is insufficient for remaining Batch One work plus retry reserve: ${quota.providerReportedRemaining} remaining, ${missingNewChars} work + ${remainingRetryReserveCharacters} reserve required`);

  let providerCallsThisRun=0, importedPilotCallsThisRun=0, localTempoThisRun=0, localFinishThisRun=0;
  const requests=[];
  const retailerSequenceByChapterOrder = new Map(
    [...(productionPlan.manifest?.chapters ?? [])].sort((a,b)=>a.order-b.order).map((chapter,index)=>[chapter.order,index+1])
  );
  for(const chapterPack of materialized){
    const finalChunkPaths=[];
    for(const chunk of chapterPack.chunks){
      const providerDir=path.join(dirs.provider,`chapter-${String(chapterPack.chapter.order+1).padStart(2,'0')}`);const tempoDir=path.join(dirs.tempo,`chapter-${String(chapterPack.chapter.order+1).padStart(2,'0')}`);const finishDir=path.join(dirs.finish,`chapter-${String(chapterPack.chapter.order+1).padStart(2,'0')}`);await Promise.all([mkdir(providerDir,{recursive:true}),mkdir(tempoDir,{recursive:true}),mkdir(finishDir,{recursive:true})]);
      const providerPath=path.join(providerDir,`${chunk.id}.mp3`),tempoPath=path.join(tempoDir,`${chunk.id}.mp3`),finishPath=path.join(finishDir,`${chunk.id}.wav`);
      let row=state.chunks[chunk.id]??{id:chunk.id,generationDigest:chunk.generationDigest,textDigest:chunk.textDigest,status:'PLANNED'};
      if(row.generationDigest!==chunk.generationDigest)throw new Error(`Existing batch state generation digest mismatch for ${chunk.id}`);
      const providerSettledStates=['PROVIDER_COMPLETE','PROVIDER_COMPLETE_IMPORTED_PILOT','LOCAL_TEMPO_FAILED_SAFE_TO_RERUN','TEMPO_COMPLETE','LOCAL_FINISH_FAILED_SAFE_TO_RERUN','FINISH_COMPLETE','COMPLETE'];
      const providerExists=await exists(providerPath);
      let providerReady=isProviderReady(row,providerExists);
      const seed=pilotMap.get(chunk.id);
      if(providerSettledStates.includes(row.status)&&!providerExists){
        if(row.historicalPaidProviderReuse&&seed){
          if(!(await exists(seed.sourceProviderPath))||(await fileDigest(seed.sourceProviderPath))!==seed.audioSha256)throw new Error(`Pilot reuse recovery source is unavailable or corrupt for ${chunk.id}`);
          await copyFile(seed.sourceProviderPath,providerPath);
          row={...row,audioSha256:await fileDigest(providerPath),audioBytes:(await stat(providerPath)).size};
          state.chunks[chunk.id]=row;await persistState(statePath,state);providerReady=true;
        }else{
          throw new Error(`DO NOT RERUN PROVIDER: paid provider audio is missing for ${chunk.id}; recover the settled response before continuing`);
        }
      }
      if(providerReady&&!row.audioSha256)throw new Error(`DO NOT RERUN PROVIDER: stored paid audio for ${chunk.id} has no recorded digest`);
      if(providerReady&&(await fileDigest(providerPath))!==row.audioSha256)throw new Error(`DO NOT RERUN PROVIDER: stored paid audio digest mismatch for ${chunk.id}`);
      if(!providerReady){
        if(seed){
          if(seed.generationDigest!==chunk.generationDigest)throw new Error(`Pilot reuse generation digest mismatch for ${chunk.id}`);
          if(!(await exists(seed.sourceProviderPath)))throw new Error(`Pilot reuse source audio missing for ${chunk.id}`);
          if((await fileDigest(seed.sourceProviderPath))!==seed.audioSha256)throw new Error(`Pilot reuse source digest mismatch for ${chunk.id}`);
          await copyFile(seed.sourceProviderPath,providerPath);
          row={...row,status:'PROVIDER_COMPLETE_IMPORTED_PILOT',providerRelativePath:path.relative(root,providerPath),audioSha256:await fileDigest(providerPath),audioBytes:(await stat(providerPath)).size,billedCharacters:0,capturedOrEstimatedBilledUsd:0,billingBasis:'historical-paid-pilot-reuse',historicalPaidProviderReuse:true};
          state.chunks[chunk.id]=row;await persistState(statePath,state);importedPilotCallsThisRun+=1;providerReady=true;
        }else{
          if(['PROVIDER_IN_FLIGHT','PROVIDER_RESULT_UNKNOWN_DO_NOT_RERUN'].includes(row.status))throw new Error(`DO NOT RERUN PROVIDER: ${chunk.id} has unresolved provider outcome`);
          const estimate=round((Number(chunk.characters)/1000)*Number(arm.budget.rateUsdPer1kCharacters),6);
          const captured=Object.values(state.chunks).reduce((sum,x)=>sum+Number(x?.capturedOrEstimatedBilledUsd??0),0);
          if(captured+estimate>cap+1e-9)throw new Error(`Batch Money Guard would exceed approved max $${cap.toFixed(2)} before ${chunk.id}`);
          row={...row,status:'PROVIDER_IN_FLIGHT',providerStartedAt:new Date().toISOString()};state.chunks[chunk.id]=row;await persistState(statePath,state);
          let rendered;
          try{rendered=await provider.render({voiceId:recipeLock.narrator.voiceId,text:chunk.text,model:recipeLock.provider.model,outputFormat:'mp3_44100_128',voiceSettings:recipeLock.provider.voiceSettings});}
          catch(error){row.status=safeProviderFailure(error)?'PROVIDER_FAILED_SAFE_TO_RETRY':'PROVIDER_RESULT_UNKNOWN_DO_NOT_RERUN';row.error=error?.message??String(error);state.chunks[chunk.id]=row;await persistState(statePath,state);if(row.status==='PROVIDER_RESULT_UNKNOWN_DO_NOT_RERUN')throw new Error(`DO NOT RERUN PROVIDER: ${chunk.id} outcome unknown after provider call: ${row.error}`);throw error;}
          const audio=rendered?.audio;if(!(audio instanceof Uint8Array)||audio.byteLength<1){row.status='PROVIDER_RESULT_UNKNOWN_DO_NOT_RERUN';row.error='Provider returned no durable audio bytes';state.chunks[chunk.id]=row;await persistState(statePath,state);throw new Error(`DO NOT RERUN PROVIDER: ${chunk.id} returned no durable audio bytes`);}
          try{await writeFile(providerPath,audio);}catch(error){throw new Error(`DO NOT RERUN PROVIDER: provider succeeded for ${chunk.id} but local storage failed: ${error?.message??error}`);}
          const estimated=Number(rendered.estimatedCostUsd);const fallback=round((Number(rendered.billedCharacters??chunk.characters)/1000)*Number(arm.budget.rateUsdPer1kCharacters),6);
          row={...row,status:'PROVIDER_COMPLETE',providerCompletedAt:new Date().toISOString(),providerRelativePath:path.relative(root,providerPath),audioSha256:await fileDigest(providerPath),audioBytes:audio.byteLength,requestId:rendered.requestId??null,billedCharacters:Number(rendered.billedCharacters??chunk.characters),capturedOrEstimatedBilledUsd:Number.isFinite(estimated)?estimated:fallback,billingBasis:Number.isFinite(estimated)?'provider-returned-estimate':'planning-rate-fallback'};
          state.chunks[chunk.id]=row;await persistState(statePath,state);providerCallsThisRun+=1;if(rendered.requestId)requests.push(rendered.requestId);
        }
      }
      let tempoReady=['TEMPO_COMPLETE','LOCAL_FINISH_FAILED_SAFE_TO_RERUN','FINISH_COMPLETE','COMPLETE'].includes(row.status)&&await exists(tempoPath);
      if(tempoReady&&(!row.tempoAudioSha256||(await fileDigest(tempoPath))!==row.tempoAudioSha256))tempoReady=false;
      if(!tempoReady){try{await ffmpeg.tempo(providerPath,tempoPath,Number(recipeLock.pace.postProcessTempoMultiplier));}catch(error){row.status='LOCAL_TEMPO_FAILED_SAFE_TO_RERUN';row.localError=error?.message??String(error);state.chunks[chunk.id]=row;await persistState(statePath,state);throw error;}row.status='TEMPO_COMPLETE';row.tempoRelativePath=path.relative(root,tempoPath);row.tempoAudioSha256=await fileDigest(tempoPath);state.chunks[chunk.id]=row;await persistState(statePath,state);localTempoThisRun+=1;}
      let finishReady=['FINISH_COMPLETE','COMPLETE'].includes(row.status)&&await exists(finishPath);
      if(finishReady&&(!row.finishAudioSha256||(await fileDigest(finishPath))!==row.finishAudioSha256))finishReady=false;
      if(!finishReady){try{await ffmpeg.voiceDepth(tempoPath,finishPath,{mode:recipeLock.localVoiceFinish.id});}catch(error){row.status='LOCAL_FINISH_FAILED_SAFE_TO_RERUN';row.localError=error?.message??String(error);state.chunks[chunk.id]=row;await persistState(statePath,state);throw error;}row.status='FINISH_COMPLETE';row.finishRelativePath=path.relative(root,finishPath);row.finishAudioSha256=await fileDigest(finishPath);state.chunks[chunk.id]=row;await persistState(statePath,state);localFinishThisRun+=1;}
      finalChunkPaths.push(finishPath);
    }
    const retailerSequence=retailerSequenceByChapterOrder.get(chapterPack.chapter.order);
    if(!retailerSequence)throw new Error(`Retailer chapter sequence is missing for ${chapterPack.chapter.title}`);
    const baseName=safeSectionFileName(retailerSequence,chapterPack.chapter.title,'wav').replace(/\.wav$/,'');
    const assemblyPath=path.join(dirs.assembly,`${baseName}-assembly.wav`);await ffmpeg.concat(finalChunkPaths,assemblyPath);
    const archivePath=path.join(dirs.archive,`${baseName}.wav`);await ffmpeg.master(assemblyPath,archivePath,BOOK_ONE_BATCH_ARCHIVE_PROFILE);
    const acxPath=path.join(dirs.acx,`${baseName}.mp3`);await ffmpeg.master(assemblyPath,acxPath,BOOK_ONE_BATCH_ACX_PROFILE);
    const spotifyPath=path.join(dirs.spotify,`${baseName}.mp3`);await copyFile(acxPath,spotifyPath);
    const applePath=path.join(dirs.apple,`${baseName}.wav`);await copyFile(archivePath,applePath);
    const [archiveAnalysis,acxAnalysis,spotifyAnalysis]=await Promise.all([ffmpeg.analyze(archivePath),ffmpeg.analyze(acxPath),ffmpeg.analyze(spotifyPath)]);
    const archiveQa=evaluateMasterAgainstProfile(archiveAnalysis,BOOK_ONE_BATCH_ARCHIVE_PROFILE);const acxQa=evaluateMasterAgainstProfile(acxAnalysis,BOOK_ONE_BATCH_ACX_PROFILE);const spotifyQa=evaluateMasterAgainstProfile(spotifyAnalysis,BOOK_ONE_BATCH_SPOTIFY_PROFILE);
    const chapterScope=arm.batchScope.chapters.find((row)=>row.order===chapterPack.chapter.order);const chapterResult={order:chapterPack.chapter.order,retailerSequence,title:chapterPack.chapter.title,spokenChapterHeading:chapterScope?.spokenChapterHeading?.text??null,providerCharacters:chapterScope?.narratedProviderCharacters??chapterPack.chapter.providerCharacters,providerGenerationCalls:chapterScope?.narratedProviderGenerationCalls??chapterPack.chapter.providerGenerationCalls,outputs:{archiveWav:path.relative(root,archivePath),acxMp3:path.relative(root,acxPath),spotifyMp3:path.relative(root,spotifyPath),applePartnerWav:path.relative(root,applePath)},digests:{archiveWav:await fileDigest(archivePath),acxMp3:await fileDigest(acxPath),spotifyMp3:await fileDigest(spotifyPath),applePartnerWav:await fileDigest(applePath)},qa:{archive:archiveQa,acx:acxQa,spotify:spotifyQa},analysis:{archive:archiveAnalysis,acx:acxAnalysis,spotify:spotifyAnalysis}};
    state.chapters[String(chapterPack.chapter.order)]=chapterResult;for(const chunk of chapterPack.chunks){if(state.chunks[chunk.id])state.chunks[chunk.id].status='COMPLETE';}await persistState(statePath,state);
  }
  const chapters=arm.batchScope.chapters.map((ch)=>state.chapters[String(ch.order)]).filter(Boolean);
  const channelSignatures=new Set(chapters.map((ch)=>`${ch.analysis?.acx?.channels??'unknown'}:${ch.analysis?.acx?.channelLayout??'unknown'}`));
  const consistentChannelConfiguration=channelSignatures.size<=1&&!channelSignatures.has('unknown:unknown');
  const anyQaFailure=chapters.some((ch)=>!ch.qa.archive.passed||!ch.qa.acx.passed||!ch.qa.spotify.passed)||!consistentChannelConfiguration;
  const capturedUsd=round(Object.values(state.chunks).reduce((sum,row)=>sum+Number(row?.capturedOrEstimatedBilledUsd??0),0),6);if(capturedUsd>cap+1e-9)throw new Error(`Batch captured/estimated spend $${capturedUsd.toFixed(6)} exceeded approved max $${cap.toFixed(2)}; future paid work blocked`);
  const distribution=freeze({contract:arm.outputContract,finalPackageComplete:false,batchChapterAssetsReady:!anyQaFailure,channelConfiguration:freeze({consistent:consistentChannelConfiguration,signatures:freeze([...channelSignatures])}),direct:freeze({technicalChapterFilesReady:chapters.every((ch)=>ch.qa.archive.passed&&ch.qa.spotify.passed)&&consistentChannelConfiguration,eligibility:'PRIMARY_OWNED_CUSTOMER_RELATIONSHIP_CHANNEL',coreBusinessRule:'Retailers give us reach. Direct gives us the relationship.',finalPackageMissing:freeze(['complete remaining chapters','chapter MP3 package','chapterized M4B','cover art','metadata','direct entitlement service connection','verified purchase restore flow'])}),acx:freeze({technicalChapterFilesReady:chapters.every((ch)=>ch.qa.acx.passed)&&consistentChannelConfiguration,eligibility:'BLOCKED_UNLESS_ACX_AUDIBLE_EXPLICITLY_AUTHORIZES_DIGITAL_NARRATION',finalPackageMissing:freeze(['opening credits','closing credits','retail sample','cover art','metadata','explicit ACX/Audible digital narration authorization'])}),spotify:freeze({technicalChapterFilesReady:chapters.every((ch)=>ch.qa.spotify.passed)&&consistentChannelConfiguration,eligibility:'DIGITAL_NARRATION_ACCEPTED_WITH_DISCLOSURE',finalPackageMissing:freeze(['opening/front matter','closing/back matter','sample','cover art','title/author/narrator/language','audiobook ISBN-13 if supplied (must be unique to audiobook edition)','BISAC','territories','USD pricing','digital voice disclosure'])}),apple:freeze({losslessPartnerSourceFilesReady:chapters.every((ch)=>ch.qa.archive.passed)&&consistentChannelConfiguration,eligibility:'PREFERRED_PARTNER_AND_DIGITAL_NARRATION_POLICY_VALIDATION_REQUIRED',finalPackageMissing:freeze(['selected preferred partner','partner-specific validation','cover art','metadata','digital narration eligibility confirmation'])})});
  const base={schemaVersion:1,release:YASREADY_AUDIOBOOKS_VERSION,artifact:'book-one-batch-production-result',status:anyQaFailure?'TECHNICAL_QA_REVIEW_REQUIRED':'READY_FOR_HUMAN_BATCH_REVIEW',book:productionPlan.book,armDigest:arm.integrity.armDigest,recipeDigest:recipeLock.integrity.recipeDigest,batch:freeze({ordinal:1,wholeChaptersOnly:true,chapterCount:chapters.length,firstChapterOrder:arm.batchScope.firstChapterOrder,lastChapterOrder:arm.batchScope.lastChapterOrder}),provider:freeze({providerGenerationCallsThisRun:providerCallsThisRun,importedPilotPaidCallsThisRun:importedPilotCallsThisRun,reusedPaidProviderChunks:Object.values(state.chunks).filter((row)=>row.status==='COMPLETE'&&row.historicalPaidProviderReuse).length,requestIdsObservedThisRun:freeze(requests),liveQuotaRecheckedBeforePaidWork:true}),cost:freeze({approvedMaxUsd:cap,capturedOrEstimatedBilledUsd:capturedUsd,headroomUsd:round(cap-capturedUsd,6),localProcessingUsd:0}),chapters:freeze(chapters.map((ch)=>freeze(ch))),distribution,guardrails:freeze({batchOneCompleted:true,nextBatchArmed:false,productionArmed:false,fullBookGenerationArmed:false,chaptersOutsideBatchGenerated:false,automaticScaleUp:false,humanReviewRequiredBeforeNextBatch:true,retailerSubmissionNotClaimed:true})};
  const resultDigest=sha256(stableJson(resultCore(base)));const result=freeze({...base,integrity:freeze({resultDigest}),nextAction:anyQaFailure?'Resolve technical QA issues before approving Batch One or arming any next batch.':'Human-listen to Batch One chapter masters. Do not arm the next batch until review is complete.'});verifyBookOneBatchProductionResult(result);
  const manifest=freeze({schemaVersion:1,release:YASREADY_AUDIOBOOKS_VERSION,artifact:'book-one-batch-distribution-manifest',resultDigest,finalPackageComplete:false,contractDigest:arm.outputContract.integrity.contractDigest,chapters:freeze(chapters.map((ch)=>freeze({order:ch.order,title:ch.title,archiveWav:ch.outputs.archiveWav,acxMp3:ch.outputs.acxMp3,spotifyMp3:ch.outputs.spotifyMp3,applePartnerWav:ch.outputs.applePartnerWav,qa:ch.qa}))),targets:distribution});
  await Promise.all([writeFile(path.join(root,'batch-one-result.json'),JSON.stringify(result,null,2)),writeFile(path.join(root,'batch-one-distribution-manifest.json'),JSON.stringify(manifest,null,2)),writeFile(path.join(root,'batch-one-review.html'),renderBookOneBatchReviewHtml(result)),writeFile(path.join(dirs.qa,'batch-one-technical-qa.json'),JSON.stringify(chapters.map((ch)=>({order:ch.order,title:ch.title,qa:ch.qa,analysis:ch.analysis})),null,2))]);
  return result;
}

export function renderBookOneBatchArmMarkdown(arm) {
  verifyBookOneQuotaAwareBatchArm(arm);
  const lines = [
    '# Book One — Quota-Aware Batch One Arm',
    '',
    `**Release:** ${arm.release}`,
    `**Status:** ${arm.status}`,
    '**Arm TTS calls:** 0',
    '**Arm spend:** $0.00',
    '**Full-book generation armed:** NO',
    '',
    '## Exact Batch One scope',
    '',
    `- Whole chapters: **${arm.batchScope.selectedChapterCount}** (hard cap: ${arm.batchScope.maxChapters})`,
    `- First chapter order: **${arm.batchScope.firstChapterOrder}**`,
    `- Last chapter order: **${arm.batchScope.lastChapterOrder}**`,
    `- New provider calls: **${arm.batchScope.newProviderCalls}**`,
    `- New provider characters: **${arm.batchScope.newProviderCharacters.toLocaleString()}**`,
    `- Reused paid pilot body calls: **${arm.batchScope.reusableProviderCalls}**`,
    `- Spoken chapter-heading calls included: **${arm.batchScope.selectedChapterCount}**`,
    `- Retry quota reserve: **${arm.batchScope.retryReserveCharacters.toLocaleString()} characters**`,
    `- Quota envelope: **${arm.batchScope.quotaEnvelopeCharacters.toLocaleString()} / ${arm.liveProvider.providerReportedRemaining.toLocaleString()} available**`,
    ''
  ];

  for (const chapter of arm.batchScope.chapters) {
    lines.push(`- ${chapter.title} — ${chapter.newProviderCharacters.toLocaleString()} new chars / ${chapter.reusableProviderCharacters.toLocaleString()} reused chars`);
  }

  lines.push(
    '',
    '## Budget',
    '',
    `- Initial generation estimate: **$${Number(arm.budget.initialGenerationUsd).toFixed(2)}**`,
    `- Retry reserve: **$${Number(arm.budget.retryReserveUsd).toFixed(2)}**`,
    `- Protected HARD max: **$${Number(arm.budget.protectedMaxUsd).toFixed(2)}**`,
    '',
    '## Distribution-safe outputs',
    '',
    '- Lossless 44.1 kHz / 24-bit WAV archive master per chapter.',
    '- Each completed chapter master begins with its spoken chapter/section heading in Ryan’s locked voice.',
    '- ACX/Audible technical derivative: 192 kbps CBR / 44.1 kHz MP3, one chapter/section per file, <=120 minutes.',
    '- Spotify direct derivative: the same conservative 192 kbps / 44.1 kHz MP3 is separately QA-checked for Spotify.',
    '- Apple Books: lossless WAV is prepared as a preferred-partner source asset; partner-specific acceptance is **not** assumed.',
    '- Final retailer package is not complete until credits/sample/cover/metadata and platform eligibility/disclosure gates are satisfied.',
    '',
    '## Digital narration policy gates',
    '',
    '- ACX/Audible: current rules prohibit unauthorized TTS/AI; **do not submit this digital narration unless ACX/Audible explicitly authorizes the route**.',
    '- Spotify: digital narration from providers such as ElevenLabs is accepted when disclosed.',
    '- Apple Books: preferred-partner route; validate digital narration eligibility and partner-specific packaging before delivery.',
    '',
    '## Spend authorization',
    '',
    `\`${arm.confirmation.token}\` authorizes **only this exact batch** up to **$${Number(arm.budget.protectedMaxUsd).toFixed(2)}**.`,
    'The prior PREFLIGHT token cannot authorize spend. Full-book generation remains OFF.',
    ''
  );

  return lines.join('\n');
}

export function renderBookOneBatchReviewHtml(result) {
  verifyBookOneBatchProductionResult(result);
  const cards = result.chapters.map((chapter) => `
    <section class="card">
      <h2>${escapeHtml(chapter.title)}</h2>
      <p class="muted">ACX/Spotify conservative MP3 master</p>
      <audio controls preload="metadata" src="${escapeHtml(chapter.outputs.acxMp3)}"></audio>
      <div class="pills">
        <span>ACX QA ${chapter.qa.acx.passed ? 'PASS' : 'REVIEW'}</span>
        <span>Spotify QA ${chapter.qa.spotify.passed ? 'PASS' : 'REVIEW'}</span>
        <span>Archive QA ${chapter.qa.archive.passed ? 'PASS' : 'REVIEW'}</span>
      </div>
    </section>`).join('');

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Book One — Batch One Review</title>
  <style>
    :root{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text",Inter,system-ui,sans-serif;background:#f5f5f7;color:#111}
    body{margin:0;padding:28px}.wrap{max-width:980px;margin:auto}.hero,.card{background:#fff;border:1px solid #e5e5ea;border-radius:24px;box-shadow:0 12px 36px rgba(0,0,0,.06)}
    .hero{padding:30px}.card{padding:22px;margin-top:16px}h1{margin:0 0 8px;font-size:34px;letter-spacing:-.03em}h2{margin:0 0 8px}.muted{color:#6e6e73}
    audio{width:100%;margin:12px 0}.pills{display:flex;gap:8px;flex-wrap:wrap}.pills span{background:#efeff4;border-radius:999px;padding:7px 10px;font-size:13px}.warn{background:#fff3cd;border-radius:16px;padding:14px;margin-top:14px}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="hero">
      <div class="muted">YasReady Audiobooks ${escapeHtml(result.release)}</div>
      <h1>Batch One Review</h1>
      <p>${result.batch.chapterCount} whole chapter(s). Full-book generation is still OFF.</p>
      <div class="warn"><strong>Direct Edition:</strong> Retailers give us reach. Direct gives us the relationship. These chapter masters feed the owned Direct Edition first. Retailer syndication remains separate: ACX/Audible currently requires explicit authorization for this digital narration; Spotify requires digital-voice disclosure; Apple requires preferred-partner validation.</div>
    </div>
    ${cards}
  </div>
</body>
</html>`;
}

function escapeHtml(value){return String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
