import { BOOK_ONE_PROFILE, buildBookOneSupermanReport } from './book-one-superman.js';

const freeze = (value) => Object.freeze(value);
const round = (value, digits = 2) => Number(Number(value).toFixed(digits));

export const EXTERNAL_BOOK_SUPERMAN_RELEASE = '0.14.0';
export const EXTERNAL_BOOK_SUPERMAN_SCHEMA_VERSION = 1;

export const PRIOR_BOOK_ONE_TRUTH = freeze([
  BOOK_ONE_PROFILE.title,
  ...Object.keys(BOOK_ONE_PROFILE.aliases ?? {}),
  ...Object.values(BOOK_ONE_PROFILE.aliases ?? {}).flat()
].filter(Boolean));

function normalize(value) {
  return String(value ?? '').normalize('NFKC').toLocaleLowerCase('en-US');
}

function manuscriptText(analysis) {
  return (analysis?.chapters ?? [])
    .flatMap((chapter) => chapter.scenes ?? [])
    .flatMap((scene) => scene.segments ?? [])
    .map((segment) => String(segment.text ?? ''))
    .join('\n');
}

function reportTruthText(report) {
  const candidates = report?.characterDiscovery?.candidates ?? [];
  return [
    report?.manuscript?.title,
    report?.manuscript?.author,
    ...candidates.flatMap((candidate) => [candidate.name, ...(candidate.observedAs ?? [])])
  ].filter(Boolean).join('\n');
}

export function detectPriorTruthLeaks(ingestResult, report, { priorTruth = PRIOR_BOOK_ONE_TRUTH } = {}) {
  const source = normalize(manuscriptText(ingestResult?.analysis));
  const visible = normalize(reportTruthText(report));
  const leaks = [];
  for (const term of [...new Set(priorTruth.map(String))]) {
    const needle = normalize(term).trim();
    if (!needle) continue;
    if (!source.includes(needle) && visible.includes(needle)) leaks.push(term);
  }
  return freeze(leaks.sort((a, b) => String(a).localeCompare(String(b))));
}

function counts(findings) {
  const result = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const item of findings) result[item.severity] = (result[item.severity] ?? 0) + 1;
  return freeze(result);
}

function score(findings, baseScore) {
  const externalPenalty = findings.reduce((sum, item) => sum + ({ critical: 40, high: 15, medium: 5, low: 2, info: 0 })[item.severity], 0);
  return Math.max(0, Math.min(100, Number(baseScore ?? 100) - externalPenalty));
}

function externalFinding(severity, code, stage, message, action = null) {
  return freeze({ severity, code, stage, message, action, source: 'external-book-superman' });
}

