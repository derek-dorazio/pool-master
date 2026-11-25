import { createColumnHelper } from '@tanstack/react-table';
import { enumLabel, slotLabel } from '@poolmaster/shared/display-strings';
import { LeaguePhaseOrder, SeasonSlotStatusOrder, SlotKindOrder, SlotWindowStatusOrder, type LeaguePhase, type SeasonSlotStatus, type SlotKind, type SlotWindowStatus } from '@poolmaster/shared/domain';
import { useState } from 'react';
import { DataGrid, DetailEditModal, FactList, SectionCard, StatusBadge, Text, type Fact } from '@/features/shared/ui';
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
  seasonColumnHelper.accessor('slotsNeedingDates', {
    header: 'Needs dates',
    meta: { info: 'How many of its slots its provider places by date window still have no window or only a tentative one, in a Season the sync reads. Games are placed only inside a slot\'s dates.', type: { kind: 'number' } },
    cell: ({ getValue }) => <NeedsDatesBadge count={getValue()} />,
  }),
];

/** A warning badge with the count of slots that need dates, or a dash when none do (#1924). */
function NeedsDatesBadge({ count }: { count: number }) {
  return count === 0 ? <Text tone="muted">—</Text> : <StatusBadge tone="warning">{`Needs dates ${String(count)}`}</StatusBadge>;
}

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
    { id: 'needsDates', label: 'Needs dates', value: needsDatesText(season) },
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

/** Each phase with slots that need dates and how many ("Postseason 2"), or "None". */
function needsDatesText(season: SportLeagueSeasonDto): string {
  const phases = season.phases.filter((phase) => phase.slotsNeedingDates > 0);
  return phases.length === 0 ? 'None' : phases.map((phase) => `${enumLabel('LeaguePhase', phase.phase)} ${String(phase.slotsNeedingDates)}`).join(', ');
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
      cell: ({ getValue, row }) => (
        <span className="inline-flex flex-wrap items-center gap-2">
          <Text variant="strong">{getValue()}</Text>
          {row.original.needsDates ? <StatusBadge data-testid={`root-admin-league-structure-season-slot-${row.original.id}-needs-dates`} tone="warning">Needs dates</StatusBadge> : null}
        </span>
      ),
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
    slotColumnHelper.accessor((slot) => slot.window?.startsAt ?? null, {
      id: 'windowStartsAt',
      header: 'Window from',
      meta: { info: 'For a slot its provider places by date window: a game starting at or after this is placed in it, up to Window to. Set as data each Season; blank when it has none.', type: { kind: 'datetime', direction: 'both' } },
    }),
    slotColumnHelper.accessor((slot) => slot.window?.endsAt ?? null, {
      id: 'windowEndsAt',
      header: 'Window to',
      meta: { info: 'A game starting before this, and at or after Window from, is placed in the slot; one starting at this moment is not. Blank when it has no window.', type: { kind: 'datetime', direction: 'both' } },
    }),
    slotColumnHelper.accessor((slot) => slot.window?.status ?? null, {
      id: 'windowStatus',
      header: 'Window',
      meta: { info: 'Tentative: a best guess until the sync places a game between two of the event\'s seeds in it, which confirms it. Blank when it has no window.', type: { kind: 'enum', order: SlotWindowStatusOrder, label: (status) => enumLabel('SlotWindowStatus', status as SlotWindowStatus) } },
      cell: ({ getValue }) => {
        const status = getValue();
        return status === null ? '' : enumLabel('SlotWindowStatus', status);
      },
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
 * the current Season's. A slot's dates come from its games once the sync matches them; a slot placed
 * by date window shows its window, and a badge while the API says it needs dates (#1924).
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
