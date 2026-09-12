import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryStore, AudiobookDirectorService, inferPerformanceDirection, compileElevenV3RenderText, summarizeArc } from '../src/index.js';

function segment(overrides = {}) {
  return { id: overrides.id ?? `s-${Math.random()}`, order: overrides.order ?? 0, kind: 'narration', text: 'The room was quiet.', characterId: null, ...overrides };
}

test('director never mutates canonical manuscript text', async () => {
  const store = new InMemoryStore();
  const director = new AudiobookDirectorService(store);
  const plan = director.createPlan({ projectId: 'p', bookId: 'b' });
  const original = '“I love you,” Michael whispered.';
  const result = await director.directScene({ planId: plan.id, sceneId: 'sc', chapterId: 'ch', segments: [segment({ id: 'x', kind: 'dialogue', text: original, characterId: 'm' })] });
  assert.equal(result.cues[0].canonicalText, original);
  const compiled = director.compileCue(result.cues[0].id, { provider: 'elevenlabs', model: 'eleven_v3' });
  assert.equal(compiled.canonicalText, original);
  assert.equal(compiled.manuscriptMutated, false);
});

test('whispered tender dialogue receives restrained direction', () => {
  const d = inferPerformanceDirection({ text: '“I love you,” he whispered softly.', kind: 'dialogue' });
  assert.equal(d.emotion, 'tender');
  assert.ok(d.tags.includes('whisper'));
  assert.ok(d.restraint > 0.7);
});

test('neutral narration does not get spammed with audio tags', () => {
  const d = inferPerformanceDirection({ text: 'He walked across the kitchen and opened the refrigerator.', kind: 'narration' });
  assert.equal(d.emotion, 'neutral');
  assert.equal(d.tags.length, 0);
  assert.equal(compileElevenV3RenderText('Plain sentence.', d), 'Plain sentence.');
});

test('v3 compilation adds direction outside canonical text', () => {
  const text = 'Do not leave me.';
  const rendered = compileElevenV3RenderText(text, { emotion: 'sad', tags: ['sad', 'whisper'] });
  assert.ok(rendered.endsWith(text));
  assert.ok(rendered.startsWith('[sad]'));
});

test('unknown provider tags are discarded', () => {
  const rendered = compileElevenV3RenderText('Hello.', { tags: ['hack-the-model', 'whisper'] });
  assert.ok(!rendered.includes('hack-the-model'));
  assert.ok(rendered.includes('[whispers]'));
});

test('dialogue without canonical character binding fails closed', async () => {
  const store = new InMemoryStore();
  const director = new AudiobookDirectorService(store);
  const plan = director.createPlan({ projectId: 'p', bookId: 'b' });
  await assert.rejects(() => director.directScene({ planId: plan.id, sceneId: 'sc', chapterId: 'ch', segments: [segment({ kind: 'dialogue', text: '“Hi.”' })] }), /no canonical character binding/);
});

test('manual direction revisions require audit reason', async () => {
  const store = new InMemoryStore();
  const director = new AudiobookDirectorService(store);
  const plan = director.createPlan({ projectId: 'p', bookId: 'b' });
  const { cues } = await director.directScene({ planId: plan.id, sceneId: 'sc', chapterId: 'ch', segments: [segment({ id: 'n1' })] });
  assert.throws(() => director.reviseCue(cues[0].id, { direction: { pace: 'slow' } }, { reason: '' }), /requires a reason/);
});

test('director revisions cannot rewrite manuscript', async () => {
  const store = new InMemoryStore();
  const director = new AudiobookDirectorService(store);
  const plan = director.createPlan({ projectId: 'p', bookId: 'b' });
  const { cues } = await director.directScene({ planId: plan.id, sceneId: 'sc', chapterId: 'ch', segments: [segment({ id: 'n1', text: 'Original.' })] });
  assert.throws(() => director.reviseCue(cues[0].id, { canonicalText: 'Changed.' }, { reason: 'Nope' }), /cannot alter canonical/);
});

test('locked cues reject revisions', async () => {
  const store = new InMemoryStore();
  const director = new AudiobookDirectorService(store);
  const plan = director.createPlan({ projectId: 'p', bookId: 'b' });
  const { cues } = await director.directScene({ planId: plan.id, sceneId: 'sc', chapterId: 'ch', segments: [segment({ id: 'n1' })] });
  director.lockCue(cues[0].id);
  assert.throws(() => director.reviseCue(cues[0].id, { direction: { pace: 'slow' } }, { reason: 'Try' }), /locked/);
});

test('scene summary reports emotional arc', async () => {
  const store = new InMemoryStore();
  const director = new AudiobookDirectorService(store);
  const plan = director.createPlan({ projectId: 'p', bookId: 'b' });
  const result = await director.directScene({ planId: plan.id, sceneId: 'sc', chapterId: 'ch', segments: [
    segment({ id: '1', text: 'He smiled and laughed.' }),
    segment({ id: '2', text: 'Then the grief hit and tears filled his eyes.', order: 1 })
  ] });
  const summary = director.sceneSummary(result.scene.id);
  assert.equal(summary.cueCount, 2);
  assert.ok(summary.emotionalArc.shifts >= 1);
});

test('analysis adapter may refine performance without changing text', async () => {
  const store = new InMemoryStore();
  const director = new AudiobookDirectorService(store, { analysisAdapter: async () => ({ pace: 'slow', intensity: 0.2, tags: ['reflective'], source: 'test-adapter' }) });
  const plan = director.createPlan({ projectId: 'p', bookId: 'b' });
  const result = await director.directScene({ planId: plan.id, sceneId: 'sc', chapterId: 'ch', segments: [segment({ id: 'x', text: 'Memory.' })] });
  assert.equal(result.cues[0].direction.pace, 'slow');
  assert.equal(result.cues[0].canonicalText, 'Memory.');
});

test('summarizeArc is deterministic and ignores neutral beats', () => {
  assert.deepEqual(summarizeArc(['neutral', 'tense', 'tense', 'sad']), { opening: 'tense', peak: 'tense', closing: 'sad', shifts: 1 });
});
