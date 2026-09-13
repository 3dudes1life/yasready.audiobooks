import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  YASREADY_AUDIOBOOKS_VERSION,
  sha256,
  stableJson,
  deriveEmotionalLiftSignals,
  selectEmotionalLiftAnchor,
  buildEmotionalLiftPlan,
  verifyEmotionalLiftPlan,
  renderEmotionalLiftRound,
  renderEmotionalLiftReviewHtml,
  finalizeEmotionalLift,
  EMOTIONAL_LIFT_HARD_CEILING_USD,
  EMOTIONAL_LIFT_SPEED
} from '../src/index.js';

function tuningPlanFixture() {
  const plan = {
    schemaVersion:1,
    release:'0.14.3.10',
    artifact:'book-one-readiness-tuning-plan',
    status:'READY_FOR_EXPLICIT_APPROVAL',
    sensitiveLocalArtifact:true,
    doNotCommit:true,
    book:{
      id:'book1',
      title:'Tres Amigos, Una Vida – A Throuple Love Story',
      author:'D.C.W.',
      sourceHash:'book-one-hash'
    },
    sourceReadiness:{
      planFingerprint:'readiness-fingerprint',
      finalizationRelease:'0.14.3.9',
      finalizationStatus:'NEEDS_TUNING',
      finalizationDecision:'needs-tuning',
      legacyFinalizationPlanFingerprintMissing:true
    },
    narrator:{
      provider:'elevenlabs',
      providerVoiceId:'rU18Fk3uSDhmg5Xh41o4',
      candidateName:'Ryan Kurk - Pleasant and Smooth'
    },
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
      segments:[]
    },
    baselineDirection:{
      directionId:'playful-flirty',
      directionLabel:'Playful + Flirty',
      humanLearningNote:"Best version. Younger, playful and flirty feels right for the book. Keep this overall energy, but don't overplay the character voices.",
      scriptPolicy:{
        overallTarget:'younger, playful, flirty, warm queer-romance energy',
        restraint:'keep character voices natural and distinct without overplaying them',
        narrator:'warm, contemporary, conversational',
        juan:'playful and charismatic; never shouty',
        michael:'warm and grounded; subtle Oklahoma coloration only',
        christopher:'polished, playful, confident; contemporary California',
        identityInferenceFromAudio:false
      },
      directedText:'[warmly] The room was already buzzing by the time they arrived.\n\n[playfully] “You made it.”\n\nMichael laughed and leaned against the booth.\n\n[warmly] “Barely.”\n\nChristopher lifted his drink toward them.',
      directedTextDigest:'directed-text-digest'
    },
    operatorTuning:{
      note:'It could be a little faster because it feels too slow and a little bit more emotions otherwise it sounds really nice.',
      signals:['increase-pace-slightly','increase-emotional-expression-slightly','preserve-core-performance','make-adjustments-subtle'],
      policy:{
        preserveNarratorVoice:true,
        preserveWinningDirection:true,
        preserveSameScene:true,
        noNewCastingSearch:true,
        noIdentityInferenceFromAudio:true,
        avoidTheatricalOvercorrection:true
      }
    },
    model:'eleven_v3',
    outputFormat:'mp3_44100_128',
    variants:[
      {
        id:'faster-emotional',
        label:'Faster + More Emotional',
        goal:'Speed the same winning performance up slightly and allow a little more emotional range without becoming theatrical.',
        voiceSettings:{speed:1.08,stability:.42},
        isolatedChange:'pace + emotional range',
        seed:73101
      },
      {
        id:'faster-only',
        label:'Faster Only',
        goal:'Test whether pace was the main issue while otherwise preserving the winning performance.',
        voiceSettings:{speed:1.08},
        isolatedChange:'pace only',
        seed:73102
      },
      {
        id:'emotional-only',
        label:'More Emotional Only',
        goal:'Test a slightly broader emotional range while preserving the existing pace.',
        voiceSettings:{stability:.42},
        isolatedChange:'emotional range only',
        seed:73103
      }
    ],
    cost:{
      estimateUsd:.40,
      reserveUsd:.10,
      suggestedMaxUsd:.51,
      hardCeilingUsd:1,
      estimatedGenerationCalls:3,
      estimates:[
        {variantId:'faster-emotional',amountUsd:.133,characters:1330,rateUsdPer1k:.1},
        {variantId:'faster-only',amountUsd:.133,characters:1330,rateUsdPer1k:.1},
        {variantId:'emotional-only',amountUsd:.133,characters:1330,rateUsdPer1k:.1}
      ],
      roundingPolicy:'protected-max-ceil-to-cent'
    },
    guardrails:{
      planningProviderGenerationCalls:0,
      explicitApprovalRequired:true,
      exactPlanFingerprintRequired:true,
      maxUsdRequiredAtRender:true,
      providerSubscriptionPreflightRequired:true,
      sameNarratorRequired:true,
      sameSceneRequired:true,
      exactlyThreeTuningVariants:true,
      resumableCompletedVariantReuse:true,
      humanPassRequiredForNarratorProductionLock:true,
      productionGenerationArmed:false,
      narratorProductionLockCreated:false,
      fullBookGenerationArmed:false,
      identityInferenceFromAudio:false
    }
  };
  const core={
    schemaVersion:plan.schemaVersion,release:plan.release,artifact:plan.artifact,status:plan.status,
    book:plan.book,sourceReadiness:plan.sourceReadiness,narrator:plan.narrator,sample:plan.sample,
    baselineDirection:plan.baselineDirection,operatorTuning:plan.operatorTuning,model:plan.model,
    outputFormat:plan.outputFormat,variants:plan.variants,cost:plan.cost,guardrails:plan.guardrails
  };
  const fingerprint=sha256(stableJson(core));
  return {
    ...plan,
    integrity:{planFingerprint:fingerprint},
    confirmation:{token:`TUNING-${fingerprint.slice(0,10).toUpperCase()}`,instruction:'fixture'}
  };
}

