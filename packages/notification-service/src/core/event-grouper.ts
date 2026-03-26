/**
 * EventGrouper — collapses high-frequency notification events into summaries.
 *
 * Instead of 20 "position changed" notifications, produces one grouped:
 * "Your position changed 5 times during Round 2"
 */

export interface GroupableEvent {
  id: string;
  type: string;
  userId: string;
  data: Record<string, unknown>;
  timestamp: Date;
}

export interface GroupedNotification {
  userId: string;
  eventType: string;
  count: number;
  latestData: Record<string, unknown>;
  title: string;
  body: string;
  groupKey: string;
}

/** Event types that should be grouped/collapsed. */
const GROUPABLE_EVENTS: Record<string, { windowMs: number; titleTemplate: string; bodyTemplate: string }> = {
  'scoring.position_change': {
    windowMs: 15 * 60_000,
    titleTemplate: 'Position changes — {{contest_name}}',
    bodyTemplate: 'Your position changed {{count}} times. Current: #{{position}}',
  },
  'draft.pick_made': {
    windowMs: 5 * 60_000,
    titleTemplate: 'Draft picks — {{contest_name}}',
    bodyTemplate: '{{count}} picks made in {{contest_name}}',
  },
  'social.reaction_to_your_post': {
    windowMs: 60 * 60_000,
    titleTemplate: 'Reactions on your post',
    bodyTemplate: '{{count}} people reacted to your post',
  },
};

export class EventGrouper {
  private readonly buffer = new Map<string, GroupableEvent[]>();

  /** Returns true if this event type should be grouped rather than sent immediately. */
  isGroupable(eventType: string): boolean {
    return eventType in GROUPABLE_EVENTS;
  }

  /** Adds an event to the grouping buffer. Returns a grouped notification if the window has closed. */
  add(event: GroupableEvent): GroupedNotification | null {
    const config = GROUPABLE_EVENTS[event.type];
    if (!config) return null;

    const key = `${event.userId}:${event.type}`;
    const existing = this.buffer.get(key) ?? [];
    existing.push(event);
    this.buffer.set(key, existing);

    // Check if the window has closed (oldest event is older than windowMs)
    const oldest = existing[0];
    if (Date.now() - oldest.timestamp.getTime() >= config.windowMs) {
      return this.flush(key);
    }

    return null;
  }

  /** Force-flushes all pending grouped events for a user. */
  flushUser(userId: string): GroupedNotification[] {
    const results: GroupedNotification[] = [];
    for (const [key] of this.buffer) {
      if (key.startsWith(`${userId}:`)) {
        const grouped = this.flush(key);
        if (grouped) results.push(grouped);
      }
    }
    return results;
  }

  /** Flushes all expired windows. Call periodically (e.g., every 30s). */
  flushExpired(): GroupedNotification[] {
    const results: GroupedNotification[] = [];
    const now = Date.now();

    for (const [key, events] of this.buffer) {
      if (events.length === 0) continue;
      const eventType = events[0].type;
      const config = GROUPABLE_EVENTS[eventType];
      if (!config) continue;

      const oldest = events[0];
      if (now - oldest.timestamp.getTime() >= config.windowMs) {
        const grouped = this.flush(key);
        if (grouped) results.push(grouped);
      }
    }

    return results;
  }

  private flush(key: string): GroupedNotification | null {
    const events = this.buffer.get(key);
    if (!events || events.length === 0) {
      this.buffer.delete(key);
      return null;
    }

    const latest = events[events.length - 1];
    const config = GROUPABLE_EVENTS[latest.type];
    if (!config) {
      this.buffer.delete(key);
      return null;
    }

    const data = { ...latest.data, count: events.length };
    const title = renderSimple(config.titleTemplate, data);
    const body = renderSimple(config.bodyTemplate, data);

    this.buffer.delete(key);

    return {
      userId: latest.userId,
      eventType: latest.type,
      count: events.length,
      latestData: latest.data,
      title,
      body,
      groupKey: key,
    };
  }
}

function renderSimple(template: string, data: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    return data[key] !== undefined ? String(data[key]) : '';
  });
}
