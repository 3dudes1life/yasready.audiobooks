import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  YASREADY_AUDIOBOOKS_VERSION,
  sha256,
  stableJson,
  buildBookOneProductionPlan,
  buildBookOneChapterOnePilotArm,
  verifyBookOneChapterOnePilotArm,
  materializeChapterOnePilotTexts,
  extractElevenLabsQuota,
  renderBookOneChapterOnePilot,
  verifyBookOneChapterOnePilotRender,
  finalizeBookOneChapterOnePilot,
  renderBookOneChapterOnePilotReviewHtml
} from '../src/index.js';

function lockFixture() {
  const core = {
    schemaVersion: 1,
    release: '0.14.3.12',
    artifact: 'book-one-narrator-production-lock',
    status: 'LOCKED_FOR_PRODUCTION_PLANNING',
    book: { id: 'book-one', title: 'Tres Amigos, Una Vida – A Throuple Love Story', author: 'D.C.W.', sourceHash: 'fixture-source-hash' },
    narrator: { provider: 'elevenlabs', providerVoiceId: 'rU18Fk3uSDhmg5Xh41o4', candidateName: 'Ryan Kurk - Pleasant and Smooth' },
    performanceProfile: {
      source: 'explicit-human-pace-ceiling-pass',
      baseDirectionId: 'playful-flirty', baseDirectionLabel: 'Playful + Flirty',
      emotionalVariantId: 'deep-controlled-emotion', emotionalVariantLabel: 'Deep Controlled Emotion', emotionalRange: 'strong-controlled',
      stability: 0.24,
      providerVoiceSettings: { speed: 1.20, stability: 0.24 },
      paceProfile: { providerNativeSpeed: 1.20, effectiveSpeed: 1.25, postProcessTempoMultiplier: 1.041667, postProcessRequired: true, postProcessKind: 'ffmpeg-atempo', pitchPreservingPostProcess: true },
      dynamicRangePolicy: { principle: 'emotion follows the scene' },
      originalHumanLearningNote: 'fixture', priorEmotionalNote: 'fixture', finalPaceCalibrationNote: '',
      restraint: "don't overplay the character voices", narrator: 'warm, contemporary, conversational',
      juan: 'playful and charismatic; never shouty', michael: 'warm and grounded; subtle Oklahoma coloration only', christopher: 'polished, playful, confident; contemporary California', identityInferenceFromAudio: false
    },
    readinessEvidence: { sourceEmotionalLiftPlanFingerprint: 'emotion-plan', paceCeilingPlanFingerprint: 'pace-plan', chapterTitle: 'Chapter 37', sceneOrder: 0, wordCount: 195, explicitHumanDecision: 'pass', winningVariantId: 'deep-controlled-emotion-effective-125' },
    productionArmed: false,
    fullBookGenerationArmed: false
  };
  return { ...core, lockDigest: sha256(stableJson(core)) };
}

function finalizationFixture() {
  const lock = lockFixture();
  return { schemaVersion: 1, release: '0.14.3.12', artifact: 'book-one-pace-ceiling-finalization', status: 'PASSED', decision: 'pass', book: lock.book, narratorProductionLockCreated: true, productionArmed: false, fullBookGenerationArmed: false, narratorProductionLock: lock };
}

function analysisFixture() {
  const segment = (order, text, kind='narration') => ({ order, paragraphIndex: order, kind, text, speakerCandidate: null });
  const front='Copyright 2026\nD.C.W.';
  const a='Rawlins stepped into the terminal.\nMichael smiled despite himself.\n“San Diego,” he whispered.';
  const b='The afternoon light felt warmer.\nHe adjusted his bag and kept walking.';
  const c='Chapter two starts here.\nJuan laughed.';
  const chapters=[
    { order:0,title:'Front Matter',textHash:'front-hash',scenes:[{order:0,textHash:'front-scene',segments:front.split('\n').map((x,i)=>segment(i,x))}]},
    { order:1,title:'Chapter 1 – Arrival',textHash:'chapter-one-hash',scenes:[{order:0,textHash:'scene-a',segments:a.split('\n').map((x,i)=>segment(i,x,i===2?'dialogue':'narration'))},{order:1,textHash:'scene-b',segments:b.split('\n').map((x,i)=>segment(i,x))}]},
    { order:2,title:'Chapter 2',textHash:'chapter-two-hash',scenes:[{order:0,textHash:'scene-c',segments:c.split('\n').map((x,i)=>segment(i,x,i===1?'dialogue':'narration'))}]}
  ];
  const productionText=chapters.flatMap(ch=>ch.scenes.flatMap(sc=>sc.segments.map(s=>s.text))).join('\n');
  return {
    schemaVersion:3,
    source:{format:'docx',filename:'book_1.docx',sourceHash:'fixture-source-hash',normalizedTextHash:'normalized-fixture'},
    metadata:{title:'Tres Amigos, Una Vida – A Throuple Love Story',author:'D.C.W.',language:'en'},
    metrics:{words:48,sourceCharacters:productionText.length,sourceCharactersNoWhitespace:productionText.replace(/\s/g,'').length,productionCharacters:productionText.length,estimatedMinutesAt155Wpm:0.4,chapters:3,scenes:4,segments:9,dialogueSegments:2,narrationSegments:7,dialogueCharacters:30,narrationCharacters:200},
    chapters,warnings:[]
  };
}

