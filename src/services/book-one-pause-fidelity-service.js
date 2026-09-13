import { YASREADY_AUDIOBOOKS_VERSION } from '../release.js';
import { sha256, stableJson } from '../core/hash.js';

export const BOOK_ONE_PAUSE_FIDELITY_POLICY = Object.freeze({
  headingToBodyMinMs: 900,
  sceneBoundaryMinMs: 850,
  explicitBlankParagraphMinMs: 650,
  styledParagraphSpacingMinMs: 320,
  ordinaryParagraphMinMs: 180,
  styledSpacingThresholdTwips: 120,
  policy: 'minimum-total-boundary-silence-floor-not-blind-additive-padding'
});

const freeze = (value) => {
  if (Array.isArray(value)) { for (const child of value) freeze(child); return Object.freeze(value); }
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); return Object.freeze(value); }
  return value;
};
const clean = (value) => String(value ?? '').trim();

function planCore(value) {
  return {
    schemaVersion: value.schemaVersion,
    release: value.release,
    artifact: value.artifact,
    status: value.status,
    book: value.book,
    source: value.source,
    policy: value.policy,
    reviewEvidence: value.reviewEvidence,
    summary: value.summary,
    chapters: value.chapters,
    repairAssessment: value.repairAssessment,
    guardrails: value.guardrails
  };
}

function reviewSummary(decisions) {
  if (!decisions) return freeze({
    present: false,
    heardAllTen: false,
    overallDecision: null,
    chapterCounts: freeze({ pass: 0, maybe: 0, fail: 0, unreviewed: 10 }),
    chaptersWithNotes: 0
  });
  if (decisions.artifact !== 'book-one-cinematic-human-review-decisions') {
    throw new Error('Pause Fidelity review evidence artifact is invalid');
  }
  const rows = decisions.chapters ?? [];
  const count = (value) => rows.filter((row) => row.decision === value).length;
  return freeze({
    present: true,
    heardAllTen: decisions.heardAllTen === true,
    overallDecision: decisions.overallDecision ?? null,
    chapterCounts: freeze({
      pass: count('PASS'),
      maybe: count('MAYBE'),
      fail: count('FAIL'),
      unreviewed: count('UNREVIEWED')
    }),
    chaptersWithNotes: rows.filter((row) => clean(row.notes)).length,
    reviewSessionDigest: decisions.source?.reviewSessionDigest ?? null,
    cinematicResultDigest: decisions.source?.cinematicResultDigest ?? null,
    cinematicLockDigest: decisions.source?.cinematicLockDigest ?? null,
    recipeFingerprint: decisions.source?.recipeFingerprint ?? null
  });
}

function paragraphRows(extractedManuscript) {
  const text = String(extractedManuscript?.text ?? '');
  const paragraphs = text.split(/\n\s*\n+/).map((value) => value.trim()).filter(Boolean);
  const layout = extractedManuscript?.paragraphLayout ?? [];
  if (!layout.length) {
    return paragraphs.map((value, index) => freeze({
      nonEmptyParagraphOrdinal: index,
      sourceParagraphOrdinal: index,
      textHash: sha256(value),
      blankParagraphsBefore: 0,
      spacingBeforeTwips: 0,
      spacingAfterTwips: 0,
      style: null,
      value
    }));
  }
  if (layout.length !== paragraphs.length) {
    throw new Error(`Pause Fidelity paragraph layout mismatch: extracted ${paragraphs.length}, layout ${layout.length}`);
  }
  return paragraphs.map((value, index) => {
    const row = layout[index];
    const textHash = sha256(value);
    if (row.textHash && row.textHash !== textHash) {
      throw new Error(`Pause Fidelity paragraph hash drift at paragraph ${index + 1}`);
    }
    return freeze({
      nonEmptyParagraphOrdinal: Number(row.nonEmptyParagraphOrdinal ?? index),
      sourceParagraphOrdinal: Number(row.sourceParagraphOrdinal ?? index),
      textHash,
      blankParagraphsBefore: Number(row.blankParagraphsBefore ?? 0),
      spacingBeforeTwips: Number(row.spacingBeforeTwips ?? 0),
      spacingAfterTwips: Number(row.spacingAfterTwips ?? 0),
      style: row.style ?? null,
      value
    });
  });
}

