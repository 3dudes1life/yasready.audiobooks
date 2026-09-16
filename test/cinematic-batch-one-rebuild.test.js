import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import {
  sha256,
  stableJson,
  buildBookOneProductionPlan,
  buildBookOneProductionRecipeLock,
  buildBookOneCinematicNaturalismLock,
  materializeBookOneCinematicTarget,
  buildBookOneCinematicRebuildArm,
  verifyBookOneCinematicRebuildArm,
  renderBookOneCinematicRebuild,
  verifyBookOneCinematicRebuildResult,
  historicalBatchArmCore,
  historicalBatchResultCore
} from '../src/index.js';

function narratorLock(){const core={schemaVersion:1,release:'0.14.3.12',artifact:'book-one-narrator-production-lock',status:'LOCKED_FOR_PRODUCTION_PLANNING',book:{id:'book-one',title:'Fixture Book',author:'Fixture Author',sourceHash:'fixture-source-hash'},narrator:{provider:'elevenlabs',providerVoiceId:'rU18Fk3uSDhmg5Xh41o4',candidateName:'Ryan Kurk - Pleasant and Smooth'},performanceProfile:{baseDirectionId:'playful-flirty',baseDirectionLabel:'Playful + Flirty',emotionalVariantId:'deep-controlled-emotion',emotionalVariantLabel:'Deep Controlled Emotion',emotionalRange:'dynamic',stability:.24,providerVoiceSettings:{speed:1.2,stability:.24},paceProfile:{providerNativeSpeed:1.2,effectiveSpeed:1.25,postProcessTempoMultiplier:1.041667,postProcessRequired:true,postProcessKind:'ffmpeg-atempo',pitchPreservingPostProcess:true}},productionArmed:false,fullBookGenerationArmed:false};return{...core,lockDigest:sha256(stableJson(core))};}
function finalization(){const lock=narratorLock();return{schemaVersion:1,release:'0.14.3.12',artifact:'book-one-pace-ceiling-finalization',status:'PASSED',decision:'pass',book:lock.book,narratorProductionLockCreated:true,productionArmed:false,fullBookGenerationArmed:false,narratorProductionLock:lock};}
function analysis(){const chapters=[];for(let i=0;i<10;i++){const segments=[{order:0,paragraphIndex:0,kind:'narration',text:`Chapter ${i+1} begins with a tense silence before the conversation starts.`,speakerCandidate:null},{order:1,paragraphIndex:1,kind:'dialogue',text:'“You really think that is going to work?” Juan teased with a grin.',speakerCandidate:'Juan'},{order:2,paragraphIndex:2,kind:'narration',text:'Michael hesitated, nervous but trying to look calm.',speakerCandidate:null},{order:3,paragraphIndex:3,kind:'dialogue',text:'“Maybe,” Michael said, trying not to laugh.',speakerCandidate:'Michael'},{order:4,paragraphIndex:4,kind:'dialogue',text:'“Then let us find out,” Christopher said softly.',speakerCandidate:'Christopher'}];const text=segments.map(s=>s.text).join('\n');chapters.push({order:i,title:`Chapter ${i+1}: Fixture`,textHash:sha256(text),scenes:[{order:0,textHash:sha256(text),segments}]});}return{schemaVersion:3,source:{format:'docx',filename:'book.docx',sourceHash:'fixture-source-hash',normalizedTextHash:'n'},metadata:{title:'Fixture Book',author:'Fixture Author'},metrics:{words:1000,chapters:10,scenes:10,segments:50,estimatedMinutesAt155Wpm:7},chapters};}
function plan(){return buildBookOneProductionPlan({paceCeilingFinalization:finalization(),manuscriptAnalysis:analysis(),explicitChunkCap:450,rateUsdPer1kCharacters:.10,retryReserveRatio:.20});}
function finishLock(){const p=plan();const core={schemaVersion:1,release:'0.14.3.14.2',artifact:'book-one-local-voice-finish-lock',status:'LOCKED_FOR_PRODUCTION_PLANNING_ONLY',sourcePilotRenderDigest:'pilot-render',narrator:{provider:'elevenlabs',providerVoiceId:p.productionRecipe.providerVoiceId,narratorName:p.productionRecipe.narratorName},performanceUnchanged:true,providerVoiceSettingsUnchanged:p.productionRecipe.providerVoiceSettings,paceProfileUnchanged:p.productionRecipe.paceProfile,selectedVariant:{id:'warm-slightly-deeper',label:'Warm + Slightly Deeper',kind:'local-tone-and-pitch',eq:{bodyHz:180,bodyDb:1.2,presenceHz:3000,presenceDb:-1.6,airHz:5200,airDb:-.8},semitones:-.5,pitchFactor:.971531941,durationCompensation:1.029302237,formantPreservationClaimed:false},productionArmed:false,fullBookGenerationArmed:false};return{...core,finishDigest:sha256(stableJson(core))};}
function recipe(){return buildBookOneProductionRecipeLock({productionPlan:plan(),localVoiceFinishLock:finishLock()});}
function provider(remaining=1_000_000){let calls=0;return{get calls(){return calls;},healthCheck:async()=>({ok:true,status:200}),subscriptionPreflight:async()=>({available:true,safeToContinue:true,tier:'creator',status:'active',subscription:{tier:'creator',status:'active',character_count:1000,character_limit:1000+remaining}}),render:async({text})=>{calls+=1;return{audio:new Uint8Array(Buffer.from(`audio:${calls}:${text.length}`)),billedCharacters:text.length,estimatedCostUsd:text.length/10000,requestId:`req-${calls}`};}};}
function ffmpeg(){const write=async(out,label)=>{await mkdir(path.dirname(out),{recursive:true});await writeFile(out,Buffer.from(label));};return{healthCheck:async()=>({ok:true}),tempo:async(i,o,m)=>{await write(o,`tempo:${m}:${await readFile(i,'utf8')}`);},voiceDepth:async(i,o,{mode})=>{await write(o,`finish:${mode}:${await readFile(i,'utf8')}`);},silence:async(o,sec)=>{await write(o,`silence:${Number(sec).toFixed(3)}`);},trimEdgeSilence:async(i,o,{trimStart,trimEnd})=>{await write(o,`trim:${Boolean(trimStart)}:${Boolean(trimEnd)}:${await readFile(i,'utf8')}`);},concat:async(inputs,o)=>{let x='';for(const f of inputs)x+=await readFile(f,'utf8');await write(o,x);},master:async(i,o,profile)=>{await write(o,`master:${profile}:${await readFile(i,'utf8')}`);},analyze:async(file)=>({durationSec:60,sampleRateHz:44100,channels:1,channelLayout:'mono',codec:file.endsWith('.wav')?'pcm_s24le':'mp3',bitrateKbps:file.endsWith('.mp3')?192:null,rmsDb:-20.5,peakDb:-4,noiseFloorDb:-70,leadingSilenceMs:1200,trailingSilenceMs:1200})};}
const disk=async(root)=>({root,availableBytes:100*1024**3,availableGiB:100});
function digestBytes(bytes){return sha256(Buffer.from(bytes).toString('base64'));}

