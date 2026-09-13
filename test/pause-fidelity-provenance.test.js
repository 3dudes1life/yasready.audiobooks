import test from 'node:test';
import assert from 'node:assert/strict';
import {
  YASREADY_AUDIOBOOKS_VERSION,
  sha256,
  buildBookOnePauseFidelityPlan,
  verifyBookOnePauseFidelityPlan
} from '../src/index.js';

function fixture() {
  const paragraphs = [
    'Chapter 1',
    'First paragraph.',
    'Second paragraph.',
    '***',
    'Third paragraph.',
    'Chapter 2',
    'Opening paragraph.',
    'Another paragraph.'
  ];
  const text = paragraphs.join('\n\n');
  const sourceHash = 'fixture-source-hash';
  const normalizedTextHash = sha256(text);
  const paragraphLayout = paragraphs.map((value, index) => ({
    nonEmptyParagraphOrdinal: index,
    sourceParagraphOrdinal: index + (index >= 2 ? 1 : 0),
    textHash: sha256(value),
    blankParagraphsBefore: index === 2 ? 1 : 0,
    spacingBeforeTwips: 0,
    spacingAfterTwips: index === 6 ? 180 : 0,
    style: /^Chapter/.test(value) ? 'Heading1' : 'Body'
  }));

  const manuscriptAnalysis = {
    schemaVersion: 3,
    source: {
      format: 'docx',
      filename: 'book.docx',
      sourceHash,
      normalizedTextHash
    },
    metadata: { title: 'Fixture', author: 'Author' },
    metrics: { chapters: 2, scenes: 3, words: 20 },
    chapters: [
      {
        order: 0,
        title: 'Chapter 1',
        textHash: sha256('First paragraph.\n\nSecond paragraph.\n\n***\n\nThird paragraph.'),
        scenes: [
          { order: 0, segments: [{ paragraphIndex: 0, kind: 'narration', text: 'First paragraph.' }, { paragraphIndex: 1, kind: 'narration', text: 'Second paragraph.' }] },
          { order: 1, segments: [{ paragraphIndex: 0, kind: 'narration', text: 'Third paragraph.' }] }
        ]
      },
      {
        order: 1,
        title: 'Chapter 2',
        textHash: sha256('Opening paragraph.\n\nAnother paragraph.'),
        scenes: [
          { order: 0, segments: [{ paragraphIndex: 0, kind: 'narration', text: 'Opening paragraph.' }, { paragraphIndex: 1, kind: 'narration', text: 'Another paragraph.' }] }
        ]
      }
    ]
  };

  const extractedManuscript = {
    format: 'docx',
    filename: 'book.docx',
    text,
    sourceHash,
    paragraphLayout
  };

  const productionPlan = {
    book: { id: 'book-one', title: 'Fixture', author: 'Author' },
    source: { sourceHash, normalizedTextHash },
    manifest: {
      chapters: manuscriptAnalysis.chapters.map((chapter) => ({
        order: chapter.order,
        title: chapter.title,
        sourceTextHash: chapter.textHash
      }))
    },
    integrity: { productionPlanDigest: 'plan-digest' }
  };
  const cinematicLock = {
    source: { productionPlanDigest: 'plan-digest', manuscriptSourceHash: sourceHash },
    integrity: { lockDigest: 'lock-digest' }
  };
  const cinematicResult = {
    source: { productionPlanDigest: 'plan-digest' },
    cinematicLockDigest: 'lock-digest',
    integrity: { resultDigest: 'result-digest' }
  };
  const humanReviewDecisions = {
    schemaVersion: 1,
    artifact: 'book-one-cinematic-human-review-decisions',
    source: {
      reviewSessionDigest: 'review',
      cinematicResultDigest: 'result-digest',
      cinematicLockDigest: 'lock-digest',
      recipeFingerprint: 'recipe'
    },
    heardAllTen: false,
    overallDecision: null,
    chapters: [
      { chapterNumber: 1, decision: 'PASS', notes: 'Small missing pause.' },
      { chapterNumber: 2, decision: 'MAYBE', notes: '' },
      ...Array.from({ length: 8 }, (_, index) => ({ chapterNumber: index + 3, decision: 'UNREVIEWED', notes: '' }))
    ]
  };

  return { extractedManuscript, manuscriptAnalysis, productionPlan, cinematicLock, cinematicResult, humanReviewDecisions };
}

test('0.14.3.20.3 is current application provenance', () => {
  assert.equal(YASREADY_AUDIOBOOKS_VERSION, '0.14.3.20.3');
});

