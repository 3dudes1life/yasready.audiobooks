import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { loadStoredElevenLabsApiKey } from '../src/config/elevenlabs-key.js';

test('saved local ElevenLabs key loads when environment is empty and never needs to be re-entered',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'yasready-key-'));
  try{
    const file=path.join(dir,'elevenlabs.key');
    await writeFile(file,'test-secret-key\n');
    const env={};
    const result=await loadStoredElevenLabsApiKey({env,file});
    assert.equal(result.loaded,true);
    assert.equal(result.source,'yasready-local-config');
    assert.equal(env.ELEVENLABS_API_KEY,'test-secret-key');
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('explicit environment key wins over saved local config',async()=>{
  const env={ELEVENLABS_API_KEY:'already-set'};
  const result=await loadStoredElevenLabsApiKey({env,file:'/definitely/not/read'});
  assert.equal(result.source,'environment');
  assert.equal(env.ELEVENLABS_API_KEY,'already-set');
});
