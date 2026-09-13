import test from 'node:test';
import assert from 'node:assert/strict';
import {
  YASREADY_AUDIOBOOKS_VERSION,
  sha256,
  stableJson,
  buildBookOneProductionPlan,
  buildBookOneProductionRecipeLock,
  verifyBookOneProductionRecipeLock,
  verifyBookOneLocalVoiceFinishLock,
  runBookOneFullBookPreflight,
  verifyBookOneFullBookPreflight,
  renderBookOneFullBookPreflightMarkdown
} from '../src/index.js';

function narratorLock() {
  const core = {
    schemaVersion: 1, release: '0.14.3.12', artifact: 'book-one-narrator-production-lock', status: 'LOCKED_FOR_PRODUCTION_PLANNING',
    book: { id: 'book-one', title: 'Tres Amigos, Una Vida – A Throuple Love Story', author: 'D.C.W.', sourceHash: 'fixture-source-hash' },
    narrator: { provider: 'elevenlabs', providerVoiceId: 'rU18Fk3uSDhmg5Xh41o4', candidateName: 'Ryan Kurk - Pleasant and Smooth' },
    performanceProfile: {
      baseDirectionId:'playful-flirty', baseDirectionLabel:'Playful + Flirty', emotionalVariantId:'deep-controlled-emotion', emotionalVariantLabel:'Deep Controlled Emotion', stability:0.24,
      providerVoiceSettings:{speed:1.2,stability:0.24},
      paceProfile:{providerNativeSpeed:1.2,effectiveSpeed:1.25,postProcessTempoMultiplier:1.041667,postProcessRequired:true,postProcessKind:'ffmpeg-atempo',pitchPreservingPostProcess:true}
    },
    productionArmed:false, fullBookGenerationArmed:false
  };
  return { ...core, lockDigest: sha256(stableJson(core)) };
}
function finalization() {
  const lock=narratorLock(); return { schemaVersion:1,release:'0.14.3.12',artifact:'book-one-pace-ceiling-finalization',status:'PASSED',decision:'pass',book:lock.book,narratorProductionLockCreated:true,productionArmed:false,fullBookGenerationArmed:false,narratorProductionLock:lock };
}
function analysis() {
  const seg=(order,text)=>({order,paragraphIndex:order,kind:'narration',text,speakerCandidate:null});
  const text='A warm opening line with emotional truth.\nJuan smiled and Michael answered.';
  return { schemaVersion:3,source:{format:'docx',filename:'book.docx',sourceHash:'fixture-source-hash',normalizedTextHash:'n'},metadata:{title:'Tres Amigos, Una Vida – A Throuple Love Story',author:'D.C.W.'},metrics:{words:12000,chapters:2,scenes:2,segments:4},chapters:[
    {order:0,title:'Chapter 1',textHash:'c1',scenes:[{order:0,textHash:'s1',segments:text.split('\n').map((x,i)=>seg(i,x))}]},
    {order:1,title:'Chapter 2',textHash:'c2',scenes:[{order:0,textHash:'s2',segments:[seg(0,text.repeat(40))]}]}
  ]};
}
function plan() { return buildBookOneProductionPlan({paceCeilingFinalization:finalization(),manuscriptAnalysis:analysis(),explicitChunkCap:500,rateUsdPer1kCharacters:0.10,retryReserveRatio:0.20}); }
function finishLock() {
  const p=plan();
  const core={schemaVersion:1,release:'0.14.3.14.2',artifact:'book-one-local-voice-finish-lock',status:'LOCKED_FOR_PRODUCTION_PLANNING_ONLY',sourcePilotRenderDigest:'pilot-render',narrator:{provider:'elevenlabs',providerVoiceId:p.productionRecipe.providerVoiceId,narratorName:p.productionRecipe.narratorName},performanceUnchanged:true,providerVoiceSettingsUnchanged:p.productionRecipe.providerVoiceSettings,paceProfileUnchanged:p.productionRecipe.paceProfile,selectedVariant:{id:'warm-slightly-deeper',label:'Warm + Slightly Deeper',kind:'local-tone-and-pitch',eq:{bodyHz:180,bodyDb:1.2,presenceHz:3000,presenceDb:-1.6,airHz:5200,airDb:-0.8},semitones:-0.5,pitchFactor:0.971531941,durationCompensation:1.029302237,formantPreservationClaimed:false},productionArmed:false,fullBookGenerationArmed:false};
  return {...core,finishDigest:sha256(stableJson(core))};
}
function provider(remaining=1_000_000){return{healthCheck:async()=>({ok:true,status:200}),subscriptionPreflight:async()=>({available:true,safeToContinue:true,tier:'creator',status:'active',subscription:{tier:'creator',status:'active',character_count:1000,character_limit:1000+remaining}})}};
const ffmpeg={healthCheck:async()=>({ok:true,ffmpeg:'ffmpeg fixture',ffprobe:'ffprobe fixture'})};
const disk=(gib=100)=>async(root)=>({root,availableBytes:gib*1024**3,availableGiB:gib});

