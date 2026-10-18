import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { listContestConfigTemplates, updateContestConfigTemplate, type ContestConfigTemplateDto } from '@/lib/api';
import { getLogger } from '@/lib/logger';
import { LayoutTemplate } from 'lucide-react';
import { SelectionType, getSportDefinition } from '@poolmaster/shared/domain';
import {
  AsyncPage,
  Button,
  Checkbox,
  FormEditorSection,
  FormField,
  IdentityHeading,
  Input,
  StatusBadge,
  Textarea,
} from '@/features/shared/ui';
import {
  cloneContestTemplate,
  getTemplateSize,
  isRosterTemplateConfiguration,
  templateSizeFields,
  toPositiveNumber,
  type ContestConfigTemplate,
  updateTemplateRules,
} from './content-configuration-utils';
import { describeBracketRules, describePickEmMode } from '@/features/contests/contest-rules';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { useManageBreadcrumbOverride, useManagePageOwnsHeading } from './manage-breadcrumb-context';

type ContestConfigTemplateUpdateResult = ContestConfigTemplateDto;

export function RootAdminContentConfigurationDetailPage() {
  const { templateKey = '' } = useParams<{ templateKey: string }>();
  const logger = getLogger().child({
    feature: 'root-admin-content-configuration-detail-page',
  });
  const [draft, setDraft] = useState<ContestConfigTemplate | null>(null);

  const templatesQuery = useQuery({
    queryKey: QueryKeys.contestConfigTemplates.list({}),
    queryFn: async (): Promise<ContestConfigTemplate[]> => {
      const response = await listContestConfigTemplates();

      if (!response.data?.templates) {
        throwApiError(response.error, 'Contest template response is missing data.');
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

  const contestTemplateMutation = useInvalidatingMutation({
    mutationFn: async (input: {
      templateId: string;
      nextDraft: ContestConfigTemplate;
    }): Promise<ContestConfigTemplateUpdateResult> => {
      const response = await updateContestConfigTemplate({
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
        throwApiError(response.error, 'Contest template update response is missing data.');
      }

      return response.data.template;
    },
    onSuccess: (updatedTemplate) => {
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
    invalidates: [QueryKeys.contestConfigTemplates.all],
  });

  function updateDraft(updater: (current: ContestConfigTemplate) => ContestConfigTemplate) {
    setDraft((current) => {
      if (!current) {
        return current;
      }
      return updater(current);
    });
  }

  useManagePageOwnsHeading();
  useManageBreadcrumbOverride(templateKey || undefined, template?.name);

  const pageState = templatesQuery.isError
    ? 'error'
    : templatesQuery.isLoading
      ? 'loading'
      : draft
        ? 'ready'
        : 'empty';

  // The size field and the tiers note name the template's sport's participants and events.
  const vocabulary = draft ? getSportDefinition(draft.sport).vocabulary : null;
  // A roster template edits its size and scores that count; a pick'em template has neither.
  const rosterConfiguration = draft && isRosterTemplateConfiguration(draft.configuration) ? draft.configuration : null;
  const sizeField = rosterConfiguration && vocabulary ? templateSizeFields(vocabulary)[rosterConfiguration.selectionType] : null;

  return (
    <AsyncPage
      emptyBody={`No contest template matched ${templateKey}.`}
      emptyTitle="Template not found"
      errorBody={extractErrorMessage(
        templatesQuery.error,
        { fallback: 'We could not load this contest template right now.' },
      )}
      loadingBody="Loading contest template..."
      state={pageState}
      testId="root-admin-content-configuration-detail-page"
    >
      {draft && vocabulary ? (
        <>
          <IdentityHeading
            icon={<LayoutTemplate aria-hidden size={22} />}
            meta={(
              <>
                <StatusBadge tone={draft.active ? 'active' : 'inactive'}>
                  {draft.active ? 'Active' : 'Inactive'}
                </StatusBadge>
                {draft.isDefault ? <StatusBadge tone="info">Default</StatusBadge> : null}
                <span>{draft.sport} · {draft.contestFormat} · {draft.selectionType}</span>
                <span className="font-mono">{draft.templateKey}</span>
              </>
            )}
            name={draft.name}
            testId="root-admin-content-configuration-identity"
          />

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
                  <Checkbox
                    checked={draft.active}
                    data-testid="root-admin-content-config-active"
                    onChange={(event) => updateDraft((current) => ({
                      ...current,
                      active: event.target.checked,
                    }))}
                  />
                  Active
                </label>
                <label className="flex items-center gap-2">
                  <Checkbox
                    checked={draft.isDefault}
                    data-testid="root-admin-content-config-default"
                    onChange={(event) => updateDraft((current) => ({
                      ...current,
                      isDefault: event.target.checked,
                    }))}
                  />
                  Default
                </label>
              </div>

              {rosterConfiguration && sizeField ? (
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <FormField helperText={sizeField.helperText} label={sizeField.label}>
                    <Input
                      data-testid={sizeField.testId}
                      onChange={(event) => updateDraft((current) =>
                        updateTemplateRules(current, {
                          [sizeField.key]: toPositiveNumber(event.target.value),
                        }))}
                      type="number"
                      value={getTemplateSize(rosterConfiguration)}
                    />
                  </FormField>
                  <FormField label="Scores that count">
                    <Input
                      data-testid="root-admin-content-config-counted-scores"
                      onChange={(event) => updateDraft((current) =>
                        updateTemplateRules(current, {
                          countedScores: toPositiveNumber(event.target.value),
                        }))}
                      type="number"
                      value={rosterConfiguration.countedScores}
                    />
                  </FormField>
                  <p className="md:col-span-2 text-sm text-muted-foreground">
                    {`Tiers, prices and ${vocabulary.participant.one} assignments are set per ${vocabulary.event.one}, not per template — see the ${vocabulary.event.one}'s Tiers page.`}
                  </p>
                </div>
              ) : draft.configuration.selectionType === SelectionType.PICK_EM ? (
                <p className="mt-4 text-sm text-muted-foreground" data-testid="root-admin-content-config-pick-em-rules">
                  {describePickEmMode(draft.configuration.mode)}
                </p>
              ) : draft.configuration.selectionType === SelectionType.BRACKET ? (
                <p className="mt-4 text-sm text-muted-foreground" data-testid="root-admin-content-config-bracket-rules">
                  {describeBracketRules()}
                </p>
              ) : null}
          </FormEditorSection>
        </>
      ) : null}
    </AsyncPage>
  );
}
