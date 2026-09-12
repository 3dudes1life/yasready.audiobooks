const NAMED_ENTITIES = Object.freeze({
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' '
});

export function decodeEntities(value = '') {
  return String(value).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, token) => {
    if (token[0] === '#') {
      const hex = token[1]?.toLowerCase() === 'x';
      const parsed = Number.parseInt(token.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(parsed) ? String.fromCodePoint(parsed) : match;
    }
    return NAMED_ENTITIES[token.toLowerCase()] ?? match;
  });
}

export function normalizeNewlines(value = '') {
  return String(value).replace(/\r\n?/g, '\n');
}

export function htmlToText(html = '') {
  return normalizeNewlines(String(html))
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|aside|blockquote|li|h[1-6]|title)>/gi, '\n\n')
    .replace(/<(p|div|section|article|aside|blockquote|li|h[1-6]|title)\b[^>]*>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/[\t\f\v ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function textFromXmlNodes(xml = '', localName) {
  const escaped = localName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`<[^>]*:?${escaped}\\b[^>]*>([\\s\\S]*?)<\\/[^>]*:?${escaped}>`, 'gi');
  const values = [];
  for (const match of String(xml).matchAll(re)) values.push(decodeEntities(match[1].replace(/<[^>]+>/g, '')).trim());
  return values.filter(Boolean);
}

export function firstXmlNodeText(xml = '', localName) {
  return textFromXmlNodes(xml, localName)[0] ?? null;
}

export function firstHeading(html = '') {
  const match = String(html).match(/<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/i);
  return match ? htmlToText(match[1]) : null;
}
