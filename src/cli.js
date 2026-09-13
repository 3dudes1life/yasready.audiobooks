import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  BookOneAudioBiblePrepService,
  BookOneSupermanService,
  CastingLaunchService,
  buildCastingLaunchFixture,
  BookOneCastingDiscoveryService,
  buildAuditionSamplePackFromPrepRun,
  buildCharacterCastingBiographiesFromPrepRun,
  renderCharacterCastingBiographiesMarkdown,
  buildCastingDiscoveryFixture,
  ElevenLabsProvider,
  ExternalBookSupermanService,
  CostLedger,
  GenerationRegistry,
  InMemoryStore,
  ManuscriptService,
  ProjectService,
  SeriesContinuityService,
  MoneyGuardService,
  buildRealAuditionPlan,
  renderRealAuditionPlanMarkdown,
  renderRealAuditions,
  summarizeRealAuditionFeedback,
  renderRealAuditionFeedbackSummaryMarkdown,
  buildPerformanceDirectionPlan,
  renderPerformanceDirectionPlanMarkdown,
  renderPerformanceDirectionRound,
  summarizePerformanceDirectionFeedback,
  renderPerformanceDirectionLearningMarkdown
} from './index.js';
import { YASREADY_AUDIOBOOKS_VERSION } from './release.js';

const VERSION = YASREADY_AUDIOBOOKS_VERSION;
const args = process.argv.slice(2);

function flagValue(name, fallback = null) {
  const index = args.indexOf(name);
  if (index < 0 || index + 1 >= args.length) return fallback;
  return args[index + 1];
}

