import { createColumnHelper } from '@tanstack/react-table';
import { useMemo, useState } from 'react';
import { ParticipantStatusOrder } from '@poolmaster/shared/domain';
import {
  DataGrid,
  ErrorState,
  LinkButton,
  FilterPicker,
  StatusBadge,
} from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';
import type { ParticipantDto } from '@/lib/api';
import {
  PARTICIPANT_STATUSES,
  participantStatusLabel,
  participantStatusTone,
  type ManagedParticipantStatus,
} from './sport-admin-utils';
import {
  buildSportParticipantListPath,
  buildSportParticipantPath,
} from './manage-navigation';
import { useLeagueRosterQuery, useSportLeaguesQuery } from './use-sport-catalog';
import { useManagedSport } from './use-managed-sport';
import { SportSectionMenu } from './sport-section-menu';
import { upperFirst } from '@/lib/upper-first';

const columnHelper = createColumnHelper<ParticipantDto>();

/**
 * /manage/sports/:sport/participants. One sport league's participants (golfers, horses) at a time
 * (#1853): a participant belongs to one league, so the page picks the league, reads its whole
 * roster once and narrows it by status and name in the browser, with Add opening its own page and
 * rows linking to each.
 */
export function RootAdminParticipantListPage() {
  const { sport, definition } = useManagedSport();
  const { participant, sportLeague } = definition.vocabulary;
  // One status at a time, ACTIVE first, as the golf player list this replaced did.
  const [status, setStatus] = useState<ManagedParticipantStatus>('ACTIVE');
  const leaguesQuery = useSportLeaguesQuery(sport);
  const [chosenLeagueId, setChosenLeagueId] = useState<string | null>(null);
  // The sport's first league until another is chosen.
  const sportLeagueId = chosenLeagueId ?? leaguesQuery.data?.at(0)?.id ?? '';
  const rosterQuery = useLeagueRosterQuery(sportLeagueId);
  const players = useMemo(
    // poolmaster-allow-list-lookup: the league's whole roster, read once and cached; the status picker narrows it on screen
    () => (rosterQuery.data ?? []).filter((player) => player.status === status),
    [rosterQuery.data, status],
  );
  const columns = useMemo(
    () => [
      columnHelper.accessor('name', {
        header: 'Name',
        meta: { info: "The participant's full name.", type: { kind: 'text' } },
        cell: ({ getValue }) => (
          <span className="font-medium text-foreground">{getValue()}</span>
        ),
      }),
      columnHelper.accessor('ranking', {
        header: 'Ranking',
        meta: { info: 'The participant\'s rank in the sport league, not a world ranking.', type: { kind: 'number' } },
        cell: ({ getValue }) => getValue() ?? '—',
        enableColumnFilter: false,
      }),
      columnHelper.accessor('shortName', {
        header: 'Short name',
        meta: { info: "The participant's shorter name, used where space is tight.", type: { kind: 'text' } },
        cell: ({ getValue }) => getValue() || '—',
      }),
      columnHelper.accessor('nationality', {
        header: 'Nationality',
        meta: { info: 'The country the participant represents.', type: { kind: 'text' } },
        cell: ({ getValue }) => getValue() || '—',
      }),
      columnHelper.accessor('status', {
        header: 'Status',
        meta: { info: 'Whether the participant is active in the sport league.', type: { kind: 'enum', order: ParticipantStatusOrder, label: participantStatusLabel } },
        cell: ({ getValue }) => (
          <StatusBadge tone={participantStatusTone(getValue())}>
            {participantStatusLabel(getValue())}
          </StatusBadge>
        ),
      }),
    ],
    [],
  );

  return (
    <section className="space-y-6" data-testid="root-admin-participant-list-page">
      <SportSectionMenu
        actions={(
          <LinkButton
            data-testid="root-admin-participant-list-new"
            to={`${buildSportParticipantListPath(sport)}/new${sportLeagueId ? `?sportLeague=${sportLeagueId}` : ''}`}
          >
            {`Add ${participant.one}`}
          </LinkButton>
        )}
        current="participants"
        tabsEnd={(
          <div className="flex flex-wrap gap-2">
            <FilterPicker
              label={upperFirst(sportLeague.one)}
              onChange={setChosenLeagueId}
              options={(leaguesQuery.data ?? []).map((league) => ({ label: league.name, value: league.id }))}
              testId="root-admin-participant-list-league"
              value={sportLeagueId}
            />
            <FilterPicker
              label="Status"
              onChange={(value) => {
                const next = PARTICIPANT_STATUSES.find((candidate) => candidate === value);
                if (next) {
                  setStatus(next);
                }
              }}
              options={PARTICIPANT_STATUSES.map((value) => ({ label: participantStatusLabel(value), value }))}
              testId="root-admin-participant-list-status"
              value={status}
            />
          </div>
        )}
      />

      {rosterQuery.isError || leaguesQuery.isError ? (
        <ErrorState
          body={extractErrorMessage(rosterQuery.error ?? leaguesQuery.error, { fallback: `We could not load ${participant.many} right now.` })}
          onRetry={() => void (leaguesQuery.isError ? leaguesQuery.refetch() : rosterQuery.refetch())}
          testId="root-admin-participant-list-error"
        />
      ) : null}
      <DataGrid
        columns={columns}
        data={players}
        emptyMessage={
          rosterQuery.isFetching || leaguesQuery.isFetching
            ? `Loading ${participant.many}...`
            : `No ${participantStatusLabel(status).toLowerCase()} ${participant.many} in this ${sportLeague.one}.`
        }
        filterTestIdPrefix="root-admin-participant-list-filter"
        getRowId={(player) => player.id}
        getRowLink={(player) => buildSportParticipantPath(sport, player.id)}
        rowTestId={(player) => `root-admin-participant-row-${player.id}`}
        search={{ label: `Find a ${participant.one}`, testId: 'root-admin-participant-list-search' }}
        tableTestId="root-admin-participant-list-table"
      />
    </section>
  );
}
