import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ElevenLabsProvider,
  BookOneCastingDiscoveryService,
  buildCastingDiscoveryFixture,
  YASREADY_AUDIOBOOKS_VERSION
} from '../src/index.js';

function response(status, payload) {
  const body = JSON.stringify(payload);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    clone() { return response(status, payload); },
    async json() { return payload; },
    async text() { return body; }
  };
}

test('0.14.3 is current application provenance', () => {
  assert.equal(YASREADY_AUDIOBOOKS_VERSION, '0.14.3');
});

test('ElevenLabs shared catalog falls back to unfiltered public browsing on logged-out filter 401', async () => {
  const calls = [];
  const provider = new ElevenLabsProvider({
    apiKey: null,
    fetchImpl: async (url, options = {}) => {
      calls.push({ url: String(url), options });
      if (calls.length === 1) {
        return response(401, { detail: { type: 'authentication_error', code: 'unauthorized', status: 'not_logged_in', message: 'You must be logged in to use filters.' } });
      }
      return response(200, {
        voices: [{
          voice_id: 'fallback-v1', name: 'Fallback Voice', category: 'professional',
          language: 'en', notice_period_days: 365, preview_url: 'https://example.test/fallback.mp3',
          verified_languages: [{ language: 'en', locale: 'en-US' }]
        }],
        has_more: false
      });
    }
  });

  const result = await provider.searchVoices({
    language: 'en', category: 'professional', minNoticePeriodDays: 180,
    includeCustomRates: false, includeLiveModerated: false, page: 0, pageSize: 100
  });

  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /language=en/);
  assert.match(calls[0].url, /min_notice_period_days=180/);
  assert.doesNotMatch(calls[1].url, /language=/);
  assert.doesNotMatch(calls[1].url, /min_notice_period_days=/);
  assert.equal(result.anonymousFallbackUsed, true);
  assert.equal(result.providerFiltersApplied, false);
  assert.equal(result.queryMode, 'anonymous-unfiltered');
  assert.equal(result.voices[0].providerVoiceId, 'fallback-v1');
});

test('authenticated ElevenLabs filtered discovery stays single-call and filtered', async () => {
  const calls = [];
  const provider = new ElevenLabsProvider({
    apiKey: 'test-key',
    fetchImpl: async (url, options = {}) => {
      calls.push({ url: String(url), options });
      return response(200, {
        voices: [{
          voice_id: 'auth-v1', name: 'Authenticated Voice', category: 'professional',
          language: 'en', notice_period_days: 365,
          verified_languages: [{ language: 'en', locale: 'en-US' }]
        }],
        has_more: false
      });
    }
  });
  const result = await provider.searchVoices({ language: 'en', category: 'professional', minNoticePeriodDays: 180 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.headers['xi-api-key'], 'test-key');
  assert.equal(result.anonymousFallbackUsed, false);
  assert.equal(result.providerFiltersApplied, true);
  assert.equal(result.queryMode, 'authenticated-filtered');
});

test('anonymous fallback still enforces Book One discovery policy locally', async () => {
  const fixture = buildCastingDiscoveryFixture();
  const unsafe = {
    provider: 'elevenlabs', providerVoiceId: 'unsafe-community', name: 'Unsafe Community',
    category: 'community', language: 'en', noticePeriodDays: 0,
    verifiedLanguages: [{ language: 'en' }], previewUrl: 'https://example.test/unsafe.mp3'
  };
  const provider = {
    name: 'elevenlabs',
    async searchVoices() {
      return {
        voices: [unsafe, ...fixture.voices],
        hasMore: false,
        queryMode: 'anonymous-unfiltered',
        providerFiltersApplied: false,
        anonymousFallbackUsed: true
      };
    },
    estimateCost: fixture.estimateCost
  };
  const result = await new BookOneCastingDiscoveryService().discoverFromProvider({
    launch: fixture.launch,
    prep: fixture.prep,
    provider,
    auditionSamples: fixture.auditionSamples,
    perRole: 5,
    auditionTop: 3,
    maxPages: 2,
    pageSize: 100
  });
  assert.equal(result.discovery.status, 'READY_FOR_OPERATOR_REVIEW');
  assert.equal(result.discovery.catalog.anonymousFallbackUsed, true);
  assert.equal(result.discovery.catalog.providerFiltersApplied, false);
  assert.equal(result.discovery.catalog.queryMode, 'anonymous-unfiltered');
  assert.equal(result.discovery.catalog.rawVoicesSeen, 37);
  assert.equal(result.discovery.catalog.uniqueVoices, 36);
  const used = result.discovery.shortlists.flatMap((row) => row.candidates.map((candidate) => candidate.voice.providerVoiceId));
  assert.equal(used.includes('unsafe-community'), false);
  for (const row of result.discovery.shortlists) {
    for (const candidate of row.candidates) {
      assert.ok(candidate.voice.noticePeriodDays >= 180);
      assert.ok(['professional', 'high_quality'].includes(String(candidate.voice.category).toLowerCase()));
    }
  }
  assert.equal(result.discovery.guardrails.paidProviderCallsPerformed, 0);
  assert.equal(result.discovery.guardrails.generationCallsPerformed, 0);
  assert.equal(result.discovery.guardrails.auditionRenderingArmed, false);
});

