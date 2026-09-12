import { AudioProvider } from './audio-provider.js';
import { normalizeVoiceProfile } from '../casting/voice-profile.js';

const DEFAULT_PRICING = Object.freeze({
  eleven_v3: 0.10,
  eleven_multilingual_v2: 0.10,
  eleven_flash_v2_5: 0.05,
  eleven_turbo_v2_5: 0.05
});

function requireFetch(fetchImpl) {
  if (typeof fetchImpl !== 'function') throw new Error('ElevenLabsProvider requires fetch support');
  return fetchImpl;
}

function cleanQuery(params) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      for (const item of value) query.append(key, String(item));
    } else query.set(key, String(value));
  }
  return query.toString();
}

function extractProviderCode(payload) {
  if (!payload || typeof payload !== 'object') return null;
  return payload.code ?? payload.status ?? payload.detail?.code ?? payload.detail?.status ?? null;
}

export class ElevenLabsApiError extends Error {
  constructor(message, { status = null, providerCode = null, detail = null, retryable = null, requestId = null } = {}) {
    super(message);
    this.name = 'ElevenLabsApiError';
    this.status = status;
    this.providerCode = providerCode;
    this.code = providerCode;
    this.detail = detail;
    this.retryable = retryable ?? (status === 429 || (Number.isInteger(status) && status >= 500));
    this.requestId = requestId;
  }
}

async function errorPayload(response) {
  try { return await response.clone().json(); } catch {}
  try { return await response.text(); } catch {}
  return null;
}

