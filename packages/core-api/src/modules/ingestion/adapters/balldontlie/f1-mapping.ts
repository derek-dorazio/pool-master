/**
 * Pure mappings from BALLDONTLIE's Formula 1 endpoints (`/f1/v1/...`) to the provider port's
 * shapes (#2045). No I/O: the reader fetches, these reshape. A Grand Prix weekend is one event
 * whose code is its scope id; its slot comes from the league's NAME_PATTERN mappings, as golf's
 * tournaments do (#2011). The weekend lists every session it has; which of them are played as
 * Rounds is the league's session type mappings to say (`sessionRounds`), never this file's.
 */

import { GameSideStatus, Sport, SportEventParticipantStatus, type ProviderSession } from '@poolmaster/shared/domain';
import type { RaceRunnerUpdate, RaceSessionUpdate } from '@poolmaster/shared/dto';
import type { ProviderParticipant, SportEvent } from '../../core/provider-interface';
import { CompetitionStatusState, PROGRESS_BY_STATE, eventStatusOf } from './competition-status';
import type { F1DriverWithTeam, F1Event, F1Session, F1SessionResult } from './f1-contract';
import { participantFeedId } from './participant-feed-id';
import { BALLDONTLIE_PROVIDER_ID } from './pga-mapping';

export const F1_EVENTS_PATH = '/f1/v1/events';
export const F1_SESSIONS_PATH = '/f1/v1/sessions';
export const F1_SESSION_RESULTS_PATH = '/f1/v1/session_results';
export const F1_DRIVER_STANDINGS_PATH = '/f1/v1/driver_standings';

/**
 * A Grand Prix's event id: the vendor's event id under the league's scope, the way every other
 * scoped league names its events, so a bare number stays golf's tournament id.
 */
const SCOPE_ID_PATTERN = /^f1-([1-9]\d{0,9})$/;

export function f1ScopeId(eventId: number): string {
  return `f1-${String(eventId)}`;
}

/** The vendor event id an event id names, or null when it names no Grand Prix. */
export function parseF1Scope(eventId: string): number | null {
  const match = SCOPE_ID_PATTERN.exec(eventId);
  return match ? Number(match[1]) : null;
}

/**
 * Whether a weekend can be shown: it has a start, and a lifecycle the vendor can classify
 * (`unknown` "cannot be safely classified").
 */
export function isSchedulableF1Event(event: F1Event): event is F1Event & { start_date: string } {
  return typeof event.start_date === 'string' && event.status_state !== CompetitionStatusState.UNKNOWN;
}

/** A session as the events sync reads it: its id, its type and its start. */
function toProviderSession(session: F1Session): ProviderSession {
  return { providerSessionId: String(session.id), sessionType: session.type, startsAt: session.date == null ? null : new Date(session.date) };
}

/** A Grand Prix weekend with every session the vendor lists for it. */
export function toF1Event(event: F1Event & { start_date: string }, sessions: readonly F1Session[]): SportEvent {
  const startDate = new Date(event.start_date);
  const endDate = event.end_date == null ? startDate : new Date(event.end_date);
  const location = [event.location, event.country_name].filter(Boolean).join(', ');
  const status = eventStatusOf([PROGRESS_BY_STATE[event.status_state]], true);
  const externalId = f1ScopeId(event.id);
  return {
    externalId,
    providerId: BALLDONTLIE_PROVIDER_ID,
    sport: Sport.AUTO_RACING,
    name: event.name,
    venue: event.circuit?.name,
    location: location || undefined,
    startDate,
    endDate,
    status,
    // Once the weekend is under way the grid cannot change.
    fieldLocked: status !== 'SCHEDULED' && status !== 'POSTPONED',
    providerSlots: [{ code: externalId, startsAt: startDate, endsAt: endDate }],
    sessions: sessions.map(toProviderSession),
  };
}

/** A driver, keyed by the vendor's driver id, which is stable across seasons. */
export function toF1Driver(driver: F1DriverWithTeam, ranking?: number): ProviderParticipant {
  return {
    externalId: participantFeedId(driver.id),
    providerId: BALLDONTLIE_PROVIDER_ID,
    sport: Sport.AUTO_RACING,
    name: driver.display_name,
    firstName: driver.first_name ?? undefined,
    lastName: driver.last_name ?? undefined,
    nationality: driver.country_name ?? undefined,
    status: SportEventParticipantStatus.ACTIVE,
    ranking,
    metadata: {},
  };
}

/**
 * One driver's result in a session, or null while it has none: a driver who retired did not
 * finish; one with a place finished; one with neither, once the session is final, did not start.
 */
function toRunner(result: F1SessionResult, sessionFinal: boolean): RaceRunnerUpdate | null {
  const participantExternalId = participantFeedId(result.driver.id);
  if (result.retired === true) return { participantExternalId, status: GameSideStatus.DID_NOT_FINISH, position: null };
  if (result.position != null) return { participantExternalId, status: GameSideStatus.FINISHED, position: result.position };
  return sessionFinal ? { participantExternalId, status: GameSideStatus.DID_NOT_START, position: null } : null;
}

/** Each session of the weekend with its drivers' results, official once the vendor marks it final. */
export function toRaceSessionUpdates(sessions: readonly F1Session[], results: readonly F1SessionResult[]): RaceSessionUpdate[] {
  return sessions.map((session) => {
    const isOfficial = session.status_state === CompetitionStatusState.FINAL;
    return {
      providerSessionId: String(session.id),
      sessionType: session.type,
      startsAt: session.date == null ? null : new Date(session.date).toISOString(),
      isOfficial,
      runners: results
        .filter((result) => result.session.id === session.id)
        .flatMap((result) => toRunner(result, isOfficial) ?? []),
    };
  });
}
