import { expect, test, type APIRequestContext } from '@playwright/test';
import { adminApiHeaders, expectOk, type AuthHeaders } from './helpers/admin-api';
import { readAdminCredentials } from './helpers/admin-session';
import { sweepE2eResidue } from './helpers/residue-sweep';
import { e2eEmail, e2eLeagueCode, e2eName, e2eUsername, newRunId } from './helpers/test-marker';
import { generatePassword } from './helpers/user-session';

/**
 * #1401 — the QA residue sweep removes a run that never reached its teardown. This spec makes
 * such a run through the API, the way a cancelled journey leaves one: a commissioner's league, a
 * golf tour with a tournament and two players on its field, and the commissioner. It skips its
 * own teardown and runs the sweep on its run id alone (parallel specs' live runs are never
 * touched), then reads each thing back.
 *
 * Untagged, so it runs pre-merge against the local stack only; the nightly workflow runs the
 * sweep itself against QA.
 */

async function postJson<T>(api: APIRequestContext, headers: AuthHeaders, path: string, data: unknown): Promise<T> {
  return (await (await expectOk(api.post(path, { headers, data }), `POST ${path}`)).json()) as T;
}

test('the residue sweep removes a run left behind, league first and users last, and nothing of it remains', async ({ playwright }, testInfo) => {
  const api = await playwright.request.newContext({ baseURL: testInfo.project.use.baseURL });
  try {
    const admin = await adminApiHeaders(api, readAdminCredentials());
    if (!admin) throw new Error('admin login failed');
    const runId = newRunId();
    const tourName = e2eName('Sweep Tour', runId);
    const tournamentName = e2eName('Sweep Open', runId);
    const playerNames = [1, 2].map((number) => `${e2eName('Sweep Golfer', runId)} ${number}`);
    const leagueCode = e2eLeagueCode('W', runId);
    const commissioner = { username: e2eUsername('wc', runId), email: e2eEmail('wc', runId) };

    // --- The run a cancelled journey leaves behind ---------------------------------------
    const { sports } = (await (await expectOk(api.get('/api/v1/sports/', { headers: admin }), 'list sports')).json()) as {
      sports: Array<{ id: string; sport: string }>;
    };
    const golfSportId = sports.find((row) => row.sport === 'GOLF')?.id;
    if (!golfSportId) throw new Error('golf is not in the sports table');
    const { sportLeague } = await postJson<{ sportLeague: { id: string } }>(api, admin, '/api/v1/sport-leagues/', { sport: 'GOLF', name: tourName });
    const { event } = await postJson<{ event: { id: string } }>(api, admin, '/api/v1/events/', {
      sportLeagueId: sportLeague.id,
      eventYear: 2099,
      name: tournamentName,
      startDate: '2099-07-16T08:00:00.000Z',
      rounds: 1,
      autoLifecycleEnabled: false,
    });
    const participantIds: string[] = [];
    for (const name of playerNames) {
      const { participant } = await postJson<{ participant: { id: string } }>(api, admin, '/api/v1/participants/', {
        sportId: golfSportId,
        participantType: 'INDIVIDUAL',
        name,
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
      events: [tournamentName],
      tours: [tourName],
      users: [commissioner.username],
    });
    expect([...report.players].sort()).toEqual(playerNames);
    expect((await api.get(`/api/v1/leagues/code/${leagueCode}`, { headers: admin })).status()).toBe(404);
    expect((await api.get(`/api/v1/events/${event.id}`, { headers: admin })).status()).toBe(404);
    expect((await api.get(`/api/v1/sport-leagues/${sportLeague.id}`, { headers: admin })).status()).toBe(404);
    for (const participantId of participantIds) {
      expect((await api.get(`/api/v1/participants/${participantId}`, { headers: admin })).status()).toBe(404);
    }
    expect((await api.get(`/api/v1/users/${registered.user.id}`, { headers: admin })).status()).toBe(404);
  } finally {
    await api.dispose();
  }
});
