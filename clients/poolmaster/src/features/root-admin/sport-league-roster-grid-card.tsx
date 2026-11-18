import { createColumnHelper } from '@tanstack/react-table';
import { useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { ParticipantStatusOrder } from '@poolmaster/shared/domain';
import { updateSportLeagueParticipantRankings } from '@/lib/api';
import {
  Button,
  DataGrid,
  InlineError,
  Input,
  LinkButton,
  SectionCard,
  StatusBadge,
} from '@/features/shared/ui';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import type { ParticipantDto } from '@/lib/api';
import { buildSportParticipantListPath } from './manage-navigation';
import { participantStatusLabel } from './sport-admin-utils';
import { useSportLeagueNoun } from './use-sport-catalog';
import { useManagedSport } from './use-managed-sport';
import { upperFirst } from '@/lib/upper-first';

const columnHelper = createColumnHelper<ParticipantDto>();

type RosterGridMeta = {
  draft: Partial<Record<string, string>>;
  setDraft: Dispatch<SetStateAction<Partial<Record<string, string>>>>;
};

function isValidRank(raw: string): boolean {
  return /^\d+$/.test(raw.trim()) && Number(raw) > 0;
}

/** A drafted ranking: blank unranks. */
function draftedRank(raw: string): number | null {
  return raw.trim() === '' ? null : Number(raw);
}

/** The roster's columns, the first named for the sport's participant ("Golfer", "Horse"). */
const buildRosterColumns = (participantLabel: string) => [
  columnHelper.accessor('name', {
    header: participantLabel,
    meta: { info: "The participant's name.", type: { kind: 'text' } },
    cell: ({ getValue }) => (
      <span className="font-medium text-foreground">{getValue()}</span>
    ),
  }),
  columnHelper.accessor('ranking', {
    // The ranking the sport league keeps for the participant (#236), not a world ranking.
    header: 'Ranking',
    meta: { info: 'The ranking the sport league keeps for the participant, not a world ranking.', type: { kind: 'number' } },
    cell: ({ row, table }) => {
      const entry = row.original;
      const { draft, setDraft } = table.options.meta as RosterGridMeta;
      const raw = draft[entry.id] ?? (entry.ranking === null ? '' : String(entry.ranking));
      const invalid = raw.trim() !== '' && !isValidRank(raw);
      const errorId = invalid
        ? `root-admin-sport-league-roster-rank-error-${entry.id}`
        : undefined;
      return (
        <div className="max-w-[8rem]">
          <Input
            aria-describedby={errorId}
            aria-invalid={invalid || undefined}
            aria-label={`Ranking for ${entry.name}`}
            data-testid={`root-admin-sport-league-roster-rank-${entry.id}`}
            inputMode="numeric"
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                [entry.id]: event.target.value,
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
    meta: { info: 'Whether the participant is active on the roster.', type: { kind: 'enum', order: ParticipantStatusOrder, label: participantStatusLabel } },
    cell: ({ getValue }) => (
      <StatusBadge tone={getValue() === 'ACTIVE' ? 'active' : 'inactive'}>
        {getValue()}
      </StatusBadge>
    ),
  }),
];

/**
 * A sport league's page: its participants (#1853), the roster grid the admin maintains week to
 * week. Per-row ranking edits collect into a local draft (holding only the edited cells, never
 * seeded from the query — `rules/react-ui-rules.md` "Server Data Form-State Hazard") and save in
 * one call; a blank ranking unranks. A participant belongs to one league, so Add opens the new
 * participant page with this league chosen.
 */
export function SportLeagueRosterGridCard({
  entries,
  leagueId,
  rosterError,
  rosterLoading,
}: {
  entries: ParticipantDto[];
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
  const rosterColumns = useMemo(() => buildRosterColumns(upperFirst(participant.one)), [participant.one]);

  const [draft, setDraft] = useState<Partial<Record<string, string>>>({});
  const [draftLeagueId, setDraftLeagueId] = useState(leagueId);

  if (draftLeagueId !== leagueId) {
    setDraftLeagueId(leagueId);
    setDraft({});
  }

  const saveMutation = useInvalidatingMutation({
    mutationFn: async (
      rows: Array<{ participantId: string; ranking: number | null }>,
    ) => {
      const response = await updateSportLeagueParticipantRankings({
        path: { sportLeagueId: leagueId },
        body: { rankings: rows },
      });
      if (!response.data?.participants) {
        throwApiError(response.error, 'Roster save response is missing data.');
      }
      return response.data.participants;
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

  const dirtyRows = useMemo(
    () =>
      entries
        .filter((entry) => {
          const raw = draft[entry.id];
          return (
            raw !== undefined &&
            (raw.trim() === '' || isValidRank(raw)) &&
            draftedRank(raw) !== entry.ranking
          );
        })
        .map((entry) => ({
          participantId: entry.id,
          ranking: draftedRank(draft[entry.id] ?? ''),
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

  const gridMeta = useMemo<RosterGridMeta>(
    () => ({ draft, setDraft }),
    [draft],
  );

  return (
    <SectionCard
      headingLevel={3}
      padded
      title="Roster"
      trailing={(
        <LinkButton
          data-testid="root-admin-sport-league-roster-add"
          size="sm"
          to={`${buildSportParticipantListPath(sport)}/new?sportLeague=${leagueId}`}
        >
          {`Add ${participant.one}`}
        </LinkButton>
      )}
    >
      <p className="text-sm text-muted-foreground">
        {`${entries.length} ${entries.length === 1 ? participant.one : participant.many} in this ${sportLeague.one}.`}
      </p>

      {rosterError ? (
        <InlineError>{rosterError}</InlineError>
      ) : null}

      <DataGrid
        urlKey="roster"
        columns={rosterColumns}
        data={entries}
        emptyMessage={
          rosterLoading
            ? 'Loading roster...'
            : `No ${participant.many} in this ${sportLeague.one} yet. Add ${participant.many} here, or let the ${sportLeague.one}'s sync bring them.`
        }
        getRowId={(entry) => entry.id}
        meta={gridMeta}
        rowTestId={(entry) => `root-admin-sport-league-roster-row-${entry.id}`}
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

    </SectionCard>
  );
}
