const freeze = (value) => Object.freeze(value);

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

const PROFILES = {
  'acx-2026': {
    id: 'acx-2026',
    label: 'ACX / Audible — Technical Package 2026',
    revisionDate: '2026-04-15',
    route: 'manual-upload',
    acceptedMasteringProfiles: ['acx-2026'],
    audio: { formats: ['mp3'], minimumBitrateKbps: 192, sampleRateHz: 44100, cbrRequired: true, maxSectionDurationSec: null },
    cover: { required: true, formats: ['jpg', 'jpeg', 'png', 'tif', 'tiff'], squareRequired: true, minWidth: 2400, minHeight: 2400, maxBytes: 8 * 1024 * 1024, rgbRequired: true },
    metadata: { required: ['title', 'author', 'narrators'], recommended: ['language', 'description'], isbn: 'optional' },
    requiresOpeningCredits: true,
    requiresClosingCredits: true,
    sample: 'optional',
    digitalNarration: 'manual-eligibility-check',
    notes: 'Technical compliance does not imply ACX/Audible acceptance of a specific narration method.'
  },
  'spotify-direct-2026': {
    id: 'spotify-direct-2026',
    label: 'Spotify for Authors — Direct Upload 2026',
    revisionDate: '2026-09-12',
    route: 'manual-upload',
    acceptedMasteringProfiles: ['spotify-direct-2026', 'acx-2026'],
    audio: { formats: ['mp3', 'wav', 'flac'], minimumBitrateKbps: 192, sampleRateHz: 44100, cbrRequired: false, maxSectionDurationSec: 7200 },
    cover: { required: true, formats: ['jpg', 'jpeg', 'png'], squareRequired: true, recommendedWidth: 3000, recommendedHeight: 3000 },
    metadata: { required: ['title', 'author', 'narrators', 'language'], recommended: ['description', 'publisher', 'bisac', 'territories', 'priceUsd'], isbn: 'optional' },
    requiresOpeningCredits: true,
    requiresClosingCredits: true,
    sample: 'recommended',
    digitalNarration: 'disclosure-required',
    notes: 'Digital narration is accepted, but the upload must disclose that the audiobook uses digital voice narration.'
  },
  'apple-partner-2026': {
    id: 'apple-partner-2026',
    label: 'Apple Books — Preferred Partner Handoff 2026',
    revisionDate: '2026-09-12',
    route: 'preferred-partner',
    acceptedMasteringProfiles: ['archive-wav-2026', 'acx-2026', 'spotify-direct-2026'],
    audio: { formats: ['wav', 'mp3', 'flac'], minimumBitrateKbps: null, sampleRateHz: null, cbrRequired: false, maxSectionDurationSec: null },
    cover: { required: true, formats: ['jpg', 'jpeg', 'png'], squareRequired: true },
    metadata: { required: ['title', 'author', 'narrators', 'language'], recommended: ['description', 'publisher', 'isbn13'], isbn: 'partner-dependent' },
    requiresOpeningCredits: true,
    requiresClosingCredits: true,
    sample: 'recommended',
    digitalNarration: 'partner-dependent',
    notes: 'Apple Books audiobook delivery is handled through preferred distribution partners; partner-specific rules remain authoritative.'
  },
  'w3c-audiobook-2020': {
    id: 'w3c-audiobook-2020',
    label: 'W3C Audiobook Manifest',
    revisionDate: '2020-11-10',
    route: 'standards-package',
    freshnessExempt: true,
    acceptedMasteringProfiles: ['archive-wav-2026', 'acx-2026', 'spotify-direct-2026'],
    audio: { formats: ['wav', 'mp3', 'flac'], minimumBitrateKbps: null, sampleRateHz: null, cbrRequired: false, maxSectionDurationSec: null },
    cover: { required: false, formats: ['jpg', 'jpeg', 'png'], squareRequired: false },
    metadata: { required: ['title'], recommended: ['author', 'narrators', 'language', 'description', 'isbn13'], isbn: 'optional' },
    requiresOpeningCredits: false,
    requiresClosingCredits: false,
    sample: 'optional',
    digitalNarration: 'not-applicable',
    notes: 'Standards-oriented JSON-LD publication manifest using the W3C Audiobooks Recommendation.'
  }
};

export const DISTRIBUTION_PROFILES = deepFreeze(PROFILES);

export function getDistributionProfile(profile) {
  if (profile && typeof profile === 'object') return deepFreeze(structuredClone(profile));
  const found = DISTRIBUTION_PROFILES[String(profile ?? '')];
  if (!found) throw new Error(`unknown distribution profile: ${profile}`);
  return found;
}

export function normalizeAssetFormat(value) {
  return String(value ?? '').trim().toLowerCase().replace(/^\./, '').replace('image/', '').replace('audio/', '');
}

export function normalizeIsbn13(value) {
  return String(value ?? '').replace(/[^0-9]/g, '');
}

export function isValidIsbn13(value) {
  const digits = normalizeIsbn13(value);
  if (!/^(978|979)\d{10}$/.test(digits)) return false;
  const total = digits.slice(0, 12).split('').reduce((sum, d, i) => sum + Number(d) * (i % 2 ? 3 : 1), 0);
  const check = (10 - (total % 10)) % 10;
  return check === Number(digits[12]);
}

