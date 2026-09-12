export class InMemoryStore {
  #collections = new Map();

  put(record) {
    if (!record?.id || !record?.type) throw new Error('record requires id and type');
    const collection = this.#collections.get(record.type) ?? new Map();
    collection.set(record.id, Object.freeze({ ...record }));
    this.#collections.set(record.type, collection);
    return collection.get(record.id);
  }

  get(type, id) {
    return this.#collections.get(type)?.get(id) ?? null;
  }

  list(type, predicate = null) {
    const rows = [...(this.#collections.get(type)?.values() ?? [])];
    return predicate ? rows.filter(predicate) : rows;
  }

  update(type, id, updater) {
    const current = this.get(type, id);
    if (!current) throw new Error(`${type} ${id} not found`);
    const next = Object.freeze({ ...updater(current) });
    if (next.id !== id || next.type !== type) throw new Error('cannot change record identity');
    this.#collections.get(type).set(id, next);
    return next;
  }
}
