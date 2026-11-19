import { createColumnHelper } from '@tanstack/react-table';
import { Text } from '@/features/shared/ui';
import { LeaguePlanOrder, type LeaguePlan } from '@poolmaster/shared/domain';
import type { CustomerLeagueDto } from '@/lib/api';
import { LEAGUE_PLAN_LABEL } from '@/features/plans/plan-labels';

const columnHelper = createColumnHelper<CustomerLeagueDto>();

/** The Customers › Leagues grid's columns (#1883), each explained behind its (i). */
export const customerLeagueColumns = [
  columnHelper.accessor('name', {
    header: 'League',
    meta: { info: 'The league\'s name.', type: { kind: 'text' } },
    cell: ({ getValue }) => <Text tone="primary" variant="strong">{getValue()}</Text>,
  }),
  columnHelper.accessor('leagueCode', {
    header: 'Code',
    meta: { info: 'The league\'s short code, used in its web address.', type: { kind: 'text' } },
  }),
  columnHelper.accessor('plan', {
    header: 'Plan',
    meta: {
      info: 'The plan the league is on, which decides its features and caps.',
      type: { kind: 'enum', order: LeaguePlanOrder, label: (plan) => LEAGUE_PLAN_LABEL[plan as LeaguePlan] },
    },
    cell: ({ getValue }) => LEAGUE_PLAN_LABEL[getValue()],
  }),
  columnHelper.accessor('memberCount', {
    header: 'Members',
    meta: { info: 'Active members of the league.', type: { kind: 'number' } },
  }),
  columnHelper.accessor('activeContestCount', {
    header: 'Active contests',
    meta: { info: 'Open and live contests. Contests still being set up are not counted.', type: { kind: 'number' } },
  }),
  columnHelper.accessor('previewEndsAt', {
    header: 'Premium preview ends',
    meta: {
      info: 'When the league\'s free Premium preview ends. Blank once it has ended.',
      type: { kind: 'date', direction: 'future' },
    },
  }),
];
