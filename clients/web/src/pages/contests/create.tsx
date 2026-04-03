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
import { Sport, ScoringEngine, type SelectionType } from '@poolmaster/shared/domain';
import {
  SelectionTemplateListResponseSchema,
  ScoringTemplateListResponseSchema,
} from '@poolmaster/shared/dto';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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

const wizardSchema = z.object({
  leagueId: z.string().min(1, 'Select a league'),
  sport: z.string().min(1, 'Select a sport'),
  name: z.string().min(1, 'Enter a contest name').max(100, 'Contest name is too long'),
  selectionTemplateId: z.string().min(1, 'Select a selection template'),
  scoringTemplateKey: z.string().min(1, 'Select a scoring template'),
});

type WizardForm = z.infer<typeof wizardSchema>;

type SelectionTemplateDto = z.infer<typeof SelectionTemplateListResponseSchema>[number];
type ScoringTemplateDto = z.infer<typeof ScoringTemplateListResponseSchema>['templates'][number];

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

function formatSelectionType(selectionType: string) {
  switch (selectionType) {
    case 'SNAKE_DRAFT':
      return 'Snake Draft';
    case 'TIERED':
      return 'Tiered';
    case 'BUDGET_PICK':
      return 'Budget Pick';
    case 'OPEN_SELECTION':
      return 'Open Selection';
    case 'PICK_EM':
      return "Pick'em";
    case 'BRACKET_PICK_EM':
      return "Bracket Pick'em";
    default:
      return selectionType;
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

function formatTemplateConfig(config: Record<string, unknown>) {
  const rows: string[] = [];

  if (typeof config.rounds === 'number') rows.push(`${config.rounds} rounds`);
  if (typeof config.draftMode === 'string') rows.push(`Draft mode: ${config.draftMode}`);
  if (typeof config.timePerPickSeconds === 'number') rows.push(`${config.timePerPickSeconds}s per pick`);
  if (typeof config.budget === 'number') rows.push(`Budget: $${config.budget.toLocaleString()}`);
  if (typeof config.rosterSize === 'number') rows.push(`Roster size: ${config.rosterSize}`);
  if (typeof config.pickCount === 'number') rows.push(`Pick count: ${config.pickCount}`);
  if (typeof config.bestBallN === 'number') rows.push(`Best ${config.bestBallN} scores count`);
  if (typeof config.picksPerPeriod === 'number') rows.push(`Picks per period: ${config.picksPerPeriod}`);
  if (typeof config.strikesBeforeElimination === 'number') rows.push(`Strikes before elimination: ${config.strikesBeforeElimination}`);

  return rows;
}

function Step1Basics({
  form,
  leagues,
}: {
  form: ReturnType<typeof useForm<WizardForm>>;
  leagues: Array<{ id: string; name: string; role?: string }>;
}) {
  const leagueId = form.watch('leagueId');
  const sport = form.watch('sport');

  return (
    <div className="space-y-8">
      <Card>
        <CardContent className="p-4 text-sm text-muted-foreground">
          This flow creates single-event contests only. Event catalogs and advanced contest configuration are not wired here yet, so this page only exposes fields backed by the live API.
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
}: {
  form: ReturnType<typeof useForm<WizardForm>>;
  templates: SelectionTemplateDto[];
  isLoading: boolean;
}) {
  const selectedId = form.watch('selectionTemplateId');

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
          No live selection templates are available for this sport yet.
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
              <p className="text-xs text-muted-foreground">Selection type: {formatSelectionType(template.selectionType)}</p>
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
}: {
  form: ReturnType<typeof useForm<WizardForm>>;
  leagues: Array<{ id: string; name: string }>;
  selectionTemplates: SelectionTemplateDto[];
}) {
  const values = form.getValues();
  const sportObj = SPORTS.find((s) => s.id === values.sport);
  const league = leagues.find((item) => item.id === values.leagueId);
  const selectionTemplate = selectionTemplates.find((item) => item.id === values.selectionTemplateId);
  const scoringEngine = selectionTemplate
    ? formatScoringEngine(getScoringEngine(values.sport, selectionTemplate.selectionType))
    : '-';

  const items = [
    { label: 'League', value: league?.name ?? '-' },
    { label: 'Sport', value: sportObj ? `${sportObj.emoji} ${sportObj.name}` : '-' },
    { label: 'Contest Type', value: 'Single Event' },
    { label: 'Contest Name', value: values.name || '-' },
    { label: 'Selection Template', value: selectionTemplate?.name ?? '-' },
    { label: 'Selection Type', value: selectionTemplate ? formatSelectionType(selectionTemplate.selectionType) : '-' },
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
  const form = useForm<WizardForm>({
    resolver: zodResolver(wizardSchema),
    defaultValues: {
      leagueId: '',
      sport: '',
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

  const { data: selectionTemplates = [], isLoading: selectionTemplatesLoading } = useQuery({
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
  const commissionerLeagues = (leagueResponse?.leagues ?? []).filter(
    (league) => league.role === 'owner' || league.role === 'commissioner',
  );

  const stepValidation: Record<number, (keyof WizardForm)[]> = {
    0: ['leagueId', 'sport', 'name'],
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

  async function handleCreate() {
    try {
      const values = form.getValues();
      const selectionTemplate = selectionTemplates.find((template) => template.id === values.selectionTemplateId);

      if (!selectionTemplate) {
        throw new Error('Selection template is missing.');
      }

      const selectionType = selectionTemplate.selectionType as SelectionType;

      const { data: result, error } = await createContest({
        client,
        path: { id: values.leagueId },
        body: {
          name: values.name,
          contestType: 'SINGLE_EVENT',
          selectionType,
          selectionConfig: selectionTemplate.config,
          scoringEngine: getScoringEngine(values.sport, selectionType),
          scoringTemplateKey: values.scoringTemplateKey,
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
          {step === 0 && <Step1Basics form={form} leagues={commissionerLeagues} />}
          {step === 1 && (
            <Step2SelectionTemplate
              form={form}
              templates={selectionTemplates}
              isLoading={selectionTemplatesLoading}
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
