import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  BookOneAudioBiblePrepService,
  BookOneSupermanService,
  CostLedger,
  GenerationRegistry,
  InMemoryStore,
  ManuscriptService,
  ProjectService,
  SeriesContinuityService
} from './index.js';

const VERSION = '0.12.0';
const args = process.argv.slice(2);

function flagValue(name, fallback = null) {
  const index = args.indexOf(name);
  if (index < 0 || index + 1 >= args.length) return fallback;
  return args[index + 1];
}

function reportSummary(report, files = null) {
  return {
    version: VERSION,
    superman: 'book-one',
    status: report.status,
    score: report.score,
    title: report.manuscript.title,
    author: report.manuscript.author,
    words: report.manuscript.metrics.words,
    chapters: report.manuscript.narrativeChapterCount ?? report.manuscript.metrics.chapters,
    sourceSections: report.manuscript.sourceSectionCount ?? report.manuscript.metrics.chapters,
    scenes: report.manuscript.metrics.scenes,
    segments: report.manuscript.metrics.segments,
    possibleCharacters: report.characterDiscovery.candidateCount,
    speakerAttribution: report.speakerAttribution ?? null,
    estimatedFinishedHours: report.manuscript.estimatedFinishedHours,
    estimatedInitialTtsUsd: report.production.initialTtsUsd,
    recommendedProductionBudgetUsd: report.production.recommendedProductionBudgetUsd,
    findingCounts: report.findingCounts,
    nextAction: report.nextAction,
    providerCallsPerformed: report.providerCallsPerformed,
    files
  };
}

async function writeSupermanReports(result, outDir) {
  const resolved = path.resolve(outDir);
  await mkdir(resolved, { recursive: true });
  const jsonPath = path.join(resolved, 'book-one-superman-report.json');
  const markdownPath = path.join(resolved, 'book-one-superman-report.md');
  await writeFile(jsonPath, JSON.stringify(result.report, null, 2));
  await writeFile(markdownPath, result.markdown);
  return { json: jsonPath, markdown: markdownPath };
}

async function writeAudioBiblePrepReports(result, outDir) {
  const resolved = path.resolve(outDir);
  await mkdir(resolved, { recursive: true });
  const files = {
    json: path.join(resolved, 'book-one-audio-bible-prep.json'),
    markdown: path.join(resolved, 'book-one-audio-bible-prep.md'),
    characters: path.join(resolved, 'character-plan.csv'),
    dialogue: path.join(resolved, 'dialogue-review.csv'),
    pronunciations: path.join(resolved, 'pronunciation-review.csv'),
    snapshot: path.join(resolved, 'audio-bible-snapshot.json')
  };
  await Promise.all([
    writeFile(files.json, JSON.stringify(result.prep, null, 2)),
    writeFile(files.markdown, result.markdown),
    writeFile(files.characters, result.characterCsv),
    writeFile(files.dialogue, result.dialogueCsv),
    writeFile(files.pronunciations, result.pronunciationCsv),
    writeFile(files.snapshot, JSON.stringify(result.prep.snapshot, null, 2))
  ]);
  return files;
}


async function writeSeriesContinuityReports(result, outDir) {
  const resolved = path.resolve(outDir);
  await mkdir(resolved, { recursive: true });
  const files = {
    json: path.join(resolved, 'series-continuity.json'),
    markdown: path.join(resolved, 'series-continuity.md'),
    characters: path.join(resolved, 'series-character-map.csv'),
    pronunciations: path.join(resolved, 'series-pronunciations.csv')
  };
  await Promise.all([
    writeFile(files.json, JSON.stringify(result.package, null, 2)),
    writeFile(files.markdown, result.markdown),
    writeFile(files.characters, result.characterCsv),
    writeFile(files.pronunciations, result.pronunciationCsv)
  ]);
  return files;
}

