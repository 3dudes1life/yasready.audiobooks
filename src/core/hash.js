import { createHash } from 'node:crypto';

function sortDeep(value) {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, sortDeep(value[key])])
    );
  }
  return value;
}

export function stableJson(value) {
  return JSON.stringify(sortDeep(value));
}

export function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

export function renderFingerprint({
  text,
  provider,
  model,
  voiceId,
  settings = {},
  pronunciationVersion = null,
  directorInstructions = null
}) {
  if (!text?.trim()) throw new Error('render fingerprint requires text');
  if (!provider) throw new Error('render fingerprint requires provider');
  if (!model) throw new Error('render fingerprint requires model');
  if (!voiceId) throw new Error('render fingerprint requires voiceId');

  return sha256(stableJson({
    text,
    provider,
    model,
    voiceId,
    settings,
    pronunciationVersion,
    directorInstructions
  }));
}
