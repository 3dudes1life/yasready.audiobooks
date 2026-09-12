import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compareTranscript,
  findAdjacentDuplicates,
  pronunciationRisks,
  alignmentAnomalies,
  transcriptConfidenceFindings
} from '../src/qa/text-diff.js';
import { ContinuityQaService } from '../src/services/continuity-qa-service.js';

class Store {
  constructor() { this.rows = new Map(); }
  put(row) { if (!this.rows.has(row.type)) this.rows.set(row.type, new Map()); this.rows.get(row.type).set(row.id, Object.freeze({ ...row })); return this.get(row.type, row.id); }
  get(type, id) { return this.rows.get(type)?.get(id) ?? null; }
  list(type, predicate = null) { const rows = [...(this.rows.get(type)?.values() ?? [])]; return predicate ? rows.filter(predicate) : rows; }
  update(type, id, fn) { const current = this.get(type, id); if (!current) throw new Error(`${type} ${id} not found`); return this.put(fn(current)); }
}

function fixture({ transcript = 'Michael walked home.', alignmentLoss = 0.1 } = {}) {
  const store = new Store();
  store.put({ id: 'session1', type: 'review_session', projectId: 'p1', bookId: 'b1', productionPlanId: 'prod1', status: 'approved', locked: true });
  store.put({ id: 'take1', type: 'review_take', sessionId: 'session1', chapterReviewId: 'chapter-review1', jobId: 'job1', asset: { storageLocator: 'private://take1.mp3' } });
  store.put({ id: 'job1', type: 'production_job', projectId: 'p1', bookId: 'b1', planId: 'prod1', provider: 'mock', cueId: 'cue1', languageCode: 'en' });
  store.put({ id: 'cue1', type: 'director_cue', canonicalText: 'Michael walked home.' });
  const calls = { align: 0, transcribe: 0, keyterms: null };
  const provider = {
    async align() { calls.align += 1; return { loss: alignmentLoss, words: [
      { text: 'Michael', start: 0, end: 0.4, loss: 0.1 },
      { text: 'walked', start: 0.45, end: 0.8, loss: 0.1 },
      { text: 'home', start: 0.85, end: 1.2, loss: 0.1 }
    ] }; },
    async transcribe(input) { calls.transcribe += 1; calls.keyterms = input.keyterms; return { language_code: 'en', language_probability: 0.99, text: transcript, words: [
      { text: 'Michael', start: 0, end: 0.4, type: 'word', logprob: -0.1 },
      { text: 'walked', start: 0.45, end: 0.8, type: 'word', logprob: -0.1 },
      { text: 'home', start: 0.85, end: 1.2, type: 'word', logprob: -0.1 }
    ] }; }
  };
  const bible = { listPronunciations() { return [{ term: 'Michael', spokenAs: 'MY-kul', notation: 'plain', language: 'en' }]; } };
  const service = new ContinuityQaService(store, {
    providers: { mock: provider }, audioBibleService: bible,
    assetLoader: async () => ({ audio: new Uint8Array([1, 2, 3]), fileName: 'take.mp3', mediaType: 'audio/mpeg' })
  });
  const run = service.createRun({ projectId: 'p1', bookId: 'b1', reviewSessionId: 'session1', productionPlanId: 'prod1', bibleId: 'bible1' });
  return { store, service, run, calls };
}

test('exact transcript comparison passes with zero WER', () => {
  const result = compareTranscript('Hello, world!', 'hello world');
  assert.equal(result.exact, true);
  assert.equal(result.wordErrorRate, 0);
});

test('comparison identifies missing canonical words', () => {
  const result = compareTranscript('one two three', 'one three');
  assert.equal(result.deletions, 1);
  assert.equal(result.missingExamples[0].canonical, 'two');
});

test('comparison identifies substitutions and extras', () => {
  const result = compareTranscript('one two', 'one too again');
  assert.equal(result.substitutions, 1);
  assert.equal(result.insertions, 1);
});

test('duplicate phrase detector catches accidental repeated phrase', () => {
  const dupes = findAdjacentDuplicates('we are ready we are ready now');
  assert.ok(dupes.some((row) => row.phrase === 'we are ready'));
});

test('pronunciation risk only applies to terms present in canonical text', () => {
  const risks = pronunciationRisks('Juan smiled.', 'One smiled.', [
    { term: 'Juan', spokenAs: 'HWAHN' }, { term: 'Michael', spokenAs: 'MY-kul' }
  ]);
  assert.equal(risks.length, 1);
  assert.equal(risks[0].term, 'Juan');
});

