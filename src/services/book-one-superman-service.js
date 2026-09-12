import { sha256 } from '../core/hash.js';
import { FfmpegAdapter } from '../mastering/ffmpeg-adapter.js';
import { ManuscriptService } from './manuscript-service.js';
import { ProjectService } from './project-service.js';
import {
  BOOK_ONE_PROFILE,
  buildBookOneSupermanReport,
  buildSyntheticBookOneFixture,
  renderSupermanMarkdown
} from '../superman/book-one-superman.js';

export class BookOneSupermanService {
  constructor(store, {
    projectService = null,
    manuscriptService = null,
    ffmpeg = null,
    env = process.env
  } = {}) {
    if (!store) throw new Error('BookOneSupermanService requires a store');
    this.store = store;
    this.projects = projectService ?? new ProjectService(store);
    this.manuscripts = manuscriptService ?? new ManuscriptService(store);
    this.ffmpeg = ffmpeg ?? new FfmpegAdapter();
    this.env = env ?? {};
  }

  async runFile(filePath, options = {}) {
    if (!String(filePath ?? '').trim()) throw new Error('Book One Superman requires a manuscript file path');
    const project = this.projects.create({ name: options.projectName ?? 'Book One Superman' });
    const ingestResult = this.manuscripts.ingestFile(project.id, filePath, {
      title: options.title ?? BOOK_ONE_PROFILE.title,
      ...(options.author ? { author: options.author } : {}),
      ...(options.language ? { language: options.language } : {})
    });
    return this.#report(project, ingestResult, options);
  }

  async reportExisting(project, ingestResult, options = {}) {
    if (!project?.id || !ingestResult?.analysis) throw new Error('reportExisting requires project and ingestResult');
    return this.#report(project, ingestResult, options);
  }

  async runFixture(options = {}) {
    const project = this.projects.create({ name: options.projectName ?? 'Book One Superman Synthetic Rehearsal' });
    const text = buildSyntheticBookOneFixture(options.fixture ?? {});
    const ingestResult = this.manuscripts.ingestExtracted(project.id, {
      format: 'txt',
      filename: 'book-one-superman-fixture.txt',
      sourceHash: sha256(text),
      metadata: { title: 'Synthetic Book One Superman Fixture', author: 'YasReady Test Author', language: 'en' },
      text
    }, {});
    return this.#report(project, ingestResult, { ...options, label: options.label ?? 'Book One Superman — Synthetic Rehearsal' });
  }

  async #report(project, ingestResult, options) {
    const ffmpegHealth = this.ffmpeg?.healthCheck ? await this.ffmpeg.healthCheck() : { ok: false, reason: 'FFmpeg adapter not configured' };
    const report = buildBookOneSupermanReport(ingestResult, {
      model: options.model ?? 'eleven_multilingual_v2',
      apiKeyPresent: Boolean(this.env.ELEVENLABS_API_KEY),
      ffmpegHealth,
      nodeVersion: process.versions.node,
      regenerationReserveRatio: options.regenerationReserveRatio ?? 0.25,
      auditionAllowanceUsd: options.auditionAllowanceUsd ?? 5,
      label: options.label ?? 'Book One Superman'
    });
    return Object.freeze({ project, ingestResult, report, markdown: renderSupermanMarkdown(report) });
  }
}
