import { enumLabel } from '@poolmaster/shared/display-strings';
import { createColumnHelper } from '@tanstack/react-table';
import { type ParticipantAddedBy, ParticipantAddedByOrder, ParticipantType } from '@poolmaster/shared/domain';
import { Text } from '@/features/shared/ui';
import type { SportLeagueParticipantOverviewDto } from '@/lib/api';

type ParticipantRow = SportLeagueParticipantOverviewDto;

const columnHelper = createColumnHelper<ParticipantRow>();

/** The participant columns a league can show beyond its name and when it was added. */
export type ParticipantColumnId = 'ranking' | 'feedId' | 'lastInFeedAt' | 'nationality' | 'shortName' | 'teamAffiliation' | 'role';

/**
 * Which columns a league's Participants grid shows (the League page spec): Rank, Feed id and Last
 * in feed on every league, Country for individual players, Short name for teams, Team and
 * Position on a Clutch Card. A column no participant has a value for is left out, so none is
 * ever blank for the whole league.
 */
export function leagueParticipantColumnIds(
  participants: readonly ParticipantRow[],
  { isClutchCard }: { isClutchCard: boolean },
): ParticipantColumnId[] {
  const hasValue = (key: ParticipantColumnId, of: (participant: ParticipantRow) => boolean = () => true) =>
    participants.some((participant) => of(participant) && participant[key] !== null);
  const isIndividual = (participant: ParticipantRow) => participant.participantType === ParticipantType.INDIVIDUAL;
  const isTeam = (participant: ParticipantRow) => participant.participantType === ParticipantType.TEAM;
  const wanted: [ParticipantColumnId, boolean][] = [
    ['ranking', hasValue('ranking')],
    ['nationality', !isClutchCard && hasValue('nationality', isIndividual)],
    ['shortName', hasValue('shortName', isTeam)],
    ['teamAffiliation', isClutchCard && hasValue('teamAffiliation')],
    ['role', isClutchCard && hasValue('role')],
    ['feedId', hasValue('feedId')],
    ['lastInFeedAt', hasValue('lastInFeedAt')],
  ];
  return wanted.filter(([, shown]) => shown).map(([id]) => id);
}

const OPTIONAL_COLUMNS = {
  ranking: columnHelper.accessor('ranking', {
    header: 'Rank',
    meta: { info: 'Its rank in the league, 1 best. Blank when unranked.', type: { kind: 'number' } },
  }),
  nationality: columnHelper.accessor('nationality', {
    header: 'Country',
    meta: { info: 'The country the player represents.', type: { kind: 'enum' } },
  }),
  shortName: columnHelper.accessor('shortName', {
    header: 'Short name',
    meta: { info: 'The team\'s short name, where space is tight.', type: { kind: 'text' } },
  }),
  teamAffiliation: columnHelper.accessor('teamAffiliation', {
    header: 'Team',
    meta: { info: 'The team the player plays for.', type: { kind: 'enum' } },
  }),
  role: columnHelper.accessor('role', {
    header: 'Position',
    meta: { info: 'Where the player plays.', type: { kind: 'enum' } },
  }),
  feedId: columnHelper.accessor('feedId', {
    header: 'Feed id',
    meta: { info: 'The provider\'s id for it, which the syncs match on. Blank when no provider knows it.', type: { kind: 'text' } },
  }),
  lastInFeedAt: columnHelper.accessor('lastInFeedAt', {
    header: 'Last in feed',
    meta: { info: 'When a sync last saw it in the provider\'s feed.', type: { kind: 'datetime', direction: 'past' } },
  }),
} satisfies Record<ParticipantColumnId, unknown>;

/** The League page's Participants grid columns for the ids `leagueParticipantColumnIds` chose. */
export function leagueParticipantColumns(columnIds: readonly ParticipantColumnId[]) {
  return [
    columnHelper.accessor('name', {
      header: 'Participant',
      meta: { info: 'The player or team. ⤢ opens its details.', type: { kind: 'text' } },
      cell: ({ getValue }) => <Text variant="strong">{getValue()}</Text>,
    }),
    ...columnIds.map((id) => OPTIONAL_COLUMNS[id]),
    columnHelper.accessor('addedBy', {
      header: 'Added by',
      meta: {
        info: 'Feed: a sync found it in the provider\'s feed. Admin: added by hand.',
        type: { kind: 'enum', order: ParticipantAddedByOrder, label: (value) => enumLabel('ParticipantAddedBy', value as ParticipantAddedBy) },
      },
      cell: ({ getValue }) => enumLabel('ParticipantAddedBy', getValue()),
    }),
    columnHelper.accessor('createdAt', {
      header: 'Added',
      meta: { info: 'When it joined the league.', type: { kind: 'date', direction: 'past' } },
    }),
  ];
}
