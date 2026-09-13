import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MASTERING_SILENCE_MEASUREMENT_TOLERANCE_MS,
  evaluateMasterAgainstProfile
} from '../src/mastering/profiles.js';
import { reconcileHistoricalBookOneBatchTechnicalQa } from '../src/services/book-one-cinematic-naturalism-service.js';
import { YASREADY_AUDIOBOOKS_VERSION } from '../src/release.js';

function qaResult({ valueArchive = 499.909, valueAcx = 999.409, extraIssue = null } = {}) {
  const archiveIssues = [{ code: 'trailing-silence-short', severity: 'error', value: valueArchive, minimum: 500 }];
  if (extraIssue) archiveIssues.push(extraIssue);
  return {
    status: 'TECHNICAL_QA_REVIEW_REQUIRED',
    distribution: { channelConfiguration: { consistent: true, signatures: ['1:mono'] } },
    chapters: [{
      title: 'Chapter 4: Hong Kong',
      qa: {
        archive: { passed: false, issues: archiveIssues },
        acx: { passed: false, issues: [{ code: 'trailing-silence-short', severity: 'error', value: valueAcx, minimum: 1000 }] },
        spotify: { passed: true, issues: [] }
      }
    }]
  };
}

test('0.14.3.20.1 is current application provenance', () => {
  assert.equal(YASREADY_AUDIOBOOKS_VERSION, '0.14.3.20.1');
});

test('mastering keeps retailer silence targets unchanged but tolerates <=1 ms measurement boundary', () => {
  assert.equal(MASTERING_SILENCE_MEASUREMENT_TOLERANCE_MS, 1);
  const archive = evaluateMasterAgainstProfile({
    rmsDb: -21.3, peakDb: -3.5, leadingSilenceMs: 507.166, trailingSilenceMs: 499.909,
    sampleRateHz: 44100, bitrateKbps: 1058
  }, 'archive-wav-2026');
  assert.equal(archive.passed, true);

  const acx = evaluateMasterAgainstProfile({
    rmsDb: -21.6, peakDb: -3.7, noiseFloorDb: -70, leadingSilenceMs: 1007.143, trailingSilenceMs: 999.409,
    sampleRateHz: 44100, bitrateKbps: 192
  }, 'acx-2026');
  assert.equal(acx.passed, true);
});

test('historical reconciliation accepts only stored sub-millisecond trailing-silence false positives', () => {
  const result = reconcileHistoricalBookOneBatchTechnicalQa(qaResult());
  assert.equal(result.passed, true);
  assert.equal(result.mode, 'RECONCILED_SUB_MILLISECOND_SILENCE_BOUNDARY_ONLY');
  assert.equal(result.reconciledFindingCount, 2);
  assert.equal(result.blockerCount, 0);
  assert.equal(result.retailerTargetsUnchanged, true);
});

test('historical reconciliation still blocks a real spacing miss beyond 1 ms', () => {
  const result = reconcileHistoricalBookOneBatchTechnicalQa(qaResult({ valueArchive: 498.8 }));
  assert.equal(result.passed, false);
  assert.ok(result.blockerCount >= 1);
});

test('historical reconciliation still blocks unrelated technical QA issues', () => {
  const result = reconcileHistoricalBookOneBatchTechnicalQa(qaResult({
    extraIssue: { code: 'peak-too-high', severity: 'error', value: -1, maximum: -3 }
  }));
  assert.equal(result.passed, false);
  assert.ok(result.findings.some(x => x.code === 'peak-too-high' && x.outcome === 'BLOCK'));
});

test('historical reconciliation still requires consistent channels', () => {
  const input = qaResult();
  input.distribution.channelConfiguration.consistent = false;
  const result = reconcileHistoricalBookOneBatchTechnicalQa(input);
  assert.equal(result.passed, false);
  assert.ok(result.findings.some(x => x.reason === 'channel-configuration-inconsistent'));
});


test('historical reconciliation preserves an already-green legacy result even when newer QA detail fields are absent', () => {
  const result = reconcileHistoricalBookOneBatchTechnicalQa({
    status: 'READY_FOR_HUMAN_BATCH_REVIEW',
    chapters: [{ title: 'Legacy green chapter' }],
    distribution: {}
  });
  assert.equal(result.passed, true);
  assert.equal(result.mode, 'ORIGINAL_QA_ALREADY_GREEN');
  assert.equal(result.blockerCount, 0);
});
