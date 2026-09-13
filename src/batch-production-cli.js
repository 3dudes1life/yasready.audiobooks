import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  YASREADY_AUDIOBOOKS_VERSION,
  loadStoredElevenLabsApiKey,
  ElevenLabsProvider,
  FfmpegAdapter,
  extractManuscriptFile,
  analyzeManuscript,
  inspectBookOnePilotReuse,
  buildBookOneQuotaAwareBatchArm,
  renderBookOneQuotaAwareBatch,
  renderBookOneBatchArmMarkdown,
  buildBookOneDistributionOutputContract,
  startBatchProgressConsole
} from './index.js';

const args=process.argv.slice(2);
function flag(name,fallback=null){const i=args.indexOf(name);return i>=0&&i+1<args.length?args[i+1]:fallback;}
async function json(file){return JSON.parse(await readFile(path.resolve(file),'utf8'));}

async function loadPilotReuse({plan,recipe}){
  const pilotResultPath=flag('--pilot-result');
  const pilotStatePath=flag('--pilot-state');
  const pilotRoot=flag('--pilot-root');
  if(!pilotResultPath||!pilotStatePath||!pilotRoot)return null;
  const [pilotResult,pilotState]=await Promise.all([json(pilotResultPath),json(pilotStatePath)]);
  return inspectBookOnePilotReuse({productionPlan:plan,recipeLock:recipe,pilotResult,pilotState,pilotRoot});
}

async function runArm(){
  const planPath=args[1];
  const recipePath=flag('--recipe-lock');
  const preflightPath=flag('--preflight');
  const out=flag('--out');
  const productionRoot=flag('--production-root');
  if(!planPath||!recipePath||!preflightPath||!out||!productionRoot){
    console.error('Usage: node src/batch-production-cli.js arm <book-one-production-plan.json> --recipe-lock FILE --preflight FILE --out DIR --production-root DIR [--pilot-result FILE --pilot-state FILE --pilot-root DIR]');
    process.exitCode=2;return;
  }
  const [plan,recipe,preflight]=await Promise.all([json(planPath),json(recipePath),json(preflightPath)]);
  const pilotReuse=await loadPilotReuse({plan,recipe});
  await loadStoredElevenLabsApiKey();
  const provider=new ElevenLabsProvider();
  const ffmpeg=new FfmpegAdapter();
  const arm=await buildBookOneQuotaAwareBatchArm({productionPlan:plan,recipeLock:recipe,preflight,provider,ffmpeg,outputRoot:productionRoot,pilotReuse});
  const resolved=path.resolve(out);await mkdir(resolved,{recursive:true});
  const files={armJson:path.join(resolved,'book-one-batch-one-arm.json'),armMarkdown:path.join(resolved,'book-one-batch-one-arm.md'),contractJson:path.join(resolved,'book-one-distribution-output-contract.json'),confirmation:path.join(resolved,'batch-one-spend-authorization.txt')};
  await Promise.all([
    writeFile(files.armJson,JSON.stringify(arm,null,2)),
    writeFile(files.armMarkdown,renderBookOneBatchArmMarkdown(arm)),
    writeFile(files.contractJson,JSON.stringify(buildBookOneDistributionOutputContract(),null,2)),
    writeFile(files.confirmation,[arm.confirmation.token,`PROTECTED HARD MAX: $${Number(arm.budget.protectedMaxUsd).toFixed(2)}`,'AUTHORIZES EXACT BATCH ONE ONLY','FULL-BOOK GENERATION: OFF',''].join('\n'))
  ]);
  console.log(JSON.stringify({version:YASREADY_AUDIOBOOKS_VERSION,status:arm.status,batchToken:arm.confirmation.token,selectedChapterCount:arm.batchScope.selectedChapterCount,firstChapterOrder:arm.batchScope.firstChapterOrder,lastChapterOrder:arm.batchScope.lastChapterOrder,newProviderCalls:arm.batchScope.newProviderCalls,newProviderCharacters:arm.batchScope.newProviderCharacters,reusedPilotCalls:arm.batchScope.reusableProviderCalls,reusedPilotCharacters:arm.batchScope.reusableProviderCharacters,retryReserveCharacters:arm.batchScope.retryReserveCharacters,providerRemaining:arm.liveProvider.providerReportedRemaining,protectedMaxUsd:arm.budget.protectedMaxUsd,providerTtsCallsPerformed:0,providerTtsSpendUsd:0,fullBookGenerationArmed:false,files},null,2));
}

