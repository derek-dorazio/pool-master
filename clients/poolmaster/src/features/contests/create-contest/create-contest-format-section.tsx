import { SelectionType, type SportDefinition, formatSelectionTypeName } from '@poolmaster/shared/domain';
import type { ContestConfigTemplateDto } from '@/lib/api';
import { ChoiceCard, ChoiceCardText, FormSection, Text } from '@/features/shared/ui';
import { formatChoicesFor, type CreatableSelectionType } from './create-contest-helpers';

/**
 * Create contest, step 2: the sport's formats, one card each, then the presets of the chosen
 * format to start from, and Custom for rules typed by hand.
 */
export function CreateContestFormatSection({
  isBudgetUnavailable,
  onSelectFormat,
  onSelectPreset,
  presets,
  selectedTemplateId,
  selectionType,
  sportDefinition,
}: {
  /** The chosen event has no prices yet, so a budget contest cannot run on it. */
  isBudgetUnavailable: boolean;
  onSelectFormat: (format: CreatableSelectionType) => void;
  onSelectPreset: (templateId: string) => void;
  presets: readonly Pick<ContestConfigTemplateDto, 'description' | 'id' | 'name' | 'templateKey'>[];
  selectedTemplateId: string;
  selectionType: SelectionType;
  sportDefinition: SportDefinition;
}) {
  const { participant } = sportDefinition.vocabulary;
  return (
    <FormSection
      help="The format is how members pick. A preset fills in its usual rules; you can change any of them in the next step."
      step={2}
      testId="create-contest-format"
      title="Format"
    >
      <div aria-label="Format" className="grid gap-2 md:grid-cols-2" role="radiogroup">
        {formatChoicesFor(sportDefinition).map((choice) => {
          const isSelected = choice.selectionType === selectionType;
          // A budget contest needs a priced field; the card says so rather than vanishing.
          const isUnavailable = choice.selectionType === SelectionType.BUDGET_PICK && isBudgetUnavailable;
          const Icon = choice.icon;
          return (
            <ChoiceCard
              isDisabled={isUnavailable && !isSelected}
              isSelected={isSelected}
              key={choice.selectionType}
              onSelect={() => onSelectFormat(choice.selectionType)}
              testId={`contest-format-${choice.selectionType}`}
            >
              <ChoiceCardText
                description={isUnavailable ? `This event’s ${participant.many} have no prices yet.` : choice.describe(participant)}
                label={(
                  <>
                    <Icon aria-hidden size={16} />
                    {formatSelectionTypeName(choice.selectionType)}
                  </>
                )}
              />
            </ChoiceCard>
          );
        })}
      </div>
      <div className="grid gap-2">
        <Text variant="meta">Start from</Text>
        {/* Each template by its own name and description (#802), then Custom for rules typed by hand. */}
        <div aria-label="Start from" className="grid gap-2 md:grid-cols-2" role="radiogroup">
          {presets.map((template) => (
            <ChoiceCard
              isSelected={template.id === selectedTemplateId}
              key={template.id}
              onSelect={() => onSelectPreset(template.id)}
              testId={`contest-template-${template.templateKey}`}
            >
              <ChoiceCardText description={template.description} label={template.name} />
            </ChoiceCard>
          ))}
          <ChoiceCard isSelected={!selectedTemplateId} onSelect={() => onSelectPreset('')} testId="contest-template-custom">
            <ChoiceCardText description="Set every rule yourself." label="Custom" />
          </ChoiceCard>
        </div>
      </div>
    </FormSection>
  );
}
