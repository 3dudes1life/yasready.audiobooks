function stripMarks(value) {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
}

export function normalizeIdentity(value = '') {
  return stripMarks(String(value))
    .replace(/[‘’`]/g, "'")
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}']+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeTerm(value = '', { caseSensitive = false } = {}) {
  const normalized = String(value).normalize('NFKC').replace(/\s+/g, ' ').trim();
  return caseSensitive ? normalized : normalized.toLocaleLowerCase('en-US');
}

export function uniqueText(values = []) {
  const seen = new Set();
  const output = [];
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (!text) continue;
    const key = normalizeIdentity(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(text);
  }
  return output;
}
