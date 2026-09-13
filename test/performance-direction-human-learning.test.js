import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, stat, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  buildRealAuditionPlan,
  buildPerformanceDirectionPlan,
  deriveHumanTasteLearning,
  verifyPerformanceDirectionPlan,
  renderPerformanceDirectionRound,
  summarizePerformanceDirectionFeedback,
  PERFORMANCE_DIRECTION_HARD_CEILING_USD,
  YASREADY_AUDIOBOOKS_VERSION
} from '../src/index.js';

function discoveryFixture() {
  const scripts = [
    ['n1','Narration — opening tone','narration-opening','Rawlins clenched his jaw tightly.'],
    ['n2','Narration — emotional range','narration-range','A few nights later, they went to their favorite Mexican restaurant in Hillcrest.'],
    ['juan','Character performance — Juan Delgado','character-performance-juan-delgado','Oh, come on, Cowboy. You know you love a good night out.'],
    ['michael','Character performance — Michael Rawlins','character-performance-michael-rawlins','Rent has gone up enough that a mortgage almost sounds reasonable.'],
    ['christopher','Character performance — Christopher Lancaster','character-performance-christopher-lancaster','Too late. He is already gone. Short shorts and that strut.']
  ].map(([id,label,purpose,text], index) => ({ id, label, purpose, text, index:index+1, chapterOrder:index+1, source:'canonical-manuscript' }));

  const voice = (name,id,owner,cultural=true) => ({
    id:`cand-${id}`, rank:1, recommendation:'AUDITION',
    voice:{provider:'elevenlabs',providerVoiceId:id,publicOwnerId:owner,name,age:'young',accent:'american',locale:'en-US',useCase:'conversational'},
    combinedScore:90,
    culturalFit:{applicable:true,requirementMet:cultural,score:cultural?100:30},
    tasteFit:{applicable:true,score:95,profileVersion:'book-one-human-v1'}
  });

  return {
    schemaVersion:1, release:'0.14.3.7', status:'READY_FOR_OPERATOR_REVIEW', castingMode:'single-narrator',
    artifactFingerprint:'direction-discovery-fixture', book:{id:'book1',title:'Tres Amigos, Una Vida',author:'D.C.W.',sourceHash:'abc'},
    shortlists:[{character:'Narrator',role:'narrator',candidates:[
      voice('Ryan Kurk - Pleasant and Smooth','ryan','owner-ryan',false),
      voice('Hale - Expressive, Deep and Emotive','hale','owner-hale',false),
      voice('Sebastian','seb','owner-seb',true)
    ]}],
    auditionSamples:{status:'READY',samples:[{character:'Narrator',role:'narrator',scripts}]}
  };
}

async function sourcePlan() {
  return buildRealAuditionPlan({
    discovery: discoveryFixture(),
    selectedVoiceIds:['ryan','hale','seb'],
    estimator: async ({text,model}) => ({amountUsd:Number((text.length*0.0001).toFixed(6)),characters:text.length,model})
  });
}

function feedback(plan) {
  return {
    schemaVersion:1, release:'0.14.3.7', artifact:'book-one-real-audition-human-feedback',
    planFingerprint:plan.integrity.planFingerprint,
    feedback:[
      {providerVoiceId:'ryan',name:'Ryan Kurk - Pleasant and Smooth',decision:'keep',ratings:{narration:null,juan:null,michael:null,christopher:null,overall:null},notes:'The best one, just wish it was a little gayer and he sounds younger which works.'},
      {providerVoiceId:'hale',name:'Hale - Expressive, Deep and Emotive',decision:'maybe',ratings:{narration:null,juan:null,michael:null,christopher:null,overall:null},notes:'Juan is yelling at me and it is LOUD. lol'},
      {providerVoiceId:'seb',name:'Sebastian',decision:'pass',ratings:{narration:null,juan:null,michael:null,christopher:null,overall:null},notes:'Live in a box and echoes'}
    ]
  };
}

function fakeProvider({ tier='creator' }={}) {
  const state={renders:[],imports:[]};
  return {
    state,
    async getSubscription(){return {tier,status:'active'}},
    async healthCheck(){return {ok:true}},
    async estimateCost({text,model}){return {amountUsd:Number((text.length*0.0001).toFixed(6)),characters:text.length,model}},
    async importSharedVoice({publicOwnerId,voiceId,name}){state.imports.push({publicOwnerId,voiceId,name});return {voice_id:voiceId}},
    async listSavedVoices(){return {voices:[]}},
    async render({voiceId,text,model}){state.renders.push({voiceId,text,model});return {audio:new Uint8Array([1,2,3]),mediaType:'audio/mpeg',billedCharacters:text.length,estimatedCostUsd:Number((text.length*0.0001).toFixed(6)),requestId:`req-${state.renders.length}`}}
  };
}

test('0.14.3.19 is current application provenance',()=>assert.equal(YASREADY_AUDIOBOOKS_VERSION,'0.14.3.19'));

test('real human notes become delivery signals without identity inference', async()=>{
  const plan=await sourcePlan();
  const learned=deriveHumanTasteLearning({feedback:feedback(plan),sourcePlan:plan});
  assert.equal(learned.primaryVoice.providerVoiceId,'ryan');
  assert.deepEqual(learned.preferredVoiceIds,['ryan']);
  assert.deepEqual(learned.comparatorVoiceIds,['hale']);
  assert.deepEqual(learned.rejectedVoiceIds,['seb']);
  assert.ok(learned.desiredPerformanceSignals.includes('increase-playful-flirty-queer-romance-energy'));
  assert.ok(learned.desiredPerformanceSignals.includes('preserve-youthful-energy'));
  assert.equal(learned.learningPolicy.ethnicityOrOrientationInferredFromAudio,false);
  assert.equal(learned.learningPolicy.acousticEmbeddingLearningPerformed,false);
});

