import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DistributionBrainService } from '../src/services/distribution-brain-service.js';
import {
  getDistributionProfile,
  isValidIsbn13,
  validateDistributionCover,
  validateDistributionMetadata,
  profileFreshness
} from '../src/distribution/profiles.js';
import { buildW3cAudiobookManifest, validateW3cAudiobookManifest } from '../src/distribution/w3c-manifest.js';
import { buildOperatorFlowStatus } from '../src/ux/operator-flow.js';

class Store {
  constructor() { this.rows = new Map(); }
  put(row) { const map = this.rows.get(row.type) ?? new Map(); map.set(row.id, Object.freeze({ ...row })); this.rows.set(row.type, map); return map.get(row.id); }
  get(type, id) { return this.rows.get(type)?.get(id) ?? null; }
  list(type, predicate = null) { const out = [...(this.rows.get(type)?.values() ?? [])]; return predicate ? out.filter(predicate) : out; }
  update(type, id, updater) { const current = this.get(type, id); if (!current) throw new Error(`${type} ${id} not found`); const next = Object.freeze({ ...updater(current) }); this.rows.get(type).set(id, next); return next; }
}

function seed({ profileId = 'acx-2026', digitalNarration = true } = {}) {
  const store = new Store();
  store.put({ id: 'm1', type: 'mastering_plan', projectId: 'p1', bookId: 'b1', title: 'Book', author: 'Author', narrators: ['Narrator'], profileId, status: 'mastered', locked: true });
  store.put({ id: 'r1', type: 'chapter_review', projectId: 'p1', chapterId: 'c1', order: 0 });
  store.put({ id: 'r2', type: 'chapter_review', projectId: 'p1', chapterId: 'c2', order: 1 });
  store.put({ id: 's1', type: 'mastering_section', planId: 'm1', chapterReviewId: 'r1', chapterId: 'c1', title: 'Chapter 1', outputFileName: '001-Chapter-1.mp3', status: 'passed', asset: { locator: 'a1', mediaType: 'audio/mpeg' }, postAnalysis: { durationSec: 600, bitrateKbps: 192, sampleRateHz: 44100, channels: 1 } });
  store.put({ id: 's2', type: 'mastering_section', planId: 'm1', chapterReviewId: 'r2', chapterId: 'c2', title: 'Chapter 2', outputFileName: '002-Chapter-2.mp3', status: 'passed', asset: { locator: 'a2', mediaType: 'audio/mpeg' }, postAnalysis: { durationSec: 700, bitrateKbps: 192, sampleRateHz: 44100, channels: 1 } });
  store.put({ id: 'o1', type: 'mastering_credit_section', planId: 'm1', kind: 'opening', outputFileName: '000-opening-credits.mp3', status: 'passed', asset: { locator: 'open', mediaType: 'audio/mpeg' }, postAnalysis: { durationSec: 8, bitrateKbps: 192, sampleRateHz: 44100, channels: 1 } });
  store.put({ id: 'z1', type: 'mastering_credit_section', planId: 'm1', kind: 'closing', outputFileName: '999-closing-credits.mp3', status: 'passed', asset: { locator: 'close', mediaType: 'audio/mpeg' }, postAnalysis: { durationSec: 10, bitrateKbps: 192, sampleRateHz: 44100, channels: 1 } });
  const service = new DistributionBrainService(store, { clock: () => new Date('2026-09-12T17:00:00Z') });
  const project = service.createProject({ projectId: 'p1', bookId: 'b1', masteringPlanId: 'm1', metadata: { title: 'Book', author: 'Author', narrators: ['Narrator'], language: 'en' }, digitalNarration, narrationProvider: digitalNarration ? 'ElevenLabs' : null });
  service.confirmRights(project.id, { confirmedBy: 'Tester' });
  service.attachCover(project.id, { locator: 'cover', fileName: 'cover.jpg', mediaType: 'image/jpeg', metadata: { width: 3000, height: 3000, format: 'jpg', bytes: 1200000, colorSpace: 'RGB' } });
  return { store, service, project };
}

test('distribution profiles are retrievable and immutable', () => {
  const profile = getDistributionProfile('spotify-direct-2026');
  assert.equal(profile.route, 'manual-upload');
  assert.throws(() => { profile.route = 'x'; });
});

test('ISBN-13 validation accepts a valid ISBN and rejects malformed values', () => {
  assert.equal(isValidIsbn13('9780306406157'), true);
  assert.equal(isValidIsbn13('9780306406158'), false);
  assert.equal(isValidIsbn13('123'), false);
});

test('metadata rejects reused source-edition ISBN', () => {
  const result = validateDistributionMetadata({ title: 'Book', author: 'A', narrators: ['N'], language: 'en', isbn13: '9780306406157', sourceEditionIsbn13: '9780306406157' }, 'spotify-direct-2026');
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((x) => x.code === 'metadata-isbn-reused'));
});

