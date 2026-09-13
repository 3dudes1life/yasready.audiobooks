import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRealAuditionPlan,
  YASREADY_AUDIOBOOKS_VERSION
} from '../src/index.js';

function discoveryFixture() {
  const scripts = [
    ['n1', 'Narration — opening tone', 'narration-opening', 'One'],
    ['n2', 'Narration — emotional range', 'narration-range', 'Two'],
    ['juan', 'Character performance — Juan Delgado', 'character-performance-juan-delgado', 'Three'],
    ['michael', 'Character performance — Michael Rawlins', 'character-performance-michael-rawlins', 'Four'],
    ['christopher', 'Character performance — Christopher Lancaster', 'character-performance-christopher-lancaster', 'Five']
  ].map(([id,label,purpose,text], index) => ({ id, label, purpose, text, chapterOrder: index + 1, chapterTitle: `Chapter ${index + 1}`, source: 'canonical-manuscript' }));

  const candidate = (name, id) => ({
    id: `cand-${id}`,
    rank: 1,
    recommendation: 'AUDITION',
    voice: {
      provider: 'elevenlabs',
      providerVoiceId: id,
      publicOwnerId: `owner-${id}`,
      name,
      description: 'young American male',
      age: 'young',
      accent: 'american',
      locale: 'en-US',
      useCase: 'conversational',
      previewUrl: 'https://example.invalid/preview.mp3'
    },
    combinedScore: 90,
    culturalFit: { applicable: true, requirementMet: true, score: 100 },
    tasteFit: { applicable: true, score: 100, profileVersion: 'book-one-human-v1' }
  });

  return {
    schemaVersion: 1,
    release: '0.14.3.6',
    status: 'READY_FOR_OPERATOR_REVIEW',
    castingMode: 'single-narrator',
    artifactFingerprint: 'precision-hotfix-fixture',
    book: { id: 'book-1', title: 'Tres Amigos, Una Vida', author: 'D.C.W.', sourceHash: 'abc' },
    shortlists: [{
      character: 'Narrator',
      role: 'narrator',
      candidates: [
        candidate('Sebastian', 'seb'),
        candidate('Hale', 'hale'),
        candidate('Ryan', 'ryan')
      ]
    }],
    auditionSamples: { status: 'READY', samples: [{ character: 'Narrator', role: 'narrator', scripts }] }
  };
}

test('0.14.3.19 is current application provenance', () => {
  assert.equal(YASREADY_AUDIOBOOKS_VERSION,'0.14.3.19');
});

test('protected audition maximum always rounds UP to a spendable cent', async () => {
  const discovery = discoveryFixture();
  let call = 0;
  const estimator = async () => {
    call += 1;
    // 15 calls * $0.01668 = $0.2502. 25% reserve = $0.06255.
    // Raw protected value = $0.31275, which MUST become $0.32, never displayed as $0.31.
    return { amountUsd: 0.01668, characters: 100, model: 'eleven_multilingual_v2' };
  };

  const plan = await buildRealAuditionPlan({
    discovery,
    selectedVoiceIds: ['seb', 'hale', 'ryan'],
    estimator
  });

  assert.equal(call, 15);
  assert.equal(plan.cost.estimateUsd, 0.2502);
  assert.equal(plan.cost.reserveUsd, 0.06255);
  assert.equal(plan.cost.suggestedMaxUsd, 0.32);
  assert.equal(plan.cost.roundingPolicy, 'protected-max-ceil-to-cent');
  assert.equal(Number(plan.cost.suggestedMaxUsd.toFixed(2)), plan.cost.suggestedMaxUsd);
});

test('displayed protected maximum can never be lower than the raw estimate plus reserve', async () => {
  const discovery = discoveryFixture();
  const estimator = async () => ({ amountUsd: 0.01668, characters: 100, model: 'eleven_multilingual_v2' });

  const plan = await buildRealAuditionPlan({
    discovery,
    selectedVoiceIds: ['seb', 'hale', 'ryan'],
    estimator
  });

  const rawProtected = plan.cost.estimateUsd + plan.cost.reserveUsd;
  assert.ok(plan.cost.suggestedMaxUsd >= rawProtected);
  assert.ok(plan.cost.suggestedMaxUsd - rawProtected < 0.01);
});
