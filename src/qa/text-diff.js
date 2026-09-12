const freeze = (value) => Object.freeze(value);

export function normalizeToken(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .trim();
}

export function tokenizeWords(text) {
  const matches = String(text ?? '').match(/[\p{L}\p{N}]+(?:[’'][\p{L}\p{N}]+)*/gu) ?? [];
  return freeze(matches.map((raw, index) => freeze({ raw, norm: normalizeToken(raw), index })).filter((row) => row.norm));
}

export function diffWords(canonicalText, transcriptText) {
  const a = tokenizeWords(canonicalText);
  const b = tokenizeWords(transcriptText);
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp = Array.from({ length: rows }, () => new Uint32Array(cols));
  for (let i = 0; i < rows; i += 1) dp[i][0] = i;
  for (let j = 0; j < cols; j += 1) dp[0][j] = j;
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1].norm === b[j - 1].norm ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }

  const operations = [];
  let i = a.length;
  let j = b.length;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1].norm === b[j - 1].norm && dp[i][j] === dp[i - 1][j - 1]) {
      operations.push(freeze({ type: 'equal', canonical: a[i - 1], transcript: b[j - 1] }));
      i -= 1; j -= 1; continue;
    }
    if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + 1) {
      operations.push(freeze({ type: 'substitute', canonical: a[i - 1], transcript: b[j - 1] }));
      i -= 1; j -= 1; continue;
    }
    if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) {
      operations.push(freeze({ type: 'delete', canonical: a[i - 1], transcript: null }));
      i -= 1; continue;
    }
    operations.push(freeze({ type: 'insert', canonical: null, transcript: b[j - 1] }));
    j -= 1;
  }
  operations.reverse();
  return freeze({ canonicalTokens: a, transcriptTokens: b, distance: dp[a.length][b.length], operations: freeze(operations) });
}

function collectExamples(operations, type, maxExamples = 8) {
  return freeze(operations.filter((op) => op.type === type).slice(0, maxExamples).map((op) => freeze({
    canonical: op.canonical?.raw ?? null,
    transcript: op.transcript?.raw ?? null,
    canonicalIndex: op.canonical?.index ?? null,
    transcriptIndex: op.transcript?.index ?? null
  })));
}

export function compareTranscript(canonicalText, transcriptText) {
  const diff = diffWords(canonicalText, transcriptText);
  const substitutions = diff.operations.filter((op) => op.type === 'substitute').length;
  const deletions = diff.operations.filter((op) => op.type === 'delete').length;
  const insertions = diff.operations.filter((op) => op.type === 'insert').length;
  const canonicalWords = diff.canonicalTokens.length;
  const transcriptWords = diff.transcriptTokens.length;
  const wordErrorRate = canonicalWords ? (substitutions + deletions + insertions) / canonicalWords : (transcriptWords ? 1 : 0);
  const matchedWords = diff.operations.filter((op) => op.type === 'equal').length;
  return freeze({
    canonicalWords,
    transcriptWords,
    matchedWords,
    substitutions,
    deletions,
    insertions,
    distance: diff.distance,
    wordErrorRate: Number(wordErrorRate.toFixed(6)),
    exact: substitutions === 0 && deletions === 0 && insertions === 0,
    missingExamples: collectExamples(diff.operations, 'delete'),
    substitutionExamples: collectExamples(diff.operations, 'substitute'),
    extraExamples: collectExamples(diff.operations, 'insert'),
    operations: diff.operations
  });
}

export function findAdjacentDuplicates(text, { maxPhraseWords = 5 } = {}) {
  const tokens = tokenizeWords(text);
  const output = [];
  const seen = new Set();
  for (let size = Math.min(maxPhraseWords, Math.floor(tokens.length / 2)); size >= 1; size -= 1) {
    for (let i = 0; i + (size * 2) <= tokens.length; i += 1) {
      const left = tokens.slice(i, i + size).map((t) => t.norm).join(' ');
      const right = tokens.slice(i + size, i + (size * 2)).map((t) => t.norm).join(' ');
      if (left !== right) continue;
      const key = `${i}:${size}:${left}`;
      if (seen.has(key)) continue;
      seen.add(key);
      output.push(freeze({ startWord: i, phraseWords: size, phrase: tokens.slice(i, i + size).map((t) => t.raw).join(' ') }));
      i += size - 1;
    }
  }
  return freeze(output.sort((a, b) => a.startWord - b.startWord || b.phraseWords - a.phraseWords));
}

