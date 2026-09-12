import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeManuscript, segmentScene } from '../src/manuscript/analyzer.js';
import {
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
  assert.deepEqual(roster.map((row) => row.name).sort(), ['Juan', 'Michael']);
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
