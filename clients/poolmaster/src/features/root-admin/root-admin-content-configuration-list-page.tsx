import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { adminListContestConfigTemplates } from '@/lib/api';
import { useLogger } from '@/lib/logger';
import type { ContestConfigTemplate } from './content-configuration-utils';

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

  return (
    <section
      className="space-y-6"
      data-testid="root-admin-content-configuration-list-page"
    >
      <div className="rounded-[2rem] border border-border bg-card p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <Link
              className="text-sm font-medium text-primary transition hover:opacity-80"
              to="/manage"
            >
              Back to Manage
            </Link>
            <h2 className="mt-3 text-2xl font-semibold text-foreground">
              Content Configuration
            </h2>
            <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
              Manage the persisted contest templates available to commissioner contest setup.
            </p>
          </div>
        </div>
      </div>

      <section className="rounded-[2rem] border border-border bg-card p-6">
        {templatesQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">
            Loading contest templates...
          </p>
        ) : templatesQuery.isError ? (
          <p className="text-sm text-rose-700">
            {extractErrorMessage(
              templatesQuery.error,
              'We could not load contest templates right now.',
            )}
          </p>
        ) : templates.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No persisted contest templates are configured yet.
          </p>
        ) : (
          <div className="overflow-hidden rounded-[1.5rem] border border-border">
            <table className="min-w-full divide-y divide-border text-left">
              <thead className="bg-background">
                <tr className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Template</th>
                  <th className="px-4 py-3 font-medium">Scope</th>
                  <th className="px-4 py-3 font-medium">Mode</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border bg-card">
                {templates.map((template) => (
                  <tr key={template.id}>
                    <td className="px-4 py-4 align-top">
                      <Link
                        className="block rounded-xl transition hover:bg-background/70"
                        data-testid={`root-admin-content-config-link-${template.templateKey}`}
                        onClick={() => {
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
                        }}
                        to={`/manage/content-configuration/${template.templateKey}`}
                      >
                        <div className="text-sm font-semibold text-foreground">
                          {template.name}
                        </div>
                        <div className="mt-1 text-xs uppercase tracking-[0.14em] text-muted-foreground">
                          {template.templateKey}
                        </div>
                        <div className="mt-2 max-w-xl text-sm text-muted-foreground">
                          {template.description}
                        </div>
                      </Link>
                    </td>
                    <td className="px-4 py-4 align-top text-sm text-muted-foreground">
                      {template.sport} · {template.contestType}
                    </td>
                    <td className="px-4 py-4 align-top text-sm text-muted-foreground">
                      {template.configMode}
                    </td>
                    <td className="px-4 py-4 align-top">
                      <div className="flex flex-wrap gap-2">
                        <span
                          className={`inline-flex rounded-full border px-3 py-1 text-xs font-medium ${
                            template.active
                              ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
                              : 'border-border bg-card text-muted-foreground'
                          }`}
                        >
                          {template.active ? 'Active' : 'Inactive'}
                        </span>
                        {template.isDefault ? (
                          <span className="inline-flex rounded-full border border-sky-300 bg-sky-50 px-3 py-1 text-xs font-medium text-sky-900">
                            Default
                          </span>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </section>
  );
}
