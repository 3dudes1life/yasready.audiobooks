import { YASREADY_AUDIOBOOKS_VERSION } from '../release.js';
import { sha256, stableJson } from '../core/hash.js';
import { productionCharacterCap, splitForTts } from '../production/model-limits.js';

export const BOOK_ONE_PRODUCTION_DEFAULT_MODEL = 'eleven_v3';
export const BOOK_ONE_PRODUCTION_DEFAULT_RATE_USD_PER_1K = 0.10;
export const BOOK_ONE_PRODUCTION_DEFAULT_RETRY_RESERVE_RATIO = 0.20;
export const BOOK_ONE_PRODUCTION_DEFAULT_CHUNK_SAFETY_RATIO = 0.80;

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

function wordCount(text) {
  return (String(text ?? '').match(/[\p{L}\p{N}]+(?:[’'-][\p{L}\p{N}]+)*/gu) ?? []).length;
}

function chapterLabel(chapter, index) {
  return clean(chapter?.title) || `Chapter ${index + 1}`;
}

function verifyLockDigest(lock) {
  if (!lock?.lockDigest) throw new Error('Narrator production lock is missing lockDigest');
  const { lockDigest, ...core } = lock;
  const expected = sha256(stableJson(core));
  if (expected !== lockDigest) throw new Error('Narrator production lock digest mismatch');
  return true;
}

export function verifyProductionPlanningSource(paceCeilingFinalization) {
  const finalization = paceCeilingFinalization;
  if (!finalization || finalization.artifact !== 'book-one-pace-ceiling-finalization') {
    throw new Error('Production planning requires book-one-pace-ceiling-finalization.json');
  }
  if (finalization.status !== 'PASSED' || finalization.decision !== 'pass') {
    throw new Error('Production planning requires a PASSED Pace Ceiling finalization');
  }
  if (finalization.narratorProductionLockCreated !== true || !finalization.narratorProductionLock) {
    throw new Error('Production planning requires a narrator production lock');
  }
  if (finalization.productionArmed !== false || finalization.fullBookGenerationArmed !== false) {
    throw new Error('Production planning refuses an already-armed finalization');
  }

  const lock = finalization.narratorProductionLock;
  if (lock.artifact !== 'book-one-narrator-production-lock' || lock.status !== 'LOCKED_FOR_PRODUCTION_PLANNING') {
    throw new Error('Narrator lock is not valid for production planning');
  }
  if (lock.productionArmed !== false || lock.fullBookGenerationArmed !== false) {
    throw new Error('Narrator lock must remain unarmed during production planning');
  }
  if (!lock.narrator?.providerVoiceId || !lock.narrator?.candidateName) {
    throw new Error('Narrator lock is missing provider voice identity');
  }
  if (!lock.performanceProfile?.providerVoiceSettings) {
    throw new Error('Narrator lock is missing provider voice settings');
  }
  verifyLockDigest(lock);

  const pace = lock.performanceProfile.paceProfile;
  if (!pace || !(Number(pace.providerNativeSpeed) > 0) || !(Number(pace.effectiveSpeed) > 0)) {
    throw new Error('Narrator lock is missing reproducible pace settings');
  }
  if (pace.postProcessRequired) {
    if (pace.postProcessKind !== 'ffmpeg-atempo') throw new Error('Unsupported production pace post-process');
    if (!(Number(pace.postProcessTempoMultiplier) > 0)) throw new Error('Pace lock requires a positive tempo multiplier');
    const effective = round(Number(pace.providerNativeSpeed) * Number(pace.postProcessTempoMultiplier), 5);
    if (Math.abs(effective - Number(pace.effectiveSpeed)) > 0.00002) {
      throw new Error('Pace lock provider speed and tempo multiplier do not reproduce effective speed');
    }
  }
  return true;
}

function buildManifest({ manuscriptAnalysis, lock, model, chunkSafetyRatio, explicitChunkCap }) {
  const maxCharsPerCall = productionCharacterCap(model, {
    safetyRatio: chunkSafetyRatio,
    explicitCap: explicitChunkCap
  });
  const chapters = [];
  let globalChunkOrder = 0;

  for (let chapterIndex = 0; chapterIndex < manuscriptAnalysis.chapters.length; chapterIndex += 1) {
    const chapter = manuscriptAnalysis.chapters[chapterIndex];
    const resolvedChapterTitle = chapterLabel(chapter, chapterIndex);
    if (/^front matter$/i.test(resolvedChapterTitle)) continue;
    const chapterChunks = [];
    let chapterWords = 0;
    let chapterCharacters = 0;

    for (let sceneIndex = 0; sceneIndex < chapter.scenes.length; sceneIndex += 1) {
      const scene = chapter.scenes[sceneIndex];
      const sceneText = (scene.segments ?? [])
        .map((segment) => clean(segment.text))
        .filter(Boolean)
        .join('\n');
      if (!sceneText) continue;

      const chunks = splitForTts(sceneText, { maxChars: maxCharsPerCall });
      for (let sceneChunkIndex = 0; sceneChunkIndex < chunks.length; sceneChunkIndex += 1) {
        const text = chunks[sceneChunkIndex];
        const chars = text.length;
        const words = wordCount(text);
        const chunkId = `ch${String(chapterIndex + 1).padStart(2, '0')}-sc${String(sceneIndex + 1).padStart(2, '0')}-c${String(sceneChunkIndex + 1).padStart(2, '0')}`;
        const textDigest = sha256(text);
        const generationDigest = sha256(stableJson({
          sourceHash: manuscriptAnalysis.source.sourceHash,
          lockDigest: lock.lockDigest,
          model,
          chunkId,
          textDigest,
          providerVoiceId: lock.narrator.providerVoiceId,
          providerVoiceSettings: lock.performanceProfile.providerVoiceSettings,
          performanceProfile: lock.performanceProfile
        }));
        chapterChunks.push(freeze({
          globalOrder: globalChunkOrder++,
          id: chunkId,
          chapterOrder: chapterIndex,
          sceneOrder: sceneIndex,
          sceneChunkOrder: sceneChunkIndex,
          characters: chars,
          words,
          textDigest,
          generationDigest,
          providerOutputRelativePath: `production/provider/chapter-${String(chapterIndex + 1).padStart(2, '0')}/${chunkId}.mp3`,
          postProcessOutputRelativePath: lock.performanceProfile.paceProfile.postProcessRequired
            ? `production/tempo/chapter-${String(chapterIndex + 1).padStart(2, '0')}/${chunkId}.mp3`
            : null
        }));
        chapterWords += words;
        chapterCharacters += chars;
      }
    }

    chapters.push(freeze({
      order: chapterIndex,
      title: resolvedChapterTitle,
      sourceTextHash: chapter.textHash ?? null,
      sceneCount: chapter.scenes.length,
      providerGenerationCalls: chapterChunks.length,
      providerCharacters: chapterCharacters,
      words: chapterWords,
      postProcessTasks: lock.performanceProfile.paceProfile.postProcessRequired ? chapterChunks.length : 0,
      chunks: chapterChunks,
      chapterOutputRelativePath: `production/chapters/chapter-${String(chapterIndex + 1).padStart(2, '0')}.mp3`
    }));
  }

  const chunks = chapters.flatMap((chapter) => chapter.chunks);
  return freeze({
    schemaVersion: 1,
    model,
    maxCharactersPerProviderCall: maxCharsPerCall,
    chunkSafetyRatio,
    explicitChunkCap: explicitChunkCap ?? null,
    chapterCount: chapters.length,
    sceneCount: manuscriptAnalysis.metrics.scenes,
    providerGenerationCalls: chunks.length,
    providerCharacters: chunks.reduce((sum, chunk) => sum + chunk.characters, 0),
    words: chunks.reduce((sum, chunk) => sum + chunk.words, 0),
    postProcessTasks: lock.performanceProfile.paceProfile.postProcessRequired ? chunks.length : 0,
    chapterAssemblyTasks: chapters.length,
    chapters
  });
}

function buildBudget({ manifest, rateUsdPer1kCharacters, retryReserveRatio }) {
  const initialGenerationUsd = round((manifest.providerCharacters / 1000) * rateUsdPer1kCharacters, 6);
  const retryReserveUsd = round(initialGenerationUsd * retryReserveRatio, 6);
  const protectedMaxUsd = ceilCents(initialGenerationUsd + retryReserveUsd);
  const retryReserveCallsEquivalent = Math.ceil(manifest.providerGenerationCalls * retryReserveRatio);
  return freeze({
    currency: 'USD',
    pricingBasis: 'planning-rate-per-1000-provider-characters',
    rateUsdPer1kCharacters: rateUsdPer1kCharacters,
    providerCharactersEstimated: manifest.providerCharacters,
    providerCreditsEstimated: null,
    providerCreditsPolicy: 'Do not infer provider credits from dollars. Verify live subscription quota immediately before any paid production arm.',
    initialGenerationUsd,
    retryReserveRatio,
    retryReserveUsd,
    retryReserveCallsEquivalent,
    protectedMaxUsd,
    localTempoProcessingUsd: 0,
    chapterAssemblyUsd: 0,
    planningSpendUsd: 0,
    roundingPolicy: 'protected-max-ceil-to-cent',
    estimateNotInvoice: true
  });
}

function planCore(plan) {
  return {
    schemaVersion: plan.schemaVersion,
    release: plan.release,
    artifact: plan.artifact,
    status: plan.status,
    book: plan.book,
    source: plan.source,
    narratorLock: plan.narratorLock,
    productionRecipe: plan.productionRecipe,
    workload: plan.workload,
    budget: plan.budget,
    manifest: plan.manifest,
    storage: plan.storage,
    qa: plan.qa,
    resumability: plan.resumability,
    guardrails: plan.guardrails
  };
}

export function verifyBookOneProductionPlan(plan, { acceptedReleases = [YASREADY_AUDIOBOOKS_VERSION] } = {}) {
  if (!plan || plan.artifact !== 'book-one-production-plan') throw new Error('Invalid Book One production plan');
  if (!Array.isArray(acceptedReleases) || !acceptedReleases.includes(plan.release)) throw new Error('Production plan release is not accepted by this operation');
  if (plan.status !== 'READY_FOR_SEPARATE_PRODUCTION_ARM') throw new Error('Production plan is not in the expected planning-only state');
  if (plan.guardrails?.planningProviderGenerationCalls !== 0) throw new Error('Production planning must perform zero provider generation calls');
  if (plan.guardrails?.productionArmed !== false || plan.guardrails?.fullBookGenerationArmed !== false) {
    throw new Error('Production plan must remain unarmed');
  }
  if (plan.budget?.planningSpendUsd !== 0) throw new Error('Production planning must remain zero-spend');
  if (!plan.narratorLock?.lockDigest) throw new Error('Production plan is missing narrator lock digest');
  if (plan.narratorLock.lockDigest !== plan.productionRecipe?.lockDigest) throw new Error('Production recipe lock digest mismatch');
  if (plan.source?.sourceHash !== plan.book?.sourceHash) throw new Error('Production plan manuscript source hash mismatch');
  if (plan.manifest?.providerGenerationCalls < 1) throw new Error('Production plan has no provider generation work');
  if (plan.manifest?.providerCharacters < 1) throw new Error('Production plan has no provider characters');
  if (plan.budget?.protectedMaxUsd < plan.budget?.initialGenerationUsd) throw new Error('Protected budget is below the initial estimate');
  if (!plan.integrity?.productionPlanDigest) throw new Error('Production plan is missing integrity digest');
  const expected = sha256(stableJson(planCore(plan)));
  if (expected !== plan.integrity.productionPlanDigest) throw new Error('Production plan integrity digest mismatch');
  if (plan.confirmation?.token !== `PLAN-${expected.slice(0, 10).toUpperCase()}`) throw new Error('Production plan reference token mismatch');
  return true;
}

export function buildBookOneProductionPlan({
  paceCeilingFinalization,
  manuscriptAnalysis,
  model = BOOK_ONE_PRODUCTION_DEFAULT_MODEL,
  rateUsdPer1kCharacters = BOOK_ONE_PRODUCTION_DEFAULT_RATE_USD_PER_1K,
  retryReserveRatio = BOOK_ONE_PRODUCTION_DEFAULT_RETRY_RESERVE_RATIO,
  chunkSafetyRatio = BOOK_ONE_PRODUCTION_DEFAULT_CHUNK_SAFETY_RATIO,
  explicitChunkCap = null
} = {}) {
  verifyProductionPlanningSource(paceCeilingFinalization);
  if (!manuscriptAnalysis?.source?.sourceHash || !Array.isArray(manuscriptAnalysis?.chapters)) {
    throw new Error('Production planning requires a complete analyzed manuscript');
  }
  const lock = paceCeilingFinalization.narratorProductionLock;
  if (!lock.book?.sourceHash) throw new Error('Narrator production lock is missing manuscript source hash');
  if (manuscriptAnalysis.source.sourceHash !== lock.book.sourceHash) {
    throw new Error('Manuscript source hash does not match the locked Book One source');
  }

  const rate = Number(rateUsdPer1kCharacters);
  const reserveRatio = Number(retryReserveRatio);
  const safetyRatio = Number(chunkSafetyRatio);
  const explicitCap = explicitChunkCap === null || explicitChunkCap === undefined ? null : Number(explicitChunkCap);
  if (!(rate >= 0)) throw new Error('rateUsdPer1kCharacters must be zero or greater');
  if (!(reserveRatio >= 0 && reserveRatio <= 1)) throw new Error('retryReserveRatio must be between 0 and 1');
  if (!(safetyRatio >= 0.25 && safetyRatio <= 1)) throw new Error('chunkSafetyRatio must be between 0.25 and 1');
  if (explicitCap !== null && (!Number.isInteger(explicitCap) || explicitCap < 1)) throw new Error('explicitChunkCap must be a positive integer');

  const manifest = buildManifest({
    manuscriptAnalysis,
    lock,
    model,
    chunkSafetyRatio: safetyRatio,
    explicitChunkCap: explicitCap
  });
  const budget = buildBudget({ manifest, rateUsdPer1kCharacters: rate, retryReserveRatio: reserveRatio });
  const pace = lock.performanceProfile.paceProfile;
  const nominalMinutes = Number(manuscriptAnalysis.metrics.estimatedMinutesAt155Wpm ?? 0);
  const paceAdjustedMinutes = pace?.effectiveSpeed > 0 ? round(nominalMinutes / Number(pace.effectiveSpeed), 1) : nominalMinutes;

  const basePlan = {
    schemaVersion: 1,
    release: YASREADY_AUDIOBOOKS_VERSION,
    artifact: 'book-one-production-plan',
    status: 'READY_FOR_SEPARATE_PRODUCTION_ARM',
    book: freeze({
      id: lock.book.id ?? null,
      title: lock.book.title ?? manuscriptAnalysis.metadata?.title ?? null,
      author: lock.book.author ?? manuscriptAnalysis.metadata?.author ?? null,
      sourceHash: lock.book.sourceHash
    }),
    source: freeze({
      format: manuscriptAnalysis.source.format,
      filename: manuscriptAnalysis.source.filename,
      sourceHash: manuscriptAnalysis.source.sourceHash,
      normalizedTextHash: manuscriptAnalysis.source.normalizedTextHash ?? null,
      analyzerSchemaVersion: manuscriptAnalysis.schemaVersion,
      warnings: manuscriptAnalysis.warnings ?? []
    }),
    narratorLock: freeze({
      lockDigest: lock.lockDigest,
      status: lock.status,
      narrator: lock.narrator,
      readinessEvidence: lock.readinessEvidence
    }),
    productionRecipe: freeze({
      lockDigest: lock.lockDigest,
      provider: lock.narrator.provider,
      providerVoiceId: lock.narrator.providerVoiceId,
      narratorName: lock.narrator.candidateName,
      model,
      performanceDirection: freeze({
        id: lock.performanceProfile.baseDirectionId,
        label: lock.performanceProfile.baseDirectionLabel,
        emotionalVariantId: lock.performanceProfile.emotionalVariantId,
        emotionalVariantLabel: lock.performanceProfile.emotionalVariantLabel,
        emotionalRange: lock.performanceProfile.emotionalRange,
        stability: lock.performanceProfile.stability
      }),
      providerVoiceSettings: lock.performanceProfile.providerVoiceSettings,
      paceProfile: pace,
      dynamicRangePolicy: lock.performanceProfile.dynamicRangePolicy,
      restraint: lock.performanceProfile.restraint,
      characterDirection: freeze({
        narrator: lock.performanceProfile.narrator,
        juan: lock.performanceProfile.juan,
        michael: lock.performanceProfile.michael,
        christopher: lock.performanceProfile.christopher,
        identityInferenceFromAudio: false
      })
    }),
    workload: freeze({
      words: manuscriptAnalysis.metrics.words,
      chapters: manuscriptAnalysis.metrics.chapters,
      scenes: manuscriptAnalysis.metrics.scenes,
      segments: manuscriptAnalysis.metrics.segments,
      dialogueSegments: manuscriptAnalysis.metrics.dialogueSegments,
      narrationSegments: manuscriptAnalysis.metrics.narrationSegments,
      providerGenerationCalls: manifest.providerGenerationCalls,
      providerCharacters: manifest.providerCharacters,
      postProcessTasks: manifest.postProcessTasks,
      chapterAssemblyTasks: manifest.chapterAssemblyTasks,
      nominalMinutesAt155Wpm: nominalMinutes,
      paceAdjustedPlanningMinutes: paceAdjustedMinutes,
      paceAdjustedPlanningHours: round(paceAdjustedMinutes / 60, 2),
      runtimeEstimatePolicy: 'Planning estimate only; actual narrator duration must be measured from rendered audio.'
    }),
    budget,
    manifest,
    storage: freeze({
      root: 'production/',
      providerAudio: 'production/provider/chapter-XX/<chunk-id>.mp3',
      tempoAudio: pace.postProcessRequired ? 'production/tempo/chapter-XX/<chunk-id>.mp3' : null,
      chapterAudio: 'production/chapters/chapter-XX.mp3',
      state: 'production/production-state.json',
      costLedger: 'production/production-cost-ledger.json',
      qa: 'production/qa/',
      finalMaster: 'production/master/'
    }),
    qa: freeze({
      preArm: [
        'Recompute and match narrator lock digest',
        'Recompute and match manuscript source hash',
        'Verify live provider subscription/quota without generating audio',
        'Verify FFmpeg health because the locked pace requires pitch-preserving local tempo',
        'Require a separate explicit production arm and spend ceiling'
      ],
      pilot: [
        'Generate only the separately approved pilot scope first',
        'Verify provider settings and lock digest are embedded in production state',
        'Verify FFmpeg effective 1.25 output before any full-book arm',
        'Human-listen to the production-format pilot before scaling'
      ],
      chapter: [
        'Verify every planned chunk digest exists exactly once',
        'Check missing/duplicate chunks before chapter assembly',
        'Run continuity/text QA against the source chunk digests',
        'Measure actual duration and flag abnormal pacing or silence'
      ],
      final: [
        'All chapters complete with no unresolved failed chunks',
        'Cost ledger reconciled against captured or estimated provider billing',
        'Mastering and distribution QA remain separate downstream gates'
      ]
    }),
    resumability: freeze({
      unit: 'generationDigest',
      paidBaseReuseRequired: true,
      completedProviderChunkNeverRegeneratedByDefault: true,
      localTempoFailureSafeToRerunWithoutProvider: true,
      providerSuccessLocalStorageFailure: 'DO_NOT_RERUN_PROVIDER — recover/store the paid response first',
      partialRunPolicy: 'Resume only missing generation digests after state and storage reconciliation',
      overwritePolicy: 'Explicit operator override required to replace a completed paid chunk'
    }),
    guardrails: freeze({
      planningProviderGenerationCalls: 0,
      planningSpendUsd: 0,
      noPaidGenerationInThisRelease: true,
      explicitProductionArmRequired: true,
      exactNarratorLockDigestRequired: true,
      exactManuscriptSourceHashRequired: true,
      providerSubscriptionPreflightRequiredAtArm: true,
      ffmpegPreflightRequiredAtArm: Boolean(pace.postProcessRequired),
      productionArmed: false,
      fullBookGenerationArmed: false,
      planTokenIsNotSpendAuthorization: true,
      identityInferenceFromAudio: false
    })
  };

  const productionPlanDigest = sha256(stableJson(planCore(basePlan)));
  const plan = freeze({
    ...basePlan,
    integrity: freeze({
      productionPlanDigest,
      narratorLockDigest: lock.lockDigest,
      manuscriptSourceHash: manuscriptAnalysis.source.sourceHash
    }),
    confirmation: freeze({
      token: `PLAN-${productionPlanDigest.slice(0, 10).toUpperCase()}`,
      semantics: 'REFERENCE_ONLY_NOT_SPEND_AUTHORIZATION',
      instruction: 'This token identifies the immutable planning artifact. It cannot arm or authorize production.'
    }),
    nextAction: 'Stop here safely or build the separate Production Arm & Chapter One Pilot release. Full-book generation remains unarmed.'
  });
  verifyBookOneProductionPlan(plan);
  return plan;
}

function money(value) {
  return Number(value ?? 0).toFixed(2);
}

export function renderBookOneProductionPlanMarkdown(plan) {
  verifyBookOneProductionPlan(plan);
  const pace = plan.productionRecipe.paceProfile;
  const lines = [
    '# Book One Production Plan & Budget', '',
    `**Release:** ${plan.release}`,
    `**Status:** ${plan.status}`,
    `**Planning spend:** $${money(plan.budget.planningSpendUsd)}`,
    `**Provider generation performed:** ${plan.guardrails.planningProviderGenerationCalls}`,
    `**Production armed:** ${plan.guardrails.productionArmed ? 'YES' : 'NO'}`,
    `**Full-book generation armed:** ${plan.guardrails.fullBookGenerationArmed ? 'YES' : 'NO'}`, '',
    '## Locked production recipe', '',
    `- Narrator: **${plan.productionRecipe.narratorName}**`,
    `- Voice ID: \`${plan.productionRecipe.providerVoiceId}\``,
    `- Direction: **${plan.productionRecipe.performanceDirection.label}**`,
    `- Emotion: **${plan.productionRecipe.performanceDirection.emotionalVariantLabel}**`,
    `- Stability: **${plan.productionRecipe.performanceDirection.stability}**`,
    `- Provider speed: **${Number(pace.providerNativeSpeed).toFixed(2)}**`,
    `- Effective speed: **${Number(pace.effectiveSpeed).toFixed(2)}**`,
    `- FFmpeg tempo: **${pace.postProcessRequired ? `${Number(pace.postProcessTempoMultiplier).toFixed(6)}x` : 'not required'}**`,
    `- Narrator lock digest: \`${plan.narratorLock.lockDigest}\``, '',
    '## Workload', '',
    `- Words: **${plan.workload.words.toLocaleString()}**`,
    `- Chapters/sections analyzed: **${plan.workload.chapters}**`,
    `- Scenes: **${plan.workload.scenes}**`,
    `- Planned provider calls: **${plan.workload.providerGenerationCalls}**`,
    `- Planned provider characters: **${plan.workload.providerCharacters.toLocaleString()}**`,
    `- Local tempo tasks: **${plan.workload.postProcessTasks}**`,
    `- Chapter assembly tasks: **${plan.workload.chapterAssemblyTasks}**`,
    `- Planning runtime estimate: **${plan.workload.paceAdjustedPlanningHours.toFixed(2)} hours** (estimate only; actual rendered duration wins)`, '',
    '## Budget', '',
    `- Planning rate: **$${plan.budget.rateUsdPer1kCharacters.toFixed(2)} / 1,000 provider characters**`,
    `- Initial generation estimate: **$${money(plan.budget.initialGenerationUsd)}**`,
    `- Retry reserve: **${Math.round(plan.budget.retryReserveRatio * 100)}% / $${money(plan.budget.retryReserveUsd)}**`,
    `- Protected production max recommendation: **$${money(plan.budget.protectedMaxUsd)}**`,
    `- Local FFmpeg tempo cost: **$${money(plan.budget.localTempoProcessingUsd)} TTS spend**`,
    `- Provider credits: **not inferred**; verify live subscription quota at the production arm gate`, '',
    '## Resumability / duplicate-spend protection', '',
    '- Every planned provider chunk has a deterministic `generationDigest`.',
    '- Completed paid chunks are reused and are never regenerated by default.',
    '- FFmpeg failure is safe to rerun locally without repeating provider TTS.',
    '- Provider success followed by local storage failure is **DO NOT RERUN PROVIDER** until the paid response is recovered/reconciled.',
    '- Partial production resumes only missing digests after state/storage reconciliation.', '',
    '## Chapter budget map', '',
    '| # | Chapter | Calls | Provider chars | Tempo tasks |',
    '|---:|---|---:|---:|---:|'
  ];
  for (const chapter of plan.manifest.chapters) {
    lines.push(`| ${chapter.order + 1} | ${chapter.title.replace(/\|/g, '\\|')} | ${chapter.providerGenerationCalls} | ${chapter.providerCharacters.toLocaleString()} | ${chapter.postProcessTasks} |`);
  }
  lines.push(
    '', '## Safety gate', '',
    `**${YASREADY_AUDIOBOOKS_VERSION} cannot generate production audio.** The plan token is reference-only and is not a spend authorization.`,
    '', `Plan reference: \`${plan.confirmation.token}\``,
    '', '## Next action', '', plan.nextAction, ''
  );
  return lines.join('\n');
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function renderBookOneProductionBudgetCsv(plan) {
  verifyBookOneProductionPlan(plan);
  const rows = [[
    'chapter_order', 'chapter_title', 'scene_count', 'provider_calls', 'provider_characters',
    'postprocess_tasks', 'estimated_initial_usd', 'estimated_with_retry_reserve_usd'
  ]];
  for (const chapter of plan.manifest.chapters) {
    const initial = round((chapter.providerCharacters / 1000) * plan.budget.rateUsdPer1kCharacters, 6);
    const protectedEstimate = round(initial * (1 + plan.budget.retryReserveRatio), 6);
    rows.push([
      chapter.order + 1,
      chapter.title,
      chapter.sceneCount,
      chapter.providerGenerationCalls,
      chapter.providerCharacters,
      chapter.postProcessTasks,
      initial.toFixed(6),
      protectedEstimate.toFixed(6)
    ]);
  }
  rows.push([
    'TOTAL', '', plan.manifest.sceneCount, plan.manifest.providerGenerationCalls,
    plan.manifest.providerCharacters, plan.manifest.postProcessTasks,
    plan.budget.initialGenerationUsd.toFixed(6),
    plan.budget.protectedMaxUsd.toFixed(2)
  ]);
  return `${rows.map((row) => row.map(csvCell).join(',')).join('\n')}\n`;
}
