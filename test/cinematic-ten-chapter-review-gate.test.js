import test from 'node:test';
import assert from 'node:assert/strict';
import {
  YASREADY_AUDIOBOOKS_VERSION,
  sha256,
  stableJson,
  buildBookOneProductionPlan,
  buildBookOneProductionRecipeLock,
  buildBookOneCinematicNaturalismLock,
  verifyBookOneCinematicNaturalismLock,
  buildBookOneCinematicHumanReviewSession,
  verifyBookOneCinematicHumanReviewSession,
  renderBookOneCinematicHumanReviewHtml,
  finalizeBookOneCinematicHumanReview,
  verifyBookOneCinematicHumanReviewApproval,
  buildBookOneCinematicNextBatchReadiness,
  cinematicRecipeFingerprint
} from '../src/index.js';

function narratorLock(){const core={schemaVersion:1,release:'0.14.3.12',artifact:'book-one-narrator-production-lock',status:'LOCKED_FOR_PRODUCTION_PLANNING',book:{id:'book-one',title:'Fixture Book',author:'Fixture Author',sourceHash:'fixture-source-hash'},narrator:{provider:'elevenlabs',providerVoiceId:'rU18Fk3uSDhmg5Xh41o4',candidateName:'Ryan Kurk - Pleasant and Smooth'},performanceProfile:{baseDirectionId:'playful-flirty',baseDirectionLabel:'Playful + Flirty',emotionalVariantId:'deep-controlled-emotion',emotionalVariantLabel:'Deep Controlled Emotion',emotionalRange:'dynamic',stability:.24,providerVoiceSettings:{speed:1.2,stability:.24},paceProfile:{providerNativeSpeed:1.2,effectiveSpeed:1.25,postProcessTempoMultiplier:1.041667,postProcessRequired:true,postProcessKind:'ffmpeg-atempo',pitchPreservingPostProcess:true}},productionArmed:false,fullBookGenerationArmed:false};return{...core,lockDigest:sha256(stableJson(core))};}
function finalization(){const lock=narratorLock();return{schemaVersion:1,release:'0.14.3.12',artifact:'book-one-pace-ceiling-finalization',status:'PASSED',decision:'pass',book:lock.book,narratorProductionLockCreated:true,productionArmed:false,fullBookGenerationArmed:false,narratorProductionLock:lock};}
function analysis(){
  const chapters=[];
  for(let i=0;i<12;i++){
    const segments=[
      {order:0,paragraphIndex:0,kind:'narration',text:`Chapter ${i+1} begins with a tense silence before the room settles.`,speakerCandidate:null},
      {order:1,paragraphIndex:1,kind:'dialogue',text:'“You really think that is going to work?” Juan teased with a grin.',speakerCandidate:'Juan'},
      {order:2,paragraphIndex:2,kind:'narration',text:'Michael hesitated, nervous but trying to look calm.',speakerCandidate:null},
      {order:3,paragraphIndex:3,kind:'dialogue',text:'“Maybe,” Michael said, trying not to laugh.',speakerCandidate:'Michael'},
      {order:4,paragraphIndex:4,kind:'dialogue',text:'“Then let us find out,” Christopher said softly.',speakerCandidate:'Christopher'}
    ];
    const text=segments.map(s=>s.text).join('\n');
    chapters.push({order:i,title:`Chapter ${i+1}: Fixture`,textHash:sha256(text),scenes:[{order:0,textHash:sha256(text),segments}]});
  }
  return{schemaVersion:3,source:{format:'docx',filename:'book.docx',sourceHash:'fixture-source-hash',normalizedTextHash:'n'},metadata:{title:'Fixture Book',author:'Fixture Author'},metrics:{words:1200,chapters:12,scenes:12,segments:60,estimatedMinutesAt155Wpm:8},chapters};
}
function plan(){return buildBookOneProductionPlan({paceCeilingFinalization:finalization(),manuscriptAnalysis:analysis(),explicitChunkCap:450,rateUsdPer1kCharacters:.10,retryReserveRatio:.20});}
function finishLock(){const p=plan();const core={schemaVersion:1,release:'0.14.3.14.2',artifact:'book-one-local-voice-finish-lock',status:'LOCKED_FOR_PRODUCTION_PLANNING_ONLY',sourcePilotRenderDigest:'pilot-render',narrator:{provider:'elevenlabs',providerVoiceId:p.productionRecipe.providerVoiceId,narratorName:p.productionRecipe.narratorName},performanceUnchanged:true,providerVoiceSettingsUnchanged:p.productionRecipe.providerVoiceSettings,paceProfileUnchanged:p.productionRecipe.paceProfile,selectedVariant:{id:'warm-slightly-deeper',label:'Warm + Slightly Deeper',kind:'local-tone-and-pitch',eq:{bodyHz:180,bodyDb:1.2,presenceHz:3000,presenceDb:-1.6,airHz:5200,airDb:-.8},semitones:-.5,pitchFactor:.971531941,durationCompensation:1.029302237,formantPreservationClaimed:false},productionArmed:false,fullBookGenerationArmed:false};return{...core,finishDigest:sha256(stableJson(core))};}
function recipe(){return buildBookOneProductionRecipeLock({productionPlan:plan(),localVoiceFinishLock:finishLock()});}