export function validateDistributionMetadata(metadata = {}, profileInput) {
  const profile = getDistributionProfile(profileInput);
  const errors = [];
  const warnings = [];
  for (const field of profile.metadata?.required ?? []) {
    const value = metadata[field];
    const missing = Array.isArray(value) ? value.filter(Boolean).length === 0 : value === null || value === undefined || String(value).trim() === '';
    if (missing) errors.push(freeze({ code: `metadata-${field}-missing`, field, message: `${field} is required for ${profile.label}` }));
  }
  if (metadata.isbn13 && !isValidIsbn13(metadata.isbn13)) {
    errors.push(freeze({ code: 'metadata-isbn-invalid', field: 'isbn13', message: 'Audiobook ISBN must be a valid ISBN-13 if supplied.' }));
  }
  if (metadata.isbn13 && metadata.sourceEditionIsbn13 && normalizeIsbn13(metadata.isbn13) === normalizeIsbn13(metadata.sourceEditionIsbn13)) {
    errors.push(freeze({ code: 'metadata-isbn-reused', field: 'isbn13', message: 'Audiobook ISBN must not reuse the ebook/print edition ISBN.' }));
  }
  for (const field of profile.metadata?.recommended ?? []) {
    const value = metadata[field];
    const missing = Array.isArray(value) ? value.filter(Boolean).length === 0 : value === null || value === undefined || String(value).trim() === '';
    if (missing) warnings.push(freeze({ code: `metadata-${field}-recommended`, field, message: `${field} is recommended for ${profile.label}` }));
  }
  return freeze({ valid: errors.length === 0, errors: freeze(errors), warnings: freeze(warnings) });
}

export function validateDistributionCover(cover, profileInput) {
  const profile = getDistributionProfile(profileInput);
  const errors = [];
  const warnings = [];
  if (!cover) {
    if (profile.cover?.required) errors.push(freeze({ code: 'cover-missing', message: `Cover art is required for ${profile.label}` }));
    return freeze({ valid: errors.length === 0, errors: freeze(errors), warnings: freeze(warnings) });
  }
  const meta = cover.metadata ?? cover;
  const format = normalizeAssetFormat(meta.format ?? meta.extension ?? meta.mediaType);
  if (profile.cover?.formats?.length && !format) errors.push(freeze({ code: 'cover-format-unverified', message: 'Cover file format could not be verified.' }));
  else if (format && profile.cover?.formats?.length && !profile.cover.formats.includes(format)) {
    errors.push(freeze({ code: 'cover-format', message: `Cover format ${format} is not accepted by ${profile.label}` }));
  }
  const width = Number(meta.width ?? meta.widthPx);
  const height = Number(meta.height ?? meta.heightPx);
  if (profile.cover?.squareRequired) {
    if (Number.isFinite(width) && Number.isFinite(height) && width !== height) errors.push(freeze({ code: 'cover-not-square', message: 'Cover must use a 1:1 square aspect ratio.' }));
    if (!Number.isFinite(width) || !Number.isFinite(height)) errors.push(freeze({ code: 'cover-dimensions-unverified', message: 'Cover pixel dimensions must be measured before distribution.' }));
  }
  if (Number.isFinite(profile.cover?.minWidth) && Number.isFinite(width) && width < profile.cover.minWidth) errors.push(freeze({ code: 'cover-width-small', message: `Cover width must be at least ${profile.cover.minWidth}px.` }));
  if (Number.isFinite(profile.cover?.minHeight) && Number.isFinite(height) && height < profile.cover.minHeight) errors.push(freeze({ code: 'cover-height-small', message: `Cover height must be at least ${profile.cover.minHeight}px.` }));
  if (Number.isFinite(profile.cover?.recommendedWidth) && Number.isFinite(width) && width < profile.cover.recommendedWidth) warnings.push(freeze({ code: 'cover-width-below-recommended', message: `${profile.label} recommends ${profile.cover.recommendedWidth}px square cover art.` }));
  const bytes = Number(meta.bytes ?? meta.sizeBytes);
  if (Number.isFinite(profile.cover?.maxBytes) && Number.isFinite(bytes) && bytes > profile.cover.maxBytes) errors.push(freeze({ code: 'cover-file-large', message: `Cover must be no larger than ${Math.round(profile.cover.maxBytes / 1024 / 1024)} MB.` }));
  if (profile.cover?.rgbRequired && !meta.colorSpace) errors.push(freeze({ code: 'cover-color-space-unverified', message: 'Cover color space must be verified before distribution.' }));
  else if (profile.cover?.rgbRequired && String(meta.colorSpace).toLowerCase() !== 'rgb') errors.push(freeze({ code: 'cover-color-space', message: 'Cover must use RGB color.' }));
  return freeze({ valid: errors.length === 0, errors: freeze(errors), warnings: freeze(warnings) });
}

export function profileFreshness(profileInput, { now = new Date(), maxAgeDays = 365 } = {}) {
  const profile = getDistributionProfile(profileInput);
  const reviewed = new Date(`${profile.revisionDate}T00:00:00Z`);
  const ageDays = Math.floor((now.getTime() - reviewed.getTime()) / 86400000);
  const stale = profile.freshnessExempt ? false : (Number.isFinite(ageDays) && ageDays > maxAgeDays);
  return freeze({ profileId: profile.id, revisionDate: profile.revisionDate, ageDays, stale, freshnessExempt: Boolean(profile.freshnessExempt) });
}