async function runSeriesContinuitySeed() {
  const prepPath = args[1];
  if (!prepPath) {
    console.error('Usage: node src/cli.js series-continuity-seed <book-one-audio-bible-prep.json> [--out DIR] [--series-title TITLE] [--series-author AUTHOR]');
    process.exitCode = 2;
    return;
  }
  const prep = JSON.parse(await readFile(path.resolve(prepPath), 'utf8'));
  const service = new SeriesContinuityService();
  const result = service.buildPackage(prep, {
    seriesTitle: flagValue('--series-title'),
    seriesAuthor: flagValue('--series-author')
  });
  const out = flagValue('--out');
  const files = out ? await writeSeriesContinuityReports(result, out) : null;
  console.log(JSON.stringify({
    version: VERSION,
    seriesContinuity: 'seed',
    status: result.package.status,
    seriesTitle: result.package.series.title,
    sourceBook: result.package.sourceBook.title,
    permanentCharacters: result.package.characters.length,
    requiredCharacters: result.package.characters.filter((x) => x.continuityPolicy === 'required').length,
    carryForwardCharacters: result.package.characters.filter((x) => x.continuityPolicy === 'carry-forward').length,
    referenceOnlyCharacters: result.package.characters.filter((x) => x.continuityPolicy === 'reference-only').length,
    sceneLocalExcluded: result.package.sceneLocalExcluded.length,
    pronunciationRules: result.package.pronunciations.explicitRules.length,
    standardReadings: result.package.pronunciations.standardReadings.length,
    lockedVoiceAssignments: result.package.voiceContinuity.lockedCount,
    pendingVoiceAssignments: result.package.voiceContinuity.pendingSeriesCharacterKeys.length,
    providerCallsPerformed: result.package.providerCallsPerformed,
    digest: result.package.digest,
    files
  }, null, 2));
}

async function runSeriesContinuityCompare() {
  const packagePath = args[1];
  const nextPrepPath = args[2];
  if (!packagePath || !nextPrepPath) {
    console.error('Usage: node src/cli.js series-continuity-compare <series-continuity.json> <next-book-audio-bible-prep.json> [--out FILE]');
    process.exitCode = 2;
    return;
  }
  const [seriesPackage, nextPrep] = await Promise.all([
    readFile(path.resolve(packagePath), 'utf8').then(JSON.parse),
    readFile(path.resolve(nextPrepPath), 'utf8').then(JSON.parse)
  ]);
  const result = new SeriesContinuityService().compare(seriesPackage, nextPrep);
  const out = flagValue('--out');
  if (out) {
    await mkdir(path.dirname(path.resolve(out)), { recursive: true });
    await writeFile(path.resolve(out), JSON.stringify(result, null, 2));
  }
  console.log(JSON.stringify({ version: VERSION, seriesContinuity: 'compare', ...result, output: out ? path.resolve(out) : null }, null, 2));
  if (result.status === 'BLOCKED') process.exitCode = 3;
}

async function runSuperman({ fixture = false } = {}) {
  const store = new InMemoryStore();
  const superman = new BookOneSupermanService(store);
  const model = flagValue('--model', 'eleven_multilingual_v2');
  const out = flagValue('--out');
  let result;
  if (fixture) {
    result = await superman.runFixture({ model });
  } else {
    const filePath = args[1];
    if (!filePath) {
      console.error('Usage: node src/cli.js superman <manuscript.epub|docx|txt> [--out DIR] [--model MODEL] [--title TITLE] [--author AUTHOR]');
      process.exitCode = 2;
      return;
    }
    result = await superman.runFile(filePath, {
      model,
      title: flagValue('--title'),
      author: flagValue('--author')
    });
  }
  const files = out ? await writeSupermanReports(result, out) : null;
  console.log(JSON.stringify(reportSummary(result.report, files), null, 2));
  if (result.report.status === 'BLOCKED') process.exitCode = 3;
}

