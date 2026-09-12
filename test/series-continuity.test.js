import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AudioBibleService,
  InMemoryStore,
  ManuscriptService,
  ProjectService,
  SeriesContinuityService,
  buildSeriesContinuityPackage,
  compareBookToSeriesContinuity,
  deriveSeriesTitle,
  verifySeriesContinuityPackage,
  withSeriesVoiceLock
} from '../src/index.js';

function lockedPrep() {
  return {
    schemaVersion: 7,
    release: '0.11.8',
    status: 'AUDIO_BIBLE_LOCKED',
    providerCallsPerformed: 0,
    book: { id: 'book-1', title: 'Tres Amigos, Una Vida – A Throuple Love Story', author: 'D.C.W.', language: 'en', sourceHash: 'book-one-hash' },
    audioBible: { id: 'bible-1', revision: 7, digest: 'snapshot-digest', locked: true, lockRelease: '0.11.8' },
    characterPlan: [
      { canonicalName: 'Narrator', aliases: [], role: 'narrator', seriesCharacterKey: 'narrator', continuityScope: 'book', mentions: 0, averageConfidence: 1, source: 'required-narration-role' },
      { canonicalName: 'Michael Rawlins', aliases: ['Michael'], role: 'primary', seriesCharacterKey: 'michael-rawlins', continuityScope: 'book', mentions: 500, averageConfidence: 0.98, source: 'book-one-superman' },
      { canonicalName: 'Juan Delgado', aliases: ['Juan'], role: 'primary', seriesCharacterKey: 'juan-delgado', continuityScope: 'book', mentions: 600, averageConfidence: 0.98, source: 'book-one-superman' },
      { canonicalName: 'Dani', aliases: [], role: 'supporting', seriesCharacterKey: 'dani', continuityScope: 'book', mentions: 20, averageConfidence: 0.95, source: 'book-one-superman' },
      { canonicalName: 'Realtor', aliases: ['the realtor'], role: 'minor', seriesCharacterKey: 'realtor', continuityScope: 'book', mentions: 4, averageConfidence: 0.9, source: 'book-one-intelligence-relational-role', provisional: true, castingStatus: 'provisional' }
    ],
    sceneLocalRoles: [
      { canonicalName: "New Year's Couple – Man (Derek)", aliases: ['Derek'], role: 'minor', continuityScope: 'scene', chapterOrder: 34, mentions: 6 }
    ],
    dialogueReview: { needsReview: 0, unresolved: 0 },
    pronunciationReview: {
      needsConfirmation: 0,
      candidates: [
        { term: 'Michael Rawlins', category: 'character-name', ruleRequired: false, language: 'en', resolutionMode: 'standard-orthography' },
        { term: 'D.C.W.', category: 'initialism', ruleRequired: true, spokenAs: 'D C W', language: 'en' }
      ]
    },
    continuity: { unresolvedDialogueSegments: 0 },
    gates: { audioBibleLocked: true, productionReady: true },
    snapshot: {
      digest: 'snapshot-digest',
      characters: [
        { id: 'n', canonicalName: 'Narrator', aliases: [], role: 'narrator', seriesCharacterKey: 'narrator', performanceProfile: {} },
        { id: 'm', canonicalName: 'Michael Rawlins', aliases: ['Michael'], role: 'primary', seriesCharacterKey: 'michael-rawlins', performanceProfile: { warmth: 'grounded' } },
        { id: 'j', canonicalName: 'Juan Delgado', aliases: ['Juan'], role: 'primary', seriesCharacterKey: 'juan-delgado', performanceProfile: { energy: 'warm' } },
        { id: 'd', canonicalName: 'Dani', aliases: [], role: 'supporting', seriesCharacterKey: 'dani', performanceProfile: {} },
        { id: 'r', canonicalName: 'Realtor', aliases: ['the realtor'], role: 'minor', seriesCharacterKey: 'realtor', performanceProfile: { provisional: true } }
      ],
      pronunciations: [
        { bibleId: 'bible-1', term: 'D.C.W.', spokenAs: 'D C W', notation: 'plain', language: 'en', caseSensitive: true, source: 'yasready-default-0.11.8' }
      ],
      relationships: [
        { bibleId: 'bible-1', fromCharacterId: 'm', toCharacterId: 'j', kind: 'partner', label: 'romantic partner', notes: null }
      ]
    }
  };
}