function flagValues(name) {
  const values = [];
  for (let i = 0; i < args.length - 1; i += 1) {
    if (args[i] === name) values.push(args[i + 1]);
  }
  return values;
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

async function writeExternalSupermanReports(result, outDir) {
  const resolved = path.resolve(outDir);
  await mkdir(resolved, { recursive: true });
  const jsonPath = path.join(resolved, 'external-book-superman-report.json');
  const markdownPath = path.join(resolved, 'external-book-superman-report.md');
  await writeFile(jsonPath, JSON.stringify(result.report, null, 2));
  await writeFile(markdownPath, result.markdown);
  return { json: jsonPath, markdown: markdownPath };
}

async function runExternalSuperman({ fixture = false } = {}) {
  const store = new InMemoryStore();
  const superman = new ExternalBookSupermanService(store);
  const model = flagValue('--model', 'eleven_multilingual_v2');
  const out = flagValue('--out');
  const baselineSourceHash = flagValue('--baseline-hash');
  let result;
  if (fixture) {
    result = await superman.runFixture({ model, baselineSourceHash });
  } else {
    const filePath = args[1];
    if (!filePath) {
      console.error('Usage: node src/cli.js external-superman <unrelated.epub|docx|txt> [--out DIR] [--model MODEL] [--title TITLE] [--author AUTHOR] [--baseline-hash HASH]');
      process.exitCode = 2;
      return;
    }
    result = await superman.runFile(filePath, {
      model,
      title: flagValue('--title'),
      author: flagValue('--author'),
      baselineSourceHash
    });
  }
  const files = out ? await writeExternalSupermanReports(result, out) : null;
  console.log(JSON.stringify({
    version: VERSION,
    superman: 'external-book',
    status: result.report.status,
    score: result.report.score,
    title: result.report.manuscript.title,
    author: result.report.manuscript.author,
    words: result.report.manuscript.metrics.words,
    chapters: result.report.manuscript.narrativeChapterCount,
    possibleCharacters: result.report.characterDiscovery.candidateCount,
    priorTruthLeaks: result.report.generalization.priorTruthLeakCount,
    baselineSourceDistinct: result.report.generalization.sourceHashDistinctFromBaseline,
    stackProbe: result.report.stackProbe.status,
    stackStages: result.report.stackProbe.stages?.map((row) => ({ stage: row.stage, status: row.status })) ?? [],
    estimatedInitialTtsUsd: result.report.production.initialTtsUsd,
    recommendedProductionBudgetUsd: result.report.production.recommendedProductionBudgetUsd,
    providerCallsPerformed: result.report.providerCallsPerformed,
    paidGenerationArmed: result.report.gates.paidGenerationArmed,
    nextAction: result.report.nextAction,
    files
  }, null, 2));
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

async function writeCastingLaunchReports(result, outDir) {
  const resolved = path.resolve(outDir);
  await mkdir(resolved, { recursive: true });
  const files = {
    json: path.join(resolved, 'casting-launch.json'),
    markdown: path.join(resolved, 'casting-launch.md'),
    candidates: path.join(resolved, 'casting-candidates.csv')
  };
  await Promise.all([
    writeFile(files.json, JSON.stringify(result.launch, null, 2)),
    writeFile(files.markdown, result.markdown),
    writeFile(files.candidates, result.candidateCsv)
  ]);
  return files;
}

async function runCastingLaunch({ fixture = false } = {}) {
  let prep;
  if (fixture) {
    prep = buildCastingLaunchFixture();
  } else {
    const prepPath = args[1];
    if (!prepPath) {
      console.error('Usage: node src/cli.js casting-launch <book-one-audio-bible-prep.json> [--out DIR]');
      process.exitCode = 2;
      return;
    }
    prep = JSON.parse(await readFile(path.resolve(prepPath), 'utf8'));
  }
  const result = new CastingLaunchService().build(prep);
  const out = flagValue('--out');
  const files = out ? await writeCastingLaunchReports(result, out) : null;
  console.log(JSON.stringify({
    version: VERSION,
    castingLaunch: 'book-one',
    status: result.launch.status,
    book: result.launch.book.title,
    audioBibleLocked: true,
    targetCount: result.launch.targets.length,
    waveOne: result.launch.waves.find((row) => row.wave === 1)?.targets.map((row) => row.canonicalName) ?? [],
    supportingCount: result.launch.targets.filter((row) => row.wave === 2).length,
    laterCount: result.launch.targets.filter((row) => row.wave === 3).length,
    sceneLocalExcluded: result.launch.sceneLocalExcluded.length,
    providerCallsPerformed: result.launch.providerCallsPerformed,
    auditionRenderingArmed: result.launch.guardrails.auditionRenderingArmed,
    paidGenerationArmed: result.launch.guardrails.paidGenerationArmed,
    artifactFingerprint: result.launch.artifactFingerprint,
    nextAction: result.launch.nextAction,
    files
  }, null, 2));
}

async function writeCastingDiscoveryReports(result, outDir) {
  const resolved = path.resolve(outDir);
  await mkdir(resolved, { recursive: true });
  const files = {
    json: path.join(resolved, 'casting-candidate-discovery.json'),
    markdown: path.join(resolved, 'casting-candidate-discovery.md'),
    shortlist: path.join(resolved, 'casting-shortlist.csv'),
    scripts: path.join(resolved, 'audition-scripts.csv'),
    auditionPreview: path.join(resolved, 'audition-plan-preview.json'),
    biographies: path.join(resolved, 'character-casting-biographies.json'),
    biographiesMarkdown: path.join(resolved, 'character-casting-biographies.md'),
    reviewBoard: path.join(resolved, 'casting-review.html'),
    performanceGuide: path.join(resolved, 'single-narrator-performance-guide.json'),
    performanceGuideMarkdown: path.join(resolved, 'single-narrator-performance-guide.md')
  };
  await Promise.all([
    writeFile(files.json, JSON.stringify(result.discovery, null, 2)),
    writeFile(files.markdown, result.markdown),
    writeFile(files.shortlist, result.shortlistCsv),
    writeFile(files.scripts, result.scriptsCsv),
    writeFile(files.auditionPreview, JSON.stringify(result.discovery.auditionPlanPreview, null, 2)),
    writeFile(files.biographies, JSON.stringify(result.discovery.characterBiographies ?? { status: 'not-supplied' }, null, 2)),
    writeFile(files.biographiesMarkdown, result.discovery.characterBiographies ? renderCharacterCastingBiographiesMarkdown(result.discovery.characterBiographies) : '# Character Casting Biographies\n\nNo manuscript-derived biography was supplied for this run.\n'),
    writeFile(files.reviewBoard, result.reviewBoardHtml),
    writeFile(files.performanceGuide, JSON.stringify(result.discovery.performanceGuide ?? { status: 'not-applicable', castingMode: result.discovery.castingMode ?? 'multicast' }, null, 2)),
    writeFile(files.performanceGuideMarkdown, result.performanceGuideMarkdown ?? '# Single Narrator Performance Guide\n\nNot applicable for this casting mode.\n')
  ]);
  return files;
}

async function runCastingDiscovery({ fixture = false } = {}) {
  const service = new BookOneCastingDiscoveryService();
  let result;
  if (fixture) {
    const data = buildCastingDiscoveryFixture();
    result = await service.build({
      launch: data.launch,
      prep: data.prep,
      voices: data.voices,
      auditionSamples: data.auditionSamples,
      costEstimator: data.estimateCost,
      perRole: 5,
      auditionTop: 3,
      catalogProvider: 'fixture',
      castingMode: 'single-narrator'
    });
  } else {
    const launchPath = args[1];
    const prepPath = flagValue('--prep');
    if (!launchPath || !prepPath) {
      console.error('Usage: node src/cli.js casting-discover <casting-launch.json> --prep <book-one-audio-bible-prep.json> [--manuscript FILE] [--voice-pool FILE] [--out DIR] [--per-role 1-8] [--audition-top N] [--pages N] [--anonymous-pages N] [--page-size N] [--model MODEL] [--multicast]');
      process.exitCode = 2;
      return;
    }
    const [launch, prep] = await Promise.all([
      readFile(path.resolve(launchPath), 'utf8').then(JSON.parse),
      readFile(path.resolve(prepPath), 'utf8').then(JSON.parse)
    ]);
    let auditionSamples = null;
    let characterBiographies = null;
    const manuscriptPath = flagValue('--manuscript');
    if (manuscriptPath) {
      const sampleStore = new InMemoryStore();
      const freshPrep = await new BookOneAudioBiblePrepService(sampleStore).runFile(path.resolve(manuscriptPath), {
        title: launch.book?.title,
        author: launch.book?.author,
        model: flagValue('--model', 'eleven_multilingual_v2')
      });
      auditionSamples = buildAuditionSamplePackFromPrepRun(freshPrep, launch);
      characterBiographies = buildCharacterCastingBiographiesFromPrepRun(freshPrep, launch);
    }
    const model = flagValue('--model', 'eleven_multilingual_v2');
    const castingMode = args.includes('--multicast') ? 'multicast' : 'single-narrator';
    const perRole = Number(flagValue('--per-role', 6));
    const auditionTop = Number(flagValue('--audition-top', 3));
    const voicePoolPath = flagValue('--voice-pool');
    if (voicePoolPath) {
      const payload = JSON.parse(await readFile(path.resolve(voicePoolPath), 'utf8'));
      const voices = Array.isArray(payload) ? payload : payload.voices;
      if (!Array.isArray(voices)) throw new Error('--voice-pool must contain a JSON array or {"voices": [...]}');
      const provider = new ElevenLabsProvider();
      result = await service.build({
        launch, prep, voices, auditionSamples, characterBiographies,
        costEstimator: provider.estimateCost.bind(provider),
        perRole, auditionTop, model, castingMode,
        catalogCallsPerformed: 0,
        catalogProvider: 'local-voice-pool'
      });
    } else {
      const provider = new ElevenLabsProvider();
      result = await service.discoverFromProvider({
        launch, prep, provider, auditionSamples, characterBiographies, perRole, auditionTop, model, castingMode,
        maxPages: Number(flagValue('--pages', 3)),
        anonymousPageLimit: Number(flagValue('--anonymous-pages', 30)),
        pageSize: Number(flagValue('--page-size', 100))
      });
    }
  }
  const out = flagValue('--out');
  const files = out ? await writeCastingDiscoveryReports(result, out) : null;
  console.log(JSON.stringify({
    version: VERSION,
    castingDiscovery: result.discovery.castingMode === 'single-narrator' ? 'book-one-single-narrator' : 'book-one-wave-1',
    castingMode: result.discovery.castingMode ?? 'multicast',
    status: result.discovery.status,
    book: result.discovery.book.title,
    catalogProvider: result.discovery.catalog.provider,
    catalogCallsPerformed: result.discovery.catalog.catalogCallsPerformed,
    catalogQueryMode: result.discovery.catalog.queryMode,
    anonymousFallbackUsed: result.discovery.catalog.anonymousFallbackUsed,
    anonymousPageSizeCap: result.discovery.catalog.anonymousPageSizeCap,
    catalogAuthRecommended: result.discovery.catalog.authRecommended,
    rawCatalogVoicesSeen: result.discovery.catalog.rawVoicesSeen,
    uniqueCatalogVoices: result.discovery.catalog.uniqueVoices,
    perRole: result.discovery.catalog.requestedPerRole,
    shortlists: result.discovery.shortlists.map((row) => ({
      character: row.character,
      staged: row.candidates.length,
      top: row.candidates.slice(0, 3).map((candidate) => ({ name: candidate.voice.name, score: candidate.combinedScore, safety: candidate.seriesSafety.score }))
    })),
    distinctiveness: result.discovery.distinctiveness.status,
    auditionSamples: result.discovery.auditionSamples?.status ?? 'not-provided',
    characterBiographies: result.discovery.characterBiographies ? 'FULL_MANUSCRIPT' : 'not-provided',
    performanceGuide: result.discovery.performanceGuide ? 'SINGLE_NARRATOR_READY' : 'not-applicable',
    recommendedAuditionUsd: result.discovery.auditionCost.recommendedAuditionUsd,
    fullShortlistUsd: result.discovery.auditionCost.fullShortlistUsd,
    paidProviderCallsPerformed: result.discovery.guardrails.paidProviderCallsPerformed,
    generationCallsPerformed: result.discovery.guardrails.generationCallsPerformed,
    auditionRenderingArmed: result.discovery.guardrails.auditionRenderingArmed,
    paidGenerationArmed: result.discovery.guardrails.paidGenerationArmed,
    productionArmed: result.discovery.guardrails.productionArmed,
    artifactFingerprint: result.discovery.artifactFingerprint,
    nextAction: result.discovery.nextAction,
    files
  }, null, 2));
}


async function writeRealAuditionPlanReports(plan, outDir) {
  const resolved = path.resolve(outDir);
  await mkdir(resolved, { recursive: true });
  const files = {
    json: path.join(resolved, 'real-audition-plan.json'),
    markdown: path.join(resolved, 'real-audition-plan.md'),
    confirmation: path.join(resolved, 'real-audition-confirmation.txt')
  };
  await Promise.all([
    writeFile(files.json, JSON.stringify(plan, null, 2)),
    writeFile(files.markdown, renderRealAuditionPlanMarkdown(plan)),
    writeFile(files.confirmation, `${plan.confirmation.token}\nSuggested max USD: ${plan.cost.suggestedMaxUsd.toFixed(2)}\n`)
  ]);
  return files;
}

async function runRealAuditionPlan() {
  const discoveryPath = args[1];
  const out = flagValue('--out');
  if (!discoveryPath || !out) {
    console.error('Usage: node src/cli.js casting-audition-plan <casting-candidate-discovery.json> --out DIR [--decisions casting-review-decisions.json] [--voice-id ID ...] [--model MODEL]');
    process.exitCode = 2;
    return;
  }
  const discovery = JSON.parse(await readFile(path.resolve(discoveryPath), 'utf8'));
  const decisionsPath = flagValue('--decisions');
  const decisions = decisionsPath ? JSON.parse(await readFile(path.resolve(decisionsPath), 'utf8')) : null;
  const provider = new ElevenLabsProvider();
  const plan = await buildRealAuditionPlan({
    discovery,
    selectedVoiceIds: flagValues('--voice-id'),
    decisions,
    estimator: provider.estimateCost.bind(provider),
    model: flagValue('--model', 'eleven_multilingual_v2')
  });
  const files = await writeRealAuditionPlanReports(plan, out);
  console.log(JSON.stringify({
    version: VERSION,
    realAuditionPlan: 'book-one-single-narrator',
    status: plan.status,
    voices: plan.selectedCandidates.map((x) => ({ name: x.name, providerVoiceId: x.providerVoiceId, selectedBecause: x.selectedBecause })),
    scriptsPerVoice: plan.scripts.length,
    generationCallsPerformed: 0,
    estimatedUsd: plan.cost.estimateUsd,
    protectedMaxUsd: plan.cost.suggestedMaxUsd,
    confirmationToken: plan.confirmation.token,
    nextAction: `Review ${files.markdown}. Rendering remains blocked until you explicitly run casting-audition-render with --approve-spend ${plan.confirmation.token} and --max-usd ${plan.cost.suggestedMaxUsd.toFixed(2)}.`,
    files
  }, null, 2));
}

async function runRealAuditionRender() {
  const planPath = args[1];
  const out = flagValue('--out');
  const approvalToken = flagValue('--approve-spend');
  const maxUsd = flagValue('--max-usd');
  if (!planPath || !out || !approvalToken || maxUsd === null) {
    console.error('Usage: node src/cli.js casting-audition-render <real-audition-plan.json> --out DIR --approve-spend TOKEN --max-usd USD');
    process.exitCode = 2;
    return;
  }
  const plan = JSON.parse(await readFile(path.resolve(planPath), 'utf8'));
  const provider = new ElevenLabsProvider();
  const result = await renderRealAuditions({
    plan,
    provider,
    outDir: out,
    approvalToken,
    maxUsd: Number(maxUsd)
  });
  console.log(JSON.stringify({
    version: VERSION,
    realAuditions: 'book-one-single-narrator',
    status: result.status,
    renderedClips: result.rendered.length,
    providerGenerationCalls: result.providerGenerationCalls,
    productionGenerationCalls: result.productionGenerationCalls,
    importedVoices: result.providerVoiceImportsPerformed,
    estimatedPlanUsd: result.cost.estimateUsd,
    capturedOrEstimatedBilledUsd: result.cost.capturedUsd,
    approvedMaxUsd: result.cost.maxUsd,
    headroomUsd: result.cost.headroomUsd,
    reviewBoard: path.join(path.resolve(out), 'real-audition-review.html'),
    nextAction: 'Open real-audition-review.html, listen to every Book One clip, rate each voice, choose Keep/Maybe/Pass, and export real-audition-feedback.json. Production is still unarmed.'
  }, null, 2));
}

async function runRealAuditionFeedback() {
  const feedbackPath = args[1];
  const out = flagValue('--out');
  if (!feedbackPath || !out) {
    console.error('Usage: node src/cli.js casting-audition-feedback <real-audition-feedback.json> --out DIR [--plan real-audition-plan.json]');
    process.exitCode = 2;
    return;
  }
  const feedback = JSON.parse(await readFile(path.resolve(feedbackPath), 'utf8'));
  const planPath = flagValue('--plan');
  const plan = planPath ? JSON.parse(await readFile(path.resolve(planPath), 'utf8')) : null;
  const summary = summarizeRealAuditionFeedback(feedback, plan);
  const resolved = path.resolve(out);
  await mkdir(resolved, { recursive: true });
  const files = {
    json: path.join(resolved, 'real-audition-feedback-summary.json'),
    markdown: path.join(resolved, 'real-audition-feedback-summary.md')
  };
  await Promise.all([
    writeFile(files.json, JSON.stringify(summary, null, 2)),
    writeFile(files.markdown, renderRealAuditionFeedbackSummaryMarkdown(summary))
  ]);
  console.log(JSON.stringify({
    version: VERSION,
    realAuditionFeedback: summary.status,
    counts: summary.counts,
    rankedHumanChoices: summary.rankedHumanChoices.map((x) => ({ name: x.name, decision: x.decision, averageRating: x.averageRating })),
    acousticSimilarityInferred: false,
    identityInferredFromAudio: false,
    files
  }, null, 2));
}


async function writePerformanceDirectionPlanReports(plan, outDir) {
  const resolved = path.resolve(outDir);
  await mkdir(resolved, { recursive: true });
  const files = {
    json: path.join(resolved, 'performance-direction-plan.json'),
    markdown: path.join(resolved, 'performance-direction-plan.md'),
    learning: path.join(resolved, 'human-taste-learning-profile.json'),
    confirmation: path.join(resolved, 'performance-direction-confirmation.txt')
  };
  await Promise.all([
    writeFile(files.json, JSON.stringify(plan, null, 2)),
    writeFile(files.markdown, renderPerformanceDirectionPlanMarkdown(plan)),
    writeFile(files.learning, JSON.stringify(plan.learningProfile, null, 2)),
    writeFile(files.confirmation, `${plan.confirmation.token}\nSuggested max USD: ${plan.cost.suggestedMaxUsd.toFixed(2)}\n`)
  ]);
  return files;
}

async function runPerformanceDirectionPlan() {
  const sourcePlanPath = args[1];
  const feedbackPath = flagValue('--feedback');
  const out = flagValue('--out');
  if (!sourcePlanPath || !feedbackPath || !out) {
    console.error('Usage: node src/cli.js casting-performance-plan <real-audition-plan.json> --feedback <real-audition-feedback.json> --out DIR [--model eleven_v3]');
    process.exitCode = 2;
    return;
  }
  const [sourcePlan, feedback] = await Promise.all([
    readFile(path.resolve(sourcePlanPath), 'utf8').then(JSON.parse),
    readFile(path.resolve(feedbackPath), 'utf8').then(JSON.parse)
  ]);
  const provider = new ElevenLabsProvider();
  const plan = await buildPerformanceDirectionPlan({
    sourcePlan,
    feedback,
    estimator: provider.estimateCost.bind(provider),
    model: flagValue('--model', 'eleven_v3')
  });
  const files = await writePerformanceDirectionPlanReports(plan, out);
  console.log(JSON.stringify({
    version: VERSION,
    performanceDirectionPlan: 'book-one-single-narrator',
    status: plan.status,
    primaryHumanChoice: plan.learningProfile.primaryVoice,
    variants: plan.variants.map((v) => ({ voice: v.candidateName, variant: v.label, sourceDecision: v.sourceDecision })),
    generationCallsPerformed: 0,
    estimatedUsd: plan.cost.estimateUsd,
    protectedMaxUsd: plan.cost.suggestedMaxUsd,
    confirmationToken: plan.confirmation.token,
    nextAction: `Review ${files.markdown}. Rendering remains blocked until casting-performance-render is explicitly called with --approve-spend ${plan.confirmation.token} --max-usd ${plan.cost.suggestedMaxUsd.toFixed(2)}.`,
    files
  }, null, 2));
}

async function runPerformanceDirectionRender() {
  const planPath = args[1];
  const out = flagValue('--out');
  const approvalToken = flagValue('--approve-spend');
  const maxUsd = flagValue('--max-usd');
  if (!planPath || !out || !approvalToken || maxUsd === null) {
    console.error('Usage: node src/cli.js casting-performance-render <performance-direction-plan.json> --out DIR --approve-spend TOKEN --max-usd USD');
    process.exitCode = 2;
    return;
  }
  const plan = JSON.parse(await readFile(path.resolve(planPath), 'utf8'));
  const provider = new ElevenLabsProvider();
  const result = await renderPerformanceDirectionRound({
    plan,
    provider,
    outDir: out,
    approvalToken,
    maxUsd: Number(maxUsd)
  });
  console.log(JSON.stringify({
    version: VERSION,
    performanceDirection: result.status,
    model: result.model,
    renderedClips: result.rendered.length,
    providerGenerationCalls: result.providerGenerationCalls,
    productionGenerationCalls: result.productionGenerationCalls,
    castLocksCreated: result.castLocksCreated,
    capturedOrEstimatedBilledUsd: result.cost.capturedUsd,
    approvedMaxUsd: result.cost.maxUsd,
    reviewBoard: path.join(path.resolve(out), 'performance-direction-review.html'),
    nextAction: 'Open performance-direction-review.html, compare variants, choose Best/Maybe/Pass, add ratings/notes, and export performance-direction-feedback.json. Production remains unarmed.'
  }, null, 2));
}

async function runPerformanceDirectionLearn() {
  const feedbackPath = args[1];
  const planPath = flagValue('--plan');
  const out = flagValue('--out');
  if (!feedbackPath || !planPath || !out) {
    console.error('Usage: node src/cli.js casting-performance-learn <performance-direction-feedback.json> --plan <performance-direction-plan.json> --out DIR');
    process.exitCode = 2;
    return;
  }
  const [feedback, plan] = await Promise.all([
    readFile(path.resolve(feedbackPath), 'utf8').then(JSON.parse),
    readFile(path.resolve(planPath), 'utf8').then(JSON.parse)
  ]);
  const summary = summarizePerformanceDirectionFeedback({ feedback, plan });
  const resolved = path.resolve(out);
  await mkdir(resolved, { recursive: true });
  const files = {
    json: path.join(resolved, 'performance-direction-learning-summary.json'),
    markdown: path.join(resolved, 'performance-direction-learning-summary.md')
  };
  await Promise.all([
    writeFile(files.json, JSON.stringify(summary, null, 2)),
    writeFile(files.markdown, renderPerformanceDirectionLearningMarkdown(summary))
  ]);
  console.log(JSON.stringify({
    version: VERSION,
    performanceDirectionLearning: summary.status,
    winner: summary.winner,
    nextHumanTasteProfile: summary.nextHumanTasteProfile,
    productionArmed: false,
    castLockArmed: false,
    nextAction: summary.nextAction,
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
} else if (args[0] === 'external-superman') {
  await runExternalSuperman();
} else if (args[0] === 'external-superman-fixture') {
  await runExternalSuperman({ fixture: true });
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
} else if (args[0] === 'casting-launch') {
  await runCastingLaunch();
} else if (args[0] === 'casting-launch-fixture') {
  await runCastingLaunch({ fixture: true });
} else if (args[0] === 'casting-discover') {
  await runCastingDiscovery();
} else if (args[0] === 'casting-discover-fixture') {
  await runCastingDiscovery({ fixture: true });
} else if (args[0] === 'casting-audition-plan') {
  await runRealAuditionPlan();
} else if (args[0] === 'casting-audition-render') {
  await runRealAuditionRender();
} else if (args[0] === 'casting-audition-feedback') {
  await runRealAuditionFeedback();
} else if (args[0] === 'casting-performance-plan') {
  await runPerformanceDirectionPlan();
} else if (args[0] === 'casting-performance-render') {
  await runPerformanceDirectionRender();
} else if (args[0] === 'casting-performance-learn') {
  await runPerformanceDirectionLearn();
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
    externalBookSupermanCommand: 'node src/cli.js external-superman <unrelated-file> --out <directory>',
    bookOneAudioBiblePrepCommand: 'node src/cli.js audio-bible-prep <file> --out <directory>',
    castingLaunchCommand: 'node src/cli.js casting-launch <book-one-audio-bible-prep.json> --out <directory>',
    castingDiscoveryCommand: 'node src/cli.js casting-discover <casting-launch.json> --prep <book-one-audio-bible-prep.json> --manuscript <book_1.docx> --out <directory>',
    realAuditionPlanCommand: 'node src/cli.js casting-audition-plan <casting-candidate-discovery.json> --voice-id <id> --out <directory>',
    realAuditionRenderCommand: 'node src/cli.js casting-audition-render <real-audition-plan.json> --approve-spend <token> --max-usd <usd> --out <directory>',
    realAuditionFeedbackCommand: 'node src/cli.js casting-audition-feedback <real-audition-feedback.json> --plan <real-audition-plan.json> --out <directory>',
    performanceDirectionPlanCommand: 'node src/cli.js casting-performance-plan <real-audition-plan.json> --feedback <real-audition-feedback.json> --out <directory>',
    performanceDirectionRenderCommand: 'node src/cli.js casting-performance-render <performance-direction-plan.json> --approve-spend <token> --max-usd <usd> --out <directory>',
    performanceDirectionLearnCommand: 'node src/cli.js casting-performance-learn <performance-direction-feedback.json> --plan <performance-direction-plan.json> --out <directory>',
    seriesContinuitySeedCommand: 'node src/cli.js series-continuity-seed <book-one-audio-bible-prep.json> [--existing <series-continuity.json>] --out <directory>',
    seriesContinuityCompareCommand: 'node src/cli.js series-continuity-compare <series-continuity.json> <next-book-audio-bible-prep.json>',
    seriesRelationshipLockCommand: 'node src/cli.js series-continuity-lock-group <series-continuity.json> --members key1,key2,key3 --kind partner --out <file>',
    seriesVoiceLockCommand: 'node src/cli.js series-continuity-lock-voice <series-continuity.json> --character <key> --provider <provider> --voice-id <id> --safety-score <0-100> --out <file>',
    moneyGuardFixtureCommand: 'node src/cli.js money-guard-fixture',
    workflow: {
      manuscriptBrain: 'ready', audioBible: 'ready', castingRoom: 'ready', audiobookDirector: 'ready',
      productionEngine: 'ready', reviewStudio: 'ready', continuityQa: 'ready', masteringLab: 'ready',
      distributionBrain: 'ready', operatorFlowAudit: 'ready', bookOneSuperman: 'ready', externalBookSuperman: 'ready',
      bookOneAudioBiblePrep: 'ready', castingLaunch: 'ready', castingDiscovery: 'ready', seriesContinuity: 'ready', moneyGuard: 'ready', finalSaasBoundaryClosure: 'ready'
    },
    distributionProfiles: ['acx-2026', 'spotify-direct-2026', 'apple-partner-2026', 'w3c-audiobook-2020'],
    duplicateProtection: generation.request.fingerprint,
    recordedCostUsd: ledger.total(project.id), providerCallsPerformed: 0
  }, null, 2));
}