function lockCore(lock){return{schemaVersion:lock.schemaVersion,release:lock.release,artifact:lock.artifact,status:lock.status,profileId:lock.profileId,book:lock.book,source:lock.source,narrator:lock.narrator,lockedProductionChain:lock.lockedProductionChain,humanDecision:lock.humanDecision,rules:lock.rules,guardrails:lock.guardrails};}
function withRelease(lock,release){const clone=JSON.parse(JSON.stringify(lock));clone.release=release;clone.integrity.lockDigest=sha256(stableJson(lockCore(clone)));return clone;}
function resultCore(result){return{schemaVersion:result.schemaVersion,release:result.release,artifact:result.artifact,status:result.status,book:result.book,cinematicLockDigest:result.cinematicLockDigest,source:result.source,progress:result.progress,latestArm:result.latestArm,cost:result.cost,chapters:result.chapters,guardrails:result.guardrails};}
function result(lock,release=YASREADY_AUDIOBOOKS_VERSION){
  const p=plan();
  const chapters=analysis().chapters.slice(0,10).map((ch,i)=>({status:'COMPLETE',chapterNumber:i+1,sourceChapterOrder:i,title:ch.title,cueCount:i%2?4:7,providerCalls:2,providerCharacters:1000,outputs:{directMp3:`distribution/direct-owned/${i+1}.mp3`,archiveWav:`distribution/archive-wav/${i+1}.wav`,acxMp3:`distribution/acx-audible/${i+1}.mp3`},digests:{},qa:{archive:{passed:true,issues:[]},mp3:{passed:true,issues:[]}},analysis:{},completedAt:'2026-09-13T00:00:00Z'}));
  const base={schemaVersion:1,release,artifact:'book-one-cinematic-rebuild-result',status:'READY_FOR_HUMAN_TEN_CHAPTER_REVIEW',book:p.book,cinematicLockDigest:lock.integrity.lockDigest,source:{productionPlanDigest:p.integrity.productionPlanDigest,recipeDigest:'recipe',originalBatchResultDigest:'old-result',targetDigest:'target',outputRoot:'/tmp/cinematic',manuscriptSourceHash:p.source.sourceHash},progress:{targetChapterCount:10,completedChapterCount:10,remainingChapterCount:0,allTenComplete:true},latestArm:{},cost:{totalCinematicCapturedOrEstimatedBilledUsd:4.1544},chapters,guardrails:{originalBatchPreserved:true,originalsMayBeOverwritten:false,cinematicProfileLockedToA:true,plus2EscalationAllowed:false,humanTenChapterListenRequiredBeforeChapterEleven:true,chapterElevenMayBeGenerated:false,nextBatchArmed:false,fullBookGenerationArmed:false,automaticScaleUp:false},nextAction:'Human review.'};
  return{...base,integrity:{resultDigest:sha256(stableJson(resultCore(base)))}};
}
function decisions(session,{overallDecision='APPROVE_CINEMATIC_RECIPE',failChapter=null}={}){
  return{schemaVersion:1,artifact:'book-one-cinematic-human-review-decisions',source:{reviewSessionDigest:session.integrity.reviewSessionDigest,cinematicResultDigest:session.source.cinematicResultDigest,cinematicLockDigest:session.source.cinematicLockDigest,recipeFingerprint:session.profile.recipeFingerprint},heardAllTen:true,overallDecision,overallNotes:'Human listened straight through.',chapters:Array.from({length:10},(_,i)=>({chapterNumber:i+1,decision:failChapter===i+1?'FAIL':'PASS',notes:''}))};
}

test('0.14.3.20.2 is current application provenance',()=>assert.equal(YASREADY_AUDIOBOOKS_VERSION,'0.14.3.20.2'));

test('historical 0.14.3.18.2 cinematic lock remains verifiable for human review evidence',()=>{
  const current=buildBookOneCinematicNaturalismLock({productionPlan:plan(),recipeLock:recipe()});
  const historical=withRelease(current,'0.14.3.18.2');
  assert.equal(verifyBookOneCinematicNaturalismLock(historical),true);
  assert.equal(cinematicRecipeFingerprint(historical),cinematicRecipeFingerprint(current));
});

test('ten-chapter review session is zero-spend, immutable and keeps Chapter 11 closed',()=>{
  const lock=buildBookOneCinematicNaturalismLock({productionPlan:plan(),recipeLock:recipe()});
  const r=result(lock);
  const session=buildBookOneCinematicHumanReviewSession({cinematicResult:r,cinematicLock:lock});
  assert.equal(verifyBookOneCinematicHumanReviewSession(session),true);
  assert.equal(session.chapters.length,10);
  assert.equal(session.guardrails.providerTtsCallsPerformed,0);
  assert.equal(session.guardrails.providerSpendUsd,0);
  assert.equal(session.guardrails.chapterElevenMayBeGenerated,false);
  assert.equal(session.guardrails.nextBatchArmed,false);
});