test('Pause Fidelity creates minimum silence floors without changing canonical words or spending', () => {
  const f = fixture();
  const plan = buildBookOnePauseFidelityPlan(f);

  assert.equal(verifyBookOnePauseFidelityPlan(plan), true);
  assert.equal(plan.status, 'PAUSE_FIDELITY_ANALYZED_PRODUCTION_GATE_STILL_CLOSED');
  assert.equal(plan.summary.canonicalWordsChanged, false);
  assert.equal(plan.summary.providerTtsCallsPerformed, 0);
  assert.equal(plan.summary.providerSpendUsd, 0);
  assert.equal(plan.guardrails.repairAudioWritten, false);
  assert.equal(plan.guardrails.chapterElevenMayBeGenerated, false);

  const kinds = plan.chapters.flatMap((chapter) => chapter.boundaries.map((row) => row.kind));
  assert.ok(kinds.includes('HEADING_TO_BODY'));
  assert.ok(kinds.includes('EXPLICIT_BLANK_PARAGRAPH'));
  assert.ok(kinds.includes('SCENE_BOUNDARY'));
  assert.ok(kinds.includes('STYLED_PARAGRAPH_SPACING'));
  assert.ok(plan.chapters.flatMap((chapter) => chapter.boundaries).every((row) => row.additivePaddingForbidden === true));
});

test('Pause Fidelity preserves human review as evidence but does not turn notes into an approval', () => {
  const f = fixture();
  const plan = buildBookOnePauseFidelityPlan(f);
  assert.equal(plan.reviewEvidence.present, true);
  assert.equal(plan.reviewEvidence.heardAllTen, false);
  assert.equal(plan.reviewEvidence.overallDecision, null);
  assert.equal(plan.reviewEvidence.chapterCounts.pass, 1);
  assert.equal(plan.reviewEvidence.chapterCounts.maybe, 1);
  assert.equal(plan.reviewEvidence.chapterCounts.unreviewed, 8);
  assert.equal(plan.guardrails.spendAuthorized, false);
});

test('Pause Fidelity distinguishes local assembly candidates from boundaries that need exact localization', () => {
  const f = fixture();
  const plan = buildBookOnePauseFidelityPlan(f);
  assert.ok(plan.summary.firstTenLocalAssemblyRepairCandidates >= 2);
  assert.ok(plan.summary.firstTenBoundariesNeedingLocalization >= 1);
  assert.equal(plan.repairAssessment.directRepairPerformed, false);
  assert.equal(plan.repairAssessment.automaticRegenerationAllowed, false);
});

test('Pause Fidelity fails closed when production lineage disagrees', () => {
  const f = fixture();
  f.cinematicResult.source.productionPlanDigest = 'other-plan';
  assert.throws(() => buildBookOnePauseFidelityPlan(f), /production-plan lineage mismatch/i);
});

test('Pause Fidelity plan digest detects tampering', () => {
  const f = fixture();
  const plan = JSON.parse(JSON.stringify(buildBookOnePauseFidelityPlan(f)));
  plan.policy.headingToBodyMinMs = 1;
  assert.throws(() => verifyBookOnePauseFidelityPlan(plan), /digest mismatch/i);
});


test('Pause Fidelity excludes Front Matter from narrative numbering and still analyzes actual Chapters 1-2', () => {
  const f = fixture();
  const frontText = 'Copyright and title-page material.';
  const oldChapters = f.manuscriptAnalysis.chapters;
  f.manuscriptAnalysis.chapters = [
    { order: 0, title: 'Front Matter', textHash: sha256(frontText), scenes: [{ order: 0, segments: [{ paragraphIndex: 0, kind: 'narration', text: frontText }] }] },
    ...oldChapters.map((chapter, index) => ({ ...chapter, order: index + 1 }))
  ];
  f.manuscriptAnalysis.metrics.chapters = 3;

  const paragraphs = [
    'Front Matter', frontText,
    'Chapter 1', 'First paragraph.', 'Second paragraph.', '***', 'Third paragraph.',
    'Chapter 2', 'Opening paragraph.', 'Another paragraph.'
  ];
  f.extractedManuscript.text = paragraphs.join('\n\n');
  f.extractedManuscript.paragraphLayout = paragraphs.map((value, index) => ({
    nonEmptyParagraphOrdinal: index,
    sourceParagraphOrdinal: index,
    textHash: sha256(value),
    blankParagraphsBefore: 0,
    spacingBeforeTwips: 0,
    spacingAfterTwips: 0,
    style: /^(?:Front Matter|Chapter)/.test(value) ? 'Heading1' : 'Body'
  }));
  f.manuscriptAnalysis.source.normalizedTextHash = sha256(f.extractedManuscript.text);
  f.productionPlan.source.normalizedTextHash = f.manuscriptAnalysis.source.normalizedTextHash;
  f.productionPlan.manifest.chapters = oldChapters.map((chapter, index) => ({
    order: index + 1,
    title: chapter.title,
    sourceTextHash: chapter.textHash
  }));

  const plan = buildBookOnePauseFidelityPlan(f);
  assert.equal(plan.summary.narrativeChapterCount, 2);
  assert.equal(plan.source.sourceSectionCount, 3);
  assert.equal(plan.source.excludedNonNarrativeSectionCount, 1);
  assert.equal(plan.source.excludedNonNarrativeSections[0].title, 'Front Matter');
  assert.deepEqual(plan.chapters.map((chapter) => chapter.chapterNumber), [1, 2]);
  assert.deepEqual(plan.chapters.map((chapter) => chapter.order), [1, 2]);
  assert.equal(plan.chapters.some((chapter) => chapter.title === 'Front Matter'), false);
});
