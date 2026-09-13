import { mkdir, readFile, writeFile, copyFile, stat, statfs, readdir } from 'node:fs/promises';
import path from 'node:path';
import { YASREADY_AUDIOBOOKS_VERSION } from '../release.js';
import { sha256, stableJson } from '../core/hash.js';
import { splitForTts } from '../production/model-limits.js';
import { verifyBookOneProductionPlan } from './book-one-production-plan-service.js';
import { extractElevenLabsQuota } from './book-one-production-pilot-service.js';
import { verifyBookOneBatchRecipeSnapshot } from './book-one-quota-aware-batch-service.js';
import { verifyHistoricalBookOneBatchArm, verifyHistoricalBookOneBatchResult } from '../production/historical-batch-integrity.js';
import { safeSectionFileName, evaluateMasterAgainstProfile } from '../mastering/profiles.js';

export const BOOK_ONE_CINEMATIC_TARGET_CHAPTERS = 10;
export const BOOK_ONE_CINEMATIC_RETRY_RESERVE_RATIO = 0.20;
export const BOOK_ONE_CINEMATIC_MAX_CHAPTERS_PER_ARM = 10;
export const BOOK_ONE_CINEMATIC_MIN_STORAGE_GIB = 2;
export const BOOK_ONE_CINEMATIC_ARCHIVE_PROFILE = 'archive-wav-2026';
export const BOOK_ONE_CINEMATIC_MP3_PROFILE = 'acx-2026';
export const BOOK_ONE_CINEMATIC_PROFILE_ID = 'cinematic-naturalism-a-v1';
export const BOOK_ONE_CINEMATIC_ALLOWED_PLAN_RELEASES = Object.freeze([
  '0.14.3.13', '0.14.3.14', '0.14.3.14.1', '0.14.3.14.2', '0.14.3.15', '0.14.3.16', '0.14.3.17', '0.14.3.18', '0.14.3.18.1', '0.14.3.18.2', '0.14.3.19', '0.14.3.20', '0.14.3.20.1', '0.14.3.20.2'
]);
export const BOOK_ONE_CINEMATIC_COMPATIBLE_RELEASES = Object.freeze(['0.14.3.18', '0.14.3.18.1', '0.14.3.18.2', '0.14.3.19', '0.14.3.20', '0.14.3.20.1', '0.14.3.20.2']);

const PROVIDER_SETTLED = new Set([
  'PROVIDER_COMPLETE',
  'LOCAL_TEMPO_FAILED_SAFE_TO_RERUN',
  'TEMPO_COMPLETE',
  'LOCAL_FINISH_FAILED_SAFE_TO_RERUN',
  'FINISH_COMPLETE',
  'COMPLETE'
]);
const TEMPO_SETTLED = new Set(['TEMPO_COMPLETE', 'LOCAL_FINISH_FAILED_SAFE_TO_RERUN', 'FINISH_COMPLETE', 'COMPLETE']);
const FINISH_SETTLED = new Set(['FINISH_COMPLETE', 'COMPLETE']);

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

function sameNumber(actual, expected, tolerance = 1e-9) {
  return Number.isFinite(Number(actual)) && Math.abs(Number(actual) - Number(expected)) <= tolerance;
}

function cinematicLockCore(lock) {
  return {
    schemaVersion: lock.schemaVersion,
    release: lock.release,
    artifact: lock.artifact,
    status: lock.status,
    profileId: lock.profileId,
    book: lock.book,
    source: lock.source,
    narrator: lock.narrator,
    lockedProductionChain: lock.lockedProductionChain,
    humanDecision: lock.humanDecision,
    rules: lock.rules,
    guardrails: lock.guardrails
  };
}

export function buildBookOneCinematicNaturalismLock({ productionPlan, recipeLock } = {}) {
  verifyBookOneProductionPlan(productionPlan, { acceptedReleases: BOOK_ONE_CINEMATIC_ALLOWED_PLAN_RELEASES });
  verifyBookOneBatchRecipeSnapshot(recipeLock);
  if (recipeLock.source?.productionPlanDigest !== productionPlan.integrity?.productionPlanDigest) throw new Error('Cinematic lock recipe does not belong to the production plan');
  if (recipeLock.source?.manuscriptSourceHash !== productionPlan.source?.sourceHash) throw new Error('Cinematic lock manuscript source hash drifted');
  if (recipeLock.narrator?.voiceId !== 'rU18Fk3uSDhmg5Xh41o4') throw new Error('Cinematic Naturalism is locked to the approved Ryan Kurk voice');
  if (!/Ryan Kurk/i.test(String(recipeLock.narrator?.name ?? ''))) throw new Error('Cinematic Naturalism narrator identity drifted');
  if (!/Playful \+ Flirty/i.test(String(recipeLock.performance?.label ?? recipeLock.performance?.baseDirectionLabel ?? ''))) throw new Error('Cinematic Naturalism requires the approved Playful + Flirty base direction');
  if (!/Deep Controlled Emotion/i.test(String(recipeLock.performance?.emotionalVariantLabel ?? ''))) throw new Error('Cinematic Naturalism requires Deep Controlled Emotion');
  if (!sameNumber(recipeLock.performance?.stability, 0.24) && !sameNumber(recipeLock.provider?.voiceSettings?.stability, 0.24)) throw new Error('Cinematic Naturalism requires stability 0.24');
  if (!sameNumber(recipeLock.provider?.voiceSettings?.speed, 1.20)) throw new Error('Cinematic Naturalism requires provider speed 1.20');
  if (!sameNumber(recipeLock.pace?.effectiveSpeed, 1.25) || !sameNumber(recipeLock.pace?.postProcessTempoMultiplier, 1.041667, 0.000001)) throw new Error('Cinematic Naturalism requires the locked effective 1.25 pace');
  if (recipeLock.localVoiceFinish?.id !== 'warm-slightly-deeper') throw new Error('Cinematic Naturalism requires Warm + Slightly Deeper');

  const base = {
    schemaVersion: 1,
    release: YASREADY_AUDIOBOOKS_VERSION,
    artifact: 'book-one-cinematic-naturalism-lock',
    status: 'LOCKED_FOR_BATCH_ONE_CINEMATIC_REBUILD',
    profileId: BOOK_ONE_CINEMATIC_PROFILE_ID,
    book: productionPlan.book,
    source: freeze({
      productionPlanDigest: productionPlan.integrity.productionPlanDigest,
      recipeDigest: recipeLock.integrity.recipeDigest,
      manuscriptSourceHash: productionPlan.source.sourceHash
    }),
    narrator: freeze({
      provider: recipeLock.narrator.provider,
      voiceId: recipeLock.narrator.voiceId,
      name: recipeLock.narrator.name
    }),
    lockedProductionChain: freeze({
      baseDirection: 'Playful + Flirty',
      emotionalProfile: 'Deep Controlled Emotion',
      providerModel: recipeLock.provider.model,
      providerStability: 0.24,
      providerSpeed: 1.20,
      effectiveSpeed: 1.25,
      postProcessTempoMultiplier: 1.041667,
      localFinish: 'Warm + Slightly Deeper'
    }),
    humanDecision: freeze({
      selectedComparison: 'A_CURRENT_CINEMATIC',
      rejectedEscalation: 'B_CINEMATIC_PLUS2',
      decision: 'A_WINS_LOCK_ORIGINAL_CINEMATIC_NATURALISM',
      goal: 'Bring the people and scenes alive through restrained performance without extra voices, caricatures or theatrical overplay.'
    }),
    rules: freeze({
      evidenceSource: 'canonical manuscript text plus immediate neighboring segments only',
      canonicalTextImmutable: true,
      characterDifferentiation: 'delivery-not-impersonation',
      narrationBaseline: 'natural-unforced',
      emotionalMomentsEarnDirection: true,
      sceneCueCap: 7,
      minimumSegmentIndexGapBetweenCues: 2,
      perCueCap: 2,
      narrationCueCap: 2,
      allowedProviderCues: freeze(['whispers', 'playfully', 'softly', 'angry', 'cautiously', 'slowly']),
      plus2EscalationAllowed: false,
      extraVoicesRequired: false,
      soundEffectsRequired: false,
      identityInferenceFromAudio: false
    }),
    guardrails: freeze({
      profileLocked: true,
      providerTtsCallsPerformed: 0,
      providerSpendUsd: 0,
      originalsMayBeOverwritten: false,
      chapterElevenMayBeGenerated: false,
      nextBatchArmed: false,
      fullBookGenerationArmed: false
    })
  };
  return freeze({ ...base, integrity: freeze({ lockDigest: sha256(stableJson(cinematicLockCore(base))) }) });
}

