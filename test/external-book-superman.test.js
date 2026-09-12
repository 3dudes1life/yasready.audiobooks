import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeManuscript } from '../src/manuscript/analyzer.js';
import { InMemoryStore } from '../src/repositories/in-memory-store.js';
import {
  PRIOR_BOOK_ONE_TRUTH,
  buildExternalBookSupermanReport,
  buildSyntheticExternalBookFixture,
  detectPriorTruthLeaks,
  renderExternalSupermanMarkdown
} from '../src/superman/external-book-superman.js';
import { ExternalBookSupermanService } from '../src/services/external-book-superman-service.js';

function ingestFromText(text, metadata = { title: 'External Fixture', author: 'Tester', language: 'en' }, sourceHash = 'external-source-hash') {
  return {
    analysis: analyzeManuscript({ format: 'txt', filename: 'external-fixture.txt', sourceHash, metadata, text })
  };
}

test('synthetic external fixture is unrelated to Book One identity truth', () => {
  const text = buildSyntheticExternalBookFixture({ chapters: 6, paragraphsPerChapter: 8 });
  assert.match(text, /Avery Chen|Mateo Silva|Priya Shah/);
  for (const term of ['Michael Rawlins', 'Juan Delgado', 'Christopher Lancaster']) assert.equal(text.includes(term), false);
});

test('External Book Superman disables the Book One alias profile', () => {
  const text = buildSyntheticExternalBookFixture({ chapters: 5, paragraphsPerChapter: 7 });
  const ingest = ingestFromText(text, { title: 'The Glass Harbor', author: 'Jordan Vale', language: 'en' });
  const report = buildExternalBookSupermanReport(ingest, {
    ffmpegHealth: { ok: true },
    stackProbe: { status: 'PASS', providerCallsPerformed: 0, estimateCalls: 1, syntheticAssetReferences: true, stages: [] }
  });
  assert.deepEqual(report.characterDiscovery.aliasesApplied, {});
  assert.equal(report.generalization.priorBookProfileDisabled, true);
  assert.equal(report.generalization.priorTruthLeakCount, 0);
});

test('prior-book truth leakage fails closed when output contains unsupported Book One identity', () => {
  const ingest = ingestFromText('Chapter 1\n\nAvery Chen said, “Hello.”');
  const fakeReport = {
    manuscript: { title: 'External Fixture', author: 'Tester' },
    characterDiscovery: { candidates: [{ name: 'Michael Rawlins', observedAs: ['Michael'] }] }
  };
  const leaks = detectPriorTruthLeaks(ingest, fakeReport);
  assert.ok(leaks.includes('Michael Rawlins') || leaks.includes('Michael'));
});

test('baseline hash guard rejects accidentally re-running the same source', () => {
  const text = buildSyntheticExternalBookFixture({ chapters: 3, paragraphsPerChapter: 4 });
  const ingest = ingestFromText(text, { title: 'The Glass Harbor', author: 'Jordan Vale', language: 'en' }, 'same-hash');
  const report = buildExternalBookSupermanReport(ingest, {
    baselineSourceHash: 'same-hash', ffmpegHealth: { ok: true },
    stackProbe: { status: 'PASS', providerCallsPerformed: 0, estimateCalls: 1, syntheticAssetReferences: true, stages: [] }
  });
  assert.equal(report.status, 'BLOCKED');
  assert.ok(report.findings.some((row) => row.code === 'external-source-matches-baseline'));
});

test('External Book Superman markdown never reproduces manuscript prose', () => {
  const secret = 'EXTERNAL MANUSCRIPT SECRET SENTENCE MUST NOT LEAK';
  const ingest = ingestFromText(`Chapter 1\n\nAvery Chen said, “Hello.”\n\n${secret}\n\nChapter 2\n\nMateo Silva said, “World.”`);
  const report = buildExternalBookSupermanReport(ingest, {
    ffmpegHealth: { ok: true },
    stackProbe: { status: 'PASS', providerCallsPerformed: 0, estimateCalls: 1, syntheticAssetReferences: true, stages: [] }
  });
  const markdown = renderExternalSupermanMarkdown(report);
  assert.equal(markdown.includes(secret), false);
  assert.match(markdown, /External-book identity gate/);
  assert.match(markdown, /Full-stack zero-spend wiring probe/);
});

test('service fixture exercises the full zero-spend wiring stack with no provider generation or QA calls', async () => {
  const store = new InMemoryStore();
  const service = new ExternalBookSupermanService(store, {
    ffmpeg: { healthCheck: async () => ({ ok: true, ffmpeg: 'fixture', ffprobe: 'fixture' }) },
    env: {}
  });
  const result = await service.runFixture({ fixture: { chapters: 6, paragraphsPerChapter: 7 } });
  assert.equal(result.report.stackProbe.status, 'PASS', result.report.stackProbe.error);
  assert.equal(result.report.stackProbe.providerCallsPerformed, 0);
  assert.equal(result.report.providerCallsPerformed, 0);
  assert.equal(result.report.stackProbe.productionArmed, false);
  assert.equal(result.report.stackProbe.masteringExecuted, false);
  assert.equal(result.report.stackProbe.packageExported, false);
  assert.ok(result.report.stackProbe.stages.some((row) => row.stage === 'distribution-brain' && row.status === 'PASS'));
  assert.ok(result.report.stackProbe.stages.some((row) => row.stage === 'cross-project-isolation' && row.status === 'PASS'));
});

test('known Book One truth list remains available as an explicit hostile contamination sentinel', () => {
  assert.ok(PRIOR_BOOK_ONE_TRUTH.includes('Michael Rawlins'));
  assert.ok(PRIOR_BOOK_ONE_TRUTH.includes('Juan Delgado'));
  assert.ok(PRIOR_BOOK_ONE_TRUTH.includes('Christopher Lancaster'));
});
