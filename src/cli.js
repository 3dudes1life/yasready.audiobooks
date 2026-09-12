import { CostLedger, GenerationRegistry, InMemoryStore, ProjectService } from './index.js';

const store = new InMemoryStore();
const projects = new ProjectService(store);
const ledger = new CostLedger();
const generations = new GenerationRegistry();

const project = projects.create({ name: 'Tres Amigos Audiobook — Foundation Demo' });
const generation = generations.register({
  text: 'Foundation test passage.',
  provider: 'demo-provider',
  model: 'demo-model',
  voiceId: 'demo-voice',
  settings: { stability: 'default' },
  pronunciationVersion: 'v1',
  directorInstructions: 'natural'
});

ledger.record({
  projectId: project.id,
  provider: 'demo-provider',
  operation: 'estimate',
  amountUsd: 0,
  metadata: { fingerprint: generation.request.fingerprint }
});

console.log(JSON.stringify({
  version: '0.1.0',
  project,
  duplicateProtection: generation.request.fingerprint,
  recordedCostUsd: ledger.total(project.id),
  providerCallsPerformed: 0
}, null, 2));
