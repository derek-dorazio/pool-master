/**
 * Shared commissioner audit-log DTOs used by league-scoped and contest-scoped
 * audit endpoints.
 */
import { z } from 'zod';
import { DateTimeSchema } from './common.dto';

/**
 * Audit-log category — mirrors the AuditCategory union in the service layer
 * (`packages/core-api/src/modules/leagues/audit-service.ts`). Defined here so
 * frontend consumers get a typed enum on the wire.
 */
export const LeagueAuditCategorySchema = z
  .enum([
    'LEAGUE',
    'CONTEST',
    'DRAFT',
    'SCORING',
    'PAYOUT',
    'MEMBER',
    'COMMUNICATION',
  ])
  .describe('Audit-log entry category — broad classification of the action that produced this entry.');
export type LeagueAuditCategory = z.infer<typeof LeagueAuditCategorySchema>;

/**
 * Commissioner audit-log entry. Replaces the previous `JsonObjectSchema`
 * passthrough (pool-master-rop.14.1) — every field except the opaque
 * before/after snapshots is now typed at the wire boundary so frontend
 * consumers compile against the real shape rather than `Record<string, unknown>`.
 *
 * `beforeState` and `afterState` are intentionally opaque: they hold snapshots
 * of arbitrary domain entities depending on the action category (a league
 * record vs a contest record vs a member record etc.). Typing them per
 * category would require a tagged-union the audit log doesn't currently
 * carry; for now keep them as opaque records and document the design intent
 * in the description. The substrate redesign in pool-master-rop.78 may
 * revisit this — see audit doc section 2.3.
 */
export const LeagueAuditEntryDtoSchema = z
  .object({
    id: z.string().describe('Audit-log entry id.'),
    leagueId: z.string().describe('League this entry belongs to.'),
    contestId: z
      .string()
      .optional()
      .describe('Contest this entry references when the action is contest-scoped.'),
    actorId: z.string().describe('User id of the commissioner / actor that performed the action.'),
    action: z.string().describe('Action verb in dotted form (e.g., "league.member.role.changed").'),
    category: LeagueAuditCategorySchema,
    description: z.string().describe('Human-readable description of what happened.'),
    // Inline `z.record(z.unknown())` rather than the shared `JsonObjectSchema`
    // singleton — `zodToJsonSchema` deduplicates by underlying schema reference,
    // and reusing the same singleton makes the generator emit the same description
    // for both fields (the first one wins). Inline schemas are distinct
    // instances and produce per-field descriptions.
    beforeState: z
      .record(z.unknown())
      .describe(
        'Opaque snapshot of relevant entity state BEFORE the action. Shape varies by category; treat as audit data, not as a typed contract.',
      )
      .optional(),
    afterState: z
      .record(z.unknown())
      .describe(
        'Opaque snapshot of relevant entity state AFTER the action. Shape varies by category; treat as audit data, not as a typed contract.',
      )
      .optional(),
    reason: z
      .string()
      .optional()
      .describe('Optional human-supplied reason / justification for the action.'),
    ipAddress: z
      .string()
      .optional()
      .describe('IP address from which the action originated, when available.'),
    createdAt: DateTimeSchema.describe('When the audit entry was recorded.'),
  })
  .describe('Commissioner audit-log entry.');
export type LeagueAuditEntryDto = z.infer<typeof LeagueAuditEntryDtoSchema>;
