import { AudioBibleService } from './audio-bible-service.js';
import {
  buildSeriesContinuityPackage,
  compareBookToSeriesContinuity,
  renderSeriesCharacterCsv,
  renderSeriesContinuityMarkdown,
  renderSeriesPronunciationCsv,
  renderSeriesRelationshipCsv,
  verifySeriesContinuityPackage,
  withSeriesRelationshipGroupLock,
  withSeriesRelationshipLock,
  withSeriesVoiceLock
} from '../continuity/series-continuity.js';

const freeze = (value) => Object.freeze(value);

export class SeriesContinuityService {
  constructor(store = null) {
    this.store = store;
    this.audioBible = store ? new AudioBibleService(store) : null;
  }

  buildPackage(prep, options = {}) {
    const seriesPackage = buildSeriesContinuityPackage(prep, options);
    return freeze({
      package: seriesPackage,
      markdown: renderSeriesContinuityMarkdown(seriesPackage),
      characterCsv: renderSeriesCharacterCsv(seriesPackage),
      pronunciationCsv: renderSeriesPronunciationCsv(seriesPackage),
      relationshipCsv: renderSeriesRelationshipCsv(seriesPackage)
    });
  }

  compare(seriesPackage, nextPrep) {
    return compareBookToSeriesContinuity(seriesPackage, nextPrep);
  }

  lockVoice(seriesPackage, options) {
    return withSeriesVoiceLock(seriesPackage, options);
  }

  lockRelationship(seriesPackage, options) {
    return withSeriesRelationshipLock(seriesPackage, options);
  }

  lockRelationshipGroup(seriesPackage, options) {
    return withSeriesRelationshipGroupLock(seriesPackage, options);
  }

  renderPackage(seriesPackage) {
    const check = verifySeriesContinuityPackage(seriesPackage);
    if (!check.valid) throw new Error(`invalid Series Continuity package: ${check.reason}`);
    return freeze({
      package: seriesPackage,
      markdown: renderSeriesContinuityMarkdown(seriesPackage),
      characterCsv: renderSeriesCharacterCsv(seriesPackage),
      pronunciationCsv: renderSeriesPronunciationCsv(seriesPackage),
      relationshipCsv: renderSeriesRelationshipCsv(seriesPackage)
    });
  }

  materializeSeriesBible({ projectId, seriesPackage }) {
    if (!this.store || !this.audioBible) throw new Error('materializeSeriesBible requires a store-backed SeriesContinuityService');
    const check = verifySeriesContinuityPackage(seriesPackage);
    if (!check.valid) throw new Error(`invalid Series Continuity package: ${check.reason}`);

    const series = this.audioBible.createSeries({
      projectId,
      title: seriesPackage.series.title,
      author: seriesPackage.series.author
    });
    const bible = this.audioBible.createBible({
      projectId,
      name: `${seriesPackage.series.title} — Series Audio Bible`,
      scope: 'series',
      seriesId: series.id
    });

    const characterByKey = new Map();
    for (const row of seriesPackage.characters) {
      const character = this.audioBible.addCharacter(bible.id, {
        canonicalName: row.canonicalName,
        aliases: row.aliases,
        role: row.role,
        pronouns: row.pronouns,
        description: row.description,
        performanceProfile: {
          ...(row.performanceProfile ?? {}),
          seriesContinuityRelease: seriesPackage.release,
          continuityPolicy: row.continuityPolicy,
          sourceBookId: row.sourceBookId
        },
        seriesCharacterKey: row.seriesCharacterKey
      });
      characterByKey.set(row.seriesCharacterKey, character);
    }

    for (const row of seriesPackage.pronunciations.explicitRules ?? []) {
      this.audioBible.addPronunciation(bible.id, row);
    }

    for (const row of seriesPackage.relationships ?? []) {
      const from = characterByKey.get(row.fromSeriesCharacterKey);
      const to = characterByKey.get(row.toSeriesCharacterKey);
      if (!from || !to) continue;
      this.audioBible.addRelationship(bible.id, {
        fromCharacterId: from.id,
        toCharacterId: to.id,
        kind: row.kind,
        label: row.label,
        notes: row.notes
      });
    }

    const snapshot = this.audioBible.snapshot(bible.id);
    return freeze({ series, bible: this.store.get('audio_bible', bible.id), characterByKey, snapshot, continuity: this.audioBible.continuityReport(bible.id) });
  }

  createInheritedBookBible({ projectId, bookId, seriesBibleId, name = 'Inherited Book Audio Bible' }) {
    if (!this.store || !this.audioBible) throw new Error('createInheritedBookBible requires a store-backed SeriesContinuityService');
    const seriesBible = this.store.get('audio_bible', seriesBibleId);
    if (!seriesBible || seriesBible.scope !== 'series') throw new Error('seriesBibleId must reference a series Audio Bible');
    const bible = this.audioBible.createBible({
      projectId,
      name,
      scope: 'book',
      bookId,
      seriesId: seriesBible.seriesId,
      parentBibleId: seriesBibleId
    });
    return freeze({ bible, continuity: this.audioBible.continuityReport(bible.id), snapshot: this.audioBible.snapshot(bible.id) });
  }
}
