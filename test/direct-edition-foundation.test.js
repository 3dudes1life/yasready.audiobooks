import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { sha256, stableJson } from '../src/core/hash.js';
import { historicalBatchResultCore } from '../src/production/historical-batch-integrity.js';
import {
  DIRECT_TO_CONSUMER_CORE_RULE,
  buildBookOneDirectEntitlementContract,
  materializeBookOneDirectEditionBatch
} from '../src/services/book-one-direct-edition-service.js';

function withDigest(base) {
  return { ...base, integrity: { resultDigest: sha256(stableJson(historicalBatchResultCore(base))) } };
}

function fixtureResult(mp3Digest) {
  return withDigest({
    schemaVersion: 1,
    release: '0.14.3.16',
    artifact: 'book-one-batch-production-result',
    status: 'READY_FOR_HUMAN_BATCH_REVIEW',
    book: { id: 'book-one-id', title: 'Tres Amigos, Una Vida', author: 'William T. Zakrajshek' },
    armDigest: 'arm-digest',
    recipeDigest: 'recipe-digest',
    batch: { ordinal: 1, chapterCount: 1, firstChapterOrder: 0, lastChapterOrder: 0 },
    provider: { providerGenerationCallsThisRun: 1 },
    cost: { approvedMaxUsd: 1, capturedOrEstimatedBilledUsd: 0.5 },
    chapters: [{
      order: 0,
      retailerSequence: 1,
      title: 'Departure',
      outputs: { spotifyMp3: 'distribution/spotify/001-departure.mp3', acxMp3: 'distribution/acx-audible/001-departure.mp3' },
      digests: { spotifyMp3: mp3Digest, acxMp3: mp3Digest },
      qa: { spotify: { passed: true }, acx: { passed: true }, archive: { passed: true } }
    }],
    distribution: { finalPackageComplete: false },
    guardrails: { nextBatchArmed: false, fullBookGenerationArmed: false }
  });
}

test('direct entitlement contract makes Direct the relationship channel and email alone never unlocks', async () => {
  const bytes = Buffer.from('fake-mp3-audio');
  const digest = sha256(bytes.toString('base64'));
  const contract = buildBookOneDirectEntitlementContract(fixtureResult(digest));
  assert.equal(contract.coreBusinessRule, DIRECT_TO_CONSUMER_CORE_RULE);
  assert.equal(contract.ownership.directPurchaseCreatesPermanentEntitlement, true);
  assert.equal(contract.restoreAccess.entryPointLabel, 'Already own it?');
  assert.equal(contract.restoreAccess.emailAloneIsSufficientProof, false);
  assert.equal(contract.purchaseOriginPolicy.directWebsitePurchase.automaticAppUnlock, true);
  assert.equal(contract.purchaseOriginPolicy.spotifyRetailPurchase.automaticAppUnlock, false);
  assert.equal(contract.purchaseOriginPolicy.appleBooksRetailPurchase.automaticAppUnlock, false);
});

test('direct edition materializes verified chapter MP3s without pretending partial Batch One is a full M4B', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yasready-direct-'));
  const source = path.join(root, 'distribution', 'spotify', '001-departure.mp3');
  await mkdir(path.dirname(source), { recursive: true });
  const bytes = Buffer.from('fake-mp3-audio');
  await writeFile(source, bytes);
  const digest = sha256(bytes.toString('base64'));
  const result = await materializeBookOneDirectEditionBatch({ batchResult: fixtureResult(digest), productionRoot: root });
  assert.equal(result.providerTtsCallsPerformed, 0);
  assert.equal(result.providerSpendUsd, 0);
  assert.equal(result.m4bCreated, false);
  const manifest = JSON.parse(await readFile(result.manifestPath, 'utf8'));
  assert.equal(manifest.coreBusinessRule, DIRECT_TO_CONSUMER_CORE_RULE);
  assert.equal(manifest.availableChapterCount, 1);
  assert.equal(manifest.delivery.m4b, 'PENDING_FULL_BOOK_COMPLETION');
  assert.equal(manifest.retailerRelationship.directIsPrimaryCustomerRelationshipChannel, true);
  const copied = await readFile(path.join(result.directRoot, manifest.chapters[0].relativePath));
  assert.deepEqual(copied, bytes);
});

test('direct edition refuses a tampered chapter master', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yasready-direct-tamper-'));
  const source = path.join(root, 'distribution', 'spotify', '001-departure.mp3');
  await mkdir(path.dirname(source), { recursive: true });
  const original = Buffer.from('original-audio');
  const expected = sha256(original.toString('base64'));
  await writeFile(source, Buffer.from('tampered-audio'));
  await assert.rejects(
    () => materializeBookOneDirectEditionBatch({ batchResult: fixtureResult(expected), productionRoot: root }),
    /digest mismatch/
  );
});
