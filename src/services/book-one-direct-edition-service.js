import { mkdir, readFile, writeFile, copyFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { sha256, stableJson } from '../core/hash.js';
import { verifyHistoricalBookOneBatchResult } from '../production/historical-batch-integrity.js';

export const DIRECT_TO_CONSUMER_CORE_RULE = 'Retailers give us reach. Direct gives us the relationship.';

const freeze = (value) => {
  if (Array.isArray(value)) { for (const child of value) freeze(child); return Object.freeze(value); }
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); return Object.freeze(value); }
  return value;
};
const exists = async (file) => { try { await stat(file); return true; } catch { return false; } };
const fileDigest = async (file) => sha256((await readFile(file)).toString('base64'));
function slug(value) {
  return String(value ?? 'book-one').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'book-one';
}

export function buildBookOneDirectEntitlementContract(batchResult) {
  verifyHistoricalBookOneBatchResult(batchResult);
  const bookId = String(batchResult.book?.id ?? slug(batchResult.book?.title));
  const productKey = `direct-audiobook:${bookId}`;
  const entitlementKey = `audiobook:${bookId}`;
  const editionSeed = {
    bookId,
    recipeDigest: batchResult.recipeDigest,
    narrator: batchResult.book?.narrator ?? null
  };
  const editionId = `DIRECT-${sha256(stableJson(editionSeed)).slice(0, 16).toUpperCase()}`;
  return freeze({
    schemaVersion: 1,
    artifact: 'book-one-direct-entitlement-contract',
    status: 'FOUNDATION_LOCKED_NO_COMMERCE_CONNECTION_YET',
    coreBusinessRule: DIRECT_TO_CONSUMER_CORE_RULE,
    product: freeze({
      productType: 'audiobook',
      bookId,
      title: batchResult.book?.title ?? null,
      author: batchResult.book?.author ?? null,
      productKey,
      entitlementKey,
      editionId
    }),
    ownership: freeze({
      directPurchaseCreatesPermanentEntitlement: true,
      restoreAcrossSupportedDevices: true,
      portableOwnedDownloadIncluded: true,
      appOfflineDownloadIncluded: true,
      appStreamingIncluded: true
    }),
    restoreAccess: freeze({
      entryPointLabel: 'Already own it?',
      purchaseEmailLookupAllowed: true,
      emailAloneIsSufficientProof: false,
      verificationRequired: true,
      verificationMethods: freeze(['one-time email code', 'magic link']),
      successfulVerificationAttachesEntitlementToCustomerAccount: true
    }),
    purchaseOriginPolicy: freeze({
      directWebsitePurchase: freeze({ automaticAppUnlock: true, entitlementRecordRequired: true }),
      spotifyRetailPurchase: freeze({ automaticAppUnlock: false, reason: 'No trusted purchaser entitlement feed is assumed.' }),
      appleBooksRetailPurchase: freeze({ automaticAppUnlock: false, reason: 'No trusted purchaser entitlement feed is assumed.' }),
      otherRetailPurchase: freeze({ automaticAppUnlock: false, reason: 'Retailer reach does not create a direct customer entitlement by default.' })
    }),
    integrationBoundary: freeze({
      websiteCheckoutConnected: false,
      throupleTeaAccountConnected: false,
      emailVerificationServiceConnected: false,
      streamingBackendConnected: false,
      thisReleaseDefinesTheContractOnly: true
    })
  });
}

export function buildBookOneDirectEditionManifest({ batchResult, chapterAssets = [] } = {}) {
  verifyHistoricalBookOneBatchResult(batchResult);
  const entitlement = buildBookOneDirectEntitlementContract(batchResult);
  const chapters = chapterAssets.map((row) => freeze({ ...row }));
  const base = {
    schemaVersion: 1,
    artifact: 'book-one-direct-edition-manifest',
    status: 'PARTIAL_DIRECT_EDITION_FOUNDATION',
    coreBusinessRule: DIRECT_TO_CONSUMER_CORE_RULE,
    sourceBatchResultDigest: batchResult.integrity.resultDigest,
    book: batchResult.book,
    entitlement: entitlement.product,
    availableChapterCount: chapters.length,
    chapters: freeze(chapters),
    delivery: freeze({
      chapterMp3: 'READY_FOR_DIRECT_OWNED_DOWNLOAD_FOR_COMPLETED_CHAPTERS',
      m4b: 'PENDING_FULL_BOOK_COMPLETION',
      webStreaming: 'CONTRACT_DEFINED_NOT_CONNECTED',
      appStreaming: 'CONTRACT_DEFINED_NOT_CONNECTED',
      appOffline: 'CONTRACT_DEFINED_NOT_CONNECTED'
    }),
    completionBoundary: freeze({
      fullAudiobookComplete: false,
      fullBookM4bMustNotBeClaimedFromPartialBatch: true,
      finalDirectEditionRequiresAllNarrativeChapters: true,
      finalCoverMetadataAndCreditsStillRequired: true
    }),
    retailerRelationship: freeze({
      directIsPrimaryCustomerRelationshipChannel: true,
      retailersAreReachAndDiscoveryChannels: true,
      retailerPurchaseDoesNotAutoCreateDirectEntitlement: true
    })
  };
  return freeze({ ...base, integrity: freeze({ directManifestDigest: sha256(stableJson(base)) }) });
}

