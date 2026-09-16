import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getMasteringProfile } from './profiles.js';

const defaultExec = promisify(execFileCb);
const freeze = (value) => Object.freeze(value);

function numberFrom(text, pattern) {
  const matches = [...String(text ?? '').matchAll(pattern)];
  if (!matches.length) return null;
  const value = Number(matches.at(-1)[1]);
  return Number.isFinite(value) ? value : null;
}

export function parseLoudnormJson(stderr) {
  const text = String(stderr ?? '');
  const blocks = [...text.matchAll(/\{[\s\S]*?"input_i"[\s\S]*?\}/g)];
  if (!blocks.length) return null;
  try { return JSON.parse(blocks.at(-1)[0]); } catch { return null; }
}

export function parseFfmpegAnalysis(stderr, probe = {}) {
  const text = String(stderr ?? '');
  const rmsDb = numberFrom(text, /RMS level dB:\s*(-?\d+(?:\.\d+)?)/g)
    ?? numberFrom(text, /mean_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/g);
  const peakDb = numberFrom(text, /Peak level dB:\s*(-?\d+(?:\.\d+)?)/g)
    ?? numberFrom(text, /max_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/g);
  const noiseFloorDb = /Noise floor dB:\s*-inf/i.test(text) ? -Infinity : numberFrom(text, /Noise floor dB:\s*(-?\d+(?:\.\d+)?)/g);
  const silenceStarts = [...text.matchAll(/silence_start:\s*(\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]) * 1000);
  const silenceEnds = [...text.matchAll(/silence_end:\s*(\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]) * 1000);
  const durationMs = Number.isFinite(probe.durationSec) ? probe.durationSec * 1000 : null;
  let leadingSilenceMs = 0;
  let trailingSilenceMs = 0;
  if (silenceStarts[0] === 0 && silenceEnds.length) leadingSilenceMs = silenceEnds[0];
  if (durationMs != null && silenceStarts.length && (silenceEnds.length < silenceStarts.length || silenceEnds.at(-1) >= durationMs - 250)) {
    trailingSilenceMs = Math.max(0, durationMs - silenceStarts.at(-1));
  }
  return freeze({ ...probe, rmsDb, peakDb, noiseFloorDb, leadingSilenceMs, trailingSilenceMs });
}

export function parseSilenceIntervals(stderr, durationMs = null) {
  const text = String(stderr ?? '');
  const starts = [...text.matchAll(/silence_start:\s*(-?\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]) * 1000);
  const endings = [...text.matchAll(/silence_end:\s*(-?\d+(?:\.\d+)?)\s*\|\s*silence_duration:\s*(-?\d+(?:\.\d+)?)/g)]
    .map((m) => ({ endMs: Number(m[1]) * 1000, durationMs: Number(m[2]) * 1000 }));
  const out = [];
  for (let i = 0; i < starts.length; i += 1) {
    const startMs = starts[i];
    const end = endings[i] ?? null;
    const endMs = end ? end.endMs : (Number.isFinite(Number(durationMs)) ? Number(durationMs) : null);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) continue;
    out.push(Object.freeze({ startMs, endMs, durationMs: end ? end.durationMs : endMs - startMs }));
  }
  return Object.freeze(out);
}

