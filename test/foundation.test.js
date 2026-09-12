import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CostLedger,
  GenerationRegistry,
  InMemoryStore,
  ProjectService,
  createAudioAsset,
  renderFingerprint
} from '../src/index.js';

test('render fingerprints are deterministic regardless of settings key order', () => {
  const base = {
    text: 'Hello world', provider: 'elevenlabs', model: 'v3', voiceId: 'voice-1',
    pronunciationVersion: 'p1', directorInstructions: 'warm'
  };
  const a = renderFingerprint({ ...base, settings: { speed: 1, stability: 0.5 } });
  const b = renderFingerprint({ ...base, settings: { stability: 0.5, speed: 1 } });
  assert.equal(a, b);
});

test('generation registry reuses identical planned work', () => {
  const registry = new GenerationRegistry();
  const input = { text: 'Same line', provider: 'p', model: 'm', voiceId: 'v' };
  const first = registry.register(input);
  const second = registry.register(input);
  assert.equal(first.reused, false);
  assert.equal(second.reused, true);
  assert.equal(first.request.id, second.request.id);
});

test('forceFresh permits an intentional new take', () => {
  const registry = new GenerationRegistry();
  const input = { text: 'Same line', provider: 'p', model: 'm', voiceId: 'v' };
  const first = registry.register(input);
  const second = registry.register(input, { forceFresh: true });
  assert.notEqual(first.request.id, second.request.id);
});

test('cost ledger is append-only and totals per project', () => {
  const ledger = new CostLedger();
  ledger.record({ projectId: 'a', provider: 'x', operation: 'render', amountUsd: 0.12 });
  ledger.record({ projectId: 'a', provider: 'x', operation: 'render', amountUsd: 0.08 });
  ledger.record({ projectId: 'b', provider: 'x', operation: 'render', amountUsd: 1 });
  assert.equal(ledger.total('a'), 0.2);
  assert.equal(ledger.total(), 1.2);
});

test('project workflow rejects skipping production gates', () => {
  const store = new InMemoryStore();
  const service = new ProjectService(store);
  const project = service.create({ name: 'Book' });
  assert.throws(() => service.transition(project.id, 'production'), /invalid project transition/);
  const analyzed = service.transition(project.id, 'analyzed');
  assert.equal(analyzed.status, 'analyzed');
});

test('unlocking requires an audit reason', () => {
  const store = new InMemoryStore();
  const service = new ProjectService(store);
  const project = service.create({ name: 'Book' });
  service.lock(project.id);
  assert.throws(() => service.unlock(project.id, { reason: '' }), /requires a reason/);
  assert.equal(service.unlock(project.id, { reason: 'Director requested revision' }).locked, false);
});

test('audio assets contain storage references, not audio bytes', () => {
  const asset = createAudioAsset({
    projectId: 'p1', kind: 'take', storageLocator: 's3://private-bucket/take.wav',
    contentHash: 'abc123', mediaType: 'audio/wav', bytes: 1234
  });
  assert.equal(asset.kind, 'take');
  assert.equal(asset.storageLocator, 's3://private-bucket/take.wav');
  assert.equal('data' in asset, false);
});
