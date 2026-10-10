/** Cache en memoria con TTL. Un link corto se resuelve una sola vez. */
export class TtlCache<V> {
  readonly #store = new Map<string, { value: V; expiresAt: number }>();

  constructor(
    private readonly ttlMs = 24 * 60 * 60 * 1000,
    private readonly maxEntries = 5000,
  ) {}

  get(key: string): V | undefined {
    const hit = this.#store.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt < Date.now()) {
      this.#store.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: string, value: V): void {
    if (this.#store.size >= this.maxEntries) {
      const oldest = this.#store.keys().next().value;
      if (oldest !== undefined) this.#store.delete(oldest);
    }
    this.#store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  delete(key: string): void {
    this.#store.delete(key);
  }

  clear(): void {
    this.#store.clear();
  }
}
