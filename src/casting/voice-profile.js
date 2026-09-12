const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function normalizeVoiceProfile(raw = {}, { provider = 'unknown', source = 'library' } = {}) {
  const verifiedLanguages = Array.isArray(raw.verified_languages)
    ? raw.verified_languages.map((item) => ({
        language: item.language ?? null,
        locale: item.locale ?? null,
        accent: item.accent ?? null,
        modelId: item.model_id ?? null,
        previewUrl: item.preview_url ?? null
      }))
    : [];

  const noticeDays = Number(
    raw.notice_period_days ?? raw.noticePeriodDays ?? raw.notice_period ?? raw.noticePeriod ?? 0
  ) || 0;

  return Object.freeze({
    provider,
    source,
    providerVoiceId: raw.voice_id ?? raw.voiceId ?? null,
    publicOwnerId: raw.public_owner_id ?? raw.publicOwnerId ?? null,
    name: raw.name ?? 'Unnamed voice',
    description: raw.description ?? '',
    category: raw.category ?? null,
    accent: raw.accent ?? raw.labels?.accent ?? null,
    gender: raw.gender ?? raw.labels?.gender ?? null,
    age: raw.age ?? raw.labels?.age ?? null,
    language: raw.language ?? raw.labels?.language ?? null,
    locale: raw.locale ?? null,
    useCase: raw.use_case ?? raw.labels?.use_case ?? null,
    descriptives: Array.isArray(raw.descriptives) ? [...raw.descriptives] : [],
    verifiedLanguages,
    previewUrl: raw.preview_url ?? raw.previewUrl ?? null,
    noticePeriodDays: noticeDays,
    disableAtUnix: raw.disable_at_unix ?? raw.disableAtUnix ?? null,
    customRate: raw.rate ?? raw.custom_rate ?? raw.customRate ?? null,
    hasCustomRate: Boolean(raw.has_custom_rate ?? raw.hasCustomRate ?? (raw.rate && Number(raw.rate) !== 1)),
    liveModerationEnabled: Boolean(raw.live_moderation_enabled ?? raw.liveModerationEnabled),
    featured: Boolean(raw.featured),
    usageCharacterCount1y: Number(raw.usage_character_count_1y ?? raw.usageCharacterCount1y ?? 0) || 0,
    clonedByCount: Number(raw.cloned_by_count ?? raw.clonedByCount ?? 0) || 0,
    raw
  });
}

function noticePoints(days) {
  if (days >= 730) return 45;
  if (days >= 365) return 40;
  if (days >= 180) return 32;
  if (days >= 90) return 24;
  if (days >= 30) return 14;
  return 0;
}

export function scoreSeriesSafety(voice, { desiredLanguage = 'en', nowUnix = Math.floor(Date.now() / 1000) } = {}) {
  const profile = voice?.providerVoiceId ? voice : normalizeVoiceProfile(voice);
  const reasons = [];
  const warnings = [];
  let score = 10 + noticePoints(profile.noticePeriodDays);

  const category = String(profile.category ?? '').toLowerCase();
  if (['high_quality', 'professional'].includes(category)) {
    score += 15;
    reasons.push('professional/studio-quality category');
  } else {
    warnings.push('voice is not marked professional/studio quality');
  }

  const languageMatch = profile.language === desiredLanguage || profile.verifiedLanguages.some((v) => v.language === desiredLanguage);
  if (languageMatch) {
    score += 15;
    reasons.push(`verified for ${desiredLanguage}`);
  } else {
    warnings.push(`not explicitly verified for ${desiredLanguage}`);
  }

  if (!profile.hasCustomRate) {
    score += 5;
    reasons.push('no custom sharing rate detected');
  } else {
    warnings.push('custom provider rate may increase production cost');
  }

  if (!profile.liveModerationEnabled) {
    score += 5;
  } else {
    warnings.push('live moderation enabled');
  }

  if (profile.previewUrl) score += 5;

  if (profile.noticePeriodDays < 30) {
    warnings.push('no protected notice period; voice may disappear without warning');
  } else {
    reasons.push(`${profile.noticePeriodDays}-day notice protection`);
  }

  if (profile.disableAtUnix && Number(profile.disableAtUnix) > 0) {
    const daysRemaining = Math.floor((Number(profile.disableAtUnix) - nowUnix) / 86400);
    warnings.push(`voice removal is already scheduled${Number.isFinite(daysRemaining) ? ` in about ${daysRemaining} days` : ''}`);
    score = Math.min(score, 20);
  }

  score = clamp(Math.round(score), 0, 100);
  const grade = score >= 85 ? 'excellent' : score >= 70 ? 'good' : score >= 50 ? 'caution' : 'high-risk';
  return Object.freeze({ score, grade, reasons: Object.freeze(reasons), warnings: Object.freeze(warnings) });
}

export function rankVoiceCandidates(voices, options = {}) {
  return voices
    .map((voice) => ({ voice, safety: scoreSeriesSafety(voice, options) }))
    .sort((a, b) => b.safety.score - a.safety.score || a.voice.name.localeCompare(b.voice.name));
}
