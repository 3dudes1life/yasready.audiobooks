import { analyzeManuscript } from '../manuscript/analyzer.js';
import { extractManuscript, extractManuscriptFile } from '../manuscript/extractors.js';
import { createBook, createChapter, createScene, createSegment } from '../domain/model.js';
import { transitionProject } from '../domain/state-machine.js';

export class ManuscriptService {
  constructor(store) {
    this.store = store;
  }

  ingestFile(projectId, filePath, options = {}) {
    return this.ingestExtracted(projectId, extractManuscriptFile(filePath, options), options);
  }

  ingestBuffer(projectId, input, options = {}) {
    const extracted = extractManuscript(input, options);
    return this.ingestExtracted(projectId, extracted, options);
  }

  ingestExtracted(projectId, extracted, options = {}) {
    const project = this.store.get('project', projectId);
    if (!project) throw new Error(`project ${projectId} not found`);
    if (project.locked) throw new Error(`project ${projectId} is locked`);
    if (!['draft', 'analyzed'].includes(project.status)) throw new Error(`cannot ingest manuscript while project is ${project.status}`);

    const analysis = analyzeManuscript(extracted, options);
    const book = this.store.put(createBook({
      projectId,
      title: analysis.metadata.title ?? options.fallbackTitle ?? extracted.filename,
      author: analysis.metadata.author,
      language: analysis.metadata.language,
      sourceFormat: extracted.format,
      sourceHash: extracted.sourceHash,
      manuscriptMetrics: analysis.metrics
    }));

    const chapterRecords = [];
    const sceneRecords = [];
    const segmentRecords = [];
    for (const chapter of analysis.chapters) {
      const chapterRecord = this.store.put(createChapter({
        projectId, bookId: book.id, order: chapter.order, title: chapter.title, textHash: chapter.textHash
      }));
      chapterRecords.push(chapterRecord);
      for (const scene of chapter.scenes) {
        const sceneRecord = this.store.put(createScene({
          projectId, bookId: book.id, chapterId: chapterRecord.id, order: scene.order, textHash: scene.textHash
        }));
        sceneRecords.push(sceneRecord);
        for (const segment of scene.segments) {
          const segmentRecord = this.store.put(createSegment({
            projectId, bookId: book.id, chapterId: chapterRecord.id, sceneId: sceneRecord.id,
            order: segment.order, text: segment.text, kind: segment.kind,
            speakerCandidate: segment.speakerCandidate
          }));
          segmentRecords.push(segmentRecord);
        }
      }
    }

    if (project.status === 'draft') {
      this.store.update('project', projectId, (current) => transitionProject(current, 'analyzed'));
    }

    return Object.freeze({
      analysis,
      book,
      chapters: Object.freeze(chapterRecords),
      scenes: Object.freeze(sceneRecords),
      segments: Object.freeze(segmentRecords)
    });
  }
}