test('ACX cover validator enforces square minimum dimensions and RGB', () => {
  const result = validateDistributionCover({ metadata: { width: 1200, height: 1600, format: 'jpg', colorSpace: 'CMYK' } }, 'acx-2026');
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((x) => x.code === 'cover-not-square'));
  assert.ok(result.errors.some((x) => x.code === 'cover-width-small'));
  assert.ok(result.errors.some((x) => x.code === 'cover-color-space'));
});

test('profile freshness warns on stale retailer rules but exempts stable W3C standard', () => {
  const retailer = profileFreshness('acx-2026', { now: new Date('2028-09-12T00:00:00Z'), maxAgeDays: 365 });
  const standard = profileFreshness('w3c-audiobook-2020', { now: new Date('2028-09-12T00:00:00Z'), maxAgeDays: 365 });
  assert.equal(retailer.stale, true);
  assert.equal(standard.stale, false);
});

test('Spotify preflight requires explicit digital narration disclosure', () => {
  const { service, project } = seed({ profileId: 'acx-2026', digitalNarration: true });
  service.setDigitalNarration(project.id, { enabled: true, provider: 'ElevenLabs' });
  const target = service.addTarget(project.id, 'spotify-direct-2026');
  const pf = service.preflightTarget(target.id);
  assert.equal(pf.readyToPackage, true);
  assert.ok(pf.warnings.some((x) => x.code === 'sample-recommended'));
});

test('Spotify blocks when digital narration state is unset', () => {
  const { service, project } = seed({ digitalNarration: false });
  service.store.update('distribution_project', project.id, (x) => ({ ...x, digitalNarration: null }));
  const target = service.addTarget(project.id, 'spotify-direct-2026');
  const pf = service.preflightTarget(target.id);
  assert.equal(pf.readyToPackage, false);
  assert.ok(pf.blockers.some((x) => x.code === 'digital-narration-disclosure-unset'));
});

test('ACX digital narration requires manual platform eligibility confirmation', () => {
  const { service, project } = seed({ digitalNarration: true });
  const target = service.addTarget(project.id, 'acx-2026');
  const blocked = service.preflightTarget(target.id);
  assert.equal(blocked.readyToPackage, false);
  assert.ok(blocked.blockers.some((x) => x.code === 'platform-eligibility-unconfirmed'));
  service.confirmPlatformEligibility(target.id, { confirmedBy: 'Tester', note: 'Current policy checked manually.' });
  assert.equal(service.preflightTarget(target.id).readyToPackage, true);
});

test('distribution blocks unfinished mastering', () => {
  const { store, service, project } = seed({ digitalNarration: false });
  store.update('mastering_plan', 'm1', (x) => ({ ...x, status: 'armed', locked: false }));
  const target = service.addTarget(project.id, 'acx-2026');
  const pf = service.preflightTarget(target.id);
  assert.ok(pf.blockers.some((x) => x.code === 'mastering-not-finalized'));
});

test('distribution blocks mixed mono/stereo masters', () => {
  const { store, service, project } = seed({ digitalNarration: false });
  store.update('mastering_section', 's2', (x) => ({ ...x, postAnalysis: { ...x.postAnalysis, channels: 2 } }));
  const target = service.addTarget(project.id, 'acx-2026');
  const pf = service.preflightTarget(target.id);
  assert.ok(pf.blockers.some((x) => x.code === 'mixed-channel-layout'));
});

test('Spotify rejects chapters over two hours', () => {
  const { store, service, project } = seed({ digitalNarration: false });
  store.update('mastering_section', 's2', (x) => ({ ...x, postAnalysis: { ...x.postAnalysis, durationSec: 7201 } }));
  const target = service.addTarget(project.id, 'spotify-direct-2026');
  const pf = service.preflightTarget(target.id);
  assert.ok(pf.blockers.some((x) => x.code === 'chapter-duration'));
});

test('build package preserves opening/chapter/closing reading order', () => {
  const { service, project } = seed({ digitalNarration: false });
  const target = service.addTarget(project.id, 'acx-2026');
  const pkg = service.buildTargetPackage(target.id);
  assert.deepEqual(pkg.files.map((x) => x.role), ['opening-credits', 'chapter', 'chapter', 'closing-credits']);
  assert.equal(pkg.w3cManifest.readingOrder.length, 4);
});

test('package includes a valid W3C Audiobook manifest', () => {
  const { service, project } = seed({ digitalNarration: false });
  const target = service.addTarget(project.id, 'acx-2026');
  const pkg = service.buildTargetPackage(target.id);
  assert.equal(validateW3cAudiobookManifest(pkg.w3cManifest).valid, true);
  assert.equal(pkg.w3cManifest.conformsTo, 'https://www.w3.org/TR/audiobooks/');
});

test('W3C builder fails closed without reading order', () => {
  assert.throws(() => buildW3cAudiobookManifest({ metadata: { title: 'Book' }, readingOrder: [] }), /readingOrder/);
});

