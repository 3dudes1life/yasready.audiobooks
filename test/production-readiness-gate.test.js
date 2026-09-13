import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  YASREADY_AUDIOBOOKS_VERSION,
  ElevenLabsProvider,
  buildProductionReadinessPlan,
  selectProductionReadinessSample,
  compileProductionReadinessScript,
  verifyProductionReadinessPlan,
  renderProductionReadinessSample,
  renderProductionReadinessReviewHtml,
  finalizeProductionReadiness,
  READINESS_MIN_WORDS,
  READINESS_MAX_WORDS
} from '../src/index.js';

function prose(label, count) {
  return Array.from({ length: count }, (_, i) => `${label}${i + 1}`).join(' ');
}

function analysisFixture() {
  const segments = [
    { order:0, kind:'narration', text:prose('opening', 52), speakerCandidate:null },
    { order:1, kind:'dialogue', text:prose('juan', 24), speakerCandidate:{ name:'Juan', confidence:.9, evidence:'fixture' } },
    { order:2, kind:'narration', text:prose('bridge', 18), speakerCandidate:null },
    { order:3, kind:'dialogue', text:prose('michael', 24), speakerCandidate:{ name:'Michael', confidence:.9, evidence:'fixture' } },
    { order:4, kind:'narration', text:prose('beat', 18), speakerCandidate:null },
    { order:5, kind:'dialogue', text:prose('christopher', 24), speakerCandidate:{ name:'Christopher', confidence:.9, evidence:'fixture' } },
    { order:6, kind:'narration', text:prose('closing', 38), speakerCandidate:null }
  ];
  return {
    source:{ sourceHash:'book-one-hash', format:'docx' },
    metadata:{ title:'Tres Amigos, Una Vida – A Throuple Love Story', author:'D.C.W.' },
    chapters:[{
      order:12,title:'Chapter 12',textHash:'chapter-hash',
      scenes:[{order:1,textHash:'scene-hash',segments}]
    }]
  };
}

function learningFixture() {
  return {
    schemaVersion:1,
    release:'0.14.3.8',
    artifact:'book-one-performance-direction-learning-summary',
    status:'COMPLETE',
    planFingerprint:'direction-plan-fingerprint',
    book:{
      id:'book1',
      title:'Tres Amigos, Una Vida – A Throuple Love Story',
      author:'D.C.W.',
      sourceHash:'book-one-hash'
    },
    winner:{
      providerVoiceId:'rU18Fk3uSDhmg5Xh41o4',
      candidateName:'Ryan Kurk - Pleasant and Smooth',
      variantId:'playful-flirty',
      variantLabel:'Playful + Flirty',
      decision:'best',
      ratings:{},
      averageRating:null,
      notes:"Best version. Younger, playful and flirty feels right for the book. Keep this overall energy, but don't overplay the character voices."
    },
    nextHumanTasteProfile:{
      source:'explicit-human-performance-direction-feedback',
      preferredVoiceId:'rU18Fk3uSDhmg5Xh41o4',
      preferredDirectionId:'playful-flirty',
      preferredDirectionLabel:'Playful + Flirty',
      identityInferredFromAudio:false
    }
  };
}

const estimator = async ({ text, model }) => ({
  amountUsd:Number(((text.length / 1000) * .10).toFixed(6)),
  characters:text.length,
  model,
  rateUsdPer1k:.10,
  estimated:true
});

async function planFixture() {
  return buildProductionReadinessPlan({
    learningSummary:learningFixture(),
    analysis:analysisFixture(),
    estimator
  });
}

function providerFixture({ tier='creator', unavailable=false }={}) {
  const state={renders:0};
  return {
    state,
    async subscriptionPreflight(){
      if (unavailable) return {available:false,safeToContinue:true,reason:'subscription-check-unavailable-missing-user-read'};
      return {available:true,safeToContinue:true,tier,subscription:{tier}};
    },
    async healthCheck(){return {ok:true,status:200}},
    async render({text,model,voiceId}){
      state.renders += 1;
      return {
        audio:new Uint8Array([1,2,3,4]),
        billedCharacters:text.length,
        estimatedCostUsd:Number(((text.length/1000)*.10).toFixed(6)),
        requestId:`readiness-${state.renders}`,
        model,voiceId
      };
    }
  };
}

test('0.14.3.20 is current application provenance',()=>{
  assert.equal(YASREADY_AUDIOBOOKS_VERSION,'0.14.3.20');
});

test('readiness selector chooses a contiguous 60-90 second narration-dialogue-narration sample',()=>{
  const sample=selectProductionReadinessSample(analysisFixture());
  assert.ok(sample.wordCount>=READINESS_MIN_WORDS);
  assert.ok(sample.wordCount<=READINESS_MAX_WORDS);
  assert.equal(sample.narrationBeforeDialogue,true);
  assert.equal(sample.narrationAfterDialogue,true);
  assert.ok(sample.dialogueSegments>=2);
  assert.deepEqual(sample.coreSpeakers,['juan','michael','christopher']);
  assert.ok(sample.estimatedSecondsAt155Wpm>=60);
  assert.ok(sample.estimatedSecondsAt155Wpm<=91);
});

test('readiness script applies winning playful/flirty direction without over-tagging character identity',()=>{
  const sample=selectProductionReadinessSample(analysisFixture());
  const script=compileProductionReadinessScript(sample);
  assert.match(script.directedText,/\[playfully\]/);
  assert.match(script.directedText,/\[warmly\]/);
  assert.match(script.directedText,/\[mischievously\]/);
  assert.doesNotMatch(script.directedText,/\[(?:gay|queer|latino|hispanic|asian|black|white)[^\]]*\]/i);
  assert.match(script.policy.restraint,/without overplaying/i);
});

