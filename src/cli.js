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
  SeriesContinuityService,
  MoneyGuardService
} from './index.js';

const VERSION = '0.13.2';
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
    pronunciations: path.join(resolved, 'series-pronunciations.csv'),
    relationships: path.join(resolved, 'series-relationships.csv')
  };
  await Promise.all([
    writeFile(files.json, JSON.stringify(result.package, null, 2)),
    writeFile(files.markdown, result.markdown),
    writeFile(files.characters, result.characterCsv),
    writeFile(files.pronunciations, result.pronunciationCsv),
    writeFile(files.relationships, result.relationshipCsv)
  ]);
  return files;
}

async function runSeriesContinuitySeed() {
  const prepPath = args[1];
  if (!prepPath) {
    console.error('Usage: node src/cli.js series-continuity-seed <book-one-audio-bible-prep.json> [--existing series-continuity.json] [--out DIR] [--series-title TITLE] [--series-author AUTHOR]');
    process.exitCode = 2;
    return;
  }
  const prep = JSON.parse(await readFile(path.resolve(prepPath), 'utf8'));
  const existingPath = flagValue('--existing');
  const existingPackage = existingPath
    ? JSON.parse(await readFile(path.resolve(existingPath), 'utf8'))
    : null;
  const service = new SeriesContinuityService();
  const result = service.buildPackage(prep, {
    seriesTitle: flagValue('--series-title'),
    seriesAuthor: flagValue('--series-author'),
    existingPackage
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
    relationshipLocks: result.package.relationshipContinuity.lockedCount,
    seriesLockStatus: result.package.seriesLock.status,
    pendingRequiredVoiceAssignments: result.package.seriesLock.pendingRequiredVoiceKeys.length,
    lockedVoiceAssignments: result.package.voiceContinuity.lockedCount,
    pendingVoiceAssignments: result.package.voiceContinuity.pendingSeriesCharacterKeys.length,
    providerCallsPerformed: result.package.providerCallsPerformed,
    refreshedFromExisting: Boolean(result.package.refresh),
    preservedRelationshipLocks: result.package.refresh?.preservedRelationshipLocks ?? 0,
    preservedVoiceLocks: result.package.refresh?.preservedVoiceLocks ?? 0,
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


async function writeSeriesPackageFile(seriesPackage, outPath) {
  const resolved = path.resolve(outPath);
  const dir = path.dirname(resolved);
  await mkdir(dir, { recursive: true });
  const rendered = new SeriesContinuityService().renderPackage(seriesPackage);
  const files = {
    json: resolved,
    markdown: path.join(dir, 'series-continuity.md'),
    characters: path.join(dir, 'series-character-map.csv'),
    pronunciations: path.join(dir, 'series-pronunciations.csv'),
    relationships: path.join(dir, 'series-relationships.csv')
  };
  await Promise.all([
    writeFile(files.json, JSON.stringify(seriesPackage, null, 2)),
    writeFile(files.markdown, rendered.markdown),
    writeFile(files.characters, rendered.characterCsv),
    writeFile(files.pronunciations, rendered.pronunciationCsv),
    writeFile(files.relationships, rendered.relationshipCsv)
  ]);
  return files;
}

async function runSeriesRelationshipLock({ group = false } = {}) {
  const packagePath = args[1];
  if (!packagePath) {
    console.error(group
      ? 'Usage: node src/cli.js series-continuity-lock-group <series-continuity.json> --members key1,key2[,key3] --kind KIND [--label LABEL] [--out FILE] [--override --reason REASON]'
      : 'Usage: node src/cli.js series-continuity-lock-relationship <series-continuity.json> --from KEY --to KEY --kind KIND [--label LABEL] [--out FILE] [--override --reason REASON]');
    process.exitCode = 2;
    return;
  }
  const seriesPackage = JSON.parse(await readFile(path.resolve(packagePath), 'utf8'));
  const service = new SeriesContinuityService();
  const override = args.includes('--override');
  const common = {
    kind: flagValue('--kind', 'partner'),
    label: flagValue('--label'),
    notes: flagValue('--notes'),
    approvedBy: flagValue('--approved-by', 'operator'),
    override,
    reason: flagValue('--reason')
  };
  const next = group
    ? service.lockRelationshipGroup(seriesPackage, { ...common, members: String(flagValue('--members', '')).split(',').map((x) => x.trim()).filter(Boolean) })
    : service.lockRelationship(seriesPackage, { ...common, fromSeriesCharacterKey: flagValue('--from'), toSeriesCharacterKey: flagValue('--to') });
  const out = flagValue('--out', packagePath);
  const files = await writeSeriesPackageFile(next, out);
  console.log(JSON.stringify({
    version: VERSION,
    seriesContinuity: group ? 'relationship-group-lock' : 'relationship-lock',
    status: next.status,
    relationshipLocks: next.relationshipContinuity.lockedCount,
    seriesLockStatus: next.seriesLock.status,
    pendingRequiredVoiceAssignments: next.seriesLock.pendingRequiredVoiceKeys.length,
    providerCallsPerformed: next.providerCallsPerformed,
    digest: next.digest,
    files
  }, null, 2));
}

async function runSeriesVoiceLock() {
  const packagePath = args[1];
  if (!packagePath) {
    console.error('Usage: node src/cli.js series-continuity-lock-voice <series-continuity.json> --character KEY --provider PROVIDER --voice-id VOICE_ID --safety-score N [--out FILE] [--override --reason REASON]');
    process.exitCode = 2;
    return;
  }
  const safetyScore = flagValue('--safety-score');
  if (safetyScore === null || safetyScore === undefined || String(safetyScore).trim() === '') {
    console.error('Series voice lock requires --safety-score N from Casting Room (0-100).');
    process.exitCode = 2;
    return;
  }
  const seriesPackage = JSON.parse(await readFile(path.resolve(packagePath), 'utf8'));
  const next = new SeriesContinuityService().lockVoice(seriesPackage, {
    seriesCharacterKey: flagValue('--character'),
    provider: flagValue('--provider'),
    providerVoiceId: flagValue('--voice-id'),
    approvedBy: flagValue('--approved-by', 'operator'),
    safetyScore,
    override: args.includes('--override'),
    reason: flagValue('--reason')
  });
  const out = flagValue('--out', packagePath);
  const files = await writeSeriesPackageFile(next, out);
  console.log(JSON.stringify({
    version: VERSION,
    seriesContinuity: 'voice-lock',
    status: next.status,
    lockedVoiceAssignments: next.voiceContinuity.lockedCount,
    seriesLockStatus: next.seriesLock.status,
    pendingRequiredVoiceAssignments: next.seriesLock.pendingRequiredVoiceKeys.length,
    providerCallsPerformed: next.providerCallsPerformed,
    digest: next.digest,
    files
  }, null, 2));
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

async function runMoneyGuardFixture() {
  const store = new InMemoryStore();
  const ledger = new CostLedger();
  const project = new ProjectService(store).create({ name: 'Money Guard Fixture' });
  const money = new MoneyGuardService(store, { ledger });
  const guard = money.createGuard({
    projectId: project.id,
    hardCapUsd: 50,
    warningThresholdRatio: 0.8,
    singleActionApprovalUsd: 5,
    estimateVarianceRatio: 0.1,
    providerCapsUsd: { elevenlabs: 45 },
    operationCapsUsd: { audition: 5, production: 44 }
  });
  const small = money.preview(guard.id, { provider: 'elevenlabs', operation: 'audition_render', estimatedCostUsd: 1 });
  const needsApproval = money.preview(guard.id, { provider: 'elevenlabs', operation: 'production_render', estimatedCostUsd: 10 });
  const auth = money.authorize(guard.id, { provider: 'elevenlabs', operation: 'production_render', estimatedCostUsd: 10, approvedBy: 'fixture-operator', reason: 'fixture' });
  money.capture(auth.id, { amountUsd: 9.5, units: 95000, unitType: 'characters', metadata: { fixture: true } });
  money.release(auth.id, { reason: 'fixture complete' });
  const capCheck = money.preview(guard.id, { provider: 'elevenlabs', operation: 'production_render', estimatedCostUsd: 40, approvedBy: 'fixture-operator' });
  const report = money.report(guard.id);
  console.log(JSON.stringify({
    version: VERSION,
    moneyGuard: 'fixture',
    status: report.status,
    hardCapUsd: report.hardCapUsd,
    capturedUsd: report.capturedUsd,
    reservedUsd: report.reservedUsd,
    availableUsd: report.availableUsd,
    smallDecision: small.status,
    approvalDecision: needsApproval.status,
    approvalReasons: needsApproval.reasons,
    capDecision: capCheck.status,
    capReasons: capCheck.reasons,
    ledgerUsd: ledger.total(project.id),
    paidGenerationArmed: report.paidGenerationArmed,
    providerCallsPerformed: 0
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
} else if (args[0] === 'series-continuity-lock-relationship') {
  await runSeriesRelationshipLock();
} else if (args[0] === 'series-continuity-lock-group') {
  await runSeriesRelationshipLock({ group: true });
} else if (args[0] === 'series-continuity-lock-voice') {
  await runSeriesVoiceLock();
} else if (args[0] === 'money-guard-fixture') {
  await runMoneyGuardFixture();
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
    seriesContinuitySeedCommand: 'node src/cli.js series-continuity-seed <book-one-audio-bible-prep.json> [--existing <series-continuity.json>] --out <directory>',
    seriesContinuityCompareCommand: 'node src/cli.js series-continuity-compare <series-continuity.json> <next-book-audio-bible-prep.json>',
    seriesRelationshipLockCommand: 'node src/cli.js series-continuity-lock-group <series-continuity.json> --members key1,key2,key3 --kind partner --out <file>',
    seriesVoiceLockCommand: 'node src/cli.js series-continuity-lock-voice <series-continuity.json> --character <key> --provider <provider> --voice-id <id> --safety-score <0-100> --out <file>',
    moneyGuardFixtureCommand: 'node src/cli.js money-guard-fixture',
    workflow: {
      manuscriptBrain: 'ready', audioBible: 'ready', castingRoom: 'ready', audiobookDirector: 'ready',
      productionEngine: 'ready', reviewStudio: 'ready', continuityQa: 'ready', masteringLab: 'ready',
      distributionBrain: 'ready', operatorFlowAudit: 'ready', bookOneSuperman: 'ready',
      bookOneAudioBiblePrep: 'ready', seriesContinuity: 'ready', moneyGuard: 'ready', finalSaasBoundaryClosure: 'ready'
    },
    distributionProfiles: ['acx-2026', 'spotify-direct-2026', 'apple-partner-2026', 'w3c-audiobook-2020'],
    duplicateProtection: generation.request.fingerprint,
    recordedCostUsd: ledger.total(project.id), providerCallsPerformed: 0
  }, null, 2));
}
