import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  YASREADY_AUDIOBOOKS_VERSION,
  sha256,
  stableJson,
  buildReadinessTuningPlan,
  verifyReadinessTuningPlan,
  deriveReadinessTuningSignals,
  renderReadinessTuningRound,
  renderReadinessTuningReviewHtml,
  finalizeReadinessTuning,
  READINESS_TUNING_HARD_CEILING_USD
} from '../src/index.js';

function readinessPlanFixture() {
  const plan = {
    schemaVersion:1,
    release:'0.14.3.9',
    artifact:'book-one-production-readiness-plan',
    status:'READY_FOR_EXPLICIT_APPROVAL',
    book:{
      id:'book1',
      title:'Tres Amigos, Una Vida – A Throuple Love Story',
      author:'D.C.W.',
      sourceHash:'book-one-hash'
    },
    learning:{
      sourcePlanFingerprint:'direction-plan',
      providerVoiceId:'rU18Fk3uSDhmg5Xh41o4',
      candidateName:'Ryan Kurk - Pleasant and Smooth',
      preferredDirectionId:'playful-flirty',
      preferredDirectionLabel:'Playful + Flirty',
      humanNote:"Best version. Younger, playful and flirty feels right for the book. Keep this overall energy, but don't overplay the character voices.",
      explicitHumanWinner:true
    },
    model:'eleven_v3',
    outputFormat:'mp3_44100_128',
    sample:{
      chapterOrder:37,
      chapterTitle:'Chapter 37 – DJ Booths & Sunday Funday',
      sceneOrder:0,
      startSegmentOrder:0,
      endSegmentOrder:18,
      wordCount:195,
      estimatedSecondsAt155Wpm:75.5,
      dialogueSegments:12,
      narrationSegments:7,
      narrationBeforeDialogue:true,
      narrationAfterDialogue:true,
      speakerNames:['Dani','Alex','Nick','Christopher','Drew','Evan','Michael','Juan'],
      coreSpeakers:['christopher','michael','juan'],
      score:200,
      segments:[
        {order:0,kind:'narration',text:'The room was already buzzing by the time they arrived.',speakerCandidate:null},
        {order:1,kind:'dialogue',text:'You made it.',speakerCandidate:{name:'Juan'}},
        {order:2,kind:'narration',text:'Michael laughed and leaned against the booth.',speakerCandidate:null},
        {order:3,kind:'dialogue',text:'Barely.',speakerCandidate:{name:'Michael'}},
        {order:4,kind:'narration',text:'Christopher lifted his drink toward them.',speakerCandidate:null}
      ]
    },
    script:{
      directedText:'[warmly] The room was already buzzing by the time they arrived.\n\n[playfully] “You made it.”\n\nMichael laughed and leaned against the booth.\n\n[warmly] “Barely.”\n\nChristopher lifted his drink toward them.',
      directionMap:[],
      policy:{
        overallTarget:'younger, playful, flirty, warm queer-romance energy',
        restraint:'keep character voices natural and distinct without overplaying them',
        narrator:'warm, contemporary, conversational',
        juan:'playful and charismatic; never shouty',
        michael:'warm and grounded; subtle Oklahoma coloration only',
        christopher:'polished, playful, confident; contemporary California',
        identityInferenceFromAudio:false
      }
    },
    cost:{
      estimateUsd:.13,
      reserveUsd:.04,
      suggestedMaxUsd:.17,
      hardCeilingUsd:1,
      estimatedCharacters:500,
      estimatedGenerationCalls:1,
      roundingPolicy:'protected-max-ceil-to-cent'
    },
    guardrails:{
      planningProviderGenerationCalls:0,
      explicitApprovalRequired:true,
      exactPlanFingerprintRequired:true,
      maxUsdRequiredAtRender:true,
      providerSubscriptionPreflightRequired:true,
      oneReadinessGenerationCallOnly:true,
      humanPassRequiredForNarratorProductionLock:true,
      productionGenerationArmed:false,
      narratorProductionLockCreated:false,
      fullBookGenerationArmed:false,
      identityInferenceFromAudio:false
    }
  };
  const core = {
    schemaVersion:plan.schemaVersion,
    release:plan.release,
    artifact:plan.artifact,
    book:plan.book,
    learning:plan.learning,
    model:plan.model,
    outputFormat:plan.outputFormat,
    sample:plan.sample,
    script:plan.script,
    cost:plan.cost,
    guardrails:plan.guardrails
  };
  const fingerprint=sha256(stableJson(core));
  return {
    ...plan,
    integrity:{planFingerprint:fingerprint},
    confirmation:{token:`READINESS-${fingerprint.slice(0,10).toUpperCase()}`,instruction:'fixture'}
  };
}