function planFixture() {
  return buildBookOneProductionPlan({ paceCeilingFinalization: finalizationFixture(), manuscriptAnalysis: analysisFixture(), explicitChunkCap: 58, rateUsdPer1kCharacters:0.10, retryReserveRatio:0.20 });
}

function providerFixture({ remaining=100000, renderFailure=null }={}) {
  const state={renders:0,requests:[]};
  return {
    state,
    async subscriptionPreflight(){ return { available:true,safeToContinue:true,tier:'creator',status:'active',subscription:{tier:'creator',status:'active',character_count:1000,character_limit:1000+remaining,next_character_count_reset_unix:1999999999,can_extend_character_limit:true,max_credit_limit_extension:5000} }; },
    async healthCheck(){ return {ok:true,status:200}; },
    async render(input){
      state.renders+=1; state.requests.push(input);
      if(renderFailure) throw renderFailure;
      return {audio:new Uint8Array([1,2,3,4,state.renders]),requestId:`req-${state.renders}`,billedCharacters:input.text.length,estimatedCostUsd:Number(((input.text.length/1000)*.10).toFixed(6))};
    }
  };
}

function ffmpegFixture({ tempoFailure=false, healthy=true, qaPass=true }={}) {
  const state={tempo:0,concat:0,master:0};
  return {
    state,
    async healthCheck(){ return healthy?{ok:true,ffmpeg:'ffmpeg fixture',ffprobe:'ffprobe fixture'}:{ok:false,reason:'missing'}; },
    async tempo(input,output,multiplier){ state.tempo+=1; if(tempoFailure && state.tempo===1) throw new Error('tempo failed'); await writeFile(output,new Uint8Array([9,8,7])); return {outputPath:output,tempoMultiplier:multiplier,pitchPreserving:true}; },
    async concat(inputs,output){ state.concat+=1; await writeFile(output,new Uint8Array([4,4,4])); return output; },
    async master(input,output){ state.master+=1; await writeFile(output,new Uint8Array([5,5,5])); return {outputPath:output}; },
    async analyze(){ return {durationSec:75,sampleRateHz:44100,channels:1,bitrateKbps:192,rmsDb:-20.5,peakDb:-3.5,noiseFloorDb:qaPass?-65:-50,leadingSilenceMs:1000,trailingSilenceMs:1000}; }
  };
}

async function armFixture({provider=providerFixture(),ffmpeg=ffmpegFixture()}={}) {
  const plan=planFixture();
  const arm=await buildBookOneChapterOnePilotArm({productionPlan:plan,manuscriptAnalysis:analysisFixture(),provider,ffmpeg});
  return {plan,arm,provider,ffmpeg};
}

test('0.14.3.18.2 is current application provenance',()=>{
  assert.equal(YASREADY_AUDIOBOOKS_VERSION,'0.14.3.18.2');
});

test('Chapter One materialization skips Front Matter and preserves exact generation digests',()=>{
  const plan=planFixture();
  assert.equal(plan.manifest.chapters.some(ch=>/^front matter$/i.test(ch.title)),false);
  const materialized=materializeChapterOnePilotTexts({productionPlan:plan,manuscriptAnalysis:analysisFixture()});
  assert.equal(materialized.chapter.title,'Chapter 1 – Arrival');
  assert.equal(materialized.chapter.order,1);
  assert.ok(materialized.chunks.length>=2);
  assert.ok(materialized.chunks.every(x=>x.textDigest===sha256(x.text)));
});

