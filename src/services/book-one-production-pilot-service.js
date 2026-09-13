import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { YASREADY_AUDIOBOOKS_VERSION } from '../release.js';
import { sha256, stableJson } from '../core/hash.js';
import { splitForTts } from '../production/model-limits.js';
import { verifyBookOneProductionPlan } from './book-one-production-plan-service.js';
import { evaluateMasterAgainstProfile } from '../mastering/profiles.js';

export const BOOK_ONE_PILOT_MASTERING_PROFILE = 'acx-2026';
export const BOOK_ONE_PILOT_ACCEPTED_PLAN_RELEASES = Object.freeze(['0.14.3.13', '0.14.3.14', '0.14.3.14.1', '0.14.3.14.2', '0.14.3.15', '0.14.3.16', '0.14.3.17', '0.14.3.18', '0.14.3.18.1', '0.14.3.18.2', '0.14.3.19', '0.14.3.20', '0.14.3.20.1', '0.14.3.20.2', '0.14.3.20.3', '0.14.3.20.4']);
export const BOOK_ONE_PILOT_ACCEPTED_ARM_RELEASES = Object.freeze(['0.14.3.14', '0.14.3.14.1', '0.14.3.14.2', '0.14.3.15', '0.14.3.16', '0.14.3.17', '0.14.3.18', '0.14.3.18.1', '0.14.3.18.2', '0.14.3.19', '0.14.3.20', '0.14.3.20.1', '0.14.3.20.2', '0.14.3.20.3', '0.14.3.20.4']);

function freeze(value) {
  if (Array.isArray(value)) {
    for (const item of value) freeze(item);
    return Object.freeze(value);
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) freeze(item);
    return Object.freeze(value);
  }
  return value;
}

function clean(value) {
  return String(value ?? '').trim();
}

