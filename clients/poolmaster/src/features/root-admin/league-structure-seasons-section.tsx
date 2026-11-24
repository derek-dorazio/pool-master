import { createColumnHelper } from '@tanstack/react-table';
import { enumLabel, slotLabel } from '@poolmaster/shared/display-strings';
import { LeaguePhaseOrder, SeasonSlotStatusOrder, SlotKindOrder, type LeaguePhase, type SeasonSlotStatus, type SlotKind } from '@poolmaster/shared/domain';
import { useState } from 'react';
import { DataGrid, DetailEditModal, FactList, SectionCard, Text, type Fact } from '@/features/shared/ui';
import type { SportLeagueSeasonDto } from '@/lib/api';
import { seasonSlotRowsOf, seasonMappingText, type SeasonSlotRow } from './league-structure-rows';

const seasonColumnHelper = createColumnHelper<SportLeagueSeasonDto>();

/** The Seasons grid's columns, each explained behind its (i). */
const seasonColumns = [
  seasonColumnHelper.accessor('name', {
    header: 'Season',
    meta: { info: 'What screens call the Season. ⤢ opens it.', type: { kind: 'text' } },
    cell: ({ getValue }) => <Text variant="strong">{getValue()}</Text>,
  }),
  seasonColumnHelper.accessor('championshipYear', {
    header: 'Championship year',
    meta: { info: 'The year the Season is named for, which cups and trophies count it in.', type: { kind: 'number' } },
  }),
  seasonColumnHelper.accessor((season) => ({ start: season.startsAt, end: season.endsAt }), {
    id: 'span',
    header: 'Dates',
    meta: { info: 'The Season\'s first and last day, in the league\'s time zone.', type: { kind: 'dateRange', direction: 'both' } },
  }),
  seasonColumnHelper.accessor('isCurrent', {
    header: 'Current',
    meta: { info: 'Whether it is the league\'s current Season, which the sync, new events and Season pickers start from. Set once a day.', type: { kind: 'boolean' } },
    cell: ({ getValue }) => (getValue() ? 'Yes' : 'No'),
  }),
  seasonColumnHelper.accessor((season) => season.providerMappings.map(seasonMappingText).join(', '), {
    id: 'providers',
    header: 'Provider ids',
    meta: { info: 'Each provider\'s own id for the Season, as the sync asks for it. Blank: no provider syncs it.', type: { kind: 'text' } },
  }),
];

/**
 * The Structure tab's Seasons section (#2003): the league's Seasons, latest first, added by
 * migration, with the league's time zone above them; ⤢ opens one to read.
 */
export function LeagueStructureSeasonsSection({ seasons, timeZone }: { seasons: readonly SportLeagueSeasonDto[]; timeZone: string }) {
  const [openSeasonId, setOpenSeasonId] = useState<string | null>(null);
  const openSeason = seasons.find((season) => season.id === openSeasonId);

  return (
    <SectionCard padded testId="root-admin-league-structure-seasons" title="Seasons">
      <FactList facts={[{ id: 'timeZone', label: 'Time zone', value: timeZone }]} testId="root-admin-league-structure-seasons-facts" />
      <DataGrid
        columns={seasonColumns}
        data={[...seasons]}
        emptyMessage="No Seasons for this league."
        filterTestIdPrefix="root-admin-league-structure-seasons-filter"
        getRowId={(season) => season.id}
        openRowDialog={(season) => setOpenSeasonId(season.id)}
        rowTestId={(season) => `root-admin-league-structure-season-${season.championshipYear}`}
        tableTestId="root-admin-league-structure-seasons-table"
        urlKey="seasons"
      />
      {openSeason ? <SeasonDialog onClose={() => setOpenSeasonId(null)} season={openSeason} /> : null}
    </SectionCard>
  );
}

/** A Season to read, with no Edit: migrations own these rows. */
function SeasonDialog({ onClose, season }: { onClose: () => void; season: SportLeagueSeasonDto }) {
  const facts: Fact[] = [
    { id: 'name', label: 'Season', value: season.name },
    { id: 'championshipYear', label: 'Championship year', value: String(season.championshipYear) },
    { id: 'current', label: 'Current', value: season.isCurrent ? 'Yes' : 'No' },
    { id: 'providers', label: 'Provider ids', value: season.providerMappings.map(seasonMappingText).join(', ') || 'None' },
    { id: 'slots', label: 'Slots', value: String(season.phases.reduce((count, phase) => count + phase.slots.length, 0)) },
  ];
  return (
    <DetailEditModal
      facts={facts}
      mode="view"
      onCancel={onClose}
      onOpenChange={(open) => (open ? undefined : onClose())}
      open
      testId="root-admin-league-structure-season"
      title={season.name}
    />
  );
}