function nextBookPrep() {
  return {
    release: '0.12.0-test',
    status: 'AUDIO_BIBLE_LOCKED',
    book: { id: 'book-2', title: 'Fault Lines', sourceHash: 'book-two-hash' },
    characterPlan: [
      { canonicalName: 'Narrator', aliases: [], role: 'narrator', seriesCharacterKey: 'narrator', continuityScope: 'book' },
      { canonicalName: 'Michael Rawlins', aliases: ['Michael'], role: 'primary', seriesCharacterKey: 'michael-rawlins', continuityScope: 'book' },
      { canonicalName: 'Juan Delgado', aliases: ['Juan'], role: 'primary', seriesCharacterKey: 'juan-delgado', continuityScope: 'book' },
      { canonicalName: 'Dani', aliases: [], role: 'supporting', seriesCharacterKey: 'dani', continuityScope: 'book' },
      { canonicalName: 'New Person', aliases: ['Newbie'], role: 'supporting', seriesCharacterKey: 'new-person', continuityScope: 'book' }
    ],
    sceneLocalRoles: [{ canonicalName: 'Bartender', continuityScope: 'scene' }],
    snapshot: { pronunciations: [] }
  };
}

test('series title derives from subtitle-delimited book title', () => {
  assert.equal(deriveSeriesTitle('Tres Amigos, Una Vida – A Throuple Love Story'), 'Tres Amigos, Una Vida');
});

test('locked Book One prep promotes permanent roles and excludes scene extras', () => {
  const pkg = buildSeriesContinuityPackage(lockedPrep());
  assert.equal(pkg.status, 'SERIES_CONTINUITY_READY');
  assert.equal(pkg.series.title, 'Tres Amigos, Una Vida');
  assert.equal(pkg.characters.length, 5);
  assert.equal(pkg.sceneLocalExcluded.length, 1);
  assert.ok(!pkg.characters.some((x) => x.canonicalName.includes('Derek')));
  assert.equal(pkg.characters.find((x) => x.canonicalName === 'Realtor').continuityPolicy, 'reference-only');
  assert.equal(pkg.pronunciations.explicitRules.length, 1);
  assert.equal(pkg.pronunciations.standardReadings.length, 1);
  assert.equal(pkg.providerCallsPerformed, 0);
  assert.equal(verifySeriesContinuityPackage(pkg).valid, true);
});

test('series package refuses unlocked or unresolved prep artifacts', () => {
  const unlocked = lockedPrep();
  unlocked.status = 'READY_FOR_AUDIO_BIBLE_REVIEW';
  assert.throws(() => buildSeriesContinuityPackage(unlocked), /AUDIO_BIBLE_LOCKED/);
  const unresolved = lockedPrep();
  unresolved.dialogueReview.needsReview = 1;
  assert.throws(() => buildSeriesContinuityPackage(unresolved), /unresolved speaker review/);
});

test('series continuity comparison finds recurring and new Book Two characters', () => {
  const pkg = buildSeriesContinuityPackage(lockedPrep());
  const result = compareBookToSeriesContinuity(pkg, nextBookPrep());
  assert.equal(result.status, 'PASS');
  assert.equal(result.recurringCharacters.length, 4);
  assert.equal(result.newCharacters.length, 1);
  assert.equal(result.newCharacters[0].canonicalName, 'New Person');
  assert.equal(result.sceneLocalRoleCount, 1);
  assert.equal(result.identityConflicts.length, 0);
  assert.equal(result.pronunciation.inheritedRules, 1);
  assert.equal(result.providerCallsPerformed, 0);
});