test('review UI calls cues subtle performance directions and exports PASS/MAYBE/NEEDS CHANGES decisions',()=>{
  const lock=buildBookOneCinematicNaturalismLock({productionPlan:plan(),recipeLock:recipe()});
  const session=buildBookOneCinematicHumanReviewSession({cinematicResult:result(lock),cinematicLock:lock});
  const html=renderBookOneCinematicHumanReviewHtml(session);
  assert.match(html,/subtle performance direction/i);
  assert.match(html,/Pass/);
  assert.match(html,/Maybe/);
  assert.match(html,/Needs changes/);
  assert.match(html,/Export Review JSON/);
  assert.doesNotMatch(html,/restrained scene cue/i);
});

test('approval requires all ten explicit chapter decisions and creates no spend authorization',()=>{
  const lock=buildBookOneCinematicNaturalismLock({productionPlan:plan(),recipeLock:recipe()});
  const session=buildBookOneCinematicHumanReviewSession({cinematicResult:result(lock),cinematicLock:lock});
  const bad=decisions(session);bad.heardAllTen=false;
  assert.throws(()=>finalizeBookOneCinematicHumanReview({session,decisions:bad}),/all ten chapters/i);
  const approval=finalizeBookOneCinematicHumanReview({session,decisions:decisions(session)});
  assert.equal(verifyBookOneCinematicHumanReviewApproval(approval),true);
  assert.equal(approval.status,'APPROVED_FOR_NEXT_BATCH_READINESS');
  assert.equal(approval.guardrails.approvalCreatesNoSpendToken,true);
  assert.equal(approval.guardrails.chapterElevenMayBeGenerated,false);
  assert.equal(approval.guardrails.nextBatchArmed,false);
});

test('a chapter marked NEEDS CHANGES blocks recipe approval',()=>{
  const lock=buildBookOneCinematicNaturalismLock({productionPlan:plan(),recipeLock:recipe()});
  const session=buildBookOneCinematicHumanReviewSession({cinematicResult:result(lock),cinematicLock:lock});
  assert.throws(()=>finalizeBookOneCinematicHumanReview({session,decisions:decisions(session,{failChapter:4})}),/cannot approve/i);
});

test('approved review opens exact cinematic read-only readiness for Chapter 11 onward without arming spend',()=>{
  const p=plan(),a=analysis(),lock=buildBookOneCinematicNaturalismLock({productionPlan:p,recipeLock:recipe()});
  const r=result(lock);
  const session=buildBookOneCinematicHumanReviewSession({cinematicResult:r,cinematicLock:lock});
  const approval=finalizeBookOneCinematicHumanReview({session,decisions:decisions(session)});
  const readiness=buildBookOneCinematicNextBatchReadiness({productionPlan:p,manuscriptAnalysis:a,cinematicResult:r,cinematicLock:lock,humanReviewApproval:approval,providerRemaining:100000,providerTier:'creator'});
  assert.equal(readiness.status,'READINESS_CALCULATED_HUMAN_GATE_OPEN');
  assert.equal(readiness.candidateBatch.firstChapterNumber,11);
  assert.equal(readiness.candidateBatch.lastChapterNumber,12);
  assert.equal(readiness.candidateBatch.chapterCount,2);
  assert.ok(readiness.candidateBatch.newProviderCharacters>0);
  assert.ok(readiness.candidateBatch.chapters.every(ch=>ch.subtlePerformanceDirections>0));
  assert.equal(readiness.guardrails.providerTtsCallsPerformed,0);
  assert.equal(readiness.guardrails.noApprovalTokenCreated,true);
  assert.equal(readiness.guardrails.chapterElevenMayBeGenerated,false);
  assert.equal(readiness.guardrails.nextBatchArmed,false);
  assert.equal(readiness.budgetPreview.spendAuthorized,false);
});

test('next-batch readiness rejects a human review artifact from another cinematic result',()=>{
  const p=plan(),a=analysis(),lock=buildBookOneCinematicNaturalismLock({productionPlan:p,recipeLock:recipe()});
  const r=result(lock);
  const session=buildBookOneCinematicHumanReviewSession({cinematicResult:r,cinematicLock:lock});
  const approval=JSON.parse(JSON.stringify(finalizeBookOneCinematicHumanReview({session,decisions:decisions(session)})));
  approval.source.cinematicResultDigest='wrong';
  assert.throws(()=>buildBookOneCinematicNextBatchReadiness({productionPlan:p,manuscriptAnalysis:a,cinematicResult:r,cinematicLock:lock,humanReviewApproval:approval,providerRemaining:100000}),/digest mismatch|does not belong/i);
});