function finalizationFixture(overrides={}) {
  const source=tuningPlanFixture();
  return {
    schemaVersion:1,
    release:'0.14.3.10',
    artifact:'book-one-readiness-tuning-finalization',
    status:'NEEDS_TUNING',
    decision:'maybe',
    book:source.book,
    narratorProductionLockCreated:false,
    productionArmed:false,
    fullBookGenerationArmed:false,
    choices:[
      {
        variantId:'faster-emotional',
        variantLabel:'Faster + More Emotional',
        decision:'maybe',
        notes:'I like this ones pace but I feel like it could have more emotions.'
      },
      {
        variantId:'faster-only',
        variantLabel:'Faster Only',
        decision:'maybe',
        notes:'Feels like no emotions just speed reading through.'
      },
      {
        variantId:'emotional-only',
        variantLabel:'More Emotional Only',
        decision:'fail',
        notes:'I like the tone but it just feels kinda slow.'
      }
    ],
    nextAction:'Keep tuning the preferred variant. No narrator lock was created and full-book generation remains off.',
    ...overrides
  };
}

const estimator=async({text,model})=>({
  amountUsd:Number(((text.length/1000)*.10).toFixed(6)),
  characters:text.length,
  model,
  rateUsdPer1k:.10,
  estimated:true
});

async function planFixture() {
  return buildEmotionalLiftPlan({
    tuningPlan:tuningPlanFixture(),
    tuningFinalization:finalizationFixture(),
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
        requestId:`emotion-${state.attempts}`
      };
    }
  };
}

test('0.14.3.11 is current application provenance',()=>{
  assert.equal(YASREADY_AUDIOBOOKS_VERSION,'0.14.3.11');
});

test('prior human feedback becomes fine-line emotional signals',()=>{
  const signals=deriveEmotionalLiftSignals(finalizationFixture().choices);
  assert.ok(signals.includes('lock-faster-pace'));
  assert.ok(signals.includes('increase-emotional-range'));
  assert.ok(signals.includes('do-not-revert-to-slower-pace'));
  assert.ok(signals.includes('avoid-flat-fast-delivery'));
  assert.ok(signals.includes('preserve-core-tone'));
});

test('anchor selection chooses Faster + More Emotional over flat Faster Only',()=>{
  const anchor=selectEmotionalLiftAnchor(tuningPlanFixture(),finalizationFixture());
  assert.equal(anchor.variantId,'faster-emotional');
  assert.equal(anchor.lockedSpeed,1.08);
  assert.equal(anchor.sourceStability,.42);
  assert.match(anchor.humanNote,/like this ones pace/i);
  assert.ok(anchor.otherMaybeEvidence.some((x)=>x.variantId==='faster-only'));
});

