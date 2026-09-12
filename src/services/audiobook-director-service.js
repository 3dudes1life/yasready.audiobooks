import { randomUUID } from 'node:crypto';
import { inferPerformanceDirection, normalizeDirection, compileElevenV3RenderText, buildPerformanceBrief } from '../director/performance-profile.js';
import { createDirectorPlan, createDirectorScene, createDirectorCue, nowIso } from '../domain/model.js';

function freezeRecord(record) { return Object.freeze({ ...record }); }

export class AudiobookDirectorService {
  constructor(store, { clock = () => new Date(), analysisAdapter = null } = {}) {
    if (!store) throw new Error('AudiobookDirectorService requires a store');
    this.store = store;
    this.clock = clock;
    this.analysisAdapter = analysisAdapter;
  }

  #assertPlanOwnership({ projectId, bookId, bibleId = null }) {
    const project = this.store.get('project', projectId);
    const book = this.store.get('book', bookId);
    // Synthetic unit fixtures historically use opaque ids. Once a real project/book exists,
    // ownership becomes mandatory and cross-project references fail closed.
    if (project && !book) throw new Error('Audiobook Director requires a book belonging to the project');
    if (book && book.projectId !== projectId) throw new Error('Audiobook Director book belongs to another project');
    if (bibleId) {
      const bible = this.store.get('audio_bible', bibleId);
      if (project && !bible) throw new Error('Audiobook Director Audio Bible was not found');
      if (bible && bible.projectId !== projectId) throw new Error('Audiobook Director Audio Bible belongs to another project');
      if (bible?.scope === 'book' && bible.bookId && bible.bookId !== bookId) throw new Error('Audiobook Director Audio Bible belongs to another book');
    }
    return { project, book };
  }

  #canonicalSceneInputs(plan, { sceneId, chapterId, segments }) {
    const book = this.store.get('book', plan.bookId);
    if (!book) return segments;

    const chapter = this.store.get('chapter', chapterId);
    if (!chapter || chapter.projectId !== plan.projectId || chapter.bookId !== plan.bookId) {
      throw new Error('Audiobook Director chapter belongs to another project/book or was not found');
    }
    const scene = this.store.get('scene', sceneId);
    if (!scene || scene.projectId !== plan.projectId || scene.bookId !== plan.bookId || scene.chapterId !== chapterId) {
      throw new Error('Audiobook Director scene belongs to another project/book/chapter or was not found');
    }

    return segments.map((input) => {
      const stored = input?.id ? this.store.get('segment', input.id) : null;
      if (!stored) throw new Error(`Audiobook Director segment ${input?.id ?? '?'} was not found in the canonical manuscript`);
      if (stored.projectId !== plan.projectId || stored.bookId !== plan.bookId || stored.chapterId !== chapterId || stored.sceneId !== sceneId) {
        throw new Error(`Audiobook Director segment ${stored.id} belongs to another project/book/chapter/scene`);
      }
      if (String(input.text ?? '') !== String(stored.text ?? '')) {
        throw new Error(`Audiobook Director segment ${stored.id} text does not match the canonical manuscript`);
      }
      if (stored.characterId) {
        const character = this.store.get('character', stored.characterId);
        if (!character || character.projectId !== plan.projectId) {
          throw new Error(`Audiobook Director character binding for segment ${stored.id} belongs to another project or is missing`);
        }
      }
      return stored;
    });
  }

  createPlan({ projectId, bookId, bibleId = null, stylePreset = 'premium-natural', defaultRestraint = 0.72, notes = null }) {
    this.#assertPlanOwnership({ projectId, bookId, bibleId });
    const plan = createDirectorPlan({ projectId, bookId, bibleId, stylePreset, defaultRestraint, notes }, { clock: this.clock });
    return this.store.put(plan);
  }

  getPlan(id) {
    const plan = this.store.get('director_plan', id);
    if (!plan) throw new Error(`director_plan ${id} not found`);
    return plan;
  }

  lockPlan(id) {
    const plan = this.getPlan(id);
    if (plan.locked) return plan;
    const cues = this.store.list('director_cue', (row) => row.planId === id);
    if (!cues.length) throw new Error('director plan cannot lock without directed cues');
    const stamp = nowIso(this.clock);
    for (const cue of cues) {
      this.store.update('director_cue', cue.id, (current) => freezeRecord({ ...current, locked: true, lockedByPlan: true, updatedAt: stamp }));
    }
    for (const scene of this.store.list('director_scene', (row) => row.planId === id)) {
      this.store.update('director_scene', scene.id, (current) => freezeRecord({ ...current, locked: true, lockedByPlan: true, updatedAt: stamp }));
    }
    return this.store.update('director_plan', id, (current) => freezeRecord({ ...current, locked: true, lockedAt: stamp, updatedAt: stamp }));
  }

  unlockPlan(id, { reason }) {
    if (!String(reason ?? '').trim()) throw new Error('unlocking director plan requires a reason');
    const plan = this.getPlan(id);
    const nextRevision = (plan.revision ?? 1) + 1;
    const stamp = nowIso(this.clock);
    for (const cue of this.store.list('director_cue', (row) => row.planId === id)) {
      this.store.update('director_cue', cue.id, (current) => freezeRecord({
        ...current, locked: false, lockedByPlan: false, planRevision: nextRevision,
        lastPlanUnlockReason: reason, updatedAt: stamp
      }));
    }
    for (const scene of this.store.list('director_scene', (row) => row.planId === id)) {
      this.store.update('director_scene', scene.id, (current) => freezeRecord({
        ...current, locked: false, lockedByPlan: false, lastPlanUnlockReason: reason, updatedAt: stamp
      }));
    }
    return this.store.update('director_plan', id, (current) => freezeRecord({
      ...current, locked: false, revision: nextRevision,
      lastUnlockReason: reason, unlockedAt: stamp, updatedAt: stamp
    }));
  }

  async directScene({ planId, sceneId, chapterId, segments, characterProfiles = new Map(), sceneContext = {} }) {
    const plan = this.getPlan(planId);
    if (plan.locked) throw new Error('director plan is locked');
    if (!Array.isArray(segments) || !segments.length) throw new Error('directScene requires segments');
    const canonicalSegments = this.#canonicalSceneInputs(plan, { sceneId, chapterId, segments });

    for (const segment of canonicalSegments) {
      if (segment.kind === 'dialogue' && !segment.characterId) {
        throw new Error(`dialogue segment ${segment.id ?? segment.order ?? '?'} has no canonical character binding`);
      }
    }

    const directedScene = this.store.put(createDirectorScene({
      projectId: plan.projectId, planId, bookId: plan.bookId, chapterId, sceneId,
      order: sceneContext.order ?? 0, emotionalArc: null
    }, { clock: this.clock }));

    const cues = [];
    const emotions = [];
    for (let i = 0; i < canonicalSegments.length; i += 1) {
      const segment = canonicalSegments[i];
      const characterProfile = segment.characterId ? (characterProfiles.get?.(segment.characterId) ?? {}) : {};
      const base = inferPerformanceDirection({
        text: segment.text,
        kind: segment.kind,
        characterProfile,
        context: { defaultRestraint: plan.defaultRestraint, sceneOpening: i === 0, ...sceneContext }
      });
      let direction = base;
      if (this.analysisAdapter) {
        const proposed = await this.analysisAdapter({ plan, scene: directedScene, segment, baseDirection: base, characterProfile, sceneContext });
        if (proposed) direction = normalizeDirection({ ...base, ...proposed, source: proposed.source ?? 'analysis-adapter' });
      }
      emotions.push(direction.emotion);
      const cue = createDirectorCue({
        projectId: plan.projectId, planId, directorSceneId: directedScene.id,
        sceneId, segmentId: segment.id, characterId: segment.characterId ?? null,
        order: segment.order ?? i, canonicalText: segment.text, direction,
        performanceBrief: buildPerformanceBrief(direction)
      }, { clock: this.clock });
      cues.push(this.store.put(cue));
    }

    const arc = summarizeArc(emotions);
    const updatedScene = this.store.update('director_scene', directedScene.id, (current) => freezeRecord({
      ...current, emotionalArc: arc, cueCount: cues.length, updatedAt: nowIso(this.clock)
    }));
    return { scene: updatedScene, cues: Object.freeze(cues) };
  }

  reviseCue(cueId, patch, { reason }) {
    if (!String(reason ?? '').trim()) throw new Error('director cue revision requires a reason');
    return this.store.update('director_cue', cueId, (current) => {
      const plan = this.getPlan(current.planId);
      if (plan.locked) throw new Error('director plan is locked; unlock the plan before revising cues');
      if (current.locked) throw new Error('director cue is locked');
      if (patch.canonicalText !== undefined && patch.canonicalText !== current.canonicalText) {
        throw new Error('director revisions cannot alter canonical manuscript text');
      }
      const direction = patch.direction ? normalizeDirection({ ...current.direction, ...patch.direction, source: 'manual-revision' }) : current.direction;
      return freezeRecord({
        ...current,
        direction,
        performanceBrief: buildPerformanceBrief(direction),
        revision: (current.revision ?? 1) + 1,
        lastRevisionReason: reason,
        updatedAt: nowIso(this.clock)
      });
    });
  }

  lockCue(cueId) {
    return this.store.update('director_cue', cueId, (current) => freezeRecord({ ...current, locked: true, updatedAt: nowIso(this.clock) }));
  }

  unlockCue(cueId, { reason }) {
    if (!String(reason ?? '').trim()) throw new Error('unlocking director cue requires a reason');
    const cue = this.store.get('director_cue', cueId);
    if (!cue) throw new Error(`director_cue ${cueId} not found`);
    if (this.getPlan(cue.planId).locked) throw new Error('director plan is locked; unlock the plan before unlocking a cue');
    return this.store.update('director_cue', cueId, (current) => freezeRecord({
      ...current, locked: false, revision: (current.revision ?? 1) + 1,
      lastUnlockReason: reason, updatedAt: nowIso(this.clock)
    }));
  }

  compileCue(cueId, { provider = 'neutral', model = null } = {}) {
    const cue = this.store.get('director_cue', cueId);
    if (!cue) throw new Error(`director_cue ${cueId} not found`);
    let renderText = cue.canonicalText;
    if (provider === 'elevenlabs' && model === 'eleven_v3') {
      renderText = compileElevenV3RenderText(cue.canonicalText, cue.direction);
    }
    return Object.freeze({
      id: randomUUID(), cueId, provider, model,
      canonicalText: cue.canonicalText,
      renderText,
      direction: cue.direction,
      manuscriptMutated: false
    });
  }

  sceneSummary(directorSceneId) {
    const scene = this.store.get('director_scene', directorSceneId);
    if (!scene) throw new Error(`director_scene ${directorSceneId} not found`);
    const cues = this.store.list('director_cue', (cue) => cue.directorSceneId === directorSceneId)
      .sort((a, b) => a.order - b.order);
    return Object.freeze({ scene, cues: Object.freeze(cues), emotionalArc: scene.emotionalArc, cueCount: cues.length });
  }
}

export function summarizeArc(emotions = []) {
  const meaningful = emotions.filter((e) => e && e !== 'neutral');
  if (!meaningful.length) return Object.freeze({ opening: 'neutral', peak: 'neutral', closing: 'neutral', shifts: 0 });
  let shifts = 0;
  for (let i = 1; i < meaningful.length; i += 1) if (meaningful[i] !== meaningful[i - 1]) shifts += 1;
  const counts = new Map();
  for (const e of meaningful) counts.set(e, (counts.get(e) ?? 0) + 1);
  const peak = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  return Object.freeze({ opening: meaningful[0], peak, closing: meaningful.at(-1), shifts });
}
