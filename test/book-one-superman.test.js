import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeManuscript, segmentScene, splitChapters } from '../src/manuscript/analyzer.js';
import {
  BOOK_ONE_PROFILE,
  buildBookOneSupermanReport,
  buildSpeakerCandidateRoster,
  buildSyntheticBookOneFixture,
  renderSupermanMarkdown,
  simulateProduction
} from '../src/superman/book-one-superman.js';

function ingestFromText(text, metadata = { title: 'Fixture', author: 'Tester', language: 'en' }) {
  const analysis = analyzeManuscript({
    format: 'txt', filename: 'fixture.txt', sourceHash: 'source-hash', metadata, text
  });
  return { analysis };
}

test('speaker detection never treats common pronouns as character names', () => {
  const segments = segmentScene('He said, “I am not a character name.”\n\nMichael said, “I am.”');
  const dialogue = segments.filter((row) => row.kind === 'dialogue');
  assert.equal(dialogue[0].speakerCandidate, null);
  assert.equal(dialogue[1].speakerCandidate.name, 'Michael');
});

test('synthetic Book One fixture produces a multi-chapter full-book rehearsal', () => {
  const text = buildSyntheticBookOneFixture({ chapters: 12, paragraphsPerChapter: 8 });
  const ingest = ingestFromText(text, { title: 'Synthetic Book', author: 'Tester', language: 'en' });
  assert.ok(ingest.analysis.metrics.chapters >= 12); // optional synthetic front matter may become its own section
  assert.ok(ingest.analysis.metrics.words > 1000);
  assert.ok(ingest.analysis.metrics.dialogueSegments > 50);
});

test('candidate roster extracts real names and excludes pronoun noise', () => {
  const ingest = ingestFromText('Chapter 1\n\nHe said, “No.”\n\nMichael said, “Yes.”\n\nJuan asked, “Really?”');
  const roster = buildSpeakerCandidateRoster(ingest.analysis);
  assert.deepEqual(roster.map((row) => row.name).sort(), ['Juan Delgado', 'Michael Rawlins']);
});

test('production rehearsal chunks the whole manuscript under the model safety cap', () => {
  const longLine = `Michael said, “${'This sentence should remain safely chunked. '.repeat(400)}”`;
  const ingest = ingestFromText(`Chapter 1\n\n${longLine}`);
  const simulation = simulateProduction(ingest.analysis, { model: 'eleven_v3' });
  assert.ok(simulation.renderJobEstimate > 1);
  assert.ok(simulation.maxChunkCharacters <= simulation.modelCharacterCap);
  assert.equal(simulation.providerCallsPerformed, 0);
});

test('cost rehearsal includes regeneration reserve and audition allowance', () => {
  const text = buildSyntheticBookOneFixture({ chapters: 4, paragraphsPerChapter: 4 });
  const ingest = ingestFromText(text);
  const simulation = simulateProduction(ingest.analysis, {
    model: 'eleven_multilingual_v2', regenerationReserveRatio: 0.25, auditionAllowanceUsd: 5
  });
  assert.ok(simulation.initialTtsUsd > 0);
  assert.ok(simulation.regenerationReserveUsd > 0);
  assert.ok(simulation.recommendedProductionBudgetUsd > simulation.initialTtsUsd);
});

test('Superman report is zero-spend and provides next action', () => {
  const text = buildSyntheticBookOneFixture({ chapters: 8, paragraphsPerChapter: 6 });
  const ingest = ingestFromText(text);
  const report = buildBookOneSupermanReport(ingest, {
    apiKeyPresent: false,
    ffmpegHealth: { ok: true, ffmpeg: 'ffmpeg test', ffprobe: 'ffprobe test' }
  });
  assert.equal(report.providerCallsPerformed, 0);
  assert.equal(report.gates.paidGenerationArmed, false);
  assert.equal(report.environment.ffmpegReady, true);
  assert.ok(report.nextAction.length > 5);
});

