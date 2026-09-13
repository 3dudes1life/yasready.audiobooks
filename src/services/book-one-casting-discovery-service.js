import { createHash } from 'node:crypto';
import { normalizeVoiceProfile, scoreSeriesSafety } from '../casting/voice-profile.js';
import { YASREADY_AUDIOBOOKS_VERSION } from '../release.js';

const freeze = (value) => Object.freeze(value);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const clean = (value) => String(value ?? '').trim();
const lower = (value) => clean(value).toLowerCase();

const BOOK_ONE_CASTING_INTENTS = Object.freeze({
  Narrator: Object.freeze({
    label: 'Warm contemporary romance narrator',
    preferredGender: 'male',
    keywords: Object.freeze(['audiobook', 'narration', 'storytelling', 'warm', 'natural', 'conversational', 'expressive', 'emotional'])
  }),
  'Juan Delgado': Object.freeze({
    label: 'Warm, confident, playful lead',
    preferredGender: 'male',
    keywords: Object.freeze(['warm', 'confident', 'playful', 'charismatic', 'conversational', 'expressive', 'romantic'])
  }),
  'Michael Rawlins': Object.freeze({
    label: 'Grounded, warm, emotionally natural lead',
    preferredGender: 'male',
    keywords: Object.freeze(['grounded', 'warm', 'natural', 'emotional', 'calm', 'conversational', 'intimate'])
  }),
  'Christopher Lancaster': Object.freeze({
    label: 'Confident, polished, warm lead',
    preferredGender: 'male',
    keywords: Object.freeze(['confident', 'polished', 'warm', 'smooth', 'conversational', 'expressive', 'natural'])
  })
});

function sha256(value) {
  return createHash('sha256').update(String(value ?? '')).digest('hex');
}

