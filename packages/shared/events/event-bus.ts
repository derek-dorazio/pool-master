/**
 * EventBus — in-process pub/sub for domain events.
 *
 * v1 implementation: synchronous in-memory dispatch.
 * Will be replaced with Redis Streams or SQS in production.
 */

export type EventHandler<T = unknown> = (event: T) => Promise<void>;

export class EventBus {
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
