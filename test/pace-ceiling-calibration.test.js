import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  YASREADY_AUDIOBOOKS_VERSION,
  sha256,
  stableJson,
  derivePaceCeilingRequest,
  selectPaceCeilingEmotionalCandidates,
  buildPaceCeilingCalibrationPlan,
  verifyPaceCeilingPlan,
  renderPaceCeilingCalibration,
  renderPaceCeilingReviewHtml,
  finalizePaceCeilingCalibration,
  ELEVENLABS_NATIVE_SPEED_CEILING,
  PACE_CALIBRATION_EFFECTIVE_HARD_CEILING,
  FfmpegAdapter
} from '../src/index.js';

function emotionalPlanFixture() {
  const plan = {
    schemaVersion:1,
    release:'0.14.3.11',
    artifact:'book-one-emotional-lift-plan',
    status:'READY_FOR_EXPLICIT_APPROVAL',
    sensitiveLocalArtifact:true,
    doNotCommit:true,
    book:{
      id:'book1',
      title:'Tres Amigos, Una Vida – A Throuple Love Story',
      author:'D.C.W.',
      sourceHash:'book-one-hash'
    },
    sourceTuning:{
      planFingerprint:'tuning-fingerprint',
      finalizationRelease:'0.14.3.10',
      finalizationStatus:'NEEDS_TUNING',
      finalizationDecision:'maybe',
      choicesDigest:'choices-digest'
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
    anchor:{
      variantId:'faster-emotional',
      variantLabel:'Faster + More Emotional',
      humanDecision:'maybe',
      humanNote:'I like this ones pace but I feel like it could have more emotions.',
      sourceVoiceSettings:{speed:1.08,stability:.42},
      lockedSpeed:1.08,
      sourceStability:.42,
      selectionScore:215,
      otherMaybeEvidence:[]
    },
    emotionalPolicy:{
      objective:'find the fine line where the narration feels emotionally alive without sounding performed or melodramatic',
      pacePolicy:'lock speed at 1.08 for this round; do not trade emotional lift for slower pacing',
      dynamicRangePolicy:{
        principle:'emotion follows the scene; the selected voice setting creates headroom rather than forcing constant intensity',
        playfulEveryday:'conversational, buoyant, warm; never overact ordinary dialogue',
        romanticIntimate:'allow tenderness, warmth and vulnerability when the text earns it',
        conflictGriefHighEmotion:'allow substantially deeper feeling, pauses and vulnerability when the scene carries emotional weight',
        restraint:'never make every line intense, shouty, weepy or theatrical; contrast is what makes emotional scenes land'
      },
      identityInferenceFromAudio:false
    },
    model:'eleven_v3',
    outputFormat:'mp3_44100_128',
    variants:[
      {
        id:'gentle-emotional-lift',label:'Gentle Emotional Lift',level:1,
        goal:'Keep the approved faster pace and add a noticeable but restrained emotional lift.',
        voiceSettings:{speed:1.08,stability:.36},emotionalRange:'gentle',seed:81101
      },
      {
        id:'warm-expressive',label:'Warm + Expressive',level:2,
        goal:'Keep the approved faster pace while giving the narrator more warmth, responsiveness and emotional presence.',
        voiceSettings:{speed:1.08,stability:.30},emotionalRange:'moderate',seed:81102
      },
      {
        id:'deep-controlled-emotion',label:'Deep Controlled Emotion',level:3,
        goal:'Test the strongest controlled emotional headroom while staying natural and avoiding melodrama.',
        voiceSettings:{speed:1.08,stability:.24},emotionalRange:'strong-controlled',seed:81103
      }
    ],
    cost:{
      estimateUsd:.40,reserveUsd:.10,suggestedMaxUsd:.51,hardCeilingUsd:1,
      estimatedGenerationCalls:3,
      estimates:[
        {variantId:'gentle-emotional-lift',amountUsd:.133,characters:1330,rateUsdPer1k:.1},
        {variantId:'warm-expressive',amountUsd:.133,characters:1330,rateUsdPer1k:.1},
        {variantId:'deep-controlled-emotion',amountUsd:.133,characters:1330,rateUsdPer1k:.1}
      ],
      roundingPolicy:'protected-max-ceil-to-cent'
    },
    guardrails:{
      planningProviderGenerationCalls:0,explicitApprovalRequired:true,exactPlanFingerprintRequired:true,
      maxUsdRequiredAtRender:true,providerSubscriptionPreflightRequired:true,sameNarratorRequired:true,
      sameSceneRequired:true,paceLockedAt108:true,exactlyThreeEmotionalVariants:true,
      resumableCompletedVariantReuse:true,humanPassRequiredForNarratorProductionLock:true,
      productionGenerationArmed:false,narratorProductionLockCreated:false,fullBookGenerationArmed:false,
      identityInferenceFromAudio:false
    }
  };
  const core={
    schemaVersion:plan.schemaVersion,release:plan.release,artifact:plan.artifact,status:plan.status,
    book:plan.book,sourceTuning:plan.sourceTuning,narrator:plan.narrator,sample:plan.sample,
    baselineDirection:plan.baselineDirection,anchor:plan.anchor,emotionalPolicy:plan.emotionalPolicy,
    model:plan.model,outputFormat:plan.outputFormat,variants:plan.variants,cost:plan.cost,guardrails:plan.guardrails
  };
  const fingerprint=sha256(stableJson(core));
  return {
    ...plan,
    integrity:{planFingerprint:fingerprint},
    confirmation:{token:`EMOTION-${fingerprint.slice(0,10).toUpperCase()}`,instruction:'fixture'}
  };
}

function emotionalFeedbackFixture(overrides={}) {
  const plan=emotionalPlanFixture();
  return {
    schemaVersion:1,
    release:'0.14.3.11',
    artifact:'book-one-emotional-lift-human-feedback',
    planFingerprint:plan.integrity.planFingerprint,
    book:plan.book,
    narrator:plan.narrator,
    lockedSpeed:1.08,
    baselineDirection:{directionId:'playful-flirty',directionLabel:'Playful + Flirty'},
    feedback:[
      {variantId:'gentle-emotional-lift',variantLabel:'Gentle Emotional Lift',decision:'maybe',notes:'WAY TOO SLOW - do 1.25 speed'},
      {variantId:'warm-expressive',variantLabel:'Warm + Expressive',decision:'fail',notes:'do not like'},
      {variantId:'deep-controlled-emotion',variantLabel:'Deep Controlled Emotion',decision:'maybe',notes:'WAY TOO SLOW - do 1.25 speed'}
    ],
    exportedAt:'2026-09-13T04:21:51.900Z',
    ...overrides
  };
}

const estimator=async({text,model})=>({
  amountUsd:Number(((text.length/1000)*.10).toFixed(6)),
  characters:text.length,model,rateUsdPer1k:.10,estimated:true
});

async function planFixture() {
  return buildPaceCeilingCalibrationPlan({
    emotionalPlan:emotionalPlanFixture(),
    emotionalFeedback:emotionalFeedbackFixture(),
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
        requestId:`pace-${state.attempts}`
      };
    }
  };
}

