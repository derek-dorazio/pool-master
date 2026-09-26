/**
 * Squad-name uniqueness within a league (#202, §12).
 *
 * `@@unique([leagueId, name])` means a create or rename can now violate a database
 * constraint where previously it silently produced a duplicate. Without handling, that
 * surfaces as an unhandled Prisma P2002 and a 500.
 *
 * Two collisions exist and they need opposite treatment:
 *
 *   - A name the USER chose collides → their problem to resolve, so it is a typed error
 *     they can act on.
 *   - The DEFAULT name collides → not their problem. `buildDefaultSquadName` produces
 *     "{First} {Last}'s Team", so two members of one league who share a name collide, and
 *     so do two members with no name at all, since `formatUserFullName` falls back to
 *     "Unknown User". Failing league-join because someone shares your surname would be a
 *     regression introduced by the constraint, so the default name is disambiguated.
 *
 * The constraint spans inactive squads, so both checks do too.
 */
import type { SquadRepository } from '@poolmaster/shared/db';
import { buildDefaultSquadName } from '../../core/user-name';
import { SquadOperationError } from './service';

/** Upper bound on default-name disambiguation attempts before giving up. */
const MAX_DEFAULT_NAME_ATTEMPTS = 50;

/**
 * Rejects a user-chosen squad name that another squad in the league already holds.
 *
 * `excludeSquadId` lets a rename keep its own name — otherwise updating a squad without
 * changing its name would collide with itself.
 *
 * Raises `SQUAD_NAME_TAKEN`, which the squad route maps to a 400. A conflict is arguably
 * a 409, but no squad route declares one, and widening the published contract is not
 * this step's job — the error code carries the meaning.
 */
export async function assertSquadNameAvailable(
  squadRepo: SquadRepository,
  leagueId: string,
  name: string,
  options: { excludeSquadId?: string } = {},
): Promise<void> {
  const existing = await squadRepo.findByLeagueAndName(leagueId, name);
  if (!existing || existing.id === options.excludeSquadId) {
    return;
  }
  throw new SquadOperationError(
    `Another squad in this league is already named "${name}"`,
    'SQUAD_NAME_TAKEN',
  );
}

/**
 * Builds the default squad name for a user and makes it unique within the league by
 * appending a counter — "Dee Dorazio's Team", then "Dee Dorazio's Team 2", and so on.
 *
 * Never throws for a collision: a default name the user did not choose must not be able
 * to block them joining a league.
 */
export async function resolveAvailableDefaultSquadName(
  squadRepo: SquadRepository,
  leagueId: string,
  firstName?: string | null,
  lastName?: string | null,
): Promise<string> {
  const base = buildDefaultSquadName(firstName, lastName);

  for (let attempt = 1; attempt <= MAX_DEFAULT_NAME_ATTEMPTS; attempt += 1) {
    const candidate = attempt === 1 ? base : `${base} ${attempt}`;
    const existing = await squadRepo.findByLeagueAndName(leagueId, candidate);
    if (!existing) {
      return candidate;
    }
  }

  // Exhausting 50 identically-named members in one league is not a case worth a
  // deterministic name for; fall back to something guaranteed free.
  return `${base} ${Date.now()}`;
}
