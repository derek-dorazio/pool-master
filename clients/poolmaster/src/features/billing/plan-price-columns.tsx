import { LeaguePlanOrder, type LeaguePlan } from '@poolmaster/shared/domain';
import { createColumnHelper } from '@tanstack/react-table';
import { enumLabel } from '@poolmaster/shared/display-strings';
import { formatMoneyCents } from '@/features/shared/ui';
import { describeEntriesIncluded, type PlanPriceRow } from './plan-price-rows';

const columnHelper = createColumnHelper<PlanPriceRow>();

/** The Plan prices grid's columns (#1886), each explained behind its (i). */
export function planPriceColumns(locale: string) {
  return [
    columnHelper.accessor('plan', {
      header: 'Plan',
      meta: {
        info: 'The league plan, lowest first.',
        type: { kind: 'enum', order: LeaguePlanOrder, label: (plan) => enumLabel('LeaguePlan', plan as LeaguePlan) },
      },
      cell: ({ row }) => row.original.label,
    }),
    columnHelper.accessor('yearlyCents', {
      header: 'Yearly',
      meta: { info: 'What a year of the plan costs. Nothing charges it while payments are off.', type: { kind: 'number' } },
      cell: ({ getValue }) => formatMoneyCents(getValue(), locale),
    }),
    columnHelper.accessor('monthlyCents', {
      header: 'Monthly',
      meta: { info: 'What a month of the plan costs. Nothing charges it while payments are off.', type: { kind: 'number' } },
      cell: ({ getValue }) => formatMoneyCents(getValue(), locale),
    }),
    columnHelper.accessor('entriesIncluded', {
      header: 'Entries included',
      meta: { info: 'Entries per contest the plan includes before an expansion. Set on the Plans page.', type: { kind: 'number' } },
      cell: ({ getValue }) => describeEntriesIncluded(getValue(), locale),
    }),
    columnHelper.accessor('expansions', {
      header: 'Expansions',
      meta: {
        info: 'The sizes a contest can be expanded to and their prices. A step up costs the difference; a band at or below the entries included is never offered.',
        type: { kind: 'text' },
      },
    }),
  ];
}
