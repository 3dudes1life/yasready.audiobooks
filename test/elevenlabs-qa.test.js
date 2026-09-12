import test from 'node:test';
import assert from 'node:assert/strict';
import { ElevenLabsProvider } from '../src/providers/elevenlabs-provider.js';

function jsonResponse(payload, { status = 200 } = {}) {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json', 'request-id': 'req-qa' } });
}

test('forced alignment posts canonical text and audio as multipart', async () => {
  let captured = null;
  const provider = new ElevenLabsProvider({ apiKey: 'test', fetchImpl: async (url, init) => {
    captured = { url, init };
    return jsonResponse({ loss: 0.1, characters: [], words: [{ text: 'Hello', start: 0, end: 0.5, loss: 0.1 }] });
  }});
  const result = await provider.align({ audio: new Uint8Array([1, 2]), text: 'Hello', fileName: 'take.mp3' });
  assert.match(captured.url, /\/v1\/forced-alignment$/);
  assert.equal(captured.init.method, 'POST');
  assert.equal(captured.init.body.get('text'), 'Hello');
  assert.ok(captured.init.body.get('file') instanceof Blob);
  assert.equal(result.requestId, 'req-qa');
});

test('speech-to-text uses Scribe v2 and can carry keyterms', async () => {
  let form = null;
  const provider = new ElevenLabsProvider({ apiKey: 'test', fetchImpl: async (_url, init) => {
    form = init.body;
    return jsonResponse({ language_code: 'en', language_probability: 1, text: 'Juan', words: [] });
  }});
  await provider.transcribe({ audio: new Uint8Array([1]), model: 'scribe_v2', keyterms: ['Juan', 'Juan', 'bad[term]'] });
  assert.equal(form.get('model_id'), 'scribe_v2');
  assert.deepEqual(form.getAll('keyterms'), ['Juan']);
  assert.equal(form.get('tag_audio_events'), 'false');
});

test('speech-to-text supports source URL without local audio', async () => {
  let form = null;
  const provider = new ElevenLabsProvider({ apiKey: 'test', fetchImpl: async (_url, init) => {
    form = init.body;
    return jsonResponse({ text: 'hello', words: [] });
  }});
  await provider.transcribe({ sourceUrl: 'https://example.com/audio.mp3' });
  assert.equal(form.get('source_url'), 'https://example.com/audio.mp3');
  assert.equal(form.get('file'), null);
});

test('forced alignment fails closed when only URL is supplied', async () => {
  const provider = new ElevenLabsProvider({ apiKey: 'test', fetchImpl: async () => { throw new Error('should not call'); } });
  await assert.rejects(() => provider.align({ sourceUrl: 'https://example.com/audio.mp3', text: 'Hello' }), /requires an uploaded audio file/);
});
