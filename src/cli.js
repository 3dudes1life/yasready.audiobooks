import {
  CostLedger,
  GenerationRegistry,
  InMemoryStore,
  ManuscriptService,
  ProjectService
} from './index.js';

const args = process.argv.slice(2);

if (args[0] === 'analyze') {
  const filePath = args[1];
  if (!filePath) {
    console.error('Usage: node src/cli.js analyze <manuscript.epub|docx|txt>');
    process.exitCode = 2;
  } else {
    const store = new InMemoryStore();
    const projects = new ProjectService(store);
    const manuscripts = new ManuscriptService(store);
    const project = projects.create({ name: `Analysis — ${filePath}` });
    const result = manuscripts.ingestFile(project.id, filePath);
    console.log(JSON.stringify({
      version: '0.3.0',
      format: result.analysis.source.format,
      metadata: result.analysis.metadata,
      metrics: result.analysis.metrics,
      warnings: result.analysis.warnings,
      detectedChapters: result.chapters.map((chapter) => chapter.title)
    }, null, 2));
  }
} else {
  const store = new InMemoryStore();
  const projects = new ProjectService(store);
  const ledger = new CostLedger();
  const generations = new GenerationRegistry();

  const project = projects.create({ name: 'YasReady Audiobooks — 0.3.0 Demo' });
  const generation = generations.register({
    text: 'Foundation test passage.', provider: 'demo-provider', model: 'demo-model',
    voiceId: 'demo-voice', settings: { stability: 'default' },
    pronunciationVersion: 'v1', directorInstructions: 'natural'
  });

  ledger.record({
    projectId: project.id, provider: 'demo-provider', operation: 'estimate', amountUsd: 0,
    metadata: { fingerprint: generation.request.fingerprint }
  });

  console.log(JSON.stringify({
    version: '0.3.0', project,
    manuscriptCommand: 'node src/cli.js analyze <file>',
    duplicateProtection: generation.request.fingerprint,
    recordedCostUsd: ledger.total(project.id), providerCallsPerformed: 0
  }, null, 2));
}