function tempoFixture({healthy=true,failOnCall=null}={}) {
  const state={calls:0,items:[]};
  return {
    state,
    async healthCheck(){return healthy?{ok:true}:{ok:false,reason:'ffmpeg missing'}},
    async process(inputPath,outputPath,multiplier){
      state.calls+=1;
      if(failOnCall===state.calls) throw new Error(`tempo fixture failure ${state.calls}`);
      state.items.push({inputPath,outputPath,multiplier});
      await writeFile(outputPath,new Uint8Array([9,8,7,state.calls]));
      return {outputPath,multiplier,pitchPreserving:true};
    }
  };
}

test('0.14.3.15 is current application provenance',()=>{
  assert.equal(YASREADY_AUDIOBOOKS_VERSION,'0.14.3.15');
});

test('human 1.25 request is recognized while provider ceiling stays 1.20',()=>{
  const request=derivePaceCeilingRequest(emotionalFeedbackFixture());
  assert.equal(request.requestedEffectiveSpeed,1.25);
  assert.equal(request.providerNativeSpeed,1.20);
  assert.equal(request.postProcessTempoMultiplier,Number((1.25/1.20).toFixed(6)));
  assert.equal(request.pitchPreservingPostProcess,true);
});

test('native-speed requests do not enter Pace Ceiling Calibration',()=>{
  const f=emotionalFeedbackFixture();
  f.feedback[0].notes='try 1.20 speed';
  f.feedback[2].notes='do 1.20 speed';
  assert.throws(()=>derivePaceCeilingRequest(f),/does not exceed.*native ceiling/i);
});

