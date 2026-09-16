import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCinematicAssemblyPlan,
  buildCinematicNarratorContinuity,
  FfmpegAdapter,
  BOOK_ONE_CINEMATIC_TITLE_BODY_GAP_SECONDS,
  BOOK_ONE_CINEMATIC_SCENE_GAP_SECONDS
} from '../src/index.js';

const lock = { integrity: { lockDigest: 'a'.repeat(64) } };

function fixtureChapter() {
  return {
    chapterNumber: 1,
    chunks: [
      { id:'ch01-heading', kind:'heading', text:'Chapter 1: Departure.', boundaryBefore:'CHAPTER_START', assemblyGapBeforeSec:0 },
      { id:'ch01-sc01-cin01', kind:'body', text:'First paragraph.', boundaryBefore:'TITLE_TO_BODY', assemblyGapBeforeSec:2.0 },
      { id:'ch01-sc01-cin02', kind:'body', text:'Continuation.', boundaryBefore:'CHUNK_CONTINUATION', assemblyGapBeforeSec:0 },
      { id:'ch01-sc02-cin01', kind:'body', text:'New scene.', boundaryBefore:'SCENE_BREAK', assemblyGapBeforeSec:0.75 }
    ]
  };
}

test('R7 title is isolated and assembly owns the exact 2.00 second title→body boundary',()=>{
  assert.equal(BOOK_ONE_CINEMATIC_TITLE_BODY_GAP_SECONDS,2);
  assert.equal(BOOK_ONE_CINEMATIC_SCENE_GAP_SECONDS,0.75);
  const plan=buildCinematicAssemblyPlan(fixtureChapter());
  assert.deepEqual(plan.map(x=>x.type==='AUDIO'?`A:${x.chunkId}`:`S:${x.boundary}:${x.seconds}`),[
    'A:ch01-heading',
    'S:TITLE_TO_BODY:2',
    'A:ch01-sc01-cin01',
    'A:ch01-sc01-cin02',
    'S:SCENE_BREAK:0.75',
    'A:ch01-sc02-cin01'
  ]);
});

test('R7 narrator continuity isolates heading and chains only body request ids',()=>{
  const chapter=fixtureChapter();
  const heading=buildCinematicNarratorContinuity({chapter,chunk:chapter.chunks[0],priorBodyRequestIds:['should-not-leak'],cinematicLock:lock});
  assert.equal(heading.mode,'HEADING_ISOLATED');
  assert.deepEqual(heading.previousRequestIds,[]);
  assert.equal(heading.previousText,null);
  assert.equal(heading.nextText,null);

  const first=buildCinematicNarratorContinuity({chapter,chunk:chapter.chunks[1],priorBodyRequestIds:[],cinematicLock:lock});
  const second=buildCinematicNarratorContinuity({chapter,chunk:chapter.chunks[2],priorBodyRequestIds:['req-body-1'],cinematicLock:lock});
  const nextScene=buildCinematicNarratorContinuity({chapter,chunk:chapter.chunks[3],priorBodyRequestIds:['req-body-1','req-body-2'],cinematicLock:lock});

  assert.equal(first.mode,'BODY_CONTINUITY');
  assert.equal(first.previousText,null);
  assert.equal(first.nextText,'Continuation.');
  assert.deepEqual(first.previousRequestIds,[]);
  assert.equal(second.previousText,'First paragraph.');
  assert.equal(second.nextText,'New scene.');
  assert.deepEqual(second.previousRequestIds,['req-body-1']);
  assert.deepEqual(nextScene.previousRequestIds,['req-body-1','req-body-2']);
  assert.equal(first.seed,second.seed);
  assert.equal(second.seed,nextScene.seed);
  assert.notEqual(first.seed,heading.seed);
});

test('R7 continuity request-id history is hard-capped to the provider-safe last 3 body requests',()=>{
  const chapter=fixtureChapter();
  const c=buildCinematicNarratorContinuity({
    chapter,
    chunk:chapter.chunks[3],
    priorBodyRequestIds:['r1','r2','r3','r4','r5'],
    cinematicLock:lock
  });
  assert.deepEqual(c.previousRequestIds,['r3','r4','r5']);
});

test('R7 local FFmpeg helpers generate silence and trim only requested edges',async()=>{
  const calls=[];
  const execFileImpl=async(bin,args)=>{calls.push({bin,args});return{stdout:'',stderr:''};};
  const ff=new FfmpegAdapter({ffmpegPath:'ffmpeg-test',ffprobePath:'ffprobe-test',execFileImpl});
  await ff.silence('/tmp/gap.wav',2);
  await ff.trimEdgeSilence('/tmp/in.wav','/tmp/out.wav',{trimStart:true,trimEnd:true,thresholdDb:-70,minSilenceMs:40});

  assert.equal(calls[0].bin,'ffmpeg-test');
  assert.ok(calls[0].args.includes('2.000'));
  assert.ok(calls[0].args.some(x=>String(x).includes('anullsrc')));
  const filterIndex=calls[1].args.indexOf('-af');
  assert.ok(filterIndex>0);
  const filter=calls[1].args[filterIndex+1];
  assert.match(filter,/silenceremove/);
  assert.match(filter,/areverse/);
  assert.match(filter,/-70dB/);
});

test('R7 character fingerprints remain intentionally gated off during narrator-baseline repair',async()=>{
  const { readFile } = await import('node:fs/promises');
  const source=await readFile(new URL('../src/services/book-one-cinematic-naturalism-service.js',import.meta.url),'utf8');
  assert.match(source,/namedCharacterVoiceFingerprintsEnabled:\s*false/);
  assert.match(source,/AFTER_NARRATOR_BASELINE_PROVEN/);
  assert.match(source,/previousRequestIds:\s*continuity\.previousRequestIds/);
  assert.match(source,/buildCinematicAssemblyPlan\(chapter\)/);
});
