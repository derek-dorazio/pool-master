import type {
  SportEventDto,
  ContestConfigTemplateDto,
} from "@/lib/api";
import {
  Alert,
  DefinitionList,
  ListCard,
  ListStack,
  SectionHeader,
  StatusBadge,
  Tile,
} from "@/features/shared/ui";

type ContestConfigTemplate = ContestConfigTemplateDto;

type ContestTemplatePickerProps = {
  onSelectTemplate: (templateId: string) => void;
  selectedTemplateId: string;
  templates: ContestConfigTemplate[];
};

export function ContestTemplatePicker({
  onSelectTemplate,
  selectedTemplateId,
  templates,
}: ContestTemplatePickerProps) {
  return (
    <Tile className="space-y-3" padding="sm" radius="lg" variant="subtle">
      <SectionHeader
        description={
          <>
          Pick a template to fill in the settings below. You can change any of them
          before you create the contest.
          </>
        }
        title="Contest template"
      />
      <ListStack>
        {templates.map((template) => (
          <ListCard
            className={selectedTemplateId === template.id ? "border-primary bg-primary/5" : undefined}
            data-testid={`contest-template-${template.templateKey}`}
            description={template.description}
            key={template.id}
            onClick={() => onSelectTemplate(template.id)}
            title={template.name}
            trailing={template.isDefault ? <StatusBadge tone="info">Default</StatusBadge> : null}
          />
        ))}
      </ListStack>
    </Tile>
  );
}

type EventReadinessPanelProps = {
  event: SportEventDto;
  formatDateTimeDisplay: (value: string | null) => string;
  formatReadinessLabel: (event: SportEventDto) => string;
  formatReadinessReasons: (event: SportEventDto) => string;
};

export function EventReadinessPanel({
  event,
  formatDateTimeDisplay,
  formatReadinessLabel,
  formatReadinessReasons,
}: EventReadinessPanelProps) {
  return (
    <Tile padding="sm" radius="lg" variant="subtle">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SectionHeader
          description={formatReadinessReasons(event)}
          title="Selected event readiness"
        />
        <StatusBadge tone={event.contestEligible ? "success" : "warning"}>
          {formatReadinessLabel(event)}
        </StatusBadge>
      </div>

      <DefinitionList
        className="mt-4"
        items={[
          { id: "participants-loaded", label: "Participants loaded", value: event.participantCount ?? 0 },
          { id: "starts-at", label: "Entries close", value: formatDateTimeDisplay(event.startDate) },
          { id: "event-status", label: "Event status", value: event.status },
        ]}
      />
    </Tile>
  );
}

type ContestSetupSummaryProps = {
  items: Array<{
    id: string;
    label: string;
    value: string | number;
  }>;
};

export function ContestSetupSummary({ items }: ContestSetupSummaryProps) {
  return (
    <Tile>
      <h3 className="text-xl font-semibold">Current choices</h3>
      <DefinitionList className="mt-4 sm:grid-cols-1" items={items} />
    </Tile>
  );
}

/** No released, unstarted event with a field: nothing to build a contest on yet (#431). */
export function NoEligibleEventsAlert() {
  return (
    <Alert
      data-testid="create-contest-no-events"
      title="No golf events are currently available for contest setup."
      tone="warning"
    >
      <p>
        An event appears here once an admin releases it for contests, until it starts. Check back
        when the next tournament is released.
      </p>
    </Alert>
  );
}