function concatEscape(file) {
  return String(file).replace(/'/g, "'\\''");
}

function outputArgs(profile) {
  const out = profile.output ?? {};
  if (out.format === 'wav') return ['-c:a', out.codec ?? 'pcm_s24le', '-ar', String(out.sampleRateHz ?? 44100)];
  if (out.format === 'flac') return ['-c:a', out.codec ?? 'flac', '-ar', String(out.sampleRateHz ?? 44100)];
  return [
    '-c:a', out.codec ?? 'libmp3lame', '-ar', String(out.sampleRateHz ?? 44100),
    '-b:a', `${out.bitrateKbps ?? 192}k`,
    ...(out.cbr ? ['-minrate', `${out.bitrateKbps ?? 192}k`, '-maxrate', `${out.bitrateKbps ?? 192}k`] : [])
  ];
}

export class FfmpegAdapter {
  constructor({ ffmpegPath = 'ffmpeg', ffprobePath = 'ffprobe', execFileImpl = defaultExec } = {}) {
    this.ffmpegPath = ffmpegPath;
    this.ffprobePath = ffprobePath;
    this.execFile = execFileImpl;
  }

  async healthCheck() {
    try {
      const [{ stdout: ffmpeg }, { stdout: ffprobe }] = await Promise.all([
        this.execFile(this.ffmpegPath, ['-version']),
        this.execFile(this.ffprobePath, ['-version'])
      ]);
      return freeze({ ok: true, ffmpeg: String(ffmpeg).split('\n')[0], ffprobe: String(ffprobe).split('\n')[0] });
    } catch (error) {
      return freeze({ ok: false, reason: error?.message ?? String(error) });
    }
  }

  async probe(inputPath) {
    const { stdout } = await this.execFile(this.ffprobePath, [
      '-v', 'error', '-select_streams', 'a:0',
      '-show_entries', 'format=duration,bit_rate:stream=sample_rate,channels,channel_layout,codec_name,bit_rate',
      '-of', 'json', inputPath
    ]);
    const parsed = JSON.parse(stdout);
    const stream = parsed.streams?.[0] ?? {};
    const bitrate = Number(stream.bit_rate ?? parsed.format?.bit_rate);
    return freeze({
      durationSec: Number(parsed.format?.duration) || null,
      sampleRateHz: Number(stream.sample_rate) || null,
      channels: Number(stream.channels) || null,
      channelLayout: stream.channel_layout ?? null,
      codec: stream.codec_name ?? null,
      bitrateKbps: Number.isFinite(bitrate) ? Math.round(bitrate / 1000) : null
    });
  }

  async analyze(inputPath) {
    const probe = await this.probe(inputPath);
    let stderr = '';
    try {
      const result = await this.execFile(this.ffmpegPath, [
        '-hide_banner', '-nostats', '-i', inputPath,
        '-af', 'astats=metadata=1:reset=0,volumedetect,silencedetect=noise=-60dB:d=0.1',
        '-f', 'null', '-'
      ], { maxBuffer: 8 * 1024 * 1024 });
      stderr = result.stderr ?? '';
    } catch (error) {
      stderr = error?.stderr ?? '';
      if (!stderr) throw error;
    }
    return parseFfmpegAnalysis(stderr, probe);
  }

  async detectSilences(inputPath, { noiseDb = -50, minDurationMs = 60 } = {}) {
    const probe = await this.probe(inputPath);
    const db = Number(noiseDb);
    const minimumMs = Number(minDurationMs);
    if (!Number.isFinite(db) || db >= 0 || db < -120) throw new Error('detectSilences noiseDb must be between -120 and 0');
    if (!Number.isFinite(minimumMs) || minimumMs < 10 || minimumMs > 10000) throw new Error('detectSilences minDurationMs must be 10-10000');
    let stderr = '';
    try {
      const result = await this.execFile(this.ffmpegPath, [
        '-hide_banner', '-nostats', '-i', inputPath,
        '-af', `silencedetect=noise=${db}dB:d=${(minimumMs / 1000).toFixed(3)}`,
        '-f', 'null', '-'
      ], { maxBuffer: 16 * 1024 * 1024 });
      stderr = result.stderr ?? '';
    } catch (error) {
      stderr = error?.stderr ?? '';
      if (!stderr) throw error;
    }
    const durationMs = Number.isFinite(probe.durationSec) ? probe.durationSec * 1000 : null;
    return freeze({ probe, noiseDb: db, minDurationMs: minimumMs, silences: parseSilenceIntervals(stderr, durationMs) });
  }

  async extract(inputPath, { startMs = 0, endMs = null, outputPath }) {
    if (!outputPath) throw new Error('extract requires outputPath');
    const args = ['-y', '-hide_banner', '-loglevel', 'error', '-ss', (Math.max(0, startMs) / 1000).toFixed(3), '-i', inputPath];
    if (endMs != null) args.push('-t', (Math.max(1, endMs - startMs) / 1000).toFixed(3));
    args.push('-c:a', 'pcm_s24le', '-ar', '44100', outputPath);
    await this.execFile(this.ffmpegPath, args, { maxBuffer: 8 * 1024 * 1024 });
    return outputPath;
  }

  async concat(inputPaths, outputPath) {
    if (!inputPaths?.length) throw new Error('concat requires inputs');
    const dir = await mkdtemp(path.join(tmpdir(), 'yasready-concat-'));
    const listPath = path.join(dir, 'files.txt');
    try {
      await writeFile(listPath, inputPaths.map((file) => `file '${concatEscape(file)}'`).join('\n'));
      await this.execFile(this.ffmpegPath, [
        '-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listPath,
        '-c:a', 'pcm_s24le', '-ar', '44100', outputPath
      ], { maxBuffer: 8 * 1024 * 1024 });
      return outputPath;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  async silence(outputPath, seconds, { sampleRateHz = 44100 } = {}) {
    if (!outputPath) throw new Error('silence requires outputPath');
    const duration = Number(seconds);
    const sampleRate = Number(sampleRateHz);
    if (!Number.isFinite(duration) || duration <= 0 || duration > 10) throw new Error('silence duration must be > 0 and <= 10 seconds');
    if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000) throw new Error('silence sample rate invalid');
    await this.execFile(this.ffmpegPath, [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', `anullsrc=r=${sampleRate}:cl=mono`,
      '-t', duration.toFixed(3),
      '-c:a', 'pcm_s24le', '-ar', String(sampleRate),
      outputPath
    ], { maxBuffer: 8 * 1024 * 1024 });
    return freeze({ outputPath, seconds: Number(duration.toFixed(3)), sampleRateHz: sampleRate });
  }

  async trimEdgeSilence(inputPath, outputPath, {
    trimStart = false,
    trimEnd = false,
    thresholdDb = -70,
    minSilenceMs = 40
  } = {}) {
    if (!inputPath || !outputPath) throw new Error('trimEdgeSilence requires inputPath and outputPath');
    const threshold = Number(thresholdDb);
    const minimum = Number(minSilenceMs);
    if (!Number.isFinite(threshold) || threshold >= -20 || threshold < -100) throw new Error('trimEdgeSilence thresholdDb must be between -100 and -20');
    if (!Number.isFinite(minimum) || minimum < 10 || minimum > 500) throw new Error('trimEdgeSilence minSilenceMs must be 10-500');
    if (!trimStart && !trimEnd) throw new Error('trimEdgeSilence requires trimStart and/or trimEnd');

    const unit = `silenceremove=start_periods=1:start_duration=${(minimum / 1000).toFixed(3)}:start_threshold=${threshold}dB`;
    const filters = [];
    if (trimStart) filters.push(unit);
    if (trimEnd) filters.push('areverse', unit, 'areverse');

    await this.execFile(this.ffmpegPath, [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-i', inputPath,
      '-af', filters.join(','),
      '-c:a', 'pcm_s24le', '-ar', '44100',
      outputPath
    ], { maxBuffer: 8 * 1024 * 1024 });

    return freeze({
      outputPath,
      trimStart: Boolean(trimStart),
      trimEnd: Boolean(trimEnd),
      thresholdDb: threshold,
      minSilenceMs: minimum,
      speechContentMutationIntended: false
    });
  }

  async tempo(inputPath, outputPath, multiplier) {
    if (!inputPath || !outputPath) throw new Error('tempo requires inputPath and outputPath');
    const value = Number(multiplier);
    if (!Number.isFinite(value) || value < 0.5 || value > 2) {
      throw new Error('tempo multiplier must be between 0.5 and 2.0');
    }
    const normalized = Number(value.toFixed(6));
    await this.execFile(this.ffmpegPath, [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-i', inputPath,
      '-af', `atempo=${normalized.toFixed(6)}`,
      '-c:a', 'libmp3lame',
      '-ar', '44100',
      '-b:a', '128k',
      outputPath
    ], { maxBuffer: 8 * 1024 * 1024 });
    return freeze({
      outputPath,
      tempoMultiplier: normalized,
      pitchPreserving: true,
      filter: `atempo=${normalized.toFixed(6)}`
    });
  }

  async voiceDepth(inputPath, outputPath, { mode = 'warm-detinned' } = {}) {
    if (!inputPath || !outputPath) throw new Error('voiceDepth requires inputPath and outputPath');
    if (!['warm-detinned', 'warm-slightly-deeper'].includes(mode)) throw new Error(`unknown voiceDepth mode: ${mode}`);
    const eq = 'equalizer=f=180:t=q:w=1:g=1.2,equalizer=f=3000:t=q:w=1.2:g=-1.6,equalizer=f=5200:t=q:w=1:g=-0.8';
    const semitones = mode === 'warm-slightly-deeper' ? -0.5 : 0;
    const pitchFactor = semitones ? Number((2 ** (semitones / 12)).toFixed(9)) : 1;
    const durationCompensation = semitones ? Number((1 / pitchFactor).toFixed(9)) : 1;
    const filter = semitones
      ? `asetrate=44100*${pitchFactor.toFixed(9)},aresample=44100,atempo=${durationCompensation.toFixed(9)},${eq}`
      : eq;
    await this.execFile(this.ffmpegPath, [
      '-y', '-hide_banner', '-loglevel', 'error', '-i', inputPath,
      '-af', filter, '-c:a', 'pcm_s24le', '-ar', '44100', outputPath
    ], { maxBuffer: 8 * 1024 * 1024 });
    return freeze({ mode, semitones, pitchFactor, durationCompensation, finishedPacePreserved: true, formantPreservationClaimed: false, filter });
  }

  async master(inputPath, outputPath, profileInput) {
    const profile = getMasteringProfile(profileInput);
    const loudness = profile.loudness ?? {};
    const I = loudness.targetIntegratedLufs ?? -20.5;
    const LRA = loudness.targetLraLu ?? 7;
    const TP = loudness.targetTruePeakDbtp ?? -3.5;
    const padMs = Math.max(0, Number(profile.edgeSilence?.minMs ?? 0));
    const padSec = (padMs / 1000).toFixed(3);
    const edgeFilter = padMs > 0 ? `adelay=${padMs}:all=1,apad=pad_dur=${padSec},` : '';
    let firstPassStderr = '';
    try {
      const first = await this.execFile(this.ffmpegPath, [
        '-hide_banner', '-nostats', '-i', inputPath,
        '-af', `${edgeFilter}loudnorm=I=${I}:LRA=${LRA}:TP=${TP}:print_format=json`, '-f', 'null', '-'
      ], { maxBuffer: 8 * 1024 * 1024 });
      firstPassStderr = first.stderr ?? '';
    } catch (error) {
      firstPassStderr = error?.stderr ?? '';
      if (!firstPassStderr) throw error;
    }
    const measured = parseLoudnormJson(firstPassStderr);
    if (!measured) throw new Error('FFmpeg loudnorm did not return first-pass measurements');
    const filter = edgeFilter + [
      `loudnorm=I=${I}:LRA=${LRA}:TP=${TP}`,
      `measured_I=${measured.input_i}`,
      `measured_LRA=${measured.input_lra}`,
      `measured_TP=${measured.input_tp}`,
      `measured_thresh=${measured.input_thresh}`,
      `offset=${measured.target_offset}`,
      'linear=true:print_format=summary'
    ].join(':');

    const dir = await mkdtemp(path.join(tmpdir(), 'yasready-loudnorm-'));
    const normalizedPath = path.join(dir, 'normalized.wav');
    try {
      await this.execFile(this.ffmpegPath, [
        '-y', '-hide_banner', '-loglevel', 'error', '-i', inputPath,
        '-af', filter, '-c:a', 'pcm_s24le', '-ar', String(profile.output?.sampleRateHz ?? 44100),
        normalizedPath
      ], { maxBuffer: 8 * 1024 * 1024 });

      const normalizedAnalysis = await this.analyze(normalizedPath);
      let correctiveGainDb = 0;
      if (Number.isFinite(loudness.targetRmsDb) && Number.isFinite(normalizedAnalysis.rmsDb)) {
        correctiveGainDb = loudness.targetRmsDb - normalizedAnalysis.rmsDb;
        const peakLimit = Number.isFinite(loudness.targetTruePeakDbtp)
          ? loudness.targetTruePeakDbtp
          : (Number.isFinite(loudness.maxPeakDb) ? loudness.maxPeakDb - 0.25 : null);
        if (Number.isFinite(peakLimit) && Number.isFinite(normalizedAnalysis.peakDb)) {
          correctiveGainDb = Math.min(correctiveGainDb, peakLimit - normalizedAnalysis.peakDb);
        }
      }
      const encodeArgs = ['-y', '-hide_banner', '-loglevel', 'error', '-i', normalizedPath];
      if (Math.abs(correctiveGainDb) >= 0.01) encodeArgs.push('-af', `volume=${correctiveGainDb.toFixed(3)}dB`);
      encodeArgs.push(...outputArgs(profile), outputPath);
      await this.execFile(this.ffmpegPath, encodeArgs, { maxBuffer: 8 * 1024 * 1024 });
      return freeze({ outputPath, measured, normalizedAnalysis, correctiveGainDb: Number(correctiveGainDb.toFixed(3)) });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}