test('quota extraction uses provider-reported character fields and never invents credits',()=>{
  const q=extractElevenLabsQuota({tier:'creator',status:'active',character_count:100,character_limit:1000,max_credit_limit_extension:500});
  assert.equal(q.providerReportedRemaining,900);
  assert.equal(q.creditsInferred,false);
  assert.equal(q.maxCreditLimitExtension,500);
});

test('pilot arm performs zero TTS calls, verifies live quota + ffmpeg and arms Chapter One only',async()=>{
  const {arm,provider}=await armFixture();
  assert.equal(provider.state.renders,0);
  assert.equal(arm.guardrails.pilotArmed,true);
  assert.equal(arm.guardrails.productionArmed,false);
  assert.equal(arm.guardrails.fullBookGenerationArmed,false);
  assert.equal(arm.guardrails.armProviderGenerationCalls,0);
  assert.equal(arm.guardrails.armSpendUsd,0);
  assert.match(arm.confirmation.token,/^PILOT-[A-F0-9]{10}$/);
  assert.equal(verifyBookOneChapterOnePilotArm(arm),true);
});

test('insufficient live quota blocks pilot arm before any TTS',async()=>{
  const provider=providerFixture({remaining:5});
  await assert.rejects(buildBookOneChapterOnePilotArm({productionPlan:planFixture(),manuscriptAnalysis:analysisFixture(),provider,ffmpeg:ffmpegFixture()}),/quota is insufficient/i);
  assert.equal(provider.state.renders,0);
});

test('missing FFmpeg blocks pilot arm before any TTS',async()=>{
  const provider=providerFixture();
  await assert.rejects(buildBookOneChapterOnePilotArm({productionPlan:planFixture(),manuscriptAnalysis:analysisFixture(),provider,ffmpeg:ffmpegFixture({healthy:false})}),/FFmpeg preflight failed/i);
  assert.equal(provider.state.renders,0);
});

test('PLAN token can never authorize pilot spend',async()=>{
  const {plan,arm,provider,ffmpeg}=await armFixture();
  const out=await mkdtemp(path.join(os.tmpdir(),'yas-pilot-plan-token-'));
  try {
    await assert.rejects(renderBookOneChapterOnePilot({arm,productionPlan:plan,manuscriptAnalysis:analysisFixture(),provider,ffmpeg,outDir:out,approvalToken:plan.confirmation.token,maxUsd:arm.budget.suggestedMaxUsd}),/PLAN token cannot authorize spend/i);
    assert.equal(provider.state.renders,0);
  } finally { await rm(out,{recursive:true,force:true}); }
});

test('too-low pilot max blocks before provider render',async()=>{
  const {plan,arm,provider,ffmpeg}=await armFixture();
  const out=await mkdtemp(path.join(os.tmpdir(),'yas-pilot-lowmax-'));
  try {
    await assert.rejects(renderBookOneChapterOnePilot({arm,productionPlan:plan,manuscriptAnalysis:analysisFixture(),provider,ffmpeg,outDir:out,approvalToken:arm.confirmation.token,maxUsd:arm.budget.suggestedMaxUsd-0.01}),/below protected pilot max/i);
    assert.equal(provider.state.renders,0);
  } finally { await rm(out,{recursive:true,force:true}); }
});

test('approved pilot renders only Chapter One with locked Ryan settings and effective 1.25 local tempo',async()=>{
  const {plan,arm,provider,ffmpeg}=await armFixture();
  const out=await mkdtemp(path.join(os.tmpdir(),'yas-pilot-render-'));
  try {
    const result=await renderBookOneChapterOnePilot({arm,productionPlan:plan,manuscriptAnalysis:analysisFixture(),provider,ffmpeg,outDir:out,approvalToken:arm.confirmation.token,maxUsd:arm.budget.suggestedMaxUsd});
    assert.equal(provider.state.renders,arm.pilotScope.providerGenerationCalls);
    assert.ok(provider.state.requests.every(x=>x.voiceId==='rU18Fk3uSDhmg5Xh41o4'));
    assert.ok(provider.state.requests.every(x=>x.voiceSettings.speed===1.20 && x.voiceSettings.stability===0.24));
    assert.equal(ffmpeg.state.tempo,arm.pilotScope.localTempoTasks);
    assert.equal(result.lockedRecipe.paceProfile.effectiveSpeed,1.25);
    assert.equal(result.guardrails.chapterTwoOrLaterGenerated,false);
    assert.equal(result.guardrails.fullBookGenerationArmed,false);
    assert.equal(result.status,'READY_FOR_HUMAN_PILOT_REVIEW');
    assert.equal(verifyBookOneChapterOnePilotRender(result),true);
  } finally { await rm(out,{recursive:true,force:true}); }
});

