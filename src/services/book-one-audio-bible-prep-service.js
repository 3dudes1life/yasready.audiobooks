import { AudioBibleService } from './audio-bible-service.js';
import { BookOneSupermanService } from './book-one-superman-service.js';
import { ManuscriptService } from './manuscript-service.js';
import { ProjectService } from './project-service.js';
import {
  buildBookOneCharacterPlan,
  buildDialogueReviewQueue,
  buildPronunciationReview,
  renderAudioBiblePrepMarkdown,
  renderCharacterPlanCsv,
  renderDialogueReviewCsv,
  renderPronunciationReviewCsv
} from '../audio-bible/book-one-prep.js';
import { buildDialogueIntelligence } from '../audio-bible/book-one-intelligence.js';
import { BOOK_ONE_PROFILE, canonicalizeSpeakerCandidate } from '../superman/book-one-superman.js';
import { YASREADY_AUDIOBOOKS_VERSION, BOOK_ONE_AUDIO_BIBLE_PREP_ENGINE_RELEASE, productionProvenance } from '../release.js';

const freeze = (value) => Object.freeze(value);

export function computeBookOneAudioBibleLock({ supermanStatus, reviewNeedsReview, pronunciationNeedsConfirmation, continuityUnresolvedDialogue }) {
  return supermanStatus === 'PASS' &&
    Number(reviewNeedsReview ?? 0) === 0 &&
    Number(pronunciationNeedsConfirmation ?? 0) === 0 &&
    Number(continuityUnresolvedDialogue ?? 0) === 0;
}

export function reconcileBookOneContinuity(rawContinuity, review) {
  const externallyResolvedIds = new Set([
    ...((review?.sceneLocalBindings ?? []).map((binding) => binding.segmentId)),
    ...((review?.collectiveBindings ?? []).map((binding) => binding.segmentId))
  ].filter(Boolean));
  const rawUnbound = Number(rawContinuity?.unresolvedDialogueSegments ?? 0);
  const externallyResolvedDialogueSegments = Math.min(rawUnbound, externallyResolvedIds.size);
  const unresolvedDialogueSegments = Math.max(0, rawUnbound - externallyResolvedDialogueSegments);
  return freeze({
    ...rawContinuity,
    unboundInPermanentBible: rawUnbound,
    externallyResolvedDialogueSegments,
    unresolvedDialogueSegments,
    speakerResolutionComplete: unresolvedDialogueSegments === 0
  });
}

function analysisSegmentRows(ingestResult) {
  const rows = [];
  let flat = 0;
  for (const chapter of ingestResult.analysis.chapters) {
    for (const scene of chapter.scenes) {
      for (const segment of scene.segments) {
        rows.push({ chapter, scene, segment, record: ingestResult.segments?.[flat] ?? null });
        flat += 1;
      }
    }
  }
  return rows;
}

export class BookOneAudioBiblePrepService {
  constructor(store, {
    projectService = null,
    manuscriptService = null,
    audioBibleService = null,
    supermanService = null
  } = {}) {
    if (!store) throw new Error('BookOneAudioBiblePrepService requires a store');
    this.store = store;
    this.projects = projectService ?? new ProjectService(store);
    this.manuscripts = manuscriptService ?? new ManuscriptService(store);
    this.audioBible = audioBibleService ?? new AudioBibleService(store);
    this.superman = supermanService ?? new BookOneSupermanService(store, {
      projectService: this.projects,
      manuscriptService: this.manuscripts
    });
  }