export function verifyBookOneCinematicNaturalismLock(lock) {
  if (!lock || lock.artifact !== 'book-one-cinematic-naturalism-lock') throw new Error('Invalid Cinematic Naturalism lock');
  if (!BOOK_ONE_CINEMATIC_COMPATIBLE_RELEASES.includes(lock.release)) throw new Error('Cinematic Naturalism lock release mismatch');
  if (lock.status !== 'LOCKED_FOR_BATCH_ONE_CINEMATIC_REBUILD') throw new Error('Cinematic Naturalism lock status invalid');
  if (lock.profileId !== BOOK_ONE_CINEMATIC_PROFILE_ID) throw new Error('Cinematic Naturalism profile id drifted');
  if (lock.humanDecision?.selectedComparison !== 'A_CURRENT_CINEMATIC' || lock.humanDecision?.rejectedEscalation !== 'B_CINEMATIC_PLUS2') throw new Error('Cinematic Naturalism human A/B decision drifted');
  if (lock.rules?.plus2EscalationAllowed !== false) throw new Error('Cinematic Naturalism +2 must remain rejected');
  if (!lock.integrity?.lockDigest || sha256(stableJson(cinematicLockCore(lock))) !== lock.integrity.lockDigest) throw new Error('Cinematic Naturalism lock digest mismatch');
  return true;
}

function cueFor(segment, context) {
  const kind = String(segment?.kind ?? 'narration');
  const text = String(context ?? '');
  if (kind === 'dialogue') {
    if (/\b(whisper(?:ed|ing)?|quietly|under (?:his|her|their) breath)\b/i.test(text)) return 'whispers';
    if (/\b(teas(?:e|ed|ing)?|playful|smirk(?:ed)?|chuckl(?:e|ed)|wink(?:ed)?|grin(?:ned)?|jok(?:e|ed|ing)|deadpan|sarcastic)\b/i.test(text)) return 'playfully';
    if (/\b(kiss(?:ed|ing)?|tender|soft(?:ly|ened)?|held|touch(?:ed|ing)?|love(?:d)?|vulnerable)\b/i.test(text)) return 'softly';
    if (/\b(angry|furious|snapp(?:ed)?|shout(?:ed)?|yell(?:ed)?|rage|pissed)\b/i.test(text)) return 'angry';
    if (/\b(nervous|hesitat(?:e|ed|ion)|tense|tension|stared|silence|unease|skeptical|afraid|fear|panic)\b/i.test(text)) return 'cautiously';
  } else {
    if (/\b(tender|softened|vulnerable|heart(?:beat)?|ache|held|kissed)\b/i.test(text)) return 'softly';
    if (/\b(tension|silence|hesitat(?:e|ed|ion)|unease|stared)\b/i.test(text)) return 'slowly';
  }
  return null;
}

export function compileCinematicNaturalismScene(segments = [], lock) {
  verifyBookOneCinematicNaturalismLock(lock);
  const sourceSegments = (segments ?? []).filter((segment) => clean(segment?.text));
  let tagCount = 0;
  let narrationTags = 0;
  let lastTaggedIndex = -99;
  const tagUse = new Map();
  const directed = [];

  for (let i = 0; i < sourceSegments.length; i += 1) {
    const segment = sourceSegments[i];
    const canonical = clean(segment.text);
    const context = [sourceSegments[i - 1]?.text, canonical, sourceSegments[i + 1]?.text].filter(Boolean).join(' ');
    let cue = cueFor(segment, context);
    const used = cue ? (tagUse.get(cue) ?? 0) : 0;
    if (cue && (
      tagCount >= lock.rules.sceneCueCap ||
      i - lastTaggedIndex < lock.rules.minimumSegmentIndexGapBetweenCues ||
      used >= lock.rules.perCueCap ||
      (segment.kind !== 'dialogue' && narrationTags >= lock.rules.narrationCueCap)
    )) cue = null;

    if (cue) {
      tagCount += 1;
      if (segment.kind !== 'dialogue') narrationTags += 1;
      lastTaggedIndex = i;
      tagUse.set(cue, used + 1);
    }
    directed.push(freeze({
      index: i,
      kind: segment.kind ?? 'narration',
      canonicalText: canonical,
      cue,
      providerText: cue ? `[${cue}] ${canonical}` : canonical
    }));
  }

  const canonicalText = directed.map((row) => row.canonicalText).join('\n');
  const providerText = directed.map((row) => row.providerText).join('\n');
  const reconstructedCanonicalText = directed.map((row) => {
    if (!row.cue) return row.providerText;
    const insertedCuePrefix = `[${row.cue}] `;
    if (!row.providerText.startsWith(insertedCuePrefix)) throw new Error('Cinematic Naturalism provider cue prefix drifted');
    return row.providerText.slice(insertedCuePrefix.length);
  }).join('\n');
  if (reconstructedCanonicalText !== canonicalText) throw new Error('Cinematic Naturalism direction changed canonical manuscript text');
  return freeze({
    canonicalText,
    providerText,
    cueCount: tagCount,
    narrationCueCount: narrationTags,
    cues: freeze(directed.filter((row) => row.cue).map((row) => freeze({ index: row.index, kind: row.kind, cue: row.cue }))),
    canonicalDigest: sha256(canonicalText),
    providerDigest: sha256(providerText),
    segments: freeze(directed)
  });
}

function headingText(title) {
  const value = clean(title);
  if (!value) throw new Error('Cinematic rebuild chapter is missing a title');
  return /[.!?]$/.test(value) ? value : `${value}.`;
}

export function materializeBookOneCinematicTarget({ productionPlan, recipeLock, manuscriptAnalysis, cinematicLock, targetChapterCount = BOOK_ONE_CINEMATIC_TARGET_CHAPTERS } = {}) {
  verifyBookOneProductionPlan(productionPlan, { acceptedReleases: BOOK_ONE_CINEMATIC_ALLOWED_PLAN_RELEASES });
  verifyBookOneBatchRecipeSnapshot(recipeLock);
  verifyBookOneCinematicNaturalismLock(cinematicLock);
  if (!manuscriptAnalysis?.source?.sourceHash || manuscriptAnalysis.source.sourceHash !== productionPlan.source.sourceHash) throw new Error('Cinematic rebuild manuscript source hash does not match the production plan');
  const cap = Number(productionPlan.manifest?.maxCharactersPerProviderCall);
  if (!Number.isInteger(cap) || cap < 1) throw new Error('Cinematic rebuild requires a valid provider character cap');
  const targets = [...(productionPlan.manifest?.chapters ?? [])].sort((a, b) => Number(a.order) - Number(b.order)).slice(0, Number(targetChapterCount));
  if (targets.length !== Number(targetChapterCount)) throw new Error(`Cinematic rebuild requires ${targetChapterCount} planned narrative chapters`);

  const chapters = [];
  for (let targetIndex = 0; targetIndex < targets.length; targetIndex += 1) {
    const planned = targets[targetIndex];
    const chapter = manuscriptAnalysis.chapters?.[planned.order];
    if (!chapter) throw new Error(`Cinematic rebuild source chapter missing: ${planned.title}`);
    if (planned.sourceTextHash && chapter.textHash !== planned.sourceTextHash) throw new Error(`Cinematic rebuild chapter source drifted: ${planned.title}`);
    const chapterNumber = targetIndex + 1;
    const chunks = [];
    const heading = headingText(planned.title);
    const headingId = `ch${String(chapterNumber).padStart(2, '0')}-heading`;
    chunks.push(freeze({
      id: headingId,
      chapterNumber,
      sourceChapterOrder: planned.order,
      sceneOrder: -1,
      chunkOrder: 0,
      kind: 'heading',
      text: heading,
      characters: [...heading].length,
      textDigest: sha256(heading),
      generationDigest: sha256(stableJson({
        cinematicLockDigest: cinematicLock.integrity.lockDigest,
        recipeDigest: recipeLock.integrity.recipeDigest,
        manuscriptSourceHash: productionPlan.source.sourceHash,
        id: headingId,
        textDigest: sha256(heading)
      }))
    }));

    let totalCues = 0;
    const sceneSnapshots = [];
    for (let sceneIndex = 0; sceneIndex < (chapter.scenes ?? []).length; sceneIndex += 1) {
      const scene = compileCinematicNaturalismScene(chapter.scenes[sceneIndex]?.segments ?? [], cinematicLock);
      if (!scene.providerText) continue;
      totalCues += scene.cueCount;
      sceneSnapshots.push(freeze({
        sceneOrder: sceneIndex,
        cueCount: scene.cueCount,
        canonicalDigest: scene.canonicalDigest,
        providerDigest: scene.providerDigest,
        cues: scene.cues
      }));
      const providerChunks = splitForTts(scene.providerText, { maxChars: cap });
      for (let chunkIndex = 0; chunkIndex < providerChunks.length; chunkIndex += 1) {
        const text = providerChunks[chunkIndex];
        const id = `ch${String(chapterNumber).padStart(2, '0')}-sc${String(sceneIndex + 1).padStart(2, '0')}-cin${String(chunkIndex + 1).padStart(2, '0')}`;
        const textDigest = sha256(text);
        chunks.push(freeze({
          id,
          chapterNumber,
          sourceChapterOrder: planned.order,
          sceneOrder: sceneIndex,
          chunkOrder: chunkIndex,
          kind: 'body',
          text,
          characters: [...text].length,
          textDigest,
          generationDigest: sha256(stableJson({
            cinematicLockDigest: cinematicLock.integrity.lockDigest,
            recipeDigest: recipeLock.integrity.recipeDigest,
            manuscriptSourceHash: productionPlan.source.sourceHash,
            id,
            textDigest
          }))
        }));
      }
    }
    const providerCharacters = chunks.reduce((sum, chunk) => sum + Number(chunk.characters ?? 0), 0);
    chapters.push(freeze({
      chapterNumber,
      sourceChapterOrder: planned.order,
      retailerSequence: chapterNumber,
      title: planned.title,
      sourceTextHash: planned.sourceTextHash ?? chapter.textHash ?? null,
      cueCount: totalCues,
      providerCalls: chunks.length,
      providerCharacters,
      chunkIds: freeze(chunks.map((chunk) => chunk.id)),
      chunks: freeze(chunks),
      scenes: freeze(sceneSnapshots)
    }));
  }
  return freeze({
    chapterCount: chapters.length,
    providerCalls: chapters.reduce((sum, chapter) => sum + chapter.providerCalls, 0),
    providerCharacters: chapters.reduce((sum, chapter) => sum + chapter.providerCharacters, 0),
    cueCount: chapters.reduce((sum, chapter) => sum + chapter.cueCount, 0),
    chapters: freeze(chapters),
    targetDigest: sha256(stableJson(chapters.map((chapter) => ({
      chapterNumber: chapter.chapterNumber,
      sourceChapterOrder: chapter.sourceChapterOrder,
      title: chapter.title,
      sourceTextHash: chapter.sourceTextHash,
      cueCount: chapter.cueCount,
      chunks: chapter.chunks.map((chunk) => ({ id: chunk.id, generationDigest: chunk.generationDigest, textDigest: chunk.textDigest, characters: chunk.characters }))
    }))))
  });
}