function round(value, digits = 6) {
  const factor = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function ceilCents(value) {
  return Math.ceil((Number(value) - Number.EPSILON) * 100) / 100;
}

function asNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function requirePlanForPilot(plan) {
  verifyBookOneProductionPlan(plan, { acceptedReleases: BOOK_ONE_PILOT_ACCEPTED_PLAN_RELEASES });
  if (plan.guardrails?.productionArmed !== false || plan.guardrails?.fullBookGenerationArmed !== false) {
    throw new Error('Chapter One pilot requires an unarmed production plan');
  }
  if (plan.guardrails?.planTokenIsNotSpendAuthorization !== true) {
    throw new Error('Production plan must preserve PLAN token non-spend semantics');
  }
  return true;
}

function chapterOneFromPlan(plan) {
  const matches = (plan.manifest?.chapters ?? []).filter((chapter) => /^chapter\s+1(?:\b|\s*[:.\-–—])/i.test(clean(chapter.title)));
  if (matches.length !== 1) {
    throw new Error(`Chapter One pilot requires exactly one narrative Chapter 1 in the production plan; found ${matches.length}`);
  }
  if (!matches[0].chunks?.length) throw new Error('Chapter One has no planned provider chunks');
  return matches[0];
}

function sceneText(scene) {
  return (scene?.segments ?? []).map((segment) => clean(segment.text)).filter(Boolean).join('\n');
}

export function materializeChapterOnePilotTexts({ productionPlan, manuscriptAnalysis } = {}) {
  requirePlanForPilot(productionPlan);
  if (!manuscriptAnalysis?.source?.sourceHash || !Array.isArray(manuscriptAnalysis?.chapters)) {
    throw new Error('Chapter One pilot requires a complete analyzed manuscript');
  }
  if (manuscriptAnalysis.source.sourceHash !== productionPlan.source.sourceHash) {
    throw new Error('Chapter One pilot manuscript source hash does not match the production plan');
  }
  const planned = chapterOneFromPlan(productionPlan);
  const chapter = manuscriptAnalysis.chapters[planned.order];
  if (!chapter) throw new Error('Planned Chapter One order is missing from analyzed manuscript');
  if (planned.sourceTextHash && chapter.textHash !== planned.sourceTextHash) {
    throw new Error('Chapter One source text hash drifted after production planning');
  }

  const maxChars = Number(productionPlan.manifest.maxCharactersPerProviderCall);
  if (!Number.isInteger(maxChars) || maxChars < 1) throw new Error('Production plan has invalid provider chunk cap');
  const materialized = [];
  for (let sceneIndex = 0; sceneIndex < chapter.scenes.length; sceneIndex += 1) {
    const text = sceneText(chapter.scenes[sceneIndex]);
    if (!text) continue;
    const chunks = splitForTts(text, { maxChars });
    for (let sceneChunkIndex = 0; sceneChunkIndex < chunks.length; sceneChunkIndex += 1) {
      const id = `ch${String(planned.order + 1).padStart(2, '0')}-sc${String(sceneIndex + 1).padStart(2, '0')}-c${String(sceneChunkIndex + 1).padStart(2, '0')}`;
      const planChunk = planned.chunks.find((item) => item.id === id);
      if (!planChunk) throw new Error(`Chapter One materialization produced unplanned chunk ${id}`);
      const chunkText = chunks[sceneChunkIndex];
      const digest = sha256(chunkText);
      if (digest !== planChunk.textDigest) throw new Error(`Chapter One chunk text digest mismatch for ${id}`);
      materialized.push(freeze({ ...planChunk, text: chunkText }));
    }
  }

  if (materialized.length !== planned.chunks.length) {
    throw new Error(`Chapter One materialization count mismatch: planned ${planned.chunks.length}, rebuilt ${materialized.length}`);
  }
  const ids = new Set(materialized.map((item) => item.id));
  for (const chunk of planned.chunks) if (!ids.has(chunk.id)) throw new Error(`Planned Chapter One chunk did not materialize: ${chunk.id}`);
  return freeze({ chapter: planned, chunks: materialized });
}

export function extractElevenLabsQuota(subscription) {
  const used = asNumber(subscription?.character_count);
  const limit = asNumber(subscription?.character_limit);
  if (used === null || limit === null || limit < 0 || used < 0) {
    throw new Error('Live ElevenLabs quota could not be verified from character_count / character_limit; pilot remains unarmed');
  }
  return freeze({
    tier: subscription?.tier ?? subscription?.plan ?? null,
    status: subscription?.status ?? null,
    providerReportedUsed: used,
    providerReportedLimit: limit,
    providerReportedRemaining: Math.max(0, limit - used),
    nextResetUnix: asNumber(subscription?.next_character_count_reset_unix),
    canExtendCharacterLimit: Boolean(subscription?.can_extend_character_limit),
    maxCreditLimitExtension: subscription?.max_credit_limit_extension ?? null,
    currentOverage: subscription?.current_overage ?? null,
    unitLabel: 'provider-reported-character-quota',
    creditsInferred: false
  });
}

function armCore(arm) {
  return {
    schemaVersion: arm.schemaVersion,
    release: arm.release,
    artifact: arm.artifact,
    status: arm.status,
    book: arm.book,
    sourceProductionPlan: arm.sourceProductionPlan,
    narrator: arm.narrator,
    lockedRecipe: arm.lockedRecipe,
    pilotScope: arm.pilotScope,
    budget: arm.budget,
    providerPreflight: arm.providerPreflight,
    ffmpegPreflight: arm.ffmpegPreflight,
    guardrails: arm.guardrails
  };
}

export function verifyBookOneChapterOnePilotArm(arm) {
  if (!arm || arm.artifact !== 'book-one-chapter-one-pilot-arm') throw new Error('Invalid Chapter One pilot arm artifact');
  if (!BOOK_ONE_PILOT_ACCEPTED_ARM_RELEASES.includes(arm.release)) throw new Error('Chapter One pilot arm release is not accepted by this operation');
  if (arm.status !== 'ARMED_FOR_CHAPTER_ONE_PILOT_ONLY') throw new Error('Chapter One pilot arm has invalid status');
  if (arm.guardrails?.pilotArmed !== true) throw new Error('Chapter One pilot arm is not armed');
  if (arm.guardrails?.productionArmed !== false || arm.guardrails?.fullBookGenerationArmed !== false) {
    throw new Error('Chapter One pilot arm must not arm full production');
  }
  if (arm.guardrails?.scope !== 'chapter-one-only') throw new Error('Chapter One pilot arm scope is not chapter-one-only');
  if (arm.guardrails?.armProviderGenerationCalls !== 0 || arm.guardrails?.armSpendUsd !== 0) {
    throw new Error('Pilot arm preflight must remain zero-spend and zero-TTS');
  }
  if (!arm.integrity?.armDigest) throw new Error('Chapter One pilot arm digest is missing');
  const expected = sha256(stableJson(armCore(arm)));
  if (expected !== arm.integrity.armDigest) throw new Error('Chapter One pilot arm integrity digest mismatch');
  if (arm.confirmation?.token !== `PILOT-${expected.slice(0, 10).toUpperCase()}`) throw new Error('Chapter One pilot approval token mismatch');
  if (!(Number(arm.budget?.suggestedMaxUsd) > 0)) throw new Error('Chapter One pilot budget is invalid');
  if (Number(arm.budget?.hardCeilingUsd) !== Number(arm.budget?.suggestedMaxUsd)) throw new Error('Pilot hard ceiling must equal the displayed protected max');
  return true;
}

export async function buildBookOneChapterOnePilotArm({ productionPlan, manuscriptAnalysis, provider, ffmpeg } = {}) {
  requirePlanForPilot(productionPlan);
  if (!provider?.subscriptionPreflight || !provider?.healthCheck) throw new Error('Pilot arm requires provider subscription + health preflight support');
  if (!ffmpeg?.healthCheck) throw new Error('Pilot arm requires FFmpeg health preflight support');

  const materialized = materializeChapterOnePilotTexts({ productionPlan, manuscriptAnalysis });
  const subscriptionPreflight = await provider.subscriptionPreflight();
  if (!subscriptionPreflight?.safeToContinue || !subscriptionPreflight?.available || !subscriptionPreflight.subscription) {
    throw new Error(`Live ElevenLabs subscription/quota verification is required before pilot arm (${subscriptionPreflight?.reason ?? 'unavailable'})`);
  }
  const tier = clean(subscriptionPreflight.tier ?? subscriptionPreflight.subscription?.tier).toLowerCase();
  if (!tier || ['free', 'trial'].includes(tier)) throw new Error(`Chapter One pilot requires a paid ElevenLabs tier; current tier: ${tier || 'unknown'}`);
  const quota = extractElevenLabsQuota(subscriptionPreflight.subscription);
  const providerHealth = await provider.healthCheck();
  if (!providerHealth?.ok) throw new Error(`ElevenLabs health preflight failed before pilot arm: ${providerHealth?.reason ?? providerHealth?.status ?? 'unknown'}`);
  const ffmpegHealth = await ffmpeg.healthCheck();
  if (!ffmpegHealth?.ok) throw new Error(`FFmpeg preflight failed before pilot arm: ${ffmpegHealth?.reason ?? 'unknown'}`);

  const characters = materialized.chunks.reduce((sum, chunk) => sum + Number(chunk.characters ?? chunk.text.length), 0);
  if (quota.providerReportedRemaining < characters) {
    throw new Error(`Live ElevenLabs quota is insufficient for Chapter One pilot: ${quota.providerReportedRemaining} remaining, ${characters} required. Pilot remains unarmed.`);
  }
  const rate = Number(productionPlan.budget.rateUsdPer1kCharacters);
  const estimateUsd = round((characters / 1000) * rate, 6);
  const reserveRatio = Math.max(0.20, Number(productionPlan.budget.retryReserveRatio ?? 0.20));
  const reserveUsd = round(estimateUsd * reserveRatio, 6);
  const suggestedMaxUsd = ceilCents(estimateUsd + reserveUsd);

  const base = {
    schemaVersion: 1,
    release: YASREADY_AUDIOBOOKS_VERSION,
    artifact: 'book-one-chapter-one-pilot-arm',
    status: 'ARMED_FOR_CHAPTER_ONE_PILOT_ONLY',
    book: productionPlan.book,
    sourceProductionPlan: freeze({
      release: productionPlan.release,
      productionPlanDigest: productionPlan.integrity.productionPlanDigest,
      planReferenceToken: productionPlan.confirmation.token,
      narratorLockDigest: productionPlan.narratorLock.lockDigest,
      manuscriptSourceHash: productionPlan.source.sourceHash
    }),
    narrator: freeze({
      provider: productionPlan.productionRecipe.provider,
      providerVoiceId: productionPlan.productionRecipe.providerVoiceId,
      narratorName: productionPlan.productionRecipe.narratorName
    }),
    lockedRecipe: freeze({
      model: productionPlan.productionRecipe.model,
      direction: productionPlan.productionRecipe.performanceDirection,
      providerVoiceSettings: productionPlan.productionRecipe.providerVoiceSettings,
      paceProfile: productionPlan.productionRecipe.paceProfile
    }),
    pilotScope: freeze({
      kind: 'chapter-one-only',
      chapterOrder: materialized.chapter.order,
      chapterTitle: materialized.chapter.title,
      chapterSourceTextHash: materialized.chapter.sourceTextHash,
      providerGenerationCalls: materialized.chunks.length,
      providerCharacters: characters,
      chunkIds: materialized.chunks.map((chunk) => chunk.id),
      generationDigests: materialized.chunks.map((chunk) => chunk.generationDigest),
      textDigests: materialized.chunks.map((chunk) => chunk.textDigest),
      localTempoTasks: productionPlan.productionRecipe.paceProfile.postProcessRequired ? materialized.chunks.length : 0,
      masteringProfile: BOOK_ONE_PILOT_MASTERING_PROFILE
    }),
    budget: freeze({
      currency: 'USD',
      rateUsdPer1kCharacters: rate,
      estimateUsd,
      retryReserveRatio: reserveRatio,
      retryReserveUsd: reserveUsd,
      suggestedMaxUsd,
      hardCeilingUsd: suggestedMaxUsd,
      armSpendUsd: 0,
      estimateNotInvoice: true
    }),
    providerPreflight: freeze({
      checkedAt: new Date().toISOString(),
      tier: quota.tier,
      status: quota.status,
      quota,
      healthStatus: providerHealth.status ?? null,
      providerTtsCallsPerformed: 0,
      nonTtsPreflightRequestsPerformed: true
    }),
    ffmpegPreflight: freeze({
      ok: true,
      ffmpeg: ffmpegHealth.ffmpeg ?? null,
      ffprobe: ffmpegHealth.ffprobe ?? null
    }),
    guardrails: freeze({
      scope: 'chapter-one-only',
      armProviderGenerationCalls: 0,
      armSpendUsd: 0,
      pilotArmed: true,
      productionArmed: false,
      fullBookGenerationArmed: false,
      planTokenCannotAuthorizeSpend: true,
      exactPilotTokenRequired: true,
      exactMaxUsdRequired: true,
      liveQuotaRecheckRequiredAtRender: true,
      ffmpegRecheckRequiredAtRender: true,
      completedPaidChunkReuseRequired: true,
      unknownProviderOutcomeDoNotRerun: true,
      identityInferenceFromAudio: false
    })
  };
  const armDigest = sha256(stableJson(armCore(base)));
  const arm = freeze({
    ...base,
    integrity: freeze({ armDigest }),
    confirmation: freeze({
      token: `PILOT-${armDigest.slice(0, 10).toUpperCase()}`,
      instruction: `Type this exact PILOT token to authorize only Chapter One up to $${suggestedMaxUsd.toFixed(2)}. The PLAN token is not valid spend authorization.`
    }),
    nextAction: 'Explicitly approve the PILOT token and protected max to render Chapter One only. Full-book generation remains unarmed.'
  });
  verifyBookOneChapterOnePilotArm(arm);
  return arm;
}

function renderResultCore(result) {
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

export function verifyBookOneChapterOnePilotRender(result) {
  if (!result || result.artifact !== 'book-one-chapter-one-pilot-render') throw new Error('Invalid Chapter One pilot render result');
  if (result.release !== YASREADY_AUDIOBOOKS_VERSION) throw new Error('Chapter One pilot render release mismatch');
  if (!['READY_FOR_HUMAN_PILOT_REVIEW', 'TECHNICAL_QA_REVIEW_REQUIRED'].includes(result.status)) throw new Error('Chapter One pilot render status is invalid');
  if (result.guardrails?.productionArmed !== false || result.guardrails?.fullBookGenerationArmed !== false) throw new Error('Pilot render cannot arm full production');
  if (!result.integrity?.renderDigest) throw new Error('Pilot render digest missing');
  if (sha256(stableJson(renderResultCore(result))) !== result.integrity.renderDigest) throw new Error('Pilot render integrity digest mismatch');
  return true;
}

async function exists(file) {
  try { await stat(file); return true; } catch { return false; }
}

async function storedAudioDigest(file) {
  const bytes = await readFile(file);
  return sha256(bytes.toString('base64'));
}

async function loadState(file, arm) {
  if (!(await exists(file))) {
    return {
      schemaVersion: 1,
      release: YASREADY_AUDIOBOOKS_VERSION,
      artifact: 'book-one-chapter-one-pilot-state',
      armDigest: arm.integrity.armDigest,
      productionPlanDigest: arm.sourceProductionPlan.productionPlanDigest,
      chunks: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }
  const state = JSON.parse(await readFile(file, 'utf8'));
  if (state.armDigest !== arm.integrity.armDigest || state.productionPlanDigest !== arm.sourceProductionPlan.productionPlanDigest) {
    throw new Error('Existing Chapter One pilot state belongs to a different arm/plan; use a different output directory');
  }
  return state;
}

async function persistState(file, state) {
  state.updatedAt = new Date().toISOString();
  await writeFile(file, JSON.stringify(state, null, 2));
}

function quotaRemaining(subscription) {
  return extractElevenLabsQuota(subscription).providerReportedRemaining;
}

function safeProviderFailure(error) {
  return error?.name === 'ElevenLabsApiError' && Number.isInteger(Number(error?.status)) && Number(error.status) >= 400;
}

export async function renderBookOneChapterOnePilot({
  arm,
  productionPlan,
  manuscriptAnalysis,
  provider,
  ffmpeg,
  outDir,
  approvalToken,
  maxUsd
} = {}) {
  verifyBookOneChapterOnePilotArm(arm);
  requirePlanForPilot(productionPlan);
  if (productionPlan.integrity.productionPlanDigest !== arm.sourceProductionPlan.productionPlanDigest) throw new Error('Pilot arm does not belong to this production plan');
  if (productionPlan.confirmation.token === approvalToken) throw new Error('PLAN token cannot authorize spend; use the exact PILOT token');
  if (approvalToken !== arm.confirmation.token) throw new Error('Chapter One PILOT approval token mismatch');
  const cap = Number(maxUsd);
  if (!Number.isFinite(cap) || cap < arm.budget.suggestedMaxUsd - 1e-9) throw new Error(`Approved max USD is below protected pilot max $${arm.budget.suggestedMaxUsd.toFixed(2)}`);
  if (cap > arm.budget.hardCeilingUsd + 1e-9) throw new Error(`Approved max USD exceeds Chapter One pilot hard ceiling $${arm.budget.hardCeilingUsd.toFixed(2)}`);
  if (!provider?.render || !provider?.subscriptionPreflight || !provider?.healthCheck) throw new Error('Pilot render requires provider render + preflight support');
  if (!ffmpeg?.healthCheck || !ffmpeg?.tempo || !ffmpeg?.concat || !ffmpeg?.master || !ffmpeg?.analyze) throw new Error('Pilot render requires complete FFmpeg production support');

  const materialized = materializeChapterOnePilotTexts({ productionPlan, manuscriptAnalysis });
  const currentIds = materialized.chunks.map((chunk) => chunk.id);
  if (stableJson(currentIds) !== stableJson(arm.pilotScope.chunkIds)) throw new Error('Pilot materialized chunk scope drifted after arm');

  const ffmpegHealth = await ffmpeg.healthCheck();
  if (!ffmpegHealth?.ok) throw new Error(`FFmpeg preflight failed before any paid pilot TTS call: ${ffmpegHealth?.reason ?? 'unknown'}`);
  const providerHealth = await provider.healthCheck();
  if (!providerHealth?.ok) throw new Error(`ElevenLabs health preflight failed before any paid pilot TTS call: ${providerHealth?.reason ?? providerHealth?.status ?? 'unknown'}`);
  const subscription = await provider.subscriptionPreflight();
  if (!subscription?.available || !subscription?.safeToContinue || !subscription.subscription) throw new Error('Live ElevenLabs quota recheck failed before any paid pilot TTS call');

  const resolved = path.resolve(outDir);
  const dirs = {
    provider: path.join(resolved, 'provider'),
    tempo: path.join(resolved, 'tempo'),
    assembled: path.join(resolved, 'assembled'),
    master: path.join(resolved, 'master'),
    qa: path.join(resolved, 'qa')
  };
  await Promise.all(Object.values(dirs).map((dir) => mkdir(dir, { recursive: true })));
  const statePath = path.join(resolved, 'chapter-one-pilot-state.json');
  const state = await loadState(statePath, arm);

  const unresolvedInFlight = Object.values(state.chunks).find((item) => ['PROVIDER_IN_FLIGHT', 'PROVIDER_RESULT_UNKNOWN_DO_NOT_RERUN'].includes(item?.status));
  if (unresolvedInFlight) {
    throw new Error(`DO NOT RERUN PROVIDER: ${unresolvedInFlight.id} has an unresolved paid-provider outcome. Reconcile/recover that response before retrying.`);
  }

  const missingCharacters = materialized.chunks
    .filter((chunk) => !['PROVIDER_COMPLETE', 'LOCAL_TEMPO_FAILED_SAFE_TO_RERUN', 'TEMPO_COMPLETE', 'COMPLETE'].includes(state.chunks[chunk.id]?.status))
    .reduce((sum, chunk) => sum + chunk.characters, 0);
  const remaining = quotaRemaining(subscription.subscription);
  if (remaining < missingCharacters) throw new Error(`Live ElevenLabs quota is insufficient for remaining Chapter One pilot work: ${remaining} remaining, ${missingCharacters} required`);

  let currentRunProviderGenerationCalls = 0;
  let reusedPaidBaseChunks = 0;
  let localTempoBuiltThisRun = 0;
  const finalChunkPaths = [];
  const requests = [];

  for (let index = 0; index < materialized.chunks.length; index += 1) {
    const chunk = materialized.chunks[index];
    const providerPath = path.join(dirs.provider, `${chunk.id}.mp3`);
    const tempoPath = path.join(dirs.tempo, `${chunk.id}.mp3`);
    let row = state.chunks[chunk.id] ?? { id: chunk.id, generationDigest: chunk.generationDigest, status: 'PLANNED' };
    if (row.generationDigest !== chunk.generationDigest) throw new Error(`Existing pilot state generation digest mismatch for ${chunk.id}`);

    let providerReady = ['PROVIDER_COMPLETE', 'LOCAL_TEMPO_FAILED_SAFE_TO_RERUN', 'TEMPO_COMPLETE', 'COMPLETE'].includes(row.status) && await exists(providerPath);
    if (providerReady && row.audioSha256) {
      const actualDigest = await storedAudioDigest(providerPath);
      if (actualDigest !== row.audioSha256) {
        throw new Error(`DO NOT RERUN PROVIDER: stored paid audio digest mismatch for ${chunk.id}. Recover/repair the paid base file before continuing.`);
      }
    } else if (providerReady && !row.audioSha256) {
      throw new Error(`DO NOT RERUN PROVIDER: stored paid audio for ${chunk.id} has no recorded digest; reconcile state before continuing.`);
    }
    if (providerReady) {
      reusedPaidBaseChunks += 1;
    } else {
      if (['PROVIDER_IN_FLIGHT', 'PROVIDER_RESULT_UNKNOWN_DO_NOT_RERUN'].includes(row.status)) throw new Error(`DO NOT RERUN PROVIDER: ${chunk.id} has an unresolved provider outcome`);
      const estimatedChunkUsd = round((chunk.characters / 1000) * Number(arm.budget.rateUsdPer1kCharacters), 6);
      const alreadyCaptured = Object.values(state.chunks).reduce((sum, item) => sum + Number(item?.capturedOrEstimatedBilledUsd ?? 0), 0);
      if (alreadyCaptured + estimatedChunkUsd > cap + 1e-9) throw new Error(`Pilot Money Guard would exceed approved max $${cap.toFixed(2)} before ${chunk.id}`);

      row = {
        ...row,
        id: chunk.id,
        generationDigest: chunk.generationDigest,
        textDigest: chunk.textDigest,
        status: 'PROVIDER_IN_FLIGHT',
        providerStartedAt: new Date().toISOString()
      };
      state.chunks[chunk.id] = row;
      await persistState(statePath, state);

      let rendered;
      try {
        rendered = await provider.render({
          voiceId: productionPlan.productionRecipe.providerVoiceId,
          text: chunk.text,
          model: productionPlan.productionRecipe.model,
          outputFormat: 'mp3_44100_128',
          voiceSettings: productionPlan.productionRecipe.providerVoiceSettings,
          previousText: index > 0 ? materialized.chunks[index - 1].text.slice(-1200) : null,
          nextText: index + 1 < materialized.chunks.length ? materialized.chunks[index + 1].text.slice(0, 1200) : null
        });
      } catch (error) {
        row.status = safeProviderFailure(error) ? 'PROVIDER_FAILED_SAFE_TO_RETRY' : 'PROVIDER_RESULT_UNKNOWN_DO_NOT_RERUN';
        row.error = error?.message ?? String(error);
        state.chunks[chunk.id] = row;
        await persistState(statePath, state);
        if (row.status === 'PROVIDER_RESULT_UNKNOWN_DO_NOT_RERUN') {
          throw new Error(`DO NOT RERUN PROVIDER: ${chunk.id} outcome is unknown after provider call: ${row.error}`);
        }
        throw error;
      }

      const audio = rendered?.audio;
      if (!(audio instanceof Uint8Array) || audio.byteLength < 1) {
        row.status = 'PROVIDER_RESULT_UNKNOWN_DO_NOT_RERUN';
        row.error = 'Provider returned no durable audio bytes';
        state.chunks[chunk.id] = row;
        await persistState(statePath, state);
        throw new Error(`DO NOT RERUN PROVIDER: ${chunk.id} returned no durable audio bytes`);
      }
      try {
        await writeFile(providerPath, audio);
      } catch (error) {
        throw new Error(`DO NOT RERUN PROVIDER: provider succeeded for ${chunk.id} but local storage failed: ${error?.message ?? error}`);
      }
      const estimated = Number(rendered.estimatedCostUsd);
      const fallback = round(((Number(rendered.billedCharacters ?? chunk.characters)) / 1000) * Number(arm.budget.rateUsdPer1kCharacters), 6);
      row = {
        ...row,
        status: 'PROVIDER_COMPLETE',
        providerCompletedAt: new Date().toISOString(),
        providerRelativePath: path.relative(resolved, providerPath),
        audioSha256: sha256(Buffer.from(audio).toString('base64')),
        audioBytes: audio.byteLength,
        requestId: rendered.requestId ?? null,
        billedCharacters: Number(rendered.billedCharacters ?? chunk.characters),
        capturedOrEstimatedBilledUsd: Number.isFinite(estimated) ? estimated : fallback,
        billingBasis: Number.isFinite(estimated) ? 'provider-returned-estimate' : 'planning-rate-fallback'
      };
      state.chunks[chunk.id] = row;
      await persistState(statePath, state);
      currentRunProviderGenerationCalls += 1;
      requests.push(rendered.requestId ?? null);
    }

    if (productionPlan.productionRecipe.paceProfile.postProcessRequired) {
      let tempoReady = ['TEMPO_COMPLETE', 'COMPLETE'].includes(row.status) && await exists(tempoPath);
      if (tempoReady && row.tempoAudioSha256) {
        tempoReady = (await storedAudioDigest(tempoPath)) === row.tempoAudioSha256;
      } else if (tempoReady && !row.tempoAudioSha256) {
        tempoReady = false;
      }
      if (tempoReady) {
        finalChunkPaths.push(tempoPath);
      } else {
        try {
          await ffmpeg.tempo(providerPath, tempoPath, Number(productionPlan.productionRecipe.paceProfile.postProcessTempoMultiplier));
        } catch (error) {
          row.status = 'LOCAL_TEMPO_FAILED_SAFE_TO_RERUN';
          row.localError = error?.message ?? String(error);
          state.chunks[chunk.id] = row;
          await persistState(statePath, state);
          throw error;
        }
        row.status = 'TEMPO_COMPLETE';
        row.tempoRelativePath = path.relative(resolved, tempoPath);
        row.tempoAudioSha256 = await storedAudioDigest(tempoPath);
        row.effectiveSpeed = productionPlan.productionRecipe.paceProfile.effectiveSpeed;
        state.chunks[chunk.id] = row;
        await persistState(statePath, state);
        localTempoBuiltThisRun += 1;
        finalChunkPaths.push(tempoPath);
      }
    } else {
      row.status = 'COMPLETE';
      state.chunks[chunk.id] = row;
      await persistState(statePath, state);
      finalChunkPaths.push(providerPath);
    }
  }

  const assembledPath = path.join(dirs.assembled, 'chapter-one-effective-pace.wav');
  const masterPath = path.join(dirs.master, 'chapter-one-pilot-acx.mp3');
  await ffmpeg.concat(finalChunkPaths, assembledPath);
  await ffmpeg.master(assembledPath, masterPath, BOOK_ONE_PILOT_MASTERING_PROFILE);
  const masterAnalysis = await ffmpeg.analyze(masterPath);
  const assembledAudioSha256 = await storedAudioDigest(assembledPath);
  const masteredAudioSha256 = await storedAudioDigest(masterPath);
  const profileQa = evaluateMasterAgainstProfile(masterAnalysis, BOOK_ONE_PILOT_MASTERING_PROFILE);

  for (const chunk of materialized.chunks) {
    const row = state.chunks[chunk.id];
    if (row) row.status = 'COMPLETE';
  }
  await persistState(statePath, state);

  const capturedUsd = round(Object.values(state.chunks).reduce((sum, item) => sum + Number(item?.capturedOrEstimatedBilledUsd ?? 0), 0), 6);
  if (capturedUsd > cap + 1e-9) throw new Error(`Pilot captured/estimated spend $${capturedUsd.toFixed(6)} exceeded approved max $${cap.toFixed(2)}; future paid work is blocked`);
  const status = profileQa.passed ? 'READY_FOR_HUMAN_PILOT_REVIEW' : 'TECHNICAL_QA_REVIEW_REQUIRED';

  const base = {
    schemaVersion: 1,
    release: YASREADY_AUDIOBOOKS_VERSION,
    artifact: 'book-one-chapter-one-pilot-render',
    status,
    book: productionPlan.book,
    armDigest: arm.integrity.armDigest,
    productionPlanDigest: productionPlan.integrity.productionPlanDigest,
    chapter: freeze({
      order: materialized.chapter.order,
      title: materialized.chapter.title,
      sourceTextHash: materialized.chapter.sourceTextHash,
      providerGenerationCalls: materialized.chunks.length,
      providerCharacters: arm.pilotScope.providerCharacters,
      generationDigests: materialized.chunks.map((chunk) => chunk.generationDigest)
    }),
    narrator: arm.narrator,
    lockedRecipe: arm.lockedRecipe,
    provider: freeze({
      totalPaidBaseChunks: materialized.chunks.length,
      currentRunProviderGenerationCalls,
      reusedPaidBaseChunks,
      requestIdsObservedThisRun: requests.filter(Boolean),
      quotaRecheckedBeforePaidWork: true
    }),
    localProcessing: freeze({
      tempoTasks: arm.pilotScope.localTempoTasks,
      localTempoBuiltThisRun,
      pitchPreserving: Boolean(productionPlan.productionRecipe.paceProfile.pitchPreservingPostProcess),
      assembledLocally: true,
      masteredLocally: true,
      masteringProfile: BOOK_ONE_PILOT_MASTERING_PROFILE
    }),
    cost: freeze({
      estimateUsd: arm.budget.estimateUsd,
      approvedMaxUsd: cap,
      capturedOrEstimatedBilledUsd: capturedUsd,
      headroomUsd: round(cap - capturedUsd, 6),
      localProcessingUsd: 0
    }),
    technicalQa: freeze({
      passed: profileQa.passed,
      profileId: profileQa.profileId,
      issues: profileQa.issues,
      analysis: masterAnalysis
    }),
    outputs: freeze({
      state: path.relative(resolved, statePath),
      effectivePaceAssembly: path.relative(resolved, assembledPath),
      masteredPilot: path.relative(resolved, masterPath),
      effectivePaceAssemblySha256: assembledAudioSha256,
      masteredPilotSha256: masteredAudioSha256,
      reviewBoard: 'chapter-one-pilot-review.html',
      feedbackTemplate: 'chapter-one-pilot-feedback-template.json'
    }),
    guardrails: freeze({
      pilotArmed: true,
      pilotScopeCompleted: true,
      productionArmed: false,
      fullBookGenerationArmed: false,
      chapterTwoOrLaterGenerated: false,
      automaticScaleUp: false,
      humanPassRequiredBeforeNextRelease: true
    })
  };
  const renderDigest = sha256(stableJson(renderResultCore(base)));
  const result = freeze({
    ...base,
    integrity: freeze({ renderDigest }),
    nextAction: profileQa.passed
      ? 'Human-listen to the mastered Chapter One pilot. PASS/MAYBE/FAIL the pilot; even PASS does not arm the full book.'
      : 'Review technical QA issues before human PASS. Full-book generation remains unarmed.'
  });
  verifyBookOneChapterOnePilotRender(result);

  await Promise.all([
    writeFile(path.join(resolved, 'chapter-one-pilot-result.json'), JSON.stringify(result, null, 2)),
    writeFile(path.join(resolved, 'chapter-one-pilot-review.html'), renderBookOneChapterOnePilotReviewHtml(arm, result)),
    writeFile(path.join(resolved, 'chapter-one-pilot-feedback-template.json'), JSON.stringify(bookOneChapterOnePilotFeedbackTemplate(arm, result), null, 2)),
    writeFile(path.join(dirs.qa, 'chapter-one-pilot-technical-qa.json'), JSON.stringify(result.technicalQa, null, 2))
  ]);
  return result;
}

export function bookOneChapterOnePilotFeedbackTemplate(arm, result) {
  verifyBookOneChapterOnePilotArm(arm);
  verifyBookOneChapterOnePilotRender(result);
  return {
    schemaVersion: 1,
    release: YASREADY_AUDIOBOOKS_VERSION,
    artifact: 'book-one-chapter-one-pilot-human-feedback',
    armDigest: arm.integrity.armDigest,
    renderDigest: result.integrity.renderDigest,
    chapter: result.chapter,
    decision: '',
    notes: '',
    exportedAt: null
  };
}

export function renderBookOneChapterOnePilotReviewHtml(arm, result) {
  verifyBookOneChapterOnePilotArm(arm);
  verifyBookOneChapterOnePilotRender(result);
  const qa = result.technicalQa;
  const issueText = qa.issues?.length
    ? qa.issues.map((issue) => `<li><strong>${escapeHtml(issue.code)}</strong> — ${escapeHtml(JSON.stringify(issue))}</li>`).join('')
    : '<li>No blocking local technical issues detected.</li>';
  const template = JSON.stringify(bookOneChapterOnePilotFeedbackTemplate(arm, result)).replace(/</g, '\\u003c');
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Book One — Chapter One Pilot Review</title>
<style>
:root{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text",Inter,system-ui,sans-serif;color:#111;background:#f5f5f7}body{margin:0;padding:32px}.wrap{max-width:900px;margin:auto}.hero,.card{background:rgba(255,255,255,.94);border:1px solid #e5e5ea;border-radius:24px;box-shadow:0 12px 40px rgba(0,0,0,.06)}.hero{padding:30px}.card{padding:24px;margin-top:18px}h1{font-size:34px;letter-spacing:-.03em;margin:0 0 8px}h2{font-size:20px;margin:0 0 14px}.muted{color:#6e6e73}.pill{display:inline-block;padding:7px 11px;border-radius:999px;background:#efeff4;margin:6px 6px 0 0;font-size:13px}.good{background:#e7f8ec}.warn{background:#fff4d6}audio{width:100%;margin:14px 0}.decisions{display:flex;gap:10px;flex-wrap:wrap}.decisions button{border:0;border-radius:14px;padding:12px 18px;font-weight:700;font-size:15px;cursor:pointer}.selected{outline:3px solid #111}.pass{background:#dff7e6}.maybe{background:#fff1c9}.fail{background:#ffe0e0}textarea{width:100%;min-height:110px;border:1px solid #d2d2d7;border-radius:14px;padding:12px;font:inherit;box-sizing:border-box}.download{margin-top:14px;background:#111;color:white;border:0;border-radius:14px;padding:13px 18px;font-weight:700;cursor:pointer}code{word-break:break-all}ul{line-height:1.5}</style></head>
<body><div class="wrap"><div class="hero"><div class="muted">YasReady Audiobooks ${escapeHtml(result.release)}</div><h1>Chapter One Production Pilot</h1><p>${escapeHtml(result.chapter.title)}</p>
<span class="pill">${escapeHtml(result.narrator.narratorName)}</span><span class="pill">${escapeHtml(result.lockedRecipe.direction.label)}</span><span class="pill">${escapeHtml(result.lockedRecipe.direction.emotionalVariantLabel)}</span><span class="pill">Effective ${Number(result.lockedRecipe.paceProfile.effectiveSpeed).toFixed(2)}x</span><span class="pill ${qa.passed ? 'good' : 'warn'}">Technical QA: ${qa.passed ? 'PASS' : 'REVIEW'}</span></div>
<div class="card"><h2>Mastered production-format pilot</h2><p class="muted">Listen for natural pace, emotional range, continuity between chunks, character restraint, glitches, repeated/missing words, and whether this feels like the book.</p><audio controls preload="metadata" src="${escapeHtml(result.outputs.masteredPilot)}"></audio></div>
<div class="card"><h2>Technical QA</h2><ul>${issueText}</ul><p class="muted">Duration: ${qa.analysis?.durationSec ?? 'n/a'} sec · sample rate: ${qa.analysis?.sampleRateHz ?? 'n/a'} Hz · bitrate: ${qa.analysis?.bitrateKbps ?? 'n/a'} kbps</p></div>
<div class="card"><h2>Your decision</h2><div class="decisions"><button class="pass" data-decision="pass">PASS — Pilot works</button><button class="maybe" data-decision="maybe">MAYBE — Needs tuning</button><button class="fail" data-decision="fail">FAIL — Stop</button></div><p><textarea id="notes" placeholder="Notes for the next build..."></textarea></p><button class="download" id="download">Download Pilot Feedback</button><p class="muted">A PASS validates this pilot only. It does not arm Chapter Two or the full book.</p></div>
<div class="card"><h2>Safety state</h2><p><strong>Full-book generation armed: NO</strong></p><p class="muted">Pilot arm digest: <code>${escapeHtml(arm.integrity.armDigest)}</code></p></div></div>
<script>const base=${template};let decision='';document.querySelectorAll('[data-decision]').forEach(b=>b.onclick=()=>{decision=b.dataset.decision;document.querySelectorAll('[data-decision]').forEach(x=>x.classList.toggle('selected',x===b));});document.getElementById('download').onclick=()=>{if(!decision){alert('Choose PASS, MAYBE or FAIL first.');return;}const out={...base,decision,notes:document.getElementById('notes').value,exportedAt:new Date().toISOString()};const blob=new Blob([JSON.stringify(out,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='chapter-one-pilot-feedback.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);};</script></body></html>`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function finalizeBookOneChapterOnePilot({ arm, renderResult, feedback } = {}) {
  verifyBookOneChapterOnePilotArm(arm);
  verifyBookOneChapterOnePilotRender(renderResult);
  if (!feedback || feedback.artifact !== 'book-one-chapter-one-pilot-human-feedback') throw new Error('Invalid Chapter One pilot feedback');
  if (feedback.armDigest !== arm.integrity.armDigest) throw new Error('Pilot feedback arm digest mismatch');
  if (feedback.renderDigest !== renderResult.integrity.renderDigest) throw new Error('Pilot feedback render digest mismatch');
  const decision = clean(feedback.decision).toLowerCase();
  if (!['pass', 'maybe', 'fail'].includes(decision)) throw new Error('Pilot feedback decision must be pass, maybe or fail');
  if (decision === 'pass' && !renderResult.technicalQa.passed) throw new Error('Cannot PASS Chapter One pilot while local technical QA has blocking issues');
  const status = decision === 'pass' ? 'PILOT_PASSED' : decision === 'maybe' ? 'PILOT_NEEDS_TUNING' : 'PILOT_FAILED';
  return freeze({
    schemaVersion: 1,
    release: YASREADY_AUDIOBOOKS_VERSION,
    artifact: 'book-one-chapter-one-pilot-finalization',
    status,
    decision,
    book: renderResult.book,
    chapter: renderResult.chapter,
    narrator: renderResult.narrator,
    lockedRecipe: renderResult.lockedRecipe,
    armDigest: arm.integrity.armDigest,
    renderDigest: renderResult.integrity.renderDigest,
    technicalQaPassed: renderResult.technicalQa.passed,
    pilotValidated: decision === 'pass',
    humanNotes: clean(feedback.notes),
    productionArmed: false,
    fullBookGenerationArmed: false,
    nextAction: decision === 'pass'
      ? 'Chapter One pilot is validated. Build the full-production orchestrator next; full-book generation is still unarmed.'
      : decision === 'maybe'
        ? 'Keep the full book off. Tune only the pilot issue(s), then repeat a bounded pilot before scaling.'
        : 'Keep production stopped. Return to the locked recipe/pipeline issue before any additional paid chapters.'
  });
}

export function renderBookOneChapterOnePilotArmMarkdown(arm) {
  verifyBookOneChapterOnePilotArm(arm);
  return [
    '# Book One — Chapter One Pilot Arm', '',
    `**Release:** ${arm.release}`,
    `**Status:** ${arm.status}`,
    `**Scope:** ${arm.pilotScope.chapterTitle} only`,
    `**Provider TTS calls during arm:** ${arm.guardrails.armProviderGenerationCalls}`,
    `**Spend during arm:** $${arm.guardrails.armSpendUsd.toFixed(2)}`,
    `**Full-book generation armed:** NO`, '',
    '## Live preflight', '',
    `- ElevenLabs tier: **${arm.providerPreflight.tier}**`,
    `- Provider-reported used: **${arm.providerPreflight.quota.providerReportedUsed.toLocaleString()}**`,
    `- Provider-reported limit: **${arm.providerPreflight.quota.providerReportedLimit.toLocaleString()}**`,
    `- Provider-reported remaining: **${arm.providerPreflight.quota.providerReportedRemaining.toLocaleString()}**`,
    `- Credits inferred: **NO**`,
    `- FFmpeg: **${arm.ffmpegPreflight.ffmpeg ?? 'healthy'}**`, '',
    '## Pilot budget', '',
    `- Provider calls: **${arm.pilotScope.providerGenerationCalls}**`,
    `- Provider characters: **${arm.pilotScope.providerCharacters.toLocaleString()}**`,
    `- Estimated TTS: **$${arm.budget.estimateUsd.toFixed(2)}**`,
    `- Retry reserve: **$${arm.budget.retryReserveUsd.toFixed(2)}**`,
    `- Protected / hard max: **$${arm.budget.suggestedMaxUsd.toFixed(2)}**`, '',
    '## Explicit approval', '',
    `Token: \`${arm.confirmation.token}\``, '',
    arm.confirmation.instruction, '',
    '**The PLAN token cannot authorize spend. Chapter Two and later remain blocked.**', ''
  ].join('\n');
}

export function renderBookOneChapterOnePilotFinalizationMarkdown(result) {
  return [
    '# Book One — Chapter One Pilot Finalization', '',
    `**Status:** ${result.status}`,
    `**Decision:** ${result.decision.toUpperCase()}`,
    `**Technical QA passed:** ${result.technicalQaPassed ? 'YES' : 'NO'}`,
    `**Pilot validated:** ${result.pilotValidated ? 'YES' : 'NO'}`,
    `**Production armed:** NO`,
    `**Full-book generation armed:** NO`, '',
    '## Target', '',
    `- Narrator: **${result.narrator.narratorName}**`,
    `- Chapter: **${result.chapter.title}**`,
    `- Effective speed: **${Number(result.lockedRecipe.paceProfile.effectiveSpeed).toFixed(2)}**`, '',
    '## Human notes', '',
    result.humanNotes || '_No notes provided._', '',
    '## Next action', '', result.nextAction, ''
  ].join('\n');
}