test('alignment anomaly detector catches high loss and long silence', () => {
  const findings = alignmentAnomalies({ loss: 1.4, words: [
    { text: 'one', start: 0, end: 0.3, loss: 0.1 },
    { text: 'two', start: 3.0, end: 3.2, loss: 1.8 }
  ] });
  assert.ok(findings.some((row) => row.type === 'alignment-average-loss'));
  assert.ok(findings.some((row) => row.type === 'long-silence'));
  assert.ok(findings.some((row) => row.type === 'word-alignment-loss'));
});

test('transcript confidence flags low language and low word confidence', () => {
  const findings = transcriptConfidenceFindings({ language_probability: 0.4, words: [{ type: 'word', text: 'x', logprob: -2 }] });
  assert.equal(findings.length, 2);
});

test('QA inspection uses both alignment and unbiased transcription by default', async () => {
  const { service, run, calls } = fixture();
  const result = await service.inspectTake(run.id, { takeId: 'take1' });
  assert.equal(calls.align, 1);
  assert.equal(calls.transcribe, 1);
  assert.deepEqual(calls.keyterms, []);
  assert.equal(result.report.status, 'pass');
  assert.equal(result.findings.length, 0);
});

test('QA does not silently bias STT with pronunciation dictionary unless requested', async () => {
  const { service, run, calls } = fixture();
  await service.inspectTake(run.id, { takeId: 'take1', biasTranscriptionWithPronunciations: true });
  assert.deepEqual(calls.keyterms, ['Michael']);
});

test('missing spoken word creates critical blocking finding', async () => {
  const { service, run } = fixture({ transcript: 'Michael home.' });
  const result = await service.inspectTake(run.id, { takeId: 'take1' });
  assert.ok(result.findings.some((row) => row.findingType === 'canonical-words-missing' && row.severity === 'critical'));
  assert.equal(service.gateTake('take1').canApprove, false);
});

test('pronunciation uncertainty creates review warning rather than automatic failure', async () => {
  const { service, run } = fixture({ transcript: 'Mitchell walked home.' });
  const result = await service.inspectTake(run.id, { takeId: 'take1' });
  assert.ok(result.findings.some((row) => row.findingType === 'pronunciation-risk'));
});

test('QA can run transcription without forced alignment', async () => {
  const { service, run, calls } = fixture();
  const result = await service.inspectTake(run.id, { takeId: 'take1', runAlignment: false });
  assert.equal(calls.align, 0);
  assert.equal(calls.transcribe, 1);
  assert.equal(result.alignment, null);
});

test('QA can run alignment without transcription', async () => {
  const { service, run, calls } = fixture();
  const result = await service.inspectTake(run.id, { takeId: 'take1', runTranscription: false });
  assert.equal(calls.align, 1);
  assert.equal(calls.transcribe, 0);
  assert.equal(result.transcription, null);
});

test('resolved blocking findings permit approval gate', async () => {
  const { service, run } = fixture({ transcript: 'Michael home.' });
  const result = await service.inspectTake(run.id, { takeId: 'take1' });
  for (const finding of result.findings.filter((row) => ['critical', 'high'].includes(row.severity))) {
    service.resolveFinding(finding.id, { reviewer: 'William', resolution: 'waived', notes: 'Human listened and verified provider STT was wrong.' });
  }
  assert.equal(service.gateTake('take1').canApprove, true);
});

test('locked QA run rejects further inspection', async () => {
  const { service, run } = fixture();
  await service.inspectTake(run.id, { takeId: 'take1' });
  service.lockRun(run.id, { reviewer: 'William' });
  await assert.rejects(() => service.inspectTake(run.id, { takeId: 'take1' }), /QA run is locked/);
});

test('take from another review session fails closed', async () => {
  const { service, run, store } = fixture();
  store.update('review_take', 'take1', (row) => ({ ...row, sessionId: 'other-session' }));
  await assert.rejects(() => service.inspectTake(run.id, { takeId: 'take1' }), /another QA session/);
});

test('run cannot be approved while high findings remain unresolved', async () => {
  const { service, run } = fixture({ transcript: 'Michael home.' });
  await service.inspectTake(run.id, { takeId: 'take1' });
  assert.throws(() => service.lockRun(run.id, { reviewer: 'William' }), /unresolved high\/critical findings/);
});
