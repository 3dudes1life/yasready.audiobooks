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
  compileCinematicNaturalismScene,
  materializeBookOneCinematicTarget
} from '../src/index.js';

function narratorLock() {
  const core={schemaVersion:1,release:'0.14.3.12',artifact:'book-one-narrator-production-lock',status:'LOCKED_FOR_PRODUCTION_PLANNING',book:{id:'book-one',title:'Fixture Book',author:'Fixture Author',sourceHash:'fixture-source-hash'},narrator:{provider:'elevenlabs',providerVoiceId:'rU18Fk3uSDhmg5Xh41o4',candidateName:'Ryan Kurk - Pleasant and Smooth'},performanceProfile:{baseDirectionId:'playful-flirty',baseDirectionLabel:'Playful + Flirty',emotionalVariantId:'deep-controlled-emotion',emotionalVariantLabel:'Deep Controlled Emotion',emotionalRange:'dynamic',stability:0.24,providerVoiceSettings:{speed:1.2,stability:0.24},paceProfile:{providerNativeSpeed:1.2,effectiveSpeed:1.25,postProcessTempoMultiplier:1.041667,postProcessRequired:true,postProcessKind:'ffmpeg-atempo',pitchPreservingPostProcess:true}},productionArmed:false,fullBookGenerationArmed:false};
  return {...core,lockDigest:sha256(stableJson(core))};
}
function finalization(){const lock=narratorLock();return{schemaVersion:1,release:'0.14.3.12',artifact:'book-one-pace-ceiling-finalization',status:'PASSED',decision:'pass',book:lock.book,narratorProductionLockCreated:true,productionArmed:false,fullBookGenerationArmed:false,narratorProductionLock:lock};}
function analysis(){
  const ch=[];
  for(let i=0;i<10;i++){
    const segments=[
      {order:0,paragraphIndex:0,kind:'narration',text:`Chapter ${i+1} opened with a little tension and a silence that hung between them.`,speakerCandidate:null},
      {order:1,paragraphIndex:1,kind:'dialogue',text:'“You are seriously going to pretend that did not happen?” Juan teased with a grin.',speakerCandidate:'Juan'},
      {order:2,paragraphIndex:2,kind:'narration',text:'Michael hesitated, trying not to show how nervous the question made him.',speakerCandidate:null},
      {order:3,paragraphIndex:3,kind:'dialogue',text:'“I have absolutely no idea what you mean,” Michael said.',speakerCandidate:'Michael'},
      {order:4,paragraphIndex:4,kind:'dialogue',text:'“Sure you do,” Christopher said softly, his expression warm.',speakerCandidate:'Christopher'}
    ];
    const text=segments.map(s=>s.text).join('\n');
    ch.push({order:i,title:`Chapter ${i+1}: Fixture`,textHash:sha256(text),scenes:[{order:0,textHash:sha256(text),segments}]});
  }
  return{schemaVersion:3,source:{format:'docx',filename:'book.docx',sourceHash:'fixture-source-hash',normalizedTextHash:'n'},metadata:{title:'Fixture Book',author:'Fixture Author'},metrics:{words:1000,chapters:10,scenes:10,segments:50,estimatedMinutesAt155Wpm:7},chapters:ch};
}
function plan(){return buildBookOneProductionPlan({paceCeilingFinalization:finalization(),manuscriptAnalysis:analysis(),explicitChunkCap:450,rateUsdPer1kCharacters:.10,retryReserveRatio:.20});}
function finishLock(){const p=plan();const core={schemaVersion:1,release:'0.14.3.14.2',artifact:'book-one-local-voice-finish-lock',status:'LOCKED_FOR_PRODUCTION_PLANNING_ONLY',sourcePilotRenderDigest:'pilot-render',narrator:{provider:'elevenlabs',providerVoiceId:p.productionRecipe.providerVoiceId,narratorName:p.productionRecipe.narratorName},performanceUnchanged:true,providerVoiceSettingsUnchanged:p.productionRecipe.providerVoiceSettings,paceProfileUnchanged:p.productionRecipe.paceProfile,selectedVariant:{id:'warm-slightly-deeper',label:'Warm + Slightly Deeper',kind:'local-tone-and-pitch',eq:{bodyHz:180,bodyDb:1.2,presenceHz:3000,presenceDb:-1.6,airHz:5200,airDb:-0.8},semitones:-.5,pitchFactor:.971531941,durationCompensation:1.029302237,formantPreservationClaimed:false},productionArmed:false,fullBookGenerationArmed:false};return{...core,finishDigest:sha256(stableJson(core))};}
function recipe(){return buildBookOneProductionRecipeLock({productionPlan:plan(),localVoiceFinishLock:finishLock()});}

