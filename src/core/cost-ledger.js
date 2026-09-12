import { randomUUID } from 'node:crypto';

export class CostLedger {
  #events = [];

  record({ projectId, provider, operation, amountUsd, units = null, unitType = null, metadata = {} }, { clock = () => new Date() } = {}) {
    if (!projectId) throw new Error('cost event requires projectId');
    if (!provider) throw new Error('cost event requires provider');
    if (!operation) throw new Error('cost event requires operation');
    if (!Number.isFinite(amountUsd) || amountUsd < 0) throw new Error('amountUsd must be a non-negative number');

    const event = Object.freeze({
      id: randomUUID(),
      type: 'cost_event',
      projectId,
      provider,
      operation,
      amountUsd,
      units,
      unitType,
      metadata: Object.freeze({ ...metadata }),
      createdAt: clock().toISOString()
    });
    this.#events.push(event);
    return event;
  }

  list(projectId = null) {
    const events = projectId ? this.#events.filter((event) => event.projectId === projectId) : this.#events;
    return events.slice();
  }

  total(projectId = null) {
    return Number(this.list(projectId).reduce((sum, event) => sum + event.amountUsd, 0).toFixed(6));
  }
}