test('Emotional Lift requires a NEEDS_TUNING MAYBE finalization',async()=>{
  await assert.rejects(
    buildEmotionalLiftPlan({
      tuningPlan:tuningPlanFixture(),
      tuningFinalization:finalizationFixture({status:'PASSED',decision:'pass'}),
      estimator
    }),
    /requires a NEEDS_TUNING/i
  );
});

test('plan locks pace at 1.08 and varies only emotional stability',async()=>{
  const plan=await planFixture();
  assert.equal(plan.anchor.lockedSpeed,EMOTIONAL_LIFT_SPEED);
  assert.deepEqual(plan.variants.map((v)=>v.voiceSettings.speed),[1.08,1.08,1.08]);
  assert.deepEqual(plan.variants.map((v)=>v.voiceSettings.stability),[.36,.30,.24]);
  assert.deepEqual(plan.variants.map((v)=>v.id),['gentle-emotional-lift','warm-expressive','deep-controlled-emotion']);
});

test('plan carries an emotional dynamic-range policy instead of constant intensity',async()=>{
  const plan=await planFixture();
  assert.match(plan.emotionalPolicy.dynamicRangePolicy.principle,/emotion follows the scene/i);
  assert.match(plan.emotionalPolicy.dynamicRangePolicy.romanticIntimate,/tenderness|vulnerability/i);
  assert.match(plan.emotionalPolicy.dynamicRangePolicy.conflictGriefHighEmotion,/deeper feeling/i);
  assert.match(plan.emotionalPolicy.dynamicRangePolicy.restraint,/never make every line intense/i);
  assert.equal(plan.emotionalPolicy.identityInferenceFromAudio,false);
});

test('Emotional Lift planning is zero-spend, immutable and under the hard ceiling',async()=>{
  const plan=await planFixture();
  assert.equal(plan.status,'READY_FOR_EXPLICIT_APPROVAL');
  assert.equal(plan.cost.estimatedGenerationCalls,3);
  assert.equal(plan.guardrails.planningProviderGenerationCalls,0);
  assert.equal(plan.guardrails.productionGenerationArmed,false);
  assert.equal(plan.guardrails.fullBookGenerationArmed,false);
  assert.ok(plan.cost.suggestedMaxUsd<=EMOTIONAL_LIFT_HARD_CEILING_USD);
  assert.match(plan.confirmation.token,/^EMOTION-[A-F0-9]{10}$/);
  assert.equal(verifyEmotionalLiftPlan(plan),true);
});

test('wrong Emotional Lift token blocks before provider generation',async()=>{
  const plan=await planFixture();
  const provider=providerFixture();
  const out=await mkdtemp(path.join(os.tmpdir(),'yas-emotion-token-'));
  await assert.rejects(
    renderEmotionalLiftRound({plan,provider,outDir:out,approvalToken:'EMOTION-WRONG',maxUsd:plan.cost.suggestedMaxUsd}),
    /token mismatch/i
  );
  assert.equal(provider.state.attempts,0);
});

test('free tier blocks before Emotional Lift generation',async()=>{
  const plan=await planFixture();
  const provider=providerFixture({tier:'free'});
  const out=await mkdtemp(path.join(os.tmpdir(),'yas-emotion-free-'));
  await assert.rejects(
    renderEmotionalLiftRound({plan,provider,outDir:out,approvalToken:plan.confirmation.token,maxUsd:plan.cost.suggestedMaxUsd}),
    /paid subscription.*No audio was generated/i
  );
  assert.equal(provider.state.attempts,0);
});

test('approved Emotional Lift renders three same-text clips at locked speed',async()=>{
  const plan=await planFixture();
  const provider=providerFixture();
  const out=await mkdtemp(path.join(os.tmpdir(),'yas-emotion-render-'));
  const result=await renderEmotionalLiftRound({
    plan,provider,outDir:out,approvalToken:plan.confirmation.token,maxUsd:plan.cost.suggestedMaxUsd
  });
  assert.equal(result.status,'READY_FOR_HUMAN_EMOTIONAL_REVIEW');
  assert.equal(result.providerGenerationCalls,3);
  assert.equal(result.currentRunProviderGenerationCalls,3);
  assert.equal(result.productionGenerationCalls,0);
  assert.equal(result.fullBookGenerationArmed,false);
  assert.equal(provider.state.renders.length,3);
  assert.ok(provider.state.renders.every((x)=>x.text===plan.baselineDirection.directedText));
  assert.deepEqual(provider.state.renders.map((x)=>x.voiceSettings.speed),[1.08,1.08,1.08]);
  assert.deepEqual(provider.state.renders.map((x)=>x.voiceSettings.stability),[.36,.30,.24]);
  await stat(path.join(out,'emotional-lift-review.html'));
});

