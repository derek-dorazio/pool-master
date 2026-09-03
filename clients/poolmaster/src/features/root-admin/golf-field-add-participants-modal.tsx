import { useQuery } from '@tanstack/react-query';
import { createColumnHelper } from '@tanstack/react-table';
import { useMemo, useState } from 'react';
import {
  adminBulkAddGolfFieldEntries,
  adminGetGolfLeagueRoster,
  adminListGolfLeagues,
  adminListGolfPlayers,
} from '@/lib/api';
import {
  Alert,
  Button,
  Checkbox,
  FormField,
  Input,
  Modal,
  SelectableDataGrid,
  Select,
  ServerErrorBar,
} from '@/features/shared/ui';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import type {
  AdminBulkAddGolfFieldEntriesResponses,
  AdminGetGolfLeagueRosterResponses,
  AdminListGolfLeaguesResponses,
} from '@/lib/api';

type RosterEntry = AdminGetGolfLeagueRosterResponses[200]['entries'][number];
type GolfLeague = AdminListGolfLeaguesResponses[200]['leagues'][number];
type BulkAddResult = AdminBulkAddGolfFieldEntriesResponses[200];

const rosterColumnHelper = createColumnHelper<RosterEntry>();
const rosterBrowseColumns = [
  rosterColumnHelper.accessor('name', {
    header: 'Player',
    cell: ({ getValue }) => (
      <span className="font-medium text-foreground">{getValue()}</span>
    ),
  }),
  rosterColumnHelper.accessor('worldRanking', { header: 'World rank' }),
];

/**
 * plans/124 §6.3 / §4.2 — "Add More Participants": pick a league, browse its
 * current roster in a multi-select grid (excluding golfers already in this
 * field), plus a free-text search across every `Participant` for the rarer
 * off-roster golfer. Both feed one selection set and one
 * `adminBulkAddGolfFieldEntries` submit.
 */