function csvCell(value) {
  const text = Array.isArray(value) ? value.join(' | ') : String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

function assertArtifacts(launch, prep) {
  if (!launch || typeof launch !== 'object') throw new Error('Casting Candidate Discovery requires casting-launch.json');
  if (!prep || typeof prep !== 'object') throw new Error('Casting Candidate Discovery requires book-one-audio-bible-prep.json');
  if (launch.status !== 'READY_FOR_CANDIDATE_DISCOVERY') throw new Error('Casting Candidate Discovery requires READY_FOR_CANDIDATE_DISCOVERY launch state');
  if (launch.guardrails?.candidateDiscoveryAllowed !== true) throw new Error('Casting Candidate Discovery is not allowed by launch guardrails');
  if (launch.guardrails?.auditionRenderingArmed || launch.guardrails?.paidGenerationArmed || launch.guardrails?.productionArmed) {
    throw new Error('Casting Candidate Discovery refuses an already-armed paid/production state');
  }
  if (prep.status !== 'AUDIO_BIBLE_LOCKED' || prep.audioBible?.locked !== true || prep.gates?.productionReady !== true) {
    throw new Error('Casting Candidate Discovery requires a locked production-ready Audio Bible prep artifact');
  }
  if (launch.book?.id !== prep.book?.id || launch.book?.sourceHash !== prep.book?.sourceHash) {
    throw new Error('Casting Candidate Discovery book/source hash does not match Audio Bible prep');
  }
  if (launch.source?.audioBibleId !== prep.audioBible?.id || launch.source?.audioBibleDigest !== prep.audioBible?.digest) {
    throw new Error('Casting Candidate Discovery Audio Bible identity/digest does not match prep');
  }
  if (!Array.isArray(prep.snapshot?.characters) || prep.snapshot.characters.length === 0) {
    throw new Error('Casting Candidate Discovery requires Audio Bible snapshot characters');
  }
  const waveOne = launch.waves?.find((row) => row.wave === 1)?.targets ?? [];
  if (!waveOne.length) throw new Error('Casting Candidate Discovery requires Wave 1 targets');
  const snapshotNames = new Set(prep.snapshot.characters.map((row) => row.canonicalName));
  for (const target of waveOne) {
    if (!snapshotNames.has(target.canonicalName)) throw new Error(`Casting Candidate Discovery cannot resolve character identity for ${target.canonicalName}`);
  }
  return { launch, prep, waveOne };
}

function normalizedVoice(raw) {
  if (raw?.providerVoiceId) {
    return freeze({
      provider: raw.provider ?? 'elevenlabs',
      source: raw.source ?? 'voice-library',
      providerVoiceId: raw.providerVoiceId,
      publicOwnerId: raw.publicOwnerId ?? null,
      name: raw.name ?? 'Unnamed voice',
      description: raw.description ?? '',
      category: raw.category ?? null,
      accent: raw.accent ?? null,
      gender: raw.gender ?? null,
      age: raw.age ?? null,
      language: raw.language ?? null,
      locale: raw.locale ?? null,
      useCase: raw.useCase ?? null,
      descriptives: freeze([...(raw.descriptives ?? [])]),
      verifiedLanguages: freeze([...(raw.verifiedLanguages ?? [])]),
      previewUrl: raw.previewUrl ?? null,
      noticePeriodDays: Number(raw.noticePeriodDays ?? 0) || 0,
      disableAtUnix: raw.disableAtUnix ?? null,
      customRate: raw.customRate ?? null,
      hasCustomRate: Boolean(raw.hasCustomRate),
      liveModerationEnabled: Boolean(raw.liveModerationEnabled),
      featured: Boolean(raw.featured),
      usageCharacterCount1y: Number(raw.usageCharacterCount1y ?? 0) || 0,
      clonedByCount: Number(raw.clonedByCount ?? 0) || 0
    });
  }
  return normalizeVoiceProfile(raw, { provider: raw?.provider ?? 'elevenlabs', source: raw?.source ?? 'voice-library' });
}

function metadataText(voice) {
  return [
    voice.name, voice.description, voice.category, voice.accent, voice.gender, voice.age, voice.language,
    voice.locale, voice.useCase, ...(voice.descriptives ?? []),
    ...(voice.verifiedLanguages ?? []).flatMap((row) => [row.language, row.locale, row.accent])
  ].filter(Boolean).join(' ').toLowerCase();
}

function roleIntent(target) {
  return BOOK_ONE_CASTING_INTENTS[target.canonicalName] ?? freeze({
    label: `${target.role} casting profile`,
    preferredGender: null,
    keywords: freeze(['natural', 'conversational', 'expressive'])
  });
}

function roleFit(voice, target) {
  const intent = roleIntent(target);
  const text = metadataText(voice);
  const matchedKeywords = intent.keywords.filter((word) => text.includes(word));
  let score = 42;
  if (intent.preferredGender && lower(voice.gender) === lower(intent.preferredGender)) score += 10;
  if (/audiobook|narrat|story/.test(lower(voice.useCase)) && target.role === 'narrator') score += 15;
  if (/convers|character|story|narrat/.test(lower(voice.useCase)) && target.role !== 'narrator') score += 8;
  score += Math.min(28, matchedKeywords.length * 5);
  if (voice.previewUrl) score += 5;
  const englishVerified = voice.language === 'en' || (voice.verifiedLanguages ?? []).some((row) => row.language === 'en');
  if (englishVerified) score += 5;
  return freeze({
    score: clamp(Math.round(score), 0, 100),
    label: intent.label,
    matchedKeywords: freeze(matchedKeywords),
    preferredGender: intent.preferredGender,
    preferenceSource: 'Book One casting default; a creative preference, not canonical character biography'
  });
}

function compactVoice(voice) {
  return freeze({
    provider: voice.provider,
    providerVoiceId: voice.providerVoiceId,
    publicOwnerId: voice.publicOwnerId ?? null,
    name: voice.name,
    description: voice.description ?? '',
    category: voice.category ?? null,
    accent: voice.accent ?? null,
    gender: voice.gender ?? null,
    age: voice.age ?? null,
    language: voice.language ?? null,
    locale: voice.locale ?? null,
    useCase: voice.useCase ?? null,
    descriptives: freeze([...(voice.descriptives ?? [])]),
    verifiedLanguages: freeze([...(voice.verifiedLanguages ?? [])]),
    previewUrl: voice.previewUrl ?? null,
    noticePeriodDays: Number(voice.noticePeriodDays ?? 0),
    disableAtUnix: voice.disableAtUnix ?? null,
    hasCustomRate: Boolean(voice.hasCustomRate),
    liveModerationEnabled: Boolean(voice.liveModerationEnabled),
    featured: Boolean(voice.featured)
  });
}

function candidateScore(voice, target) {
  const safety = scoreSeriesSafety(voice, { desiredLanguage: 'en' });
  const fit = roleFit(voice, target);
  const combined = Number((safety.score * 0.7 + fit.score * 0.3).toFixed(1));
  const strengths = [...safety.reasons];
  if (fit.matchedKeywords.length) strengths.push(`casting-fit metadata: ${fit.matchedKeywords.join(', ')}`);
  const concerns = [...safety.warnings];
  if (!fit.matchedKeywords.length) concerns.push('limited role-specific descriptive metadata; audition matters more than metadata fit');
  return freeze({ voice, safety, fit, combined, strengths: freeze(strengths), concerns: freeze(concerns) });
}

function metadataSignature(voice) {
  const values = [voice.gender, voice.age, voice.accent, voice.useCase, ...(voice.descriptives ?? [])]
    .map(lower).filter(Boolean);
  return new Set(values);
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const item of a) if (b.has(item)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

function buildDistinctiveness(shortlists) {
  const leaders = shortlists.map((row) => ({ character: row.character, candidate: row.candidates[0] })).filter((row) => row.candidate);
  const warnings = [];
  for (let i = 0; i < leaders.length; i += 1) {
    for (let j = i + 1; j < leaders.length; j += 1) {
      const a = leaders[i];
      const b = leaders[j];
      const similarity = jaccard(metadataSignature(a.candidate.voice), metadataSignature(b.candidate.voice));
      if (similarity >= 0.8) {
        warnings.push(freeze({
          characters: freeze([a.character, b.character]),
          similarity: Number(similarity.toFixed(2)),
          note: 'Top candidates share highly similar catalog metadata. This is a review warning only; acoustic similarity cannot be proven without listening.'
        }));
      }
    }
  }
  return freeze({
    exactVoiceReuseBlocked: true,
    metadataSimilarityChecked: true,
    acousticSimilarityValidated: false,
    status: warnings.length ? 'REVIEW' : 'PASS',
    warnings: freeze(warnings)
  });
}

function chooseUniqueShortlists(waveOne, voices, { perRole = 6, auditionTop = 3 } = {}) {
  const ranked = new Map();
  for (const target of waveOne) {
    ranked.set(target.canonicalName, voices
      .map((voice) => candidateScore(voice, target))
      .sort((a, b) => b.combined - a.combined || b.safety.score - a.safety.score || a.voice.name.localeCompare(b.voice.name)));
  }
  const used = new Set();
  const chosen = new Map(waveOne.map((target) => [target.canonicalName, []]));
  for (let slot = 0; slot < perRole; slot += 1) {
    for (const target of waveOne) {
      const rows = ranked.get(target.canonicalName);
      const next = rows.find((row) => !used.has(`${row.voice.provider}:${row.voice.providerVoiceId}`));
      if (!next) continue;
      used.add(`${next.voice.provider}:${next.voice.providerVoiceId}`);
      chosen.get(target.canonicalName).push(next);
    }
  }
  return waveOne.map((target) => freeze({
    character: target.canonicalName,
    role: target.role,
    intent: roleIntent(target),
    candidates: freeze(chosen.get(target.canonicalName).map((row, index) => freeze({
      ...row,
      rank: index + 1,
      recommendation: index < auditionTop ? 'AUDITION' : 'ALTERNATE'
    })))
  }));
}

function analysisRows(ingestResult) {
  const rows = [];
  let flat = 0;
  for (const chapter of ingestResult.analysis.chapters ?? []) {
    for (const scene of chapter.scenes ?? []) {
      for (const segment of scene.segments ?? []) {
        const record = ingestResult.segments?.[flat] ?? null;
        rows.push({ chapter, scene, segment, record });
        flat += 1;
      }
    }
  }
  return rows;
}

function clipText(value, max = 320) {
  const text = clean(value).replace(/\s+/g, ' ');
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

function pickSpread(rows, count = 3) {
  if (!rows.length) return [];
  const out = [];
  const indexes = count === 1 ? [0] : Array.from({ length: count }, (_, i) => Math.round((rows.length - 1) * (i / (count - 1))));
  for (const index of indexes) {
    const row = rows[index];
    if (row && !out.includes(row)) out.push(row);
  }
  for (const row of rows) {
    if (out.length >= count) break;
    if (!out.includes(row)) out.push(row);
  }
  return out.slice(0, count);
}

function dialogueScore(text, mode) {
  const t = clean(text);
  const emotional = (t.match(/\b(love|sorry|miss|need|want|afraid|hurt|fuck|shit|damn|please|god|hell)\b/gi) ?? []).length;
  const punctuation = (t.match(/[!?]/g) ?? []).length;
  if (mode === 'emotional') return emotional * 8 + punctuation * 3 + Math.min(10, t.length / 30);
  if (mode === 'energy') return punctuation * 7 + emotional * 3 + Math.min(8, t.length / 35);
  return 40 - Math.abs(110 - t.length) / 5 - punctuation * 2;
}

function pickCharacterScripts(rows) {
  const usable = rows.filter((row) => {
    const len = clean(row.text).length;
    return len >= 18 && len <= 320;
  });
  const used = new Set();
  const modes = [
    ['neutral', 'Conversational / neutral'],
    ['emotional', 'Emotional range'],
    ['energy', 'High-energy / dynamic']
  ];
  const result = [];
  for (const [mode, label] of modes) {
    const candidate = [...usable]
      .filter((row) => !used.has(row.segmentId))
      .sort((a, b) => dialogueScore(b.text, mode) - dialogueScore(a.text, mode))[0];
    if (!candidate) continue;
    used.add(candidate.segmentId);
    result.push(freeze({
      id: mode,
      label,
      text: clipText(candidate.text),
      chapterOrder: candidate.chapterOrder,
      chapterTitle: candidate.chapterTitle,
      segmentId: candidate.segmentId,
      purpose: mode,
      source: 'canonical-manuscript-dialogue'
    }));
  }
  return result;
}

export function buildAuditionSamplePackFromPrepRun(prepRun, launch) {
  if (!prepRun?.prep || !prepRun?.ingestResult) throw new Error('audition sample extraction requires a fresh Book One Audio Bible Prep run');
  if (prepRun.prep.book?.sourceHash !== launch.book?.sourceHash) throw new Error('audition sample manuscript source hash does not match Casting Launch');
  if (prepRun.prep.status !== 'AUDIO_BIBLE_LOCKED') throw new Error('audition sample extraction requires a locked fresh prep run');
  const rows = analysisRows(prepRun.ingestResult);
  const byId = new Map(rows.filter((row) => row.record?.id).map((row) => [row.record.id, row]));
  const bindingRows = new Map();
  for (const binding of prepRun.prep.dialogueReview?.autoBindings ?? []) {
    if (!binding.segmentId || binding.classification !== 'spoken-dialogue' || Number(binding.confidence ?? 0) < 0.9) continue;
    const row = byId.get(binding.segmentId);
    if (!row) continue;
    const list = bindingRows.get(binding.speaker) ?? [];
    list.push({
      segmentId: binding.segmentId,
      text: row.segment.text,
      chapterOrder: row.chapter.order ?? null,
      chapterTitle: row.chapter.title ?? null,
      confidence: binding.confidence,
      evidence: binding.evidence
    });
    bindingRows.set(binding.speaker, list);
  }

  const waveOne = launch.waves?.find((row) => row.wave === 1)?.targets ?? [];
  const samples = [];
  for (const target of waveOne) {
    let scripts;
    if (target.role === 'narrator') {
      const narration = rows.filter((row) => row.segment.kind !== 'dialogue' && clean(row.segment.text).length >= 90 && clean(row.segment.text).length <= 420);
      scripts = pickSpread(narration, 3).map((row, index) => freeze({
        id: `narration-${index + 1}`,
        label: ['Narrative opening tone', 'Narrative middle range', 'Narrative later-book range'][index] ?? `Narration ${index + 1}`,
        text: clipText(row.segment.text),
        chapterOrder: row.chapter.order ?? null,
        chapterTitle: row.chapter.title ?? null,
        segmentId: row.record?.id ?? null,
        purpose: ['neutral', 'emotional', 'range'][index] ?? 'range',
        source: 'canonical-manuscript-narration'
      }));
    } else {
      scripts = pickCharacterScripts(bindingRows.get(target.canonicalName) ?? []);
    }
    samples.push(freeze({ character: target.canonicalName, role: target.role, scripts: freeze(scripts) }));
  }
  const missing = samples.filter((row) => row.scripts.length < 3).map((row) => row.character);
  return freeze({
    sourceHash: prepRun.prep.book.sourceHash,
    sourceValidated: true,
    status: missing.length ? 'PARTIAL' : 'READY',
    manuscriptDerived: true,
    sensitiveLocalArtifact: true,
    doNotCommit: true,
    missingCharacters: freeze(missing),
    samples: freeze(samples)
  });
}

async function buildCostPreview(shortlists, samplePack, estimator, { model, auditionTop }) {
  if (!samplePack || !Array.isArray(samplePack.samples) || typeof estimator !== 'function') {
    return freeze({ status: 'NEEDS_SOURCE_SAMPLES', model, recommendedAuditionUsd: null, fullShortlistUsd: null, roles: freeze([]) });
  }
  const sampleByCharacter = new Map(samplePack.samples.map((row) => [row.character, row]));
  let recommendedTotal = 0;
  let fullTotal = 0;
  const roles = [];
  for (const shortlist of shortlists) {
    const scripts = sampleByCharacter.get(shortlist.character)?.scripts ?? [];
    let perCandidate = 0;
    const lines = [];
    for (const script of scripts) {
      const estimate = await estimator({ text: script.text, model });
      if (estimate?.amountUsd === null || estimate?.amountUsd === undefined || !Number.isFinite(Number(estimate.amountUsd))) {
        return freeze({ status: 'UNKNOWN_COST', model, recommendedAuditionUsd: null, fullShortlistUsd: null, roles: freeze(roles) });
      }
      perCandidate += Number(estimate.amountUsd);
      lines.push(freeze({ scriptId: script.id, characters: estimate.characters ?? script.text.length, amountUsd: Number(estimate.amountUsd) }));
    }
    const recommendedCount = Math.min(auditionTop, shortlist.candidates.length);
    const recommendedUsd = Number((perCandidate * recommendedCount).toFixed(6));
    const fullUsd = Number((perCandidate * shortlist.candidates.length).toFixed(6));
    recommendedTotal += recommendedUsd;
    fullTotal += fullUsd;
    roles.push(freeze({ character: shortlist.character, scripts: freeze(lines), perCandidateUsd: Number(perCandidate.toFixed(6)), recommendedCandidateCount: recommendedCount, recommendedUsd, fullShortlistUsd: fullUsd }));
  }
  return freeze({
    status: samplePack.status === 'READY' ? 'ESTIMATED' : 'PARTIAL_SAMPLES',
    model,
    recommendedAuditionUsd: Number(recommendedTotal.toFixed(6)),
    fullShortlistUsd: Number(fullTotal.toFixed(6)),
    roles: freeze(roles)
  });
}

function compactShortlists(shortlists, prep, launch) {
  const charByName = new Map((prep.snapshot.characters ?? []).map((row) => [row.canonicalName, row]));
  return shortlists.map((row) => freeze({
    character: row.character,
    role: row.role,
    intent: row.intent,
    candidates: freeze(row.candidates.map((candidate) => {
      const character = charByName.get(row.character);
      const id = `vc_${sha256(`${launch.artifactFingerprint}|${character?.id}|${candidate.voice.provider}|${candidate.voice.providerVoiceId}`).slice(0, 24)}`;
      return freeze({
        id,
        characterId: character?.id ?? null,
        rank: candidate.rank,
        recommendation: candidate.recommendation,
        candidateStatus: 'staged-zero-spend',
        auditionStatus: 'not-armed',
        voice: compactVoice(candidate.voice),
        seriesSafety: candidate.safety,
        roleFit: candidate.fit,
        combinedScore: candidate.combined,
        strengths: candidate.strengths,
        concerns: candidate.concerns
      });
    }))
  }));
}

export function renderCastingDiscoveryMarkdown(discovery) {
  const lines = [
    '# Book One Casting Candidate Discovery', '',
    `**YasReady Audiobooks:** ${discovery.provenance.applicationRelease}`,
    `**Book:** ${discovery.book.title}`,
    `**Status:** ${discovery.status}`,
    `**Voice catalog:** ${discovery.catalog.provider} (${discovery.catalog.uniqueVoices} unique voice(s))`, '',
    '## Spend state', '',
    `- Catalog metadata calls: ${discovery.catalog.catalogCallsPerformed}`,
    '- Paid provider calls: 0',
    '- TTS generation calls: 0',
    '- Paid audition generation armed: NO',
    '- Production generation armed: NO', '',
    '## Wave 1 shortlists', ''
  ];
  for (const row of discovery.shortlists) {
    lines.push(`### ${row.character}`, '', `Casting intent: ${row.intent.label}`, '');
    if (!row.candidates.length) {
      lines.push('- No safe unique candidates staged. Increase catalog pages or relax discovery filters.', '');
      continue;
    }
    for (const candidate of row.candidates) {
      const v = candidate.voice;
      lines.push(
        `${candidate.rank}. **${v.name}** — ${candidate.combinedScore}/100 — ${candidate.recommendation}`,
        `   - Series safety: ${candidate.seriesSafety.score}/100 (${candidate.seriesSafety.grade})`,
        `   - Role fit: ${candidate.roleFit.score}/100`,
        `   - Accent / age / gender: ${v.accent ?? 'not listed'} / ${v.age ?? 'not listed'} / ${v.gender ?? 'not listed'}`,
        `   - Notice protection: ${v.noticePeriodDays} day(s)`,
        `   - Use case: ${v.useCase ?? 'not listed'}`,
        `   - Strengths: ${candidate.strengths.slice(0, 3).join('; ') || 'catalog metadata is limited'}`,
        `   - Concerns: ${candidate.concerns.slice(0, 2).join('; ') || 'none from catalog safety metadata'}`,
        `   - Preview: ${v.previewUrl ?? 'no preview URL supplied by catalog'}`,
        ''
      );
    }
  }
  lines.push('## Audition scripts', '');
  if (!discovery.auditionSamples) {
    lines.push('- No manuscript was supplied to this discovery run. Candidate ranking is usable, but auditions are not ready until canonical Book One samples are extracted.', '');
  } else {
    for (const row of discovery.auditionSamples.samples) {
      lines.push(`### ${row.character}`, '');
      for (const script of row.scripts) lines.push(`- **${script.label}:** ${script.text}`);
      lines.push('');
    }
    lines.push('> These excerpts are manuscript-derived local production material. Keep this folder out of GitHub.', '');
  }
  lines.push(
    '## Audition cost preview', '',
    `- Status: ${discovery.auditionCost.status}`,
    `- Recommended top-candidate audition plan: ${discovery.auditionCost.recommendedAuditionUsd === null ? 'not available yet' : `$${discovery.auditionCost.recommendedAuditionUsd.toFixed(2)}`}`,
    `- Full shortlist audition plan: ${discovery.auditionCost.fullShortlistUsd === null ? 'not available yet' : `$${discovery.auditionCost.fullShortlistUsd.toFixed(2)}`}`,
    '- This is an estimate only. No audition has been rendered or paid for.', '',
    '## Distinctiveness', '',
    `- Exact voice reuse across Wave 1 shortlists: ${discovery.distinctiveness.exactVoiceReuseBlocked ? 'BLOCKED' : 'not checked'}`,
    `- Metadata similarity gate: ${discovery.distinctiveness.status}`,
    '- Acoustic similarity: NOT VALIDATED until humans listen to auditions.', ''
  );
  for (const warning of discovery.distinctiveness.warnings) {
    lines.push(`- Review ${warning.characters.join(' vs ')} — metadata similarity ${warning.similarity}`);
  }
  lines.push('', '## Next action', '', discovery.nextAction, '', '> `ARM AUDITIONS` remains a separate future operator action. This discovery build cannot render paid audio.', '');
  return lines.join('\n');
}

export function renderCastingDiscoveryCsv(discovery) {
  const header = ['character', 'rank', 'recommendation', 'candidate_id', 'character_id', 'provider', 'voice_name', 'voice_id', 'combined_score', 'series_safety_score', 'series_safety_grade', 'role_fit_score', 'accent', 'age', 'gender', 'use_case', 'notice_days', 'preview_url', 'candidate_status', 'audition_status', 'operator_decision', 'notes'];
  const lines = [header.map(csvCell).join(',')];
  for (const row of discovery.shortlists) for (const candidate of row.candidates) {
    const v = candidate.voice;
    lines.push([
      row.character, candidate.rank, candidate.recommendation, candidate.id, candidate.characterId,
      v.provider, v.name, v.providerVoiceId, candidate.combinedScore, candidate.seriesSafety.score,
      candidate.seriesSafety.grade, candidate.roleFit.score, v.accent, v.age, v.gender, v.useCase,
      v.noticePeriodDays, v.previewUrl, candidate.candidateStatus, candidate.auditionStatus, '', ''
    ].map(csvCell).join(','));
  }
  return `${lines.join('\n')}\n`;
}

export function renderAuditionScriptsCsv(discovery) {
  const header = ['character', 'script_id', 'label', 'purpose', 'chapter_order', 'chapter_title', 'source', 'text'];
  const lines = [header.map(csvCell).join(',')];
  for (const row of discovery.auditionSamples?.samples ?? []) for (const script of row.scripts) {
    lines.push([row.character, script.id, script.label, script.purpose, script.chapterOrder, script.chapterTitle, script.source, script.text].map(csvCell).join(','));
  }
  return `${lines.join('\n')}\n`;
}

export class BookOneCastingDiscoveryService {
  async build({ launch, prep, voices, auditionSamples = null, costEstimator = null, perRole = 6, auditionTop = 3, model = 'eleven_multilingual_v2', catalogCallsPerformed = 0, catalogProvider = 'provided-pool' } = {}) {
    const { waveOne } = assertArtifacts(launch, prep);
    const perRoleCount = clamp(Math.trunc(Number(perRole) || 6), 1, 8);
    const auditionCount = clamp(Math.trunc(Number(auditionTop) || 3), 1, perRoleCount);
    const uniquePool = [];
    const seen = new Set();
    for (const raw of voices ?? []) {
      const voice = normalizedVoice(raw);
      if (!clean(voice.providerVoiceId)) continue;
      const key = `${voice.provider}:${voice.providerVoiceId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      uniquePool.push(voice);
    }
    const rawShortlists = chooseUniqueShortlists(waveOne, uniquePool, { perRole: perRoleCount, auditionTop: auditionCount });
    const shortlists = freeze(compactShortlists(rawShortlists, prep, launch));
    const totalNeeded = waveOne.length * perRoleCount;
    const totalStaged = shortlists.reduce((sum, row) => sum + row.candidates.length, 0);
    const distinctiveness = buildDistinctiveness(shortlists);
    const auditionCost = await buildCostPreview(shortlists, auditionSamples, costEstimator, { model, auditionTop: auditionCount });
    const sourceReady = auditionSamples?.status === 'READY';
    const status = totalStaged < totalNeeded
      ? 'NEEDS_MORE_CANDIDATES'
      : sourceReady
        ? 'READY_FOR_OPERATOR_REVIEW'
        : 'CANDIDATES_READY_SAMPLES_PENDING';
    const artifactFingerprint = sha256(JSON.stringify({
      launch: launch.artifactFingerprint,
      prepDigest: prep.audioBible.digest,
      voices: shortlists.flatMap((row) => row.candidates.map((candidate) => [row.character, candidate.voice.provider, candidate.voice.providerVoiceId])),
      sampleHash: auditionSamples ? sha256(JSON.stringify(auditionSamples.samples)) : null,
      model
    }));
    const discovery = freeze({
      schemaVersion: 1,
      release: YASREADY_AUDIOBOOKS_VERSION,
      status,
      provenance: freeze({
        application: 'YasReady Audiobooks',
        applicationRelease: YASREADY_AUDIOBOOKS_VERSION,
        artifact: 'book-one-casting-candidate-discovery',
        artifactRelease: YASREADY_AUDIOBOOKS_VERSION,
        sourceCastingLaunchRelease: launch.release ?? launch.provenance?.artifactRelease ?? null,
        sourcePrepRelease: prep.release ?? prep.provenance?.artifactRelease ?? null,
        sourcePrepEngineRelease: prep.provenance?.prepEngineRelease ?? null,
        sourceSupermanEngineRelease: prep.provenance?.supermanEngineRelease ?? prep.superman?.engineRelease ?? null
      }),
      book: freeze({ id: launch.book.id, title: launch.book.title, author: launch.book.author ?? null, sourceHash: launch.book.sourceHash }),
      source: freeze({
        castingLaunchFingerprint: launch.artifactFingerprint,
        audioBibleId: launch.source.audioBibleId,
        audioBibleDigest: launch.source.audioBibleDigest,
        audioBibleRevision: launch.source.audioBibleRevision ?? null
      }),
      catalog: freeze({
        provider: catalogProvider,
        catalogCallsPerformed: Number(catalogCallsPerformed ?? 0),
        uniqueVoices: uniquePool.length,
        requestedPerRole: perRoleCount,
        auditionTopPerRole: auditionCount,
        filters: freeze({ language: 'en', category: 'professional', minNoticePeriodDays: 180, sort: 'trending' })
      }),
      shortlists,
      distinctiveness,
      auditionSamples,
      auditionCost,
      auditionPlanPreview: freeze({
        status: sourceReady && totalStaged >= totalNeeded ? 'READY_TO_REQUEST_ARMING' : 'NOT_READY',
        armed: false,
        model,
        candidateIds: freeze(shortlists.flatMap((row) => row.candidates.filter((candidate) => candidate.recommendation === 'AUDITION').map((candidate) => candidate.id))),
        scriptCount: auditionSamples?.samples?.reduce((sum, row) => sum + row.scripts.length, 0) ?? 0,
        estimatedUsd: auditionCost.recommendedAuditionUsd,
        moneyGuardApprovalRequiredBeforeRendering: true
      }),
      guardrails: freeze({
        candidateDiscoveryPerformed: true,
        exactVoiceReuseAcrossCoreShortlistsBlocked: true,
        paidProviderCallsPerformed: 0,
        generationCallsPerformed: 0,
        auditionRenderingArmed: false,
        paidGenerationArmed: false,
        productionArmed: false,
        castLocked: false,
        armAuditionsAvailableInThisBuild: false
      }),
      artifactFingerprint,
      nextAction: totalStaged < totalNeeded
        ? `Only ${totalStaged}/${totalNeeded} unique Wave 1 candidate slots were filled. Increase catalog pages or lower --per-role before auditioning.`
        : sourceReady
          ? `Review preview links and shortlist decisions for ${waveOne.map((row) => row.canonicalName).join(', ')}. Then explicitly approve which candidates should enter the future ARM AUDITIONS step; no audio has been generated.`
          : 'Candidate discovery is complete, but canonical audition scripts are missing. Re-run with --manuscript pointing to the exact Book One source before any audition can be armed.'
    });
    return freeze({
      discovery,
      markdown: renderCastingDiscoveryMarkdown(discovery),
      shortlistCsv: renderCastingDiscoveryCsv(discovery),
      scriptsCsv: renderAuditionScriptsCsv(discovery)
    });
  }

  async discoverFromProvider({ launch, prep, provider, auditionSamples = null, perRole = 6, auditionTop = 3, model = 'eleven_multilingual_v2', maxPages = 2, pageSize = 100 } = {}) {
    if (!provider || typeof provider.searchVoices !== 'function') throw new Error('Casting Candidate Discovery requires a provider with searchVoices()');
    const voices = [];
    let catalogCallsPerformed = 0;
    const pages = clamp(Math.trunc(Number(maxPages) || 2), 1, 5);
    const size = clamp(Math.trunc(Number(pageSize) || 100), 10, 100);
    for (let page = 0; page < pages; page += 1) {
      const result = await provider.searchVoices({
        language: 'en',
        category: 'professional',
        minNoticePeriodDays: 180,
        includeCustomRates: false,
        includeLiveModerated: false,
        sort: 'trending',
        page,
        pageSize: size
      });
      catalogCallsPerformed += 1;
      voices.push(...(result.voices ?? []));
      if (!result.hasMore) break;
    }
    return this.build({
      launch, prep, voices, auditionSamples,
      costEstimator: typeof provider.estimateCost === 'function' ? provider.estimateCost.bind(provider) : null,
      perRole, auditionTop, model, catalogCallsPerformed, catalogProvider: provider.name ?? 'elevenlabs'
    });
  }
}

export function buildCastingDiscoveryFixture() {
  const launch = {
    schemaVersion: 1,
    release: '0.14.1',
    status: 'READY_FOR_CANDIDATE_DISCOVERY',
    provenance: { applicationRelease: '0.14.1', artifactRelease: '0.14.1' },
    book: { id: 'book-one', title: 'Fixture Book One', author: 'Fixture Author', sourceHash: 'fixture-source' },
    source: { audioBibleId: 'bible-one', audioBibleDigest: 'fixture-digest', audioBibleRevision: 32 },
    artifactFingerprint: 'fixture-launch-fingerprint',
    waves: [{
      wave: 1,
      label: 'Narrator + primary cast',
      targets: [
        { canonicalName: 'Narrator', role: 'narrator', wave: 1 },
        { canonicalName: 'Juan Delgado', role: 'primary', wave: 1 },
        { canonicalName: 'Michael Rawlins', role: 'primary', wave: 1 },
        { canonicalName: 'Christopher Lancaster', role: 'primary', wave: 1 }
      ]
    }],
    requiredBeforeDirector: ['Narrator', 'Juan Delgado', 'Michael Rawlins', 'Christopher Lancaster'],
    guardrails: { candidateDiscoveryAllowed: true, auditionRenderingArmed: false, paidGenerationArmed: false, productionArmed: false }
  };
  const chars = launch.requiredBeforeDirector.map((name, index) => ({ id: `char-${index + 1}`, canonicalName: name, bibleId: 'bible-one' }));
  const prep = {
    schemaVersion: 8,
    release: '0.14.1',
    status: 'AUDIO_BIBLE_LOCKED',
    provenance: { artifactRelease: '0.14.1', prepEngineRelease: '0.11.8', supermanEngineRelease: '0.11.3' },
    book: { id: 'book-one', sourceHash: 'fixture-source' },
    audioBible: { id: 'bible-one', digest: 'fixture-digest', locked: true },
    snapshot: { characters: chars, digest: 'fixture-digest' },
    gates: { productionReady: true, audioBibleLocked: true }
  };
  const voices = Array.from({ length: 36 }, (_, index) => ({
    provider: 'elevenlabs',
    providerVoiceId: `fixture-voice-${index + 1}`,
    name: `Fixture Voice ${String(index + 1).padStart(2, '0')}`,
    description: `${['warm', 'grounded', 'confident', 'playful', 'polished', 'natural'][index % 6]} conversational audiobook storytelling voice`,
    category: 'professional',
    accent: ['american', 'neutral', 'californian'][index % 3],
    gender: 'male',
    age: ['young', 'middle-aged'][index % 2],
    language: 'en',
    useCase: index % 4 === 0 ? 'narration' : 'conversational',
    descriptives: [['warm', 'expressive'], ['natural', 'grounded'], ['confident', 'smooth']][index % 3],
    verifiedLanguages: [{ language: 'en', locale: 'en-US', accent: 'american' }],
    previewUrl: `https://example.invalid/voice-${index + 1}.mp3`,
    noticePeriodDays: index < 30 ? 365 : 180,
    hasCustomRate: false,
    liveModerationEnabled: false
  }));
  const sampleText = {
    Narrator: ['The room settled into a quiet that felt warmer than silence.', 'By morning, the city looked different, though nothing outside had changed.', 'They stood together at the threshold, carrying more hope than luggage.'],
    'Juan Delgado': ['I can make dinner, but nobody gets to judge the playlist.', 'I love you. I just need you to hear me before you answer.', 'Are you kidding me? We are absolutely doing this tonight!'],
    'Michael Rawlins': ['Give me a minute. I am trying to understand what you mean.', 'I am scared because this matters more than I know how to say.', 'No. Absolutely not. You cannot drop that on me and walk away!'],
    'Christopher Lancaster': ['Coffee first, explanations second. That is the deal.', 'I did not come here to make this harder. I came because I care.', 'Well, hell. If we are doing this, we are doing it all the way.']
  };
  const auditionSamples = {
    sourceHash: 'fixture-source', sourceValidated: true, status: 'READY', manuscriptDerived: false,
    sensitiveLocalArtifact: false, doNotCommit: false,
    samples: launch.requiredBeforeDirector.map((character) => ({
      character,
      role: character === 'Narrator' ? 'narrator' : 'primary',
      scripts: sampleText[character].map((text, index) => ({
        id: ['neutral', 'emotional', 'energy'][index],
        label: ['Conversational / neutral', 'Emotional range', 'High-energy / dynamic'][index],
        text, purpose: ['neutral', 'emotional', 'energy'][index], chapterOrder: index + 1, chapterTitle: `Fixture ${index + 1}`, source: 'fixture'
      }))
    }))
  };
  const estimateCost = async ({ text, model = 'eleven_multilingual_v2' }) => ({
    amountUsd: Number(((String(text).length / 1000) * 0.10).toFixed(6)),
    characters: String(text).length,
    model,
    estimated: true
  });
  return { launch, prep, voices, auditionSamples, estimateCost };
}
