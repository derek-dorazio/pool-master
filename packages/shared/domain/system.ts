/**
 * The one seeded "system" User row that scheduler-driven AdminAuditEntry
 * writes attribute to (plans/124 §3.6/§9 item 11) — AdminAuditEntry.actorId
 * is a required FK to User, so a SYSTEM-actor audit entry needs a real row
 * to point at. Never authenticates (no password, never issued a token).
 */
// Deliberately not the all-zero nil UUID: several "not found" contract
// tests use that value as a known-nonexistent id, and a real seeded row
// there would make those tests false-negative.
export const SYSTEM_USER_ID = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
export const SYSTEM_USER_EMAIL = 'system@poolmaster.internal';