function chapterRowsFromLayout({ extractedManuscript, manuscriptAnalysis, policy }) {
  const rows = paragraphRows(extractedManuscript);
  const titleMap = new Map(
    (manuscriptAnalysis.chapters ?? []).map((chapter) => [clean(chapter.title), Number(chapter.order)])
  );
  const chapters = new Map();
  for (const chapter of manuscriptAnalysis.chapters ?? []) {
    chapters.set(Number(chapter.order), {
      order: Number(chapter.order),
      chapterNumber: Number(chapter.order) + 1,
      title: chapter.title,
      paragraphCount: 0,
      boundaries: []
    });
  }

  let currentOrder = null;
  let previousSpoken = null;
  let pendingSceneBreak = false;

  for (const row of rows) {
    const value = clean(row.value);
    if (titleMap.has(value)) {
      currentOrder = titleMap.get(value);
      previousSpoken = freeze({
        kind: 'heading',
        paragraphOrdinal: row.nonEmptyParagraphOrdinal,
        sourceParagraphOrdinal: row.sourceParagraphOrdinal,
        textHash: row.textHash,
        spacingAfterTwips: row.spacingAfterTwips
      });
      pendingSceneBreak = false;
      continue;
    }

    if (currentOrder === null || !chapters.has(currentOrder)) continue;
    if (/^(?:\*\s*\*\s*\*|#|#{3,}|[-–—]\s*[-–—]\s*[-–—]|•\s*•\s*•)$/.test(value)) {
      pendingSceneBreak = true;
      continue;
    }

    const chapter = chapters.get(currentOrder);
    const bodyParagraphIndex = chapter.paragraphCount++;
    let boundaryKind = null;
    let minimumSilenceMs = 0;
    let repairMode = null;
    const effectiveStyledSpacingTwips = Math.max(
      Number(row.spacingBeforeTwips ?? 0),
      Number(previousSpoken?.spacingAfterTwips ?? 0)
    );

    if (previousSpoken?.kind === 'heading') {
      boundaryKind = 'HEADING_TO_BODY';
      minimumSilenceMs = policy.headingToBodyMinMs;
      repairMode = 'LOCAL_ASSEMBLY_REPAIR_CANDIDATE';
    } else if (previousSpoken) {
      if (pendingSceneBreak) {
        boundaryKind = 'SCENE_BOUNDARY';
        minimumSilenceMs = policy.sceneBoundaryMinMs;
        repairMode = 'LOCAL_ASSEMBLY_REPAIR_CANDIDATE';
      } else if (Number(row.blankParagraphsBefore ?? 0) > 0) {
        boundaryKind = 'EXPLICIT_BLANK_PARAGRAPH';
        minimumSilenceMs = policy.explicitBlankParagraphMinMs;
        repairMode = 'NEEDS_BOUNDARY_LOCALIZATION';
      } else if (effectiveStyledSpacingTwips >= policy.styledSpacingThresholdTwips) {
        boundaryKind = 'STYLED_PARAGRAPH_SPACING';
        minimumSilenceMs = policy.styledParagraphSpacingMinMs;
        repairMode = 'NEEDS_BOUNDARY_LOCALIZATION';
      } else {
        boundaryKind = 'ORDINARY_PARAGRAPH';
        minimumSilenceMs = policy.ordinaryParagraphMinMs;
        repairMode = 'NEEDS_BOUNDARY_LOCALIZATION';
      }
    }

    if (boundaryKind) {
      chapter.boundaries.push(freeze({
        boundaryOrdinal: chapter.boundaries.length,
        chapterNumber: chapter.chapterNumber,
        beforeBodyParagraphIndex: Math.max(0, bodyParagraphIndex - 1),
        afterBodyParagraphIndex: bodyParagraphIndex,
        kind: boundaryKind,
        minimumTotalSilenceMs: minimumSilenceMs,
        blankParagraphsBefore: Number(row.blankParagraphsBefore ?? 0),
        effectiveStyledSpacingTwips,
        previousParagraphHash: previousSpoken?.textHash ?? null,
        nextParagraphHash: row.textHash,
        repairMode,
        additivePaddingForbidden: true
      }));
    }

    previousSpoken = freeze({
      kind: 'body',
      paragraphOrdinal: row.nonEmptyParagraphOrdinal,
      sourceParagraphOrdinal: row.sourceParagraphOrdinal,
      textHash: row.textHash,
      spacingAfterTwips: row.spacingAfterTwips
    });
    pendingSceneBreak = false;
  }

  return [...chapters.values()].map((chapter) => freeze({
    ...chapter,
    boundaries: freeze(chapter.boundaries)
  }));
}

function chapterSceneBoundarySupplement(chapters, manuscriptAnalysis, policy) {
  const byNumber = new Map(chapters.map((chapter) => [chapter.chapterNumber, {
    ...chapter,
    boundaries: [...chapter.boundaries]
  }]));
  for (const sourceChapter of manuscriptAnalysis.chapters ?? []) {
    const chapterNumber = Number(sourceChapter.order) + 1;
    const target = byNumber.get(chapterNumber);
    if (!target) continue;
    const sceneCount = (sourceChapter.scenes ?? []).length;
    for (let sceneIndex = 1; sceneIndex < sceneCount; sceneIndex += 1) {
      const already = target.boundaries.some((row) => row.kind === 'SCENE_BOUNDARY');
      if (already) continue;
      target.boundaries.push(freeze({
        boundaryOrdinal: target.boundaries.length,
        chapterNumber,
        beforeBodyParagraphIndex: null,
        afterBodyParagraphIndex: null,
        kind: 'SCENE_BOUNDARY',
        minimumTotalSilenceMs: policy.sceneBoundaryMinMs,
        blankParagraphsBefore: null,
        effectiveStyledSpacingTwips: null,
        previousParagraphHash: null,
        nextParagraphHash: null,
        repairMode: 'LOCAL_ASSEMBLY_REPAIR_CANDIDATE',
        additivePaddingForbidden: true,
        sceneIndex
      }));
    }
  }
  return [...byNumber.values()].map((chapter) => freeze({
    ...chapter,
    boundaries: freeze(chapter.boundaries.sort((a, b) => Number(a.boundaryOrdinal) - Number(b.boundaryOrdinal)))
  }));
}

export function buildBookOnePauseFidelityPlan({
  extractedManuscript,
  manuscriptAnalysis,
  productionPlan,
  cinematicResult,
  cinematicLock,
  humanReviewDecisions = null,
  policy = BOOK_ONE_PAUSE_FIDELITY_POLICY
} = {}) {
  if (!extractedManuscript?.text || !manuscriptAnalysis?.source?.sourceHash) {
    throw new Error('Pause Fidelity requires extracted and analyzed manuscript evidence');
  }
  if (!productionPlan?.integrity?.productionPlanDigest || !productionPlan?.source?.sourceHash) {
    throw new Error('Pause Fidelity requires the production plan');
  }
  if (!cinematicLock?.integrity?.lockDigest || !cinematicResult?.integrity?.resultDigest) {
    throw new Error('Pause Fidelity requires cinematic lock and result evidence');
  }
  if (cinematicLock.source?.productionPlanDigest !== productionPlan.integrity.productionPlanDigest ||
      cinematicResult.source?.productionPlanDigest !== productionPlan.integrity.productionPlanDigest) {
    throw new Error('Pause Fidelity production-plan lineage mismatch');
  }
  if (cinematicResult.cinematicLockDigest !== cinematicLock.integrity.lockDigest) {
    throw new Error('Pause Fidelity cinematic result does not belong to the cinematic lock');
  }
  if (manuscriptAnalysis.source.sourceHash !== extractedManuscript.sourceHash) {
    throw new Error('Pause Fidelity extracted/analyzed source hash mismatch');
  }

  const baseChapters = chapterRowsFromLayout({ extractedManuscript, manuscriptAnalysis, policy });
  const chapters = chapterSceneBoundarySupplement(baseChapters, manuscriptAnalysis, policy);
  const allBoundaries = chapters.flatMap((chapter) => chapter.boundaries);
  const firstTen = chapters.filter((chapter) => chapter.chapterNumber <= 10);
  const firstTenBoundaries = firstTen.flatMap((chapter) => chapter.boundaries);
  const localRepairCandidates = firstTenBoundaries.filter((row) => row.repairMode === 'LOCAL_ASSEMBLY_REPAIR_CANDIDATE').length;
  const localizationRequired = firstTenBoundaries.filter((row) => row.repairMode === 'NEEDS_BOUNDARY_LOCALIZATION').length;
  const byKind = Object.fromEntries(
    ['HEADING_TO_BODY', 'SCENE_BOUNDARY', 'EXPLICIT_BLANK_PARAGRAPH', 'STYLED_PARAGRAPH_SPACING', 'ORDINARY_PARAGRAPH']
      .map((kind) => [kind, allBoundaries.filter((row) => row.kind === kind).length])
  );

  const reviewEvidence = reviewSummary(humanReviewDecisions);
  const base = {
    schemaVersion: 1,
    release: YASREADY_AUDIOBOOKS_VERSION,
    artifact: 'book-one-pause-fidelity-plan',
    status: 'PAUSE_FIDELITY_ANALYZED_PRODUCTION_GATE_STILL_CLOSED',
    book: productionPlan.book,
    source: freeze({
      manuscriptSourceHash: productionPlan.source.sourceHash,
      currentManuscriptSourceHash: manuscriptAnalysis.source.sourceHash,
      normalizedTextHash: manuscriptAnalysis.source.normalizedTextHash ?? null,
      productionPlanDigest: productionPlan.integrity.productionPlanDigest,
      cinematicLockDigest: cinematicLock.integrity.lockDigest,
      cinematicResultDigest: cinematicResult.integrity.resultDigest,
      paragraphLayoutAvailable: Array.isArray(extractedManuscript.paragraphLayout) && extractedManuscript.paragraphLayout.length > 0
    }),
    policy: freeze({ ...policy }),
    reviewEvidence,
    summary: freeze({
      narrativeChapterCount: chapters.length,
      totalStructuralBoundaries: allBoundaries.length,
      byKind: freeze(byKind),
      firstTenStructuralBoundaries: firstTenBoundaries.length,
      firstTenLocalAssemblyRepairCandidates: localRepairCandidates,
      firstTenBoundariesNeedingLocalization: localizationRequired,
      canonicalWordsChanged: false,
      providerTtsCallsPerformed: 0,
      providerSpendUsd: 0
    }),
    chapters: freeze(chapters),
    repairAssessment: freeze({
      existingTenMayBeOverwritten: false,
      directRepairPerformed: false,
      automaticRegenerationAllowed: false,
      localAssemblyCandidateKinds: freeze(['HEADING_TO_BODY', 'SCENE_BOUNDARY']),
      localizationRequiredKinds: freeze(['EXPLICIT_BLANK_PARAGRAPH', 'STYLED_PARAGRAPH_SPACING', 'ORDINARY_PARAGRAPH']),
      policy: 'Repair only the silence deficit at a verified boundary. Never blindly add the full pause target on top of existing silence.',
      nextAction: 'Use the pause plan to localize deficient boundaries in Chapters 1-10. Prefer local FFmpeg repair when exact boundary timing is known; regenerate provider audio only if a local repair cannot preserve natural delivery.'
    }),
    guardrails: freeze({
      planningOnly: true,
      canonicalTextImmutable: true,
      canonicalWordsChanged: false,
      providerTtsCallsPerformed: 0,
      providerSpendUsd: 0,
      spendAuthorized: false,
      repairAudioWritten: false,
      existingTenChaptersMayBeOverwritten: false,
      chapterElevenMayBeGenerated: false,
      nextBatchArmed: false,
      fullBookGenerationArmed: false
    })
  };
  return freeze({ ...base, integrity: freeze({ pausePlanDigest: sha256(stableJson(planCore(base))) }) });
}

export function verifyBookOnePauseFidelityPlan(plan) {
  if (!plan || plan.artifact !== 'book-one-pause-fidelity-plan') throw new Error('Invalid Book One pause fidelity plan');
  if (plan.status !== 'PAUSE_FIDELITY_ANALYZED_PRODUCTION_GATE_STILL_CLOSED') throw new Error('Pause Fidelity plan status drifted');
  if (plan.summary?.canonicalWordsChanged !== false ||
      plan.guardrails?.canonicalTextImmutable !== true ||
      plan.guardrails?.providerTtsCallsPerformed !== 0 ||
      plan.guardrails?.providerSpendUsd !== 0 ||
      plan.guardrails?.spendAuthorized !== false ||
      plan.guardrails?.repairAudioWritten !== false ||
      plan.guardrails?.chapterElevenMayBeGenerated !== false ||
      plan.guardrails?.nextBatchArmed !== false ||
      plan.guardrails?.fullBookGenerationArmed !== false) {
    throw new Error('Pause Fidelity guardrails drifted open');
  }
  if (!plan.integrity?.pausePlanDigest ||
      sha256(stableJson(planCore(plan))) !== plan.integrity.pausePlanDigest) {
    throw new Error('Pause Fidelity plan digest mismatch');
  }
  return true;
}

export function renderBookOnePauseFidelityMarkdown(plan) {
  verifyBookOnePauseFidelityPlan(plan);
  const lines = [
    '# Book One — Pause Fidelity Plan',
    '',
    `**Release:** ${plan.release}`,
    `**Status:** ${plan.status}`,
    '**Provider TTS calls:** 0',
    '**Provider spend:** $0.00',
    '**Existing Chapters 1–10 overwritten:** NO',
    '**Chapter 11 generation:** OFF',
    '',
    '## Pause policy',
    '',
    `- Chapter title → body minimum total silence: **${plan.policy.headingToBodyMinMs} ms**`,
    `- Scene boundary minimum total silence: **${plan.policy.sceneBoundaryMinMs} ms**`,
    `- Explicit blank-paragraph minimum total silence: **${plan.policy.explicitBlankParagraphMinMs} ms**`,
    `- Styled paragraph-spacing minimum total silence: **${plan.policy.styledParagraphSpacingMinMs} ms**`,
    `- Ordinary paragraph minimum total silence: **${plan.policy.ordinaryParagraphMinMs} ms**`,
    '',
    '> These are minimum total boundary-silence floors. YasReady must measure existing silence and insert only the deficit; it must not blindly add the full target.',
    '',
    '## First ten repair assessment',
    '',
    `- Structural boundaries: **${plan.summary.firstTenStructuralBoundaries}**`,
    `- Local assembly repair candidates: **${plan.summary.firstTenLocalAssemblyRepairCandidates}**`,
    `- Boundaries needing exact localization first: **${plan.summary.firstTenBoundariesNeedingLocalization}**`,
    '',
    '## Human review evidence',
    '',
    `- Review present: **${plan.reviewEvidence.present ? 'YES' : 'NO'}**`,
    `- Heard all ten: **${plan.reviewEvidence.heardAllTen ? 'YES' : 'NO'}**`,
    `- PASS: **${plan.reviewEvidence.chapterCounts.pass}** · MAYBE: **${plan.reviewEvidence.chapterCounts.maybe}** · NEEDS CHANGES: **${plan.reviewEvidence.chapterCounts.fail}** · Unreviewed: **${plan.reviewEvidence.chapterCounts.unreviewed}**`,
    `- Chapters with notes: **${plan.reviewEvidence.chaptersWithNotes}**`,
    '',
    '## Safety',
    '',
    'No audio is repaired by this planning step. No provider generation is available. Chapters 1–10 remain preserved and Chapter 11 remains blocked.',
    ''
  ];
  return lines.join('\n');
}

export function renderBookOnePauseFidelityHtml(plan) {
  verifyBookOnePauseFidelityPlan(plan);
  const cards = plan.chapters.slice(0, 10).map((chapter) => {
    const counts = {};
    for (const row of chapter.boundaries) counts[row.kind] = (counts[row.kind] ?? 0) + 1;
    const detail = Object.entries(counts).map(([key, value]) => `${key.replaceAll('_', ' ')}: ${value}`).join(' · ') || 'No structural boundaries found';
    return `<article class="chapter"><div class="num">${chapter.chapterNumber}</div><div><h3>Chapter ${chapter.chapterNumber}</h3><p>${chapter.boundaries.length} pause boundary target(s)</p><span>${escapeHtml(detail)}</span></div></article>`;
  }).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Book One Pause Fidelity</title><style>
  :root{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text",Inter,system-ui,sans-serif;background:#f5f5f7;color:#111}*{box-sizing:border-box}body{margin:0;padding:28px}.wrap{max-width:1000px;margin:auto}.hero,.panel{background:#fff;border:1px solid #e5e5ea;border-radius:26px;box-shadow:0 12px 36px rgba(0,0,0,.06)}.hero{padding:32px}.panel{padding:22px;margin-top:18px}h1{font-size:38px;letter-spacing:-.04em;margin:4px 0 8px}.muted{color:#6e6e73}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:20px}.stat{background:#f5f5f7;padding:15px;border-radius:18px}.stat strong{display:block;font-size:24px}.gate{margin-top:18px;background:#fff3cd;border-radius:18px;padding:16px}.chapter{display:flex;gap:15px;padding:15px 0;border-bottom:1px solid #eee}.num{width:38px;height:38px;border-radius:12px;display:grid;place-items:center;font-weight:800;background:#eef4ff}.chapter h3{margin:0}.chapter p{margin:4px 0;font-size:13px;font-weight:700}.chapter span{color:#6e6e73;font-size:12px}@media(max-width:700px){body{padding:14px}.stats{grid-template-columns:1fr 1fr}}
  </style></head><body><main class="wrap"><section class="hero"><div class="muted">YasReady Audiobooks ${escapeHtml(plan.release)}</div><h1>Pause Fidelity</h1><p class="muted">Human listening found a repeatable missing-breath pattern. This plan preserves manuscript structure as audio timing requirements without changing a single canonical word.</p><div class="stats"><div class="stat"><strong>${plan.summary.firstTenStructuralBoundaries}</strong><span>first-10 boundaries</span></div><div class="stat"><strong>${plan.summary.firstTenLocalAssemblyRepairCandidates}</strong><span>local candidates</span></div><div class="stat"><strong>${plan.summary.firstTenBoundariesNeedingLocalization}</strong><span>need localization</span></div><div class="stat"><strong>$0.00</strong><span>provider spend</span></div></div><div class="gate"><strong>Human gate CLOSED.</strong> Existing audio preserved · No repair written · Chapter 11 OFF.</div></section><section class="panel"><h2>Chapters 1–10</h2>${cards}</section></main></body></html>`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
