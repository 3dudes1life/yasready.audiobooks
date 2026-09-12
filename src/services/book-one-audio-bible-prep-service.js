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

const freeze = (value) => Object.freeze(value);

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
    const characterPlan = buildBookOneCharacterPlan(supermanResult.report, { provisionalRoles: intelligence.provisionalRoles });
    const review = buildDialogueReviewQueue(ingestResult, { intelligence });
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
          prepRelease: '0.11.6',
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
    const continuity = this.audioBible.continuityReport(bible.id);
    const snapshot = this.audioBible.snapshot(bible.id);
    const productionReady = review.needsReview === 0 && pronunciationReview.needsConfirmation === 0;
    const prep = freeze({
      schemaVersion: 5,
      release: '0.11.6',
      status: 'READY_FOR_AUDIO_BIBLE_REVIEW',
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
      audioBible: freeze({ id: bible.id, name: bible.name, revision: this.store.get('audio_bible', bible.id).revision, digest: snapshot.digest }),
      characterPlan,
      intelligence: freeze({
        autoResolved: review.intelligenceResolved,
        reviewCandidatesBeforeIntelligence: review.reviewCandidatesBeforeIntelligence,
        reviewReduction: review.reviewReduction,
        correctedSafeBindings: review.correctedSafeBindings,
        quotedNarrationSegments: review.quotedNarrationSegments,
        provisionalRoles: intelligence.provisionalRoles.map((x) => x.canonicalName),
        permanentRoleCount: characterPlan.filter((x) => (x.continuityScope ?? 'book') !== 'scene').length,
        sceneLocalRoleCount: characterPlan.filter((x) => x.continuityScope === 'scene').length,
        resolutionCounts: review.intelligenceApplied,
        detectionCounts: review.intelligenceDetected
      }),
      dialogueReview: freeze({ ...review, autoBound }),
      pronunciationReview,
      continuity,
      snapshot,
      gates: freeze({
        supermanPass: supermanResult.report.status === 'PASS',
        rosterPrepared: characterPlan.length > 1,
        highConfidenceBindingsCreated: autoBound > 0,
        primaryCastingCanBegin: Boolean(supermanResult.report.gates?.safeToBeginCasting),
        productionReady,
        paidGenerationArmed: false
      }),
      nextAction: review.needsReview
        ? `Review the remaining ${review.needsReview} genuinely ambiguous dialogue line(s); YasReady already removed ${review.reviewReduction} review chores through Audio Bible intelligence.`
        : 'Confirm the focused pronunciation candidates, then lock the Audio Bible for production.'
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
