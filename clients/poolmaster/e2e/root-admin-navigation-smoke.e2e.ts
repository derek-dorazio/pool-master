import { expect, test } from './fixtures';

test('pool-master-dcv: root admin can reach management grids and use column filters', async ({
  rootAdminPage,
}) => {
  await rootAdminPage.goto('/manage/users');
  await expect(rootAdminPage.getByTestId('root-admin-manage-users-page')).toBeVisible();
  await expect(rootAdminPage.getByTestId('data-grid-filter-username')).toBeVisible();
  await rootAdminPage.getByTestId('data-grid-filter-username').fill('qa');

  await rootAdminPage.goto('/manage/leagues');
  await expect(rootAdminPage.getByTestId('root-admin-manage-leagues-page')).toBeVisible();
  await expect(rootAdminPage.getByTestId('data-grid-filter-leagueCode')).toBeVisible();
  await rootAdminPage.getByTestId('data-grid-filter-leagueCode').fill('QATESTLEAGUE');

  await rootAdminPage.goto('/manage/teams');
  await expect(rootAdminPage.getByTestId('root-admin-manage-teams-page')).toBeVisible();
  await expect(rootAdminPage.getByTestId('data-grid-filter-team')).toBeVisible();
});

test('pool-master-dcv: root admin can reach operational sync and configuration pages', async ({
  rootAdminPage,
}) => {
  await rootAdminPage.goto('/manage/sync');
  await expect(rootAdminPage.getByTestId('root-admin-sync-dashboard-page')).toBeVisible();
  await expect(rootAdminPage.getByTestId('root-admin-open-run-sport-sync-page')).toBeVisible();
  await expect(rootAdminPage.getByTestId('root-admin-open-run-event-sync-page')).toBeVisible();

  await rootAdminPage.goto('/manage/sync/run-sport-sync');
  await expect(rootAdminPage.getByTestId('root-admin-run-sport-sync-page')).toBeVisible();
  await expect(rootAdminPage.getByTestId('root-admin-sport-sync-now')).toBeVisible();

  await rootAdminPage.goto('/manage/sync/run-event-sync');
  await expect(rootAdminPage.getByTestId('root-admin-run-event-sync-page')).toBeVisible();
  await expect(rootAdminPage.getByTestId('root-admin-event-sync-now')).toBeVisible();

  await rootAdminPage.goto('/manage/sync-config');
  await expect(rootAdminPage.getByTestId('root-admin-sync-config-page')).toBeVisible();
  await expect(rootAdminPage.getByTestId('root-admin-sync-config-link-ingestion-schedule')).toBeVisible();

  await rootAdminPage.goto('/manage/content-configuration');
  await expect(rootAdminPage.getByTestId('root-admin-content-configuration-list-page')).toBeVisible();
});

test('pool-master-z3l: root admin can reach every golf management surface', async ({
  rootAdminPage,
}) => {
  // plans/124 §8 — one goto + testid assertion per new /manage/golf/* route.
  // List / hub routes render without seed data; the detail routes are exercised
  // against a tour/season/tournament created through the admin API below.
  await rootAdminPage.goto('/manage/golf');
  await expect(rootAdminPage.getByTestId('root-admin-golf-hub-page')).toBeVisible();

  await rootAdminPage.goto('/manage/golf/leagues');
  await expect(rootAdminPage.getByTestId('root-admin-golf-league-list-page')).toBeVisible();
  await expect(rootAdminPage.getByTestId('root-admin-golf-league-list-new')).toBeVisible();

  await rootAdminPage.goto('/manage/golf/seasons');
  await expect(rootAdminPage.getByTestId('root-admin-golf-season-list-page')).toBeVisible();
  await expect(rootAdminPage.getByTestId('root-admin-golf-season-list-tour-filter')).toBeVisible();

  await rootAdminPage.goto('/manage/golf/players');
  await expect(rootAdminPage.getByTestId('root-admin-golf-player-list-page')).toBeVisible();
  await expect(rootAdminPage.getByTestId('root-admin-golf-player-list-status')).toBeVisible();

  await rootAdminPage.goto('/manage/golf/tournaments');
  await expect(rootAdminPage.getByTestId('root-admin-golf-tournament-list-page')).toBeVisible();

  await rootAdminPage.goto('/manage/golf/tournaments/new');
  await expect(rootAdminPage.getByTestId('root-admin-golf-tournament-create-page')).toBeVisible();

  // Seed one tour + season + tournament through the admin API (uses the page's
  // authenticated storage state), then walk each detail route.
  const stamp = Date.now();
  const csrf = (await rootAdminPage.context().cookies()).find((c) => c.name === 'poolmaster_csrf')?.value;
  const api = rootAdminPage.request;
  const headers = csrf ? { 'X-CSRF-Token': csrf } : {};

  const leagueRes = await api.post('/api/v1/admin/sports/golf/leagues', {
    headers,
    data: { name: `E2E Tour ${stamp}`, matchKeyword: 'E2E' },
  });
  const leagueId = (await leagueRes.json()).league.id as string;

  const seasonRes = await api.post('/api/v1/admin/sports/golf/seasons', {
    headers,
    data: {
      sportLeagueId: leagueId,
      name: `E2E Season ${stamp}`,
      year: 2029,
      startDate: '2029-01-05T00:00:00.000Z',
      endDate: '2029-11-30T00:00:00.000Z',
    },
  });
  const seasonId = (await seasonRes.json()).season.id as string;

  const tournamentRes = await api.post('/api/v1/admin/sports/golf/tournaments', {
    headers,
    data: {
      name: `E2E Open ${stamp}`,
      venue: 'E2E Club',
      startDate: '2029-07-16T08:00:00.000Z',
      endDate: '2029-07-19T20:00:00.000Z',
      rounds: 4,
      releaseAt: '2029-07-01T00:00:00.000Z',
      fieldLocksAt: '2029-07-15T00:00:00.000Z',
      seasonId,
      autoLifecycleEnabled: false,
    },
  });
  const eventId = (await tournamentRes.json()).tournament.id as string;

  await rootAdminPage.goto(`/manage/golf/leagues/${leagueId}`);
  await expect(rootAdminPage.getByTestId('root-admin-golf-league-home-page')).toBeVisible();

  await rootAdminPage.goto(`/manage/golf/seasons/${seasonId}`);
  await expect(rootAdminPage.getByTestId('root-admin-golf-season-home-page')).toBeVisible();

  await rootAdminPage.goto(`/manage/golf/tournaments/${eventId}`);
  await expect(rootAdminPage.getByTestId('root-admin-golf-tournament-home-page')).toBeVisible();

  await rootAdminPage.goto(`/manage/golf/tournaments/${eventId}/field`);
  await expect(rootAdminPage.getByTestId('root-admin-golf-tournament-field-page')).toBeVisible();

  await rootAdminPage.goto(`/manage/golf/tournaments/${eventId}/tiers`);
  await expect(rootAdminPage.getByTestId('root-admin-golf-tournament-tiers-page')).toBeVisible();

  await rootAdminPage.goto(`/manage/golf/tournaments/${eventId}/scores`);
  await expect(rootAdminPage.getByTestId('root-admin-golf-tournament-scores-page')).toBeVisible();
});