export function GolfFieldAddParticipantsModal({
  eventId,
  existingParticipantIds,
  onClose,
}: {
  eventId: string;
  existingParticipantIds: ReadonlySet<string>;
  onClose: () => void;
}) {
  const logger = getLogger().child({
    feature: 'root-admin-golf-tournament-field-page',
  });
  const [leagueId, setLeagueId] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<BulkAddResult | null>(null);

  const leaguesQuery = useQuery({
    queryKey: QueryKeys.rootAdmin.golf.tours,
    queryFn: async (): Promise<GolfLeague[]> => {
      const response = await adminListGolfLeagues();
      if (!response.data?.leagues) {
        throw response.error ?? new Error('Golf tour list response is missing data.');
      }
      return response.data.leagues;
    },
    retry: false,
  });

  const rosterQuery = useQuery({
    queryKey: QueryKeys.rootAdmin.golf.leagueRoster(leagueId),
    queryFn: async (): Promise<RosterEntry[]> => {
      const response = await adminGetGolfLeagueRoster({ path: { leagueId } });
      if (!response.data?.entries) {
        throw response.error ?? new Error('Golf tour roster response is missing data.');
      }
      return response.data.entries;
    },
    enabled: leagueId !== '',
    retry: false,
  });

  const searchTerm = search.trim();
  const searchQuery = useQuery({
    queryKey: QueryKeys.rootAdmin.golf.playerSearch(searchTerm),
    queryFn: async () => {
      const response = await adminListGolfPlayers({ query: { search: searchTerm } });
      if (!response.data?.players) {
        throw response.error ?? new Error('Golf player search response is missing data.');
      }
      return response.data.players;
    },
    enabled: searchTerm.length >= 2,
    retry: false,
  });

  const addMutation = useInvalidatingMutation({
    mutationFn: async (participantIds: string[]): Promise<BulkAddResult> => {
      const response = await adminBulkAddGolfFieldEntries({
        path: { eventId },
        body: { participantIds },
      });
      if (!response.data) {
        throw response.error ?? new Error('Bulk add response is missing data.');
      }
      return response.data;
    },
    invalidates: [
      QueryKeys.rootAdmin.golf.field(eventId),
      QueryKeys.rootAdmin.golf.tournament(eventId),
      QueryKeys.rootAdmin.golf.tournaments,
      QueryKeys.rootAdmin.golf.tiers(eventId),
    ],
    onSuccess: (data) => {
      setResult(data);
      setSelected(new Set());
    },
    onError: (error) => {
      logger.warn(
        { action: 'golf.field.bulkAdd.failed', err: error },
        'Bulk add golfers to field was rejected',
      );
    },
  });

  const browseRows = useMemo(
    () =>
      (rosterQuery.data ?? []).filter(
        (entry) => !existingParticipantIds.has(entry.participantId),
      ),
    [existingParticipantIds, rosterQuery.data],
  );

  const searchRows = useMemo(() => {
    const rosterIds = new Set(browseRows.map((row) => row.participantId));
    return (searchQuery.data ?? []).filter(
      (player) =>
        !existingParticipantIds.has(player.id) && !rosterIds.has(player.id),
    );
  }, [browseRows, existingParticipantIds, searchQuery.data]);

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function toggleAll(ids: string[], nextSelected: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (nextSelected) {
          next.add(id);
        } else {
          next.delete(id);
        }
      }
      return next;
    });
  }

  return (
    <Modal
      description="Pick a league to browse its current roster, or search every golfer by name. Golfers already in this field are hidden."
      footer={
        result ? (
          <Button data-testid="root-admin-golf-field-add-done" onClick={onClose} type="button">
            Done
          </Button>
        ) : (
          <>
            <Button
              disabled={addMutation.isPending}
              onClick={onClose}
              type="button"
              variant="secondary"
            >
              Cancel
            </Button>
            <Button
              data-testid="root-admin-golf-field-add-submit"
              disabled={selected.size === 0 || addMutation.isPending}
              isLoading={addMutation.isPending}
              onClick={() => addMutation.mutate([...selected])}
              type="button"
            >
              Add selected ({selected.size})
            </Button>
          </>
        )
      }
      onClose={onClose}
      onOpenChange={(next) => !next && onClose()}
      open
      size="xl"
      testId="root-admin-golf-field-add-modal"
      title="Add more participants"
    >
      <div className="space-y-4">
        {result ? (
          <Alert data-testid="root-admin-golf-field-add-result" tone="success">
            Added {result.added} golfer{result.added === 1 ? '' : 's'} to the field
            {result.skipped > 0
              ? ` (${result.skipped} were already in it).`
              : '.'}
          </Alert>
        ) : null}

        <FormField label="League">
          {leaguesQuery.isError ? (
            <ServerErrorBar
              error={leaguesQuery.error}
              fallback="We could not load the league list. Use the search below instead."
              title="Leagues unavailable"
            />
          ) : (
            <Select
              data-testid="root-admin-golf-field-add-league"
              disabled={leaguesQuery.isLoading || Boolean(result)}
              onChange={(event) => setLeagueId(event.target.value)}
              value={leagueId}
            >
              <option value="">
                {leaguesQuery.isLoading ? 'Loading leagues…' : 'Select a league to browse'}
              </option>
              {(leaguesQuery.data ?? []).map((league) => (
                <option key={league.id} value={league.id}>
                  {league.name}
                </option>
              ))}
            </Select>
          )}
        </FormField>

        {leagueId ? (
          rosterQuery.isError ? (
            <ServerErrorBar
              error={rosterQuery.error}
              fallback="We could not load that league's roster."
              title="Roster unavailable"
            />
          ) : (
            <SelectableDataGrid
              columns={rosterBrowseColumns}
              data={browseRows}
              emptyMessage={
                rosterQuery.isLoading
                  ? 'Loading roster…'
                  : 'Every golfer on that league’s roster is already in this field.'
              }
              getRowId={(entry) => entry.participantId}
              getRowLabel={(entry) => entry.name}
              onToggle={toggle}
              onToggleAll={toggleAll}
              rowTestId={(entry) => `root-admin-golf-field-add-roster-row-${entry.participantId}`}
              selectTestIdPrefix="root-admin-golf-field-add-roster-select"
              selectedIds={selected}
              tableTestId="root-admin-golf-field-add-roster-table"
            />
          )
        ) : null}

        <FormField
          helperText="Finds golfers who aren’t on any league’s current roster. Type at least 2 characters."
          label="Search all golfers"
        >
          <Input
            data-testid="root-admin-golf-field-add-search"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Name"
            type="search"
            value={search}
          />
        </FormField>

        {searchQuery.isError ? (
          <ServerErrorBar
            error={searchQuery.error}
            fallback="We could not search golfers right now."
            title="Search failed"
          />
        ) : searchRows.length > 0 ? (
          <ul
            className="divide-y divide-border rounded-2xl border border-border"
            data-testid="root-admin-golf-field-add-search-results"
          >
            {searchRows.map((player) => (
              <li className="flex items-center gap-3 px-4 py-2 text-sm" key={player.id}>
                <Checkbox
                  aria-label={`Select ${player.name}`}
                  checked={selected.has(player.id)}
                  data-testid={`root-admin-golf-field-add-search-select-${player.id}`}
                  onChange={() => toggle(player.id)}
                />
                <span className="font-medium text-foreground">{player.name}</span>
                <span className="text-muted-foreground">{player.nationality}</span>
              </li>
            ))}
          </ul>
        ) : searchTerm.length >= 2 && !searchQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">No new golfers matched that search.</p>
        ) : null}

        {addMutation.isError ? (
          <ServerErrorBar
            error={addMutation.error}
            fallback="We could not add the selected golfers."
            title="Add failed"
          />
        ) : null}
      </div>
    </Modal>
  );
}