test('0.14.3.20.4 is current application provenance',()=>assert.equal(YASREADY_AUDIOBOOKS_VERSION,'0.14.3.20.4'));

test('human-selected A is locked and +2 is explicitly rejected',()=>{
  const lock=buildBookOneCinematicNaturalismLock({productionPlan:plan(),recipeLock:recipe()});
  assert.equal(verifyBookOneCinematicNaturalismLock(lock),true);
  assert.equal(lock.humanDecision.selectedComparison,'A_CURRENT_CINEMATIC');
  assert.equal(lock.humanDecision.rejectedEscalation,'B_CINEMATIC_PLUS2');
  assert.equal(lock.rules.plus2EscalationAllowed,false);
  assert.equal(lock.lockedProductionChain.effectiveSpeed,1.25);
  assert.equal(lock.lockedProductionChain.localFinish,'Warm + Slightly Deeper');
});

test('Cinematic Naturalism preserves canonical words and adds only restrained earned cues',()=>{
  const p=plan(),r=recipe(),lock=buildBookOneCinematicNaturalismLock({productionPlan:p,recipeLock:r});
  const scene=analysis().chapters[0].scenes[0];
  const compiled=compileCinematicNaturalismScene(scene.segments,lock);
  assert.equal(compiled.segments.map(s=>s.canonicalText).join('\n'),scene.segments.map(s=>s.text).join('\n'));
  assert.ok(compiled.cueCount>=1);
  assert.ok(compiled.cueCount<=7);
  assert.ok(compiled.cues.every(c=>lock.rules.allowedProviderCues.includes(c.cue)));
  for(let i=1;i<compiled.cues.length;i++) assert.ok(compiled.cues[i].index-compiled.cues[i-1].index>=2);
  assert.equal(compiled.providerText.replace(/^\[[^\]]+\]\s*/gm,''),compiled.canonicalText);
});


test('canonical guard preserves legitimate manuscript bracket prefixes and strips only cues YasReady inserted',()=>{
  const p=plan(),r=recipe(),lock=buildBookOneCinematicNaturalismLock({productionPlan:p,recipeLock:r});
  const segments=[
    {order:0,paragraphIndex:0,kind:'narration',text:'[Text message] Meet me downstairs when you are ready.',speakerCandidate:null},
    {order:1,paragraphIndex:1,kind:'dialogue',text:'“Fine,” Juan teased with a grin.',speakerCandidate:'Juan'},
    {order:2,paragraphIndex:2,kind:'narration',text:'[Later that night] Michael hesitated in the doorway.',speakerCandidate:null}
  ];
  const compiled=compileCinematicNaturalismScene(segments,lock);
  assert.equal(compiled.canonicalText,segments.map(s=>s.text).join('\n'));
  assert.ok(compiled.providerText.includes('[Text message] Meet me downstairs when you are ready.'));
  assert.ok(compiled.providerText.includes('[Later that night] Michael hesitated in the doorway.'));
  for(const row of compiled.segments){
    if(row.cue) assert.equal(row.providerText.slice(`[${row.cue}] `.length),row.canonicalText);
    else assert.equal(row.providerText,row.canonicalText);
  }
});

test('ten-chapter cinematic target is deterministic and uses the A lock in every generation digest',()=>{
  const p=plan(),r=recipe(),lock=buildBookOneCinematicNaturalismLock({productionPlan:p,recipeLock:r});
  const one=materializeBookOneCinematicTarget({productionPlan:p,recipeLock:r,manuscriptAnalysis:analysis(),cinematicLock:lock});
  const two=materializeBookOneCinematicTarget({productionPlan:p,recipeLock:r,manuscriptAnalysis:analysis(),cinematicLock:lock});
  assert.equal(one.chapterCount,10);
  assert.equal(one.targetDigest,two.targetDigest);
  assert.ok(one.providerCharacters>p.manifest.providerCharacters); // direction tags + spoken headings
  assert.ok(one.cueCount>0);
  assert.ok(one.chapters.every(ch=>ch.chunks[0].id.endsWith('-heading')));
});
