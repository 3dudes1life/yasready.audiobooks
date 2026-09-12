import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AudioBibleService,
  InMemoryStore,
  ManuscriptService,
  ProjectService,
  normalizeIdentity
} from '../src/index.js';

function setupBook() {
  const store = new InMemoryStore();
  const projects = new ProjectService(store);
  const project = projects.create({ name: 'Audio Bible Test' });
  const manuscript = new ManuscriptService(store);
  const ingested = manuscript.ingestBuffer(project.id, Buffer.from(`Chapter 1\n\n“Come here,” Michael said.\n\n***\n\n“Fine,” Juan replied.`), {
    filename: 'test.txt', title: 'Book One', author: 'Author'
  });
  const bible = new AudioBibleService(store);
  return { store, project, ingested, bible };
}

test('identity normalization safely matches accents, apostrophes and spacing', () => {
  assert.equal(normalizeIdentity('  José   O’Neil  '), "jose o'neil");
});

test('book bible requires a real book in the same project', () => {
  const store = new InMemoryStore();
  const project = new ProjectService(store).create({ name: 'P' });
  const bible = new AudioBibleService(store);
  assert.throws(() => bible.createBible({ projectId: project.id, name: 'Bad', scope: 'book', bookId: 'missing' }), /requires a book/);
});

test('series bible is inherited by a book bible', () => {
  const { project, ingested, bible } = setupBook();
  const series = bible.createSeries({ projectId: project.id, title: 'Series' });
  const seriesBible = bible.createBible({ projectId: project.id, name: 'Series Bible', scope: 'series', seriesId: series.id });
  const michael = bible.addCharacter(seriesBible.id, {
    canonicalName: 'Michael Rawlins', aliases: ['Michael', 'Mike'], role: 'primary',
    performanceProfile: { energy: 'grounded', warmth: 'warm' }
  });
  const bookBible = bible.createBible({
    projectId: project.id, name: 'Book One Bible', scope: 'book', bookId: ingested.book.id,
    parentBibleId: seriesBible.id
  });
  assert.equal(bible.listCharacters(bookBible.id).length, 1);
  assert.equal(bible.resolveSpeaker(bookBible.id, 'Mike').character.id, michael.id);
  assert.equal(bible.continuityReport(bookBible.id).inheritedCharacters, 1);
});

test('aliases cannot collide with effective inherited cast', () => {
  const { project, ingested, bible } = setupBook();
  const series = bible.createSeries({ projectId: project.id, title: 'Series' });
  const seriesBible = bible.createBible({ projectId: project.id, name: 'Series Bible', scope: 'series', seriesId: series.id });
  bible.addCharacter(seriesBible.id, { canonicalName: 'Juan Delgado', aliases: ['Juan'], role: 'primary' });
  const bookBible = bible.createBible({ projectId: project.id, name: 'Book', scope: 'book', bookId: ingested.book.id, parentBibleId: seriesBible.id });
  assert.throws(() => bible.addCharacter(bookBible.id, { canonicalName: 'Other Person', aliases: ['Juan'] }), /already assigned/);
});

test('speaker candidate resolves conservatively to canonical character', () => {
  const { project, ingested, bible } = setupBook();
  const bookBible = bible.createBible({ projectId: project.id, name: 'Book Bible', scope: 'book', bookId: ingested.book.id });
  const michael = bible.addCharacter(bookBible.id, { canonicalName: 'Michael Rawlins', aliases: ['Michael'], role: 'primary' });
  const dialogue = ingested.segments.find((row) => row.kind === 'dialogue' && row.speakerCandidate?.name === 'Michael');
  const resolution = bible.resolveSpeaker(bookBible.id, dialogue.speakerCandidate);
  assert.equal(resolution.status, 'resolved');
  assert.equal(resolution.character.id, michael.id);
  assert.equal(resolution.confidence, dialogue.speakerCandidate.confidence);
});

