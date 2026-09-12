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

export const BOOK_ONE_PROFILE = freeze({
  id: 'tres-amigos-una-vida-book-one',
  title: 'Tres Amigos, Una Vida – A Throuple Love Story',
  aliases: freeze({
    'Michael Rawlins': freeze(['Michael', 'Rawlins', 'Micheal', 'Then Michael']),
    'Juan Delgado': freeze(['Juan', 'Delgado']),
    'Christopher Lancaster': freeze(['Christopher', 'Chris', 'Lancaster'])
  })
});

const FRONT_BACK_MATTER = /^(front matter|title|copyright|dedication|contents|table of contents|preface|introduction|acknowledg(?:e)?ments|author(?:'s)? note|afterword|about the author)$/i;
const EXCLUDED_PRODUCTION_SECTIONS = /^(front matter|title|copyright|dedication|contents|table of contents)$/i;
const LIKELY_NON_NAMES = new Set(['he', 'she', 'they', 'we', 'i', 'you', 'it', 'someone', 'somebody', 'everyone', 'everybody', 'nobody', 'who']);
const DISCOURSE_PREFIX = /^(?:then|but|and|so|meanwhile|suddenly)\s+/i;

function words(text) {
  return (String(text ?? '').match(/[\p{L}\p{N}]+(?:[’'-][\p{L}\p{N}]+)*/gu) ?? []).length;
}

function round(value, digits = 2) {
  return Number(Number(value).toFixed(digits));
}

function allSegments(analysis) {
  return analysis.chapters.flatMap((chapter) => chapter.scenes.flatMap((scene) => scene.segments));
}

function productionChapters(analysis) {
  return analysis.chapters.filter((chapter) => !EXCLUDED_PRODUCTION_SECTIONS.test(String(chapter.title ?? '')));
}

function productionSegments(analysis) {
  return productionChapters(analysis).flatMap((chapter) => chapter.scenes.flatMap((scene) => scene.segments));
}

export function likelyNonCharacterCandidate(name) {
  const clean = String(name ?? '').trim().toLowerCase();
  return !clean || LIKELY_NON_NAMES.has(clean);
}

function buildAliasIndex(aliases = BOOK_ONE_PROFILE.aliases) {
  const index = new Map();
  for (const [canonical, values] of Object.entries(aliases ?? {})) {
    index.set(canonical.toLowerCase(), canonical);
    for (const value of values ?? []) index.set(String(value).trim().toLowerCase(), canonical);
  }
  return index;
}

export function canonicalizeSpeakerCandidate(name, { aliases = BOOK_ONE_PROFILE.aliases } = {}) {
  let clean = String(name ?? '').trim();
  clean = clean.replace(DISCOURSE_PREFIX, '').trim();
  if (!clean || likelyNonCharacterCandidate(clean)) return null;
  const aliasIndex = buildAliasIndex(aliases);
  return aliasIndex.get(clean.toLowerCase()) ?? clean;
}

export function buildSpeakerCandidateRoster(analysis, { aliases = BOOK_ONE_PROFILE.aliases } = {}) {
  const roster = new Map();
  for (const segment of allSegments(analysis)) {
    const candidate = segment.kind === 'dialogue' ? segment.speakerCandidate : null;
    const rawName = String(candidate?.name ?? '').trim();
    const name = canonicalizeSpeakerCandidate(rawName, { aliases });
    if (!name) continue;
    const key = name.toLocaleLowerCase('en-US');
    const prior = roster.get(key) ?? {
      name, mentions: 0, confidenceTotal: 0, evidence: new Set(), observedAs: new Set(),
      highConfidenceMentions: 0, inferredReviewMentions: 0
    };
    const confidence = Number(candidate.confidence ?? 0);
    prior.mentions += 1;
    prior.confidenceTotal += confidence;
    if (confidence >= 0.75) prior.highConfidenceMentions += 1;
    else prior.inferredReviewMentions += 1;
    if (candidate.evidence) prior.evidence.add(candidate.evidence);
    if (rawName) prior.observedAs.add(rawName);
    roster.set(key, prior);
  }
  return freeze([...roster.values()]
    .map((item) => freeze({
      name: item.name,
      mentions: item.mentions,
      averageConfidence: round(item.confidenceTotal / Math.max(1, item.mentions), 3),
      highConfidenceMentions: item.highConfidenceMentions,
      inferredReviewMentions: item.inferredReviewMentions,
      observedAs: freeze([...item.observedAs].sort()),
      evidence: freeze([...item.evidence].sort())
    }))
    .sort((a, b) => b.mentions - a.mentions || a.name.localeCompare(b.name)));
}

function dialogueReviewCounts(dialogue) {
  let unresolved = 0;
  let inferredReview = 0;
  let highConfidence = 0;
  for (const segment of dialogue) {
    const candidate = segment.speakerCandidate;
    if (!candidate || likelyNonCharacterCandidate(candidate.name)) unresolved += 1;
    else if (Number(candidate.confidence ?? 0) < 0.75) inferredReview += 1;
    else highConfidence += 1;
  }
  return { unresolved, inferredReview, highConfidence, needingReview: unresolved + inferredReview };
}

export function buildChapterStats(analysis) {
  return freeze(analysis.chapters.map((chapter) => {
    const segments = chapter.scenes.flatMap((scene) => scene.segments);
    const text = segments.map((segment) => segment.text).join(' ');
    const dialogue = segments.filter((segment) => segment.kind === 'dialogue');
    const review = dialogueReviewCounts(dialogue);
    const role = EXCLUDED_PRODUCTION_SECTIONS.test(String(chapter.title ?? '')) ? 'front-matter' : 'narrative';
    return freeze({
      order: chapter.order,
      title: chapter.title,
      role,
      words: words(text),
      characters: [...text].length,
      scenes: chapter.scenes.length,
      segments: segments.length,
      dialogueSegments: dialogue.length,
      highConfidenceDialogueSegments: review.highConfidence,
      inferredReviewDialogueSegments: review.inferredReview,
      unattributedDialogueSegments: review.unresolved,
      dialogueNeedingReview: review.needingReview,
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
  const segments = productionSegments(analysis);
  const excludedSections = analysis.chapters.filter((chapter) => EXCLUDED_PRODUCTION_SECTIONS.test(String(chapter.title ?? '')));
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
    sourceSectionCount: analysis.chapters.length,
    productionSectionCount: productionChapters(analysis).length,
    excludedSectionCount: excludedSections.length,
    excludedSections: freeze(excludedSections.map((chapter) => chapter.title)),
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
  const review = dialogueReviewCounts(dialogue);
  const unresolvedRatio = dialogue.length ? review.unresolved / dialogue.length : 0;
  const inferredReviewRatio = dialogue.length ? review.inferredReview / dialogue.length : 0;

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

  const frontMatter = chapterStats.filter((chapter) => chapter.role === 'front-matter');
  if (frontMatter.length) findings.push(finding('info', 'front-matter-separated', 'manuscript', `${frontMatter.length} non-narrative front-matter section(s) were separated from the narration cost rehearsal.`, 'Confirm the opening-credit script instead of narrating print-only front matter.', frontMatter.map((x) => x.title)));

  if (!analysis.metadata?.title) findings.push(finding('medium', 'metadata-title-missing', 'manuscript', 'Book title metadata is missing.', 'Set the canonical audiobook title.'));
  if (!analysis.metadata?.author) findings.push(finding('medium', 'metadata-author-missing', 'manuscript', 'Author metadata is missing.', 'Set the canonical author/byline.'));

  if (unresolvedRatio > 0.5 && dialogue.length >= 10) findings.push(finding('high', 'dialogue-attribution-low', 'audio-bible', `${Math.round(unresolvedRatio * 100)}% of detected dialogue still has no speaker candidate after contextual inference.`, 'Resolve the remaining character roster before ensemble casting.'));
  else if (unresolvedRatio > 0.15 && dialogue.length >= 10) findings.push(finding('medium', 'dialogue-attribution-review', 'audio-bible', `${Math.round(unresolvedRatio * 100)}% of detected dialogue is still unattributed after contextual inference.`, 'Review the remaining unresolved lines in the Audio Bible.'));
  else if (unresolvedRatio > 0.05 && dialogue.length >= 10) findings.push(finding('low', 'dialogue-attribution-spot-check', 'audio-bible', `${Math.round(unresolvedRatio * 100)}% of detected dialogue remains unattributed after contextual inference.`, 'Spot-check the remaining unresolved lines while building the Audio Bible.'));

  if (inferredReviewRatio > 0.15 && dialogue.length >= 10) {
    findings.push(finding('medium', 'dialogue-context-review', 'audio-bible', `${Math.round(inferredReviewRatio * 100)}% of dialogue has lower-confidence conversational attribution.`, 'Review low-confidence inferred turns before auto-binding voices.'));
  }

  if (roster.length > 40) findings.push(finding('medium', 'large-speaker-roster', 'audio-bible', `${roster.length} possible speakers were detected.`, 'Review the roster for one-off names and parser false positives before casting.'));

  const productionRatio = metrics.sourceCharacters ? metrics.productionCharacters / metrics.sourceCharacters : 1;
  if (metrics.words > 5000 && productionRatio < 0.75) findings.push(finding('high', 'production-text-loss-risk', 'manuscript', `Only ${Math.round(productionRatio * 100)}% of source characters survived into production segments.`, 'Compare extracted text against the ebook before generation.'));

  for (const warning of analysis.warnings ?? []) {
    const warningCount = Number(/^([0-9]+)\s+dialogue segment/.exec(warning)?.[1] ?? NaN);
    if (Number.isFinite(warningCount) && warningCount === review.unresolved) continue;
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
  label = 'Book One Superman',
  characterAliases = BOOK_ONE_PROFILE.aliases
} = {}) {
  if (!ingestResult?.analysis?.chapters?.length) throw new Error('Book One Superman requires an ingested manuscript');
  const analysis = ingestResult.analysis;
  const chapterStats = buildChapterStats(analysis);
  const roster = buildSpeakerCandidateRoster(analysis, { aliases: characterAliases });
  const production = simulateProduction(analysis, { model, regenerationReserveRatio, auditionAllowanceUsd });
  const findings = findingsFor(ingestResult, chapterStats, roster);
  const counts = severityCounts(findings);
  const score = scoreFromFindings(findings);
  const status = counts.critical ? 'BLOCKED' : counts.high ? 'REVIEW' : counts.medium ? 'REVIEW' : 'PASS';
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
  const dialogue = allSegments(analysis).filter((segment) => segment.kind === 'dialogue');
  const attribution = dialogueReviewCounts(dialogue);
  const safeToBeginCasting = counts.critical === 0 && attribution.unresolved / Math.max(1, dialogue.length) <= 0.5;
  const nextFinding = findings.find((item) => ['critical', 'high'].includes(item.severity))
    ?? findings.find((item) => item.severity === 'medium')
    ?? findings.find((item) => item.severity === 'low')
    ?? findings[0] ?? null;
  const nextAction = nextFinding?.action ?? 'Review the detected character roster, then build and lock the Audio Bible.';
  const sourceSectionCount = analysis.chapters.length;
  const narrativeChapterCount = production.productionSectionCount;

  return freeze({
    schemaVersion: 2,
    release: '0.11.2',
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
      sourceSectionCount,
      narrativeChapterCount,
      excludedProductionSections: production.excludedSections,
      estimatedFinishedHours: estimatedHours,
      dialogueCharacterRatio: round(dialogueRatio, 3),
      chapterStats
    }),
    speakerAttribution: freeze({
      totalDialogueSegments: dialogue.length,
      highConfidence: attribution.highConfidence,
      inferredNeedsReview: attribution.inferredReview,
      unresolved: attribution.unresolved,
      highConfidencePct: dialogue.length ? round((attribution.highConfidence / dialogue.length) * 100, 1) : 100,
      reviewPct: dialogue.length ? round((attribution.inferredReview / dialogue.length) * 100, 1) : 0,
      unresolvedPct: dialogue.length ? round((attribution.unresolved / dialogue.length) * 100, 1) : 0
    }),
    characterDiscovery: freeze({
      candidateCount: roster.length,
      candidates: roster,
      aliasesApplied: freeze({ ...characterAliases }),
      note: 'Candidates are parser evidence only; aliases affect roster grouping, never canonical manuscript text.'
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
    `- Narrative chapters: ${report.manuscript.narrativeChapterCount}`,
    `- Source sections detected: ${report.manuscript.sourceSectionCount}`,
    `- Print-only/front-matter sections excluded from cost rehearsal: ${report.production.excludedSectionCount}`,
    `- Scenes: ${report.manuscript.metrics.scenes}`,
    `- Segments: ${report.manuscript.metrics.segments}`,
    `- Estimated finished runtime: ${report.manuscript.estimatedFinishedHours} hours`,
    `- Possible speaking characters after alias cleanup: ${report.characterDiscovery.candidateCount}`,
    '',
    '## Dialogue attribution',
    '',
    `- High-confidence: ${report.speakerAttribution.highConfidence.toLocaleString()} (${report.speakerAttribution.highConfidencePct}%)`,
    `- Contextually inferred / human review: ${report.speakerAttribution.inferredNeedsReview.toLocaleString()} (${report.speakerAttribution.reviewPct}%)`,
    `- Still unresolved: ${report.speakerAttribution.unresolved.toLocaleString()} (${report.speakerAttribution.unresolvedPct}%)`,
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
  lines.push('', '## Candidate character roster', '', '| Candidate | Mentions | Avg confidence | Observed as |', '| --- | ---: | ---: | --- |');
  for (const candidate of report.characterDiscovery.candidates.slice(0, 50)) {
    lines.push(`| ${candidate.name.replace(/\|/g, '\\|')} | ${candidate.mentions} | ${candidate.averageConfidence} | ${candidate.observedAs.join(', ').replace(/\|/g, '\\|')} |`);
  }
  lines.push('', '## Chapter stress table', '', '| # | Section | Role | Words | Scenes | Segments | Dialogue needing review |', '| ---: | --- | --- | ---: | ---: | ---: | ---: |');
  for (const chapter of report.manuscript.chapterStats) {
    lines.push(`| ${chapter.order + 1} | ${String(chapter.title).replace(/\|/g, '\\|')} | ${chapter.role} | ${chapter.words} | ${chapter.scenes} | ${chapter.segments} | ${chapter.dialogueNeedingReview} |`);
  }
  lines.push('', '## Next action', '', report.nextAction, '', '> This report never performs paid voice generation. It is a pre-production stress test, not approval to spend.', '');
  return lines.join('\n');
}

export function buildSyntheticBookOneFixture({ chapters = 42, paragraphsPerChapter = 40 } = {}) {
  const names = ['Michael', 'Juan', 'Christopher', 'Elena'];
  const filler = 'The evening carried on with the kind of ordinary detail that makes a relationship feel lived in, complicated, warm, and impossible to reduce to one simple answer.';
  const output = ['Synthetic Book One Superman Fixture', '', 'by YasReady Test Author', '', 'Copyright © 2026 YasReady', '', 'Table of Contents', '', 'Chapter 1', ''];
  for (let chapter = 1; chapter <= chapters; chapter += 1) {
    if (chapter > 1) output.push(`Chapter ${chapter}`, '');
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