const slotColumnHelper = createColumnHelper<SeasonSlotRow>();

/** The Season slots grid's columns, each explained behind its (i). */
function seasonSlotColumns(seasons: readonly SportLeagueSeasonDto[]) {
  const current = seasons.find((season) => season.isCurrent);
  return [
    slotColumnHelper.accessor('seasonId', {
      id: 'season',
      header: 'Season',
      meta: {
        info: 'The Season the slot is played in. Starts filtered to the current Season.',
        type: {
          kind: 'enum',
          values: seasons.map((season) => ({ value: season.id, label: season.name })),
          initial: current === undefined ? undefined : [current.id],
        },
      },
      cell: ({ row }) => row.original.seasonName,
    }),
    slotColumnHelper.accessor('phase', {
      header: 'Phase',
      meta: { info: 'The phase the slot is in.', type: { kind: 'enum', order: LeaguePhaseOrder, label: (phase) => enumLabel('LeaguePhase', phase as LeaguePhase) } },
      cell: ({ getValue }) => enumLabel('LeaguePhase', getValue()),
    }),
    slotColumnHelper.accessor((slot) => slotLabel(slot), {
      id: 'slot',
      header: 'Slot',
      meta: { info: 'The slot definition it plays: its own name, else the word for its kind.', type: { kind: 'text' } },
      cell: ({ getValue }) => <Text variant="strong">{getValue()}</Text>,
    }),
    slotColumnHelper.accessor('slotKind', {
      header: 'Kind',
      meta: { info: 'What the slot is in its phase.', type: { kind: 'enum', order: SlotKindOrder, label: (kind) => enumLabel('SlotKind', kind as SlotKind) } },
      cell: ({ getValue }) => enumLabel('SlotKind', getValue()),
    }),
    slotColumnHelper.accessor('startsAt', {
      header: 'Starts',
      meta: { info: 'The earliest start of its games. Blank until the sync has matched one.', type: { kind: 'datetime', direction: 'both' } },
    }),
    slotColumnHelper.accessor('endsAt', {
      header: 'Ends',
      meta: { info: 'The latest end of its games. Blank until the sync has matched one.', type: { kind: 'datetime', direction: 'both' } },
    }),
    slotColumnHelper.accessor('status', {
      header: 'Status',
      meta: { info: 'Where the slot is in its Season.', type: { kind: 'enum', order: SeasonSlotStatusOrder, label: (status) => enumLabel('SeasonSlotStatus', status as SeasonSlotStatus) } },
      cell: ({ getValue }) => enumLabel('SeasonSlotStatus', getValue()),
    }),
    slotColumnHelper.accessor('label', {
      header: 'Test label',
      meta: { info: 'A test slot\'s label: QA only, never read or written by the sync. Blank on a synced slot.', type: { kind: 'text' } },
      cell: ({ getValue }) => getValue() ?? '',
    }),
  ];
}

/**
 * The Structure tab's Season slots section (#2003): every Season's slots in play order, opening on
 * the current Season's. A slot's dates come from its games once the sync matches them.
 */
export function LeagueStructureSeasonSlotsSection({ seasons }: { seasons: readonly SportLeagueSeasonDto[] }) {
  return (
    <SectionCard padded testId="root-admin-league-structure-season-slots" title="Season slots">
      <DataGrid
        columns={seasonSlotColumns(seasons)}
        data={seasonSlotRowsOf(seasons)}
        emptyMessage="No Season slots for this league."
        filterTestIdPrefix="root-admin-league-structure-season-slots-filter"
        getRowId={(slot) => slot.id}
        rowTestId={(slot) => `root-admin-league-structure-season-slot-${slot.id}`}
        tableTestId="root-admin-league-structure-season-slots-table"
        urlKey="season-slots"
      />
    </SectionCard>
  );
}