test('direction plan gives Ryan three variants, Hale one corrective variant, Sebastian none', async()=>{
  const plan=await sourcePlan();
  const direction=await buildPerformanceDirectionPlan({
    sourcePlan:plan,feedback:feedback(plan),
    estimator:async({text,model})=>({amountUsd:Number((text.length*0.0001).toFixed(6)),characters:text.length,model})
  });
  assert.equal(direction.model,'eleven_v3');
  assert.equal(direction.variants.filter(x=>x.providerVoiceId==='ryan').length,3);
  assert.equal(direction.variants.filter(x=>x.providerVoiceId==='hale').length,1);
  assert.equal(direction.variants.filter(x=>x.providerVoiceId==='seb').length,0);
  assert.equal(direction.renderItems.length,20);
  assert.ok(direction.cost.suggestedMaxUsd<=PERFORMANCE_DIRECTION_HARD_CEILING_USD);
  assert.match(direction.confirmation.token,/^DIRECTION-[A-F0-9]{10}$/);
  assert.equal(verifyPerformanceDirectionPlan(direction),true);
});

test('provider-directed text never encodes identity labels as audio tags', async()=>{
  const plan=await sourcePlan();
  const direction=await buildPerformanceDirectionPlan({
    sourcePlan:plan,feedback:feedback(plan),
    estimator:async({text,model})=>({amountUsd:Number((text.length*0.0001).toFixed(6)),characters:text.length,model})
  });
  const text=direction.renderItems.map(x=>x.directedText).join('\n');
  assert.doesNotMatch(text,/\[(?:gay|queer|latino|hispanic|asian|black|white)[^\]]*\]/i);
  assert.match(text,/\[playfully\]|\[mischievously\]/);
  assert.match(text,/\[calm\]|\[softly\]/);
});

test('free-tier preflight blocks before imports or TTS', async()=>{
  const source=await sourcePlan();
  const direction=await buildPerformanceDirectionPlan({
    sourcePlan:source,feedback:feedback(source),
    estimator:async({text,model})=>({amountUsd:Number((text.length*0.0001).toFixed(6)),characters:text.length,model})
  });
  const provider=fakeProvider({tier:'free'});
  const out=await mkdtemp(path.join(os.tmpdir(),'yas-direction-'));
  await assert.rejects(
    renderPerformanceDirectionRound({plan:direction,provider,outDir:out,approvalToken:direction.confirmation.token,maxUsd:direction.cost.suggestedMaxUsd}),
    /paid subscription.*No audio was generated/i
  );
  assert.equal(provider.state.imports.length,0);
  assert.equal(provider.state.renders.length,0);
});

test('creator-tier approved round renders 20 clips and writes human review board', async()=>{
  const source=await sourcePlan();
  const direction=await buildPerformanceDirectionPlan({
    sourcePlan:source,feedback:feedback(source),
    estimator:async({text,model})=>({amountUsd:Number((text.length*0.0001).toFixed(6)),characters:text.length,model})
  });
  const provider=fakeProvider({tier:'creator'});
  const out=await mkdtemp(path.join(os.tmpdir(),'yas-direction-'));
  const result=await renderPerformanceDirectionRound({plan:direction,provider,outDir:out,approvalToken:direction.confirmation.token,maxUsd:direction.cost.suggestedMaxUsd});
  assert.equal(result.status,'READY_FOR_HUMAN_REVIEW');
  assert.equal(result.providerGenerationCalls,20);
  assert.equal(result.productionGenerationCalls,0);
  assert.equal(result.castLocksCreated,0);
  assert.equal(provider.state.renders.length,20);
  assert.ok(provider.state.renders.every(x=>x.model==='eleven_v3'));
  await stat(path.join(out,'performance-direction-review.html'));
  const html=await readFile(path.join(out,'performance-direction-review.html'),'utf8');
  assert.match(html,/Same Book One material/);
  assert.match(html,/Download Direction Feedback/);
  assert.match(html,/Copy Feedback JSON/);
  assert.doesNotMatch(html,/ELEVENLABS_API_KEY/i);
});

test('direction feedback promotes explicit Best variant into next human taste profile', async()=>{
  const source=await sourcePlan();
  const direction=await buildPerformanceDirectionPlan({
    sourcePlan:source,feedback:feedback(source),
    estimator:async({text,model})=>({amountUsd:Number((text.length*0.0001).toFixed(6)),characters:text.length,model})
  });
  const outFeedback={
    schemaVersion:1,artifact:'book-one-performance-direction-human-feedback',planFingerprint:direction.integrity.planFingerprint,
    feedback:direction.variants.map(v=>({
      providerVoiceId:v.providerVoiceId,candidateName:v.candidateName,variantId:v.id,variantLabel:v.label,
      decision:v.providerVoiceId==='ryan'&&v.id==='playful-flirty'?'best':'pass',
      ratings:v.id==='playful-flirty'?{narration:5,juan:5,michael:4,christopher:5,overall:5}:{},
      notes:v.id==='playful-flirty'?'This is it.':''
    }))
  };
  const summary=summarizePerformanceDirectionFeedback({feedback:outFeedback,plan:direction});
  assert.equal(summary.winner.providerVoiceId,'ryan');
  assert.equal(summary.winner.variantId,'playful-flirty');
  assert.equal(summary.nextHumanTasteProfile.identityInferredFromAudio,false);
  assert.match(summary.nextAction,/production-readiness gate/i);
});
