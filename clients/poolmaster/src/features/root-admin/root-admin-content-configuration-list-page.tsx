import { createColumnHelper } from '@tanstack/react-table';
import { useMemo, useState } from 'react';
import {
  DataGrid,
  Input,
  PageHeader,
  QueryState,
  StatusBadge,
} from '@/features/shared/ui';
import { getLogger } from '@/lib/logger';
import type { ContestConfigTemplate } from './content-configuration-utils';
import { useContestConfigTemplatesQuery } from './use-contest-config-templates-query';
import { MANAGE_LIST_PAGE_SIZE } from './manage-navigation';

const columnHelper = createColumnHelper<ContestConfigTemplate>();

export function RootAdminContentConfigurationListPage() {
  const logger = getLogger().child({
    feature: 'root-admin-content-configuration-list-page',
  });

  const templatesQuery = useContestConfigTemplatesQuery();
  const [searchTerm, setSearchTerm] = useState('');

  const columns = useMemo(
    () => [
      columnHelper.accessor((template) => `${template.name} ${template.templateKey}`, {
        id: 'template',
        header: 'Template',
        cell: ({ row }) => (
          <div>
            <div className="text-sm font-semibold text-primary">
              {row.original.name}
            </div>
            <div className="mt-1 text-xs uppercase text-muted-foreground">
              {row.original.templateKey}
            </div>
            <div className="mt-2 max-w-xl text-sm text-muted-foreground">
              {row.original.description}
            </div>
          </div>
        ),
      }),
      columnHelper.accessor(
        (template) => `${template.sport} ${template.contestFormat}`,
        {
          id: 'scope',
          header: 'Scope',
          cell: ({ row }) => (
            <span className="text-muted-foreground">
              {row.original.sport} · {row.original.contestFormat}
            </span>
          ),
        },
      ),
      columnHelper.accessor('selectionType', {
        header: 'Selection',
        cell: ({ getValue }) => (
          <span className="text-muted-foreground">{getValue()}</span>
        ),
      }),
      columnHelper.accessor(
        (template) =>
          [template.active ? 'Active' : 'Inactive', template.isDefault ? 'Default' : '']
            .filter(Boolean)
            .join(' '),
        {
          id: 'status',
          header: 'Status',
          cell: ({ row }) => (
            <div className="flex flex-wrap gap-2">
              <StatusBadge tone={row.original.active ? 'active' : 'neutral'}>
                {row.original.active ? 'Active' : 'Inactive'}
              </StatusBadge>
              {row.original.isDefault ? (
                <StatusBadge tone="info">Default</StatusBadge>
              ) : null}
            </div>
          ),
        },
      ),
    ],
    [],
  );

  return (
    <section className="space-y-6" data-testid="root-admin-content-configuration-list-page">
      <PageHeader
        search={(
          <Input
            aria-label="Find a template"
            data-testid="root-admin-content-config-search"
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Find a template"
            type="search"
            value={searchTerm}
          />
        )}
        testId="root-admin-content-configuration-header"
        title="Content"
      />
      <QueryState
        error="We could not load contest templates right now."
        loading="Loading contest templates..."
        query={templatesQuery}
        testId="root-admin-content-configuration"
      >
        {(loaded) => (
          <DataGrid
            columns={columns}
            data={[...loaded].sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name))}
            emptyMessage="No contest templates are configured yet."
            getRowId={(template) => template.id}
            getRowLink={(template) => `/manage/content-configuration/${template.templateKey}`}
            getRowLinkProps={(template) => ({
              'data-testid': `root-admin-content-config-link-${template.templateKey}`,
              onClick: () => {
                logger.info(
                  {
                    action: 'rootAdmin.contentConfiguration.openTemplate',
                    data: {
                      templateId: template.id,
                      templateKey: template.templateKey,
                    },
                  },
                  'Opened root-admin content configuration detail page',
                );
              },
            })}
            pageSize={MANAGE_LIST_PAGE_SIZE}
            searchTerm={searchTerm}
          />
        )}
      </QueryState>
    </section>
  );
}
