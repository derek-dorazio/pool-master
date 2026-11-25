import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { readCsrfToken, submitAndRead } from './browser-writes';
import { expectOk, type AuthHeaders } from './admin-api';

/**
 * #2004 — a journey plays in a seeded sport league, the one a migration added, and makes its event
 * the way a root admin makes a test event: a test slot of the league's current Season first, then
 * the event on that slot, on the New test event page, or through the API for a journey that builds
 * its catalog there. A league a test makes through the API has no slot definitions, so it can never
 * hold a test slot.
 */

export type SeededSportLeague = { id: string; isActive: boolean };

/** A seeded sport league of the sport, by its name, as the root admin's list reads it. */
export async function findSeededSportLeague(page: Page, sport: string, name: string): Promise<SeededSportLeague> {
  return findSeededSportLeagueThroughApi(page.request, {}, sport, name);
}

/** `findSeededSportLeague`, for a journey that signs its API calls with the admin's token. */
export async function findSeededSportLeagueThroughApi(api: APIRequestContext, headers: AuthHeaders, sport: string, name: string): Promise<SeededSportLeague> {
  const response = await expectOk(api.get('/api/v1/sport-leagues', { headers, params: { sport } }), `list ${sport} sport leagues`);
  const { sportLeagues } = (await response.json()) as { sportLeagues: Array<{ id: string; name: string; isActive: boolean }> };
  const found = sportLeagues.find((sportLeague) => sportLeague.name === name);
  if (!found) throw new Error(`no seeded ${sport} sport league is named "${name}"`);
  return { id: found.id, isActive: found.isActive };
}

/** Switches a sport league on or off through the API, signed as the browser's root admin. */
export async function setSportLeagueActive(page: Page, sportLeagueId: string, isActive: boolean): Promise<void> {
  const headers = { 'x-csrf-token': await readCsrfToken(page) };
  await expectOk(page.request.patch(`/api/v1/sport-leagues/${sportLeagueId}`, { headers, data: { isActive } }), `switch sport league ${sportLeagueId} ${isActive ? 'on' : 'off'}`);
}

/**
 * The slot definition a test slot plays: the league's first definition of that kind (a golf
 * tournament, a race, a knockout round) in a phase its current Season has, as the Structure tab
 * and the Season list read them.
 */
async function currentSeasonDefinitionId(api: APIRequestContext, headers: AuthHeaders, sportLeagueId: string, slotKind: string): Promise<string> {
  const [structureResponse, seasonsResponse] = await Promise.all([
    expectOk(api.get(`/api/v1/sport-leagues/${sportLeagueId}/structure`, { headers }), 'read the league structure'),
    expectOk(api.get(`/api/v1/sport-leagues/${sportLeagueId}/seasons`, { headers }), 'list Seasons'),
  ]);
  const { phases } = (await structureResponse.json()) as { phases: Array<{ phase: string; slots: Array<{ id: string; slotKind: string }> }> };
  const { seasons } = (await seasonsResponse.json()) as { seasons: Array<{ isCurrent: boolean; phases: Array<{ phase: string }> }> };
  const seasonPhases = new Set(seasons.find((season) => season.isCurrent)?.phases.map((phase) => phase.phase) ?? []);
  const definition = phases
    .filter((phase) => seasonPhases.has(phase.phase))
    .flatMap((phase) => phase.slots)
    .find((candidate) => candidate.slotKind === slotKind);
  if (!definition) throw new Error(`sport league ${sportLeagueId}'s current Season has no ${slotKind} slot definition`);
  return definition.id;
}

const pad = (value: number) => String(value).padStart(2, '0');

function dateTimeInput(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * On the New test event page: adds a test slot labelled `slotLabel` starting at `startsAt`, which
 * the form then picks, and creates the event `name` on it. The event takes the slot's dates and
 * its league's round count, and opens on its Field tab.
 */
export async function createTestEvent(
  page: Page,
  input: { sportUrlSegment: string; sportLeagueId: string; slotKind: string; slotLabel: string; startsAt: Date; name: string },
): Promise<{ id: string; sport: string; championshipYear: number }> {
  const definitionId = await currentSeasonDefinitionId(page.request, {}, input.sportLeagueId, input.slotKind);
  await page.goto(`/manage/sports/${input.sportUrlSegment}/events/new`);
  await page.getByTestId('root-admin-sport-event-create-tour').selectOption(input.sportLeagueId);
  await page.getByTestId('root-admin-test-slot-create-definition').selectOption(definitionId);
  await page.getByTestId('root-admin-test-slot-create-label').fill(input.slotLabel);
  await page.getByTestId('root-admin-test-slot-create-start').fill(dateTimeInput(input.startsAt));
  const { slot } = await submitAndRead<{ slot: { id: string } }>(
    page,
    'root-admin-test-slot-create-submit',
    'POST',
    `/api/v1/sport-leagues/${input.sportLeagueId}/test-slots`,
  );
  // The new slot is free, so the form offers it and picks it.
  await expect(page.getByTestId('root-admin-sport-event-create-slot')).toHaveValue(slot.id);
  await page.getByTestId('root-admin-sport-event-create-name').fill(input.name);
  const created = await submitAndRead<{ event: { id: string; sport: string; championshipYear: number } }>(
    page,
    'root-admin-sport-event-create-submit',
    'POST',
    '/api/v1/events',
  );
  await expect(page).toHaveURL(new RegExp(`/manage/sports/${input.sportUrlSegment}/events/${created.event.id}/field$`));
  await expect(page.getByTestId('root-admin-event-page')).toBeVisible();
  return created.event;
}

/**
 * Through the API, signed with the admin's token: adds a test slot labelled `slotLabel` from
 * `startsAt` to the league's current Season and creates the event `name` on it. The event takes the
 * slot's dates and its league's round count; `rounds`, when given and different, is then set on it.
 */
export async function createTestEventThroughApi(
  api: APIRequestContext,
  headers: AuthHeaders,
  input: { sportLeagueId: string; slotKind: string; slotLabel: string; startsAt: string; name: string; rounds?: number; autoLifecycleEnabled?: boolean },
): Promise<{ id: string }> {
  const slotDefinitionId = await currentSeasonDefinitionId(api, headers, input.sportLeagueId, input.slotKind);
  const slotResponse = await expectOk(
    api.post(`/api/v1/sport-leagues/${input.sportLeagueId}/test-slots`, { headers, data: { slotDefinitionId, label: input.slotLabel, startsAt: input.startsAt } }),
    `add test slot ${input.slotLabel}`,
  );
  const { slot } = (await slotResponse.json()) as { slot: { id: string } };
  const eventResponse = await expectOk(
    api.post('/api/v1/events/', {
      headers,
      data: { seasonSlotId: slot.id, name: input.name, ...(input.autoLifecycleEnabled === undefined ? {} : { autoLifecycleEnabled: input.autoLifecycleEnabled }) },
    }),
    `create test event ${input.name}`,
  );
  const { event } = (await eventResponse.json()) as { event: { id: string; rounds: number | null } };
  if (input.rounds !== undefined && input.rounds !== event.rounds) {
    await expectOk(api.patch(`/api/v1/events/${event.id}`, { headers, data: { rounds: input.rounds } }), `set ${input.name} to ${input.rounds} rounds`);
  }
  return { id: event.id };
}
