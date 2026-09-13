import { createHash } from 'node:crypto';
import { YASREADY_AUDIOBOOKS_VERSION } from '../release.js';

const freeze = (value) => Object.freeze(value);
const deepFreeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
};
const clean = (value) => String(value ?? '').trim();

function sha256(value) {
  return createHash('sha256').update(String(value ?? '')).digest('hex');
}

function csvCell(value) {
  const text = Array.isArray(value) ? value.join(' | ') : String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

function assertLockedPrep(prep) {
  if (!prep || typeof prep !== 'object') throw new Error('Casting Launch requires a Book One Audio Bible Prep JSON object');
  if (prep.status !== 'AUDIO_BIBLE_LOCKED') throw new Error('Casting Launch requires AUDIO_BIBLE_LOCKED prep');
  if (!prep.audioBible?.locked || prep.gates?.audioBibleLocked !== true || prep.gates?.productionReady !== true) {
    throw new Error('Casting Launch requires a production-ready locked Audio Bible');
  }
  if (Number(prep.dialogueReview?.needsReview ?? 0) !== 0 || Number(prep.dialogueReview?.unresolved ?? 0) !== 0) {
    throw new Error('Casting Launch refuses unresolved dialogue truth');
  }
  if (Number(prep.pronunciationReview?.needsConfirmation ?? 0) !== 0) {
    throw new Error('Casting Launch refuses unresolved pronunciation truth');
  }
  if (Number(prep.continuity?.unresolvedDialogueSegments ?? 0) !== 0) {
    throw new Error('Casting Launch refuses unresolved continuity truth');
  }
  if (!clean(prep.book?.id) || !clean(prep.book?.sourceHash) || !clean(prep.audioBible?.id) || !clean(prep.audioBible?.digest)) {
    throw new Error('Casting Launch requires book/source-hash/Audio-Bible identity');
  }
  if (!Array.isArray(prep.characterPlan) || prep.characterPlan.length === 0) {
    throw new Error('Casting Launch requires a permanent character plan');
  }
  if (prep.snapshot?.digest && prep.snapshot.digest !== prep.audioBible.digest) {
    throw new Error('Casting Launch Audio Bible snapshot digest does not match locked prep truth');
  }
  return prep;
}

function waveFor(row) {
  if (row.role === 'narrator' || row.role === 'primary') return 1;
  if (row.role === 'supporting') return 2;
  return 3;
}

function rowPriority(row) {
  if (row.role === 'narrator') return 0;
  if (row.role === 'primary') return 1;
  if (row.role === 'supporting') return 2;
  return 3;
}

function targetFromCharacter(row, prep) {
  const wave = waveFor(row);
  const provisional = Boolean(row.provisional || row.castingStatus === 'provisional');
  return freeze({
    canonicalName: row.canonicalName,
    seriesCharacterKey: row.seriesCharacterKey ?? null,
    role: row.role,
    continuityScope: row.continuityScope ?? 'book',
    aliases: freeze([...(row.aliases ?? [])]),
    mentions: Number(row.mentions ?? 0),
    castingPriority: row.castingPriority ?? rowPriority(row),
    wave,
    requiredForProduction: wave === 1,
    requiredBeforeDirector: wave === 1,
    provisionalRole: provisional,
    humanRoleConfirmationRecommended: provisional,
    recommendedLockScope: 'book',
    bookId: prep.book.id,
    audioBibleId: prep.audioBible.id,
    candidateStatus: 'not-started',
    auditionStatus: 'not-armed',
    lockedVoice: null
  });
}

function targetSort(a, b) {
  return a.wave - b.wave ||
    Number(a.castingPriority ?? 99) - Number(b.castingPriority ?? 99) ||
    (a.role === 'narrator' ? -1 : b.role === 'narrator' ? 1 : 0) ||
    b.mentions - a.mentions ||
    a.canonicalName.localeCompare(b.canonicalName);
}

export function renderCastingCandidateCsv(launch) {
  const header = [
    'wave', 'character', 'role', 'mentions', 'provisional_role', 'required_for_production',
    'recommended_lock_scope', 'provider', 'voice_id', 'safety_score', 'candidate_status',
    'audition_status', 'operator_decision', 'notes'
  ];
  const lines = [header.map(csvCell).join(',')];
  for (const row of launch.targets) {
    lines.push([
      row.wave, row.canonicalName, row.role, row.mentions, row.provisionalRole ? 'yes' : 'no',
      row.requiredForProduction ? 'yes' : 'no', row.recommendedLockScope,
      '', '', '', row.candidateStatus, row.auditionStatus, '', ''
    ].map(csvCell).join(','));
  }
  return `${lines.join('\n')}\n`;
}

export function renderCastingLaunchMarkdown(launch) {
  const lines = [
    '# Book One Casting Launch', '',
    `**YasReady Audiobooks:** ${launch.provenance.applicationRelease}`,
    `**Source Audio Bible:** ${launch.source.audioBibleId}`,
    `**Source digest:** ${launch.source.audioBibleDigest}`,
    `**Book:** ${launch.book.title}`,
    `**Status:** ${launch.status}`, '',
    '## Spend state', '',
    '- Provider calls performed: 0',
    '- Paid audition generation armed: NO',
    '- Production generation armed: NO',
    '- Candidate discovery/staging may begin without rendering audio.', '',
    '## Casting waves', ''
  ];
  for (const wave of launch.waves) {
    lines.push(`### Wave ${wave.wave} — ${wave.label}`, '');
    for (const row of wave.targets) {
      const flags = [
        row.requiredForProduction ? 'required' : 'later',
        row.provisionalRole ? 'confirm role' : null
      ].filter(Boolean).join(', ');
      lines.push(`- ${row.canonicalName} — ${row.role}${flags ? ` (${flags})` : ''}`);
    }
    lines.push('');
  }
  lines.push(
    '## Guardrails', '',
    '- Book-scoped locks require this exact Book One `bookId`.',
    '- Do not promote a Book One lock to series scope until Series Continuity supplies a real `seriesId`.',
    '- Series-safety score must be captured before any future series voice lock.',
    '- Audition rendering remains a separate, explicit Money Guard action.',
    '- Scene-local extras are intentionally excluded from permanent casting waves.', '',
    '## Next action', '',
    launch.nextAction, '',
    '> This launch pack performs zero provider calls and never arms paid generation.', ''
  );
  return lines.join('\n');
}

export class CastingLaunchService {
  build(prepInput) {
    const prep = assertLockedPrep(prepInput);
    const targets = prep.characterPlan.map((row) => targetFromCharacter(row, prep)).sort(targetSort);
    const waveLabels = new Map([
      [1, 'Narrator + primary cast'],
      [2, 'Supporting cast'],
      [3, 'Minor + provisional permanent roles']
    ]);
    const waves = [1, 2, 3].map((wave) => {
      const rows = targets.filter((row) => row.wave === wave);
      return freeze({ wave, label: waveLabels.get(wave), targets: freeze(rows) });
    }).filter((wave) => wave.targets.length);

    const required = targets.filter((row) => row.requiredForProduction);
    const sceneLocalExcluded = (prep.sceneLocalRoles ?? []).map((row) => freeze({
      canonicalName: row.canonicalName,
      chapterOrder: row.chapterOrder ?? null,
      mentions: Number(row.mentions ?? 0),
      continuityScope: 'scene',
      castingStatus: 'on-demand'
    }));

    const artifactFingerprint = sha256(JSON.stringify({
      sourceHash: prep.book.sourceHash,
      audioBibleDigest: prep.audioBible.digest,
      targets: targets.map((row) => [row.canonicalName, row.role, row.seriesCharacterKey, row.wave])
    }));

    const sourceProvenance = prep.provenance ?? {
      applicationRelease: prep.release ?? null,
      artifactRelease: prep.release ?? null,
      prepEngineRelease: prep.release ?? null,
      supermanEngineRelease: prep.superman?.engineRelease ?? null,
      sourceHash: prep.book.sourceHash
    };

    const launch = {
      schemaVersion: 1,
      release: YASREADY_AUDIOBOOKS_VERSION,
      status: 'READY_FOR_CANDIDATE_DISCOVERY',
      provenance: freeze({
        application: 'YasReady Audiobooks',
        applicationRelease: YASREADY_AUDIOBOOKS_VERSION,
        artifact: 'casting-launch',
        artifactRelease: YASREADY_AUDIOBOOKS_VERSION,
        sourceArtifactApplicationRelease: sourceProvenance.applicationRelease ?? prep.release ?? null,
        sourcePrepEngineRelease: sourceProvenance.prepEngineRelease ?? null,
        sourceSupermanEngineRelease: sourceProvenance.supermanEngineRelease ?? prep.superman?.engineRelease ?? null
      }),
      book: freeze({
        id: prep.book.id,
        title: prep.book.title,
        author: prep.book.author ?? null,
        sourceHash: prep.book.sourceHash
      }),
      source: freeze({
        audioBibleId: prep.audioBible.id,
        audioBibleDigest: prep.audioBible.digest,
        audioBibleRevision: prep.audioBible.revision ?? null,
        sourcePrepStatus: prep.status,
        sourcePrepRelease: prep.release ?? null
      }),
      targets: freeze(targets),
      waves: freeze(waves),
      requiredBeforeDirector: freeze(required.map((row) => row.canonicalName)),
      sceneLocalExcluded: freeze(sceneLocalExcluded),
      guardrails: freeze({
        candidateDiscoveryAllowed: true,
        auditionPlanningAllowed: true,
        auditionRenderingArmed: false,
        paidGenerationArmed: false,
        productionArmed: false,
        bookScopeOnlyUntilSeriesMaterialized: true,
        exactBookIdRequiredForBookLocks: true,
        seriesSafetyRequiredForSeriesLocks: true
      }),
      providerCallsPerformed: 0,
      artifactFingerprint,
      nextAction: `Discover and stage zero-spend voice candidates for ${required.map((row) => row.canonicalName).join(', ')}. Do not render auditions until the operator explicitly arms an audition plan through Money Guard.`
    };
    return deepFreeze({
      launch,
      markdown: renderCastingLaunchMarkdown(launch),
      candidateCsv: renderCastingCandidateCsv(launch)
    });
  }
}

export function buildCastingLaunchFixture() {
  return {
    schemaVersion: 8,
    release: '0.14.1',
    status: 'AUDIO_BIBLE_LOCKED',
    providerCallsPerformed: 0,
    book: {
      id: 'book-one', title: 'Fixture Book One', author: 'Fixture Author',
      sourceHash: 'fixture-source-hash'
    },
    superman: { status: 'PASS', score: 100, engineRelease: '0.11.3' },
    provenance: {
      applicationRelease: '0.14.1', artifactRelease: '0.14.1',
      prepEngineRelease: '0.11.8', supermanEngineRelease: '0.11.3',
      sourceHash: 'fixture-source-hash'
    },
    audioBible: {
      id: 'bible-one', revision: 9, digest: 'fixture-bible-digest', locked: true,
      lockRelease: '0.14.1', lockEngineRelease: '0.11.8'
    },
    characterPlan: [
      { canonicalName: 'Narrator', aliases: [], role: 'narrator', mentions: 0, castingPriority: 0, seriesCharacterKey: 'narrator', castingStatus: 'unassigned', continuityScope: 'book' },
      { canonicalName: 'Primary A', aliases: ['A'], role: 'primary', mentions: 300, castingPriority: 1, seriesCharacterKey: 'primary-a', castingStatus: 'unassigned', continuityScope: 'book' },
      { canonicalName: 'Primary B', aliases: ['B'], role: 'primary', mentions: 250, castingPriority: 1, seriesCharacterKey: 'primary-b', castingStatus: 'unassigned', continuityScope: 'book' },
      { canonicalName: 'Support', aliases: [], role: 'supporting', mentions: 25, castingPriority: 2, seriesCharacterKey: 'support', castingStatus: 'unassigned', continuityScope: 'book' },
      { canonicalName: 'Landlord', aliases: ['the landlord'], role: 'minor', mentions: 2, castingPriority: 3, seriesCharacterKey: 'landlord', castingStatus: 'provisional', provisional: true, continuityScope: 'book' }
    ],
    sceneLocalRoles: [{ canonicalName: 'Party Guest', mentions: 1, chapterOrder: 4, continuityScope: 'scene' }],
    dialogueReview: { needsReview: 0, unresolved: 0 },
    pronunciationReview: { needsConfirmation: 0 },
    continuity: { unresolvedDialogueSegments: 0 },
    snapshot: { digest: 'fixture-bible-digest' },
    gates: { audioBibleLocked: true, productionReady: true }
  };
}
