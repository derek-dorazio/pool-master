import type {
  GetManagedContestResponses,
  ListEventsResponses,
  ListManagedContestTemplatesResponses,
} from "@/lib/api";
import {
  Alert,
  DefinitionList,
  ListCard,
  ListStack,
  ResponsiveGridLayout,
  SectionHeader,
  StatusBadge,
  Tile,
} from "@/features/shared/ui";

type SportEventSummary = ListEventsResponses[200]["events"][number];
type ManagedContestTemplate =
  ListManagedContestTemplatesResponses[200]["templates"][number];
type InheritedTier =
  GetManagedContestResponses[200]["contest"]["effectiveTiers"][number];

type ContestTemplatePickerProps = {
  isEditMode: boolean;
  onSelectTemplate: (templateId: string) => void;
  selectedTemplateId: string;
  templates: ManagedContestTemplate[];
};

export function ContestTemplatePicker({
  isEditMode,
  onSelectTemplate,
  selectedTemplateId,
  templates,
}: ContestTemplatePickerProps) {
  if (isEditMode) {
    return null;
  }

  return (
    <Tile className="space-y-3" padding="sm" radius="lg" variant="subtle">
      <SectionHeader
        description={
          <>
          Start from a seeded contest template. The selected template seeds the setup
          below, and any commissioner changes become the contest-specific configuration
          saved at creation time.
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
      <Alert>
        New contests currently use tiered entry.
      </Alert>
    </Tile>
  );
}

type EventReadinessPanelProps = {
  event: SportEventSummary;
  formatDateTimeDisplay: (value: string | null) => string;
  formatReadinessLabel: (event: SportEventSummary) => string;
  formatReadinessReasons: (event: SportEventSummary) => string;
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
          { id: "release-at", label: "Release at", value: formatDateTimeDisplay(event.releaseAt) },
          { id: "field-locks-at", label: "Field locks at", value: formatDateTimeDisplay(event.fieldLocksAt) },
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

type InheritedTiersPanelProps = {
  tiers: InheritedTier[];
};

/**
 * Read-only display of the tier structure a contest inherits from its linked
 * tournament (plans/124 §4.6/§5.3). Tiers are event-owned — never
 * contest-configured — so there is no edit affordance and no mode toggle
 * here; the commissioner only sees what the tournament defines. Fed from
 * ContestManagementResponseSchema.contest.effectiveTiers.
 *
 * Per-golfer `assignments[].price` is carried on the contract for
 * budget-format consumers but is intentionally not surfaced here — this is
 * the tiered-contest view; a budget/price display is plans/128's slice.
 */
export function InheritedTiersPanel({ tiers }: InheritedTiersPanelProps) {
  return (
    <Tile
      className="space-y-3"
      data-testid="inherited-tiers-panel"
      padding="sm"
      radius="lg"
      variant="subtle"
    >
      <SectionHeader
        description="Tier structure and golfer assignments are set on the tournament, not the contest. This contest inherits whatever the tournament defines."
        title="Inherited tournament tiers"
      />
      {tiers.length === 0 ? (
        <Alert data-testid="inherited-tiers-empty">
          This tournament has no tiers defined yet. A root admin sets tiers on the
          tournament before entries can be drafted.
        </Alert>
      ) : (
        <ListStack data-testid="inherited-tiers-list">
          {tiers.map((tier) => (
            <ListCard
              data-testid={`inherited-tier-${tier.tierKey}`}
              description={`${tier.assignments.length} golfer${
                tier.assignments.length === 1 ? "" : "s"
              } · ${tier.defaultPickCount} pick${
                tier.defaultPickCount === 1 ? "" : "s"
              } by default`}
              key={tier.tierKey}
              title={`${tier.tierNumber}. ${tier.label}`}
            />
          ))}
        </ListStack>
      )}
    </Tile>
  );
}

type NoEligibleEventsAlertProps = {
  events: SportEventSummary[];
  formatReadinessLabel: (event: SportEventSummary) => string;
  formatReadinessReasons: (event: SportEventSummary) => string;
};

export function NoEligibleEventsAlert({
  events,
  formatReadinessLabel,
  formatReadinessReasons,
}: NoEligibleEventsAlertProps) {
  return (
    <Alert
      data-testid="create-contest-no-events"
      title="No golf events are currently available for contest setup."
      tone="warning"
    >
      <p>
        Prime Time Commissioner only shows real imported events once they are released and the field is
        loaded. Check back when the next tournament reaches contest-ready status.
      </p>
      {events.length ? (
        <ResponsiveGridLayout className="mt-4">
          {events.slice(0, 3).map((event) => (
            <div className="text-sm" key={event.id}>
              {event.name}
              {" · "}
              {formatReadinessLabel(event)}
              {" · "}
              {formatReadinessReasons(event)}
            </div>
          ))}
        </ResponsiveGridLayout>
      ) : null}
    </Alert>
  );
}