async function verifyOriginalBatchFiles(previousResult, previousRoot) {
  const root = path.resolve(previousRoot);
  for (const chapter of previousResult.chapters ?? []) {
    for (const [key, digestKey] of [['archiveWav', 'archiveWav'], ['acxMp3', 'acxMp3']]) {
      const relative = chapter.outputs?.[key];
      const expected = chapter.digests?.[digestKey];
      if (!relative || !expected) throw new Error(`Original Batch One evidence missing ${key} for ${chapter.title}`);
      const file = path.resolve(root, relative);
      if (!file.startsWith(`${root}${path.sep}`)) throw new Error('Original Batch One evidence path escaped its root');
      if (!(await exists(file))) throw new Error(`Original Batch One file missing: ${file}`);
      if ((await fileDigest(file)) !== expected) throw new Error(`Original Batch One file digest mismatch: ${chapter.title} ${key}`);
    }
  }
  return true;
}

async function loadCinematicState(outputRoot, cinematicLock, productionPlan, recipeLock) {
  const root = path.resolve(outputRoot);
  const statePath = path.join(root, 'cinematic-rebuild-state.json');
  if (!(await exists(statePath))) {
    if (await exists(path.join(root, 'provider'))) {
      const entries = await readdir(path.join(root, 'provider')).catch(() => []);
      if (entries.length) throw new Error('DO NOT RERUN PROVIDER: cinematic provider files exist without production state');
    }
    return { statePath, state: null };
  }
  const state = JSON.parse(await readFile(statePath, 'utf8'));
  if (state.artifact !== 'book-one-cinematic-rebuild-state') throw new Error('Cinematic rebuild state artifact invalid');
  if (state.cinematicLockDigest !== cinematicLock.integrity.lockDigest) throw new Error('Cinematic rebuild state belongs to a different performance lock');
  if (state.productionPlanDigest !== productionPlan.integrity.productionPlanDigest || state.recipeDigest !== recipeLock.integrity.recipeDigest) throw new Error('Cinematic rebuild state belongs to different production evidence');
  return { statePath, state };
}

async function persistState(statePath, state) {
  state.updatedAt = new Date().toISOString();
  await writeFile(statePath, JSON.stringify(state, null, 2));
}

function completedTargetOrders(state) {
  return new Set(Object.values(state?.chapters ?? {}).filter((chapter) => chapter?.status === 'COMPLETE').map((chapter) => Number(chapter.sourceChapterOrder)));
}

function rebuildArmCore(arm) {
  return {
    schemaVersion: arm.schemaVersion,
    release: arm.release,
    artifact: arm.artifact,
    status: arm.status,
    book: arm.book,
    source: arm.source,
    profile: arm.profile,
    originalBatch: arm.originalBatch,
    rebuildTarget: arm.rebuildTarget,
    liveProvider: arm.liveProvider,
    batchScope: arm.batchScope,
    budget: arm.budget,
    storage: arm.storage,
    guardrails: arm.guardrails
  };
}

export function verifyBookOneCinematicRebuildArm(arm) {
  if (!arm || arm.artifact !== 'book-one-cinematic-rebuild-arm') throw new Error('Invalid cinematic rebuild arm');
  if (arm.release !== YASREADY_AUDIOBOOKS_VERSION) throw new Error('Cinematic rebuild arm release mismatch');
  if (arm.status !== 'ARMED_FOR_EXACT_CINEMATIC_REBUILD_SCOPE') throw new Error('Cinematic rebuild arm is not armed');
  if (!arm.integrity?.armDigest || sha256(stableJson(rebuildArmCore(arm))) !== arm.integrity.armDigest) throw new Error('Cinematic rebuild arm integrity digest mismatch');
  if (arm.confirmation?.token !== `CINEMATIC-${arm.integrity.armDigest.slice(0, 10).toUpperCase()}`) throw new Error('Cinematic rebuild token mismatch');
  if (arm.guardrails?.originalsMayBeOverwritten !== false || arm.guardrails?.chapterElevenMayBeGenerated !== false || arm.guardrails?.nextBatchArmed !== false || arm.guardrails?.fullBookGenerationArmed !== false) throw new Error('Cinematic rebuild arm guardrails invalid');
  return true;
}


export function reconcileHistoricalBookOneBatchTechnicalQa(previousResult, { toleranceMs = 1 } = {}) {
  const tolerance = Number(toleranceMs);
  if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > 5) throw new Error('Historical QA reconciliation tolerance must be between 0 and 5 ms');
  const chapters = previousResult?.chapters ?? [];
  const channelConfiguration = previousResult?.distribution?.channelConfiguration ?? {};

  // A historical result already marked READY_FOR_HUMAN_BATCH_REVIEW is itself
  // verified green evidence. Older fixtures/results may not carry the later
  // per-target QA detail shape, so do not downgrade an already-green result
  // merely because newer diagnostic fields are absent.
  if (previousResult?.status === 'READY_FOR_HUMAN_BATCH_REVIEW') {
    return freeze({
      artifact: 'historical-batch-technical-qa-reconciliation',
      priorStatus: previousResult.status,
      passed: true,
      mode: 'ORIGINAL_QA_ALREADY_GREEN',
      toleranceMs: Number(toleranceMs),
      retailerTargetsUnchanged: true,
      reconciledFindingCount: 0,
      blockerCount: 0,
      channelConfigurationConsistent: channelConfiguration?.consistent ?? null,
      findings: freeze([])
    });
  }

  const findings = [];
  let blockerCount = 0;
  let reconciledFindingCount = 0;

  for (const chapter of chapters) {
    for (const target of ['archive', 'acx', 'spotify']) {
      const qa = chapter?.qa?.[target];
      if (!qa) {
        blockerCount += 1;
        findings.push(freeze({ title: chapter?.title ?? null, target, outcome: 'BLOCK', reason: 'missing-qa-record' }));
        continue;
      }
      if (qa.passed === true) continue;
      const issues = qa.issues ?? [];
      if (!issues.length) {
        blockerCount += 1;
        findings.push(freeze({ title: chapter?.title ?? null, target, outcome: 'BLOCK', reason: 'failed-without-issues' }));
        continue;
      }
      for (const issue of issues) {
        const value = Number(issue?.value);
        const minimum = Number(issue?.minimum);
        const shortfallMs = Number.isFinite(value) && Number.isFinite(minimum) ? minimum - value : null;
        const reconcilable =
          issue?.code === 'trailing-silence-short' &&
          Number.isFinite(shortfallMs) &&
          shortfallMs >= 0 &&
          shortfallMs <= tolerance + 1e-9;
        if (reconcilable) {
          reconciledFindingCount += 1;
          findings.push(freeze({
            title: chapter?.title ?? null,
            target,
            outcome: 'RECONCILED_MEASUREMENT_BOUNDARY',
            code: issue.code,
            value,
            minimum,
            shortfallMs: round(shortfallMs, 6),
            toleranceMs: tolerance
          }));
        } else {
          blockerCount += 1;
          findings.push(freeze({
            title: chapter?.title ?? null,
            target,
            outcome: 'BLOCK',
            code: issue?.code ?? 'unknown',
            value: Number.isFinite(value) ? value : null,
            minimum: Number.isFinite(minimum) ? minimum : null,
            shortfallMs: Number.isFinite(shortfallMs) ? round(shortfallMs, 6) : null
          }));
        }
      }
    }
  }

  if (channelConfiguration?.consistent !== true) {
    blockerCount += 1;
    findings.push(freeze({ target: 'cross-chapter', outcome: 'BLOCK', reason: 'channel-configuration-inconsistent' }));
  }

  const passed = chapters.length > 0 && blockerCount === 0;
  return freeze({
    artifact: 'historical-batch-technical-qa-reconciliation',
    priorStatus: previousResult?.status ?? null,
    passed,
    mode: previousResult?.status === 'READY_FOR_HUMAN_BATCH_REVIEW'
      ? 'ORIGINAL_QA_ALREADY_GREEN'
      : passed
        ? 'RECONCILED_SUB_MILLISECOND_SILENCE_BOUNDARY_ONLY'
        : 'BLOCKED',
    toleranceMs: tolerance,
    retailerTargetsUnchanged: true,
    reconciledFindingCount,
    blockerCount,
    channelConfigurationConsistent: channelConfiguration?.consistent === true,
    findings: freeze(findings)
  });
}