test('unsafe effective pace above calibration ceiling fails closed',()=>{
  const f=emotionalFeedbackFixture();
  f.feedback[0].notes='do 1.35 speed';
  f.feedback[2].notes='do 1.35 speed';
  assert.throws(()=>derivePaceCeilingRequest(f),new RegExp(`exceeds YasReady.*${PACE_CALIBRATION_EFFECTIVE_HARD_CEILING.toFixed(2)}`,'i'));
});

test('only MAYBE emotional directions survive; failed Warm + Expressive is excluded',()=>{
  const candidates=selectPaceCeilingEmotionalCandidates(emotionalPlanFixture(),emotionalFeedbackFixture());
  assert.deepEqual(candidates.map(x=>x.emotionalVariantId),['gentle-emotional-lift','deep-controlled-emotion']);
  assert.ok(!candidates.some(x=>x.emotionalVariantId==='warm-expressive'));
  assert.deepEqual(candidates.map(x=>x.stability),[.36,.24]);
});

test('plan makes two paid native 1.20 bases and four review variants including effective 1.25',async()=>{
  const plan=await planFixture();
  assert.equal(plan.providerRenders.length,2);
  assert.ok(plan.providerRenders.every(x=>x.providerSpeed===ELEVENLABS_NATIVE_SPEED_CEILING));
  assert.ok(plan.providerRenders.every(x=>x.voiceSettings.speed===1.20));
  assert.equal(plan.reviewVariants.length,4);
  assert.equal(plan.reviewVariants.filter(x=>x.isDerived).length,2);
  assert.deepEqual([...new Set(plan.reviewVariants.filter(x=>x.isDerived).map(x=>x.effectiveSpeed))],[1.25]);
  assert.ok(plan.sourceEmotionalLift.failedVariantsExcluded.includes('warm-expressive'));
});

test('planning is zero-spend, immutable and counts only two provider calls',async()=>{
  const plan=await planFixture();
  assert.equal(plan.cost.estimatedProviderGenerationCalls,2);
  assert.equal(plan.cost.localDerivedAudioCount,2);
  assert.equal(plan.cost.localTempoProcessingCostUsd,0);
  assert.equal(plan.guardrails.planningProviderGenerationCalls,0);
  assert.equal(plan.guardrails.fullBookGenerationArmed,false);
  assert.match(plan.confirmation.token,/^PACE-[A-F0-9]{10}$/);
  assert.equal(verifyPaceCeilingPlan(plan),true);
});

test('wrong approval token blocks before provider and tempo work',async()=>{
  const plan=await planFixture(),provider=providerFixture(),tempo=tempoFixture();
  const out=await mkdtemp(path.join(os.tmpdir(),'yas-pace-token-'));
  await assert.rejects(
    renderPaceCeilingCalibration({plan,provider,tempoProcessor:tempo,outDir:out,approvalToken:'PACE-WRONG',maxUsd:plan.cost.suggestedMaxUsd}),
    /token mismatch/i
  );
  assert.equal(provider.state.attempts,0);
  assert.equal(tempo.state.calls,0);
});

test('FFmpeg preflight happens before any paid TTS call',async()=>{
  const plan=await planFixture(),provider=providerFixture(),tempo=tempoFixture({healthy:false});
  const out=await mkdtemp(path.join(os.tmpdir(),'yas-pace-ffmpeg-'));
  await assert.rejects(
    renderPaceCeilingCalibration({plan,provider,tempoProcessor:tempo,outDir:out,approvalToken:plan.confirmation.token,maxUsd:plan.cost.suggestedMaxUsd}),
    /FFmpeg tempo preflight failed before any paid TTS call/i
  );
  assert.equal(provider.state.attempts,0);
});

test('free tier blocks before provider generation',async()=>{
  const plan=await planFixture(),provider=providerFixture({tier:'free'}),tempo=tempoFixture();
  const out=await mkdtemp(path.join(os.tmpdir(),'yas-pace-free-'));
  await assert.rejects(
    renderPaceCeilingCalibration({plan,provider,tempoProcessor:tempo,outDir:out,approvalToken:plan.confirmation.token,maxUsd:plan.cost.suggestedMaxUsd}),
    /paid subscription.*No audio was generated/i
  );
  assert.equal(provider.state.attempts,0);
});