export function buildExternalBookSupermanReport(ingestResult, {
  model = 'eleven_multilingual_v2',
  apiKeyPresent = false,
  ffmpegHealth = { ok: false, reason: 'not checked' },
  nodeVersion = process.versions.node,
  regenerationReserveRatio = 0.25,
  auditionAllowanceUsd = 5,
  baselineSourceHash = null,
  stackProbe = null,
  label = 'External Book Superman'
} = {}) {
  if (!ingestResult?.analysis?.chapters?.length) throw new Error('External Book Superman requires an ingested manuscript');

  // Deliberately disable the Book One alias profile. The external book must stand on its own evidence.
  const base = buildBookOneSupermanReport(ingestResult, {
    model,
    apiKeyPresent,
    ffmpegHealth,
    nodeVersion,
    regenerationReserveRatio,
    auditionAllowanceUsd,
    label,
    characterAliases: {}
  });

  const externalFindings = [];
  const priorTruthLeaks = detectPriorTruthLeaks(ingestResult, base);
  const sourceHash = ingestResult.analysis.source?.sourceHash ?? null;
  const aliasesApplied = base.characterDiscovery?.aliasesApplied ?? {};
  const sameAsBaseline = baselineSourceHash ? sourceHash === baselineSourceHash : null;

  if (Object.keys(aliasesApplied).length) {
    externalFindings.push(externalFinding(
      'critical', 'book-one-alias-profile-active', 'generalization',
      'External Book Superman detected a non-empty prior-book alias profile.',
      'Run the external manuscript with a clean alias/continuity context.'
    ));
  }
  if (priorTruthLeaks.length) {
    externalFindings.push(externalFinding(
      'critical', 'prior-book-truth-leak', 'generalization',
      `${priorTruthLeaks.length} Book One truth value(s) appeared in external-book output without source evidence.`,
      'Stop and remove cross-book/profile contamination before production.'
    ));
  }
  if (sameAsBaseline === true) {
    externalFindings.push(externalFinding(
      'critical', 'external-source-matches-baseline', 'generalization',
      'The supplied manuscript source hash matches the baseline book hash, so this is not a true external-book test.',
      'Use an unrelated manuscript or omit the baseline comparison only when intentionally testing without one.'
    ));
  }
  if (stackProbe?.status === 'BLOCKED') {
    externalFindings.push(externalFinding(
      'critical', 'zero-spend-stack-probe-failed', 'full-stack',
      stackProbe.error ?? 'The zero-spend downstream wiring probe failed.',
      'Fix the first failing stack stage before treating External Book Superman as passed.'
    ));
  }
  if (Number(stackProbe?.providerCallsPerformed ?? 0) !== 0) {
    externalFindings.push(externalFinding(
      'critical', 'external-probe-spent-provider-call', 'money-guard',
      'External Book Superman recorded a provider generation/QA call during its zero-spend probe.',
      'External Superman must remain zero-spend.'
    ));
  }

  const allFindings = freeze([...base.findings, ...externalFindings]);
  const findingCounts = counts(allFindings);
  const finalScore = score(externalFindings, base.score);
  const status = findingCounts.critical ? 'BLOCKED' : (findingCounts.high || findingCounts.medium) ? 'REVIEW' : 'PASS';
  const externalSourceConfirmed = baselineSourceHash ? sameAsBaseline === false : 'not-compared';
  const stackReady = stackProbe ? stackProbe.status === 'PASS' : false;

  return freeze({
    schemaVersion: EXTERNAL_BOOK_SUPERMAN_SCHEMA_VERSION,
    release: EXTERNAL_BOOK_SUPERMAN_RELEASE,
    engineRelease: base.release,
    mode: 'external-book',
    label,
    status,
    score: finalScore,
    providerCallsPerformed: Number(base.providerCallsPerformed ?? 0) + Number(stackProbe?.providerCallsPerformed ?? 0),
    manuscript: base.manuscript,
    speakerAttribution: base.speakerAttribution,
    characterDiscovery: freeze({
      ...base.characterDiscovery,
      aliasesApplied: freeze({}),
      priorBookProfileDisabled: true,
      note: 'External Book Superman uses only manuscript-derived speaker evidence. Book One aliases are intentionally disabled.'
    }),
    production: base.production,
    environment: base.environment,
    generalization: freeze({
      baselineSourceHashProvided: Boolean(baselineSourceHash),
      sourceHashDistinctFromBaseline: externalSourceConfirmed,
      priorBookProfileDisabled: true,
      priorTruthLeakCount: priorTruthLeaks.length,
      priorTruthLeaks,
      externalIdentityPass: priorTruthLeaks.length === 0 && Object.keys(aliasesApplied).length === 0,
      contaminationPolicy: 'fail-closed'
    }),
    stackProbe: stackProbe ?? freeze({ status: 'NOT_RUN', providerCallsPerformed: 0 }),
    findings: allFindings,
    findingCounts,
    gates: freeze({
      manuscriptIntake: base.gates?.manuscriptIntake ?? 'blocked',
      safeToBeginCasting: Boolean(base.gates?.safeToBeginCasting),
      infrastructureReady: Boolean(base.gates?.infrastructureReady),
      priorBookTruthIsolation: priorTruthLeaks.length === 0 && Object.keys(aliasesApplied).length === 0,
      externalSourceConfirmed,
      zeroSpendStackProbe: stackReady,
      providerCredentialPresent: Boolean(base.gates?.providerCredentialPresent),
      paidGenerationArmed: false,
      paidGenerationReason: 'External Book Superman is a zero-spend rehearsal. It performs cost estimation and synthetic downstream wiring only.'
    }),
    nextAction: externalFindings[0]?.action ?? base.nextAction,
    generatedAt: new Date().toISOString()
  });
}