async function jsonOrThrow(response, label) {
  if (response.ok) return response.json();
  const detail = await errorPayload(response);
  const providerCode = extractProviderCode(detail);
  const requestId = response.headers?.get?.('request-id') ?? null;
  throw new ElevenLabsApiError(`${label} failed (${response.status})${detail ? `: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`, {
    status: response.status, providerCode, detail, requestId
  });
}

export class ElevenLabsProvider extends AudioProvider {
  constructor({ apiKey = process.env.ELEVENLABS_API_KEY ?? null, fetchImpl = globalThis.fetch, baseUrl = 'https://api.elevenlabs.io', pricingUsdPer1k = DEFAULT_PRICING } = {}) {
    super('elevenlabs');
    this.apiKey = apiKey;
    this.fetch = requireFetch(fetchImpl);
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.pricingUsdPer1k = Object.freeze({ ...DEFAULT_PRICING, ...pricingUsdPer1k });
  }

  headers({ json = false, requireKey = false } = {}) {
    if (requireKey && !this.apiKey) throw new Error('ELEVENLABS_API_KEY is required for this operation');
    return {
      ...(this.apiKey ? { 'xi-api-key': this.apiKey } : {}),
      ...(json ? { 'content-type': 'application/json' } : {})
    };
  }

  async healthCheck() {
    if (!this.apiKey) return { ok: false, provider: this.name, reason: 'missing-api-key' };
    const response = await this.fetch(`${this.baseUrl}/v2/voices?page_size=1&include_total_count=false`, { headers: this.headers({ requireKey: true }) });
    return { ok: response.ok, provider: this.name, status: response.status };
  }

  async searchVoices({ search = null, language = 'en', locale = null, accent = null, gender = null, age = null, category = 'professional', useCases = null, descriptives = null, minNoticePeriodDays = 180, includeCustomRates = false, includeLiveModerated = false, featured = false, sort = 'trending', page = 0, pageSize = 30 } = {}) {
    const query = cleanQuery({
      search, language, locale, accent, gender, age, category,
      use_cases: useCases, descriptives,
      min_notice_period_days: minNoticePeriodDays,
      include_custom_rates: includeCustomRates,
      include_live_moderated: includeLiveModerated,
      featured, sort, page, page_size: Math.min(100, Math.max(1, Number(pageSize) || 30))
    });
    const response = await this.fetch(`${this.baseUrl}/v1/shared-voices?${query}`, { headers: this.headers() });
    const data = await jsonOrThrow(response, 'ElevenLabs voice search');
    return {
      voices: (data.voices ?? []).map((voice) => normalizeVoiceProfile(voice, { provider: this.name, source: 'voice-library' })),
      hasMore: Boolean(data.has_more),
      totalCount: data.total_count ?? null,
      lastSortId: data.last_sort_id ?? null
    };
  }

  async listSavedVoices({ search = null, minNoticePeriodDays = null, highQuality = null, pageSize = 30, nextPageToken = null } = {}) {
    const query = cleanQuery({
      search,
      voice_type: 'saved',
      min_notice_period_days: minNoticePeriodDays,
      high_quality: highQuality,
      page_size: Math.min(100, Math.max(1, Number(pageSize) || 30)),
      next_page_token: nextPageToken,
      include_total_count: false
    });
    const response = await this.fetch(`${this.baseUrl}/v2/voices?${query}`, { headers: this.headers({ requireKey: true }) });
    const data = await jsonOrThrow(response, 'ElevenLabs saved voice search');
    return {
      voices: (data.voices ?? []).map((voice) => normalizeVoiceProfile(voice, { provider: this.name, source: 'saved' })),
      hasMore: Boolean(data.has_more),
      nextPageToken: data.next_page_token ?? null
    };
  }

  async importSharedVoice({ publicOwnerId, voiceId, name, bookmarked = true }) {
    if (!publicOwnerId || !voiceId || !name) throw new Error('importSharedVoice requires publicOwnerId, voiceId and name');
    const response = await this.fetch(`${this.baseUrl}/v1/voices/add/${encodeURIComponent(publicOwnerId)}/${encodeURIComponent(voiceId)}`, {
      method: 'POST',
      headers: this.headers({ json: true, requireKey: true }),
      body: JSON.stringify({ new_name: name, bookmarked })
    });
    return jsonOrThrow(response, 'ElevenLabs shared voice import');
  }

  async estimateCost({ text, model = 'eleven_multilingual_v2' }) {
    const chars = [...String(text ?? '')].length;
    const rate = this.pricingUsdPer1k[model];
    if (!Number.isFinite(rate)) return { amountUsd: null, characters: chars, model, rateUsdPer1k: null, estimated: true };
    return {
      amountUsd: Number(((chars / 1000) * rate).toFixed(6)),
      characters: chars,
      model,
      rateUsdPer1k: rate,
      estimated: true
    };
  }

  async render({
    voiceId, text, model = 'eleven_multilingual_v2', outputFormat = 'mp3_44100_128',
    voiceSettings = null, pronunciationDictionaryLocators = null, languageCode = null,
    previousText = null, nextText = null, previousRequestIds = null, nextRequestIds = null,
    seed = null, applyTextNormalization = 'auto'
  }) {
    if (!voiceId || !String(text ?? '').trim()) throw new Error('render requires voiceId and text');
    const query = cleanQuery({ output_format: outputFormat });
    const response = await this.fetch(`${this.baseUrl}/v1/text-to-speech/${encodeURIComponent(voiceId)}?${query}`, {
      method: 'POST',
      headers: this.headers({ json: true, requireKey: true }),
      body: JSON.stringify({
        text,
        model_id: model,
        ...(voiceSettings ? { voice_settings: voiceSettings } : {}),
        ...(pronunciationDictionaryLocators ? { pronunciation_dictionary_locators: pronunciationDictionaryLocators } : {}),
        ...(languageCode ? { language_code: languageCode } : {}),
        ...(previousText ? { previous_text: previousText } : {}),
        ...(nextText ? { next_text: nextText } : {}),
        ...(previousRequestIds?.length ? { previous_request_ids: previousRequestIds.slice(-3) } : {}),
        ...(nextRequestIds?.length ? { next_request_ids: nextRequestIds.slice(0, 3) } : {}),
        ...(seed !== null && seed !== undefined ? { seed } : {}),
        ...(applyTextNormalization ? { apply_text_normalization: applyTextNormalization } : {})
      })
    });
    if (!response.ok) {
      const detail = await errorPayload(response);
      const providerCode = extractProviderCode(detail);
      const requestId = response.headers?.get?.('request-id') ?? null;
      throw new ElevenLabsApiError(`ElevenLabs render failed (${response.status})${detail ? `: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`, {
        status: response.status, providerCode, detail, requestId
      });
    }
    const billedCharactersRaw = response.headers?.get?.('character-cost');
    const billedCharacters = billedCharactersRaw !== null && billedCharactersRaw !== undefined && billedCharactersRaw !== ''
      ? Number(billedCharactersRaw) : [...String(text)].length;
    const rate = this.pricingUsdPer1k[model];
    const estimatedCostUsd = Number.isFinite(rate) && Number.isFinite(billedCharacters)
      ? Number(((billedCharacters / 1000) * rate).toFixed(6)) : null;
    return {
      audio: new Uint8Array(await response.arrayBuffer()),
      mediaType: response.headers?.get?.('content-type') ?? 'audio/mpeg',
      provider: this.name,
      voiceId,
      model,
      outputFormat,
      requestId: response.headers?.get?.('request-id') ?? null,
      traceId: response.headers?.get?.('x-trace-id') ?? null,
      billedCharacters: Number.isFinite(billedCharacters) ? billedCharacters : null,
      estimatedCostUsd
    };
  }

  async align() { throw new Error('ElevenLabs alignment is scheduled for YasReady Audiobooks 0.8.0'); }
  async transcribe() { throw new Error('ElevenLabs transcription QA is scheduled for YasReady Audiobooks 0.8.0'); }
}

export { DEFAULT_PRICING as ELEVENLABS_PRICING_SNAPSHOT };
