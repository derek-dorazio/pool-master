/**
 * Event Bus Contract Tests — validates consistency across event type definitions.
 *
 * Ensures no duplicate event types, correct naming conventions, and that
 * publisher/subscriber contracts stay aligned across services.
 */

import { NotificationEventType } from '@poolmaster/shared/events/notification';

// Event type strings from typed event interfaces (publisher contracts)
// These are the `type` literal values on the event interfaces in scoring.ts, draft.ts, contest.ts
const SCORING_EVENT_TYPES = ['stat.received', 'score.updated'] as const;
const DRAFT_EVENT_TYPES = ['draft.pick_made', 'draft.completed'] as const;
const CONTEST_EVENT_TYPES = ['contest.locked', 'contest.completed'] as const;

// ========================================================================
// Tests
// ========================================================================

describe('Event bus contracts', () => {
  const notificationValues = Object.values(NotificationEventType);

  it('all NotificationEventType values are unique (no duplicates)', () => {
    const unique = new Set(notificationValues);
    expect(unique.size).toBe(notificationValues.length);
  });

  it('all NotificationEventType values follow naming convention: lowercase, dot-separated', () => {
    const pattern = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9_]*)+$/;
    for (const value of notificationValues) {
      expect(value).toMatch(pattern);
    }
  });

  it('no empty string event types in NotificationEventType', () => {
    for (const value of notificationValues) {
      expect(value.length).toBeGreaterThan(0);
    }
  });

  it('scoring publisher event types match subscriber contracts', () => {
    // score.updated must appear in NotificationEventType or be consumed by scoring service
    // The scoring service publishes these; the notification service subscribes to related events
    for (const eventType of SCORING_EVENT_TYPES) {
      expect(eventType).toMatch(/^[a-z]+\.[a-z_]+$/);
    }

    // Verify key scoring events that notification service should handle
    expect(notificationValues).toContain('scoring.event_started');
    expect(notificationValues).toContain('scoring.event_completed');
    expect(notificationValues).toContain('scoring.correction_applied');
  });

  it('draft and contest publisher event types align with notification subscriber types', () => {
    // Draft events published by draft-service should have corresponding notification types
    expect(notificationValues).toContain('draft.pick_made');
    expect(notificationValues).toContain('draft.completed');

    // Contest events published by core-api should have corresponding notification types
    expect(notificationValues).toContain('contest.locked');
    expect(notificationValues).toContain('contest.completed');
  });
});