async function runAudioBiblePrep() {
  const filePath = args[1];
  if (!filePath) {
    console.error('Usage: node src/cli.js audio-bible-prep <manuscript.epub|docx|txt> [--out DIR] [--title TITLE] [--author AUTHOR]');
    process.exitCode = 2;
    return;
  }
  const store = new InMemoryStore();
  const prepService = new BookOneAudioBiblePrepService(store);
  const result = await prepService.runFile(filePath, {
    title: flagValue('--title'),
    author: flagValue('--author'),
    model: flagValue('--model', 'eleven_multilingual_v2')
  });
  const out = flagValue('--out');
  const files = out ? await writeAudioBiblePrepReports(result, out) : null;
  console.log(JSON.stringify({
    version: VERSION,
    audioBiblePrep: 'book-one',
    status: result.prep.status,
    supermanScore: result.prep.superman.score,
    characters: result.prep.characterPlan.length,
    permanentCharacters: result.prep.intelligence?.permanentRoleCount ?? result.prep.characterPlan.filter((x) => (x.continuityScope ?? 'book') !== 'scene').length,
    sceneLocalRoleCount: result.prep.intelligence?.sceneLocalRoleCount ?? (result.prep.sceneLocalRoles ?? []).length,
    primaryCharacters: result.prep.characterPlan.filter((x) => x.role === 'primary').length,
    supportingCharacters: result.prep.characterPlan.filter((x) => x.role === 'supporting').length,
    minorCharacters: result.prep.characterPlan.filter((x) => x.role === 'minor').length,
    autoBoundDialogue: result.prep.dialogueReview.autoBound,
    intelligenceResolved: result.prep.intelligence?.autoResolved ?? 0,
    quotedNarrationSegments: result.prep.intelligence?.quotedNarrationSegments ?? 0,
    reviewReduction: result.prep.intelligence?.reviewReduction ?? 0,
    provisionalRoles: result.prep.intelligence?.provisionalRoles ?? [],
    sceneLocalRoles: result.prep.intelligence?.sceneLocalRoles ?? [],
    sceneLocalResolved: result.prep.dialogueReview.sceneLocalResolved ?? 0,
    collectiveResolved: result.prep.dialogueReview.collectiveResolved ?? 0,
    dialogueNeedsReview: result.prep.dialogueReview.needsReview,
    inferredNeedsReview: result.prep.dialogueReview.inferredReview,
    unresolvedDialogue: result.prep.dialogueReview.unresolved,
    reviewPriorityCounts: result.prep.dialogueReview.priorityCounts,
    pronunciationCandidates: result.prep.pronunciationReview.candidateCount,
    pronunciationResolved: result.prep.pronunciationReview.resolvedCount ?? 0,
    pronunciationNeedsConfirmation: result.prep.pronunciationReview.needsConfirmation ?? 0,
    pronunciationRules: result.prep.continuity.pronunciationRules ?? 0,
    continuityUnresolvedDialogue: result.prep.continuity.unresolvedDialogueSegments ?? 0,
    primaryCastingCanBegin: result.prep.gates.primaryCastingCanBegin,
    productionReady: result.prep.gates.productionReady,
    audioBibleLocked: result.prep.gates.audioBibleLocked ?? false,
    providerCallsPerformed: result.prep.providerCallsPerformed,
    nextAction: result.prep.nextAction,
    files
  }, null, 2));
}

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
      version: VERSION,
      format: result.analysis.source.format,
      metadata: result.analysis.metadata,
      metrics: result.analysis.metrics,
      warnings: result.analysis.warnings,
      detectedChapters: result.chapters.map((chapter) => chapter.title)
    }, null, 2));
  }
} else if (args[0] === 'superman') {
  await runSuperman();
} else if (args[0] === 'superman-fixture') {
  await runSuperman({ fixture: true });
} else if (args[0] === 'audio-bible-prep') {
  await runAudioBiblePrep();
} else if (args[0] === 'series-continuity-seed') {
  await runSeriesContinuitySeed();
} else if (args[0] === 'series-continuity-compare') {
  await runSeriesContinuityCompare();
} else {
  const store = new InMemoryStore();
  const projects = new ProjectService(store);
  const ledger = new CostLedger();
  const generations = new GenerationRegistry();
  const project = projects.create({ name: `YasReady Audiobooks — ${VERSION} Demo` });
  const generation = generations.register({
    text: 'Foundation test passage.', provider: 'demo-provider', model: 'demo-model',
    voiceId: 'demo-voice', settings: { stability: 'default' },
    pronunciationVersion: 'v1', directorInstructions: 'natural'
  });
  ledger.record({ projectId: project.id, provider: 'demo-provider', operation: 'estimate', amountUsd: 0, metadata: { fingerprint: generation.request.fingerprint } });
  console.log(JSON.stringify({
    version: VERSION, project,
    manuscriptCommand: 'node src/cli.js analyze <file>',
    bookOneSupermanCommand: 'node src/cli.js superman <file> --out <directory>',
    bookOneAudioBiblePrepCommand: 'node src/cli.js audio-bible-prep <file> --out <directory>',
    seriesContinuitySeedCommand: 'node src/cli.js series-continuity-seed <book-one-audio-bible-prep.json> --out <directory>',
    seriesContinuityCompareCommand: 'node src/cli.js series-continuity-compare <series-continuity.json> <next-book-audio-bible-prep.json>',
    workflow: {
      manuscriptBrain: 'ready', audioBible: 'ready', castingRoom: 'ready', audiobookDirector: 'ready',
      productionEngine: 'ready', reviewStudio: 'ready', continuityQa: 'ready', masteringLab: 'ready',
      distributionBrain: 'ready', operatorFlowAudit: 'ready', bookOneSuperman: 'ready',
      bookOneAudioBiblePrep: 'ready', seriesContinuity: 'ready'
    },
    distributionProfiles: ['acx-2026', 'spotify-direct-2026', 'apple-partner-2026', 'w3c-audiobook-2020'],
    duplicateProtection: generation.request.fingerprint,
    recordedCostUsd: ledger.total(project.id), providerCallsPerformed: 0
  }, null, 2));
}
