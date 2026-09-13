const freeze = (value) => Object.freeze(value);

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

const PROFILES = {
  'acx-2026': {
    id: 'acx-2026',
    label: 'ACX / Audible — 2026',
    revisionDate: '2026-04-15',
    sectionPerFile: true,
    openingCreditsRequired: true,
    closingCreditsRequired: true,
    channelMode: 'consistent',
    maxSectionDurationSec: 7200,
    output: { format: 'mp3', codec: 'libmp3lame', sampleRateHz: 44100, bitrateKbps: 192, cbr: true },
    loudness: {
      rmsMinDb: -23,
      rmsMaxDb: -18,
      targetRmsDb: -20.5,
      maxPeakDb: -3,
      maxTruePeakDb: -3,
      maxNoiseFloorDb: -60,
      targetIntegratedLufs: -20.5,
      targetLraLu: 7,
      targetTruePeakDbtp: -3.5
    },
    edgeSilence: { minMs: 1000, maxMs: 5000 },
    fileName: { asciiOnly: true },
    notes: 'Verify final RMS, peak, noise floor, spacing and constant bitrate after encode.'
  },
  'spotify-direct-2026': {
    id: 'spotify-direct-2026',
    label: 'Spotify for Authors — MP3 2026',
    revisionDate: '2026-09-12',
    sectionPerFile: true,
    openingCreditsRequired: true,
    closingCreditsRequired: true,
    channelMode: 'consistent',
    maxSectionDurationSec: 7200,
    output: { format: 'mp3', codec: 'libmp3lame', sampleRateHz: 44100, bitrateKbps: 192, cbr: true },
    loudness: {
      targetIntegratedLufs: -20.5,
      targetLraLu: 7,
      targetTruePeakDbtp: -3.5
    },
    edgeSilence: { minMs: 500, maxMs: 5000 },
    notes: 'Spotify accepts MP3 192 kbps+, WAV 44.1 kHz/16-bit, or FLAC; this profile emits conservative 192 kbps MP3.'
  },
  'archive-wav-2026': {
    id: 'archive-wav-2026',
    label: 'YasReady Archival WAV',
    revisionDate: '2026-09-12',
    sectionPerFile: true,
    openingCreditsRequired: false,
    closingCreditsRequired: false,
    channelMode: 'consistent',
    output: { format: 'wav', codec: 'pcm_s24le', sampleRateHz: 44100, bitDepth: 24 },
    loudness: {
      targetIntegratedLufs: -20.5,
      targetLraLu: 7,
      targetTruePeakDbtp: -3.5
    },
    edgeSilence: { minMs: 500, maxMs: 5000 },
    notes: 'Lossless preservation master used to derive future distribution encodes.'
  }
};

export const MASTERING_PROFILES = deepFreeze(PROFILES);

export function getMasteringProfile(profile) {
  if (profile && typeof profile === 'object') return deepFreeze(structuredClone(profile));
  const found = MASTERING_PROFILES[String(profile ?? '')];
  if (!found) throw new Error(`unknown mastering profile: ${profile}`);
  return found;
}

export function safeSectionFileName(order, title, extension) {
  const prefix = String(Math.max(0, Number(order) || 0)).padStart(3, '0');
  const clean = String(title ?? 'section')
    .normalize('NFKD').replace(/[^\x00-\x7F]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'section';
  const ext = String(extension ?? 'mp3').replace(/^\./, '').replace(/[^A-Za-z0-9]/g, '') || 'mp3';
  return `${prefix}-${clean}.${ext}`;
}

function pushIssue(issues, condition, issue) {
  if (condition) issues.push(freeze(issue));
}

export function evaluateMasterAgainstProfile(analysis, profileInput) {
  const profile = getMasteringProfile(profileInput);
  const a = analysis ?? {};
  const issues = [];
  const loudness = profile.loudness ?? {};

  if (Number.isFinite(loudness.rmsMinDb) && Number.isFinite(a.rmsDb)) {
    pushIssue(issues, a.rmsDb < loudness.rmsMinDb, { code: 'rms-too-low', severity: 'error', value: a.rmsDb, minimum: loudness.rmsMinDb });
  }
  if (Number.isFinite(loudness.rmsMaxDb) && Number.isFinite(a.rmsDb)) {
    pushIssue(issues, a.rmsDb > loudness.rmsMaxDb, { code: 'rms-too-high', severity: 'error', value: a.rmsDb, maximum: loudness.rmsMaxDb });
  }
  const peak = Number.isFinite(a.truePeakDbtp) ? a.truePeakDbtp : a.peakDb;
  const peakLimit = Number.isFinite(loudness.maxTruePeakDb) ? loudness.maxTruePeakDb : loudness.maxPeakDb;
  if (Number.isFinite(peakLimit) && Number.isFinite(peak)) {
    pushIssue(issues, peak > peakLimit, { code: 'peak-too-high', severity: 'error', value: peak, maximum: peakLimit });
  }
  if (Number.isFinite(loudness.maxNoiseFloorDb)) {
    if (a.noiseFloorDb === null || a.noiseFloorDb === undefined || Number.isNaN(a.noiseFloorDb)) {
      issues.push(freeze({ code: 'noise-floor-unmeasured', severity: 'error' }));
    } else {
      pushIssue(issues, a.noiseFloorDb > loudness.maxNoiseFloorDb, { code: 'noise-floor-too-high', severity: 'error', value: a.noiseFloorDb, maximum: loudness.maxNoiseFloorDb });
    }
  }

  if (profile.edgeSilence) {
    if (Number.isFinite(a.leadingSilenceMs)) {
      pushIssue(issues, a.leadingSilenceMs < profile.edgeSilence.minMs, { code: 'leading-silence-short', severity: 'error', value: a.leadingSilenceMs, minimum: profile.edgeSilence.minMs });
      pushIssue(issues, a.leadingSilenceMs > profile.edgeSilence.maxMs, { code: 'leading-silence-long', severity: 'error', value: a.leadingSilenceMs, maximum: profile.edgeSilence.maxMs });
    }
    if (Number.isFinite(a.trailingSilenceMs)) {
      pushIssue(issues, a.trailingSilenceMs < profile.edgeSilence.minMs, { code: 'trailing-silence-short', severity: 'error', value: a.trailingSilenceMs, minimum: profile.edgeSilence.minMs });
      pushIssue(issues, a.trailingSilenceMs > profile.edgeSilence.maxMs, { code: 'trailing-silence-long', severity: 'error', value: a.trailingSilenceMs, maximum: profile.edgeSilence.maxMs });
    }
  }

  if (profile.output?.sampleRateHz && Number.isFinite(a.sampleRateHz)) {
    pushIssue(issues, a.sampleRateHz !== profile.output.sampleRateHz, { code: 'sample-rate-mismatch', severity: 'error', value: a.sampleRateHz, expected: profile.output.sampleRateHz });
  }
  if (profile.output?.bitrateKbps && Number.isFinite(a.bitrateKbps)) {
    pushIssue(issues, a.bitrateKbps < profile.output.bitrateKbps, { code: 'bitrate-too-low', severity: 'error', value: a.bitrateKbps, minimum: profile.output.bitrateKbps });
  }
  if (profile.maxSectionDurationSec && Number.isFinite(a.durationSec)) {
    pushIssue(issues, a.durationSec > profile.maxSectionDurationSec, { code: 'section-too-long', severity: 'error', value: a.durationSec, maximum: profile.maxSectionDurationSec });
  }

  return freeze({
    profileId: profile.id,
    passed: !issues.some((issue) => issue.severity === 'error'),
    issues: freeze(issues)
  });
}