test('partial Emotional Lift failure resumes without regenerating completed paid clips',async()=>{
  const plan=await planFixture();
  const out=await mkdtemp(path.join(os.tmpdir(),'yas-emotion-resume-'));
  const first=providerFixture({failOnCall:2});
  await assert.rejects(
    renderEmotionalLiftRound({plan,provider:first,outDir:out,approvalToken:plan.confirmation.token,maxUsd:plan.cost.suggestedMaxUsd}),
    /fixture provider failure/
  );
  assert.equal(first.state.renders.length,1);

  const second=providerFixture();
  const result=await renderEmotionalLiftRound({
    plan,provider:second,outDir:out,approvalToken:plan.confirmation.token,maxUsd:plan.cost.suggestedMaxUsd
  });
  assert.equal(second.state.renders.length,2);
  assert.equal(result.providerGenerationCalls,3);
  assert.equal(result.currentRunProviderGenerationCalls,2);
  assert.equal(result.reusedClips,1);
});

test('Emotional Lift review tells the operator to judge natural range, not maximum emotion',async()=>{
  const plan=await planFixture();
  const fakeResult={rendered:plan.variants.map((v,i)=>({variantId:v.id,outputRelativePath:`audio/0${i+1}-${v.id}.mp3`}))};
  const html=renderEmotionalLiftReviewHtml(plan,fakeResult);
  assert.match(html,/Find the emotional sweet spot/);
  assert.match(html,/pace is locked/i);
  assert.match(html,/Do not reward a version just because it sounds “more emotional.”/);
  assert.match(html,/PASS — Lock/);
  assert.match(html,/MAYBE/);
  assert.match(html,/Download Emotional Lift Feedback/);
  assert.match(html,/Copy Feedback JSON/);
  assert.match(html,/showSaveFilePicker/);
});

test('one human PASS locks narrator, pace and dynamic emotional range but not full-book generation',async()=>{
  const plan=await planFixture();
  const feedback={
    artifact:'book-one-emotional-lift-human-feedback',
    planFingerprint:plan.integrity.planFingerprint,
    feedback:plan.variants.map((v)=>({
      variantId:v.id,
      decision:v.id==='warm-expressive'?'pass':'fail',
      notes:v.id==='warm-expressive'?'This is the fine line. Alive and emotional without sounding acted.':''
    }))
  };
  const result=finalizeEmotionalLift({plan,feedback});
  assert.equal(result.status,'PASSED');
  assert.equal(result.narratorProductionLockCreated,true);
  assert.equal(result.productionArmed,false);
  assert.equal(result.fullBookGenerationArmed,false);
  assert.equal(result.winner.variantId,'warm-expressive');
  assert.equal(result.narratorProductionLock.performanceProfile.speed,1.08);
  assert.equal(result.narratorProductionLock.performanceProfile.stability,.30);
  assert.match(result.narratorProductionLock.performanceProfile.dynamicRangePolicy.conflictGriefHighEmotion,/deeper feeling/i);
  assert.match(result.narratorProductionLock.lockDigest,/^[a-f0-9]{64}$/);
});

test('MAYBE keeps emotional tuning open and creates no narrator production lock',async()=>{
  const plan=await planFixture();
  const feedback={
    artifact:'book-one-emotional-lift-human-feedback',
    planFingerprint:plan.integrity.planFingerprint,
    feedback:plan.variants.map((v)=>({
      variantId:v.id,
      decision:v.id==='deep-controlled-emotion'?'maybe':'fail',
      notes:'Close, but still finding the fine line.'
    }))
  };
  const result=finalizeEmotionalLift({plan,feedback});
  assert.equal(result.status,'NEEDS_TUNING');
  assert.equal(result.narratorProductionLockCreated,false);
  assert.equal(result.fullBookGenerationArmed,false);
});

test('multiple Emotional Lift PASS choices fail closed',async()=>{
  const plan=await planFixture();
  const feedback={
    artifact:'book-one-emotional-lift-human-feedback',
    planFingerprint:plan.integrity.planFingerprint,
    feedback:plan.variants.map((v,i)=>({
      variantId:v.id,
      decision:i<2?'pass':'fail',
      notes:''
    }))
  };
  assert.throws(()=>finalizeEmotionalLift({plan,feedback}),/only one PASS/i);
});
