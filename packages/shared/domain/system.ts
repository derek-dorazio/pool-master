/**
 * The one seeded "system" User row that scheduler-driven AdminAuditEntry
 * writes attribute to (plans/124 §3.6/§9 item 11) — AdminAuditEntry.actorId
 * is a required FK to User, so a SYSTEM-actor audit entry needs a real row
 * to point at. Never authenticates (no password, never issued a token).
 */
export const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';
export const SYSTEM_USER_EMAIL = 'system@poolmaster.internal';