export function renderExternalSupermanMarkdown(report) {
  const money = (value) => value == null ? 'unavailable' : `$${Number(value).toFixed(2)}`;
  const lines = [
    `# ${report.label}`,
    '',
    `**Release:** ${report.release}`,
    `**Status:** ${report.status}`,
    `**Readiness score:** ${report.score}/100`,
    `**Provider generation/QA calls performed:** ${report.providerCallsPerformed}`,
    '',
    '## External-book identity gate',
    '',
    `- Prior Book One alias profile disabled: ${report.generalization.priorBookProfileDisabled ? 'PASS' : 'BLOCKED'}`,
    `- Prior-book truth leaks: ${report.generalization.priorTruthLeakCount}`,
    `- Baseline hash supplied: ${report.generalization.baselineSourceHashProvided ? 'YES' : 'NO'}`,
    `- External source distinct from baseline: ${report.generalization.sourceHashDistinctFromBaseline === 'not-compared' ? 'NOT COMPARED' : report.generalization.sourceHashDistinctFromBaseline ? 'PASS' : 'BLOCKED'}`,
    '',
    '## Manuscript',
    '',
    `- Title: ${report.manuscript.title ?? 'Not supplied'}`,
    `- Author: ${report.manuscript.author ?? 'Not supplied'}`,
    `- Format: ${report.manuscript.format}`,
    `- Words: ${Number(report.manuscript.metrics.words).toLocaleString()}`,
    `- Narrative chapters: ${report.manuscript.narrativeChapterCount}`,
    `- Scenes: ${report.manuscript.metrics.scenes}`,
    `- Segments: ${report.manuscript.metrics.segments}`,
    `- Candidate speakers: ${report.characterDiscovery.candidateCount}`,
    '',
    '## Dialogue attribution',
    '',
    `- High-confidence: ${report.speakerAttribution.highConfidence.toLocaleString()} (${report.speakerAttribution.highConfidencePct}%)`,
    `- Human review: ${report.speakerAttribution.inferredNeedsReview.toLocaleString()} (${report.speakerAttribution.reviewPct}%)`,
    `- Unresolved: ${report.speakerAttribution.unresolved.toLocaleString()} (${report.speakerAttribution.unresolvedPct}%)`,
    '',
    '## Production rehearsal — ZERO SPEND',
    '',
    `- Model: ${report.production.model}`,
    `- Estimated render jobs/chunks: ${report.production.renderJobEstimate.toLocaleString()}`,
    `- Estimated initial TTS: ${money(report.production.initialTtsUsd)}`,
    `- Regeneration reserve: ${money(report.production.regenerationReserveUsd)}`,
    `- Suggested production envelope: ${money(report.production.recommendedProductionBudgetUsd)}`,
    '',
    '## Full-stack zero-spend wiring probe',
    '',
    `- Overall: ${report.stackProbe.status}`,
    `- Synthetic asset references only: ${report.stackProbe.syntheticAssetReferences ? 'YES' : 'NO'}`,
    `- Provider generation/QA calls: ${report.stackProbe.providerCallsPerformed ?? 0}`,
    `- Cost-estimate calls: ${report.stackProbe.estimateCalls ?? 0}`
  ];
  for (const stage of report.stackProbe.stages ?? []) {
    lines.push(`- ${stage.stage}: ${stage.status}${stage.detail ? ` — ${stage.detail}` : ''}`);
  }
  lines.push('', '## Findings', '');
  if (!report.findings.length) lines.push('No structural findings.');
  for (const item of report.findings) {
    lines.push(`- **${String(item.severity).toUpperCase()} — ${item.code}:** ${item.message}${item.action ? ` Next: ${item.action}` : ''}`);
  }
  lines.push('', '## Candidate speaker roster', '', '| Candidate | Mentions | Avg confidence |', '| --- | ---: | ---: |');
  for (const candidate of report.characterDiscovery.candidates.slice(0, 50)) {
    lines.push(`| ${String(candidate.name).replace(/\|/g, '\\|')} | ${candidate.mentions} | ${candidate.averageConfidence} |`);
  }
  lines.push('', '## Next action', '', report.nextAction, '', '> External Book Superman never performs paid voice generation, alignment, transcription, mastering, or package export. Downstream stages use synthetic references strictly to validate wiring and ownership boundaries.', '');
  return lines.join('\n');
}

export function buildSyntheticExternalBookFixture({ chapters = 18, paragraphsPerChapter = 24 } = {}) {
  const speakers = ['Avery Chen', 'Mateo Silva', 'Priya Shah', 'Nia Okafor', 'Theo Brooks'];
  const filler = 'Rain ticked against the harbor windows while the crew compared maps, old promises, and the practical cost of getting home before the next storm.';
  const out = [
    'The Glass Harbor', '',
    'by Jordan Vale', '',
    'Copyright © 2026 Jordan Vale', '',
    'Chapter 1: Low Tide', ''
  ];
  for (let chapter = 1; chapter <= chapters; chapter += 1) {
    if (chapter > 1) out.push(`Chapter ${chapter}: Harbor Marker ${chapter}`, '');
    for (let p = 0; p < paragraphsPerChapter; p += 1) {
      const speaker = speakers[(chapter + p) % speakers.length];
      const next = speakers[(chapter + p + 1) % speakers.length];
      if (p % 3 === 0) out.push(`${speaker} said, “The external-book fixture is testing chapter ${chapter}, exchange ${p + 1}, without any prior-series character truth.”`);
      else if (p % 3 === 1) out.push(`“We should check the north pier first,” ${speaker} replied.`);
      else out.push(`${next} looked toward ${speaker}. “Then we move before sunrise.”`);
      out.push(`${filler} External marker ${chapter}.${p + 1}.`);
      if (p > 0 && p % 6 === 0) out.push('', '* * *', '');
      else out.push('');
    }
  }
  return out.join('\n');
}