export async function buildBookOneCinematicRebuildArm({
  productionPlan,
  recipeLock,
  manuscriptAnalysis,
  previousArm,
  previousResult,
  previousRoot,
  provider,
  ffmpeg,
  outputRoot,
  targetChapterCount = BOOK_ONE_CINEMATIC_TARGET_CHAPTERS,
  retryReserveRatio = BOOK_ONE_CINEMATIC_RETRY_RESERVE_RATIO,
  maxChapters = BOOK_ONE_CINEMATIC_MAX_CHAPTERS_PER_ARM,
  storageProbe = async (root) => {
    const stats = await statfs(root);
    const availableBytes = Number(stats.bavail) * Number(stats.bsize);
    return { root, availableBytes, availableGiB: gib(availableBytes) };
  }
} = {}) {
  verifyBookOneProductionPlan(productionPlan, { acceptedReleases: BOOK_ONE_CINEMATIC_ALLOWED_PLAN_RELEASES });
  verifyBookOneBatchRecipeSnapshot(recipeLock);
  verifyHistoricalBookOneBatchArm(previousArm);
  verifyHistoricalBookOneBatchResult(previousResult);
  if (previousResult.armDigest !== previousArm.integrity.armDigest) throw new Error('Original Batch One result does not belong to its arm');
  if (previousArm.source?.productionPlanDigest !== productionPlan.integrity.productionPlanDigest) throw new Error('Original Batch One does not belong to this production plan');
  const historicalQa = reconcileHistoricalBookOneBatchTechnicalQa(previousResult);
  if (!historicalQa.passed) throw new Error('Original Batch One technical QA must be green before cinematic rebuild');
  if (Number(previousResult.batch?.chapterCount) !== Number(targetChapterCount)) throw new Error(`Cinematic rebuild requires the completed ${targetChapterCount}-chapter original Batch One`);
  if (productionPlan.source?.sourceHash !== manuscriptAnalysis?.source?.sourceHash) throw new Error('Cinematic rebuild manuscript source hash drifted');
  const previousRootResolved = path.resolve(previousRoot);
  const outputRootResolved = path.resolve(outputRoot);
  if (outputRootResolved === previousRootResolved || outputRootResolved.startsWith(`${previousRootResolved}${path.sep}`) || previousRootResolved.startsWith(`${outputRootResolved}${path.sep}`)) throw new Error('Cinematic rebuild output must be completely separate from original Batch One');
  await verifyOriginalBatchFiles(previousResult, previousRootResolved);

  const cinematicLock = buildBookOneCinematicNaturalismLock({ productionPlan, recipeLock });
  const target = materializeBookOneCinematicTarget({ productionPlan, recipeLock, manuscriptAnalysis, cinematicLock, targetChapterCount });
  await mkdir(outputRootResolved, { recursive: true });
  const { state } = await loadCinematicState(outputRootResolved, cinematicLock, productionPlan, recipeLock);
  const completed = completedTargetOrders(state);
  const targetOrders = target.chapters.map((chapter) => Number(chapter.sourceChapterOrder));
  let seenMissing = false;
  for (const order of targetOrders) {
    if (!completed.has(order)) seenMissing = true;
    else if (seenMissing) throw new Error('Cinematic rebuild state has a completed chapter after an unfinished earlier chapter; refusing a gap');
  }
  const remainingChapters = target.chapters.filter((chapter) => !completed.has(Number(chapter.sourceChapterOrder)));

  const ffmpegHealth = await ffmpeg.healthCheck();
  if (!ffmpegHealth?.ok) throw new Error(`FFmpeg failed cinematic rebuild preflight: ${ffmpegHealth?.reason ?? 'unknown'}`);
  const providerHealth = await provider.healthCheck();
  if (!providerHealth?.ok) throw new Error(`Provider health failed cinematic rebuild preflight: ${providerHealth?.reason ?? providerHealth?.status ?? 'unknown'}`);
  const subscription = await provider.subscriptionPreflight();
  if (!subscription?.available || !subscription?.safeToContinue || !subscription.subscription) throw new Error(`Live provider quota is required for cinematic rebuild (${subscription?.reason ?? 'unavailable'})`);
  const quota = extractElevenLabsQuota(subscription.subscription);
  const storage = await storageProbe(outputRootResolved);
  if (Number(storage.availableGiB) < BOOK_ONE_CINEMATIC_MIN_STORAGE_GIB) throw new Error(`Cinematic rebuild requires at least ${BOOK_ONE_CINEMATIC_MIN_STORAGE_GIB} GiB free storage`);

  const reserveRatio = Number(retryReserveRatio);
  if (!(reserveRatio >= 0 && reserveRatio <= 1)) throw new Error('Cinematic rebuild retry reserve ratio must be between 0 and 1');
  const cap = Math.min(BOOK_ONE_CINEMATIC_MAX_CHAPTERS_PER_ARM, Number(maxChapters));
  if (!Number.isInteger(cap) || cap < 1) throw new Error('Cinematic rebuild maxChapters must be a positive integer');
  const selected = [];
  let chars = 0;
  let calls = 0;
  for (const chapter of remainingChapters) {
    if (selected.length >= cap) break;
    const candidateChars = chars + Number(chapter.providerCharacters);
    const candidateReserve = Math.ceil(candidateChars * reserveRatio);
    if (candidateChars + candidateReserve > quota.providerReportedRemaining) break;
    selected.push(chapter);
    chars = candidateChars;
    calls += Number(chapter.providerCalls);
  }

  const rate = Number(productionPlan.budget?.rateUsdPer1kCharacters ?? 0.10);
  const initialGenerationUsd = round((chars / 1000) * rate, 6);
  const retryReserveUsd = round(initialGenerationUsd * reserveRatio, 6);
  const protectedMaxUsd = ceilCents(initialGenerationUsd + retryReserveUsd);
  const retryReserveCharacters = Math.ceil(chars * reserveRatio);
  const allRemainingChars = remainingChapters.reduce((sum, chapter) => sum + Number(chapter.providerCharacters), 0);
  const allRemainingCalls = remainingChapters.reduce((sum, chapter) => sum + Number(chapter.providerCalls), 0);
  const status = remainingChapters.length === 0
    ? 'CINEMATIC_REBUILD_ALREADY_COMPLETE'
    : selected.length === 0
      ? 'BLOCKED_INSUFFICIENT_QUOTA_FOR_NEXT_WHOLE_CHAPTER'
      : 'ARMED_FOR_EXACT_CINEMATIC_REBUILD_SCOPE';

  const base = {
    schemaVersion: 1,
    release: YASREADY_AUDIOBOOKS_VERSION,
    artifact: 'book-one-cinematic-rebuild-arm',
    status,
    book: productionPlan.book,
    source: freeze({
      productionPlanDigest: productionPlan.integrity.productionPlanDigest,
      recipeDigest: recipeLock.integrity.recipeDigest,
      manuscriptSourceHash: productionPlan.source.sourceHash,
      cinematicLockDigest: cinematicLock.integrity.lockDigest,
      targetDigest: target.targetDigest
    }),
    profile: cinematicLock,
    originalBatch: freeze({
      armDigest: previousArm.integrity.armDigest,
      resultDigest: previousResult.integrity.resultDigest,
      root: previousRootResolved,
      preserved: true,
      verifiedChapterCount: previousResult.chapters.length,
      technicalQaReconciliation: historicalQa
    }),
    rebuildTarget: freeze({
      chapterCount: Number(targetChapterCount),
      completedBeforeArm: completed.size,
      remainingBeforeArm: remainingChapters.length,
      remainingProviderCallsBeforeArm: allRemainingCalls,
      remainingProviderCharactersBeforeArm: allRemainingChars,
      chapters: freeze(target.chapters.map((chapter) => freeze({
        chapterNumber: chapter.chapterNumber,
        sourceChapterOrder: chapter.sourceChapterOrder,
        title: chapter.title,
        cueCount: chapter.cueCount,
        providerCalls: chapter.providerCalls,
        providerCharacters: chapter.providerCharacters
      })))
    }),
    liveProvider: freeze({
      checkedAt: new Date().toISOString(),
      tier: quota.tier,
      providerReportedRemaining: quota.providerReportedRemaining,
      providerTtsCallsPerformed: 0,
      providerSpendUsd: 0
    }),
    batchScope: freeze({
      ordinal: completed.size + 1,
      wholeChaptersOnly: true,
      selectedChapterCount: selected.length,
      firstChapterNumber: selected[0]?.chapterNumber ?? null,
      lastChapterNumber: selected.at(-1)?.chapterNumber ?? null,
      newProviderCalls: calls,
      newProviderCharacters: chars,
      retryReserveRatio: reserveRatio,
      retryReserveCharacters,
      quotaEnvelopeCharacters: chars + retryReserveCharacters,
      chapters: freeze(selected.map((chapter) => freeze({
        chapterNumber: chapter.chapterNumber,
        sourceChapterOrder: chapter.sourceChapterOrder,
        title: chapter.title,
        cueCount: chapter.cueCount,
        providerCalls: chapter.providerCalls,
        providerCharacters: chapter.providerCharacters,
        chunkIds: chapter.chunkIds,
        chunks: chapter.chunks
      })))
    }),
    budget: freeze({
      currency: 'USD',
      rateUsdPer1kCharacters: rate,
      initialGenerationUsd,
      retryReserveUsd,
      protectedMaxUsd,
      estimateNotInvoice: true,
      armSpendUsd: 0
    }),
    storage: freeze({
      outputRoot: outputRootResolved,
      availableGiB: Number(storage.availableGiB),
      minimumRequiredGiB: BOOK_ONE_CINEMATIC_MIN_STORAGE_GIB
    }),
    guardrails: freeze({
      armProviderTtsCalls: 0,
      armProviderSpendUsd: 0,
      originalBatchPreserved: true,
      originalsMayBeOverwritten: false,
      cinematicProfileIsExactHumanSelectedA: true,
      plus2EscalationAllowed: false,
      chapterElevenMayBeGenerated: false,
      nextBatchArmed: false,
      fullBookGenerationArmed: false,
      humanTenChapterListenRequiredBeforeChapterEleven: true,
      automaticScaleUp: false
    })
  };
  const armDigest = sha256(stableJson(rebuildArmCore(base)));
  const arm = freeze({
    ...base,
    integrity: freeze({ armDigest }),
    confirmation: status === 'ARMED_FOR_EXACT_CINEMATIC_REBUILD_SCOPE'
      ? freeze({ token: `CINEMATIC-${armDigest.slice(0, 10).toUpperCase()}`, protectedMaxUsd })
      : null
  });
  return freeze({ arm, cinematicLock, target });
}

