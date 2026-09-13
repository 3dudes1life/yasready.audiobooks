import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBatchProgressSnapshot, renderBatchProgressLine } from '../src/production/batch-progress.js';

test('progress snapshot converts durable production state into plain-English operator progress', () => {
  const arm = {
    batchScope: {
      ordinal: 1,
      selectedChapterCount: 2,
      chapters: [
        { order: 0, chunkIds: ['ch01-heading', 'ch01-sc01-c01'] },
        { order: 1, chunkIds: ['ch02-heading', 'ch02-sc01-c01'] }
      ]
    },
    budget: { protectedMaxUsd: 8.34 }
  };
  const state = {
    createdAt: '2026-09-13T18:00:00.000Z',
    updatedAt: '2026-09-13T18:10:00.000Z',
    chapters: { '0': { title: 'Departure' } },
    chunks: {
      'ch01-heading': { id: 'ch01-heading', status: 'COMPLETE', capturedOrEstimatedBilledUsd: 0.01 },
      'ch01-sc01-c01': { id: 'ch01-sc01-c01', status: 'COMPLETE', capturedOrEstimatedBilledUsd: 0.54 },
      'ch02-heading': { id: 'ch02-heading', status: 'FINISH_COMPLETE', capturedOrEstimatedBilledUsd: 0.01 },
      'ch02-sc01-c01': { id: 'ch02-sc01-c01', status: 'TEMPO_COMPLETE', capturedOrEstimatedBilledUsd: 0.80 }
    }
  };
  const snapshot = buildBatchProgressSnapshot({ arm, state, now: Date.parse('2026-09-13T18:12:00.000Z') });
  assert.equal(snapshot.totalChapters, 2);
  assert.equal(snapshot.completedChapters, 1);
  assert.equal(snapshot.totalChunks, 4);
  assert.equal(snapshot.securedProviderAudio, 4);
  assert.equal(snapshot.finishedChunks, 3);
  assert.equal(snapshot.currentChapterNumber, 2);
  assert.equal(snapshot.currentStage, 'voice finish');
  assert.equal(snapshot.capturedOrEstimatedBilledUsd, 1.36);
  assert.ok(snapshot.progressPercent > 60 && snapshot.progressPercent < 100);
  assert.ok(snapshot.etaSeconds > 0);
  const line = renderBatchProgressLine(snapshot);
  assert.match(line, /Ch 2\/2/);
  assert.match(line, /audio 4\/4/);
  assert.match(line, /\$1\.36\/\$8\.34 max/);
  assert.match(line, /ETA ~/);
});

test('progress snapshot preserves DO NOT RERUN provider uncertainty in operator language', () => {
  const arm = { batchScope: { selectedChapterCount: 1, chapters: [{ order: 0, chunkIds: ['ch01-heading'] }] }, budget: { protectedMaxUsd: 1 } };
  const state = { chunks: { 'ch01-heading': { id: 'ch01-heading', status: 'PROVIDER_RESULT_UNKNOWN_DO_NOT_RERUN' } }, chapters: {} };
  const snapshot = buildBatchProgressSnapshot({ arm, state });
  assert.match(snapshot.currentStage, /DO NOT RERUN/);
  assert.equal(snapshot.securedProviderAudio, 0);
});