test('local tempo failure can rerun without repeating paid provider chunks',async()=>{
  const {plan,arm,provider}=await armFixture();
  const out=await mkdtemp(path.join(os.tmpdir(),'yas-pilot-resume-'));
  try {
    await assert.rejects(renderBookOneChapterOnePilot({arm,productionPlan:plan,manuscriptAnalysis:analysisFixture(),provider,ffmpeg:ffmpegFixture({tempoFailure:true}),outDir:out,approvalToken:arm.confirmation.token,maxUsd:arm.budget.suggestedMaxUsd}),/tempo failed/i);
    const paidAfterFirst=provider.state.renders;
    const secondProvider=providerFixture();
    const result=await renderBookOneChapterOnePilot({arm,productionPlan:plan,manuscriptAnalysis:analysisFixture(),provider:secondProvider,ffmpeg:ffmpegFixture(),outDir:out,approvalToken:arm.confirmation.token,maxUsd:arm.budget.suggestedMaxUsd});
    assert.ok(paidAfterFirst>=1);
    assert.equal(secondProvider.state.renders,arm.pilotScope.providerGenerationCalls-paidAfterFirst);
    assert.ok(result.provider.reusedPaidBaseChunks>=paidAfterFirst);
  } finally { await rm(out,{recursive:true,force:true}); }
});

