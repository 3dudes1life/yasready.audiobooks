const MODEL_LIMITS = Object.freeze({
  eleven_v3: 5000,
  eleven_multilingual_v2: 10000,
  eleven_multilingual_v1: 10000,
  eleven_flash_v2_5: 40000,
  eleven_turbo_v2_5: 40000,
  eleven_flash_v2: 30000,
  eleven_turbo_v2: 30000
});

export function modelCharacterLimit(model) {
  return MODEL_LIMITS[model] ?? 5000;
}

export function productionCharacterCap(model, { safetyRatio = 0.8, explicitCap = null } = {}) {
  const hard = modelCharacterLimit(model);
  const ratio = Math.min(1, Math.max(0.25, Number(safetyRatio) || 0.8));
  const safe = Math.max(500, Math.floor(hard * ratio));
  if (explicitCap === null || explicitCap === undefined) return safe;
  const requested = Math.floor(Number(explicitCap));
  if (!Number.isFinite(requested) || requested < 1) throw new Error('explicitCap must be a positive number');
  return Math.min(hard, requested);
}

export function splitForTts(text, { maxChars } = {}) {
  const source = String(text ?? '');
  if (!source) return [];
  if (!Number.isInteger(maxChars) || maxChars < 1) throw new Error('splitForTts requires positive integer maxChars');
  if (source.length <= maxChars) return [source];

  const chunks = [];
  let offset = 0;
  while (offset < source.length) {
    const hardEnd = Math.min(source.length, offset + maxChars);
    if (hardEnd === source.length) {
      chunks.push(source.slice(offset));
      break;
    }
    const window = source.slice(offset, hardEnd);
    const minimumUsefulBreak = Math.floor(maxChars * 0.5);
    let cut = -1;

    // Prefer paragraph/sentence boundaries, then ordinary whitespace, otherwise hard split.
    for (const pattern of [/\n\n/g, /[.!?…]["'’”)]*\s+/gu, /\n/g, /\s+/g]) {
      let match;
      let last = -1;
      while ((match = pattern.exec(window)) !== null) {
        const candidate = match.index + match[0].length;
        if (candidate >= minimumUsefulBreak) last = candidate;
      }
      if (last > 0) { cut = last; break; }
    }
    if (cut <= 0) cut = window.length;
    chunks.push(source.slice(offset, offset + cut));
    offset += cut;
  }

  if (chunks.join('') !== source) throw new Error('TTS chunking integrity failure');
  if (chunks.some((chunk) => chunk.length > maxChars)) throw new Error('TTS chunk exceeds model cap');
  return chunks;
}

export function neighboringText(chunks, index, { maxContextChars = 1200 } = {}) {
  const previousText = index > 0 ? chunks[index - 1].slice(-maxContextChars) : null;
  const nextText = index + 1 < chunks.length ? chunks[index + 1].slice(0, maxContextChars) : null;
  return Object.freeze({ previousText, nextText });
}

export { MODEL_LIMITS as ELEVENLABS_MODEL_CHARACTER_LIMITS };
