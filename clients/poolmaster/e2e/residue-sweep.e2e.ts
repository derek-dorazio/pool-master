import { expect, test, type APIRequestContext } from '@playwright/test';
import { adminApiHeaders, expectOk, type AuthHeaders } from './helpers/admin-api';
import { readAdminCredentials } from './helpers/admin-session';
import { listTestSlots } from './helpers/journey-teardown';
import { sweepE2eResidue } from './helpers/residue-sweep';
import { createTestEventThroughApi, findSeededSportLeagueThroughApi } from './helpers/test-event';
import { e2eEmail, e2eLeagueCode, e2eName, e2eUsername, newRunId } from './helpers/test-marker';
import { generatePassword } from './helpers/user-session';

/**
 * #1401 — the QA residue sweep removes a run that never reached its teardown. This spec makes
 * such a run through the API, the way a cancelled journey leaves one: a commissioner's league, a
 * tournament on a labelled test slot of the seeded PGA TOUR (#2004) with two test players on its
 * field (#2096), and the commissioner. The seeded tour is never swept; the slot goes, and with it
 * the tournament and both players (#2075). It skips its
 * own teardown and runs the sweep on its run id alone (parallel specs' live runs are never
 * touched), then reads each thing back.
 *
 * Untagged, so it runs pre-merge against the local stack only; the nightly workflow runs the
 * sweep itself against QA.
 */

async function postJson<T>(api: APIRequestContext, headers: AuthHeaders, path: string, data: unknown): Promise<T> {
  return (await (await expectOk(api.post(path, { headers, data }), `POST ${path}`)).json()) as T;
}

test('the residue sweep removes a run left behind, league first, then its labelled test slot with the event and test players, users last, and nothing of it remains', async ({ playwright }, testInfo) => {
  const api = await playwright.request.newContext({ baseURL: testInfo.project.use.baseURL });
  try {
    const admin = await adminApiHeaders(api, readAdminCredentials());
    if (!admin) throw new Error('admin login failed');
    const runId = newRunId();
    const tournamentName = e2eName('Sweep Open', runId);
    const playerNames = [1, 2].map((number) => `${e2eName('Sweep Golfer', runId)} ${number}`);
    const leagueCode = e2eLeagueCode('W', runId);
    const commissioner = { username: e2eUsername('wc', runId), email: e2eEmail('wc', runId) };

    // --- The run a cancelled journey leaves behind ---------------------------------------
    const sportLeague = await findSeededSportLeagueThroughApi(api, admin, 'GOLF', 'pga');
    const event = await createTestEventThroughApi(api, admin, {
      sportLeagueId: sportLeague.id,
      slotKind: 'TOURNAMENT',
      slotLabel: tournamentName,
      name: tournamentName,
      startsAt: '2099-07-16T08:00:00.000Z',
      autoLifecycleEnabled: false,
    });
    const participantIds: string[] = [];
    for (const name of playerNames) {
      const { participant } = await postJson<{ participant: { id: string } }>(api, admin, '/api/v1/participants/', {
        sportLeagueId: sportLeague.id,
        participantType: 'INDIVIDUAL',
        name,
        isTestData: true,
      });
      participantIds.push(participant.id);
    }
    await postJson(api, admin, `/api/v1/events/${event.id}/participants`, { participantIds });
    const registered = await postJson<{ user: { id: string }; tokens: { accessToken: string } }>(api, {}, '/api/v1/auth/register', {
      ...commissioner,
      password: generatePassword(),
      firstName: 'E2E',
      lastName: `Sweep Commissioner ${runId}`,
    });
    await postJson(api, { Authorization: `Bearer ${registered.tokens.accessToken}` }, '/api/v1/leagues', {
      name: e2eName('Sweep League', runId),
      leagueCode,
    });

    // --- The sweep, on this run alone ----------------------------------------------------
    const report = await sweepE2eResidue(api, admin, {
      minAgeMs: 0,
      onlyRunId: runId,
      log: (message) => console.log(`[sweep ${runId}] ${message}`),
    });

    expect(report.failures).toEqual([]);
    expect(report).toMatchObject({
      leagues: [leagueCode],
      testSlots: [tournamentName],
      // The players were on the slot's field alone, so they went with it.
      players: [],
      users: [commissioner.username],
    });
    expect((await api.get(`/api/v1/leagues/code/${leagueCode}`, { headers: admin })).status()).toBe(404);
    expect((await api.get(`/api/v1/events/${event.id}`, { headers: admin })).status()).toBe(404);
    expect((await listTestSlots(api, admin, sportLeague.id)).some((slot) => slot.label === tournamentName)).toBe(false);
    expect((await api.get(`/api/v1/sport-leagues/${sportLeague.id}`, { headers: admin })).status()).toBe(200);
    for (const participantId of participantIds) {
      expect((await api.get(`/api/v1/participants/${participantId}`, { headers: admin })).status()).toBe(404);
    }
    expect((await api.get(`/api/v1/users/${registered.user.id}`, { headers: admin })).status()).toBe(404);
  } finally {
    await api.dispose();
  }
});
