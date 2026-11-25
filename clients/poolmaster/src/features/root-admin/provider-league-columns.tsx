import { enumLabel } from '@poolmaster/shared/display-strings';
import { createColumnHelper } from '@tanstack/react-table';
import type { ExplicitEnumOrder, Sport } from '@poolmaster/shared/domain';

/** One provider league with its provider's name, as the Provider leagues grid shows it. */
export interface ProviderLeagueRow {
  providerId: string;
  providerName: string;
  id: string;
  code: string;
  name: string;
  sport: Sport;
  quietAfterMinutes: number;
  typicalGameMinutes: number;
  isEnabled: boolean;
}

const columnHelper = createColumnHelper<ProviderLeagueRow>();

/**
 * The Provider leagues grid's columns (#1997), each explained behind its (i). The sport column
 * sorts in the sports' display order, which the API gives (`sportDisplayOrder`).
 */
export const providerLeagueColumns = (sportOrder: ExplicitEnumOrder<string>) => [
  columnHelper.accessor('providerName', {
    header: 'Provider',
    meta: { info: 'The provider whose league it is.', type: { kind: 'text' } },
  }),
  columnHelper.accessor('name', {
    header: 'League',
    meta: { info: 'The provider\'s own name for the league; its code is what its API calls it.', type: { kind: 'text' } },
  }),
  columnHelper.accessor('code', {
    header: 'Code',
    meta: { info: 'The provider\'s own code for the league.', type: { kind: 'text' } },
  }),
  columnHelper.accessor('sport', {
    header: 'Sport',
    meta: {
      info: 'The sport the league plays: only a sport league of the same sport can map to it.',
      type: { kind: 'enum', order: sportOrder, label: (sport) => enumLabel('Sport', sport as Sport) },
    },
    cell: ({ getValue }) => enumLabel('Sport', getValue()),
  }),
  columnHelper.accessor('isEnabled', {
    header: 'On',
    meta: { info: 'Whether the provider\'s adapter reads the league. A change takes effect when the servers next start.', type: { kind: 'boolean' } },
    cell: ({ getValue }) => (getValue() ? 'On' : 'Off'),
  }),
  columnHelper.accessor('typicalGameMinutes', {
    header: 'Typical game (min)',
    meta: { info: 'How long one of its games usually takes; a game with no scheduled end is overdue this long after its start plus the overdue wait.', type: { kind: 'number' } },
  }),
  columnHelper.accessor('quietAfterMinutes', {
    header: 'Webhook quiet (min)',
    meta: { info: 'How long a game may go between two webhook notifications in normal play before the live-score sweep warns.', type: { kind: 'number' } },
  }),
];
