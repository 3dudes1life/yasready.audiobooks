const freeze = (value) => Object.freeze(value);

function isoDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `PT${h ? `${h}H` : ''}${m ? `${m}M` : ''}${s || (!h && !m) ? `${s}S` : ''}`;
}

function person(name) {
  return { type: 'Person', name: String(name).trim() };
}

export function buildW3cAudiobookManifest({ metadata = {}, readingOrder = [], cover = null, id = null, url = null, dateModified = null }) {
  if (!String(metadata.title ?? '').trim()) throw new Error('W3C audiobook manifest requires title');
  if (!Array.isArray(readingOrder) || !readingOrder.length) throw new Error('W3C audiobook manifest requires readingOrder');
  const durationSec = readingOrder.reduce((sum, item) => sum + (Number(item.durationSec) || 0), 0);
  const manifest = {
    '@context': ['https://schema.org', 'https://www.w3.org/ns/pub-context'],
    conformsTo: 'https://www.w3.org/TR/audiobooks/',
    type: 'Audiobook',
    name: String(metadata.title).trim(),
    ...(id ? { id } : {}),
    ...(url ? { url } : {}),
    ...(metadata.language ? { inLanguage: metadata.language } : {}),
    ...(metadata.author ? { author: Array.isArray(metadata.author) ? metadata.author.map(person) : [person(metadata.author)] } : {}),
    ...(metadata.narrators?.length ? { readBy: metadata.narrators.filter(Boolean).map(person) } : {}),
    ...(durationSec > 0 ? { duration: isoDuration(durationSec) } : {}),
    ...(cover ? { cover: { url: cover.href ?? cover.url ?? cover.fileName ?? 'cover.jpg', encodingFormat: cover.mediaType ?? undefined } } : {}),
    ...(dateModified ? { dateModified } : {}),
    readingOrder: readingOrder.map((item) => ({
      url: item.href ?? item.fileName,
      name: item.title ?? item.fileName,
      ...(item.mediaType ? { encodingFormat: item.mediaType } : {}),
      ...(Number(item.durationSec) > 0 ? { duration: isoDuration(item.durationSec) } : {})
    }))
  };
  if (metadata.description) manifest.description = metadata.description;
  return freeze(manifest);
}

export function validateW3cAudiobookManifest(manifest) {
  const errors = [];
  if (!Array.isArray(manifest?.['@context']) || !manifest['@context'].includes('https://www.w3.org/ns/pub-context')) errors.push('missing-publication-context');
  if (manifest?.conformsTo !== 'https://www.w3.org/TR/audiobooks/') errors.push('invalid-conformance');
  if (!String(manifest?.name ?? '').trim()) errors.push('missing-name');
  if (!Array.isArray(manifest?.readingOrder) || !manifest.readingOrder.length) errors.push('missing-reading-order');
  return freeze({ valid: errors.length === 0, errors: freeze(errors) });
}

export function buildHumanChecklist({ profile, metadata, warnings = [], manualEligibilityRequired = false }) {
  const lines = [
    `YasReady Audiobooks — ${profile.label}`,
    '',
    `Title: ${metadata.title ?? ''}`,
    `Author: ${Array.isArray(metadata.author) ? metadata.author.join(', ') : metadata.author ?? ''}`,
    `Narrator(s): ${(metadata.narrators ?? []).join(', ')}`,
    '',
    'Before submission:',
    '- Confirm every audio file plays from beginning to end.',
    '- Confirm chapter names and order match the manuscript.',
    '- Confirm cover art and metadata match the audiobook edition.',
    '- Confirm distribution rights and territories.'
  ];
  if (profile.digitalNarration === 'disclosure-required') lines.push('- Mark the title as using digital voice narration during platform upload.');
  if (manualEligibilityRequired) lines.push('- Confirm current platform eligibility for this narration method before submission.');
  if (warnings.length) {
    lines.push('', 'Warnings:');
    for (const warning of warnings) lines.push(`- ${warning.message ?? warning.code ?? String(warning)}`);
  }
  return `${lines.join('\n')}\n`;
}