test('0.14.3.16 is current application provenance',()=>assert.equal(YASREADY_AUDIOBOOKS_VERSION,'0.14.3.16'));
test('final Warm + Slightly Deeper finish lock validates exactly',()=>{const lock=finishLock();assert.equal(verifyBookOneLocalVoiceFinishLock(lock),true);assert.equal(lock.selectedVariant.semitones,-0.5);});
test('recipe lock merges narrator performance pace and local finish without arming production',()=>{const p=plan(),f=finishLock();const r=buildBookOneProductionRecipeLock({productionPlan:p,localVoiceFinishLock:f});assert.equal(verifyBookOneProductionRecipeLock(r),true);assert.equal(r.narrator.name,'Ryan Kurk - Pleasant and Smooth');assert.equal(r.localVoiceFinish.id,'warm-slightly-deeper');assert.equal(r.pace.effectiveSpeed,1.25);assert.equal(r.guardrails.fullBookGenerationArmed,false);assert.equal(r.guardrails.providerTtsCallsPerformed,0);});
test('tampered local finish digest fails closed',()=>{const f=finishLock();f.selectedVariant.semitones=-2;assert.throws(()=>verifyBookOneLocalVoiceFinishLock(f),/digest mismatch/i);});
test('provider settings drift between plan and finish lock fails closed',()=>{const p=plan(),f=finishLock();const core={...f,providerVoiceSettingsUnchanged:{...f.providerVoiceSettingsUnchanged,stability:0.5}};delete core.finishDigest;core.finishDigest=sha256(stableJson(core));assert.throws(()=>buildBookOneProductionRecipeLock({productionPlan:p,localVoiceFinishLock:core}),/provider voice settings drifted/i);});
test('green full-book preflight is zero-TTS and still unarmed',async()=>{const p=plan(),f=finishLock();const {preflight}=await runBookOneFullBookPreflight({productionPlan:p,localVoiceFinishLock:f,provider:provider(),ffmpeg,outputRoot:'/tmp/yasready-full-book-fixture',storageProbe:disk(100)});assert.equal(preflight.status,'READY_FOR_EXPLICIT_FULL_BOOK_ARM');assert.equal(preflight.guardrails.providerTtsCallsPerformed,0);assert.equal(preflight.guardrails.productionArmed,false);assert.equal(preflight.guardrails.fullBookGenerationArmed,false);assert.equal(verifyBookOneFullBookPreflight(preflight),true);});
test('insufficient live provider quota becomes a blocker, not a fake approval',async()=>{const p=plan(),f=finishLock();const {preflight}=await runBookOneFullBookPreflight({productionPlan:p,localVoiceFinishLock:f,provider:provider(10),ffmpeg,outputRoot:'/tmp/yasready-full-book-fixture',storageProbe:disk(100)});assert.equal(preflight.status,'BLOCKED_NOT_READY_FOR_FULL_BOOK_ARM');assert.ok(preflight.blockers.some(x=>x.id==='full-book-provider-quota'));assert.ok(preflight.provider.deficitCharacters>0);assert.equal(preflight.provider.creditsInferred,false);});
test('missing live quota fields block instead of becoming zero',async()=>{const bad={healthCheck:async()=>({ok:true,status:200}),subscriptionPreflight:async()=>({available:true,safeToContinue:true,subscription:{tier:'creator'}})};const {preflight}=await runBookOneFullBookPreflight({productionPlan:plan(),localVoiceFinishLock:finishLock(),provider:bad,ffmpeg,outputRoot:'/tmp/yasready-full-book-fixture',storageProbe:disk(100)});assert.equal(preflight.status,'BLOCKED_NOT_READY_FOR_FULL_BOOK_ARM');assert.ok(preflight.blockers.some(x=>x.id==='live-provider-quota-verified'));});
test('insufficient local storage blocks before any future arm',async()=>{const {preflight}=await runBookOneFullBookPreflight({productionPlan:plan(),localVoiceFinishLock:finishLock(),provider:provider(),ffmpeg,outputRoot:'/tmp/yasready-full-book-fixture',storageProbe:disk(0.1)});assert.equal(preflight.status,'BLOCKED_NOT_READY_FOR_FULL_BOOK_ARM');assert.ok(preflight.blockers.some(x=>x.id==='local-storage-headroom'));});
test('FFmpeg failure blocks full-book readiness',async()=>{const badFfmpeg={healthCheck:async()=>({ok:false,reason:'missing'})};const {preflight}=await runBookOneFullBookPreflight({productionPlan:plan(),localVoiceFinishLock:finishLock(),provider:provider(),ffmpeg:badFfmpeg,outputRoot:'/tmp/yasready-full-book-fixture',storageProbe:disk(100)});assert.equal(preflight.status,'BLOCKED_NOT_READY_FOR_FULL_BOOK_ARM');assert.ok(preflight.blockers.some(x=>x.id==='ffmpeg-health'));});
test('preflight token is reference-only and markdown says full book remains off',async()=>{const {preflight}=await runBookOneFullBookPreflight({productionPlan:plan(),localVoiceFinishLock:finishLock(),provider:provider(),ffmpeg,outputRoot:'/tmp/yasready-full-book-fixture',storageProbe:disk(100)});assert.match(preflight.confirmation.token,/^PREFLIGHT-[A-F0-9]{10}$/);assert.equal(preflight.confirmation.semantics,'REFERENCE_ONLY_NOT_SPEND_AUTHORIZATION');const md=renderBookOneFullBookPreflightMarkdown(preflight);assert.match(md,/Full-book generation armed:\*\* NO/i);assert.match(md,/not spend authorization/i);});