async function historicalEvidence(p,root){
  const armBase={schemaVersion:1,release:'0.14.3.16',artifact:'book-one-quota-aware-batch-arm',status:'ARMED_FOR_EXACT_BATCH_ONLY',book:p.book,source:{productionPlanDigest:p.integrity.productionPlanDigest},liveProvider:{providerReportedRemaining:999999},batchScope:{selectedChapterCount:10,firstChapterOrder:0,lastChapterOrder:9,chapters:[]},budget:{protectedMaxUsd:10},storage:{},outputContract:{},pilotReuse:null,guardrails:{fullBookGenerationArmed:false}};
  const armDigest=sha256(stableJson(historicalBatchArmCore(armBase)));
  const oldArm={...armBase,integrity:{armDigest},confirmation:{token:`BATCH-${armDigest.slice(0,10).toUpperCase()}`}};
  const chapters=[];
  for(let i=0;i<10;i++){
    const archiveRel=`distribution/archive-wav/${String(i+1).padStart(3,'0')}-chapter-${i+1}.wav`;
    const acxRel=`distribution/acx-audible/${String(i+1).padStart(3,'0')}-chapter-${i+1}.mp3`;
    const archive=path.join(root,archiveRel),acx=path.join(root,acxRel);
    await mkdir(path.dirname(archive),{recursive:true});await mkdir(path.dirname(acx),{recursive:true});
    const aw=Buffer.from(`original-archive-${i+1}`),am=Buffer.from(`original-mp3-${i+1}`);await writeFile(archive,aw);await writeFile(acx,am);
    chapters.push({order:i,retailerSequence:i+1,title:`Chapter ${i+1}: Fixture`,outputs:{archiveWav:archiveRel,acxMp3:acxRel},digests:{archiveWav:digestBytes(aw),acxMp3:digestBytes(am)}});
  }
  const resultBase={schemaVersion:1,release:'0.14.3.16',artifact:'book-one-batch-production-result',status:'READY_FOR_HUMAN_BATCH_REVIEW',book:p.book,armDigest,recipeDigest:'legacy-recipe',batch:{ordinal:1,wholeChaptersOnly:true,chapterCount:10,firstChapterOrder:0,lastChapterOrder:9},provider:{},cost:{},chapters,distribution:{},guardrails:{nextBatchArmed:false,fullBookGenerationArmed:false}};
  const resultDigest=sha256(stableJson(historicalBatchResultCore(resultBase)));
  return{oldArm,oldResult:{...resultBase,integrity:{resultDigest}}};
}