async function runRender(){
  const planPath=args[1];
  const recipePath=flag('--recipe-lock');
  const preflightPath=flag('--preflight');
  const armPath=flag('--arm');
  const manuscriptPath=flag('--manuscript');
  const outputRoot=flag('--production-root');
  const token=flag('--token');
  const maxUsd=Number(flag('--max-usd'));
  if(!planPath||!recipePath||!preflightPath||!armPath||!manuscriptPath||!outputRoot||!token||!Number.isFinite(maxUsd)){
    console.error('Usage: node src/batch-production-cli.js render <plan.json> --recipe-lock FILE --preflight FILE --arm FILE --manuscript FILE --production-root DIR --token BATCH-... --max-usd N [--pilot-result FILE --pilot-state FILE --pilot-root DIR]');
    process.exitCode=2;return;
  }
  const [plan,recipe,preflight,arm]=await Promise.all([json(planPath),json(recipePath),json(preflightPath),json(armPath)]);
  const extracted=extractManuscriptFile(path.resolve(manuscriptPath));
  const manuscriptAnalysis=analyzeManuscript(extracted);
  const pilotReuse=await loadPilotReuse({plan,recipe});
  await loadStoredElevenLabsApiKey();
  const provider=new ElevenLabsProvider();
  const ffmpeg=new FfmpegAdapter();
  const statePath=path.join(path.resolve(outputRoot),'batch-one-production-state.json');
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('YASREADY PRODUCTION CONSOLE — LIVE');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  const progress=startBatchProgressConsole({arm,statePath});
  let result;
  try{
    result=await renderBookOneQuotaAwareBatch({productionPlan:plan,recipeLock:recipe,preflight,arm,manuscriptAnalysis,provider,ffmpeg,outputRoot,approvalToken:token,maxUsd,pilotReuse});
  }finally{
    await progress.stop();
  }
  console.log(JSON.stringify({version:YASREADY_AUDIOBOOKS_VERSION,status:result.status,batchOrdinal:result.batch.ordinal,chapterCount:result.batch.chapterCount,firstChapterOrder:result.batch.firstChapterOrder,lastChapterOrder:result.batch.lastChapterOrder,providerGenerationCallsThisRun:result.provider.providerGenerationCallsThisRun,importedPilotPaidCallsThisRun:result.provider.importedPilotPaidCallsThisRun,capturedOrEstimatedBilledUsd:result.cost.capturedOrEstimatedBilledUsd,approvedMaxUsd:result.cost.approvedMaxUsd,acxTechnicalFilesReady:result.distribution.acx.technicalChapterFilesReady,spotifyTechnicalFilesReady:result.distribution.spotify.technicalChapterFilesReady,applePartnerSourceFilesReady:result.distribution.apple.losslessPartnerSourceFilesReady,directChapterFilesReady:Boolean(result.distribution.direct?.technicalChapterFilesReady),finalRetailerPackageComplete:false,nextBatchArmed:false,fullBookGenerationArmed:false,reviewBoard:path.join(path.resolve(outputRoot),'batch-one-review.html'),distributionManifest:path.join(path.resolve(outputRoot),'batch-one-distribution-manifest.json'),nextAction:result.nextAction},null,2));
}

if(args[0]==='arm')await runArm();
else if(args[0]==='render')await runRender();
else{console.error('Usage: node src/batch-production-cli.js <arm|render> ...');process.exitCode=2;}