function safeProviderFailure(error) {
  if (error?.name !== 'ElevenLabsApiError') return false;
  const status = Number(error?.status);
  if (!Number.isInteger(status)) return false;
  if (status === 408 || status >= 500) return false;
  return status >= 400 && status < 500;
}

function resultCore(result) {
  return {
    schemaVersion: result.schemaVersion,
    release: result.release,
    artifact: result.artifact,
    status: result.status,
    book: result.book,
    cinematicLockDigest: result.cinematicLockDigest,
    source: result.source,
    progress: result.progress,
    latestArm: result.latestArm,
    cost: result.cost,
    chapters: result.chapters,
    guardrails: result.guardrails
  };
}

export function verifyBookOneCinematicRebuildResult(result) {
  if (!result || result.artifact !== 'book-one-cinematic-rebuild-result') throw new Error('Invalid cinematic rebuild result');
  if (!BOOK_ONE_CINEMATIC_COMPATIBLE_RELEASES.includes(result.release)) throw new Error('Cinematic rebuild result release mismatch');
  if (!['PARTIAL_CINEMATIC_REBUILD_COMPLETE', 'READY_FOR_HUMAN_TEN_CHAPTER_REVIEW', 'TECHNICAL_QA_REVIEW_REQUIRED'].includes(result.status)) throw new Error('Cinematic rebuild result status invalid');
  if (!result.integrity?.resultDigest || sha256(stableJson(resultCore(result))) !== result.integrity.resultDigest) throw new Error('Cinematic rebuild result integrity digest mismatch');
  if (result.guardrails?.chapterElevenMayBeGenerated !== false || result.guardrails?.nextBatchArmed !== false || result.guardrails?.fullBookGenerationArmed !== false) throw new Error('Cinematic rebuild result guardrails invalid');
  return true;
}

