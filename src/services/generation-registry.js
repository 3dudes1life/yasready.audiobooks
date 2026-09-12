import { randomUUID } from 'node:crypto';
import { renderFingerprint } from '../core/hash.js';

export class GenerationRegistry {
  #byFingerprint = new Map();

  register(input, { forceFresh = false, clock = () => new Date() } = {}) {
    const fingerprint = renderFingerprint(input);
    const existing = this.#byFingerprint.get(fingerprint);
    if (existing && !forceFresh) {
      return { reused: true, request: existing };
    }

    const request = Object.freeze({
      id: randomUUID(),
      type: 'generation_request',
      fingerprint,
      status: 'planned',
      ...input,
      createdAt: clock().toISOString()
    });

    if (!forceFresh) this.#byFingerprint.set(fingerprint, request);
    return { reused: false, request };
  }

  find(fingerprint) {
    return this.#byFingerprint.get(fingerprint) ?? null;
  }
}