test('unknown speaker remains unresolved rather than being guessed', () => {
  const { project, ingested, bible } = setupBook();
  const bookBible = bible.createBible({ projectId: project.id, name: 'Book Bible', scope: 'book', bookId: ingested.book.id });
  bible.addCharacter(bookBible.id, { canonicalName: 'Michael Rawlins', aliases: ['Michael'] });
  const result = bible.resolveSpeaker(bookBible.id, { name: 'Christopher', confidence: 0.91 });
  assert.equal(result.status, 'unresolved');
  assert.equal(result.reason, 'no-canonical-match');
});

test('binding a dialogue segment creates an auditable canonical binding', () => {
  const { store, project, ingested, bible } = setupBook();
  const bookBible = bible.createBible({ projectId: project.id, name: 'Book Bible', scope: 'book', bookId: ingested.book.id });
  const michael = bible.addCharacter(bookBible.id, { canonicalName: 'Michael Rawlins', aliases: ['Michael'] });
  const dialogue = ingested.segments.find((row) => row.kind === 'dialogue' && row.speakerCandidate?.name === 'Michael');
  const result = bible.bindSegmentSpeaker(bookBible.id, dialogue.id);
  assert.equal(result.status, 'bound');
  assert.equal(result.character.id, michael.id);
  assert.equal(store.get('segment', dialogue.id).characterId, michael.id);
  assert.equal(store.list('speaker_binding').length, 1);
});

test('pronunciation rules inherit and book rules may override series rules', () => {
  const { project, ingested, bible } = setupBook();
  const series = bible.createSeries({ projectId: project.id, title: 'Series' });
  const seriesBible = bible.createBible({ projectId: project.id, name: 'Series Bible', scope: 'series', seriesId: series.id });
  bible.addPronunciation(seriesBible.id, { term: 'Delgado', spokenAs: 'del-GAH-doh', source: 'author' });
  const bookBible = bible.createBible({ projectId: project.id, name: 'Book Bible', scope: 'book', bookId: ingested.book.id, parentBibleId: seriesBible.id });
  assert.equal(bible.resolvePronunciation(bookBible.id, 'DELGADO').spokenAs, 'del-GAH-doh');
  bible.addPronunciation(bookBible.id, { term: 'Delgado', spokenAs: 'del-GA-do', source: 'director' });
  assert.equal(bible.resolvePronunciation(bookBible.id, 'Delgado').spokenAs, 'del-GA-do');
});

test('bible revision and digest change after production-relevant edits', () => {
  const { project, ingested, bible } = setupBook();
  const bookBible = bible.createBible({ projectId: project.id, name: 'Book Bible', scope: 'book', bookId: ingested.book.id });
  const before = bible.snapshot(bookBible.id);
  const michael = bible.addCharacter(bookBible.id, { canonicalName: 'Michael Rawlins', aliases: ['Michael'] });
  const afterCharacter = bible.snapshot(bookBible.id);
  assert.notEqual(afterCharacter.digest, before.digest);
  bible.updateCharacterProfile(michael.id, { performanceProfile: { warmth: 'restrained', pace: 'measured' } });
  const afterProfile = bible.snapshot(bookBible.id);
  assert.notEqual(afterProfile.digest, afterCharacter.digest);
  assert.ok(afterProfile.bible.revision > before.bible.revision);
});

test('relationships are limited to characters visible in the effective bible', () => {
  const { project, ingested, bible } = setupBook();
  const bookBible = bible.createBible({ projectId: project.id, name: 'Book Bible', scope: 'book', bookId: ingested.book.id });
  const michael = bible.addCharacter(bookBible.id, { canonicalName: 'Michael Rawlins' });
  const juan = bible.addCharacter(bookBible.id, { canonicalName: 'Juan Delgado' });
  const relationship = bible.addRelationship(bookBible.id, {
    fromCharacterId: michael.id, toCharacterId: juan.id, kind: 'partner', label: 'romantic partner'
  });
  assert.equal(relationship.kind, 'partner');
  assert.equal(bible.listRelationships(bookBible.id).length, 1);
});
