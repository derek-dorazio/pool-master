import { createColumnHelper } from '@tanstack/react-table';
import { formatSelectionTypeName, SelectionTypeOrder, type SelectionType } from '@poolmaster/shared/domain';
import { useState } from 'react';
import { Chip, DataGrid, QueryState, SectionCard, Text } from '@/features/shared/ui';
import type { ContestConfigTemplateDto } from '@/lib/api';
import { extractErrorMessage } from '@/lib/errors';
import { LeagueContestTemplateDialog } from './league-contest-template-dialog';
import { useLeaguePage } from './league-page-context';
import { OnOffChip } from './on-off-chip';
import { LEAGUE_STATUS } from './sport-league-overview-columns';
import { useSportLeagueContestTemplatesQuery } from './use-sport-league-page';

const columnHelper = createColumnHelper<ContestConfigTemplateDto>();

const TEMPLATE_STATUS_OPTIONS = [
  { value: LEAGUE_STATUS.ON, label: 'On' },
  { value: LEAGUE_STATUS.OFF, label: 'Off' },
];

/** The Contest templates grid's columns: every one typed and explained behind its (i). */
const leagueContestTemplateColumns = [
  columnHelper.accessor('name', {
    header: 'Contest template',
    meta: { info: 'A ready-made contest setup commissioners start from. Default: the one picked first. ⤢ opens it.', type: { kind: 'text' } },
    cell: ({ row }) => (
      <span className="inline-flex items-center gap-2">
        <Text variant="strong">{row.original.name}</Text>
        {row.original.isDefault ? <Chip tone="info">Default</Chip> : null}
      </span>
    ),
  }),
  columnHelper.accessor('selectionType', {
    header: 'Selection type',
    meta: {
      info: 'How an entry picks in a contest made from it.',
      type: { kind: 'enum', order: SelectionTypeOrder, label: (value) => formatSelectionTypeName(value as SelectionType) },
    },
    cell: ({ getValue }) => formatSelectionTypeName(getValue()),
  }),
  columnHelper.accessor((template) => (template.active ? LEAGUE_STATUS.ON : LEAGUE_STATUS.OFF), {
    id: 'status',
    header: 'Status',
    meta: { info: 'On: commissioners can pick it. Off: hidden from new contests.', type: { kind: 'enum', values: TEMPLATE_STATUS_OPTIONS } },
    cell: ({ getValue }) => <OnOffChip on={getValue() === LEAGUE_STATUS.ON} />,
  }),
];

/**
 * The League page's Contest templates tab (#1866): the league's templates, seeded by migration,
 * in their create-flow order; ⤢ opens one to read, and to switch it on or off or make it the default.
 */
export function LeagueContestTemplatesTab() {
  const { sportLeague } = useLeaguePage();
  const templatesQuery = useSportLeagueContestTemplatesQuery(sportLeague.id);
  const [openTemplateId, setOpenTemplateId] = useState<string | null>(null);
  // poolmaster-allow-list-lookup: a league's handful of seeded templates
  const openTemplate = templatesQuery.data?.find((template) => template.id === openTemplateId);

  return (
    <SectionCard padded testId="root-admin-league-contest-templates" title="Contest templates">
      <QueryState
        error={extractErrorMessage(templatesQuery.error, { fallback: 'We could not load the contest templates right now.' })}
        loading="Loading contest templates..."
        query={templatesQuery}
        testId="root-admin-league-contest-templates-state"
      >
        {(templates) => (
          <DataGrid
            columns={leagueContestTemplateColumns}
            data={templates}
            emptyMessage="No contest templates for this league."
            filterTestIdPrefix="root-admin-league-contest-templates-filter"
            getRowId={(template) => template.id}
            openRowDialog={(template) => setOpenTemplateId(template.id)}
            rowTestId={(template) => `root-admin-league-contest-template-${template.templateKey}`}
            tableTestId="root-admin-league-contest-templates-table"
            urlKey="templates"
          />
        )}
      </QueryState>
      {openTemplate ? <LeagueContestTemplateDialog onClose={() => setOpenTemplateId(null)} template={openTemplate} /> : null}
    </SectionCard>
  );
}
