import { createBrowserRouter, Navigate } from 'react-router';
import { AuthHomePage } from '@/features/auth/auth-home-page';
import { PublicPlansPage } from '@/features/plans/public-plans-page';
import { ForgotPasswordPage } from '@/features/auth/forgot-password-page';
import { ResetPasswordPage } from '@/features/auth/reset-password-page';
import { UndoEmailChangePage } from '@/features/auth/undo-email-change-page';
import { EmailUnsubscribePage } from '@/features/account/email-unsubscribe-page';
import { MyAccountPage } from '@/features/account/my-account/my-account-page';
import { UserPageRedirect } from '@/features/account/user-page-redirect';
import { AppShell } from '@/features/app-shell/app-shell';
import { NotFoundPage } from '@/features/app-shell/not-found-page';
import { AllYearsPage } from '@/features/championships/all-years-page';
import { ChampionshipPage } from '@/features/championships/championship-page';
import { ChampionshipsLayout, ChampionshipsRedirect } from '@/features/championships/championships-layout';
import { CupSquadPointsPage } from '@/features/championships/cup-squad-points-page';
import { PointsRacePage } from '@/features/championships/points-race-page';
import { TrophyCasePage } from '@/features/championships/trophy-case-page';
import { HowToPlayPage } from '@/features/contest-types/how-to-play-page';
import { EventPage, MovedPage } from '@/features/event-pages/event-page';
import { StartPage } from '@/features/event-pages/start-page';
import { LeagueContestTypesPage } from '@/features/contest-types/league-contest-types-page';
import { CreateContestPage } from '@/features/contests/create-contest/create-contest-page';
import { ContestEntryPage } from '@/features/contests/contest-entry-page';
import { ContestEntryLeagueRedirect } from '@/features/contests/contest-entry-league-redirect';
import { ContestLeaderboardRedirect, ContestPage } from '@/features/contests/contest-page';
import { ContestEventsPage } from '@/features/contests/contest-events-page';
import { EditContestPage } from '@/features/contests/edit-contest-page';
import { ManageContestPage } from '@/features/contests/manage-contest-page';
import { ManageContestsPage } from '@/features/contests/manage-contests-page';
import { JoinLeaguePage } from '@/features/leagues/join-league-page';
import { CommissionerToolsLayout } from '@/features/leagues/commissioner-tools-layout';
import { EditChampionshipSettingsPage } from '@/features/championships/edit-championship-settings-page';
import { EditEventEmailsPage } from '@/features/leagues/edit-event-emails-page';
import { LeaguePlanEditRedirect, LeaguePlanPage } from '@/features/plans/league-plan-page';
import { EditContestCupWeightPage } from '@/features/contests/edit-contest-cup-weight-page';
import { LeagueHomePage } from '@/features/leagues/league-home-page';
import { CanonicalLeagueCode } from '@/features/leagues/canonical-league-code';
import { LeagueSettingsPage } from '@/features/leagues/league-settings-page';
import { WelcomePage } from '@/features/leagues/leagues-page';
import { LeagueActivityTab } from '@/features/root-admin/league-activity-tab';
import { LeagueContestTemplatesTab } from '@/features/root-admin/league-contest-templates-tab';
import { LeagueStructureTab } from '@/features/root-admin/league-structure-tab';
import { LeagueEventsTab } from '@/features/root-admin/league-events-tab';
import { LeaguePageLayout } from '@/features/root-admin/league-page-layout';
import { LeagueParticipantsTab } from '@/features/root-admin/league-participants-tab';
import { ParticipantLinkRedirect } from '@/features/root-admin/participant-link-redirect';
import { RootAdminContentConfigurationDetailPage } from '@/features/root-admin/root-admin-content-configuration-detail-page';
import { RootAdminSportEventCreatePage } from '@/features/root-admin/root-admin-sport-event-create-page';
import { ManageSportEventRoute } from '@/features/root-admin/manage-sport-event-route';
import { EventPageLayout } from '@/features/root-admin/event-page-layout';
import { EventFieldTab } from '@/features/root-admin/event-field-tab';
import { EventRoundsTab } from '@/features/root-admin/event-rounds-tab';
import { EventSlotsTab } from '@/features/root-admin/event-slots-tab';
import { EventContestsTab } from '@/features/root-admin/event-contests-tab';
import { EventActivityTab } from '@/features/root-admin/event-activity-tab';
import { ManageSportRoute } from '@/features/root-admin/manage-sport-route';
import { RootAdminSportsPage } from '@/features/root-admin/root-admin-sports-page';
import { RootAdminProvidersPage } from '@/features/root-admin/root-admin-providers-page';
import { RootAdminMapFindingParticipantPage } from '@/features/root-admin/root-admin-map-finding-participant-page';
import { CUSTOMER_LEAGUES_PATH, CUSTOMER_USERS_PATH, PRICING_PATH, PROVIDERS_PATH, SPORTS_PATH, SYNC_FINDINGS_PATH } from '@/features/root-admin/manage-navigation';
import { ManageLandingRedirect, RootAdminManageLayout } from '@/features/root-admin/root-admin-manage-layout';
import { RootAdminCustomerLeaguesPage } from '@/features/root-admin/root-admin-customer-leagues-page';
import { RootAdminCustomerUsersPage } from '@/features/root-admin/root-admin-customer-users-page';
import { RootAdminProfilesPage } from '@/features/root-admin/root-admin-profiles-page';
import { RootAdminRunEventSyncPage } from '@/features/root-admin/root-admin-run-event-sync-page';
import { RootAdminNotificationsPage } from '@/features/root-admin/root-admin-notifications-page';
import { RootAdminPricingPage } from '@/features/root-admin/root-admin-pricing-page';
import { RootAdminPlansPage } from '@/features/root-admin/root-admin-plans-page';
import { RootAdminActivityPage } from '@/features/root-admin/root-admin-activity-page';
import { RootAdminSyncFindingsPage } from '@/features/root-admin/root-admin-sync-findings-page';
import { JoinTeamOwnerPage } from '@/features/teams/join-team-owner-page';
import { MyTeamEditPage } from '@/features/teams/my-team-edit-page';
import { MyTeamPage } from '@/features/teams/my-team-page';
import { TeamPage } from '@/features/teams/team-page';
import { TeamsPage } from '@/features/teams/teams-page';
import { AdminEditTeamPage } from '@/features/teams/admin-edit-team-page';
import { InvitesPage } from '@/features/teams/invites-page';
import { ManageTeamPage } from '@/features/teams/manage-team-page';
import { ManageTeamsPage } from '@/features/teams/manage-teams-page';
import {
  LegacyContestCreateRedirect,
  LegacyContestHistoryRedirect,
  LegacyContestManageRedirect,
  LegacyContestTypesRedirect,
  LegacyEditLeagueRedirect,
  LegacyGolfManageRedirect,
  LegacyJoinInviteRedirect,
  LegacyLeagueContestsRedirect,
  LegacyLeagueEntriesRedirect,
  LegacyManageContestsRedirect,
  LegacyManageSyncRedirect,
  LegacyManageUserRedirect,
} from './legacy-redirects';
import { CommissionerRouteGuard, MemberRouteGuard, RootAdminRouteGuard } from './route-guards';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      {
        index: true,
        element: <AuthHomePage />,
      },
      {
        path: 'how-to-play',
        element: <HowToPlayPage />,
      },
      {
        path: 'plans',
        element: <PublicPlansPage />,
      },
      {
        // The Clutch Card's address is kept (ux-rules §13 item 7) and shows inactive until it returns as a contest type (#2054).
        path: 'play/clutch-card',
        element: <MovedPage />,
      },
      {
        path: 'play/:sportUrlSegment/:urlSegment',
        element: <EventPage />,
      },
      {
        path: 'start',
        element: <StartPage />,
      },
      {
        path: 'forgot-password',
        element: <ForgotPasswordPage />,
      },
      {
        path: 'reset-password',
        element: <ResetPasswordPage />,
      },
      {
        path: 'undo-email-change',
        element: <UndoEmailChangePage />,
      },
      {
        path: 'email/unsubscribe',
        element: <EmailUnsubscribePage />,
      },
      {
        path: 'invite/:inviteCode',
        element: <JoinLeaguePage />,
      },
      {
        path: 'team-invite/:inviteCode',
        element: <JoinTeamOwnerPage />,
      },
      {
        path: 'join/:inviteCode',
        element: <LegacyJoinInviteRedirect />,
      },
      {
        element: <MemberRouteGuard />,
        children: [
          {
            path: 'welcome',
            element: <WelcomePage />,
          },
          {
            path: 'leagues',
            element: <Navigate replace to="/welcome" />,
          },
          {
            path: 'my-leagues',
            element: <Navigate replace to="/welcome" />,
          },
          {
            path: 'my-account',
            element: <MyAccountPage />,
          },
          {
            path: 'users/:userId',
            element: <UserPageRedirect />,
          },
          {
            path: 'league/:leagueCode',
            element: <CanonicalLeagueCode><LeagueHomePage /></CanonicalLeagueCode>,
          },
          {
            path: 'league/:leagueCode/admin',
            element: <CommissionerRouteGuard />,
            children: [
              {
                element: <CommissionerToolsLayout />,
                children: [
                  {
                    index: true,
                    element: <LeagueSettingsPage />,
                  },
                  {
                    path: 'edit',
                    element: <LegacyEditLeagueRedirect />,
                  },
                  {
                    path: 'championships/edit',
                    element: <EditChampionshipSettingsPage />,
                  },
                  {
                    path: 'event-emails/edit',
                    element: <EditEventEmailsPage />,
                  },
                  {
                    path: 'plan',
                    element: <LeaguePlanPage />,
                  },
                  {
                    path: 'plan/edit',
                    element: <LeaguePlanEditRedirect />,
                  },
                  {
                    path: 'teams',
                    element: <ManageTeamsPage />,
                  },
                  {
                    path: 'teams/:teamId',
                    element: <ManageTeamPage />,
                  },
                  {
                    path: 'teams/:teamId/edit',
                    element: <AdminEditTeamPage />,
                  },
                  {
                    path: 'invites',
                    element: <InvitesPage />,
                  },
                  {
                    path: 'contests',
                    element: <ManageContestsPage />,
                  },
                  {
                    path: 'contests/new',
                    element: <CreateContestPage />,
                  },
                  {
                    path: 'contest-types',
                    element: <LeagueContestTypesPage />,
                  },
                  {
                    path: 'contests/:contestId',
                    element: <ManageContestPage />,
                  },
                  {
                    path: 'contests/:contestId/edit',
                    element: <EditContestPage />,
                  },
                  {
                    path: 'contests/:contestId/events',
                    element: <ContestEventsPage />,
                  },
                  {
                    path: 'contests/:contestId/cup-weight',
                    element: <EditContestCupWeightPage />,
                  },
                ],
              },
            ],
          },
          {
            path: 'league/:leagueCode/contests/new',
            element: <LegacyContestCreateRedirect />,
          },
          {
            path: 'league/:leagueCode/contests/:contestId/manage',
            element: <LegacyContestManageRedirect />,
          },
          {
            path: 'league/:leagueCode/team',
            element: <MyTeamPage />,
          },
          {
            path: 'league/:leagueCode/team/edit',
            element: <MyTeamEditPage />,
          },
          {
            path: 'league/:leagueCode/teams/:teamId',
            element: <TeamPage />,
          },
          {
            // pool-master-dxd.13 — MyEntriesPage was folded into the per-contest
            // Contest Board. Old /entries deep-links redirect to League Home.
            path: 'league/:leagueCode/entries',
            element: <LegacyLeagueEntriesRedirect />,
          },
          {
            path: 'league/:leagueCode/history',
            element: <AllYearsPage />,
          },
          {
            path: 'league/:leagueCode/teams',
            element: <TeamsPage />,
          },
          {
            path: 'league/:leagueCode/championships',
            element: <ChampionshipsRedirect />,
          },
          {
            path: 'league/:leagueCode/championships/:year',
            element: <ChampionshipsLayout />,
            children: [
              {
                index: true,
                element: <ChampionshipPage />,
              },
              {
                path: 'trophies',
                element: <TrophyCasePage />,
              },
              {
                path: 'race',
                element: <PointsRacePage />,
              },
              {
                path: 'race/:sportLeagueId',
                element: <PointsRacePage />,
              },
              {
                path: 'race/:sportLeagueId/squads/:squadId',
                element: <CupSquadPointsPage />,
              },
            ],
          },
          {
            path: 'league/:leagueCode/contest-types',
            element: <LegacyContestTypesRedirect />,
          },
          {
            // The Contests tab folded into Home, its Past view into My team (#1763).
            path: 'league/:leagueCode/contests',
            element: <LegacyLeagueContestsRedirect />,
          },
          {
            path: 'league/:leagueCode/contests/manage',
            element: <LegacyManageContestsRedirect />,
          },
          {
            path: 'league/:leagueCode/contests/history',
            element: <LegacyContestHistoryRedirect />,
          },
          {
            path: 'league/:leagueCode/contests/:contestId',
            element: <ContestPage />,
          },
          {
            path: 'league/:leagueCode/contests/:contestId/leaderboard',
            element: <ContestLeaderboardRedirect />,
          },
          {
            path: 'league/:leagueCode/contests/:contestId/entries/:entryId',
            element: <ContestEntryPage />,
          },
          {
            path: 'contests/:contestId/entries/:entryId',
            element: <ContestEntryLeagueRedirect />,
          },
        ],
      },
      {
        path: 'contests',
        element: <Navigate replace to="/welcome" />,
      },
      {
        // Signed-out and still-loading visitors are the member guard's; the root-admin guard
        // adds only its own check.
        element: <MemberRouteGuard />,
        children: [
          {
            element: <RootAdminRouteGuard />,
            children: [
              {
                path: 'manage',
                element: <RootAdminManageLayout />,
                children: [
                  {
                    index: true,
                    element: <ManageLandingRedirect />,
                  },
                  {
                    path: 'legacy',
                    element: <ManageLandingRedirect />,
                  },
                  {
                    // The old contest template list; each league's templates are on its League page (#1866).
                    path: 'content-configuration',
                    element: <Navigate replace to={SPORTS_PATH} />,
                  },
                  {
                    path: 'content-configuration/:templateKey',
                    element: <RootAdminContentConfigurationDetailPage />,
                  },
                  {
                    // The old event list; each league's events are on its League page (#1866).
                    path: 'events',
                    element: <Navigate replace to={SPORTS_PATH} />,
                  },
                  {
                    // Every sport league in one grid, Manage's landing page (#1848).
                    path: 'sports',
                    element: <RootAdminSportsPage />,
                  },
                  { path: 'sports/profiles', element: <RootAdminProfilesPage /> },
                  {
                    path: 'sports/:sport',
                    element: <ManageSportRoute />,
                    children: [
                      // A sport's own entry and its old league list now open the Sports page (#1848).
                      { index: true, element: <Navigate replace to={SPORTS_PATH} /> },
                      { path: 'leagues', element: <Navigate replace to={SPORTS_PATH} /> },
                      {
                        // A sport league's own page and its tabs (#1866).
                        path: 'leagues/:leagueId',
                        element: <LeaguePageLayout />,
                        children: [
                          { index: true, element: <Navigate replace to="events" /> },
                          { path: 'events', element: <LeagueEventsTab /> },
                          { path: 'participants', element: <LeagueParticipantsTab /> },
                          { path: 'activity', element: <LeagueActivityTab /> },
                          { path: 'contest-templates', element: <LeagueContestTemplatesTab /> },
                          { path: 'structure', element: <LeagueStructureTab /> },
                          // Its old edit page: the settings are the ⚙ dialog on the page now.
                          { path: 'edit', element: <Navigate replace to=".." relative="path" /> },
                        ],
                      },
                      // The sport-wide event and participant lists gave way to each league's page (#1866).
                      { path: 'events', element: <Navigate replace to={SPORTS_PATH} /> },
                      { path: 'events/new', element: <RootAdminSportEventCreatePage /> },
                      {
                        path: 'events/:eventId',
                        element: <ManageSportEventRoute />,
                        children: [
                          {
                            // An event's own page and its tabs (#1890).
                            element: <EventPageLayout />,
                            children: [
                              { index: true, element: <Navigate replace to="field" /> },
                              { path: 'field', element: <EventFieldTab /> },
                              { path: 'slots', element: <EventSlotsTab /> },
                              { path: 'rounds', element: <EventRoundsTab /> },
                              { path: 'contests', element: <EventContestsTab /> },
                              { path: 'activity', element: <EventActivityTab /> },
                              // Its old tiers page: tiers and prices are on the Field tab, corrected per participant.
                              { path: 'tiers', element: <Navigate replace to="../field" relative="path" /> },
                              // Its old schedule page, kept as a redirect for old links: each round's ⤢ dialog reschedules it.
                              { path: 'schedule', element: <Navigate replace to="../rounds" relative="path" /> },
                              // Its old edit page: the details are the ⚙ dialog on the page now.
                              { path: 'edit', element: <Navigate replace to="../field" relative="path" /> },
                              // Its old results page: results are on the Rounds and matches tab.
                              { path: 'results', element: <Navigate replace to="../rounds" relative="path" /> },
                            ],
                          },
                        ],
                      },
                      // A participant's old page opens its league's Participants tab (#1866).
                      { path: 'participants/:participantId/*', element: <ParticipantLinkRedirect /> },
                      { path: 'participants', element: <Navigate replace to={SPORTS_PATH} /> },
                    ],
                  },
                  {
                    // Golf's pages before they moved under sports/golf.
                    path: 'golf/*',
                    element: <LegacyGolfManageRedirect />,
                  },
                  { path: 'customers', element: <Navigate replace to={CUSTOMER_LEAGUES_PATH} /> },
                  { path: 'customers/leagues', element: <RootAdminCustomerLeaguesPage /> },
                  { path: 'customers/users', element: <RootAdminCustomerUsersPage /> },
                  // The Leagues and Users pages, and each user's page, became Customers (#1883).
                  { path: 'leagues', element: <Navigate replace to={CUSTOMER_LEAGUES_PATH} /> },
                  { path: 'users', element: <Navigate replace to={CUSTOMER_USERS_PATH} /> },
                  { path: 'users/:userId', element: <LegacyManageUserRedirect /> },
                  {
                    path: 'plans',
                    element: <RootAdminPlansPage />,
                  },
                  {
                    path: 'activity',
                    element: <RootAdminActivityPage />,
                  },
                  {
                    // The sync run history page became Activity, and its tools moved under Providers (#1887).
                    path: 'sync/*',
                    element: <LegacyManageSyncRedirect />,
                  },
                  {
                    path: 'notifications',
                    element: <RootAdminNotificationsPage />,
                  },
                  {
                    // Every settings group has its own page now; Pricing took the last (#1886).
                    path: 'settings',
                    element: <Navigate replace to={PRICING_PATH} />,
                  },
                  {
                    // The schedule moved to the Providers page (#1873).
                    path: 'settings/ingestion-schedule',
                    element: <Navigate replace to={PROVIDERS_PATH} />,
                  },
                  {
                    path: 'providers',
                    element: <RootAdminProvidersPage />,
                  },
                  {
                    path: 'providers/run-event-sync',
                    element: <RootAdminRunEventSyncPage />,
                  },
                  {
                    path: 'providers/findings',
                    element: <RootAdminSyncFindingsPage />,
                  },
                  {
                    path: 'providers/findings/:findingId/map-participant',
                    element: <RootAdminMapFindingParticipantPage />,
                  },
                  {
                    // The old Unmapped participants list and its map links became findings (#1999).
                    path: 'providers/unmapped-participants/*',
                    element: <Navigate replace to={SYNC_FINDINGS_PATH} />,
                  },
                  {
                    path: 'pricing',
                    element: <RootAdminPricingPage />,
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        path: '*',
        element: <NotFoundPage />,
      },
    ],
  },
]);
