import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import {
  adminListContestConfigTemplates,
  adminUpdateContestConfigTemplate,
  type AdminUpdateContestConfigTemplateResponses,
} from '@/lib/api';
import { useLogger } from '@/lib/logger';
import {
  cloneContestTemplate,
  getPicksPerTier,
  getTierCount,
  toPositiveNumber,
  type ContestConfigTemplate,
  updateTieredTemplateConfiguration,
} from './content-configuration-utils';

type ContestConfigTemplateUpdateResult =
  AdminUpdateContestConfigTemplateResponses[200]['template'];

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

export function RootAdminContentConfigurationDetailPage() {
  const { templateKey = '' } = useParams<{ templateKey: string }>();
  const logger = useLogger().child({
    feature: 'root-admin-content-configuration-detail-page',
  });
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<ContestConfigTemplate | null>(null);

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

  const template = useMemo(
    () => templatesQuery.data?.find((candidate) => candidate.templateKey === templateKey) ?? null,
    [templateKey, templatesQuery.data],
  );

  useEffect(() => {
    if (template) {
      setDraft(cloneContestTemplate(template));
    }
  }, [template]);

  const contestTemplateMutation = useMutation({
    mutationFn: async (input: {
      templateId: string;
      nextDraft: ContestConfigTemplate;
    }): Promise<ContestConfigTemplateUpdateResult> => {
      const response = await adminUpdateContestConfigTemplate({
        path: { templateId: input.templateId },
        body: {
          name: input.nextDraft.name,
          description: input.nextDraft.description,
          sortOrder: input.nextDraft.sortOrder,
          active: input.nextDraft.active,
          isDefault: input.nextDraft.isDefault,
          configuration: input.nextDraft.configuration,
        },
      });

      if (!response.data?.template) {
        throw response.error ?? new Error('Contest template update response is missing data.');
      }

      return response.data.template;
    },
    onSuccess: async (updatedTemplate) => {
      setDraft(cloneContestTemplate(updatedTemplate));
      logger.info(
        {
          action: 'rootAdmin.contentConfiguration.saved',
          data: {
            templateId: updatedTemplate.id,
            templateKey: updatedTemplate.templateKey,
          },
        },
        'Saved root-admin content configuration template',
      );
      await queryClient.invalidateQueries({
        queryKey: ['poolmaster', 'root-admin', 'contest-config-templates'],
      });
    },
  });

  function updateDraft(updater: (current: ContestConfigTemplate) => ContestConfigTemplate) {
    setDraft((current) => {
      if (!current) {
        return current;
      }
      return updater(current);
    });
  }

  return (
    <section
      className="space-y-6"
      data-testid="root-admin-content-configuration-detail-page"
    >
      <div className="rounded-[2rem] border border-border bg-card p-6">
        <Link
          className="text-sm font-medium text-primary transition hover:opacity-80"
          to="/manage/content-configuration"
        >
          Back to Content Configuration
        </Link>

        {templatesQuery.isLoading ? (
          <p className="mt-4 text-sm text-muted-foreground">
            Loading contest template...
          </p>
        ) : templatesQuery.isError ? (
          <p className="mt-4 text-sm text-rose-700">
            {extractErrorMessage(
              templatesQuery.error,
              'We could not load this contest template right now.',
            )}
          </p>
        ) : !draft ? (
          <>
            <h2 className="mt-3 text-2xl font-semibold text-foreground">
              Template not found
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              No persisted contest template matched <span className="font-medium text-foreground">{templateKey}</span>.
            </p>
          </>
        ) : (
          <>
            <div className="mt-3 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  {draft.templateKey}
                </p>
                <h2 className="mt-2 text-2xl font-semibold text-foreground">
                  {draft.name}
                </h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  {draft.sport} · {draft.contestType} · {draft.configMode}
                </p>
              </div>
              <div className="flex gap-2">
                <span
                  className={`inline-flex rounded-full border px-3 py-1 text-xs font-medium ${
                    draft.active
                      ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
                      : 'border-border bg-card text-muted-foreground'
                  }`}
                >
                  {draft.active ? 'Active' : 'Inactive'}
                </span>
                {draft.isDefault ? (
                  <span className="inline-flex rounded-full border border-sky-300 bg-sky-50 px-3 py-1 text-xs font-medium text-sky-900">
                    Default
                  </span>
                ) : null}
              </div>
            </div>

            <div className="mt-6 rounded-[1.5rem] border border-border bg-background p-5">
              <div className="grid gap-3 md:grid-cols-2">
                <label className="text-sm text-muted-foreground">
                  <span className="mb-2 block font-medium text-foreground">Name</span>
                  <input
                    className="w-full rounded-2xl border border-border bg-card px-4 py-3 text-sm text-foreground"
                    data-testid="root-admin-content-config-name"
                    onChange={(event) => updateDraft((current) => ({
                      ...current,
                      name: event.target.value,
                    }))}
                    value={draft.name}
                  />
                </label>
                <label className="text-sm text-muted-foreground">
                  <span className="mb-2 block font-medium text-foreground">Sort order</span>
                  <input
                    className="w-full rounded-2xl border border-border bg-card px-4 py-3 text-sm text-foreground"
                    data-testid="root-admin-content-config-sort-order"
                    onChange={(event) => updateDraft((current) => ({
                      ...current,
                      sortOrder: toPositiveNumber(event.target.value),
                    }))}
                    type="number"
                    value={draft.sortOrder}
                  />
                </label>
                <label className="text-sm text-muted-foreground md:col-span-2">
                  <span className="mb-2 block font-medium text-foreground">Description</span>
                  <textarea
                    className="min-h-[96px] w-full rounded-2xl border border-border bg-card px-4 py-3 text-sm text-foreground"
                    data-testid="root-admin-content-config-description"
                    onChange={(event) => updateDraft((current) => ({
                      ...current,
                      description: event.target.value,
                    }))}
                    value={draft.description}
                  />
                </label>
              </div>

              <div className="mt-4 flex flex-wrap gap-4 text-sm text-muted-foreground">
                <label className="flex items-center gap-2">
                  <input
                    checked={draft.active}
                    data-testid="root-admin-content-config-active"
                    onChange={(event) => updateDraft((current) => ({
                      ...current,
                      active: event.target.checked,
                    }))}
                    type="checkbox"
                  />
                  Active
                </label>
                <label className="flex items-center gap-2">
                  <input
                    checked={draft.isDefault}
                    data-testid="root-admin-content-config-default"
                    onChange={(event) => updateDraft((current) => ({
                      ...current,
                      isDefault: event.target.checked,
                    }))}
                    type="checkbox"
                  />
                  Default
                </label>
              </div>

              {draft.configuration.mode === 'GOLF_TIERED' ? (
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <label className="text-sm text-muted-foreground">
                    <span className="mb-2 block font-medium text-foreground">Tier count</span>
                    <input
                      className="w-full rounded-2xl border border-border bg-card px-4 py-3 text-sm text-foreground"
                      data-testid="root-admin-content-config-tier-count"
                      onChange={(event) => updateDraft((current) =>
                        updateTieredTemplateConfiguration(current, {
                          tierCount: toPositiveNumber(event.target.value),
                        }))}
                      type="number"
                      value={getTierCount(draft)}
                    />
                  </label>
                  <label className="text-sm text-muted-foreground">
                    <span className="mb-2 block font-medium text-foreground">Picks per tier</span>
                    <input
                      className="w-full rounded-2xl border border-border bg-card px-4 py-3 text-sm text-foreground"
                      data-testid="root-admin-content-config-picks-per-tier"
                      onChange={(event) => updateDraft((current) =>
                        updateTieredTemplateConfiguration(current, {
                          picksPerTier: toPositiveNumber(event.target.value),
                        }))}
                      type="number"
                      value={getPicksPerTier(draft)}
                    />
                  </label>
                  <label className="text-sm text-muted-foreground">
                    <span className="mb-2 block font-medium text-foreground">Counted scores</span>
                    <input
                      className="w-full rounded-2xl border border-border bg-card px-4 py-3 text-sm text-foreground"
                      data-testid="root-admin-content-config-counted-scores"
                      onChange={(event) => updateDraft((current) =>
                        updateTieredTemplateConfiguration(current, {
                          countedScores: toPositiveNumber(event.target.value),
                        }))}
                      type="number"
                      value={draft.configuration.countedScores}
                    />
                  </label>
                  <label className="text-sm text-muted-foreground">
                    <span className="mb-2 block font-medium text-foreground">Tier size</span>
                    <input
                      className="w-full rounded-2xl border border-border bg-card px-4 py-3 text-sm text-foreground"
                      data-testid="root-admin-content-config-tier-size"
                      onChange={(event) => updateDraft((current) =>
                        updateTieredTemplateConfiguration(current, {
                          tierSize: toPositiveNumber(event.target.value),
                        }))}
                      type="number"
                      value={draft.configuration.tierGeneration.defaultTierSize}
                    />
                  </label>
                  <label className="text-sm text-muted-foreground">
                    <span className="mb-2 block font-medium text-foreground">Cut score</span>
                    <input
                      className="w-full rounded-2xl border border-border bg-card px-4 py-3 text-sm text-foreground"
                      data-testid="root-admin-content-config-cut-score"
                      onChange={(event) => updateDraft((current) =>
                        updateTieredTemplateConfiguration(current, {
                          cutScore: toPositiveNumber(event.target.value),
                        }))}
                      type="number"
                      value={draft.configuration.cutRule.fixedScore}
                    />
                  </label>
                  <div className="rounded-2xl border border-border px-4 py-3 text-sm text-muted-foreground">
                    <div>Roster size: {draft.configuration.rosterSize}</div>
                    <div className="mt-1">Template tiers: {draft.configuration.tiers.length}</div>
                  </div>
                </div>
              ) : null}

              <button
                className="mt-5 rounded-2xl bg-foreground px-5 py-3 text-sm font-medium text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                data-testid="root-admin-content-config-save"
                disabled={contestTemplateMutation.isPending}
                onClick={() => contestTemplateMutation.mutate({
                  templateId: draft.id,
                  nextDraft: draft,
                })}
                type="button"
              >
                {contestTemplateMutation.isPending ? 'Saving...' : 'Save template'}
              </button>

              {contestTemplateMutation.isError ? (
                <p className="mt-3 text-sm text-rose-700">
                  {extractErrorMessage(
                    contestTemplateMutation.error,
                    'We could not save this contest template right now.',
                  )}
                </p>
              ) : null}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
