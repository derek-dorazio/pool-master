import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  ChevronLeft,
  ChevronRight,
  Check,
  Trophy,
  Settings2,
  ClipboardList,
  FolderPlus,
} from 'lucide-react';
import { Sport, ScoringEngine, SelectionType } from '@poolmaster/shared/domain';
import {
  EventListResponseSchema,
  SelectionTemplateListResponseSchema,
  ScoringTemplateListResponseSchema,
} from '@poolmaster/shared/dto';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  formatPricingMethodLabel,
  formatSelectionTypeLabel,
  formatTierAssignmentMethodLabel,
  getSelectionConfigSummary,
} from '@/features/contests/selection-config-summary';
import { toast } from '@/hooks/use-toast';
import {
  client,
  createContest,
  listLeagues,
  listScoringTemplates,
  listSelectionTemplates,
} from '@/lib/api';

const STEPS = [
  { label: 'Basics', icon: FolderPlus },
  { label: 'Selection Template', icon: Settings2 },
  { label: 'Scoring Template', icon: ClipboardList },
  { label: 'Review', icon: Check },
];

const SPORTS = [
  { id: Sport.NFL, name: 'NFL', emoji: '🏈' },
  { id: Sport.NBA, name: 'NBA', emoji: '🏀' },
  { id: Sport.GOLF, name: 'Golf', emoji: '⛳' },
  { id: Sport.F1, name: 'F1', emoji: '🏎️' },
  { id: Sport.NCAA_BASKETBALL, name: 'NCAA', emoji: '🎓' },
  { id: Sport.TENNIS, name: 'Tennis', emoji: '🎾' },
  { id: Sport.SOCCER, name: 'Soccer', emoji: '⚽' },
  { id: Sport.NASCAR, name: 'NASCAR', emoji: '🏁' },
  { id: Sport.HORSE_RACING, name: 'Horse Racing', emoji: '🐎' },
];

const ACTIVE_MVP_SELECTION_TYPE_VALUES = [
  SelectionType.SNAKE_DRAFT,
  SelectionType.TIERED,
  SelectionType.BUDGET_PICK,
 ] as const satisfies readonly SelectionType[];

const ACTIVE_MVP_SELECTION_TYPES = new Set<SelectionType>(ACTIVE_MVP_SELECTION_TYPE_VALUES);

type ActiveMvpSelectionType = (typeof ACTIVE_MVP_SELECTION_TYPE_VALUES)[number];

const wizardSchema = z.object({
  leagueId: z.string().min(1, 'Select a league'),
  sport: z.string().min(1, 'Select a sport'),
  eventId: z.string().min(1, 'Select an event'),
  name: z.string().min(1, 'Enter a contest name').max(100, 'Contest name is too long'),
  selectionTemplateId: z.string().min(1, 'Select a selection template'),
  scoringTemplateKey: z.string().min(1, 'Select a scoring template'),
});

type WizardForm = z.infer<typeof wizardSchema>;

type SelectionTemplateDto = z.infer<typeof SelectionTemplateListResponseSchema>[number];
type ScoringTemplateDto = z.infer<typeof ScoringTemplateListResponseSchema>['templates'][number];
type EventDto = z.infer<typeof EventListResponseSchema>['events'][number];
type TemplateConfigOverrides = Record<string, Record<string, unknown>>;
type ActiveSelectionTemplateDto = SelectionTemplateDto & { selectionType: ActiveMvpSelectionType };

const TIER_ASSIGNMENT_OPTIONS = [
  { value: 'WORLD_RANKING', label: 'World ranking' },
  { value: 'ODDS', label: 'Odds' },
  { value: 'SEED', label: 'Seed' },
  { value: 'COMMISSIONER', label: 'Manual assignment' },
];

const PRICING_METHOD_OPTIONS = [
  { value: 'WORLD_RANKING', label: 'World ranking' },
  { value: 'ODDS', label: 'Odds' },
  { value: 'SEED', label: 'Seed' },
  { value: 'COMMISSIONER', label: 'Manual pricing' },
];

