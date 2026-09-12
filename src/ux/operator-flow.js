const freeze = (value) => Object.freeze(value);

const STAGES = Object.freeze([
  ['manuscript', 'Manuscript', 'Import and analyze the manuscript'],
  ['audio-bible', 'Audio Bible', 'Resolve characters and pronunciations'],
  ['casting', 'Casting Room', 'Choose and lock narrator/character voices'],
  ['director', 'Audiobook Director', 'Approve and lock performance direction'],
  ['production', 'Production Engine', 'Render the audiobook'],
  ['review', 'Review Studio', 'Listen, choose takes and approve chapters'],
  ['qa', 'Continuity + QA', 'Clear transcript, timing and pronunciation findings'],
  ['mastering', 'Mastering Lab', 'Create and verify final audio masters'],
  ['distribution', 'Distribution Brain', 'Package and hand off the finished audiobook']
]);

function any(store, type, predicate = null) { return store.list(type, predicate).length > 0; }
function rows(store, type, predicate = null) { return store.list(type, predicate); }

function moneySafety(store, projectId) {
  const guards = rows(store, 'money_guard', (row) => row.projectId === projectId && row.status !== 'closed');
  const guard = guards.at(-1) ?? null;
  if (!guard) {
    return freeze({ configured: false, status: 'not-configured', acceptingPaidAuthorizations: false, nextAction: 'Create a Money Guard before any paid audition, QA, or production call.' });
  }
  const authorizations = rows(store, 'money_authorization', (row) => row.guardId === guard.id);
  const capturedUsd = Number(authorizations.reduce((sum, row) => sum + Number(row.capturedUsd ?? 0), 0).toFixed(6));
  const reservedUsd = Number(authorizations
    .filter((row) => ['authorized', 'partially_captured'].includes(row.status))
    .reduce((sum, row) => sum + Math.max(0, Number(row.reservedUsd ?? 0) - Number(row.capturedUsd ?? 0)), 0).toFixed(6));
  const hardCapUsd = Number(guard.policy?.hardCapUsd ?? 0);
  return freeze({
    configured: true,
    guardId: guard.id,
    status: guard.status,
    capturedUsd,
    reservedUsd,
    hardCapUsd,
    availableUsd: Number(Math.max(0, hardCapUsd - capturedUsd - reservedUsd).toFixed(6)),
    acceptingPaidAuthorizations: guard.status === 'active' && capturedUsd + reservedUsd < hardCapUsd,
    nextAction: guard.status === 'active' ? 'Money Guard is active.' : `Resolve Money Guard ${guard.status} before another paid provider call.`
  });
}

function seriesSafety(store, projectId) {
  const seriesBible = rows(store, 'audio_bible', (row) => row.projectId === projectId && row.scope === 'series').at(-1) ?? null;
  const series = seriesBible?.seriesId ? store.get('series', seriesBible.seriesId) : null;
  if (!seriesBible) return freeze({ configured: false, status: 'not-configured', coreVoicesLocked: false });
  const characters = rows(store, 'character', (row) => row.bibleId === seriesBible.id);
  const required = characters.filter((row) => ['narrator', 'primary'].includes(row.role));
  const locked = rows(store, 'voice_assignment', (row) => row.projectId === projectId && row.seriesId === seriesBible.seriesId && row.scope === 'series' && row.locked);
  const lockedIds = new Set(locked.map((row) => row.characterId));
  const missing = required.filter((row) => !lockedIds.has(row.id));
  return freeze({
    configured: true,
    seriesId: seriesBible.seriesId,
    title: series?.title ?? null,
    status: missing.length ? 'OPEN_FOR_CASTING' : 'SERIES_CORE_LOCKED',
    requiredVoiceCount: required.length,
    lockedRequiredVoiceCount: required.length - missing.length,
    missingRequiredVoiceCharacterIds: freeze(missing.map((row) => row.id)),
    coreVoicesLocked: required.length > 0 && missing.length === 0
  });
}

