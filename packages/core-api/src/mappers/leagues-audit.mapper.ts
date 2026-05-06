import type { LeagueAuditEntryDto } from '@poolmaster/shared/dto';
import type { AuditLogEntry } from '../modules/leagues/audit-service';

/**
 * Maps the service-layer `AuditLogEntry` to the wire-format
 * `LeagueAuditEntryDto`. The two shapes are intentionally close — the
 * mapper exists to (a) convert `Date` → ISO string for `createdAt`, and
 * (b) sit at the route boundary per `rules/service-rules.md §4` so the
 * service interface can evolve independently of the contract.
 *
 * `beforeState` / `afterState` pass through as-is (intentionally opaque
 * per the DTO description — they're snapshots of arbitrary domain
 * entities depending on the action category).
 *
 * Replaces the previous "no mapper" pattern where audit handlers emitted
 * `AuditLogEntry` objects raw and the contract used `JsonObjectSchema`.
 * See pool-master-rop.14.1.
 */
export function mapLeagueAuditEntryToDto(entry: AuditLogEntry): LeagueAuditEntryDto {
  return {
    id: entry.id,
    leagueId: entry.leagueId,
    ...(entry.contestId !== undefined && { contestId: entry.contestId }),
    actorId: entry.actorId,
    action: entry.action,
    category: entry.category,
    description: entry.description,
    ...(entry.beforeState !== undefined && { beforeState: entry.beforeState }),
    ...(entry.afterState !== undefined && { afterState: entry.afterState }),
    ...(entry.reason !== undefined && { reason: entry.reason }),
    ...(entry.ipAddress !== undefined && { ipAddress: entry.ipAddress }),
    createdAt: entry.createdAt.toISOString(),
  };
}
