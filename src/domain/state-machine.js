export const ProjectStates = Object.freeze([
  'draft', 'analyzed', 'cast', 'directed', 'production', 'review', 'mastering', 'ready', 'archived'
]);

const transitions = Object.freeze({
  draft: ['analyzed', 'archived'],
  analyzed: ['cast', 'draft', 'archived'],
  cast: ['directed', 'analyzed', 'archived'],
  directed: ['production', 'cast', 'archived'],
  production: ['review', 'directed', 'archived'],
  review: ['mastering', 'production', 'archived'],
  mastering: ['ready', 'review', 'archived'],
  ready: ['review', 'archived'],
  archived: []
});

export function canTransition(from, to) {
  return Boolean(transitions[from]?.includes(to));
}

export function transitionProject(project, to, { clock = () => new Date() } = {}) {
  if (!ProjectStates.includes(to)) throw new Error(`unknown project state: ${to}`);
  if (!canTransition(project.status, to)) {
    throw new Error(`invalid project transition: ${project.status} -> ${to}`);
  }
  return Object.freeze({ ...project, status: to, updatedAt: clock().toISOString() });
}