  async runFile(filePath, options = {}) {
    if (!String(filePath ?? '').trim()) throw new Error('Book One Audio Bible Prep requires a manuscript file path');
    const project = this.projects.create({ name: options.projectName ?? 'Book One Audio Bible Prep' });
    const ingestResult = this.manuscripts.ingestFile(project.id, filePath, {
      title: options.title ?? BOOK_ONE_PROFILE.title,
      ...(options.author ? { author: options.author } : {}),
      ...(options.language ? { language: options.language } : {})
    });
    const supermanResult = await this.superman.reportExisting(project, ingestResult, {
      label: 'Book One Superman — Audio Bible Prep Gate',
      model: options.model ?? 'eleven_multilingual_v2'
    });
    if (supermanResult.report.status === 'BLOCKED') {
      throw new Error('Audio Bible Prep blocked: Book One Superman found critical manuscript issues');
    }

    const intelligence = buildDialogueIntelligence(ingestResult);
    const review = buildDialogueReviewQueue(ingestResult, { intelligence });
    const spokenCharacterNames = new Set([
      ...(review.autoBindings ?? []).map((binding) => binding.speaker),
      ...(review.collectiveBindings ?? []).flatMap((binding) => binding.speakers ?? [])
    ].filter(Boolean));
    const characterPlan = buildBookOneCharacterPlan(supermanResult.report, {
      provisionalRoles: intelligence.provisionalRoles,
      spokenCharacterNames
    });
    const bible = this.audioBible.createBible({
      projectId: project.id,
      bookId: ingestResult.book.id,
      name: options.bibleName ?? `${ingestResult.analysis.metadata.title} — Audio Bible`,
      scope: 'book'
    });
    const characterByName = new Map();
    for (const planned of characterPlan) {
      const character = this.audioBible.addCharacter(bible.id, {
        canonicalName: planned.canonicalName,
        aliases: planned.aliases,
        role: planned.role,
        seriesCharacterKey: planned.seriesCharacterKey,
        performanceProfile: {
          prepRelease: '0.11.8',
          castingStatus: planned.castingStatus,
          sourceMentions: planned.mentions,
          sourceConfidence: planned.averageConfidence,
          provisional: Boolean(planned.provisional),
          source: planned.source,
          continuityScope: planned.continuityScope ?? 'book'
        }
      });
      characterByName.set(planned.canonicalName, character);
    }

    let autoBound = 0;
    for (const binding of review.autoBindings ?? []) {
      if (!binding.segmentId) continue;
      const character = characterByName.get(binding.speaker);
      if (!character) continue;
      const result = this.audioBible.bindSegmentSpeaker(bible.id, binding.segmentId, {
        characterId: character.id,
        source: binding.source ?? 'book-one-audio-bible-prep',
        confidence: binding.confidence,
        evidence: binding.evidence ?? 'book-one-intelligence'
      });
      if (result?.status === 'bound') autoBound += 1;
    }

    const pronunciationReview = buildPronunciationReview(ingestResult, characterPlan);
    let pronunciationRulesCreated = 0;
    for (const candidate of pronunciationReview.candidates ?? []) {
      if (!candidate.ruleRequired || !candidate.spokenAs) continue;
      this.audioBible.addPronunciation(bible.id, {
        term: candidate.term,
        spokenAs: candidate.spokenAs,
        language: candidate.language ?? 'en',
        caseSensitive: Boolean(candidate.caseSensitive),
        source: 'yasready-default-0.11.8',
        notes: candidate.notes ?? null
      });
      pronunciationRulesCreated += 1;
    }

    const rawContinuity = this.audioBible.continuityReport(bible.id);
    const continuity = reconcileBookOneContinuity(rawContinuity, review);
    const snapshot = this.audioBible.snapshot(bible.id);
    const productionReady = computeBookOneAudioBibleLock({
      supermanStatus: supermanResult.report.status,
      reviewNeedsReview: review.needsReview,
      pronunciationNeedsConfirmation: pronunciationReview.needsConfirmation,
      continuityUnresolvedDialogue: continuity.unresolvedDialogueSegments
    });
    const prep = freeze({
      schemaVersion: 8,
      release: YASREADY_AUDIOBOOKS_VERSION,
      provenance: productionProvenance({
        artifact: 'book-one-audio-bible-prep',
        prepEngineRelease: BOOK_ONE_AUDIO_BIBLE_PREP_ENGINE_RELEASE,
        supermanEngineRelease: supermanResult.report.release,
        sourceHash: ingestResult.analysis.source.sourceHash
      }),
      status: productionReady ? 'AUDIO_BIBLE_LOCKED' : 'READY_FOR_AUDIO_BIBLE_REVIEW',
      providerCallsPerformed: 0,
      book: freeze({
        id: ingestResult.book.id,
        title: ingestResult.analysis.metadata.title,
        author: ingestResult.analysis.metadata.author,
        language: ingestResult.analysis.metadata.language,
        sourceHash: ingestResult.analysis.source.sourceHash,
        words: ingestResult.analysis.metrics.words,
        narrativeChapters: supermanResult.report.manuscript.narrativeChapterCount
      }),
      superman: freeze({ status: supermanResult.report.status, score: supermanResult.report.score, engineRelease: supermanResult.report.release }),
      audioBible: freeze({ id: bible.id, name: bible.name, revision: this.store.get('audio_bible', bible.id).revision, digest: snapshot.digest, locked: productionReady, lockRelease: productionReady ? YASREADY_AUDIOBOOKS_VERSION : null, lockEngineRelease: productionReady ? BOOK_ONE_AUDIO_BIBLE_PREP_ENGINE_RELEASE : null }),
      characterPlan,
      sceneLocalRoles: intelligence.sceneLocalRoles ?? freeze([]),
      intelligence: freeze({
        autoResolved: review.intelligenceResolved,
        reviewCandidatesBeforeIntelligence: review.reviewCandidatesBeforeIntelligence,
        reviewReduction: review.reviewReduction,
        correctedSafeBindings: review.correctedSafeBindings,
        quotedNarrationSegments: review.quotedNarrationSegments,
        provisionalRoles: intelligence.provisionalRoles.map((x) => x.canonicalName),
        sceneLocalRoles: (intelligence.sceneLocalRoles ?? []).map((x) => x.canonicalName),
        permanentRoleCount: characterPlan.length,
        sceneLocalRoleCount: (intelligence.sceneLocalRoles ?? []).length,
        resolutionCounts: review.intelligenceApplied,
        detectionCounts: review.intelligenceDetected
      }),
      dialogueReview: freeze({
        ...review,
        autoBound,
        sceneLocalResolved: review.sceneLocalBindings?.length ?? 0,
        collectiveResolved: review.collectiveBindings?.length ?? 0,
        safelyResolved: autoBound + (review.sceneLocalBindings?.length ?? 0) + (review.collectiveBindings?.length ?? 0)
      }),
      pronunciationReview: freeze({ ...pronunciationReview, rulesCreated: pronunciationRulesCreated }),
      continuity,
      snapshot,
      lock: freeze({
        status: productionReady ? 'LOCKED' : 'OPEN',
        release: YASREADY_AUDIOBOOKS_VERSION,
        engineRelease: BOOK_ONE_AUDIO_BIBLE_PREP_ENGINE_RELEASE,
        speakerReviewOutstanding: review.needsReview,
        pronunciationReviewOutstanding: pronunciationReview.needsConfirmation,
        permanentRoles: characterPlan.length,
        sceneLocalRoles: (intelligence.sceneLocalRoles ?? []).length,
        pronunciationRules: pronunciationRulesCreated
      }),
      gates: freeze({
        supermanPass: supermanResult.report.status === 'PASS',
        rosterPrepared: characterPlan.length > 1,
        highConfidenceBindingsCreated: autoBound > 0,
        primaryCastingCanBegin: Boolean(supermanResult.report.gates?.safeToBeginCasting),
        productionReady,
        audioBibleLocked: productionReady,
        paidGenerationArmed: false
      }),
      nextAction: review.needsReview
        ? `Review the remaining ${review.needsReview} genuinely ambiguous dialogue line(s); YasReady already removed ${review.reviewReduction} review chores while keeping scene extras out of the permanent Audio Bible.`
        : productionReady
          ? 'Audio Bible locked for production. Proceed to Casting Room for Narrator and primary-role auditions.'
          : 'Resolve the remaining pronunciation blockers, then lock the Audio Bible for production.'
    });

    return freeze({
      project,
      ingestResult,
      prep,
      markdown: renderAudioBiblePrepMarkdown(prep),
      characterCsv: renderCharacterPlanCsv(characterPlan),
      dialogueCsv: renderDialogueReviewCsv(review),
      pronunciationCsv: renderPronunciationReviewCsv(pronunciationReview)
    });
  }
}