test('cinematic rebuild arm is zero-spend, preserves originals and creates exact CINEMATIC authorization only',async()=>{
  const p=plan(),r=recipe(),oldRoot=await mkdtemp(path.join(tmpdir(),'yasready-old-')),out=await mkdtemp(path.join(tmpdir(),'yasready-cine-'));
  try{const {oldArm,oldResult}=await historicalEvidence(p,oldRoot);const pr=provider();const {arm}=await buildBookOneCinematicRebuildArm({productionPlan:p,recipeLock:r,manuscriptAnalysis:analysis(),previousArm:oldArm,previousResult:oldResult,previousRoot:oldRoot,provider:pr,ffmpeg:ffmpeg(),outputRoot:out,storageProbe:disk});assert.equal(verifyBookOneCinematicRebuildArm(arm),true);assert.equal(pr.calls,0);assert.match(arm.confirmation.token,/^CINEMATIC-[A-F0-9]{10}$/);assert.equal(arm.rebuildTarget.chapterCount,10);assert.equal(arm.guardrails.originalsMayBeOverwritten,false);assert.equal(arm.guardrails.chapterElevenMayBeGenerated,false);assert.equal(arm.profile.humanDecision.selectedComparison,'A_CURRENT_CINEMATIC');}
  finally{await rm(oldRoot,{recursive:true,force:true});await rm(out,{recursive:true,force:true});}
});

test('live quota selects only a safe whole-chapter prefix for the rebuild',async()=>{
  const p=plan(),r=recipe(),oldRoot=await mkdtemp(path.join(tmpdir(),'yasready-old-')),out=await mkdtemp(path.join(tmpdir(),'yasready-cine-'));
  try{const {oldArm,oldResult}=await historicalEvidence(p,oldRoot);const lock=buildBookOneCinematicNaturalismLock({productionPlan:p,recipeLock:r});const target=materializeBookOneCinematicTarget({productionPlan:p,recipeLock:r,manuscriptAnalysis:analysis(),cinematicLock:lock});const first=target.chapters[0].providerCharacters;const remaining=first+Math.ceil(first*.2)+5;const {arm}=await buildBookOneCinematicRebuildArm({productionPlan:p,recipeLock:r,manuscriptAnalysis:analysis(),previousArm:oldArm,previousResult:oldResult,previousRoot:oldRoot,provider:provider(remaining),ffmpeg:ffmpeg(),outputRoot:out,storageProbe:disk});assert.equal(arm.batchScope.selectedChapterCount,1);assert.equal(arm.batchScope.firstChapterNumber,1);assert.equal(arm.batchScope.lastChapterNumber,1);assert.ok(arm.batchScope.quotaEnvelopeCharacters<=remaining);}
  finally{await rm(oldRoot,{recursive:true,force:true});await rm(out,{recursive:true,force:true});}
});

