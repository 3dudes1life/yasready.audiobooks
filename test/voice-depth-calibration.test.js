import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  YASREADY_AUDIOBOOKS_VERSION,
  sha256,
  stableJson,
  verifyVoiceDepthSource,
  renderBookOneVoiceDepthCalibration,
  verifyBookOneVoiceDepthCalibration,
  bookOneVoiceDepthFeedbackTemplate,
  finalizeBookOneVoiceDepthCalibration,
  renderBookOneVoiceDepthReviewHtml,
  BOOK_ONE_VOICE_DEPTH_PITCH_FACTOR,
  BOOK_ONE_VOICE_DEPTH_DURATION_COMPENSATION,
  FfmpegAdapter
} from '../src/index.js';

function digestBytes(bytes) { return sha256(Buffer.from(bytes).toString('base64')); }
function pilotFixture() {
  const assembly = new Uint8Array([1,2,3,4,5,6]);
  const master = new Uint8Array([8,7,6,5,4,3]);
  const base = {
    schemaVersion:1, release:'0.14.3.14.1', artifact:'book-one-chapter-one-pilot-render', status:'READY_FOR_HUMAN_PILOT_REVIEW',
    book:{id:'book-one',title:'Tres Amigos, Una Vida – A Throuple Love Story',author:'D.C.W.',sourceHash:'source'},
    armDigest:'arm-digest', productionPlanDigest:'plan-digest',
    chapter:{order:1,title:'Chapter 1: Departure',sourceTextHash:'chapter-hash',providerGenerationCalls:2,providerCharacters:5449,generationDigests:['a','b']},
    narrator:{provider:'elevenlabs',providerVoiceId:'rU18Fk3uSDhmg5Xh41o4',narratorName:'Ryan Kurk - Pleasant and Smooth'},
    lockedRecipe:{model:'eleven_v3',direction:{label:'Playful + Flirty',emotionalVariantLabel:'Deep Controlled Emotion'},providerVoiceSettings:{speed:1.2,stability:.24},paceProfile:{providerNativeSpeed:1.2,effectiveSpeed:1.25,postProcessRequired:true,postProcessKind:'ffmpeg-atempo',postProcessTempoMultiplier:1.041667,pitchPreservingPostProcess:true}},
    provider:{totalPaidBaseChunks:2,currentRunProviderGenerationCalls:2,reusedPaidBaseChunks:0,requestIdsObservedThisRun:[],quotaRecheckedBeforePaidWork:true},
    localProcessing:{tempoTasks:2,localTempoBuiltThisRun:2,pitchPreserving:true,assembledLocally:true,masteredLocally:true,masteringProfile:'acx-2026'},
    cost:{estimateUsd:.5449,approvedMaxUsd:.66,capturedOrEstimatedBilledUsd:.5449,headroomUsd:.1151,localProcessingUsd:0},
    technicalQa:{passed:true,profileId:'acx-2026',issues:[],analysis:{durationSec:100,sampleRateHz:44100,bitrateKbps:192,rmsDb:-20,peakDb:-4,noiseFloorDb:-70,leadingSilenceMs:1000,trailingSilenceMs:1000}},
    outputs:{state:'chapter-one-pilot-state.json',effectivePaceAssembly:'assembled/chapter-one-effective-pace.wav',masteredPilot:'master/chapter-one-pilot-acx.mp3',effectivePaceAssemblySha256:digestBytes(assembly),masteredPilotSha256:digestBytes(master),reviewBoard:'chapter-one-pilot-review.html',feedbackTemplate:'chapter-one-pilot-feedback-template.json'},
    guardrails:{pilotArmed:true,pilotScopeCompleted:true,productionArmed:false,fullBookGenerationArmed:false,chapterTwoOrLaterGenerated:false,automaticScaleUp:false,humanPassRequiredBeforeNextRelease:true}
  };
  const renderDigest=sha256(stableJson(base));
  return { result:{...base,integrity:{renderDigest},nextAction:'review'}, assembly, master };
}
function feedbackFixture(result) { return {schemaVersion:1,release:'0.14.3.14.1',artifact:'book-one-chapter-one-pilot-human-feedback',armDigest:result.armDigest,renderDigest:result.integrity.renderDigest,chapter:result.chapter,decision:'maybe',notes:'We love the pace and the emotions, but want one tone deeper because it sounds too tinny.',exportedAt:'2026-09-13T17:00:07.190Z'}; }
function ffmpegFixture({qaPass=true}={}) {
  const state={voiceDepth:[],masters:[],analyze:[]};
  return { state,
    async healthCheck(){return {ok:true}},
    async voiceDepth(input,output,options){state.voiceDepth.push({input,output,options});await writeFile(output,new Uint8Array([9,9,9,state.voiceDepth.length]));return {mode:options.mode,semitones:options.mode==='warm-slightly-deeper'?-.5:0,pitchFactor:options.mode==='warm-slightly-deeper'?BOOK_ONE_VOICE_DEPTH_PITCH_FACTOR:1,durationCompensation:options.mode==='warm-slightly-deeper'?BOOK_ONE_VOICE_DEPTH_DURATION_COMPENSATION:1,finishedPacePreserved:true};},
    async master(input,output){state.masters.push({input,output});await writeFile(output,new Uint8Array([7,7,7,state.masters.length]));return {outputPath:output};},
    async analyze(file){state.analyze.push(file);return {durationSec:100,sampleRateHz:44100,bitrateKbps:192,rmsDb:-20,peakDb:-4,noiseFloorDb:qaPass?-70:-50,leadingSilenceMs:1000,trailingSilenceMs:1000};}
  };
}
async function renderFixture(options={}) {
  const {result,assembly,master}=pilotFixture();
  const root=await mkdtemp(path.join(os.tmpdir(),'yas-depth-pilot-'));
  await mkdir(path.join(root,'assembled'),{recursive:true}); await mkdir(path.join(root,'master'),{recursive:true});
  await writeFile(path.join(root,result.outputs.effectivePaceAssembly),assembly); await writeFile(path.join(root,result.outputs.masteredPilot),master);
  const out=await mkdtemp(path.join(os.tmpdir(),'yas-depth-out-'));
  const ffmpeg=ffmpegFixture(options);
  const calibration=await renderBookOneVoiceDepthCalibration({pilotResult:result,pilotFeedback:feedbackFixture(result),pilotRoot:root,ffmpeg,outDir:out});
  return {calibration,ffmpeg,out,result};
}

