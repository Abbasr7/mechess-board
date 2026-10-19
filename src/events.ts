/** Minimal typed event emitter. */
export class Emitter<Events extends Record<string, unknown>> {
  private handlers = new Map<keyof Events, Set<(payload: never) => void>>();

  on<K extends keyof Events>(type: K, handler: (payload: Events[K]) => void): () => void {
    let set = this.handlers.get(type);
    if (!set) this.handlers.set(type, (set = new Set()));
    set.add(handler as (payload: never) => void);
    return () => this.off(type, handler);
  }

  once<K extends keyof Events>(type: K, handler: (payload: Events[K]) => void): () => void {
    const off = this.on(type, (p) => {
      off();
      handler(p);
    });
    return off;
  }

  off<K extends keyof Events>(type: K, handler: (payload: Events[K]) => void): void {
    this.handlers.get(type)?.delete(handler as (payload: never) => void);
  }

  emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const h of [...set]) (h as (p: Events[K]) => void)(payload);
  }

  clear(): void {
    this.handlers.clear();
  }
}
