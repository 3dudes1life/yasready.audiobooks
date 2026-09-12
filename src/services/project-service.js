import { createProject } from '../domain/model.js';
import { transitionProject } from '../domain/state-machine.js';

export class ProjectService {
  constructor(store) {
    this.store = store;
  }

  create(input, options) {
    return this.store.put(createProject(input, options));
  }

  transition(projectId, to, options) {
    return this.store.update('project', projectId, (project) => transitionProject(project, to, options));
  }

  lock(projectId, { clock = () => new Date() } = {}) {
    return this.store.update('project', projectId, (project) => Object.freeze({
      ...project,
      locked: true,
      updatedAt: clock().toISOString()
    }));
  }

  unlock(projectId, { reason, clock = () => new Date() } = {}) {
    if (!reason?.trim()) throw new Error('unlock requires a reason');
    return this.store.update('project', projectId, (project) => Object.freeze({
      ...project,
      locked: false,
      unlockReason: reason,
      updatedAt: clock().toISOString()
    }));
  }
}