test('dashboard gives one clear next action', () => {
  const { service, project } = seed({ digitalNarration: false });
  const empty = service.dashboard(project.id);
  assert.equal(empty.nextAction, 'Choose at least one distribution destination');
  service.addTarget(project.id, 'acx-2026');
  const ready = service.dashboard(project.id);
  assert.match(ready.nextAction, /Export|Build|distribution/i);
});

test('preflight does not downgrade already-packaged target status', () => {
  const { service, project, store } = seed({ digitalNarration: false });
  const target = service.addTarget(project.id, 'acx-2026');
  service.buildTargetPackage(target.id);
  service.preflightTarget(target.id);
  assert.equal(store.get('distribution_target', target.id).status, 'packaged');
});

test('project cannot lock until every target is packaged', () => {
  const { service, project } = seed({ digitalNarration: false });
  service.addTarget(project.id, 'acx-2026');
  assert.throws(() => service.lockProject(project.id, { reviewer: 'Tester' }), /every target.*package/);
});

test('project locks after target package is built', () => {
  const { service, project } = seed({ digitalNarration: false });
  const target = service.addTarget(project.id, 'acx-2026');
  service.buildTargetPackage(target.id);
  const locked = service.lockProject(project.id, { reviewer: 'Tester' });
  assert.equal(locked.locked, true);
});

test('raw cover bytes are rejected', () => {
  const { service, project } = seed({ digitalNarration: false });
  assert.throws(() => service.attachCover(project.id, { data: new Uint8Array([1, 2]) }), /asset reference/);
});

test('export package materializes audio/artwork/metadata without storing raw bytes', async () => {
  const { service: baseService, project, store } = seed({ digitalNarration: false });
  const sourceDir = await mkdtemp(path.join(tmpdir(), 'dist-test-src-'));
  const outputDir = await mkdtemp(path.join(tmpdir(), 'dist-test-out-'));
  try {
    const map = {};
    for (const key of ['a1', 'a2', 'open', 'close', 'cover']) {
      const f = path.join(sourceDir, `${key}.bin`);
      await writeFile(f, key);
      map[key] = f;
    }
    const service = new DistributionBrainService(store, {
      clock: () => new Date('2026-09-12T17:00:00Z'),
      assetMaterializer: async (asset) => map[asset.locator],
      packageSink: async (dir) => {
        const checklist = await readFile(path.join(dir, 'CHECKLIST.txt'), 'utf8');
        const manifest = JSON.parse(await readFile(path.join(dir, 'metadata', 'audiobook-manifest.json'), 'utf8'));
        assert.match(checklist, /Before submission/);
        assert.equal(manifest.type, 'Audiobook');
        return { locator: outputDir, kind: 'directory-package' };
      }
    });
    const target = service.addTarget(project.id, 'acx-2026');
    const pkg = service.buildTargetPackage(target.id);
    const exported = await service.exportPackage(pkg.id);
    assert.equal(exported.status, 'exported');
    assert.equal('data' in exported.asset, false);
  } finally {
    await rm(sourceDir, { recursive: true, force: true });
    await rm(outputDir, { recursive: true, force: true });
  }
});

test('operator flow presents stages in plain workflow order', () => {
  const store = new Store();
  const status = buildOperatorFlowStatus(store, 'p1');
  assert.equal(status.currentStage, 'manuscript');
  assert.equal(status.stages[0].status, 'next');
  assert.equal(status.stages[1].status, 'locked');
});

test('operator flow advances to distribution after upstream approvals', () => {
  const store = new Store();
  store.put({ id: 'b1', type: 'book', projectId: 'p1' });
  store.put({ id: 'c1', type: 'chapter', projectId: 'p1' });
  store.put({ id: 'ab', type: 'audio_bible', projectId: 'p1', scope: 'book', bookId: 'b1' });
  store.put({ id: 'ch', type: 'character', projectId: 'p1', bibleId: 'ab', role: 'narrator' });
  store.put({ id: 'va', type: 'voice_assignment', projectId: 'p1', characterId: 'ch', locked: true });
  store.put({ id: 'dp', type: 'director_plan', projectId: 'p1', bookId: 'b1', locked: true });
  store.put({ id: 'dc', type: 'director_cue', projectId: 'p1', planId: 'dp', locked: true });
  store.put({ id: 'pp', type: 'production_plan', projectId: 'p1', bookId: 'b1' });
  store.put({ id: 'pj', type: 'production_job', projectId: 'p1', bookId: 'b1', planId: 'pp', status: 'ready' });
  store.put({ id: 'rv', type: 'review_session', projectId: 'p1', bookId: 'b1', status: 'approved', locked: true });
  store.put({ id: 'qa', type: 'qa_run', projectId: 'p1', bookId: 'b1', status: 'approved', locked: true });
  store.put({ id: 'ma', type: 'mastering_plan', projectId: 'p1', bookId: 'b1', status: 'mastered', locked: true });
  const status = buildOperatorFlowStatus(store, 'p1');
  assert.equal(status.currentStage, 'distribution');
});