test('0.14.3.14.2 is current application provenance',()=>assert.equal(YASREADY_AUDIOBOOKS_VERSION,'0.14.3.14.2'));
test('MAYBE pilot feedback with exact render digest is accepted',()=>{const {result}=pilotFixture();assert.equal(verifyVoiceDepthSource({pilotResult:result,pilotFeedback:feedbackFixture(result)}),true)});
test('PASS/FAIL pilot decisions do not silently enter depth tuning',()=>{const {result}=pilotFixture();const f=feedbackFixture(result);f.decision='pass';assert.throws(()=>verifyVoiceDepthSource({pilotResult:result,pilotFeedback:f}),/requires a MAYBE/i)});
test('calibration makes exactly three local comparison variants with zero TTS spend',async()=>{const {calibration,ffmpeg}=await renderFixture();assert.deepEqual(calibration.variants.map(v=>v.id),['original-reference','warm-detinned','warm-slightly-deeper']);assert.equal(ffmpeg.state.voiceDepth.length,2);assert.equal(calibration.cost.providerTtsCalls,0);assert.equal(calibration.cost.providerTtsSpendUsd,0);assert.equal(calibration.guardrails.noProviderApiRequired,true);assert.equal(calibration.guardrails.fullBookGenerationArmed,false);assert.equal(verifyBookOneVoiceDepthCalibration(calibration),true)});
test('deeper variant is restrained half-semitone and pace-preserving by construction',async()=>{const {calibration}=await renderFixture();const v=calibration.variants.find(x=>x.id==='warm-slightly-deeper');assert.equal(v.semitones,-.5);assert.equal(v.pitchFactor,BOOK_ONE_VOICE_DEPTH_PITCH_FACTOR);assert.equal(v.durationCompensation,BOOK_ONE_VOICE_DEPTH_DURATION_COMPENSATION);assert.ok(Math.abs(v.pitchFactor*v.durationCompensation-1)<1e-6);assert.equal(calibration.processing.finishedPacePreserved,true);assert.equal(calibration.processing.formantPreservationClaimed,false)});
test('Warm / De-Tin changes EQ only and never changes pitch',async()=>{const {calibration}=await renderFixture();const v=calibration.variants.find(x=>x.id==='warm-detinned');assert.equal(v.semitones,0);assert.equal(v.pitchFactor,1);assert.equal(v.durationCompensation,1);assert.ok(v.eq.presenceDb<0);assert.ok(v.eq.bodyDb>0)});
test('tampered paid pilot audio is rejected instead of calibrated',async()=>{const {result,assembly,master}=pilotFixture();const root=await mkdtemp(path.join(os.tmpdir(),'yas-depth-bad-'));await mkdir(path.join(root,'assembled'),{recursive:true});await mkdir(path.join(root,'master'),{recursive:true});await writeFile(path.join(root,result.outputs.effectivePaceAssembly),new Uint8Array([0]));await writeFile(path.join(root,result.outputs.masteredPilot),master);const out=await mkdtemp(path.join(os.tmpdir(),'yas-depth-badout-'));await assert.rejects(renderBookOneVoiceDepthCalibration({pilotResult:result,pilotFeedback:feedbackFixture(result),pilotRoot:root,ffmpeg:ffmpegFixture(),outDir:out}),/assembly digest mismatch/i)});
test('review board preserves exact user objective and clearly says zero new TTS',async()=>{const {calibration}=await renderFixture();const html=renderBookOneVoiceDepthReviewHtml(calibration);assert.match(html,/Same Ryan performance\. Same pace\. Same emotional depth/i);assert.match(html,/tinny/i);assert.match(html,/\$0 new TTS spend/i);assert.match(html,/PASS at most one/i)});
test('feedback template covers all three variants',async()=>{const {calibration}=await renderFixture();const f=bookOneVoiceDepthFeedbackTemplate(calibration);assert.equal(f.feedback.length,3);assert.equal(f.calibrationDigest,calibration.integrity.calibrationDigest)});
test('human PASS locks only the reproducible local finish and leaves full book off',async()=>{const {calibration}=await renderFixture();const f=bookOneVoiceDepthFeedbackTemplate(calibration);f.feedback=f.feedback.map(x=>({...x,decision:x.variantId==='warm-slightly-deeper'?'pass':'fail'}));const final=finalizeBookOneVoiceDepthCalibration({calibration,feedback:f});assert.equal(final.status,'PASSED');assert.equal(final.localVoiceFinishLockCreated,true);assert.equal(final.winner.variantId,'warm-slightly-deeper');assert.equal(final.localVoiceFinishLock.selectedVariant.semitones,-.5);assert.equal(final.productionArmed,false);assert.equal(final.fullBookGenerationArmed,false)});
test('MAYBE creates no local finish lock',async()=>{const {calibration}=await renderFixture();const f=bookOneVoiceDepthFeedbackTemplate(calibration);f.feedback=f.feedback.map((x,i)=>({...x,decision:i===1?'maybe':'fail'}));const final=finalizeBookOneVoiceDepthCalibration({calibration,feedback:f});assert.equal(final.status,'NEEDS_TUNING');assert.equal(final.localVoiceFinishLockCreated,false);assert.equal(final.fullBookGenerationArmed,false)});
test('multiple PASS choices fail closed',async()=>{const {calibration}=await renderFixture();const f=bookOneVoiceDepthFeedbackTemplate(calibration);f.feedback=f.feedback.map((x,i)=>({...x,decision:i<2?'pass':'fail'}));assert.throws(()=>finalizeBookOneVoiceDepthCalibration({calibration,feedback:f}),/only one PASS/i)});
test('technical QA failure blocks a human PASS lock',async()=>{const {calibration}=await renderFixture({qaPass:false});const f=bookOneVoiceDepthFeedbackTemplate(calibration);f.feedback=f.feedback.map((x,i)=>({...x,decision:i===1?'pass':'fail'}));assert.throws(()=>finalizeBookOneVoiceDepthCalibration({calibration,feedback:f}),/blocking technical QA/i)});
test('FfmpegAdapter voiceDepth uses bounded EQ and duration-compensated half-semitone pitch drop',async()=>{const calls=[];const adapter=new FfmpegAdapter({execFileImpl:async(cmd,args)=>{calls.push({cmd,args});return {stdout:'',stderr:''}}});await adapter.voiceDepth('/tmp/in.wav','/tmp/out.wav',{mode:'warm-slightly-deeper'});assert.equal(calls.length,1);const args=calls[0].args;const filter=args[args.indexOf('-af')+1];assert.match(filter,/equalizer=f=180/);assert.match(filter,/equalizer=f=3000/);assert.match(filter,/asetrate=44100\*0\.971531941/);assert.match(filter,/atempo=1\.029302237/);assert.equal(args.at(-1),'/tmp/out.wav')});