test('missing required primary character puts continuity into review', () => {
  const pkg = buildSeriesContinuityPackage(lockedPrep());
  const next = nextBookPrep();
  next.characterPlan = next.characterPlan.filter((x) => x.seriesCharacterKey !== 'juan-delgado');
  const result = compareBookToSeriesContinuity(pkg, next);
  assert.equal(result.status, 'REVIEW');
  assert.ok(result.missingRequiredCharacters.some((x) => x.seriesCharacterKey === 'juan-delgado'));
});

test('pronunciation drift blocks continuity rather than silently replacing series truth', () => {
  const pkg = buildSeriesContinuityPackage(lockedPrep());
  const next = nextBookPrep();
  next.snapshot.pronunciations = [{ term: 'D.C.W.', spokenAs: 'dee cue double-u', notation: 'plain', language: 'en', caseSensitive: true }];
  const result = compareBookToSeriesContinuity(pkg, next);
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.pronunciation.conflicts.length, 1);
});

test('series voice lock cannot be silently recast', () => {
  let pkg = buildSeriesContinuityPackage(lockedPrep());
  pkg = withSeriesVoiceLock(pkg, { seriesCharacterKey: 'michael-rawlins', provider: 'elevenlabs', providerVoiceId: 'voice-a', safetyScore: 92 });
  assert.equal(pkg.voiceContinuity.lockedCount, 1);
  assert.equal(verifySeriesContinuityPackage(pkg).valid, true);
  assert.throws(() => withSeriesVoiceLock(pkg, { seriesCharacterKey: 'michael-rawlins', provider: 'elevenlabs', providerVoiceId: 'voice-b' }), /explicit override/);
  const changed = withSeriesVoiceLock(pkg, { seriesCharacterKey: 'michael-rawlins', provider: 'elevenlabs', providerVoiceId: 'voice-b', override: true, reason: 'author-approved recast' });
  assert.equal(changed.voiceContinuity.assignments[0].providerVoiceId, 'voice-b');
});

test('series package materializes into a series bible and a next book inherits it', () => {
  const store = new InMemoryStore();
  const project = new ProjectService(store).create({ name: 'Series Continuity Test' });
  const manuscript = new ManuscriptService(store);
  const bookTwo = manuscript.ingestBuffer(project.id, Buffer.from('Chapter 1\n\nMichael said, “We are back.”'), { filename: 'book-two.txt', title: 'Fault Lines', author: 'D.C.W.' });
  const continuity = new SeriesContinuityService(store);
  const built = continuity.buildPackage(lockedPrep());
  const materialized = continuity.materializeSeriesBible({ projectId: project.id, seriesPackage: built.package });
  assert.equal(materialized.snapshot.characters.length, 5);
  assert.equal(materialized.snapshot.pronunciations.length, 1);
  const child = continuity.createInheritedBookBible({ projectId: project.id, bookId: bookTwo.book.id, seriesBibleId: materialized.bible.id, name: 'Fault Lines — Audio Bible' });
  assert.equal(child.continuity.inheritedCharacters, 5);
  const bible = new AudioBibleService(store);
  assert.equal(bible.resolveSpeaker(child.bible.id, 'Michael').character.canonicalName, 'Michael Rawlins');
  assert.equal(bible.resolvePronunciation(child.bible.id, 'D.C.W.').spokenAs, 'D C W');
});

test('service renders local operator artifacts without manuscript excerpts or provider calls', () => {
  const service = new SeriesContinuityService();
  const built = service.buildPackage(lockedPrep());
  assert.match(built.markdown, /Series Continuity/);
  assert.match(built.characterCsv, /michael-rawlins/);
  assert.match(built.pronunciationCsv, /D\.C\.W\./);
  assert.equal(built.package.providerCallsPerformed, 0);
  assert.ok(!built.markdown.includes('Come here'));
});