test('full cinematic rebuild creates a separate ten-chapter revision and leaves Chapter 11 off',async()=>{
  const p=plan(),r=recipe(),oldRoot=await mkdtemp(path.join(tmpdir(),'yasready-old-')),out=await mkdtemp(path.join(tmpdir(),'yasready-cine-'));
  try{const {oldArm,oldResult}=await historicalEvidence(p,oldRoot);const originalBefore=await readFile(path.join(oldRoot,oldResult.chapters[0].outputs.acxMp3));const armProvider=provider();const {arm}=await buildBookOneCinematicRebuildArm({productionPlan:p,recipeLock:r,manuscriptAnalysis:analysis(),previousArm:oldArm,previousResult:oldResult,previousRoot:oldRoot,provider:armProvider,ffmpeg:ffmpeg(),outputRoot:out,storageProbe:disk});const renderProvider=provider();const result=await renderBookOneCinematicRebuild({productionPlan:p,recipeLock:r,manuscriptAnalysis:analysis(),previousArm:oldArm,previousResult:oldResult,previousRoot:oldRoot,arm,provider:renderProvider,ffmpeg:ffmpeg(),outputRoot:out,approvalToken:arm.confirmation.token,maxUsd:arm.budget.protectedMaxUsd});assert.equal(verifyBookOneCinematicRebuildResult(result),true);assert.equal(result.status,'READY_FOR_HUMAN_TEN_CHAPTER_REVIEW');assert.equal(result.progress.completedChapterCount,10);assert.equal(result.guardrails.chapterElevenMayBeGenerated,false);assert.equal(result.guardrails.nextBatchArmed,false);assert.equal(result.guardrails.fullBookGenerationArmed,false);assert.equal(result.chapters.length,10);assert.ok(await readFile(path.join(out,'cinematic-rebuild-review.html')));assert.deepEqual(await readFile(path.join(oldRoot,oldResult.chapters[0].outputs.acxMp3)),originalBefore);assert.equal(renderProvider.calls,arm.batchScope.newProviderCalls);}
  finally{await rm(oldRoot,{recursive:true,force:true});await rm(out,{recursive:true,force:true});}
});

test('wrong CINEMATIC token blocks before any paid provider call',async()=>{
  const p=plan(),r=recipe(),oldRoot=await mkdtemp(path.join(tmpdir(),'yasready-old-')),out=await mkdtemp(path.join(tmpdir(),'yasready-cine-'));
  try{const {oldArm,oldResult}=await historicalEvidence(p,oldRoot);const {arm}=await buildBookOneCinematicRebuildArm({productionPlan:p,recipeLock:r,manuscriptAnalysis:analysis(),previousArm:oldArm,previousResult:oldResult,previousRoot:oldRoot,provider:provider(),ffmpeg:ffmpeg(),outputRoot:out,storageProbe:disk});const pr=provider();await assert.rejects(()=>renderBookOneCinematicRebuild({productionPlan:p,recipeLock:r,manuscriptAnalysis:analysis(),previousArm:oldArm,previousResult:oldResult,previousRoot:oldRoot,arm,provider:pr,ffmpeg:ffmpeg(),outputRoot:out,approvalToken:'CINEMATIC-WRONG',maxUsd:arm.budget.protectedMaxUsd}),/Exact CINEMATIC approval token/i);assert.equal(pr.calls,0);}
  finally{await rm(oldRoot,{recursive:true,force:true});await rm(out,{recursive:true,force:true});}
});