test('unknown in-flight provider outcome fails closed with DO NOT RERUN',async()=>{
  const {plan,arm,provider,ffmpeg}=await armFixture();
  const out=await mkdtemp(path.join(os.tmpdir(),'yas-pilot-inflight-'));
  try {
    await writeFile(path.join(out,'dummy'),'x').catch(()=>{});
    const state={schemaVersion:1,release:'0.14.3.14.1',artifact:'book-one-chapter-one-pilot-state',armDigest:arm.integrity.armDigest,productionPlanDigest:arm.sourceProductionPlan.productionPlanDigest,chunks:{[arm.pilotScope.chunkIds[0]]:{id:arm.pilotScope.chunkIds[0],generationDigest:arm.pilotScope.generationDigests[0],status:'PROVIDER_IN_FLIGHT'}},createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
    await writeFile(path.join(out,'chapter-one-pilot-state.json'),JSON.stringify(state));
    await assert.rejects(renderBookOneChapterOnePilot({arm,productionPlan:plan,manuscriptAnalysis:analysisFixture(),provider,ffmpeg,outDir:out,approvalToken:arm.confirmation.token,maxUsd:arm.budget.suggestedMaxUsd}),/DO NOT RERUN PROVIDER/i);
    assert.equal(provider.state.renders,0);
  } finally { await rm(out,{recursive:true,force:true}); }
});

test('pilot produces local mastering QA and human review board while full-book remains off',async()=>{
  const {plan,arm,provider,ffmpeg}=await armFixture();
  const out=await mkdtemp(path.join(os.tmpdir(),'yas-pilot-review-'));
  try {
    const result=await renderBookOneChapterOnePilot({arm,productionPlan:plan,manuscriptAnalysis:analysisFixture(),provider,ffmpeg,outDir:out,approvalToken:arm.confirmation.token,maxUsd:arm.budget.suggestedMaxUsd});
    const html=renderBookOneChapterOnePilotReviewHtml(arm,result);
    assert.match(html,/Chapter One Production Pilot/);
    assert.match(html,/PASS — Pilot works/);
    assert.match(html,/Full-book generation armed: NO/);
    assert.match(html,/Download Pilot Feedback/);
    assert.equal(result.technicalQa.passed,true);
    assert.equal(ffmpeg.state.master,1);
  } finally { await rm(out,{recursive:true,force:true}); }
});

test('technical QA failure prevents human PASS from validating pilot',async()=>{
  const {plan,arm,provider}=await armFixture();
  const out=await mkdtemp(path.join(os.tmpdir(),'yas-pilot-qafail-'));
  try {
    const result=await renderBookOneChapterOnePilot({arm,productionPlan:plan,manuscriptAnalysis:analysisFixture(),provider,ffmpeg:ffmpegFixture({qaPass:false}),outDir:out,approvalToken:arm.confirmation.token,maxUsd:arm.budget.suggestedMaxUsd});
    assert.equal(result.technicalQa.passed,false);
    assert.throws(()=>finalizeBookOneChapterOnePilot({arm,renderResult:result,feedback:{artifact:'book-one-chapter-one-pilot-human-feedback',armDigest:arm.integrity.armDigest,renderDigest:result.integrity.renderDigest,decision:'pass',notes:''}}),/technical QA/i);
  } finally { await rm(out,{recursive:true,force:true}); }
});

test('human PASS validates only the pilot and still leaves full-book generation unarmed',async()=>{
  const {plan,arm,provider,ffmpeg}=await armFixture();
  const out=await mkdtemp(path.join(os.tmpdir(),'yas-pilot-final-'));
  try {
    const result=await renderBookOneChapterOnePilot({arm,productionPlan:plan,manuscriptAnalysis:analysisFixture(),provider,ffmpeg,outDir:out,approvalToken:arm.confirmation.token,maxUsd:arm.budget.suggestedMaxUsd});
    const final=finalizeBookOneChapterOnePilot({arm,renderResult:result,feedback:{artifact:'book-one-chapter-one-pilot-human-feedback',armDigest:arm.integrity.armDigest,renderDigest:result.integrity.renderDigest,decision:'pass',notes:'Pilot sounds right.'}});
    assert.equal(final.status,'PILOT_PASSED');
    assert.equal(final.pilotValidated,true);
    assert.equal(final.productionArmed,false);
    assert.equal(final.fullBookGenerationArmed,false);
    assert.match(final.nextAction,/full-production orchestrator/i);
  } finally { await rm(out,{recursive:true,force:true}); }
});

test('missing live quota fields fail closed instead of becoming fake zero values',()=>{
  assert.throws(()=>extractElevenLabsQuota({tier:'creator',status:'active',character_count:null,character_limit:null}),/could not be verified/i);
});

test('tampered pilot arm fails integrity verification',async()=>{
  const {arm}=await armFixture();
  const clone=JSON.parse(JSON.stringify(arm));
  clone.budget.suggestedMaxUsd+=0.01;
  assert.throws(()=>verifyBookOneChapterOnePilotArm(clone),/integrity digest mismatch/i);
});

test('corrupted stored paid base fails DO NOT RERUN before buying replacement audio',async()=>{
  const {plan,arm,provider,ffmpeg}=await armFixture();
  const out=await mkdtemp(path.join(os.tmpdir(),'yas-pilot-corrupt-paid-'));
  try {
    await renderBookOneChapterOnePilot({arm,productionPlan:plan,manuscriptAnalysis:analysisFixture(),provider,ffmpeg,outDir:out,approvalToken:arm.confirmation.token,maxUsd:arm.budget.suggestedMaxUsd});
    const first=arm.pilotScope.chunkIds[0];
    await writeFile(path.join(out,'provider',`${first}.mp3`),new Uint8Array([99,98,97]));
    const secondProvider=providerFixture();
    await assert.rejects(renderBookOneChapterOnePilot({arm,productionPlan:plan,manuscriptAnalysis:analysisFixture(),provider:secondProvider,ffmpeg:ffmpegFixture(),outDir:out,approvalToken:arm.confirmation.token,maxUsd:arm.budget.suggestedMaxUsd}),/stored paid audio digest mismatch/i);
    assert.equal(secondProvider.state.renders,0);
  } finally { await rm(out,{recursive:true,force:true}); }
});

test('human MAYBE preserves pilot evidence but validates nothing and keeps full-book off',async()=>{
  const {plan,arm,provider,ffmpeg}=await armFixture();
  const out=await mkdtemp(path.join(os.tmpdir(),'yas-pilot-maybe-'));
  try {
    const result=await renderBookOneChapterOnePilot({arm,productionPlan:plan,manuscriptAnalysis:analysisFixture(),provider,ffmpeg,outDir:out,approvalToken:arm.confirmation.token,maxUsd:arm.budget.suggestedMaxUsd});
    const final=finalizeBookOneChapterOnePilot({arm,renderResult:result,feedback:{artifact:'book-one-chapter-one-pilot-human-feedback',armDigest:arm.integrity.armDigest,renderDigest:result.integrity.renderDigest,decision:'maybe',notes:'One thing still needs tuning.'}});
    assert.equal(final.status,'PILOT_NEEDS_TUNING');
    assert.equal(final.pilotValidated,false);
    assert.equal(final.productionArmed,false);
    assert.equal(final.fullBookGenerationArmed,false);
  } finally { await rm(out,{recursive:true,force:true}); }
});