test('duplicate chapter content is a blocking Superman finding', () => {
  const text = 'Chapter 1\n\nSame exact body.\n\nChapter 2\n\nSame exact body.';
  const ingest = ingestFromText(text);
  const report = buildBookOneSupermanReport(ingest, { ffmpegHealth: { ok: true } });
  assert.equal(report.status, 'BLOCKED');
  assert.ok(report.findings.some((row) => row.code === 'duplicate-chapter-content' && row.severity === 'critical'));
});

test('Markdown report contains operator-facing production rehearsal, not manuscript text', () => {
  const secretPhrase = 'UNIQUE SECRET MANUSCRIPT SENTENCE SHOULD NOT LEAK';
  const ingest = ingestFromText(`Chapter 1\n\nMichael said, “Hello.”\n\n${secretPhrase}\n\nChapter 2\n\nJuan said, “World.”`);
  const report = buildBookOneSupermanReport(ingest, { ffmpegHealth: { ok: true } });
  const markdown = renderSupermanMarkdown(report);
  assert.match(markdown, /Production rehearsal — ZERO SPEND/);
  assert.match(markdown, /Provider calls performed:\*\* 0/);
  assert.equal(markdown.includes(secretPhrase), false);
});


test('contextual dialogue attribution uses nearby action and speech tags without stealing the next paragraph lead', () => {
  const segments = segmentScene('Rawlins said, “Earlier.”\n\nRawlins raised an eyebrow.\n\n“I am fine.”\n\nDelgado replied, “Sure you are.”');
  const dialogue = segments.filter((row) => row.kind === 'dialogue');
  assert.equal(dialogue[1].speakerCandidate?.name, 'Rawlins');
  assert.equal(dialogue[1].speakerCandidate?.evidence, 'context-before-action');
  assert.equal(dialogue[2].speakerCandidate?.name, 'Delgado');
});

test('print front matter is separated before the first numbered chapter', () => {
  const sections = splitChapters('Tres Amigos, Una Vida\n\nby D.C.W.\n\nCopyright 2025\nAll rights reserved\n\nTable of Contents\n\nChapter 1: Departure\n\nStory starts here.');
  assert.equal(sections[0].title, 'Front Matter');
  assert.equal(sections[1].title, 'Chapter 1: Departure');
});

test('front matter byline is inferred when document metadata is missing', () => {
  const analysis = analyzeManuscript({
    format: 'txt', filename: 'fixture.txt', sourceHash: 'hash', metadata: {},
    text: 'Book Title\n\nby D.C.W.\n\nCopyright 2025\nAll rights reserved\n\nChapter 1\n\nHello world.'
  }, { title: BOOK_ONE_PROFILE.title });
  assert.equal(analysis.metadata.title, BOOK_ONE_PROFILE.title);
  assert.equal(analysis.metadata.author, 'D.C.W.');
});

test('Book One aliases collapse first names surnames and known typo evidence without rewriting text', () => {
  const ingest = ingestFromText('Chapter 1\n\nMichael said, “One.”\n\nRawlins replied, “Two.”\n\nMicheal said, “Three.”\n\nJuan said, “Four.”\n\nDelgado replied, “Five.”\n\nChris said, “Six.”');
  const roster = buildSpeakerCandidateRoster(ingest.analysis);
  const names = roster.map((row) => row.name);
  assert.ok(names.includes('Michael Rawlins'));
  assert.ok(names.includes('Juan Delgado'));
  assert.ok(names.includes('Christopher Lancaster'));
  const michael = roster.find((row) => row.name === 'Michael Rawlins');
  assert.deepEqual(new Set(michael.observedAs), new Set(['Michael', 'Rawlins', 'Micheal']));
});

test('Superman cost rehearsal excludes print-only Front Matter but preserves it in source section counts', () => {
  const ingest = ingestFromText('Book Title\n\nby D.C.W.\n\nCopyright 2025\nAll rights reserved\n\nTable of Contents\n\nChapter 1: Departure\n\nMichael said, “Hello.”');
  const report = buildBookOneSupermanReport(ingest, { ffmpegHealth: { ok: true } });
  assert.equal(report.manuscript.sourceSectionCount, 2);
  assert.equal(report.manuscript.narrativeChapterCount, 1);
  assert.equal(report.production.excludedSectionCount, 1);
  assert.deepEqual(report.production.excludedSections, ['Front Matter']);
});