function isActiveMvpSelectionType(selectionType: SelectionType): selectionType is ActiveMvpSelectionType {
  return ACTIVE_MVP_SELECTION_TYPES.has(selectionType);
}

function isActiveSelectionTemplate(template: SelectionTemplateDto): template is ActiveSelectionTemplateDto {
  return isActiveMvpSelectionType(template.selectionType as SelectionType);
}

function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-1">
      {Array.from({ length: total }, (_, i) => (
        <div key={i} className="flex items-center">
          <div
            className={cn(
              'flex h-8 w-8 items-center justify-center rounded-full text-xs font-medium transition-colors',
              i < current
                ? 'bg-primary text-primary-foreground'
                : i === current
                  ? 'border-2 border-primary text-primary'
                  : 'border border-muted-foreground/30 text-muted-foreground',
            )}
          >
            {i < current ? <Check className="h-4 w-4" /> : i + 1}
          </div>
          {i < total - 1 && (
            <div
              className={cn(
                'mx-1 h-0.5 w-6',
                i < current ? 'bg-primary' : 'bg-muted-foreground/30',
              )}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function getScoringEngine(sport: string, selectionType: string) {
  if (selectionType === 'BRACKET_PICK_EM') return ScoringEngine.BRACKET;
  if (selectionType === 'PICK_EM') return ScoringEngine.CUMULATIVE;
  if (sport === Sport.GOLF) return ScoringEngine.STROKE_PLAY;

  switch (sport) {
    case Sport.NCAA_BASKETBALL:
    case Sport.NBA:
    case Sport.TENNIS:
    case Sport.SOCCER:
      return ScoringEngine.ADVANCEMENT;
    case Sport.F1:
    case Sport.NASCAR:
    case Sport.HORSE_RACING:
      return ScoringEngine.POSITION;
    default:
      return ScoringEngine.STAT_ACCUMULATION;
  }
}

function formatScoringEngine(scoringEngine: string) {
  switch (scoringEngine) {
    case ScoringEngine.ADVANCEMENT:
      return 'Advancement';
    case ScoringEngine.STAT_ACCUMULATION:
      return 'Stat Accumulation';
    case ScoringEngine.STROKE_PLAY:
      return 'Stroke Play';
    case ScoringEngine.POSITION:
      return 'Position';
    case ScoringEngine.BRACKET:
      return 'Bracket';
    case ScoringEngine.FIGHT_RESULT:
      return 'Fight Result';
    case ScoringEngine.CUMULATIVE:
      return 'Cumulative';
    default:
      return scoringEngine;
  }
}

function formatEventDate(event: EventDto) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(event.startDate));
}

function formatTemplateConfig(config: Record<string, unknown>) {
  const rows: string[] = [];

  if (typeof config.rounds === 'number') rows.push(`${config.rounds} rounds`);
  if (typeof config.draftMode === 'string') rows.push(`Draft mode: ${config.draftMode}`);
  if (typeof config.timePerPickSeconds === 'number') rows.push(`${config.timePerPickSeconds}s per pick`);
  if (typeof config.budget === 'number') rows.push(`Budget: $${config.budget.toLocaleString()}`);
  if (typeof config.rosterSize === 'number') rows.push(`Roster size: ${config.rosterSize}`);
  if (typeof config.pickCount === 'number') rows.push(`Pick count: ${config.pickCount}`);
  if (typeof config.pricingMethod === 'string') {
    rows.push(`Pricing: ${formatPricingMethodLabel(config.pricingMethod)}`);
  }
  if (typeof config.tierAssignmentMethod === 'string') {
    rows.push(`Tiers: ${formatTierAssignmentMethodLabel(config.tierAssignmentMethod)}`);
  }
  if (typeof config.tierCount === 'number') rows.push(`Tier count: ${config.tierCount}`);
  if (typeof config.tierSize === 'number') rows.push(`Tier size: ${config.tierSize}`);
  if (typeof config.picksPerTier === 'number') rows.push(`Picks per tier: ${config.picksPerTier}`);
  if (typeof config.bestBallN === 'number') rows.push(`Best ${config.bestBallN} scores count`);
  if (typeof config.picksPerPeriod === 'number') rows.push(`Picks per period: ${config.picksPerPeriod}`);
  if (typeof config.strikesBeforeElimination === 'number') rows.push(`Strikes before elimination: ${config.strikesBeforeElimination}`);

  return rows;
}

function normalizeSelectionConfig(
  selectionType: SelectionType,
  config: Record<string, unknown>,
): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};

  if (typeof config.isExclusive === 'boolean') normalized.isExclusive = config.isExclusive;
  if (typeof config.bestBallN === 'number') normalized.bestBallN = config.bestBallN;
  if (typeof config.rounds === 'number') normalized.rounds = config.rounds;
  if (typeof config.timePerPickSeconds === 'number') {
    normalized.timePerPickSeconds = config.timePerPickSeconds;
  }
  if (typeof config.draftMode === 'string') normalized.draftMode = config.draftMode;
  if (typeof config.autoPickPolicy === 'string') normalized.autoPickPolicy = config.autoPickPolicy;
  if (typeof config.budget === 'number') normalized.budget = config.budget;
  if (typeof config.rosterSize === 'number') normalized.rosterSize = config.rosterSize;
  if (typeof config.pricingMethod === 'string') normalized.pricingMethod = config.pricingMethod;

  if (selectionType === SelectionType.TIERED) {
    const tierCount = typeof config.tierCount === 'number' ? Math.max(config.tierCount, 1) : 6;
    const picksPerTier = typeof config.picksPerTier === 'number' ? Math.max(config.picksPerTier, 1) : 1;
    const tierSize = typeof config.tierSize === 'number' ? Math.max(config.tierSize, 1) : undefined;

    normalized.tierAssignmentMethod =
      typeof config.tierAssignmentMethod === 'string' ? config.tierAssignmentMethod : 'RANKING';
    normalized.tierConfig = Array.from({ length: tierCount }, (_, index) => ({
      tierId: `tier-${index + 1}`,
      tierName: `Tier ${index + 1}`,
      tierNumber: index + 1,
      picksFromTier: picksPerTier,
      participantIds: [],
      ...(tierSize
        ? {
            maxParticipants: tierSize,
            rankingRange: [index * tierSize + 1, (index + 1) * tierSize] as [number, number],
          }
        : {}),
    }));
  }

  return normalized;
}

function getEffectiveTemplateConfig(
  template: SelectionTemplateDto | undefined,
  overrides: TemplateConfigOverrides,
): Record<string, unknown> {
  if (!template) return {};
  return overrides[template.id] ?? template.config;
}

function parsePositiveInteger(value: string, fallback: number) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function Step1Basics({
  form,
  leagues,
  events,
  eventsLoading,
}: {
  form: ReturnType<typeof useForm<WizardForm>>;
  leagues: Array<{ id: string; name: string; role?: string }>;
  events: EventDto[];
  eventsLoading: boolean;
}) {
  const leagueId = form.watch('leagueId');
  const sport = form.watch('sport');
  const eventId = form.watch('eventId');

  return (
    <div className="space-y-8">
      <Card>
        <CardContent className="p-4 text-sm text-muted-foreground">
          This flow creates draft-once tournament contests only. Choose a real ingested event first, then the contest will provision its live contestant pool from that event.
        </CardContent>
      </Card>

      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Select League</h3>
        {leagues.length === 0 ? (
          <Card>
            <CardContent className="p-4 text-sm text-muted-foreground">
              You need an owner or commissioner role in a league before you can create a contest.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {leagues.map((league) => (
              <button
                key={league.id}
                type="button"
                onClick={() => form.setValue('leagueId', league.id, { shouldValidate: true })}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg border-2 p-4 text-left transition-colors hover:border-primary/50',
                  leagueId === league.id
                    ? 'border-primary bg-primary/5'
                    : 'border-transparent bg-muted/50',
                )}
              >
                <div
                  className={cn(
                    'h-4 w-4 shrink-0 rounded-full border-2',
                    leagueId === league.id ? 'border-primary bg-primary' : 'border-muted-foreground/40',
                  )}
                />
                <div>
                  <p className="font-medium">{league.name}</p>
                  <p className="text-sm text-muted-foreground">{league.role ?? 'member'}</p>
                </div>
              </button>
            ))}
          </div>
        )}
        {form.formState.errors.leagueId && (
          <p className="text-sm text-destructive">{form.formState.errors.leagueId.message}</p>
        )}
      </div>

      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Select Sport</h3>
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
          {SPORTS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                form.setValue('sport', s.id, { shouldValidate: true });
                form.setValue('eventId', '');
                form.setValue('selectionTemplateId', '');
                form.setValue('scoringTemplateKey', '');
              }}
              className={cn(
                'flex flex-col items-center gap-2 rounded-lg border-2 p-4 transition-colors hover:border-primary/50',
                sport === s.id
                  ? 'border-primary bg-primary/5'
                  : 'border-transparent bg-muted/50',
              )}
            >
              <span className="text-2xl">{s.emoji}</span>
              <span className="text-sm font-medium">{s.name}</span>
            </button>
          ))}
        </div>
        {form.formState.errors.sport && (
          <p className="text-sm text-destructive">{form.formState.errors.sport.message}</p>
        )}
      </div>

      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Select Event</h3>
        {!sport ? (
          <Card>
            <CardContent className="p-4 text-sm text-muted-foreground">
              Choose a sport first to load ingested tournament events.
            </CardContent>
          </Card>
        ) : eventsLoading ? (
          <p className="text-sm text-muted-foreground">Loading events...</p>
        ) : events.length === 0 ? (
          <Card>
            <CardContent className="p-4 text-sm text-muted-foreground">
              No ingested events are available for this sport yet. Sync sports data for this tournament before creating the contest.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {events.map((event) => (
              <button
                key={event.id}
                type="button"
                onClick={() => form.setValue('eventId', event.id, { shouldValidate: true })}
                className={cn(
                  'flex w-full items-start gap-3 rounded-lg border-2 p-4 text-left transition-colors hover:border-primary/50',
                  eventId === event.id
                    ? 'border-primary bg-primary/5'
                    : 'border-transparent bg-muted/50',
                )}
              >
                <div
                  className={cn(
                    'mt-0.5 h-4 w-4 shrink-0 rounded-full border-2',
                    eventId === event.id
                      ? 'border-primary bg-primary'
                      : 'border-muted-foreground/40',
                  )}
                />
                <div className="space-y-1">
                  <p className="font-medium">{event.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {formatEventDate(event)}
                    {event.location ? ` • ${event.location}` : ''}
                    {event.venue ? ` • ${event.venue}` : ''}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {event.participantCount ? `${event.participantCount} contestants` : 'Contestant count pending'}
                    {event.fieldLocked ? ' • field locked' : ' • field updateable'}
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}
        {form.formState.errors.eventId && (
          <p className="text-sm text-destructive">{form.formState.errors.eventId.message}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="name">Contest Name</Label>
        <Controller
          name="name"
          control={form.control}
          render={({ field }) => (
            <Input
              id="name"
              placeholder="Masters Pick 6"
              {...field}
            />
          )}
        />
        {form.formState.errors.name && (
          <p className="text-sm text-destructive">{form.formState.errors.name.message}</p>
        )}
      </div>
    </div>
  );
}

function Step2SelectionTemplate({
  form,
  templates,
  isLoading,
  templateConfigOverrides,
  onTemplateConfigChange,
}: {
  form: ReturnType<typeof useForm<WizardForm>>;
  templates: SelectionTemplateDto[];
  isLoading: boolean;
  templateConfigOverrides: TemplateConfigOverrides;
  onTemplateConfigChange: (templateId: string, config: Record<string, unknown>) => void;
}) {
  const selectedId = form.watch('selectionTemplateId');
  const selectedTemplate = templates.find((template) => template.id === selectedId);
  const selectedTemplateConfig = getEffectiveTemplateConfig(selectedTemplate, templateConfigOverrides);

  if (!form.watch('sport')) {
    return (
      <Card>
        <CardContent className="p-4 text-sm text-muted-foreground">
          Choose a sport first to load the live selection templates for single-event contests.
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading selection templates...</p>;
  }

  if (templates.length === 0) {
    return (
      <Card>
        <CardContent className="p-4 text-sm text-muted-foreground">
          No live tiered, budget, or snake templates are available for this sport yet.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Selection Template</h3>
      <div className="space-y-2">
        {templates.map((template) => (
          <button
            key={template.id}
            type="button"
            onClick={() => form.setValue('selectionTemplateId', template.id, { shouldValidate: true })}
            className={cn(
              'flex w-full items-start gap-3 rounded-lg border-2 p-4 text-left transition-colors hover:border-primary/50',
              selectedId === template.id
                ? 'border-primary bg-primary/5'
                : 'border-transparent bg-muted/50',
            )}
          >
            <div
              className={cn(
                'mt-0.5 h-4 w-4 shrink-0 rounded-full border-2',
                selectedId === template.id
                  ? 'border-primary bg-primary'
                  : 'border-muted-foreground/40',
              )}
            />
            <div className="space-y-1">
              <p className="font-medium">{template.name}</p>
              <p className="text-sm text-muted-foreground">{template.description}</p>
              <p className="text-xs text-muted-foreground">Selection type: {formatSelectionTypeLabel(template.selectionType)}</p>
              {formatTemplateConfig(template.config).length > 0 && (
                <p className="text-xs text-muted-foreground">{formatTemplateConfig(template.config).join(' • ')}</p>
              )}
            </div>
          </button>
        ))}
      </div>
      {form.formState.errors.selectionTemplateId && (
        <p className="text-sm text-destructive">{form.formState.errors.selectionTemplateId.message}</p>
      )}
      {selectedTemplate && (
        <Card>
          <CardContent className="space-y-4 p-4">
            <div>
              <h4 className="font-medium">Contestant Setup Controls</h4>
              <p className="text-sm text-muted-foreground">
                Adjust the imported field before contestants are priced and assigned for this contest.
              </p>
            </div>

            {selectedTemplate.selectionType === SelectionType.TIERED && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="tier-count">Tier Count</Label>
                  <Input
                    id="tier-count"
                    type="number"
                    min={1}
                    value={String(selectedTemplateConfig.tierCount ?? 6)}
                    onChange={(event) =>
                      onTemplateConfigChange(selectedTemplate.id, {
                        ...selectedTemplateConfig,
                        tierCount: parsePositiveInteger(event.target.value, 6),
                      })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tier-size">Tier Size</Label>
                  <Input
                    id="tier-size"
                    type="number"
                    min={1}
                    value={String(selectedTemplateConfig.tierSize ?? 10)}
                    onChange={(event) =>
                      onTemplateConfigChange(selectedTemplate.id, {
                        ...selectedTemplateConfig,
                        tierSize: parsePositiveInteger(event.target.value, 10),
                      })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="picks-per-tier">Picks Per Tier</Label>
                  <Input
                    id="picks-per-tier"
                    type="number"
                    min={1}
                    value={String(selectedTemplateConfig.picksPerTier ?? 1)}
                    onChange={(event) =>
                      onTemplateConfigChange(selectedTemplate.id, {
                        ...selectedTemplateConfig,
                        picksPerTier: parsePositiveInteger(event.target.value, 1),
                      })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tier-assignment-method">Tier Assignment</Label>
                  <select
                    id="tier-assignment-method"
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={String(selectedTemplateConfig.tierAssignmentMethod ?? 'WORLD_RANKING')}
                    onChange={(event) =>
                      onTemplateConfigChange(selectedTemplate.id, {
                        ...selectedTemplateConfig,
                        tierAssignmentMethod: event.target.value,
                      })
                    }
                  >
                    {TIER_ASSIGNMENT_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {selectedTemplate.selectionType === SelectionType.BUDGET_PICK && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="budget-total">Budget</Label>
                  <Input
                    id="budget-total"
                    type="number"
                    min={1}
                    value={String(selectedTemplateConfig.budget ?? 5000000)}
                    onChange={(event) =>
                      onTemplateConfigChange(selectedTemplate.id, {
                        ...selectedTemplateConfig,
                        budget: parsePositiveInteger(event.target.value, 5000000),
                      })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="roster-size">Roster Size</Label>
                  <Input
                    id="roster-size"
                    type="number"
                    min={1}
                    value={String(selectedTemplateConfig.rosterSize ?? 6)}
                    onChange={(event) =>
                      onTemplateConfigChange(selectedTemplate.id, {
                        ...selectedTemplateConfig,
                        rosterSize: parsePositiveInteger(event.target.value, 6),
                      })
                    }
                  />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="pricing-method">Pricing Formula</Label>
                  <select
                    id="pricing-method"
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={String(selectedTemplateConfig.pricingMethod ?? 'WORLD_RANKING')}
                    onChange={(event) =>
                      onTemplateConfigChange(selectedTemplate.id, {
                        ...selectedTemplateConfig,
                        pricingMethod: event.target.value,
                      })
                    }
                  >
                    {PRICING_METHOD_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Step3ScoringTemplate({
  form,
  templates,
  isLoading,
}: {
  form: ReturnType<typeof useForm<WizardForm>>;
  templates: ScoringTemplateDto[];
  isLoading: boolean;
}) {
  const selectedKey = form.watch('scoringTemplateKey');

  if (!form.watch('sport')) {
    return (
      <Card>
        <CardContent className="p-4 text-sm text-muted-foreground">
          Choose a sport first to load live scoring templates.
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading scoring templates...</p>;
  }

  if (templates.length === 0) {
    return (
      <Card>
        <CardContent className="p-4 text-sm text-muted-foreground">
          No live scoring templates are available for this sport yet.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Scoring Template</h3>
      <div className="space-y-2">
        {templates.map((template) => (
          <button
            key={template.key}
            type="button"
            onClick={() => form.setValue('scoringTemplateKey', template.key, { shouldValidate: true })}
            className={cn(
              'flex w-full items-start gap-3 rounded-lg border-2 p-4 text-left transition-colors hover:border-primary/50',
              selectedKey === template.key
                ? 'border-primary bg-primary/5'
                : 'border-transparent bg-muted/50',
            )}
          >
            <div
              className={cn(
                'mt-0.5 h-4 w-4 shrink-0 rounded-full border-2',
                selectedKey === template.key
                  ? 'border-primary bg-primary'
                  : 'border-muted-foreground/40',
              )}
            />
            <div>
              <p className="font-medium">{template.key}</p>
              <p className="text-sm text-muted-foreground">{template.sport}</p>
            </div>
          </button>
        ))}
      </div>
      {form.formState.errors.scoringTemplateKey && (
        <p className="text-sm text-destructive">{form.formState.errors.scoringTemplateKey.message}</p>
      )}
    </div>
  );
}

function Step4Review({
  form,
  leagues,
  selectionTemplates,
  events,
  templateConfigOverrides,
}: {
  form: ReturnType<typeof useForm<WizardForm>>;
  leagues: Array<{ id: string; name: string }>;
  selectionTemplates: SelectionTemplateDto[];
  events: EventDto[];
  templateConfigOverrides: TemplateConfigOverrides;
}) {
  const values = form.getValues();
  const sportObj = SPORTS.find((s) => s.id === values.sport);
  const league = leagues.find((item) => item.id === values.leagueId);
  const event = events.find((item) => item.id === values.eventId);
  const selectionTemplate = selectionTemplates.find((item) => item.id === values.selectionTemplateId);
  const effectiveSelectionConfig = getEffectiveTemplateConfig(selectionTemplate, templateConfigOverrides);
  const scoringEngine = selectionTemplate
    ? formatScoringEngine(getScoringEngine(values.sport, selectionTemplate.selectionType))
    : '-';
  const selectionRules = selectionTemplate ? getSelectionConfigSummary(effectiveSelectionConfig) : [];

  const items = [
    { label: 'League', value: league?.name ?? '-' },
    { label: 'Sport', value: sportObj ? `${sportObj.emoji} ${sportObj.name}` : '-' },
    { label: 'Event', value: event?.name ?? '-' },
    { label: 'Contest Type', value: 'Single Event' },
    { label: 'Contest Name', value: values.name || '-' },
    { label: 'Selection Template', value: selectionTemplate?.name ?? '-' },
    { label: 'Selection Type', value: selectionTemplate ? formatSelectionTypeLabel(selectionTemplate.selectionType) : '-' },
    { label: 'Contestant Setup', value: selectionRules.length > 0 ? selectionRules.join(' • ') : '-' },
    { label: 'Scoring Template', value: values.scoringTemplateKey || '-' },
    { label: 'Scoring Engine', value: scoringEngine },
  ];

  return (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold">Review & Create</h3>
      <Card>
        <CardContent className="divide-y p-0">
          {items.map((item) => (
            <div key={item.label} className="flex items-center justify-between px-4 py-3">
              <span className="text-sm text-muted-foreground">{item.label}</span>
              <span className="text-sm font-medium text-right">{item.value}</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

export function Component() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [templateConfigOverrides, setTemplateConfigOverrides] = useState<TemplateConfigOverrides>({});
  const form = useForm<WizardForm>({
    resolver: zodResolver(wizardSchema),
    defaultValues: {
      leagueId: '',
      sport: '',
      eventId: '',
      name: '',
      selectionTemplateId: '',
      scoringTemplateKey: '',
    },
    mode: 'onChange',
  });
  const sport = form.watch('sport');

  const { data: leagueResponse } = useQuery({
    queryKey: ['my-leagues', 'contest-create'],
    queryFn: async () => {
      const { data, error } = await listLeagues({ client });
      if (error) throw error;
      return data;
    },
  });

  const { data: eventsResponse, isLoading: eventsLoading } = useQuery({
    queryKey: ['events', 'contest-create', sport],
    queryFn: async () => {
      const { data, error } = await client.get({
        url: '/api/v1/events',
        query: {
          sport,
          limit: 25,
        },
      });
      if (error) throw error;
      return EventListResponseSchema.parse(data);
    },
    enabled: !!sport,
  });

  const { data: selectionTemplatesResponse = [], isLoading: selectionTemplatesLoading } = useQuery({
    queryKey: ['selection-templates', 'contest-create', sport],
    queryFn: async () => {
      const { data, error } = await listSelectionTemplates({
        client,
        query: {
          sport,
          contestType: 'SINGLE_EVENT',
        },
      });
      if (error) throw error;
      return SelectionTemplateListResponseSchema.parse(data ?? []);
    },
    enabled: !!sport,
  });

  const { data: scoringTemplatesResponse, isLoading: scoringTemplatesLoading } = useQuery({
    queryKey: ['scoring-templates', 'contest-create'],
    queryFn: async () => {
      const { data, error } = await listScoringTemplates({ client });
      if (error) throw error;
      return ScoringTemplateListResponseSchema.parse(data);
    },
  });

  const scoringTemplates = (scoringTemplatesResponse?.templates ?? []).filter((template) => template.sport === sport);
  const events = eventsResponse?.events ?? [];
  const selectionTemplates = selectionTemplatesResponse.filter(isActiveSelectionTemplate);
  const commissionerLeagues = (leagueResponse?.leagues ?? []).filter(
    (league) => league.role === 'owner' || league.role === 'commissioner',
  );

  const stepValidation: Record<number, (keyof WizardForm)[]> = {
    0: ['leagueId', 'sport', 'eventId', 'name'],
    1: ['selectionTemplateId'],
    2: ['scoringTemplateKey'],
  };

  async function handleNext() {
    const fieldsToValidate = stepValidation[step];
    if (fieldsToValidate) {
      const valid = await form.trigger(fieldsToValidate);
      if (!valid) return;
    }
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  function handleBack() {
    setStep((s) => Math.max(s - 1, 0));
  }

  function handleTemplateConfigChange(templateId: string, config: Record<string, unknown>) {
    setTemplateConfigOverrides((current) => ({
      ...current,
      [templateId]: config,
    }));
  }

  async function handleCreate() {
    try {
      const values = form.getValues();
      const selectionTemplate = selectionTemplates.find((template) => template.id === values.selectionTemplateId);
      const event = events.find((item) => item.id === values.eventId);

      if (!selectionTemplate) throw new Error('Selection template is missing.');
      if (!event) throw new Error('Event is missing.');

      const selectionType = selectionTemplate.selectionType;
      const effectiveTemplateConfig = getEffectiveTemplateConfig(selectionTemplate, templateConfigOverrides);
      const selectionConfig = normalizeSelectionConfig(selectionType, effectiveTemplateConfig);

      const { data: result, error } = await createContest({
        client,
        path: { id: values.leagueId },
        body: {
          name: values.name,
          sport: values.sport,
          eventId: values.eventId,
          contestType: 'SINGLE_EVENT',
          selectionType,
          selectionConfig,
          scoringEngine: getScoringEngine(values.sport, selectionType),
          scoringTemplateKey: values.scoringTemplateKey,
          startsAt: event.startDate,
          endsAt: event.endDate ?? event.startDate,
          lockAt: event.startDate,
          isExclusive: Boolean(selectionConfig.isExclusive),
        },
      });

      if (error) throw error;

      toast({
        title: 'Contest created',
        description: 'Your contest has been created successfully.',
      });
      navigate(`/contests/${result?.contest.id}`);
    } catch {
      toast({
        title: 'Error',
        description: 'Failed to create contest. Please try again.',
      });
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Create Contest</h1>
          <p className="text-sm text-muted-foreground">
            Step {step + 1} of {STEPS.length} - {STEPS[step].label}
          </p>
        </div>
        <StepIndicator current={step} total={STEPS.length} />
      </div>

      <Card>
        <CardContent className="p-6">
          {step === 0 && (
            <Step1Basics
              form={form}
              leagues={commissionerLeagues}
              events={events}
              eventsLoading={eventsLoading}
            />
          )}
          {step === 1 && (
            <Step2SelectionTemplate
              form={form}
              templates={selectionTemplates}
              isLoading={selectionTemplatesLoading}
              templateConfigOverrides={templateConfigOverrides}
              onTemplateConfigChange={handleTemplateConfigChange}
            />
          )}
          {step === 2 && (
            <Step3ScoringTemplate
              form={form}
              templates={scoringTemplates}
              isLoading={scoringTemplatesLoading}
            />
          )}
          {step === 3 && (
            <Step4Review
              form={form}
              leagues={commissionerLeagues}
              selectionTemplates={selectionTemplates}
              events={events}
              templateConfigOverrides={templateConfigOverrides}
            />
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          onClick={step === 0 ? () => navigate(-1) : handleBack}
        >
          <ChevronLeft className="mr-1 h-4 w-4" />
          {step === 0 ? 'Cancel' : 'Back'}
        </Button>

        {step < STEPS.length - 1 ? (
          <Button onClick={handleNext}>
            Next
            <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        ) : (
          <Button onClick={handleCreate}>
            <Trophy className="mr-2 h-4 w-4" />
            Create Contest
          </Button>
        )}
      </div>
    </div>
  );
}
