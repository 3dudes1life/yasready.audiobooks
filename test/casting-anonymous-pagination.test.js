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

function voice(index, overrides = {}) {
  return {
    voice_id: `anon-${index}`,
    name: `Anonymous Voice ${index}`,
    category: 'professional',
    language: 'en',
    notice_period_days: 365,
    live_moderation_enabled: false,
    rate: 1,
    preview_url: `https://example.test/anon-${index}.mp3`,
    verified_languages: [{ language: 'en', locale: 'en-US' }],
    ...overrides
  };
}

test('0.14.3.8 is current application provenance', () => {
  assert.equal(YASREADY_AUDIOBOOKS_VERSION, '0.14.3.8');
});

test('logged-out filter 401 plus public >3 401 automatically falls back to page_size=3', async () => {
  const calls = [];
  const provider = new ElevenLabsProvider({
    apiKey: null,
    fetchImpl: async (url, options = {}) => {
      const u = String(url);
      calls.push({ url: u, options });
      if (calls.length === 1) {
        return response(401, { detail: { code: 'unauthorized', status: 'not_logged_in', message: 'You must be logged in to use filters.' } });
      }
      if (calls.length === 2) {
        return response(401, { detail: { code: 'unauthorized', status: 'not_logged_in', message: 'You must be logged in to fetch more than 3 voices.' } });
      }
      return response(200, { voices: [voice(1), voice(2), voice(3)], has_more: true });
    }
  });

  const result = await provider.searchVoices({
    language: 'en',
    category: 'professional',
    minNoticePeriodDays: 180,
    page: 0,
    pageSize: 100
  });

  assert.equal(calls.length, 3);
  assert.match(calls[0].url, /language=en/);
  assert.match(calls[1].url, /page_size=100/);
  assert.match(calls[2].url, /page_size=3/);
  assert.equal(result.queryMode, 'anonymous-public-capped');
  assert.equal(result.anonymousFallbackUsed, true);
  assert.equal(result.providerFiltersApplied, false);
  assert.equal(result.anonymousPageSizeCap, 3);
  assert.equal(result.httpCallsPerformed, 3);
  assert.equal(result.voices.length, 3);
});

test('known anonymous public mode skips rejected filtered requests on later pages', async () => {
  const calls = [];
  const provider = new ElevenLabsProvider({
    apiKey: null,
    fetchImpl: async (url) => {
      calls.push(String(url));
      return response(200, { voices: [voice(4), voice(5), voice(6)], has_more: true });
    }
  });
  const result = await provider.searchVoices({
    page: 2,
    pageSize: 100,
    anonymousPublicOnly: true,
    anonymousPageSizeCap: 3
  });
  assert.equal(calls.length, 1);
  assert.doesNotMatch(calls[0], /language=/);
  assert.match(calls[0], /page=2/);
  assert.match(calls[0], /page_size=3/);
  assert.equal(result.queryMode, 'anonymous-public-capped');
  assert.equal(result.httpCallsPerformed, 1);
});

test('anonymous 3-voice pagination can fill the complete Wave 1 shortlist safely', async () => {
  const fixture = buildCastingDiscoveryFixture();
  let pageCalls = 0;
  const provider = {
    name: 'elevenlabs',
    async searchVoices({ page }) {
      pageCalls += 1;
      const start = page * 3 + 1;
      return {
        voices: [start, start + 1, start + 2].map((i) => ({
          provider: 'elevenlabs',
          providerVoiceId: `public-${i}`,
          name: `Public ${i}`,
          description: i % 4 === 0
            ? 'Latino American warm natural conversational audiobook storytelling voice'
            : 'warm natural conversational audiobook storytelling voice Bay Area California',
          category: 'professional',
          accent: 'american',
          gender: 'male',
          age: 'middle_aged',
          language: 'en',
          useCase: 'conversational',
          descriptives: ['warm', 'natural', 'expressive'],
          noticePeriodDays: 365,
          hasCustomRate: false,
          liveModerationEnabled: false,
          verifiedLanguages: [{ language: 'en', locale: 'en-US', accent: 'american' }],
          previewUrl: `https://example.test/public-${i}.mp3`
        })),
        hasMore: page < 20,
        queryMode: 'anonymous-public-capped',
        providerFiltersApplied: false,
        anonymousFallbackUsed: true,
        anonymousPageSizeCap: 3,
        httpCallsPerformed: 1
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
    anonymousPageLimit: 20,
    pageSize: 100
  });

  assert.equal(result.discovery.status, 'READY_FOR_OPERATOR_REVIEW');
  assert.equal(result.discovery.shortlists.every((row) => row.candidates.length === 5), true);
  assert.equal(result.discovery.catalog.queryMode, 'anonymous-public-capped');
  assert.equal(result.discovery.catalog.anonymousFallbackUsed, true);
  assert.equal(result.discovery.catalog.anonymousPageSizeCap, 3);
  assert.ok(pageCalls >= 7);
  assert.equal(result.discovery.catalog.catalogCallsPerformed, pageCalls);
  assert.equal(result.discovery.guardrails.paidProviderCallsPerformed, 0);
  assert.equal(result.discovery.guardrails.generationCallsPerformed, 0);
  assert.equal(result.discovery.guardrails.auditionRenderingArmed, false);
});

test('anonymous shortfall recommends API-key discovery instead of reusing voices', async () => {
  const fixture = buildCastingDiscoveryFixture();
  const provider = {
    name: 'elevenlabs',
    async searchVoices({ page }) {
      return {
        voices: page === 0 ? [1, 2, 3].map((i) => ({
          provider: 'elevenlabs',
          providerVoiceId: `tiny-${i}`,
          name: `Tiny ${i}`,
          description: 'warm professional english audiobook voice',
          category: 'professional',
          language: 'en',
          noticePeriodDays: 365,
          verifiedLanguages: [{ language: 'en' }],
          previewUrl: `https://example.test/tiny-${i}.mp3`
        })) : [],
        hasMore: false,
        queryMode: 'anonymous-public-capped',
        providerFiltersApplied: false,
        anonymousFallbackUsed: true,
        anonymousPageSizeCap: 3,
        httpCallsPerformed: 1
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
    anonymousPageLimit: 5
  });

  assert.equal(result.discovery.status, 'NEEDS_MORE_CANDIDATES');
  assert.match(result.discovery.nextAction, /ELEVENLABS_API_KEY/);
  const ids = result.discovery.shortlists.flatMap((row) => row.candidates.map((candidate) => candidate.voice.providerVoiceId));
  assert.equal(new Set(ids).size, ids.length);
});
