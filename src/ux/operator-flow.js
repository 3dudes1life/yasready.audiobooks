const freeze = (value) => Object.freeze(value);

const STAGES = Object.freeze([
  ['manuscript', 'Manuscript', 'Import and analyze the manuscript'],
  ['audio-bible', 'Audio Bible', 'Resolve characters and pronunciations'],
  ['casting', 'Casting Room', 'Choose and lock narrator/character voices'],
  ['director', 'Audiobook Director', 'Approve performance direction'],
  ['production', 'Production Engine', 'Render the audiobook'],
  ['review', 'Review Studio', 'Listen, choose takes and approve chapters'],
  ['qa', 'Continuity + QA', 'Clear transcript, timing and pronunciation findings'],
  ['mastering', 'Mastering Lab', 'Create and verify final audio masters'],
  ['distribution', 'Distribution Brain', 'Package and hand off the finished audiobook']
]);

function any(store, type, predicate = null) { return store.list(type, predicate).length > 0; }
function rows(store, type, predicate = null) { return store.list(type, predicate); }

export function buildOperatorFlowStatus(store, projectId) {
  if (!store || !projectId) throw new Error('operator flow requires store and projectId');
  const stage = [];
  const book = rows(store, 'book', (x) => x.projectId === projectId)[0] ?? null;
  stage.push({ key: 'manuscript', done: Boolean(book && any(store, 'chapter', (x) => x.projectId === projectId)), detail: book ? 'Manuscript imported' : 'No manuscript imported' });
  const bible = rows(store, 'audio_bible', (x) => x.projectId === projectId)[0] ?? null;
  stage.push({ key: 'audio-bible', done: Boolean(bible && any(store, 'character', (x) => x.projectId === projectId)), detail: bible ? 'Audio Bible created' : 'Audio Bible not created' });
  const assignments = rows(store, 'voice_assignment', (x) => x.projectId === projectId);
  stage.push({ key: 'casting', done: assignments.length > 0 && assignments.every((x) => x.locked), detail: assignments.length ? `${assignments.length} voice assignment(s)` : 'No locked cast' });
  const director = rows(store, 'director_plan', (x) => x.projectId === projectId)[0] ?? null;
  stage.push({ key: 'director', done: Boolean(director && any(store, 'director_cue', (x) => x.projectId === projectId)), detail: director ? director.status ?? 'Director plan exists' : 'No director plan' });
  const production = rows(store, 'production_plan', (x) => x.projectId === projectId).at(-1) ?? null;
  const jobs = production ? rows(store, 'production_job', (x) => x.planId === production.id) : [];
  stage.push({ key: 'production', done: Boolean(production && jobs.length && jobs.every((x) => x.status === 'ready')), detail: production ? `${jobs.filter((x) => x.status === 'ready').length}/${jobs.length} renders ready` : 'Production not planned' });
  const review = rows(store, 'review_session', (x) => x.projectId === projectId).at(-1) ?? null;
  stage.push({ key: 'review', done: Boolean(review?.status === 'approved' && review?.locked), detail: review ? review.status : 'Review not started' });
  const qa = rows(store, 'qa_run', (x) => x.projectId === projectId).at(-1) ?? null;
  stage.push({ key: 'qa', done: Boolean(qa?.status === 'approved' && qa?.locked), detail: qa ? qa.status : 'QA not started' });
  const mastering = rows(store, 'mastering_plan', (x) => x.projectId === projectId).at(-1) ?? null;
  stage.push({ key: 'mastering', done: Boolean(mastering?.status === 'mastered' && mastering?.locked), detail: mastering ? mastering.status : 'Mastering not started' });
  const distribution = rows(store, 'distribution_project', (x) => x.projectId === projectId).at(-1) ?? null;
  const targets = distribution ? rows(store, 'distribution_target', (x) => x.distributionProjectId === distribution.id) : [];
  stage.push({ key: 'distribution', done: Boolean(distribution && targets.length && targets.every((x) => x.status === 'packaged' || x.status === 'exported')), detail: distribution ? `${targets.filter((x) => ['packaged', 'exported'].includes(x.status)).length}/${targets.length} target(s) packaged` : 'Distribution not started' });

  const decorated = STAGES.map(([key, label, action]) => {
    const state = stage.find((x) => x.key === key);
    return freeze({ key, label, status: state?.done ? 'complete' : 'next', detail: state?.detail ?? '', action });
  });
  const firstIncomplete = decorated.findIndex((x) => x.status !== 'complete');
  const normalized = decorated.map((item, index) => freeze({ ...item, status: index < firstIncomplete || firstIncomplete === -1 ? 'complete' : index === firstIncomplete ? 'next' : 'locked' }));
  const current = normalized.find((x) => x.status === 'next') ?? null;
  return freeze({ projectId, complete: !current, currentStage: current?.key ?? 'complete', nextAction: current?.action ?? 'Audiobook workflow complete', stages: freeze(normalized) });
}