function finalizationFixture(overrides={}) {
  return {
    schemaVersion:1,
    release:'0.14.3.9',
    artifact:'book-one-production-readiness-finalization',
    status:'NEEDS_TUNING',
    decision:'needs-tuning',
    book:readinessPlanFixture().book,
    narratorProductionLockCreated:false,
    productionArmed:false,
    fullBookGenerationArmed:false,
    notes:'It could be a little faster because it feels too slow and a little bit more emotions otherwise it sounds really nice.',
    nextAction:'Tune the winning performance direction and run another readiness sample. Do not generate the full book.',
    ...overrides
  };
}

const estimator = async ({text,model})=>({
  amountUsd:Number(((text.length/1000)*.10).toFixed(6)),
  characters:text.length,
  model,
  rateUsdPer1k:.10,
  estimated:true
});

async function tuningPlanFixture() {
  return buildReadinessTuningPlan({
    readinessPlan:readinessPlanFixture(),
    readinessFinalization:finalizationFixture(),
    estimator
  });
}

function providerFixture({tier='creator',failOnCall=null}={}) {
  const state={attempts:0,renders:[]};
  return {
    state,
    async subscriptionPreflight(){return {available:true,safeToContinue:true,tier,subscription:{tier}}},
    async healthCheck(){return {ok:true,status:200}},
    async listSavedVoices(){return {voices:[{providerVoiceId:'rU18Fk3uSDhmg5Xh41o4',name:'Ryan Kurk - Pleasant and Smooth'}]}},
    async render({voiceId,text,model,voiceSettings,seed}){
      state.attempts+=1;
      if(failOnCall===state.attempts) throw new Error(`fixture provider failure ${state.attempts}`);
      state.renders.push({voiceId,text,model,voiceSettings,seed});
      return {
        audio:new Uint8Array([1,2,3,4,state.attempts]),
        billedCharacters:text.length,
        estimatedCostUsd:Number(((text.length/1000)*.10).toFixed(6)),
        requestId:`tuning-${state.attempts}`
      };
    }
  };
}

test('0.14.3.18.1 is current application provenance',()=>{
  assert.equal(YASREADY_AUDIOBOOKS_VERSION,'0.14.3.18.1');
});

test('human readiness note becomes narrow pace/emotion signals without identity inference',()=>{
  const signals=deriveReadinessTuningSignals(finalizationFixture().notes);
  assert.ok(signals.includes('increase-pace-slightly'));
  assert.ok(signals.includes('increase-emotional-expression-slightly'));
  assert.ok(signals.includes('preserve-core-performance'));
  assert.ok(signals.includes('make-adjustments-subtle'));
  assert.ok(!signals.some((x)=>/gay|queer|latino|ethnic|identity/i.test(x)));
});

test('tuning plan preserves same narrator, same scene and winning direction',async()=>{
  const readiness=readinessPlanFixture();
  const plan=await tuningPlanFixture();
  assert.equal(plan.narrator.providerVoiceId,readiness.learning.providerVoiceId);
  assert.equal(plan.sample.chapterTitle,readiness.sample.chapterTitle);
  assert.equal(plan.sample.sceneOrder,readiness.sample.sceneOrder);
  assert.equal(plan.baselineDirection.directionId,'playful-flirty');
  assert.equal(plan.baselineDirection.directedText,readiness.script.directedText);
  assert.equal(plan.guardrails.planningProviderGenerationCalls,0);
  assert.equal(plan.guardrails.fullBookGenerationArmed,false);
  assert.equal(verifyReadinessTuningPlan(plan),true);
});

