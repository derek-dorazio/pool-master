import { useQuery } from '@tanstack/react-query';
import { createColumnHelper } from '@tanstack/react-table';
import { useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import {
  adminAddGolfLeagueRosterEntry,
  adminListGolfPlayers,
  adminRemoveGolfLeagueRosterEntry,
  adminUpdateGolfLeagueRoster,
} from '@/lib/api';
import {
  Button,
  ConfirmationModal,
  DataGrid,
  Input,
  PickerModal,
  StatusBadge,
  Tile,
} from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import type { AdminListGolfPlayersResponses } from '@/lib/api';
import type { GolfLeagueRosterEntry } from './root-admin-golf-league-home-page';

type GolfPlayer = AdminListGolfPlayersResponses[200]['players'][number];

const columnHelper = createColumnHelper<GolfLeagueRosterEntry>();

type RosterGridMeta = {
  draft: Record<string, string>;
  setDraft: Dispatch<SetStateAction<Record<string, string>>>;
  onRemove: (entry: GolfLeagueRosterEntry) => void;
};

function isValidRank(raw: string): boolean {
  return /^\d+$/.test(raw.trim()) && Number(raw) > 0;
}

const rosterColumns = [
  columnHelper.accessor('name', {
    header: 'Golfer',
    cell: ({ getValue }) => (
      <span className="font-medium text-foreground">{getValue()}</span>
    ),
  }),
  columnHelper.accessor('worldRanking', {
    header: 'World rank',
    cell: ({ row, table }) => {
      const entry = row.original;
      const { draft, setDraft } = table.options.meta as RosterGridMeta;
      const raw = draft[entry.participantId] ?? String(entry.worldRanking);
      const invalid = raw.trim() !== '' && !isValidRank(raw);
      const errorId = invalid
        ? `root-admin-golf-league-roster-rank-error-${entry.participantId}`
        : undefined;
      return (
        <div className="max-w-[8rem]">
          <Input
            aria-describedby={errorId}
            aria-invalid={invalid || undefined}
            aria-label={`World rank for ${entry.name}`}
            data-testid={`root-admin-golf-league-roster-rank-${entry.participantId}`}
            inputMode="numeric"
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                [entry.participantId]: event.target.value,
              }))
            }
            value={raw}
          />
          {invalid ? (
            <p className="mt-1 text-xs text-destructive" id={errorId}>
              Enter a whole number above 0.
            </p>
          ) : null}
        </div>
      );
    },
    enableColumnFilter: false,
  }),
  columnHelper.accessor('status', {
    header: 'Status',
    cell: ({ getValue }) => (
      <StatusBadge tone={getValue() === 'ACTIVE' ? 'active' : 'inactive'}>
        {getValue()}
      </StatusBadge>
    ),
  }),
  columnHelper.display({
    id: 'actions',
    header: '',
    cell: ({ row, table }) => (
      <Button
        data-testid={`root-admin-golf-league-roster-remove-${row.original.participantId}`}
        onClick={() =>
          (table.options.meta as RosterGridMeta).onRemove(row.original)
        }
        size="sm"
        variant="danger"
      >
        Remove
      </Button>
    ),
    enableColumnFilter: false,
    enableSorting: false,
  }),
];

/**
 * plans/124 §6.3 Tour Home — the roster grid the admin maintains week to week.
 * Per-row world-ranking edits collect into a local draft (holding only the
 * edited cells, never seeded from the query — `rules/react-ui-rules.md` "Server
 * Data Form-State Hazard") and save in one call; an "Add golfer" picker and a
 * per-row remove round out roster membership.
 */
