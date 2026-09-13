import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CastingLaunchService,
  buildCastingLaunchFixture,
  YASREADY_AUDIOBOOKS_VERSION
} from '../src/index.js';

test('0.14.3.2 release constant is current product provenance', () => {
  assert.equal(YASREADY_AUDIOBOOKS_VERSION, '0.14.3.2');
});

test('Casting Launch requires a fully locked production-ready Audio Bible', () => {
  const prep = buildCastingLaunchFixture();
  const service = new CastingLaunchService();
  assert.equal(service.build(prep).launch.status, 'READY_FOR_CANDIDATE_DISCOVERY');

  const unlocked = structuredClone(prep);
  unlocked.audioBible.locked = false;
  assert.throws(() => service.build(unlocked), /locked Audio Bible/);
});

test('Casting Launch wave one is narrator plus primary cast only', () => {
  const { launch } = new CastingLaunchService().build(buildCastingLaunchFixture());
  const waveOne = launch.waves.find((row) => row.wave === 1);
  assert.deepEqual(waveOne.targets.map((row) => row.canonicalName), ['Narrator', 'Primary A', 'Primary B']);
  assert.deepEqual(launch.requiredBeforeDirector, ['Narrator', 'Primary A', 'Primary B']);
});

test('Casting Launch keeps scene-local roles outside permanent casting waves', () => {
  const { launch } = new CastingLaunchService().build(buildCastingLaunchFixture());
  assert.equal(launch.targets.some((row) => row.canonicalName === 'Party Guest'), false);
  assert.equal(launch.sceneLocalExcluded[0].canonicalName, 'Party Guest');
  assert.equal(launch.sceneLocalExcluded[0].castingStatus, 'on-demand');
});

test('Casting Launch is zero-spend and does not arm auditions or production', () => {
  const { launch } = new CastingLaunchService().build(buildCastingLaunchFixture());
  assert.equal(launch.providerCallsPerformed, 0);
  assert.equal(launch.guardrails.auditionRenderingArmed, false);
  assert.equal(launch.guardrails.paidGenerationArmed, false);
  assert.equal(launch.guardrails.productionArmed, false);
});

test('Casting Launch fails closed on stale snapshot digest', () => {
  const prep = structuredClone(buildCastingLaunchFixture());
  prep.snapshot.digest = 'wrong-digest';
  assert.throws(() => new CastingLaunchService().build(prep), /snapshot digest/);
});

test('Casting Launch accepts legacy 0.11.8 prep provenance but emits current launch provenance', () => {
  const prep = structuredClone(buildCastingLaunchFixture());
  delete prep.provenance;
  prep.release = '0.11.8';
  prep.audioBible.lockRelease = '0.11.8';
  const { launch } = new CastingLaunchService().build(prep);
  assert.equal(launch.provenance.applicationRelease, '0.14.3.2');
  assert.equal(launch.provenance.sourceArtifactApplicationRelease, '0.11.8');
  assert.equal(launch.source.sourcePrepRelease, '0.11.8');
});
