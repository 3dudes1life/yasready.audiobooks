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

  createPlan({ projectId, bookId, bibleId = null, stylePreset = 'premium-natural', defaultRestraint = 0.72, notes = null }) {
    const plan = createDirectorPlan({ projectId, bookId, bibleId, stylePreset, defaultRestraint, notes }, { clock: this.clock });
    return this.store.put(plan);
  }

  getPlan(id) {
    const plan = this.store.get('director_plan', id);
    if (!plan) throw new Error(`director_plan ${id} not found`);
    return plan;
  }

  lockPlan(id) {
    return this.store.update('director_plan', id, current => freezeRecord({ ...current, locked: true, updatedAt: nowIso(this.clock) }));
  }

  unlockPlan(id, { reason }) {
    if (!String(reason ?? '').trim()) throw new Error('unlocking director plan requires a reason');
    return this.store.update('director_plan', id, current => freezeRecord({
      ...current, locked: false, revision: (current.revision ?? 1) + 1,
      lastUnlockReason: reason, updatedAt: nowIso(this.clock)
    }));
  }

  async directScene({ planId, sceneId, chapterId, segments, characterProfiles = new Map(), sceneContext = {} }) {
    const plan = this.getPlan(planId);
    if (plan.locked) throw new Error('director plan is locked');
    if (!Array.isArray(segments) || !segments.length) throw new Error('directScene requires segments');

    for (const segment of segments) {
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
    for (let i = 0; i < segments.length; i += 1) {
      const segment = segments[i];
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
    const updatedScene = this.store.update('director_scene', directedScene.id, current => freezeRecord({
      ...current, emotionalArc: arc, cueCount: cues.length, updatedAt: nowIso(this.clock)
    }));
    return { scene: updatedScene, cues: Object.freeze(cues) };
  }

  reviseCue(cueId, patch, { reason }) {
    if (!String(reason ?? '').trim()) throw new Error('director cue revision requires a reason');
    return this.store.update('director_cue', cueId, current => {
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
    return this.store.update('director_cue', cueId, current => freezeRecord({ ...current, locked: true, updatedAt: nowIso(this.clock) }));
  }

  unlockCue(cueId, { reason }) {
    if (!String(reason ?? '').trim()) throw new Error('unlocking director cue requires a reason');
    return this.store.update('director_cue', cueId, current => freezeRecord({
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
    const cues = this.store.list('director_cue', cue => cue.directorSceneId === directorSceneId)
      .sort((a, b) => a.order - b.order);
    return Object.freeze({ scene, cues: Object.freeze(cues), emotionalArc: scene.emotionalArc, cueCount: cues.length });
  }
}

export function summarizeArc(emotions = []) {
  const meaningful = emotions.filter(e => e && e !== 'neutral');
  if (!meaningful.length) return Object.freeze({ opening: 'neutral', peak: 'neutral', closing: 'neutral', shifts: 0 });
  let shifts = 0;
  for (let i = 1; i < meaningful.length; i += 1) if (meaningful[i] !== meaningful[i - 1]) shifts += 1;
  const counts = new Map();
  for (const e of meaningful) counts.set(e, (counts.get(e) ?? 0) + 1);
  const peak = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  return Object.freeze({ opening: meaningful[0], peak, closing: meaningful.at(-1), shifts });
}