export async function materializeBookOneDirectEditionBatch({ batchResult, productionRoot, outputRoot = null } = {}) {
  verifyHistoricalBookOneBatchResult(batchResult);
  if (!productionRoot) throw new Error('Direct Edition materialization requires the production root that contains the completed batch assets');
  const root = path.resolve(productionRoot);
  const directRoot = path.resolve(outputRoot ?? path.join(root, 'distribution', 'direct'));
  const chapterRoot = path.join(directRoot, 'chapter-mp3');
  await mkdir(chapterRoot, { recursive: true });

  const assets = [];
  for (const chapter of batchResult.chapters ?? []) {
    const relativeSource = chapter.outputs?.spotifyMp3 ?? chapter.outputs?.acxMp3;
    if (!relativeSource) throw new Error(`Chapter ${chapter.title ?? chapter.order} is missing a reusable MP3 master`);
    const source = path.resolve(root, relativeSource);
    if (!(await exists(source))) throw new Error(`Direct Edition source MP3 is missing: ${source}`);
    const expectedDigest = chapter.digests?.spotifyMp3 ?? chapter.digests?.acxMp3;
    const actualDigest = await fileDigest(source);
    if (expectedDigest && actualDigest !== expectedDigest) throw new Error(`Direct Edition source MP3 digest mismatch for ${chapter.title ?? chapter.order}`);
    const sequence = String(chapter.retailerSequence ?? Number(chapter.order ?? 0) + 1).padStart(3, '0');
    const filename = `${sequence}-${slug(chapter.title)}.mp3`;
    const destination = path.join(chapterRoot, filename);
    await copyFile(source, destination);
    const copiedDigest = await fileDigest(destination);
    if (copiedDigest !== actualDigest) throw new Error(`Direct Edition copied MP3 failed digest verification for ${chapter.title ?? chapter.order}`);
    assets.push(freeze({
      order: chapter.order,
      sequence: Number(chapter.retailerSequence ?? Number(chapter.order ?? 0) + 1),
      title: chapter.title,
      relativePath: path.relative(directRoot, destination),
      sha256: copiedDigest,
      sourceBatchRelativePath: relativeSource,
      qaInheritedFromBatch: Boolean(chapter.qa?.spotify?.passed || chapter.qa?.acx?.passed)
    }));
  }

  const entitlement = buildBookOneDirectEntitlementContract(batchResult);
  const manifest = buildBookOneDirectEditionManifest({ batchResult, chapterAssets: assets });
  const readme = [
    'YasReady Audiobooks — Direct Edition Foundation',
    '',
    DIRECT_TO_CONSUMER_CORE_RULE,
    '',
    `Completed chapter MP3s staged: ${assets.length}`,
    'M4B status: pending full-book completion.',
    'App/web commerce and entitlement services are defined by contract but are not connected in this release.',
    'Retail purchases do not automatically unlock the Direct Edition.',
    'Direct restore flow requires verified purchase email; email alone is never enough.',
    ''
  ].join('\n');

  const manifestPath = path.join(directRoot, 'direct-edition-manifest.json');
  const entitlementPath = path.join(directRoot, 'direct-entitlement-contract.json');
  const readmePath = path.join(directRoot, 'README.txt');
  await Promise.all([
    writeFile(manifestPath, JSON.stringify(manifest, null, 2)),
    writeFile(entitlementPath, JSON.stringify(entitlement, null, 2)),
    writeFile(readmePath, readme)
  ]);

  return freeze({
    status: 'DIRECT_EDITION_BATCH_FOUNDATION_READY',
    providerTtsCallsPerformed: 0,
    providerSpendUsd: 0,
    chapterCount: assets.length,
    directRoot,
    manifestPath,
    entitlementPath,
    readmePath,
    m4bCreated: false,
    coreBusinessRule: DIRECT_TO_CONSUMER_CORE_RULE
  });
}
