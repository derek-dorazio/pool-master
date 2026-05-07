import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import {
  adminListContestConfigTemplates,
  adminUpdateContestConfigTemplate,
  type AdminUpdateContestConfigTemplateResponses,
} from '@/lib/api';
import { getLogger } from '@/lib/logger';
import {
  AdminConfigPage,
  Button,
  FormEditorSection,
  FormField,
  Input,
  LinkButton,
  StatusBadge,
  Textarea,
  Tile,
} from '@/features/shared/ui';
import {
  cloneContestTemplate,
  getPicksPerTier,
  getTierCount,
  toPositiveNumber,
  type ContestConfigTemplate,
  updateTieredTemplateConfiguration,
} from './content-configuration-utils';
import { extractErrorMessage } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';
import { createMutationHook } from '@/lib/mutation-hooks';

type ContestConfigTemplateUpdateResult =
  AdminUpdateContestConfigTemplateResponses[200]['template'];

export function RootAdminContentConfigurationDetailPage() {
  const { templateKey = '' } = useParams<{ templateKey: string }>();
  const logger = getLogger().child({
    feature: 'root-admin-content-configuration-detail-page',
  });
  const [draft, setDraft] = useState<ContestConfigTemplate | null>(null);

  const templatesQuery = useQuery({
    queryKey: QueryKeys.rootAdmin.contestConfigTemplates,
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

  const contestTemplateMutation = createMutationHook({
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
    },
    invalidates: [QueryKeys.rootAdmin.contestConfigTemplates],
  });

  function updateDraft(updater: (current: ContestConfigTemplate) => ContestConfigTemplate) {
    setDraft((current) => {
      if (!current) {
        return current;
      }
      return updater(current);
    });
  }

  const pageState = templatesQuery.isError
    ? 'error'
    : templatesQuery.isLoading
      ? 'loading'
      : 'ready';

  return (
    <AdminConfigPage
      errorBody={extractErrorMessage(
        templatesQuery.error,
        { fallback: 'We could not load this contest template right now.' },
      )}
      header={{
        actions: (
          <LinkButton to="/manage/content-configuration" variant="secondary">
            Back to Content Configuration
          </LinkButton>
        ),
        breadcrumbs: [
          { href: '/manage/content-configuration', label: 'Content Configuration' },
          { label: templateKey },
        ],
        title: draft?.name ?? templateKey,
      }}
      loadingBody="Loading contest template..."
      state={pageState}
      testId="root-admin-content-configuration-detail-page"
    >
      {!draft ? (
        <>
          <h2 className="text-2xl font-semibold text-foreground">
            Template not found
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            No persisted contest template matched <span className="font-medium text-foreground">{templateKey}</span>.
          </p>
        </>
      ) : (
        <>
          <Tile>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  {draft.templateKey}
                </p>
                <h2 className="mt-2 text-2xl font-semibold text-foreground">
                  {draft.name}
                </h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  {draft.sport} · {draft.contestFormat} · {draft.configMode}
                </p>
              </div>
              <div className="flex gap-2">
                <StatusBadge tone={draft.active ? 'active' : 'inactive'}>
                  {draft.active ? 'Active' : 'Inactive'}
                </StatusBadge>
                {draft.isDefault ? (
                  <StatusBadge tone="info">Default</StatusBadge>
                ) : null}
              </div>
            </div>
          </Tile>

          <FormEditorSection
            errorMessage={
              contestTemplateMutation.isError
                ? extractErrorMessage(
                    contestTemplateMutation.error,
                    { fallback: 'We could not save this contest template right now.' },
                  )
                : null
            }
            footer={(
              <Button
                data-testid="root-admin-content-config-save"
                disabled={contestTemplateMutation.isPending}
                onClick={() => contestTemplateMutation.mutate({
                  templateId: draft.id,
                  nextDraft: draft,
                })}
                type="button"
              >
                {contestTemplateMutation.isPending ? 'Saving...' : 'Save template'}
              </Button>
            )}
            title="Template configuration"
          >
              <div className="grid gap-3 md:grid-cols-2">
                <FormField label="Name">
                  <Input
                    data-testid="root-admin-content-config-name"
                    onChange={(event) => updateDraft((current) => ({
                      ...current,
                      name: event.target.value,
                    }))}
                    value={draft.name}
                  />
                </FormField>
                <FormField label="Sort order">
                  <Input
                    data-testid="root-admin-content-config-sort-order"
                    onChange={(event) => updateDraft((current) => ({
                      ...current,
                      sortOrder: toPositiveNumber(event.target.value),
                    }))}
                    type="number"
                    value={draft.sortOrder}
                  />
                </FormField>
                <FormField className="md:col-span-2" label="Description">
                  <Textarea
                    data-testid="root-admin-content-config-description"
                    onChange={(event) => updateDraft((current) => ({
                      ...current,
                      description: event.target.value,
                    }))}
                    value={draft.description}
                  />
                </FormField>
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
                  <FormField label="Tier count">
                    <Input
                      data-testid="root-admin-content-config-tier-count"
                      onChange={(event) => updateDraft((current) =>
                        updateTieredTemplateConfiguration(current, {
                          tierCount: toPositiveNumber(event.target.value),
                        }))}
                      type="number"
                      value={getTierCount(draft)}
                    />
                  </FormField>
                  <FormField label="Picks per tier">
                    <Input
                      data-testid="root-admin-content-config-picks-per-tier"
                      onChange={(event) => updateDraft((current) =>
                        updateTieredTemplateConfiguration(current, {
                          picksPerTier: toPositiveNumber(event.target.value),
                        }))}
                      type="number"
                      value={getPicksPerTier(draft)}
                    />
                  </FormField>
                  <FormField label="Counted scores">
                    <Input
                      data-testid="root-admin-content-config-counted-scores"
                      onChange={(event) => updateDraft((current) =>
                        updateTieredTemplateConfiguration(current, {
                          countedScores: toPositiveNumber(event.target.value),
                        }))}
                      type="number"
                      value={draft.configuration.countedScores}
                    />
                  </FormField>
                  <FormField label="Tier size">
                    <Input
                      data-testid="root-admin-content-config-tier-size"
                      onChange={(event) => updateDraft((current) =>
                        updateTieredTemplateConfiguration(current, {
                          tierSize: toPositiveNumber(event.target.value),
                        }))}
                      type="number"
                      value={draft.configuration.tierGeneration.defaultTierSize}
                    />
                  </FormField>
                  <FormField label="Cut score">
                    <Input
                      data-testid="root-admin-content-config-cut-score"
                      onChange={(event) => updateDraft((current) =>
                        updateTieredTemplateConfiguration(current, {
                          cutScore: toPositiveNumber(event.target.value),
                        }))}
                      type="number"
                      value={draft.configuration.cutRule.fixedScore}
                    />
                  </FormField>
                  <div className="rounded-2xl border border-border px-4 py-3 text-sm text-muted-foreground">
                    <div>Roster size: {draft.configuration.rosterSize}</div>
                    <div className="mt-1">Template tiers: {draft.configuration.tiers.length}</div>
                  </div>
                </div>
              ) : null}
          </FormEditorSection>
        </>
      )}
    </AdminConfigPage>
  );
}
