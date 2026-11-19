import { ContestFormat, ContestTemplateEventType, formatSelectionTypeName } from '@poolmaster/shared/domain';
import { useForm } from 'react-hook-form';
import { DetailEditModal, FormField, Select, showToast, type Fact } from '@/features/shared/ui';
import { updateContestConfigTemplate, type ContestConfigTemplateDto } from '@/lib/api';
import { throwApiError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import { useDetailEditDialog } from './use-detail-edit-dialog';
import { contestTemplateUpdateBody, contestTemplateValuesOf, type TemplateValues } from './league-contest-template-form';

const logger = getLogger().child({ feature: 'root-admin-league-page' });

const CONTEST_FORMAT_LABELS: Record<ContestFormat, string> = {
  [ContestFormat.ROSTER]: 'Roster',
  [ContestFormat.PREDICTION]: 'Prediction',
  [ContestFormat.SQUARES]: 'Squares',
};

const EVENT_TYPE_LABELS: Record<ContestTemplateEventType, string> = {
  [ContestTemplateEventType.KNOCKOUT]: 'Playoffs and brackets',
  [ContestTemplateEventType.WEEK]: 'A week of games',
};

/**
 * A contest template on the League page's Contest templates grid (⤢): all of it to read, then
 * Edit for its Status and Default only (rules/ux-rules.md §12 item 14). Templates are seeded by
 * migration, so nothing else changes here.
 */
export function LeagueContestTemplateDialog({ onClose, template }: { onClose: () => void; template: ContestConfigTemplateDto }) {
  const current = contestTemplateValuesOf(template);
  const form = useForm<TemplateValues>({ defaultValues: current });
  const dialog = useDetailEditDialog(form, current, onClose);

  const saveMutation = useInvalidatingMutation({
    mutationFn: async (values: TemplateValues) => {
      const response = await updateContestConfigTemplate({ path: { templateId: template.id }, body: contestTemplateUpdateBody(current, values) });
      if (!response.data?.template) throwApiError(response.error, 'Contest template update response is missing data.');
      return response.data.template;
    },
    invalidates: [QueryKeys.contestConfigTemplates.all],
    onSuccess: () => {
      showToast({ title: `Saved ${template.name}`, tone: 'success' });
      dialog.saved();
    },
    onError: (error) => {
      logger.warn({ action: 'leaguePage.contestTemplate.failed', data: { templateId: template.id }, err: error }, 'Contest template update was refused');
    },
  });

  const facts: Fact[] = [
    { id: 'description', label: 'Description', value: template.description },
    { id: 'contestType', label: 'Contest type', value: CONTEST_FORMAT_LABELS[template.contestFormat] },
    { id: 'selectionType', label: 'Selection type', value: formatSelectionTypeName(template.selectionType) },
    { id: 'events', label: 'Events', value: template.eventType ? EVENT_TYPE_LABELS[template.eventType] : 'Every event' },
    { id: 'default', label: 'Default', value: template.isDefault ? 'Yes' : 'No', testId: 'root-admin-league-contest-template-default' },
    { id: 'status', label: 'Status', value: template.active ? 'On' : 'Off', testId: 'root-admin-league-contest-template-status' },
    { id: 'key', label: 'Key', value: template.templateKey },
  ];

  return (
    <DetailEditModal
      {...dialog.modalProps(saveMutation)}
      canSave={form.formState.isDirty}
      errorFallback="We could not save this contest template."
      facts={facts}
      saveLabel="Save contest template"
      testId="root-admin-league-contest-template"
      title={dialog.mode === 'view' ? template.name : `${template.name} · Edit`}
    >
      <div className="grid gap-4">
        <FormField label="Status">
          <Select data-testid="root-admin-league-contest-template-status-input" {...form.register('active')}>
            <option value="on">On</option>
            <option value="off">Off</option>
          </Select>
        </FormField>
        <FormField label="Default">
          <Select data-testid="root-admin-league-contest-template-default-input" {...form.register('isDefault')}>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </Select>
        </FormField>
      </div>
    </DetailEditModal>
  );
}
