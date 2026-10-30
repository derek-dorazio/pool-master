import { createColumnHelper } from '@tanstack/react-table';
import { useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import {
  createParticipantLeagueAffiliation,
  deleteParticipantLeagueAffiliation,
  updateParticipantLeagueAffiliationRankings,
} from '@/lib/api';
import {
  Button,
  ConfirmationModal,
  DataGrid,
  InlineError,
  Input,
  PanelCard,
  PickerModal,
  StatusBadge,
} from '@/features/shared/ui';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import type { ParticipantLeagueAffiliationDto } from '@/lib/api';
import { capitalize } from './manage-navigation';
import { useParticipantsQuery, useSportLeagueNoun } from './use-sport-catalog';
import { useManagedSport } from './use-managed-sport';

const columnHelper = createColumnHelper<ParticipantLeagueAffiliationDto>();

type RosterGridMeta = {
  draft: Partial<Record<string, string>>;
  setDraft: Dispatch<SetStateAction<Partial<Record<string, string>>>>;
  onRemove: (entry: ParticipantLeagueAffiliationDto) => void;
};

function isValidRank(raw: string): boolean {
  return /^\d+$/.test(raw.trim()) && Number(raw) > 0;
}

/** The roster's columns, the first named for the sport's participant ("Golfer", "Horse"). */
const buildRosterColumns = (participantLabel: string) => [
  columnHelper.accessor((entry) => entry.participant.name, {
    id: 'name',
    header: participantLabel,
    cell: ({ getValue }) => (
      <span className="font-medium text-foreground">{getValue()}</span>
    ),
  }),
  columnHelper.accessor('ranking', {
    // The ranking the sport league keeps for the participant (#236), not a world ranking.
    header: 'Ranking',
    cell: ({ row, table }) => {
      const entry = row.original;
      const { draft, setDraft } = table.options.meta as RosterGridMeta;
      const raw = draft[entry.participantId] ?? String(entry.ranking);
      const invalid = raw.trim() !== '' && !isValidRank(raw);
      const errorId = invalid
        ? `root-admin-sport-league-roster-rank-error-${entry.participantId}`
        : undefined;
      return (
        <div className="max-w-[8rem]">
          <Input
            aria-describedby={errorId}
            aria-invalid={invalid || undefined}
            aria-label={`Ranking for ${entry.participant.name}`}
            data-testid={`root-admin-sport-league-roster-rank-${entry.participantId}`}
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
  columnHelper.accessor((entry) => entry.participant.status, {
    id: 'status',
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
        data-testid={`root-admin-sport-league-roster-remove-${row.original.participantId}`}
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
 * A sport league's page: the roster grid the admin maintains week to week.
 * Per-row ranking edits collect into a local draft (holding only the
 * edited cells, never seeded from the query — `rules/react-ui-rules.md` "Server
 * Data Form-State Hazard") and save in one call; an "Add golfer" picker and a
 * per-row remove round out roster membership.
 */
export function SportLeagueRosterGridCard({
  entries,
  leagueId,
  rosterError,
  rosterLoading,
}: {
  entries: ParticipantLeagueAffiliationDto[];
  leagueId: string;
  rosterError: string | null;
  rosterLoading: boolean;
}) {
  const logger = getLogger().child({
    feature: 'root-admin-sport-league-home-page',
  });
  const { sport, definition } = useManagedSport();
  const { participant } = definition.vocabulary;
  const sportLeague = useSportLeagueNoun(sport, leagueId);
  const rosterColumns = useMemo(() => buildRosterColumns(capitalize(participant.one)), [participant.one]);

  const [draft, setDraft] = useState<Partial<Record<string, string>>>({});
  const [draftLeagueId, setDraftLeagueId] = useState(leagueId);
  const [addOpen, setAddOpen] = useState(false);
  const [addSearch, setAddSearch] = useState('');
  const [addSelectedId, setAddSelectedId] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<ParticipantLeagueAffiliationDto | null>(
    null,
  );

  if (draftLeagueId !== leagueId) {
    setDraftLeagueId(leagueId);
    setDraft({});
  }

  const playersQuery = useParticipantsQuery({
    sport,
    queryKey: QueryKeys.rootAdmin.manageSport.participantList(sport, 'ACTIVE'),
    status: 'ACTIVE',
    enabled: addOpen,
  });

  const saveMutation = useInvalidatingMutation({
    mutationFn: async (
      rows: Array<{ participantId: string; ranking: number }>,
    ) => {
      const response = await updateParticipantLeagueAffiliationRankings({
        path: { sportLeagueId: leagueId },
        body: { rankings: rows },
      });
      if (!response.data?.affiliations) {
        throwApiError(response.error, 'Roster save response is missing data.');
      }
      return response.data.affiliations;
    },
    invalidates: [QueryKeys.rootAdmin.manageSport.leagueRoster(leagueId)],
    onSuccess: () => setDraft({}),
    onError: (error) => {
      logger.warn(
        { action: 'sportLeague.roster.save.failed', err: error },
        'Sport league roster save was rejected',
      );
    },
  });

  const addMutation = useInvalidatingMutation({
    mutationFn: async (participantId: string) => {
      const response = await createParticipantLeagueAffiliation({
        path: { sportLeagueId: leagueId },
        body: { participantId },
      });
      if (!response.data?.affiliation) {
        throwApiError(response.error, 'Add participant response is missing data.');
      }
      return response.data.affiliation;
    },
    // tours: each sport league's affiliationCount is the live count, so a
    // membership change updates that list too (disjoint prefix from leagueRoster).
    invalidates: [
      QueryKeys.rootAdmin.manageSport.leagueRoster(leagueId),
      QueryKeys.rootAdmin.manageSport.leagues,
    ],
    onSuccess: () => {
      setAddOpen(false);
      setAddSelectedId(null);
      setAddSearch('');
    },
    onError: (error) => {
      logger.warn(
        { action: 'sportLeague.roster.add.failed', err: error },
        'Add participant to sport league roster was rejected',
      );
    },
  });

  const removeMutation = useInvalidatingMutation({
    mutationFn: async (participantId: string) => {
      const response = await deleteParticipantLeagueAffiliation({
        path: { sportLeagueId: leagueId, participantId },
      });
      if (response.error) {
        throwApiError(response.error);
      }
      return participantId;
    },
    invalidates: [
      QueryKeys.rootAdmin.manageSport.leagueRoster(leagueId),
      QueryKeys.rootAdmin.manageSport.leagues,
    ],
    onSuccess: () => setRemoveTarget(null),
    onError: (error) => {
      logger.warn(
        { action: 'sportLeague.roster.remove.failed', err: error },
        'Remove participant from sport league roster was rejected',
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
            Number(raw) !== entry.ranking
          );
        })
        .map((entry) => ({
          participantId: entry.participantId,
          ranking: Number(draft[entry.participantId]),
        })),
    [draft, entries],
  );

  const invalidCount = useMemo(
    () =>
      Object.entries(draft).filter(
        ([, raw]) => raw !== undefined && raw.trim() !== '' && !isValidRank(raw),
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
    <PanelCard
      headingLevel={3}
      padded
      title="Roster"
      trailing={(
        <Button
          data-testid="root-admin-sport-league-roster-add"
          onClick={() => {
            setAddSearch('');
            setAddSelectedId(null);
            setAddOpen(true);
          }}
          size="sm"
        >
          {`Add ${participant.one}`}
        </Button>
      )}
    >
      <p className="text-sm text-muted-foreground">
        {`${entries.length} ${entries.length === 1 ? participant.one : participant.many} on this ${sportLeague.one}.`}
      </p>

      {rosterError ? (
        <InlineError>{rosterError}</InlineError>
      ) : null}

      <DataGrid
        columns={rosterColumns}
        data={entries}
        emptyMessage={
          rosterLoading
            ? 'Loading roster...'
            : `No ${participant.many} on this ${sportLeague.one} yet. Add ${participant.many} or use the bulk upload above.`
        }
        getRowId={(entry) => entry.participantId}
        meta={gridMeta}
        rowTestId={(entry) => `root-admin-sport-league-roster-row-${entry.participantId}`}
        tableTestId="root-admin-sport-league-roster-table"
      />

      {dirtyRows.length > 0 || invalidCount > 0 ? (
        <div
          className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-muted/40 px-4 py-3"
          data-testid="root-admin-sport-league-roster-dirty-bar"
        >
          <span className="text-sm text-muted-foreground">
            {dirtyRows.length} unsaved ranking{dirtyRows.length === 1 ? '' : 's'}
            {invalidCount > 0
              ? ` · ${invalidCount} invalid value${invalidCount === 1 ? '' : 's'}`
              : ''}
          </span>
          <div className="flex gap-2">
            <Button
              data-testid="root-admin-sport-league-roster-discard"
              onClick={() => setDraft({})}
              size="sm"
              variant="secondary"
            >
              Discard
            </Button>
            <Button
              data-testid="root-admin-sport-league-roster-save"
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
        <InlineError>
          {extractErrorMessage(saveMutation.error, {
            fallback: 'We could not save these rankings.',
          })}
        </InlineError>
      ) : null}

      <PickerModal
        canApply={addSelectedId !== null}
        emptyMessage={
          playersQuery.isLoading
            ? `Loading ${participant.many}...`
            : playersQuery.isError
              ? `We could not load the ${participant.one} list.`
              : `Every active ${participant.one} is already on this roster.`
        }
        getItemLabel={(item) => item.name}
        isPending={addMutation.isPending}
        items={addablePlayers}
        itemTestIdPrefix="root-admin-sport-league-roster-add-option"
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
          label: `Search ${participant.many}`,
          onChange: setAddSearch,
          placeholder: 'Name',
          value: addSearch,
        }}
        selectedId={addSelectedId}
        testId="root-admin-sport-league-roster-add-modal"
        title={`Add ${participant.one} to roster`}
      />

      <ConfirmationModal
        confirmLabel={`Remove from ${sportLeague.one}`}
        confirmTestId="root-admin-sport-league-roster-remove-confirm"
        description={
          removeTarget
            ? `Remove ${removeTarget.participant.name} from this ${sportLeague.one}'s roster. This does not retire the ${participant.one}; do that from the ${participant.one}'s own page.`
            : ''
        }
        errorMessage={
          removeMutation.isError
            ? extractErrorMessage(removeMutation.error, {
                fallback: `We could not remove this ${participant.one}.`,
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
        testId="root-admin-sport-league-roster-remove-modal"
        title={`Remove ${participant.one}`}
        tone="danger"
      />
    </PanelCard>
  );
}
