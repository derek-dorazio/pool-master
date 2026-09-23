/**
 * EventBus — in-process pub/sub for domain events.
 *
 * Current implementation: synchronous in-memory dispatch.
 * Keep this unless a real deployment topology requires external fan-out.
 */

export type EventHandler<T = unknown> = (event: T) => Promise<void>;

export class EventBus {
  // The registry is heterogeneous: one map holds handlers for every event type, and
  // TypeScript cannot express "the handlers under key K take K's event type" without a
  // mapped registry type this bus deliberately does not have. `unknown` rejects storing
  // an EventHandler<SpecificEvent>; `never` stores fine by contravariance but then
  // `h(event)` at line 21 fails to accept T. Both were tried. `any` is the type erasure
  // at the pub/sub boundary, contained to these two declarations.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handlers: Map<string, EventHandler<any>[]> = new Map();

  subscribe<T>(eventType: string, handler: EventHandler<T>): void {
    const existing = this.handlers.get(eventType) ?? [];
    existing.push(handler);
    this.handlers.set(eventType, existing);
  }

  async publish<T>(eventType: string, event: T): Promise<void> {
    const handlers = this.handlers.get(eventType) ?? [];
    await Promise.all(handlers.map((h) => h(event)));
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see the registry above
  unsubscribe(eventType: string, handler: EventHandler<any>): void {
    const existing = this.handlers.get(eventType);
    if (!existing) return;
    const filtered = existing.filter((h) => h !== handler);
    this.handlers.set(eventType, filtered);
  }

  /** Remove all handlers — useful for testing. */
  clear(): void {
    this.handlers.clear();
  }
}

export const eventBus = new EventBus();