test('approved calibration uses two provider calls at 1.20 and two local 1.25 derivatives',async()=>{
  const plan=await planFixture(),provider=providerFixture(),tempo=tempoFixture();
  const out=await mkdtemp(path.join(os.tmpdir(),'yas-pace-render-'));
  const result=await renderPaceCeilingCalibration({plan,provider,tempoProcessor:tempo,outDir:out,approvalToken:plan.confirmation.token,maxUsd:plan.cost.suggestedMaxUsd});
  assert.equal(result.status,'READY_FOR_HUMAN_PACE_REVIEW');
  assert.equal(result.providerGenerationCalls,2);
  assert.equal(result.currentRunProviderGenerationCalls,2);
  assert.equal(result.localDerivedAudioCount,2);
  assert.equal(result.localDerivativesBuiltThisRun,2);
  assert.equal(result.productionGenerationCalls,0);
  assert.ok(provider.state.renders.every(x=>x.voiceSettings.speed===1.20));
  assert.deepEqual(provider.state.renders.map(x=>x.voiceSettings.stability),[.36,.24]);
  assert.ok(tempo.state.items.every(x=>x.multiplier===Number((1.25/1.20).toFixed(6))));
  await stat(path.join(out,'pace-ceiling-review.html'));
});

test('provider partial failure resumes without repaying stored base clip',async()=>{
  const plan=await planFixture(),out=await mkdtemp(path.join(os.tmpdir(),'yas-pace-provider-resume-'));
  const first=providerFixture({failOnCall:2}),tempo1=tempoFixture();
  await assert.rejects(
    renderPaceCeilingCalibration({plan,provider:first,tempoProcessor:tempo1,outDir:out,approvalToken:plan.confirmation.token,maxUsd:plan.cost.suggestedMaxUsd}),
    /fixture provider failure/
  );
  assert.equal(first.state.renders.length,1);

  const second=providerFixture(),tempo2=tempoFixture();
  const result=await renderPaceCeilingCalibration({plan,provider:second,tempoProcessor:tempo2,outDir:out,approvalToken:plan.confirmation.token,maxUsd:plan.cost.suggestedMaxUsd});
  assert.equal(second.state.renders.length,1);
  assert.equal(result.providerGenerationCalls,2);
  assert.equal(result.currentRunProviderGenerationCalls,1);
  assert.equal(result.reusedPaidBaseClips,1);
});

test('local tempo failure is safe to rerun and does not repeat paid TTS',async()=>{
  const plan=await planFixture(),out=await mkdtemp(path.join(os.tmpdir(),'yas-pace-local-resume-'));
  const provider1=providerFixture(),tempo1=tempoFixture({failOnCall:1});
  await assert.rejects(
    renderPaceCeilingCalibration({plan,provider:provider1,tempoProcessor:tempo1,outDir:out,approvalToken:plan.confirmation.token,maxUsd:plan.cost.suggestedMaxUsd}),
    /tempo fixture failure/
  );
  assert.equal(provider1.state.renders.length,2);

  const provider2=providerFixture(),tempo2=tempoFixture();
  const result=await renderPaceCeilingCalibration({plan,provider:provider2,tempoProcessor:tempo2,outDir:out,approvalToken:plan.confirmation.token,maxUsd:plan.cost.suggestedMaxUsd});
  assert.equal(provider2.state.renders.length,0);
  assert.equal(result.currentRunProviderGenerationCalls,0);
  assert.equal(result.reusedPaidBaseClips,2);
  assert.equal(tempo2.state.calls,2);
});

test('review UX clearly distinguishes native 1.20 from pitch-preserved effective 1.25',async()=>{
  const plan=await planFixture();
  const fakeResult={rendered:plan.reviewVariants.map((v,i)=>({variantId:v.id,outputRelativePath:`audio/${i}.mp3`}))};
  const html=renderPaceCeilingReviewHtml(plan,fakeResult);
  assert.match(html,/Is 1\.25 actually the pace/);
  assert.match(html,/ElevenLabs stops at 1\.20/);
  assert.match(html,/pitch-preserved local 1\.25/);
  assert.match(html,/Warm \+ Expressive was rejected and is gone/);
  assert.match(html,/PASS — Lock/);
  assert.match(html,/Download Pace Feedback/);
  assert.match(html,/showSaveFilePicker/);
});

