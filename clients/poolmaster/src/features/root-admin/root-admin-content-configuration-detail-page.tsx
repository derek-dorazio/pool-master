import { useMemo, useState } from 'react';
import { useParams } from 'react-router';
import { updateContestConfigTemplate, type ContestConfigTemplateDto } from '@/lib/api';
import { getLogger } from '@/lib/logger';
import { LayoutTemplate } from 'lucide-react';
import { SelectionType, getSportDefinition, describeBracketRules, describePickEmRules  } from '@poolmaster/shared/domain';
import {
  Button,
  Checkbox,
  InlineError,
  FormField,
  PageHeader,
  QueryState,
  Input,
  SectionCard,
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
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';
import { useContestConfigTemplatesQuery } from './use-contest-config-templates-query';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { useManageBreadcrumbOverride } from './manage-breadcrumb-context';

type ContestConfigTemplateUpdateResult = ContestConfigTemplateDto;

export function RootAdminContentConfigurationDetailPage() {
  const { templateKey = '' } = useParams<{ templateKey: string }>();
  // Keyed by the template, so opening another one starts a fresh draft.
  return <ContentConfigurationDetail key={templateKey} templateKey={templateKey} />;
}

function ContentConfigurationDetail({ templateKey }: { templateKey: string }) {
  const logger = getLogger().child({
    feature: 'root-admin-content-configuration-detail-page',
  });
  // Null until the admin edits or saves: the form shows the loaded template until then, and a
  // refetch never overwrites an edit (rules/react-ui-rules.md §5 Server Data Form-State Hazard).
  const [edits, setEdits] = useState<ContestConfigTemplate | null>(null);

  const templatesQuery = useContestConfigTemplatesQuery();

  const template = useMemo(
    // poolmaster-allow-list-lookup: the fixed set of contest config templates, listed on the screen before this one; there is no single read by key
    () => templatesQuery.data?.find((candidate) => candidate.templateKey === templateKey) ?? null,
    [templateKey, templatesQuery.data],
  );

  const templateDraft = useMemo(() => (template ? cloneContestTemplate(template) : null), [template]);
  const draft = edits ?? templateDraft;

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
      setEdits(cloneContestTemplate(updatedTemplate));
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
    setEdits((edited) => {
      const current = edited ?? templateDraft;
      return current ? updater(current) : edited;
    });
  }

  useManageBreadcrumbOverride(templateKey || undefined, template?.name);

  // The size field and the tiers note name the template's sport's participants and events.
  const vocabulary = draft ? getSportDefinition(draft.sport).vocabulary : null;
  // A roster template edits its size and scores that count; a pick'em template has neither.
  const rosterConfiguration = draft && isRosterTemplateConfiguration(draft.configuration) ? draft.configuration : null;
  const sizeField = rosterConfiguration && vocabulary ? templateSizeFields(vocabulary)[rosterConfiguration.selectionType] : null;

  return (
    <section className="space-y-6" data-testid="root-admin-content-configuration-detail-page">
      <QueryState
        empty={`Template not found: no contest template matched ${templateKey}.`}
        error={extractErrorMessage(
          templatesQuery.error,
          { fallback: 'We could not load this contest template right now.' },
        )}
        isEmpty={() => !draft}
        loading="Loading contest template..."
        query={templatesQuery}
        size="tile"
        testId="root-admin-content-configuration-detail"
      >
        {() => (draft && vocabulary ? (
        <>
          <PageHeader
            icon={<LayoutTemplate aria-hidden size={22} />}
            meta={(
              <>
                {draft.isDefault ? <StatusBadge tone="info">Default</StatusBadge> : null}
                <span>{draft.sport} · {draft.contestFormat} · {draft.selectionType}</span>
                <span className="font-mono">{draft.templateKey}</span>
              </>
            )}
            status={(
              <StatusBadge tone={draft.active ? 'active' : 'inactive'}>
                {draft.active ? 'Active' : 'Inactive'}
              </StatusBadge>
            )}
            title={draft.name}
            testId="root-admin-content-configuration-identity"
          />

          <SectionCard padded title="Template configuration">
            <div className="space-y-4">
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
                  {describePickEmRules(draft.configuration)}
                </p>
              ) : draft.configuration.selectionType === SelectionType.BRACKET ? (
                <p className="mt-4 text-sm text-muted-foreground" data-testid="root-admin-content-config-bracket-rules">
                  {describeBracketRules()}
                </p>
              ) : null}
              {contestTemplateMutation.isError ? (
                <InlineError>
                  {extractErrorMessage(contestTemplateMutation.error, {
                    fallback: 'We could not save this contest template right now.',
                  })}
                </InlineError>
              ) : null}
              <div className="flex flex-wrap gap-3">
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
              </div>
            </div>
          </SectionCard>
        </>
        ) : null)}
      </QueryState>
    </section>
  );
}
