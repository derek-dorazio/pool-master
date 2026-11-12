import { createColumnHelper } from '@tanstack/react-table';
import { useMemo, useState } from 'react';
import { isPlatformSearchTerm, PLATFORM_SEARCH_MIN_LENGTH } from '@poolmaster/shared/domain';
import {
  DataGrid,
  ErrorState,
  LinkButton,
  FilterPicker,
  StatusBadge,
} from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import type { ParticipantDto } from '@/lib/api';
import {
  PARTICIPANT_STATUSES,
  participantStatusLabel,
  participantStatusTone,
  type ManagedParticipantStatus,
} from './sport-admin-utils';
import {
  MANAGE_LIST_PAGE_SIZE,
  SEARCH_DEBOUNCE_MS,
  buildSportParticipantListPath,
  buildSportParticipantPath,
} from './manage-navigation';
import { useParticipantsQuery } from './use-sport-catalog';
import { useManagedSport } from './use-managed-sport';
import { SportSectionMenu } from './sport-section-menu';

const columnHelper = createColumnHelper<ParticipantDto>();

/**
 * /manage/sports/:sport/participants. A sport's master roster (golfers, horses): a grid of one
 * status at a time that reads nothing until a search is typed (#1313), as the user and league
 * lists do, with Add opening its own page and rows linking to each.
 */
export function RootAdminParticipantListPage() {
  const { sport, definition } = useManagedSport();
  const { participant } = definition.vocabulary;
  // One status at a time, ACTIVE first, as the golf player list this replaced did.
  // listParticipants would list every status if asked without one; the single-select
  // keeps the page's behaviour.
  const [status, setStatus] = useState<ManagedParticipantStatus>('ACTIVE');

  const [search, setSearch] = useState('');
  const term = useDebouncedValue(search.trim(), SEARCH_DEBOUNCE_MS);
  const canSearch = isPlatformSearchTerm(term);
  const playersQuery = useParticipantsQuery({
    sport,
    queryKey: QueryKeys.rootAdmin.manageSport.participantSearch(sport, term, status),
    status,
    q: term,
    enabled: canSearch,
    keepPrevious: true,
  });
  const columns = useMemo(
    () => [
      columnHelper.accessor('name', {
        header: 'Name',
        cell: ({ getValue }) => (
          <span className="font-medium text-foreground">{getValue()}</span>
        ),
      }),
      columnHelper.accessor('shortName', {
        header: 'Short name',
        cell: ({ getValue }) => getValue() || '—',
      }),
      columnHelper.accessor('nationality', {
        header: 'Nationality',
        cell: ({ getValue }) => getValue() || '—',
      }),
      columnHelper.accessor('status', {
        header: 'Status',
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
            to={`${buildSportParticipantListPath(sport)}/new`}
          >
            {`Add ${participant.one}`}
          </LinkButton>
        )}
        current="participants"
        tabsEnd={(
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
        )}
      />

      {playersQuery.isError ? (
        <ErrorState
          body={extractErrorMessage(playersQuery.error, { fallback: `We could not load ${participant.many} right now.` })}
          onRetry={() => void playersQuery.refetch()}
          testId="root-admin-participant-list-error"
        />
      ) : null}
      <DataGrid
        columns={columns}
        // The server searched already. On an error the grid stays, empty, so its box can retry.
        data={canSearch && !playersQuery.isError ? (playersQuery.data ?? []) : []}
        emptyMessage={
          !canSearch
            ? `Type at least ${PLATFORM_SEARCH_MIN_LENGTH} characters to find a ${participant.one}.`
            : playersQuery.isFetching
                ? `Searching ${participant.many}...`
                : `No ${participantStatusLabel(status).toLowerCase()} ${participant.many} matched the search.`
        }
        filterTestIdPrefix="root-admin-participant-list-filter"
        getRowId={(player) => player.id}
        getRowLink={(player) => buildSportParticipantPath(sport, player.id)}
        pageSize={MANAGE_LIST_PAGE_SIZE}
        rowTestId={(player) => `root-admin-participant-row-${player.id}`}
        search={{ label: `Find a ${participant.one}`, testId: 'root-admin-participant-list-search', onChange: setSearch }}
        tableTestId="root-admin-participant-list-table"
      />
    </section>
  );
}