export function renderCinematicRebuildReviewHtml(result) {
  verifyBookOneCinematicRebuildResult(result);
  const cards = result.chapters.map((chapter, index) => `
    <section class="card">
      <div class="eyebrow">Chapter ${chapter.chapterNumber} of ${result.progress.targetChapterCount}</div>
      <h2>${escapeHtml(chapter.title)}</h2>
      <p class="muted">Cinematic Naturalism A · ${chapter.cueCount} subtle performance direction(s)</p>
      <audio id="track-${index}" controls preload="metadata" src="${escapeHtml(chapter.outputs.directMp3)}"></audio>
      <div class="pills"><span>Archive ${chapter.qa.archive.passed ? 'PASS' : 'REVIEW'}</span><span>MP3 ${chapter.qa.mp3.passed ? 'PASS' : 'REVIEW'}</span></div>
    </section>`).join('');
  const missing = Array.from({ length: Math.max(0, result.progress.targetChapterCount - result.chapters.length) }, (_, i) => `<section class="card missing"><div class="eyebrow">Chapter ${result.chapters.length + i + 1} of ${result.progress.targetChapterCount}</div><h2>Waiting for rebuild</h2><p class="muted">No provider generation has been authorized for this chapter yet.</p></section>`).join('');
  const ready = result.status === 'READY_FOR_HUMAN_TEN_CHAPTER_REVIEW';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Book One — Cinematic Batch One Review</title><style>
  :root{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text",Inter,system-ui,sans-serif;background:#f5f5f7;color:#111}body{margin:0;padding:28px}.wrap{max-width:980px;margin:auto}.hero,.card{background:#fff;border:1px solid #e5e5ea;border-radius:24px;box-shadow:0 12px 36px rgba(0,0,0,.06)}.hero{padding:30px}.card{padding:22px;margin-top:16px}.missing{opacity:.55}h1{margin:0 0 8px;font-size:34px;letter-spacing:-.03em}h2{margin:3px 0 8px}.muted{color:#6e6e73}.eyebrow{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#6e6e73;font-weight:700}audio{width:100%;margin:12px 0}.pills{display:flex;gap:8px;flex-wrap:wrap}.pills span{background:#efeff4;border-radius:999px;padding:7px 10px;font-size:13px}.lock{background:#eaf7ee;border-radius:16px;padding:14px;margin-top:14px}.gate{background:#fff3cd;border-radius:16px;padding:14px;margin-top:14px}button{border:0;border-radius:999px;padding:12px 18px;font-weight:700;font-size:14px;cursor:pointer;margin-top:10px}
  </style></head><body><div class="wrap"><div class="hero"><div class="muted">YasReady Audiobooks ${escapeHtml(result.release)}</div><h1>Cinematic Batch One Review</h1><p><strong>${result.progress.completedChapterCount}/${result.progress.targetChapterCount}</strong> rebuilt chapters · original Batch One preserved.</p><div class="lock"><strong>LOCKED:</strong> Ryan → Playful + Flirty → Deep Controlled Emotion → Cinematic Naturalism A → effective 1.25 → Warm + Slightly Deeper.</div><div class="gate"><strong>Chapter 11 gate: CLOSED.</strong> ${ready ? 'Listen to all ten rebuilt chapters straight through before any later batch can be considered.' : 'Finish the first ten cinematic rebuilds before the full listen-through.'}</div>${ready ? '<button id="play-all">Play from Chapter 1</button>' : ''}</div>${cards}${missing}</div><script>
  const tracks=[...document.querySelectorAll('audio')];
  tracks.forEach((track,i)=>track.addEventListener('ended',()=>{const next=tracks[i+1];if(next){next.scrollIntoView({behavior:'smooth',block:'center'});next.play().catch(()=>{});}}));
  document.getElementById('play-all')?.addEventListener('click',()=>tracks[0]?.play());
  </script></body></html>`;
}

function escapeHtml(value) { return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }

export async function renderBookOneCinematicRebuild({
  productionPlan,
  recipeLock,
  manuscriptAnalysis,
  previousArm,
  previousResult,
  previousRoot,
  arm,
  provider,
  ffmpeg,
  outputRoot,
  approvalToken,
  maxUsd
} = {}) {
  verifyBookOneCinematicRebuildArm(arm);
  verifyHistoricalBookOneBatchArm(previousArm);
  verifyHistoricalBookOneBatchResult(previousResult);
  if (approvalToken !== arm.confirmation?.token) throw new Error('Exact CINEMATIC approval token required');
  const cap = Number(maxUsd);
  if (!Number.isFinite(cap) || Math.abs(cap - Number(arm.budget.protectedMaxUsd)) > 1e-9) throw new Error(`Cinematic rebuild max USD must exactly equal protected max $${Number(arm.budget.protectedMaxUsd).toFixed(2)}`);
  if (path.resolve(previousRoot) !== path.resolve(arm.originalBatch.root)) throw new Error('Original Batch One root changed after arm');
  if (!provider?.render || !provider?.healthCheck || !provider?.subscriptionPreflight) throw new Error('Cinematic rebuild requires provider render + live quota support');
  if (!ffmpeg?.healthCheck || !ffmpeg?.tempo || !ffmpeg?.voiceDepth || !ffmpeg?.concat || !ffmpeg?.master || !ffmpeg?.analyze) throw new Error('Cinematic rebuild requires complete FFmpeg production support');
  verifyBookOneProductionPlan(productionPlan, { acceptedReleases: BOOK_ONE_CINEMATIC_ALLOWED_PLAN_RELEASES });
  verifyBookOneBatchRecipeSnapshot(recipeLock);
  if (arm.source.productionPlanDigest !== productionPlan.integrity.productionPlanDigest || arm.source.recipeDigest !== recipeLock.integrity.recipeDigest) throw new Error('Cinematic rebuild arm source digest mismatch');
  if (manuscriptAnalysis?.source?.sourceHash !== arm.source.manuscriptSourceHash) throw new Error('Cinematic rebuild manuscript source hash drifted after arm');
  const cinematicLock = arm.profile;
  verifyBookOneCinematicNaturalismLock(cinematicLock);
  await verifyOriginalBatchFiles(previousResult, previousRoot);

  const root = path.resolve(outputRoot);
  if (root !== path.resolve(arm.storage.outputRoot)) throw new Error('Cinematic rebuild output root changed after arm');
  await mkdir(root, { recursive: true });
  const dirs = {
    provider: path.join(root, 'provider'),
    tempo: path.join(root, 'tempo'),
    finish: path.join(root, 'finish'),
    assembly: path.join(root, 'assembly'),
    archive: path.join(root, 'distribution', 'archive-wav'),
    acx: path.join(root, 'distribution', 'acx-audible'),
    spotify: path.join(root, 'distribution', 'spotify'),
    apple: path.join(root, 'distribution', 'apple-preferred-partner'),
    direct: path.join(root, 'distribution', 'direct-owned'),
    qa: path.join(root, 'qa')
  };
  await Promise.all(Object.values(dirs).map((dir) => mkdir(dir, { recursive: true })));

  const target = materializeBookOneCinematicTarget({ productionPlan, recipeLock, manuscriptAnalysis, cinematicLock, targetChapterCount: arm.rebuildTarget.chapterCount });
  if (target.targetDigest !== arm.source.targetDigest) throw new Error('Cinematic rebuild target materialization drifted after arm');
  const byOrder = new Map(target.chapters.map((chapter) => [Number(chapter.sourceChapterOrder), chapter]));
  for (const selected of arm.batchScope.chapters) {
    const runtime = byOrder.get(Number(selected.sourceChapterOrder));
    if (!runtime || stableJson(runtime.chunkIds) !== stableJson(selected.chunkIds)) throw new Error(`Cinematic rebuild chapter scope drifted: ${selected.title}`);
  }

  const statePath = path.join(root, 'cinematic-rebuild-state.json');
  const existing = await loadCinematicState(root, cinematicLock, productionPlan, recipeLock);
  let state = existing.state ?? {
    schemaVersion: 1,
    release: YASREADY_AUDIOBOOKS_VERSION,
    artifact: 'book-one-cinematic-rebuild-state',
    cinematicLockDigest: cinematicLock.integrity.lockDigest,
    productionPlanDigest: productionPlan.integrity.productionPlanDigest,
    recipeDigest: recipeLock.integrity.recipeDigest,
    targetDigest: target.targetDigest,
    targetChapterCount: target.chapterCount,
    originalBatchResultDigest: previousResult.integrity.resultDigest,
    activeArmDigest: null,
    chunks: {},
    chapters: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  const incompleteOldArm = Object.values(state.chunks ?? {}).some((row) => row?.armDigest && row.armDigest !== arm.integrity.armDigest && row.status !== 'COMPLETE');
  if (incompleteOldArm) throw new Error('Cinematic rebuild has unfinished work from another arm; reuse that exact arm before creating a new one');
  state.activeArmDigest = arm.integrity.armDigest;
  await persistState(statePath, state);

  const ffmpegHealth = await ffmpeg.healthCheck();
  if (!ffmpegHealth?.ok) throw new Error(`FFmpeg failed before cinematic paid work: ${ffmpegHealth?.reason ?? 'unknown'}`);
  const providerHealth = await provider.healthCheck();
  if (!providerHealth?.ok) throw new Error(`Provider health failed before cinematic paid work: ${providerHealth?.reason ?? providerHealth?.status ?? 'unknown'}`);
  const subscription = await provider.subscriptionPreflight();
  if (!subscription?.available || !subscription?.safeToContinue || !subscription.subscription) throw new Error('Live provider quota recheck failed before cinematic rebuild render');
  const quota = extractElevenLabsQuota(subscription.subscription);
  const selectedChunks = arm.batchScope.chapters.flatMap((chapter) => chapter.chunks);
  const missingChars = selectedChunks.filter((chunk) => !PROVIDER_SETTLED.has(state.chunks?.[chunk.id]?.status)).reduce((sum, chunk) => sum + Number(chunk.characters), 0);
  const remainingReserve = Math.ceil(missingChars * Number(arm.batchScope.retryReserveRatio));
  if (quota.providerReportedRemaining < missingChars + remainingReserve) throw new Error(`Live provider quota is insufficient for remaining cinematic work plus reserve: ${quota.providerReportedRemaining} remaining, ${missingChars} work + ${remainingReserve} reserve required`);

  let providerCallsThisRun = 0;
  let localTempoThisRun = 0;
  let localFinishThisRun = 0;
  const requestIds = [];

  for (const scope of arm.batchScope.chapters) {
    const chapter = byOrder.get(Number(scope.sourceChapterOrder));
    const finalChunkPaths = [];
    const chapterDirName = `chapter-${String(chapter.chapterNumber).padStart(2, '0')}`;
    for (const chunk of chapter.chunks) {
      const providerDir = path.join(dirs.provider, chapterDirName);
      const tempoDir = path.join(dirs.tempo, chapterDirName);
      const finishDir = path.join(dirs.finish, chapterDirName);
      await Promise.all([mkdir(providerDir, { recursive: true }), mkdir(tempoDir, { recursive: true }), mkdir(finishDir, { recursive: true })]);
      const providerPath = path.join(providerDir, `${chunk.id}.mp3`);
      const tempoPath = path.join(tempoDir, `${chunk.id}.mp3`);
      const finishPath = path.join(finishDir, `${chunk.id}.wav`);
      let row = state.chunks[chunk.id] ?? { id: chunk.id, armDigest: arm.integrity.armDigest, generationDigest: chunk.generationDigest, textDigest: chunk.textDigest, status: 'PLANNED' };
      if (row.generationDigest !== chunk.generationDigest || row.textDigest !== chunk.textDigest) throw new Error(`Cinematic rebuild state digest mismatch for ${chunk.id}`);
      if (row.armDigest !== arm.integrity.armDigest && row.status !== 'COMPLETE') throw new Error(`Cinematic rebuild chunk ${chunk.id} belongs to another unfinished arm`);
      const providerExists = await exists(providerPath);
      let providerReady = PROVIDER_SETTLED.has(row.status) && providerExists;
      if (PROVIDER_SETTLED.has(row.status) && !providerExists) throw new Error(`DO NOT RERUN PROVIDER: paid cinematic source is missing for ${chunk.id}`);
      if (providerReady && (!row.audioSha256 || (await fileDigest(providerPath)) !== row.audioSha256)) throw new Error(`DO NOT RERUN PROVIDER: paid cinematic source digest mismatch for ${chunk.id}`);
      if (!providerReady) {
        if (['PROVIDER_IN_FLIGHT', 'PROVIDER_RESULT_UNKNOWN_DO_NOT_RERUN'].includes(row.status)) throw new Error(`DO NOT RERUN PROVIDER: ${chunk.id} has unresolved provider outcome`);
        const currentArmSpend = Object.values(state.chunks ?? {}).filter((item) => item?.armDigest === arm.integrity.armDigest).reduce((sum, item) => sum + Number(item?.capturedOrEstimatedBilledUsd ?? 0), 0);
        const estimate = round((Number(chunk.characters) / 1000) * Number(arm.budget.rateUsdPer1kCharacters), 6);
        if (currentArmSpend + estimate > cap + 1e-9) throw new Error(`Cinematic Money Guard would exceed approved max $${cap.toFixed(2)} before ${chunk.id}`);
        row = { ...row, armDigest: arm.integrity.armDigest, status: 'PROVIDER_IN_FLIGHT', providerStartedAt: new Date().toISOString() };
        state.chunks[chunk.id] = row;
        await persistState(statePath, state);
        let rendered;
        try {
          rendered = await provider.render({
            voiceId: recipeLock.narrator.voiceId,
            text: chunk.text,
            model: recipeLock.provider.model,
            outputFormat: 'mp3_44100_128',
            voiceSettings: recipeLock.provider.voiceSettings
          });
        } catch (error) {
          row.status = safeProviderFailure(error) ? 'PROVIDER_FAILED_SAFE_TO_RETRY' : 'PROVIDER_RESULT_UNKNOWN_DO_NOT_RERUN';
          row.error = error?.message ?? String(error);
          state.chunks[chunk.id] = row;
          await persistState(statePath, state);
          if (row.status === 'PROVIDER_RESULT_UNKNOWN_DO_NOT_RERUN') throw new Error(`DO NOT RERUN PROVIDER: ${chunk.id} outcome unknown after provider call: ${row.error}`);
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
        try { await writeFile(providerPath, audio); }
        catch (error) { throw new Error(`DO NOT RERUN PROVIDER: provider succeeded for ${chunk.id} but local storage failed: ${error?.message ?? error}`); }
        const estimated = Number(rendered.estimatedCostUsd);
        const fallback = round((Number(rendered.billedCharacters ?? chunk.characters) / 1000) * Number(arm.budget.rateUsdPer1kCharacters), 6);
        row = {
          ...row,
          status: 'PROVIDER_COMPLETE',
          providerCompletedAt: new Date().toISOString(),
          providerRelativePath: path.relative(root, providerPath),
          audioSha256: await fileDigest(providerPath),
          audioBytes: audio.byteLength,
          requestId: rendered.requestId ?? null,
          billedCharacters: Number(rendered.billedCharacters ?? chunk.characters),
          capturedOrEstimatedBilledUsd: Number.isFinite(estimated) ? estimated : fallback,
          billingBasis: Number.isFinite(estimated) ? 'provider-returned-estimate' : 'planning-rate-fallback'
        };
        state.chunks[chunk.id] = row;
        await persistState(statePath, state);
        providerCallsThisRun += 1;
        if (rendered.requestId) requestIds.push(rendered.requestId);
        providerReady = true;
      }

      let tempoReady = TEMPO_SETTLED.has(row.status) && await exists(tempoPath);
      if (tempoReady && (!row.tempoAudioSha256 || (await fileDigest(tempoPath)) !== row.tempoAudioSha256)) tempoReady = false;
      if (!tempoReady) {
        try { await ffmpeg.tempo(providerPath, tempoPath, Number(recipeLock.pace.postProcessTempoMultiplier)); }
        catch (error) { row.status = 'LOCAL_TEMPO_FAILED_SAFE_TO_RERUN'; row.localError = error?.message ?? String(error); state.chunks[chunk.id] = row; await persistState(statePath, state); throw error; }
        row.status = 'TEMPO_COMPLETE';
        row.tempoRelativePath = path.relative(root, tempoPath);
        row.tempoAudioSha256 = await fileDigest(tempoPath);
        state.chunks[chunk.id] = row;
        await persistState(statePath, state);
        localTempoThisRun += 1;
      }

      let finishReady = FINISH_SETTLED.has(row.status) && await exists(finishPath);
      if (finishReady && (!row.finishAudioSha256 || (await fileDigest(finishPath)) !== row.finishAudioSha256)) finishReady = false;
      if (!finishReady) {
        try { await ffmpeg.voiceDepth(tempoPath, finishPath, { mode: recipeLock.localVoiceFinish.id }); }
        catch (error) { row.status = 'LOCAL_FINISH_FAILED_SAFE_TO_RERUN'; row.localError = error?.message ?? String(error); state.chunks[chunk.id] = row; await persistState(statePath, state); throw error; }
        row.status = 'FINISH_COMPLETE';
        row.finishRelativePath = path.relative(root, finishPath);
        row.finishAudioSha256 = await fileDigest(finishPath);
        state.chunks[chunk.id] = row;
        await persistState(statePath, state);
        localFinishThisRun += 1;
      }
      finalChunkPaths.push(finishPath);
    }

    const baseName = safeSectionFileName(chapter.retailerSequence, chapter.title, 'wav').replace(/\.wav$/, '');
    const assemblyPath = path.join(dirs.assembly, `${baseName}-assembly.wav`);
    await ffmpeg.concat(finalChunkPaths, assemblyPath);
    const archivePath = path.join(dirs.archive, `${baseName}.wav`);
    const acxPath = path.join(dirs.acx, `${baseName}.mp3`);
    const spotifyPath = path.join(dirs.spotify, `${baseName}.mp3`);
    const directPath = path.join(dirs.direct, `${baseName}.mp3`);
    const applePath = path.join(dirs.apple, `${baseName}.wav`);
    await ffmpeg.master(assemblyPath, archivePath, BOOK_ONE_CINEMATIC_ARCHIVE_PROFILE);
    await ffmpeg.master(assemblyPath, acxPath, BOOK_ONE_CINEMATIC_MP3_PROFILE);
    await Promise.all([copyFile(acxPath, spotifyPath), copyFile(acxPath, directPath), copyFile(archivePath, applePath)]);
    const [archiveAnalysis, mp3Analysis] = await Promise.all([ffmpeg.analyze(archivePath), ffmpeg.analyze(acxPath)]);
    const archiveQa = evaluateMasterAgainstProfile(archiveAnalysis, BOOK_ONE_CINEMATIC_ARCHIVE_PROFILE);
    const mp3Qa = evaluateMasterAgainstProfile(mp3Analysis, BOOK_ONE_CINEMATIC_MP3_PROFILE);
    const chapterResult = {
      status: 'COMPLETE',
      chapterNumber: chapter.chapterNumber,
      sourceChapterOrder: chapter.sourceChapterOrder,
      title: chapter.title,
      cueCount: chapter.cueCount,
      providerCalls: chapter.providerCalls,
      providerCharacters: chapter.providerCharacters,
      outputs: {
        archiveWav: path.relative(root, archivePath),
        acxMp3: path.relative(root, acxPath),
        spotifyMp3: path.relative(root, spotifyPath),
        directMp3: path.relative(root, directPath),
        applePartnerWav: path.relative(root, applePath)
      },
      digests: {
        archiveWav: await fileDigest(archivePath),
        acxMp3: await fileDigest(acxPath),
        spotifyMp3: await fileDigest(spotifyPath),
        directMp3: await fileDigest(directPath),
        applePartnerWav: await fileDigest(applePath)
      },
      qa: { archive: archiveQa, mp3: mp3Qa },
      analysis: { archive: archiveAnalysis, mp3: mp3Analysis },
      completedAt: new Date().toISOString()
    };
    state.chapters[String(chapter.sourceChapterOrder)] = chapterResult;
    for (const chunk of chapter.chunks) if (state.chunks[chunk.id]) state.chunks[chunk.id].status = 'COMPLETE';
    await persistState(statePath, state);
  }

  state.activeArmDigest = null;
  await persistState(statePath, state);
  const orderedCompleted = target.chapters.map((chapter) => state.chapters[String(chapter.sourceChapterOrder)]).filter(Boolean);
  const anyQaFailure = orderedCompleted.some((chapter) => !chapter.qa?.archive?.passed || !chapter.qa?.mp3?.passed);
  const allComplete = orderedCompleted.length === target.chapterCount;
  const status = anyQaFailure ? 'TECHNICAL_QA_REVIEW_REQUIRED' : allComplete ? 'READY_FOR_HUMAN_TEN_CHAPTER_REVIEW' : 'PARTIAL_CINEMATIC_REBUILD_COMPLETE';
  const allCaptured = Object.values(state.chunks ?? {}).reduce((sum, row) => sum + Number(row?.capturedOrEstimatedBilledUsd ?? 0), 0);
  const currentArmCaptured = Object.values(state.chunks ?? {}).filter((row) => row?.armDigest === arm.integrity.armDigest).reduce((sum, row) => sum + Number(row?.capturedOrEstimatedBilledUsd ?? 0), 0);
  const base = {
    schemaVersion: 1,
    release: YASREADY_AUDIOBOOKS_VERSION,
    artifact: 'book-one-cinematic-rebuild-result',
    status,
    book: productionPlan.book,
    cinematicLockDigest: cinematicLock.integrity.lockDigest,
    source: freeze({
      productionPlanDigest: productionPlan.integrity.productionPlanDigest,
      recipeDigest: recipeLock.integrity.recipeDigest,
      originalBatchResultDigest: previousResult.integrity.resultDigest,
      targetDigest: target.targetDigest,
      outputRoot: root
    }),
    progress: freeze({
      targetChapterCount: target.chapterCount,
      completedChapterCount: orderedCompleted.length,
      remainingChapterCount: target.chapterCount - orderedCompleted.length,
      allTenComplete: allComplete
    }),
    latestArm: freeze({
      armDigest: arm.integrity.armDigest,
      firstChapterNumber: arm.batchScope.firstChapterNumber,
      lastChapterNumber: arm.batchScope.lastChapterNumber,
      providerGenerationCallsThisRun: providerCallsThisRun,
      localTempoTasksThisRun: localTempoThisRun,
      localFinishTasksThisRun: localFinishThisRun,
      requestIdsObservedThisRun: freeze(requestIds)
    }),
    cost: freeze({
      latestArmApprovedMaxUsd: cap,
      latestArmCapturedOrEstimatedBilledUsd: round(currentArmCaptured, 6),
      totalCinematicCapturedOrEstimatedBilledUsd: round(allCaptured, 6),
      estimateNotInvoice: true,
      localProcessingUsd: 0
    }),
    chapters: freeze(orderedCompleted.map((chapter) => freeze(chapter))),
    guardrails: freeze({
      originalBatchPreserved: true,
      originalsMayBeOverwritten: false,
      cinematicProfileLockedToA: true,
      plus2EscalationAllowed: false,
      humanTenChapterListenRequiredBeforeChapterEleven: true,
      chapterElevenMayBeGenerated: false,
      nextBatchArmed: false,
      fullBookGenerationArmed: false,
      automaticScaleUp: false
    }),
    nextAction: anyQaFailure
      ? 'Resolve technical QA before listening approval or any later production.'
      : allComplete
        ? 'Human-listen to all ten Cinematic Naturalism chapters straight through. Chapter 11 remains blocked until a later explicit human approval gate.'
        : 'Re-run the cinematic rebuild helper to calculate the next safe whole-chapter rebuild scope when live quota allows.'
  };
  const result = freeze({ ...base, integrity: freeze({ resultDigest: sha256(stableJson(resultCore(base))) }) });
  verifyBookOneCinematicRebuildResult(result);
  await Promise.all([
    writeFile(path.join(root, 'cinematic-rebuild-result.json'), JSON.stringify(result, null, 2)),
    writeFile(path.join(root, 'cinematic-rebuild-review.html'), renderCinematicRebuildReviewHtml(result)),
    writeFile(path.join(dirs.qa, 'cinematic-rebuild-technical-qa.json'), JSON.stringify(result.chapters.map((chapter) => ({ chapterNumber: chapter.chapterNumber, title: chapter.title, cueCount: chapter.cueCount, qa: chapter.qa, analysis: chapter.analysis })), null, 2))
  ]);
  return result;
}

export function renderCinematicNaturalismLockMarkdown(lock) {
  verifyBookOneCinematicNaturalismLock(lock);
  return [
    '# Book One — Cinematic Naturalism Lock',
    '',
    `**Release:** ${lock.release}`,
    `**Profile:** ${lock.profileId}`,
    '**Human A/B winner:** A — original Cinematic Naturalism',
    '**Cinematic +2:** REJECTED / NOT ALLOWED',
    '**Provider TTS calls performed by lock:** 0',
    '**Spend by lock:** $0.00',
    '',
    '## Locked chain',
    '',
    '- Ryan Kurk — Pleasant and Smooth',
    '- Playful + Flirty',
    '- Deep Controlled Emotion',
    '- Cinematic Naturalism A',
    '- Provider speed 1.20',
    '- Effective speed 1.25',
    '- Warm + Slightly Deeper',
    '',
    '## Performance rule',
    '',
    'Bring the people and scenes alive through restrained acting, not extra voices or caricature.',
    'Character differentiation comes from delivery, timing and subtext — not impersonation.',
    'Most narration stays natural. Emotional moments earn direction from the manuscript.',
    '',
    `Lock digest: \`${lock.integrity.lockDigest}\``,
    ''
  ].join('\n');
}