test('tuning plan builds exactly three controlled variants with isolated speed/emotion changes',async()=>{
  const plan=await tuningPlanFixture();
  assert.deepEqual(plan.variants.map((x)=>x.id),['faster-emotional','faster-only','emotional-only']);
  assert.deepEqual(plan.variants[0].voiceSettings,{speed:1.08,stability:.42});
  assert.deepEqual(plan.variants[1].voiceSettings,{speed:1.08});
  assert.deepEqual(plan.variants[2].voiceSettings,{stability:.42});
  assert.equal(plan.cost.estimatedGenerationCalls,3);
  assert.ok(plan.cost.suggestedMaxUsd<=READINESS_TUNING_HARD_CEILING_USD);
  assert.match(plan.confirmation.token,/^TUNING-[A-F0-9]{10}$/);
});

test('tuning plan refuses anything except NEEDS_TUNING finalization',async()=>{
  await assert.rejects(
    buildReadinessTuningPlan({
      readinessPlan:readinessPlanFixture(),
      readinessFinalization:finalizationFixture({status:'PASSED',decision:'pass'}),
      estimator
    }),
    /requires a NEEDS_TUNING/i
  );
});

test('wrong tuning approval token blocks before provider generation',async()=>{
  const plan=await tuningPlanFixture();
  const provider=providerFixture();
  const out=await mkdtemp(path.join(os.tmpdir(),'yas-tuning-token-'));
  await assert.rejects(
    renderReadinessTuningRound({plan,provider,outDir:out,approvalToken:'TUNING-WRONG',maxUsd:plan.cost.suggestedMaxUsd}),
    /token mismatch/i
  );
  assert.equal(provider.state.attempts,0);
});

test('free tier blocks before tuning generation',async()=>{
  const plan=await tuningPlanFixture();
  const provider=providerFixture({tier:'free'});
  const out=await mkdtemp(path.join(os.tmpdir(),'yas-tuning-free-'));
  await assert.rejects(
    renderReadinessTuningRound({plan,provider,outDir:out,approvalToken:plan.confirmation.token,maxUsd:plan.cost.suggestedMaxUsd}),
    /paid subscription.*No audio was generated/i
  );
  assert.equal(provider.state.attempts,0);
});

test('approved tuning round renders three clips with identical text and controlled voice settings',async()=>{
  const plan=await tuningPlanFixture();
  const provider=providerFixture();
  const out=await mkdtemp(path.join(os.tmpdir(),'yas-tuning-render-'));
  const result=await renderReadinessTuningRound({
    plan,provider,outDir:out,approvalToken:plan.confirmation.token,maxUsd:plan.cost.suggestedMaxUsd
  });
  assert.equal(result.status,'READY_FOR_HUMAN_TUNING_REVIEW');
  assert.equal(result.providerGenerationCalls,3);
  assert.equal(result.currentRunProviderGenerationCalls,3);
  assert.equal(result.productionGenerationCalls,0);
  assert.equal(result.fullBookGenerationArmed,false);
  assert.equal(provider.state.renders.length,3);
  assert.ok(provider.state.renders.every((x)=>x.text===plan.baselineDirection.directedText));
  assert.deepEqual(provider.state.renders.map((x)=>x.voiceSettings),[
    {speed:1.08,stability:.42},{speed:1.08},{stability:.42}
  ]);
  await stat(path.join(out,'readiness-tuning-review.html'));
});