test('native 1.20 PASS locks native pace with no post-process requirement',async()=>{
  const plan=await planFixture();
  const target=plan.reviewVariants.find(v=>v.emotionalVariantId==='gentle-emotional-lift'&&!v.isDerived);
  const feedback={
    artifact:'book-one-pace-ceiling-human-feedback',
    planFingerprint:plan.integrity.planFingerprint,
    feedback:plan.reviewVariants.map(v=>({variantId:v.id,decision:v.id===target.id?'pass':'fail',notes:v.id===target.id?'1.20 is enough.':''}))
  };
  const result=finalizePaceCeilingCalibration({plan,feedback});
  assert.equal(result.status,'PASSED');
  assert.equal(result.narratorProductionLockCreated,true);
  assert.equal(result.fullBookGenerationArmed,false);
  assert.equal(result.winner.paceProfile.providerNativeSpeed,1.20);
  assert.equal(result.winner.paceProfile.effectiveSpeed,1.20);
  assert.equal(result.winner.paceProfile.postProcessRequired,false);
});

test('effective 1.25 PASS records reproducible 1.20 + FFmpeg tempo production profile',async()=>{
  const plan=await planFixture();
  const target=plan.reviewVariants.find(v=>v.emotionalVariantId==='deep-controlled-emotion'&&v.isDerived);
  const feedback={
    artifact:'book-one-pace-ceiling-human-feedback',
    planFingerprint:plan.integrity.planFingerprint,
    feedback:plan.reviewVariants.map(v=>({variantId:v.id,decision:v.id===target.id?'pass':'fail',notes:v.id===target.id?'This is the pace and emotional range.':''}))
  };
  const result=finalizePaceCeilingCalibration({plan,feedback});
  assert.equal(result.status,'PASSED');
  assert.equal(result.narratorProductionLockCreated,true);
  assert.equal(result.productionArmed,false);
  assert.equal(result.fullBookGenerationArmed,false);
  assert.equal(result.winner.emotionalVariantId,'deep-controlled-emotion');
  assert.equal(result.winner.stability,.24);
  assert.equal(result.winner.paceProfile.providerNativeSpeed,1.20);
  assert.equal(result.winner.paceProfile.effectiveSpeed,1.25);
  assert.equal(result.winner.paceProfile.postProcessRequired,true);
  assert.equal(result.winner.paceProfile.postProcessKind,'ffmpeg-atempo');
  assert.equal(result.winner.paceProfile.postProcessTempoMultiplier,Number((1.25/1.20).toFixed(6)));
  assert.match(result.narratorProductionLock.lockDigest,/^[a-f0-9]{64}$/);
});

test('MAYBE creates no narrator lock and multiple PASS choices fail closed',async()=>{
  const plan=await planFixture();
  const maybeFeedback={
    artifact:'book-one-pace-ceiling-human-feedback',
    planFingerprint:plan.integrity.planFingerprint,
    feedback:plan.reviewVariants.map((v,i)=>({variantId:v.id,decision:i===0?'maybe':'fail',notes:''}))
  };
  const maybe=finalizePaceCeilingCalibration({plan,feedback:maybeFeedback});
  assert.equal(maybe.status,'NEEDS_TUNING');
  assert.equal(maybe.narratorProductionLockCreated,false);

  const badFeedback={
    artifact:'book-one-pace-ceiling-human-feedback',
    planFingerprint:plan.integrity.planFingerprint,
    feedback:plan.reviewVariants.map((v,i)=>({variantId:v.id,decision:i<2?'pass':'fail',notes:''}))
  };
  assert.throws(()=>finalizePaceCeilingCalibration({plan,feedback:badFeedback}),/only one PASS/i);
});

test('FfmpegAdapter tempo uses atempo and preserves target encoding path',async()=>{
  const calls=[];
  const adapter=new FfmpegAdapter({
    execFileImpl:async(cmd,args)=>{calls.push({cmd,args});return {stdout:'',stderr:''}}
  });
  await adapter.tempo('/tmp/in.mp3','/tmp/out.mp3',Number((1.25/1.20).toFixed(6)));
  assert.equal(calls.length,1);
  assert.equal(calls[0].cmd,'ffmpeg');
  assert.ok(calls[0].args.includes('-af'));
  assert.ok(calls[0].args.some(x=>String(x).includes('atempo=1.041667')));
  assert.equal(calls[0].args.at(-1),'/tmp/out.mp3');
});
