import { productionCharacterCap, splitForTts } from '../production/model-limits.js';

const freeze = (value) => Object.freeze(value);

export const SUPERMAN_PRICING_SNAPSHOT = freeze({
  reviewedOn: '2026-09-12',
  usdPer1kCharacters: freeze({
    eleven_v3: 0.10,
    eleven_multilingual_v2: 0.10,
    eleven_flash_v2_5: 0.05,
    eleven_turbo_v2_5: 0.05
  })
});

const FRONT_BACK_MATTER = /^(front matter|title|copyright|dedication|contents|table of contents|preface|introduction|acknowledg(?:e)?ments|author(?:'s)? note|afterword|epilogue|about the author)$/i;
const LIKELY_NON_NAMES = new Set(['he', 'she', 'they', 'we', 'i', 'you', 'it', 'someone', 'somebody', 'everyone', 'everybody', 'nobody', 'who']);

function words(text) {
  return (String(text ?? '').match(/[\p{L}\p{N}]+(?:[’'-][\p{L}\p{N}]+)*/gu) ?? []).length;
}

function round(value, digits = 2) {
  return Number(Number(value).toFixed(digits));
}

function allSegments(analysis) {
  return analysis.chapters.flatMap((chapter) => chapter.scenes.flatMap((scene) => scene.segments));
}

export function likelyNonCharacterCandidate(name) {
  const clean = String(name ?? '').trim().toLowerCase();
  return !clean || LIKELY_NON_NAMES.has(clean);
}

export function buildSpeakerCandidateRoster(analysis) {
  const roster = new Map();
  for (const segment of allSegments(analysis)) {
    const candidate = segment.kind === 'dialogue' ? segment.speakerCandidate : null;
    const name = String(candidate?.name ?? '').trim();
    if (!name || likelyNonCharacterCandidate(name)) continue;
    const key = name.toLocaleLowerCase('en-US');
    const prior = roster.get(key) ?? { name, mentions: 0, confidenceTotal: 0, evidence: new Set() };
    prior.mentions += 1;
    prior.confidenceTotal += Number(candidate.confidence ?? 0);
    if (candidate.evidence) prior.evidence.add(candidate.evidence);
    roster.set(key, prior);
  }
  return freeze([...roster.values()]
    .map((item) => freeze({
      name: item.name,
      mentions: item.mentions,
      averageConfidence: round(item.confidenceTotal / Math.max(1, item.mentions), 3),
      evidence: freeze([...item.evidence].sort())
    }))
    .sort((a, b) => b.mentions - a.mentions || a.name.localeCompare(b.name)));
}

export function buildChapterStats(analysis) {
  return freeze(analysis.chapters.map((chapter) => {
    const segments = chapter.scenes.flatMap((scene) => scene.segments);
    const text = segments.map((segment) => segment.text).join(' ');
    const dialogue = segments.filter((segment) => segment.kind === 'dialogue');
    const unattributed = dialogue.filter((segment) => !segment.speakerCandidate || likelyNonCharacterCandidate(segment.speakerCandidate?.name));
    return freeze({
      order: chapter.order,
      title: chapter.title,
      words: words(text),
      characters: [...text].length,
      scenes: chapter.scenes.length,
      segments: segments.length,
      dialogueSegments: dialogue.length,
      unattributedDialogueSegments: unattributed.length,
      textHash: chapter.textHash
    });
  }));
}

export function simulateProduction(analysis, {
  model = 'eleven_multilingual_v2',
  safetyRatio = 0.8,
  regenerationReserveRatio = 0.25,
  auditionAllowanceUsd = 5,
  directorOverheadRatio = 0.03,
  pricing = SUPERMAN_PRICING_SNAPSHOT.usdPer1kCharacters
} = {}) {
  const cap = productionCharacterCap(model, { safetyRatio });
  const segments = allSegments(analysis);
  let chunks = 0;
  let maxChunkCharacters = 0;
  let canonicalRenderCharacters = 0;
  let duplicateRenderableSegments = 0;
  const seen = new Set();

  for (const segment of segments) {
    const text = String(segment.text ?? '');
    const pieces = splitForTts(text, { maxChars: cap });
    chunks += pieces.length;
    canonicalRenderCharacters += [...text].length;
    for (const piece of pieces) maxChunkCharacters = Math.max(maxChunkCharacters, [...piece].length);
    if (seen.has(text)) duplicateRenderableSegments += 1;
    else seen.add(text);
  }

  const estimatedRenderCharacters = Math.ceil(canonicalRenderCharacters * (1 + Math.max(0, Number(directorOverheadRatio) || 0)));
  const rate = pricing?.[model];
  const initialTtsUsd = Number.isFinite(Number(rate)) ? round((estimatedRenderCharacters / 1000) * Number(rate), 2) : null;
  const regenerationReserveUsd = initialTtsUsd === null ? null : round(initialTtsUsd * Math.max(0, Number(regenerationReserveRatio) || 0), 2);
  const recommendedProductionBudgetUsd = initialTtsUsd === null ? null : round(initialTtsUsd + regenerationReserveUsd + Math.max(0, Number(auditionAllowanceUsd) || 0), 2);

  return freeze({
    model,
    modelCharacterCap: cap,
    segmentCount: segments.length,
    renderJobEstimate: chunks,
    maxChunkCharacters,
    canonicalRenderCharacters,
    estimatedRenderCharacters,
    directorOverheadRatio,
    duplicateRenderableSegments,
    pricingRateUsdPer1k: Number.isFinite(Number(rate)) ? Number(rate) : null,
    initialTtsUsd,
    regenerationReserveRatio,
    regenerationReserveUsd,
    auditionAllowanceUsd: Math.max(0, Number(auditionAllowanceUsd) || 0),
    recommendedProductionBudgetUsd,
    estimatedOnly: true,
    providerCallsPerformed: 0
  });
}

function finding(severity, code, stage, message, action = null, detail = null) {
  return freeze({ severity, code, stage, message, action, detail });
}

function findingsFor(ingestResult, chapterStats, roster) {
  const { analysis } = ingestResult;
  const findings = [];
  const metrics = analysis.metrics;
  const segments = allSegments(analysis);
  const dialogue = segments.filter((segment) => segment.kind === 'dialogue');
  const unattributed = dialogue.filter((segment) => !segment.speakerCandidate || likelyNonCharacterCandidate(segment.speakerCandidate?.name));
  const unattributedRatio = dialogue.length ? unattributed.length / dialogue.length : 0;

  if (!analysis.source?.sourceHash) findings.push(finding('critical', 'source-hash-missing', 'manuscript', 'The manuscript has no immutable source hash.', 'Re-import the canonical manuscript before production.'));
  if (!metrics.productionCharacters) findings.push(finding('critical', 'no-production-text', 'manuscript', 'No renderable manuscript text was detected.', 'Verify the source file and parser before continuing.'));
  if (analysis.chapters.length === 1 && metrics.words > 10000) findings.push(finding('critical', 'chapter-detection-failed', 'manuscript', 'A long book was detected as one chapter.', 'Correct chapter detection before casting or generation.'));

  const duplicateHashes = new Map();
  for (const chapter of chapterStats) {
    if (!chapter.textHash) continue;
    const rows = duplicateHashes.get(chapter.textHash) ?? [];
    rows.push(chapter.title);
    duplicateHashes.set(chapter.textHash, rows);
  }
  for (const titles of duplicateHashes.values()) {
    if (titles.length > 1) findings.push(finding('critical', 'duplicate-chapter-content', 'manuscript', `Identical chapter content was detected in ${titles.length} chapters.`, 'Inspect the source/spine for duplicated chapter content.', titles));
  }

  const titleCounts = new Map();
  for (const chapter of chapterStats) {
    const key = String(chapter.title ?? '').trim().toLowerCase();
    if (key) titleCounts.set(key, (titleCounts.get(key) ?? 0) + 1);
    if (!FRONT_BACK_MATTER.test(String(chapter.title ?? '')) && chapter.words > 0 && chapter.words < 120) {
      findings.push(finding('medium', 'very-short-chapter', 'manuscript', `${chapter.title} contains only ${chapter.words} words.`, 'Confirm this is an intentional short chapter/section.'));
    }
    if (chapter.words > 15000) findings.push(finding('high', 'very-long-chapter', 'manuscript', `${chapter.title} contains ${chapter.words.toLocaleString()} words.`, 'Review chapter boundaries before production.'));
    if (chapter.segments === 0) findings.push(finding('critical', 'empty-chapter-segmentation', 'manuscript', `${chapter.title} produced no narration/dialogue segments.`, 'Fix segmentation before production.'));
  }
  for (const [title, count] of titleCounts) {
    if (count > 1 && title !== 'chapter') findings.push(finding('medium', 'duplicate-chapter-title', 'manuscript', `The title “${title}” appears ${count} times.`, 'Confirm chapter titles/order are intentional.'));
  }

  if (!analysis.metadata?.title) findings.push(finding('medium', 'metadata-title-missing', 'manuscript', 'Book title metadata is missing.', 'Set the canonical audiobook title.'));
  if (!analysis.metadata?.author) findings.push(finding('medium', 'metadata-author-missing', 'manuscript', 'Author metadata is missing.', 'Set the canonical author/byline.'));

  if (unattributedRatio > 0.5 && dialogue.length >= 10) findings.push(finding('high', 'dialogue-attribution-low', 'audio-bible', `${Math.round(unattributedRatio * 100)}% of detected dialogue has no usable speaker candidate.`, 'Resolve the character roster before ensemble casting.'));
  else if (unattributedRatio > 0.15 && dialogue.length >= 10) findings.push(finding('medium', 'dialogue-attribution-review', 'audio-bible', `${Math.round(unattributedRatio * 100)}% of detected dialogue needs speaker review.`, 'Resolve these lines in the Audio Bible before generation.'));

  if (roster.length > 40) findings.push(finding('medium', 'large-speaker-roster', 'audio-bible', `${roster.length} possible speakers were detected.`, 'Review the roster for one-off names and parser false positives before casting.'));

  const productionRatio = metrics.sourceCharacters ? metrics.productionCharacters / metrics.sourceCharacters : 1;
  if (metrics.words > 5000 && productionRatio < 0.75) findings.push(finding('high', 'production-text-loss-risk', 'manuscript', `Only ${Math.round(productionRatio * 100)}% of source characters survived into production segments.`, 'Compare extracted text against the ebook before generation.'));

  for (const warning of analysis.warnings ?? []) {
    if (findings.some((item) => item.message.includes(warning))) continue;
    findings.push(finding('low', 'manuscript-analyzer-warning', 'manuscript', warning, 'Review before approving manuscript intake.'));
  }

  return freeze(findings);
}

function scoreFromFindings(findings) {
  const penalty = findings.reduce((sum, item) => sum + ({ critical: 35, high: 15, medium: 5, low: 2, info: 0 })[item.severity], 0);
  return Math.max(0, Math.min(100, 100 - penalty));
}

function severityCounts(findings) {
  const output = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const item of findings) output[item.severity] = (output[item.severity] ?? 0) + 1;
  return freeze(output);
}

export function buildBookOneSupermanReport(ingestResult, {
  model = 'eleven_multilingual_v2',
  apiKeyPresent = false,
  ffmpegHealth = { ok: false, reason: 'not checked' },
  nodeVersion = process.versions.node,
  regenerationReserveRatio = 0.25,
  auditionAllowanceUsd = 5,
  label = 'Book One Superman'
} = {}) {
  if (!ingestResult?.analysis?.chapters?.length) throw new Error('Book One Superman requires an ingested manuscript');
  const analysis = ingestResult.analysis;
  const chapterStats = buildChapterStats(analysis);
  const roster = buildSpeakerCandidateRoster(analysis);
  const production = simulateProduction(analysis, { model, regenerationReserveRatio, auditionAllowanceUsd });
  const findings = findingsFor(ingestResult, chapterStats, roster);
  const counts = severityCounts(findings);
  const score = scoreFromFindings(findings);
  const status = counts.critical ? 'BLOCKED' : counts.high ? 'REVIEW' : 'PASS';
  const majorNode = Number(String(nodeVersion ?? '').split('.')[0]);
  const environment = freeze({
    nodeVersion: String(nodeVersion ?? ''),
    nodeReady: Number.isFinite(majorNode) && majorNode >= 20,
    ffmpegReady: Boolean(ffmpegHealth?.ok),
    ffmpeg: ffmpegHealth?.ffmpeg ?? null,
    ffprobe: ffmpegHealth?.ffprobe ?? null,
    ffmpegReason: ffmpegHealth?.ok ? null : (ffmpegHealth?.reason ?? 'FFmpeg not available'),
    elevenLabsApiKeyPresent: Boolean(apiKeyPresent)
  });
  const dialogueRatio = analysis.metrics.productionCharacters
    ? analysis.metrics.dialogueCharacters / analysis.metrics.productionCharacters : 0;
  const estimatedHours = round((analysis.metrics.estimatedMinutesAt155Wpm ?? 0) / 60, 2);
  const safeToBeginCasting = counts.critical === 0;
  const nextFinding = findings.find((item) => ['critical', 'high'].includes(item.severity)) ?? findings[0] ?? null;
  const nextAction = nextFinding?.action ?? 'Review the detected character roster, then build and lock the Audio Bible.';

  return freeze({
    schemaVersion: 1,
    release: '0.11.0',
    label,
    status,
    score,
    providerCallsPerformed: 0,
    manuscript: freeze({
      format: analysis.source.format,
      filename: analysis.source.filename,
      sourceHash: analysis.source.sourceHash,
      normalizedTextHash: analysis.source.normalizedTextHash,
      title: analysis.metadata.title,
      author: analysis.metadata.author,
      language: analysis.metadata.language,
      metrics: analysis.metrics,
      estimatedFinishedHours: estimatedHours,
      dialogueCharacterRatio: round(dialogueRatio, 3),
      chapterStats
    }),
    characterDiscovery: freeze({
      candidateCount: roster.length,
      candidates: roster,
      note: 'Candidates are parser evidence only; Audio Bible approval remains authoritative.'
    }),
    production,
    environment,
    findings,
    findingCounts: counts,
    gates: freeze({
      manuscriptIntake: counts.critical === 0 ? 'pass' : 'blocked',
      safeToBeginCasting,
      infrastructureReady: environment.nodeReady && environment.ffmpegReady,
      providerCredentialPresent: environment.elevenLabsApiKeyPresent,
      paidGenerationArmed: false,
      paidGenerationReason: 'Book One Superman is zero-spend. Paid generation remains gated by Casting, Director and Production preflight.'
    }),
    nextAction,
    generatedAt: new Date().toISOString()
  });
}

export function renderSupermanMarkdown(report) {
  const money = (value) => value == null ? 'unavailable' : `$${Number(value).toFixed(2)}`;
  const lines = [
    `# ${report.label}`,
    '',
    `**Release:** ${report.release}`,
    `**Status:** ${report.status}`,
    `**Readiness score:** ${report.score}/100`,
    `**Provider calls performed:** ${report.providerCallsPerformed}`,
    '',
    '## Book',
    '',
    `- Title: ${report.manuscript.title ?? 'Not supplied'}`,
    `- Author: ${report.manuscript.author ?? 'Not supplied'}`,
    `- Format: ${report.manuscript.format}`,
    `- Words: ${Number(report.manuscript.metrics.words).toLocaleString()}`,
    `- Chapters: ${report.manuscript.metrics.chapters}`,
    `- Scenes: ${report.manuscript.metrics.scenes}`,
    `- Segments: ${report.manuscript.metrics.segments}`,
    `- Estimated finished runtime: ${report.manuscript.estimatedFinishedHours} hours`,
    `- Possible speaking characters: ${report.characterDiscovery.candidateCount}`,
    '',
    '## Production rehearsal — ZERO SPEND',
    '',
    `- Model: ${report.production.model}`,
    `- Safe character cap: ${report.production.modelCharacterCap.toLocaleString()}`,
    `- Estimated render jobs/chunks: ${report.production.renderJobEstimate.toLocaleString()}`,
    `- Estimated render characters: ${report.production.estimatedRenderCharacters.toLocaleString()}`,
    `- Initial TTS estimate: ${money(report.production.initialTtsUsd)}`,
    `- Regeneration reserve: ${money(report.production.regenerationReserveUsd)}`,
    `- Suggested production envelope (including audition allowance): ${money(report.production.recommendedProductionBudgetUsd)}`,
    '',
    '## Environment',
    '',
    `- Node 20+: ${report.environment.nodeReady ? 'PASS' : 'BLOCKED'} (${report.environment.nodeVersion})`,
    `- FFmpeg / FFprobe: ${report.environment.ffmpegReady ? 'PASS' : 'NOT READY'}`,
    `- ElevenLabs key present: ${report.environment.elevenLabsApiKeyPresent ? 'YES' : 'NO — okay for zero-spend rehearsal'}`,
    '',
    '## Findings',
    ''
  ];
  if (!report.findings.length) lines.push('No structural findings.');
  for (const item of report.findings) {
    lines.push(`- **${item.severity.toUpperCase()} — ${item.code}:** ${item.message}${item.action ? ` Next: ${item.action}` : ''}`);
  }
  lines.push('', '## Candidate character roster', '', '| Candidate | Mentions | Avg confidence |', '| --- | ---: | ---: |');
  for (const candidate of report.characterDiscovery.candidates.slice(0, 50)) {
    lines.push(`| ${candidate.name.replace(/\|/g, '\\|')} | ${candidate.mentions} | ${candidate.averageConfidence} |`);
  }
  lines.push('', '## Chapter stress table', '', '| # | Chapter | Words | Scenes | Segments | Dialogue needing review |', '| ---: | --- | ---: | ---: | ---: | ---: |');
  for (const chapter of report.manuscript.chapterStats) {
    lines.push(`| ${chapter.order + 1} | ${String(chapter.title).replace(/\|/g, '\\|')} | ${chapter.words} | ${chapter.scenes} | ${chapter.segments} | ${chapter.unattributedDialogueSegments} |`);
  }
  lines.push('', '## Next action', '', report.nextAction, '', '> This report never performs paid voice generation. It is a pre-production stress test, not approval to spend.', '');
  return lines.join('\n');
}

export function buildSyntheticBookOneFixture({ chapters = 42, paragraphsPerChapter = 40 } = {}) {
  const names = ['Michael', 'Juan', 'Christopher', 'Elena'];
  const filler = 'The evening carried on with the kind of ordinary detail that makes a relationship feel lived in, complicated, warm, and impossible to reduce to one simple answer.';
  const output = ['Synthetic Book One Superman Fixture', '', 'by YasReady Test Author', ''];
  for (let chapter = 1; chapter <= chapters; chapter += 1) {
    output.push(`Chapter ${chapter}`, '');
    for (let p = 0; p < paragraphsPerChapter; p += 1) {
      const speaker = names[(chapter + p) % names.length];
      output.push(`${speaker} said, “This is synthetic dialogue for chapter ${chapter}, scene ${p + 1}, built to stress the audiobook pipeline without using a real manuscript.”`);
      output.push(`${filler} Chapter ${chapter} marker ${p + 1}.`);
      if (p > 0 && p % 6 === 0) output.push('', '* * *', '');
      else output.push('');
    }
  }
  return output.join('\n');
}