test('partial failure resumes without paying again for completed tuning clips',async()=>{
  const plan=await tuningPlanFixture();
  const out=await mkdtemp(path.join(os.tmpdir(),'yas-tuning-resume-'));
  const first=providerFixture({failOnCall:2});
  await assert.rejects(
    renderReadinessTuningRound({
      plan,provider:first,outDir:out,approvalToken:plan.confirmation.token,maxUsd:plan.cost.suggestedMaxUsd
    }),
    /fixture provider failure/
  );
  assert.equal(first.state.renders.length,1);

  const second=providerFixture();
  const result=await renderReadinessTuningRound({
    plan,provider:second,outDir:out,approvalToken:plan.confirmation.token,maxUsd:plan.cost.suggestedMaxUsd
  });
  assert.equal(second.state.renders.length,2);
  assert.equal(result.providerGenerationCalls,3);
  assert.equal(result.currentRunProviderGenerationCalls,2);
  assert.equal(result.reusedClips,1);
});

test('tuning review board exposes PASS/MAYBE/FAIL plus durable export fallback',async()=>{
  const plan=await tuningPlanFixture();
  const fakeResult={
    rendered:plan.variants.map((v,i)=>({variantId:v.id,outputRelativePath:`audio/0${i+1}-${v.id}.mp3`}))
  };
  const html=renderReadinessTuningReviewHtml(plan,fakeResult);
  assert.match(html,/Same Ryan/);
  assert.match(html,/PASS — Lock/);
  assert.match(html,/MAYBE/);
  assert.match(html,/FAIL/);
  assert.match(html,/Download Tuning Feedback/);
  assert.match(html,/Copy Feedback JSON/);
  assert.match(html,/showSaveFilePicker/);
});

test('one human PASS creates tuned narrator production lock while full-book generation remains off',async()=>{
  const plan=await tuningPlanFixture();
  const feedback={
    artifact:'book-one-readiness-tuning-human-feedback',
    planFingerprint:plan.integrity.planFingerprint,
    feedback:plan.variants.map((v)=>({
      variantId:v.id,
      decision:v.id==='faster-emotional'?'pass':'fail',
      notes:v.id==='faster-emotional'?'This is it. Pace and emotion both feel right.':''
    }))
  };
  const result=finalizeReadinessTuning({plan,feedback});
  assert.equal(result.status,'PASSED');
  assert.equal(result.narratorProductionLockCreated,true);
  assert.equal(result.productionArmed,false);
  assert.equal(result.fullBookGenerationArmed,false);
  assert.equal(result.winner.variantId,'faster-emotional');
  assert.deepEqual(result.narratorProductionLock.performanceProfile.voiceSettings,{speed:1.08,stability:.42});
  assert.equal(result.narratorProductionLock.performanceProfile.baseDirectionId,'playful-flirty');
  assert.match(result.narratorProductionLock.lockDigest,/^[a-f0-9]{64}$/);
});

test('MAYBE keeps tuning open and creates no narrator lock',async()=>{
  const plan=await tuningPlanFixture();
  const feedback={
    artifact:'book-one-readiness-tuning-human-feedback',
    planFingerprint:plan.integrity.planFingerprint,
    feedback:plan.variants.map((v)=>({
      variantId:v.id,
      decision:v.id==='faster-only'?'maybe':'fail',
      notes:''
    }))
  };
  const result=finalizeReadinessTuning({plan,feedback});
  assert.equal(result.status,'NEEDS_TUNING');
  assert.equal(result.narratorProductionLockCreated,false);
  assert.equal(result.fullBookGenerationArmed,false);
});

test('multiple PASS choices fail closed instead of silently choosing a tuning winner',async()=>{
  const plan=await tuningPlanFixture();
  const feedback={
    artifact:'book-one-readiness-tuning-human-feedback',
    planFingerprint:plan.integrity.planFingerprint,
    feedback:plan.variants.map((v,i)=>({
      variantId:v.id,
      decision:i<2?'pass':'fail',
      notes:''
    }))
  };
  assert.throws(()=>finalizeReadinessTuning({plan,feedback}),/only one PASS/i);
});