export function buildOperatorFlowStatus(store, projectId) {
  if (!store || !projectId) throw new Error('operator flow requires store and projectId');
  const stage = [];
  const book = rows(store, 'book', (x) => x.projectId === projectId)[0] ?? null;
  stage.push({ key: 'manuscript', done: Boolean(book && any(store, 'chapter', (x) => x.projectId === projectId && (!book.id || x.bookId === book.id || x.bookId == null))), detail: book ? 'Manuscript imported' : 'No manuscript imported' });

  const bible = rows(store, 'audio_bible', (x) => x.projectId === projectId && (x.scope ?? 'book') === 'book' && (!book?.id || !x.bookId || x.bookId === book.id))[0]
    ?? rows(store, 'audio_bible', (x) => x.projectId === projectId && (x.scope ?? 'book') === 'book')[0]
    ?? null;
  const characters = bible ? rows(store, 'character', (x) => x.projectId === projectId && x.bibleId === bible.id) : [];
  stage.push({ key: 'audio-bible', done: Boolean(bible && characters.length), detail: bible ? `${characters.length} Audio Bible role(s)` : 'Audio Bible not created' });

  const assignments = rows(store, 'voice_assignment', (x) => x.projectId === projectId && x.locked);
  const requiredCharacters = characters.filter((x) => ['narrator', 'primary'].includes(x.role));
  const lockedCharacterIds = new Set(assignments.map((x) => x.characterId));
  const missingRequiredCast = requiredCharacters.filter((x) => !lockedCharacterIds.has(x.id));
  const castingDone = requiredCharacters.length > 0
    ? missingRequiredCast.length === 0
    : assignments.length > 0;
  stage.push({
    key: 'casting',
    done: castingDone,
    detail: requiredCharacters.length
      ? `${requiredCharacters.length - missingRequiredCast.length}/${requiredCharacters.length} required voice(s) locked`
      : assignments.length ? `${assignments.length} locked voice assignment(s)` : 'No required cast locked',
    missingCount: missingRequiredCast.length
  });

  const director = rows(store, 'director_plan', (x) => x.projectId === projectId && (!book?.id || !x.bookId || x.bookId === book.id)).at(-1) ?? null;
  const directorCues = director ? rows(store, 'director_cue', (x) => x.planId === director.id) : [];
  const lockedDirectorCues = directorCues.filter((row) => row.locked).length;
  stage.push({
    key: 'director',
    done: Boolean(director && director.locked && directorCues.length && lockedDirectorCues === directorCues.length),
    detail: director
      ? `${lockedDirectorCues}/${directorCues.length} cue(s) locked; ${director.locked ? 'plan locked' : 'plan still open'}`
      : 'No director plan'
  });

  const production = rows(store, 'production_plan', (x) => x.projectId === projectId && (!book?.id || !x.bookId || x.bookId === book.id)).at(-1) ?? null;
  const jobs = production ? rows(store, 'production_job', (x) => x.planId === production.id) : [];
  stage.push({ key: 'production', done: Boolean(production && jobs.length && jobs.every((x) => x.status === 'ready')), detail: production ? `${jobs.filter((x) => x.status === 'ready').length}/${jobs.length} renders ready` : 'Production not planned' });

  const review = rows(store, 'review_session', (x) => x.projectId === projectId && (!book?.id || !x.bookId || x.bookId === book.id)).at(-1) ?? null;
  stage.push({ key: 'review', done: Boolean(review?.status === 'approved' && review?.locked), detail: review ? review.status : 'Review not started' });
  const qa = rows(store, 'qa_run', (x) => x.projectId === projectId && (!book?.id || !x.bookId || x.bookId === book.id)).at(-1) ?? null;
  stage.push({ key: 'qa', done: Boolean(qa?.status === 'approved' && qa?.locked), detail: qa ? qa.status : 'QA not started' });
  const mastering = rows(store, 'mastering_plan', (x) => x.projectId === projectId && (!book?.id || !x.bookId || x.bookId === book.id)).at(-1) ?? null;
  stage.push({ key: 'mastering', done: Boolean(mastering?.status === 'mastered' && mastering?.locked), detail: mastering ? mastering.status : 'Mastering not started' });
  const distribution = rows(store, 'distribution_project', (x) => x.projectId === projectId && (!book?.id || !x.bookId || x.bookId === book.id)).at(-1) ?? null;
  const targets = distribution ? rows(store, 'distribution_target', (x) => x.distributionProjectId === distribution.id) : [];
  stage.push({ key: 'distribution', done: Boolean(distribution && targets.length && targets.every((x) => x.status === 'packaged' || x.status === 'exported')), detail: distribution ? `${targets.filter((x) => ['packaged', 'exported'].includes(x.status)).length}/${targets.length} target(s) packaged` : 'Distribution not started' });

  const decorated = STAGES.map(([key, label, action]) => {
    const state = stage.find((x) => x.key === key);
    return freeze({ key, label, status: state?.done ? 'complete' : 'next', detail: state?.detail ?? '', action });
  });
  const firstIncomplete = decorated.findIndex((x) => x.status !== 'complete');
  const normalized = decorated.map((item, index) => freeze({ ...item, status: index < firstIncomplete || firstIncomplete === -1 ? 'complete' : index === firstIncomplete ? 'next' : 'locked' }));
  const current = normalized.find((x) => x.status === 'next') ?? null;
  const moneyGuard = moneySafety(store, projectId);
  const seriesContinuity = seriesSafety(store, projectId);
  const attention = [];
  if (moneyGuard.configured && moneyGuard.status !== 'active') attention.push(`Money Guard is ${moneyGuard.status}.`);
  if (missingRequiredCast.length) attention.push(`${missingRequiredCast.length} required voice lock(s) remain.`);
  if (seriesContinuity.configured && !seriesContinuity.coreVoicesLocked) attention.push(`${seriesContinuity.requiredVoiceCount - seriesContinuity.lockedRequiredVoiceCount} series-core voice lock(s) remain.`);
  return freeze({
    projectId,
    complete: !current,
    currentStage: current?.key ?? 'complete',
    nextAction: current?.action ?? 'Audiobook workflow complete',
    stages: freeze(normalized),
    safety: freeze({ moneyGuard, seriesContinuity }),
    attention: freeze(attention)
  });
}