function containsPhrase(text, phrase) {
  const haystack = tokenizeWords(text).map((t) => t.norm).join(' ');
  const needle = tokenizeWords(phrase).map((t) => t.norm).join(' ');
  if (!needle) return false;
  return (` ${haystack} `).includes(` ${needle} `);
}

export function pronunciationRisks(canonicalText, transcriptText, pronunciations = []) {
  const risks = [];
  for (const item of pronunciations ?? []) {
    const term = String(item?.term ?? '').trim();
    if (!term || !containsPhrase(canonicalText, term)) continue;
    const termRecognized = containsPhrase(transcriptText, term);
    const spokenAsRecognized = item?.spokenAs ? containsPhrase(transcriptText, item.spokenAs) : false;
    if (termRecognized || spokenAsRecognized) continue;
    risks.push(freeze({
      term,
      spokenAs: item?.spokenAs ?? null,
      notation: item?.notation ?? null,
      language: item?.language ?? null,
      reason: 'expected pronunciation term was not recognized in unbiased QA transcript'
    }));
  }
  return freeze(risks);
}

export function alignmentAnomalies(alignment, {
  maxWordLoss = 1.25,
  maxAverageLoss = 1.0,
  maxGapMs = 2200,
  minWordDurationMs = 20,
  maxWordDurationMs = 3500
} = {}) {
  const words = Array.isArray(alignment?.words) ? alignment.words : [];
  const findings = [];
  const averageLoss = Number(alignment?.loss);
  if (Number.isFinite(averageLoss) && averageLoss > maxAverageLoss) {
    findings.push(freeze({ type: 'alignment-average-loss', severity: 'high', value: averageLoss, threshold: maxAverageLoss }));
  }
  let previousEnd = null;
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    const startMs = Number(word.start) * 1000;
    const endMs = Number(word.end) * 1000;
    const loss = Number(word.loss);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
      findings.push(freeze({ type: 'alignment-invalid-time', severity: 'high', index, text: word.text ?? null }));
      continue;
    }
    const duration = endMs - startMs;
    if (duration < minWordDurationMs || duration > maxWordDurationMs) {
      findings.push(freeze({ type: 'word-duration-anomaly', severity: 'medium', index, text: word.text ?? null, durationMs: Math.round(duration) }));
    }
    if (previousEnd !== null) {
      const gap = startMs - previousEnd;
      if (gap < -40) findings.push(freeze({ type: 'alignment-overlap', severity: 'medium', index, text: word.text ?? null, overlapMs: Math.round(Math.abs(gap)) }));
      if (gap > maxGapMs) findings.push(freeze({ type: 'long-silence', severity: 'low', index, text: word.text ?? null, gapMs: Math.round(gap) }));
    }
    if (Number.isFinite(loss) && loss > maxWordLoss) {
      findings.push(freeze({ type: 'word-alignment-loss', severity: 'medium', index, text: word.text ?? null, value: loss, threshold: maxWordLoss }));
    }
    previousEnd = endMs;
  }
  return freeze(findings);
}

export function transcriptConfidenceFindings(transcription, { minLanguageProbability = 0.75, minWordLogprob = -1.2 } = {}) {
  const findings = [];
  const languageProbability = Number(transcription?.language_probability);
  if (Number.isFinite(languageProbability) && languageProbability < minLanguageProbability) {
    findings.push(freeze({ type: 'low-language-confidence', severity: 'medium', value: languageProbability, threshold: minLanguageProbability }));
  }
  for (const [index, word] of (transcription?.words ?? []).entries()) {
    if (word?.type && word.type !== 'word') continue;
    const logprob = Number(word?.logprob);
    if (Number.isFinite(logprob) && logprob < minWordLogprob) {
      findings.push(freeze({ type: 'low-transcription-confidence', severity: 'low', index, text: word.text ?? null, value: logprob, threshold: minWordLogprob }));
    }
  }
  return freeze(findings);
}
