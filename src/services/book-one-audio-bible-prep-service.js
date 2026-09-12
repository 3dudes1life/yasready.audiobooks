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

    const characterPlan = buildBookOneCharacterPlan(supermanResult.report);
    const review = buildDialogueReviewQueue(ingestResult);
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
          prepRelease: '0.11.2',
          castingStatus: planned.castingStatus,
          sourceMentions: planned.mentions,
          sourceConfidence: planned.averageConfidence
        }
      });
      characterByName.set(planned.canonicalName, character);
    }

    let autoBound = 0;
    for (const row of analysisSegmentRows(ingestResult)) {
      if (row.segment.kind !== 'dialogue' || !row.record) continue;
      const candidate = row.segment.speakerCandidate;
      const confidence = Number(candidate?.confidence ?? 0);
      if (confidence < 0.75) continue;
      const canonical = canonicalizeSpeakerCandidate(candidate?.name);
      const character = canonical ? characterByName.get(canonical) : null;
      if (!character) continue;
      this.audioBible.bindSegmentSpeaker(bible.id, row.record.id, {
        characterId: character.id,
        source: 'book-one-audio-bible-prep',
        confidence,
        evidence: candidate?.evidence ?? 'book-one-superman'
      });
      autoBound += 1;
    }

    const pronunciationReview = buildPronunciationReview(ingestResult, characterPlan);
    const continuity = this.audioBible.continuityReport(bible.id);
    const snapshot = this.audioBible.snapshot(bible.id);
    const productionReady = review.needsReview === 0 && pronunciationReview.needsConfirmation === 0;
    const prep = freeze({
      schemaVersion: 1,
      release: '0.11.2',
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
      superman: freeze({ status: supermanResult.report.status, score: supermanResult.report.score, release: supermanResult.report.release }),
      audioBible: freeze({ id: bible.id, name: bible.name, revision: this.store.get('audio_bible', bible.id).revision, digest: snapshot.digest }),
      characterPlan,
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
        ? `Review ${review.needsReview} targeted dialogue line(s) in dialogue-review.csv while primary-role casting begins in parallel.`
        : 'Confirm pronunciation candidates, then lock the Audio Bible for production.'
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