export function GolfLeagueRosterGridCard({
  entries,
  leagueId,
  rosterError,
  rosterLoading,
}: {
  entries: GolfLeagueRosterEntry[];
  leagueId: string;
  rosterError: string | null;
  rosterLoading: boolean;
}) {
  const logger = getLogger().child({
    feature: 'root-admin-golf-league-home-page',
  });

  const [draft, setDraft] = useState<Record<string, string>>({});
  const [draftLeagueId, setDraftLeagueId] = useState(leagueId);
  const [addOpen, setAddOpen] = useState(false);
  const [addSearch, setAddSearch] = useState('');
  const [addSelectedId, setAddSelectedId] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<GolfLeagueRosterEntry | null>(
    null,
  );

  if (draftLeagueId !== leagueId) {
    setDraftLeagueId(leagueId);
    setDraft({});
  }

  const playersQuery = useQuery({
    queryKey: QueryKeys.rootAdmin.golf.players,
    queryFn: async (): Promise<GolfPlayer[]> => {
      const response = await adminListGolfPlayers();
      if (!response.data?.players) {
        throw response.error ?? new Error('Golf player list response is missing data.');
      }
      return response.data.players;
    },
    enabled: addOpen,
    retry: false,
  });

  const saveMutation = useInvalidatingMutation({
    mutationFn: async (
      rows: Array<{ participantId: string; worldRanking: number }>,
    ) => {
      const response = await adminUpdateGolfLeagueRoster({
        path: { leagueId },
        body: { entries: rows },
      });
      if (!response.data?.entries) {
        throw response.error ?? new Error('Roster save response is missing data.');
      }
      return response.data.entries;
    },
    invalidates: [QueryKeys.rootAdmin.golf.leagueRoster(leagueId)],
    onSuccess: () => setDraft({}),
    onError: (error) => {
      logger.warn(
        { action: 'golf.tour.roster.save.failed', err: error },
        'Golf tour roster save was rejected',
      );
    },
  });

  const addMutation = useInvalidatingMutation({
    mutationFn: async (participantId: string) => {
      const response = await adminAddGolfLeagueRosterEntry({
        path: { leagueId },
        body: { participantId },
      });
      if (!response.data?.entry) {
        throw response.error ?? new Error('Add golfer response is missing data.');
      }
      return response.data.entry;
    },
    // tours: adminListGolfLeagues.rosterSize is the live affiliation count, so a
    // membership change updates that list too (disjoint prefix from leagueRoster).
    invalidates: [
      QueryKeys.rootAdmin.golf.leagueRoster(leagueId),
      QueryKeys.rootAdmin.golf.tours,
    ],
    onSuccess: () => {
      setAddOpen(false);
      setAddSelectedId(null);
      setAddSearch('');
    },
    onError: (error) => {
      logger.warn(
        { action: 'golf.tour.roster.add.failed', err: error },
        'Add golfer to tour roster was rejected',
      );
    },
  });

  const removeMutation = useInvalidatingMutation({
    mutationFn: async (participantId: string) => {
      const response = await adminRemoveGolfLeagueRosterEntry({
        path: { leagueId, participantId },
      });
      if (response.error) {
        throw response.error;
      }
      return participantId;
    },
    invalidates: [
      QueryKeys.rootAdmin.golf.leagueRoster(leagueId),
      QueryKeys.rootAdmin.golf.tours,
    ],
    onSuccess: () => setRemoveTarget(null),
    onError: (error) => {
      logger.warn(
        { action: 'golf.tour.roster.remove.failed', err: error },
        'Remove golfer from tour roster was rejected',
      );
    },
  });

  const dirtyRows = useMemo(
    () =>
      entries
        .filter((entry) => {
          const raw = draft[entry.participantId];
          return (
            raw !== undefined &&
            isValidRank(raw) &&
            Number(raw) !== entry.worldRanking
          );
        })
        .map((entry) => ({
          participantId: entry.participantId,
          worldRanking: Number(draft[entry.participantId]),
        })),
    [draft, entries],
  );

  const invalidCount = useMemo(
    () =>
      Object.entries(draft).filter(
        ([, raw]) => raw.trim() !== '' && !isValidRank(raw),
      ).length,
    [draft],
  );

  const rosterIds = useMemo(
    () => new Set(entries.map((entry) => entry.participantId)),
    [entries],
  );

  const addablePlayers = useMemo(() => {
    const term = addSearch.trim().toLowerCase();
    return (playersQuery.data ?? [])
      .filter((player) => !rosterIds.has(player.id))
      .filter((player) => term === '' || player.name.toLowerCase().includes(term))
      .map((player) => ({ id: player.id, name: player.name }));
  }, [addSearch, playersQuery.data, rosterIds]);

  const gridMeta = useMemo<RosterGridMeta>(
    () => ({ draft, setDraft, onRemove: setRemoveTarget }),
    [draft],
  );

  return (
    <Tile>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-foreground">Roster</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {entries.length} golfer{entries.length === 1 ? '' : 's'} on this tour.
          </p>
        </div>
        <Button
          data-testid="root-admin-golf-league-roster-add"
          onClick={() => {
            setAddSearch('');
            setAddSelectedId(null);
            setAddOpen(true);
          }}
          size="sm"
        >
          Add golfer
        </Button>
      </div>

      {rosterError ? (
        <p className="mt-3 text-sm font-medium text-destructive">{rosterError}</p>
      ) : null}

      <div className="mt-4">
        <DataGrid
          columns={rosterColumns}
          data={entries}
          emptyMessage={
            rosterLoading
              ? 'Loading roster…'
              : 'No golfers on this tour yet. Add golfers or use the bulk upload above.'
          }
          getRowId={(entry) => entry.participantId}
          meta={gridMeta}
          rowTestId={(entry) => `root-admin-golf-league-roster-row-${entry.participantId}`}
          tableTestId="root-admin-golf-league-roster-table"
        />
      </div>

      {dirtyRows.length > 0 || invalidCount > 0 ? (
        <div
          className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-muted/40 px-4 py-3"
          data-testid="root-admin-golf-league-roster-dirty-bar"
        >
          <span className="text-sm text-muted-foreground">
            {dirtyRows.length} unsaved ranking{dirtyRows.length === 1 ? '' : 's'}
            {invalidCount > 0
              ? ` · ${invalidCount} invalid value${invalidCount === 1 ? '' : 's'}`
              : ''}
          </span>
          <div className="flex gap-2">
            <Button
              data-testid="root-admin-golf-league-roster-discard"
              onClick={() => setDraft({})}
              size="sm"
              variant="secondary"
            >
              Discard
            </Button>
            <Button
              data-testid="root-admin-golf-league-roster-save"
              disabled={dirtyRows.length === 0 || invalidCount > 0}
              isLoading={saveMutation.isPending}
              onClick={() => saveMutation.mutate(dirtyRows)}
              size="sm"
            >
              Save changes
            </Button>
          </div>
        </div>
      ) : null}

      {saveMutation.isError ? (
        <p className="mt-3 text-sm font-medium text-destructive">
          {extractErrorMessage(saveMutation.error, {
            fallback: 'We could not save these rankings.',
          })}
        </p>
      ) : null}

      <PickerModal
        canApply={addSelectedId !== null}
        emptyMessage={
          playersQuery.isLoading
            ? 'Loading golfers…'
            : playersQuery.isError
              ? 'We could not load the golfer list.'
              : 'Every active golfer is already on this roster.'
        }
        getItemLabel={(item) => item.name}
        isPending={addMutation.isPending}
        items={addablePlayers}
        itemTestIdPrefix="root-admin-golf-league-roster-add-option"
        onApply={() => {
          if (addSelectedId) {
            addMutation.mutate(addSelectedId);
          }
        }}
        onCancel={() => setAddOpen(false)}
        onOpenChange={(next) => !next && setAddOpen(false)}
        onSelect={(item) => setAddSelectedId(item.id)}
        open={addOpen}
        search={{
          label: 'Search golfers',
          onChange: setAddSearch,
          placeholder: 'Name',
          value: addSearch,
        }}
        selectedId={addSelectedId}
        testId="root-admin-golf-league-roster-add-modal"
        title="Add golfer to roster"
      />

      <ConfirmationModal
        confirmLabel="Remove from tour"
        confirmTestId="root-admin-golf-league-roster-remove-confirm"
        description={
          removeTarget
            ? `Remove ${removeTarget.name} from this tour's roster. This does not retire the golfer — that is done from Player Home.`
            : ''
        }
        errorMessage={
          removeMutation.isError
            ? extractErrorMessage(removeMutation.error, {
                fallback: 'We could not remove this golfer.',
              })
            : undefined
        }
        isPending={removeMutation.isPending}
        onCancel={() => setRemoveTarget(null)}
        onConfirm={() => {
          if (removeTarget) {
            removeMutation.mutate(removeTarget.participantId);
          }
        }}
        onOpenChange={(next) => !next && setRemoveTarget(null)}
        open={removeTarget !== null}
        testId="root-admin-golf-league-roster-remove-modal"
        title="Remove golfer"
        tone="danger"
      />
    </Tile>
  );
}