test('readiness planning is zero-spend, one-call-only, immutable and tied to the human winner',async()=>{
  const plan=await planFixture();
  assert.equal(plan.status,'READY_FOR_EXPLICIT_APPROVAL');
  assert.equal(plan.learning.providerVoiceId,'rU18Fk3uSDhmg5Xh41o4');
  assert.equal(plan.learning.preferredDirectionId,'playful-flirty');
  assert.equal(plan.cost.estimatedGenerationCalls,1);
  assert.equal(plan.guardrails.planningProviderGenerationCalls,0);
  assert.match(plan.confirmation.token,/^READINESS-[A-F0-9]{10}$/);
  assert.equal(verifyProductionReadinessPlan(plan),true);
  assert.ok(plan.cost.suggestedMaxUsd<=1);
});

test('readiness fails closed on a manuscript hash mismatch',async()=>{
  const analysis=analysisFixture();
  analysis.source.sourceHash='wrong-book';
  await assert.rejects(
    buildProductionReadinessPlan({learningSummary:learningFixture(),analysis,estimator}),
    /source hash does not match/i
  );
});

test('missing user_read permission is a safe-degrade preflight and does not block a valid paid render',async()=>{
  const plan=await planFixture();
  const provider=providerFixture({unavailable:true});
  const out=await mkdtemp(path.join(os.tmpdir(),'yas-readiness-'));
  const result=await renderProductionReadinessSample({
    plan,provider,outDir:out,
    approvalToken:plan.confirmation.token,
    maxUsd:plan.cost.suggestedMaxUsd
  });
  assert.equal(result.status,'READY_FOR_HUMAN_GATE');
  assert.equal(result.providerGenerationCalls,1);
  assert.equal(result.productionGenerationCalls,0);
  assert.equal(result.subscriptionPreflight.available,false);
  assert.equal(provider.state.renders,1);
  await stat(path.join(out,'production-readiness-review.html'));
});

test('free-tier entitlement blocks before readiness TTS',async()=>{
  const plan=await planFixture();
  const provider=providerFixture({tier:'free'});
  const out=await mkdtemp(path.join(os.tmpdir(),'yas-readiness-free-'));
  await assert.rejects(
    renderProductionReadinessSample({
      plan,provider,outDir:out,
      approvalToken:plan.confirmation.token,
      maxUsd:plan.cost.suggestedMaxUsd
    }),
    /paid subscription.*No audio was generated/i
  );
  assert.equal(provider.state.renders,0);
});

test('readiness review UX has durable download feedback plus clipboard fallback and visible status',async()=>{
  const plan=await planFixture();
  const result={
    outputRelativePath:'audio/book-one-production-readiness.mp3',
    cost:{capturedUsd:.1}
  };
  const html=renderProductionReadinessReviewHtml(plan,result);
  assert.match(html,/Download Feedback JSON/);
  assert.match(html,/Copy Feedback JSON/);
  assert.match(html,/showSaveFilePicker/);
  assert.match(html,/Download requested\. Check your Downloads folder/);
  assert.match(html,/PASS — Lock it/);
});

test('human PASS creates the narrator production lock and performance profile but does not arm full-book generation',async()=>{
  const plan=await planFixture();
  const result=finalizeProductionReadiness({
    plan,
    feedback:{
      schemaVersion:1,
      artifact:'book-one-production-readiness-human-feedback',
      planFingerprint:plan.integrity.planFingerprint,
      decision:'pass',
      notes:'This holds up. Keep the playful energy restrained in character voices.'
    }
  });
  assert.equal(result.status,'PASSED');
  assert.equal(result.narratorProductionLockCreated,true);
  assert.equal(result.narratorProductionLock.narrator.providerVoiceId,'rU18Fk3uSDhmg5Xh41o4');
  assert.equal(result.narratorProductionLock.performanceProfile.directionId,'playful-flirty');
  assert.equal(result.productionArmed,false);
  assert.equal(result.fullBookGenerationArmed,false);
  assert.match(result.narratorProductionLock.lockDigest,/^[a-f0-9]{64}$/);
});

test('NEEDS TUNING cannot create a narrator production lock',async()=>{
  const plan=await planFixture();
  const result=finalizeProductionReadiness({
    plan,
    feedback:{
      artifact:'book-one-production-readiness-human-feedback',
      planFingerprint:plan.integrity.planFingerprint,
      decision:'needs-tuning',
      notes:'Dialogue still gets too theatrical.'
    }
  });
  assert.equal(result.status,'NEEDS_TUNING');
  assert.equal(result.narratorProductionLockCreated,false);
  assert.equal(result.fullBookGenerationArmed,false);
});

test('ElevenLabs subscription preflight turns missing user_read into a safe operator state',async()=>{
  const provider=new ElevenLabsProvider({
    apiKey:'fixture-key',
    fetchImpl:async(url)=>{
      if(String(url).includes('/v1/user/subscription')){
        return {
          ok:false,status:401,
          headers:{get:()=>null},
          clone(){return this},
          async json(){return {detail:{type:'authentication_error',code:'unauthorized',message:'missing user_read',status:'missing_permissions'}}},
          async text(){return ''}
        };
      }
      throw new Error('unexpected fetch');
    }
  });
  const status=await provider.subscriptionPreflight();
  assert.equal(status.available,false);
  assert.equal(status.safeToContinue,true);
  assert.equal(status.reason,'subscription-check-unavailable-missing-user-read');
});
