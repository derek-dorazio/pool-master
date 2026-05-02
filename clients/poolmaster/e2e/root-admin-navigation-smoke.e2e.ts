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
