import { useQuery } from '@tanstack/react-query';
import { createColumnHelper } from '@tanstack/react-table';
import { useMemo } from 'react';
import { adminListContestConfigTemplates } from '@/lib/api';
import {
  ManagementListPage,
  StatusBadge,
} from '@/features/shared/ui';
import { useLogger } from '@/lib/logger';
import type { ContestConfigTemplate } from './content-configuration-utils';

const columnHelper = createColumnHelper<ContestConfigTemplate>();

function extractErrorMessage(error: unknown, fallback: string) {
  if (!error || typeof error !== 'object') {
    return fallback;
  }

  const candidate = error as {
    error?: { message?: unknown };
    message?: unknown;
  };

  if (typeof candidate.error?.message === 'string') {
    return candidate.error.message;
  }

  if (typeof candidate.message === 'string') {
    return candidate.message;
  }

  return fallback;
}

export function RootAdminContentConfigurationListPage() {
  const logger = useLogger().child({
    feature: 'root-admin-content-configuration-list-page',
  });

  const templatesQuery = useQuery({
    queryKey: ['poolmaster', 'root-admin', 'contest-config-templates'],
    queryFn: async (): Promise<ContestConfigTemplate[]> => {
      const response = await adminListContestConfigTemplates();

      if (!response.data?.templates) {
        throw response.error ?? new Error('Contest template response is missing data.');
      }

      return response.data.templates;
    },
    retry: false,
  });

  const templates = [...(templatesQuery.data ?? [])].sort((left, right) => {
    if (left.sortOrder !== right.sortOrder) {
      return left.sortOrder - right.sortOrder;
    }
    return left.name.localeCompare(right.name);
  });

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
            <div className="mt-1 text-xs uppercase tracking-[0.14em] text-muted-foreground">
              {row.original.templateKey}
            </div>
            <div className="mt-2 max-w-xl text-sm text-muted-foreground">
              {row.original.description}
            </div>
          </div>
        ),
      }),
      columnHelper.accessor(
        (template) => `${template.sport} ${template.contestType}`,
        {
          id: 'scope',
          header: 'Scope',
          cell: ({ row }) => (
            <span className="text-muted-foreground">
              {row.original.sport} · {row.original.contestType}
            </span>
          ),
        },
      ),
      columnHelper.accessor('configMode', {
        header: 'Mode',
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
    <ManagementListPage
      columns={columns}
      data={templates}
      emptyMessage="No persisted contest templates are configured yet."
      errorBody={extractErrorMessage(
        templatesQuery.error,
        'We could not load contest templates right now.',
      )}
      getRowId={(template) => template.id}
      getRowLink={(template) =>
        `/manage/content-configuration/${template.templateKey}`
      }
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
      loadingBody="Loading contest templates..."
      state={
        templatesQuery.isLoading
          ? 'loading'
          : templatesQuery.isError
            ? 'error'
            : 'ready'
      }
      testId="root-admin-content-configuration-list-page"
    />
  );
}