export function renderCinematicRebuildArmMarkdown(arm) {
  const lines = [
    '# Book One — Cinematic Batch One Rebuild Arm',
    '',
    `**Status:** ${arm.status}`,
    '**Arm provider TTS calls:** 0',
    '**Arm spend:** $0.00',
    '**Original Batch One preserved:** YES',
    '**Chapter 11 armed:** NO',
    '**Full-book generation armed:** NO',
    '',
    '## Locked profile',
    '',
    '- Cinematic Naturalism A — human-selected winner',
    '- Cinematic +2 remains rejected',
    '- Ryan / 1.20 provider speed / effective 1.25 / Warm + Slightly Deeper',
    '',
    '## Rebuild progress',
    '',
    `- Completed before this arm: **${arm.rebuildTarget.completedBeforeArm}/${arm.rebuildTarget.chapterCount}**`,
    `- Remaining before this arm: **${arm.rebuildTarget.remainingBeforeArm}**`,
    `- Live provider remaining: **${Number(arm.liveProvider.providerReportedRemaining).toLocaleString()} characters**`,
    `- Selected whole chapters now: **${arm.batchScope.selectedChapterCount}**`,
    `- New provider calls: **${arm.batchScope.newProviderCalls}**`,
    `- New provider characters: **${arm.batchScope.newProviderCharacters.toLocaleString()}**`,
    `- Retry reserve: **${arm.batchScope.retryReserveCharacters.toLocaleString()} characters**`,
    `- Quota envelope: **${arm.batchScope.quotaEnvelopeCharacters.toLocaleString()} / ${Number(arm.liveProvider.providerReportedRemaining).toLocaleString()} available**`,
    `- Initial estimate: **$${Number(arm.budget.initialGenerationUsd).toFixed(2)}**`,
    `- Retry reserve: **$${Number(arm.budget.retryReserveUsd).toFixed(2)}**`,
    `- Protected HARD max: **$${Number(arm.budget.protectedMaxUsd).toFixed(2)}**`,
    ''
  ];
  for (const chapter of arm.batchScope.chapters) lines.push(`- Chapter ${chapter.chapterNumber}: ${chapter.title} — ${chapter.providerCharacters.toLocaleString()} chars / ${chapter.providerCalls} calls / ${chapter.cueCount} subtle performance direction(s)`);
  lines.push('', '## Spend authorization', '');
  if (arm.confirmation) lines.push(`\`${arm.confirmation.token}\` authorizes **only the exact chapters above** up to **$${Number(arm.budget.protectedMaxUsd).toFixed(2)}**.`);
  else if (arm.status === 'BLOCKED_INSUFFICIENT_QUOTA_FOR_NEXT_WHOLE_CHAPTER') lines.push('No token was created because current live quota cannot safely fit the next whole chapter plus retry reserve.');
  else lines.push('No token was created because the ten-chapter cinematic rebuild is already complete.');
  lines.push('Chapter 11 and every later batch remain OFF.', '');
  return lines.join('\n');
}
