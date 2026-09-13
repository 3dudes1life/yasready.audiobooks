import test from 'node:test';
import assert from 'node:assert/strict';
import {
  YASREADY_AUDIOBOOKS_VERSION,
  ElevenLabsProvider,
  BOOK_ONE_PILOT_ACCEPTED_ARM_RELEASES,
  BOOK_ONE_PILOT_ACCEPTED_PLAN_RELEASES
} from '../src/index.js';

function okAudioResponse() {
  return new Response(new Uint8Array([1,2,3,4]), {
    status: 200,
    headers: {
      'content-type': 'audio/mpeg',
      'character-cost': '5',
      'request-id': 'fixture-request'
    }
  });
}

test('0.14.3.18.1 is current application provenance', () => {
  assert.equal(YASREADY_AUDIOBOOKS_VERSION, '0.14.3.18.1');
});

test('Eleven v3 omits unsupported previous_text and next_text at provider boundary', async () => {
  const calls=[];
  const provider=new ElevenLabsProvider({
    apiKey:'fixture-key',
    fetchImpl:async(url, options={})=>{ calls.push({url,options}); return okAudioResponse(); }
  });
  await provider.render({
    voiceId:'voice-1', text:'Hello', model:'eleven_v3',
    previousText:'Previous context', nextText:'Next context',
    voiceSettings:{speed:1.2,stability:.24}
  });
  assert.equal(calls.length,1);
  const body=JSON.parse(calls[0].options.body);
  assert.equal(body.model_id,'eleven_v3');
  assert.equal(body.previous_text,undefined);
  assert.equal(body.next_text,undefined);
  assert.equal(body.voice_settings.speed,1.2);
  assert.equal(body.voice_settings.stability,.24);
});

test('models that support continuity text still receive previous_text and next_text', async () => {
  const calls=[];
  const provider=new ElevenLabsProvider({
    apiKey:'fixture-key',
    fetchImpl:async(url, options={})=>{ calls.push({url,options}); return okAudioResponse(); }
  });
  await provider.render({
    voiceId:'voice-1', text:'Hello', model:'eleven_multilingual_v2',
    previousText:'Previous context', nextText:'Next context'
  });
  const body=JSON.parse(calls[0].options.body);
  assert.equal(body.previous_text,'Previous context');
  assert.equal(body.next_text,'Next context');
});

test('hotfix accepts the existing 0.14.3.14 production plan and pilot arm for safe resume', () => {
  assert.ok(BOOK_ONE_PILOT_ACCEPTED_PLAN_RELEASES.includes('0.14.3.14'));
  assert.ok(BOOK_ONE_PILOT_ACCEPTED_PLAN_RELEASES.includes('0.14.3.14.1'));
  assert.ok(BOOK_ONE_PILOT_ACCEPTED_ARM_RELEASES.includes('0.14.3.14'));
  assert.ok(BOOK_ONE_PILOT_ACCEPTED_ARM_RELEASES.includes('0.14.3.14.1'));
});
