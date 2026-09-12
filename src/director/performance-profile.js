const EMOTION_RULES = [
  ['angry', /\b(angry|furious|snapped|shouted|yelled|glared|clenched|rage|pissed)\b/i],
  ['sad', /\b(sad|cried|crying|tears?|sobbed|hurt|heartbroken|ache|grief)\b/i],
  ['joyful', /\b(laughed|laughing|smiled|grinned|delighted|happy|joy|excited)\b/i],
  ['fearful', /\b(afraid|fear|terrified|panic|panicked|trembled|shook|nervous)\b/i],
  ['tender', /\b(kissed|kiss|caressed|touched|love|loved|tender|softened|held him|held her|held them)\b/i],
  ['tense', /\b(tension|stared|silence|jaw|hesitated|hesitation|waited|stillness)\b/i],
  ['amused', /\b(teased|joked|smirked|chuckled|playful|sarcastic|deadpan)\b/i]
];

const SAFE_V3_TAGS = Object.freeze({
  angry: 'angry',
  sad: 'sad',
  joyful: 'happily',
  fearful: 'worried',
  tender: 'softly',
  tense: 'cautiously',
  amused: 'playfully',
  intimate: 'whispers',
  whisper: 'whispers',
  urgent: 'rushed',
  reflective: 'slowly',
  pause: 'pause',
  sigh: 'sighs',
  laugh: 'laughs',
  deadpan: 'deadpan'
});

export function clamp01(value, fallback = 0.5) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(1, Math.max(0, number));
}

export function inferPrimaryEmotion(text = '') {
  for (const [emotion, pattern] of EMOTION_RULES) {
    if (pattern.test(text)) return emotion;
  }
  return 'neutral';
}

export function inferPerformanceDirection({ text = '', kind = 'narration', characterProfile = {}, context = {} } = {}) {
  const emotion = inferPrimaryEmotion(text);
  const quoted = kind === 'dialogue';
  const lower = text.toLowerCase();
  const whisper = /\b(whispered|whispers|quietly|under (?:his|her|their) breath)\b/i.test(text);
  const exclamations = (text.match(/!/g) ?? []).length;
  const ellipses = (text.match(/\.\.\./g) ?? []).length;
  const questions = (text.match(/\?/g) ?? []).length;

  let intensity = quoted ? 0.44 : 0.32;
  if (['angry', 'fearful'].includes(emotion)) intensity += 0.24;
  if (emotion === 'joyful') intensity += 0.12;
  if (emotion === 'tender') intensity -= 0.08;
  intensity += Math.min(0.18, exclamations * 0.06);
  intensity = clamp01(intensity, 0.4);

  let restraint = clamp01(characterProfile.restraint ?? context.defaultRestraint ?? 0.72, 0.72);
  if (emotion === 'angry') restraint = clamp01(restraint - 0.16);
  if (emotion === 'tender' || whisper) restraint = clamp01(restraint + 0.1);

  let pace = 'medium';
  if (ellipses > 0 || /\b(hesitated|slowly|carefully|drawn out)\b/i.test(text)) pace = 'slow';
  if (exclamations >= 2 || /\b(rushed|quickly|urgent|suddenly)\b/i.test(text)) pace = 'fast';
  if (whisper && pace === 'medium') pace = 'slow-medium';

  const tags = [];
  if (emotion !== 'neutral' && intensity >= 0.4) tags.push(emotion);
  if (whisper) tags.push('whisper');
  if (/\b(sighed|sighs?)\b/i.test(text)) tags.push('sigh');
  if (/\b(laughed|laughs?|chuckled)\b/i.test(text)) tags.push('laugh');
  if (/\b(deadpan|flatly)\b/i.test(text)) tags.push('deadpan');

  return Object.freeze({
    emotion,
    intensity: Number(intensity.toFixed(3)),
    restraint: Number(restraint.toFixed(3)),
    pace,
    volume: whisper ? 'soft' : intensity > 0.72 ? 'projected' : 'normal',
    pauseBeforeMs: context.sceneOpening ? 250 : 0,
    pauseAfterMs: ellipses > 0 ? 350 : questions > 0 ? 120 : 0,
    tags: Object.freeze([...new Set(tags)].slice(0, 2)),
    rationale: Object.freeze({ quoted, whisper, exclamations, ellipses, questions, lexicalEmotion: emotion }),
    source: 'heuristic-v1'
  });
}

export function normalizeDirection(direction = {}) {
  const allowedPace = new Set(['slow', 'slow-medium', 'medium', 'medium-fast', 'fast']);
  const allowedVolume = new Set(['soft', 'normal', 'projected']);
  return Object.freeze({
    emotion: String(direction.emotion ?? 'neutral').toLowerCase(),
    intensity: clamp01(direction.intensity, 0.4),
    restraint: clamp01(direction.restraint, 0.72),
    pace: allowedPace.has(direction.pace) ? direction.pace : 'medium',
    volume: allowedVolume.has(direction.volume) ? direction.volume : 'normal',
    pauseBeforeMs: Math.max(0, Math.min(3000, Number(direction.pauseBeforeMs) || 0)),
    pauseAfterMs: Math.max(0, Math.min(3000, Number(direction.pauseAfterMs) || 0)),
    tags: Object.freeze([...(direction.tags ?? [])].map(tag => String(tag).toLowerCase()).slice(0, 3)),
    rationale: Object.freeze({ ...(direction.rationale ?? {}) }),
    source: direction.source ?? 'director'
  });
}

export function compileElevenV3RenderText(canonicalText, direction = {}, { maxTags = 2 } = {}) {
  if (typeof canonicalText !== 'string' || !canonicalText.length) throw new Error('canonicalText is required');
  const normalized = normalizeDirection(direction);
  const safe = [];
  for (const tag of normalized.tags) {
    const mapped = SAFE_V3_TAGS[tag];
    if (mapped && !safe.includes(mapped)) safe.push(mapped);
    if (safe.length >= maxTags) break;
  }
  if (!safe.length && normalized.emotion !== 'neutral') {
    const mapped = SAFE_V3_TAGS[normalized.emotion];
    if (mapped) safe.push(mapped);
  }
  const prefix = safe.slice(0, maxTags).map(tag => `[${tag}]`).join(' ');
  return prefix ? `${prefix} ${canonicalText}` : canonicalText;
}

export function buildPerformanceBrief(direction = {}) {
  const d = normalizeDirection(direction);
  return Object.freeze({
    summary: `${d.emotion}; ${d.pace}; ${Math.round(d.intensity * 100)}% intensity; ${Math.round(d.restraint * 100)}% restraint`,
    emotion: d.emotion,
    pace: d.pace,
    intensity: d.intensity,
    restraint: d.restraint,
    volume: d.volume,
    pauseBeforeMs: d.pauseBeforeMs,
    pauseAfterMs: d.pauseAfterMs
  });
}
