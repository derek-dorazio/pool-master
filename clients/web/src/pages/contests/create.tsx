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
  Calendar,
  Clock,
  Users,
  Settings2,
  ClipboardList,
} from 'lucide-react';
import { Sport } from '@poolmaster/shared/domain';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/hooks/use-toast';
import { client, createContest, listLeagues } from '@/lib/api';

const STEPS = [
  { label: 'Sport & Event', icon: Trophy },
  { label: 'Contest Type', icon: Settings2 },
  { label: 'Scoring Rules', icon: ClipboardList },
  { label: 'Draft Config', icon: Clock },
  { label: 'Participants', icon: Users },
  { label: 'Entry Settings', icon: Calendar },
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

const EVENTS_BY_SPORT: Record<string, Array<{ id: string; name: string; venue: string; dates: string; field: string }>> = {
  [Sport.GOLF]: [
    { id: 'masters-2026', name: 'The Masters 2026', venue: 'Augusta National', dates: 'Apr 9-12', field: '90 players' },
    { id: 'pga-2026', name: 'PGA Championship 2026', venue: 'Aronimink GC', dates: 'May 14-17', field: 'TBD' },
    { id: 'us-open-2026', name: 'US Open 2026', venue: 'Shinnecock Hills', dates: 'Jun 18-21', field: 'TBD' },
  ],
  [Sport.NFL]: [
    { id: 'nfl-week1-2026', name: 'NFL Week 1 2026', venue: 'Various', dates: 'Sep 10-13', field: '32 teams' },
    { id: 'nfl-playoffs-2026', name: 'NFL Playoffs 2027', venue: 'Various', dates: 'Jan 9-Feb 7', field: '14 teams' },
    { id: 'super-bowl-2027', name: 'Super Bowl LXI', venue: 'SoFi Stadium', dates: 'Feb 7, 2027', field: '2 teams' },
  ],
  [Sport.NBA]: [
    { id: 'nba-playoffs-2026', name: 'NBA Playoffs 2026', venue: 'Various', dates: 'Apr 18-Jun', field: '16 teams' },
    { id: 'nba-finals-2026', name: 'NBA Finals 2026', venue: 'TBD', dates: 'Jun 2026', field: '2 teams' },
    { id: 'nba-allstar-2027', name: 'NBA All-Star Weekend', venue: 'TBD', dates: 'Feb 2027', field: '24 players' },
  ],
  [Sport.F1]: [
    { id: 'f1-monaco-2026', name: 'Monaco Grand Prix 2026', venue: 'Circuit de Monaco', dates: 'May 24', field: '20 drivers' },
    { id: 'f1-silverstone-2026', name: 'British Grand Prix 2026', venue: 'Silverstone', dates: 'Jul 5', field: '20 drivers' },
    { id: 'f1-monza-2026', name: 'Italian Grand Prix 2026', venue: 'Monza', dates: 'Sep 6', field: '20 drivers' },
  ],
  [Sport.NCAA_BASKETBALL]: [
    { id: 'march-madness-2027', name: 'March Madness 2027', venue: 'Various', dates: 'Mar 16-Apr 5', field: '68 teams' },
    { id: 'cfp-2026', name: 'College Football Playoff 2026', venue: 'Various', dates: 'Dec-Jan', field: '12 teams' },
    { id: 'ncaa-bowl-2026', name: 'Bowl Season 2026', venue: 'Various', dates: 'Dec 2026', field: '40+ teams' },
  ],
  [Sport.TENNIS]: [
    { id: 'wimbledon-2026', name: 'Wimbledon 2026', venue: 'All England Club', dates: 'Jun 29-Jul 12', field: '128 players' },
    { id: 'us-open-tennis-2026', name: 'US Open 2026', venue: 'Flushing Meadows', dates: 'Aug 31-Sep 13', field: '128 players' },
    { id: 'aus-open-2027', name: 'Australian Open 2027', venue: 'Melbourne Park', dates: 'Jan 18-31', field: '128 players' },
  ],
  [Sport.SOCCER]: [
    { id: 'world-cup-2026', name: 'FIFA World Cup 2026', venue: 'USA/CAN/MEX', dates: 'Jun-Jul 2026', field: '48 teams' },
    { id: 'epl-2026', name: 'Premier League 2026-27', venue: 'Various', dates: 'Aug 2026-May 2027', field: '20 teams' },
    { id: 'ucl-2026', name: 'Champions League 2026-27', venue: 'Various', dates: 'Sep 2026-Jun 2027', field: '36 teams' },
  ],
  [Sport.NASCAR]: [
    { id: 'daytona-2027', name: 'Daytona 500 2027', venue: 'Daytona International', dates: 'Feb 14, 2027', field: '40 cars' },
    { id: 'nascar-coke600-2026', name: 'Coca-Cola 600 2026', venue: 'Charlotte Motor', dates: 'May 24', field: '40 cars' },
    { id: 'nascar-champ-2026', name: 'NASCAR Championship 2026', venue: 'Phoenix Raceway', dates: 'Nov 8', field: '4 cars' },
  ],
  [Sport.HORSE_RACING]: [
    { id: 'ky-derby-2026', name: 'Kentucky Derby 2026', venue: 'Churchill Downs', dates: 'May 2', field: '20 horses' },
    { id: 'preakness-2026', name: 'Preakness Stakes 2026', venue: 'Pimlico', dates: 'May 16', field: '14 horses' },
    { id: 'belmont-2026', name: 'Belmont Stakes 2026', venue: 'Belmont Park', dates: 'Jun 6', field: '12 horses' },
  ],
};

const SELECTION_TYPES = [
  { id: 'snake-draft', name: 'Snake Draft', emoji: '🐍', description: 'Turn-based, exclusive picks each round', requiresBracket: false },
  { id: 'tiered', name: 'Tiered Pick', emoji: '📊', description: 'Pick one from each tier of participants', requiresBracket: false },
  { id: 'budget', name: 'Budget Pick', emoji: '💰', description: 'Build a roster within a salary cap', requiresBracket: false },
  { id: 'open', name: 'Open Selection', emoji: '📋', description: 'Pick any N from the full field', requiresBracket: false },
  { id: 'pickem', name: "Pick'em", emoji: '🏆', description: 'Predict winners for each matchup', requiresBracket: false },
  { id: 'survivor', name: 'Survivor', emoji: '💀', description: 'One wrong pick and you are eliminated', requiresBracket: false },
  { id: 'bracket', name: 'Bracket', emoji: '🏅', description: 'Fill out a tournament bracket', requiresBracket: true },
];

const SCORING_TEMPLATES: Record<string, Array<{ id: string; name: string; description: string; rules: Array<{ stat: string; points: string; condition: string }> }>> = {
  [Sport.GOLF]: [
    {
      id: 'stroke-play',
      name: 'Stroke Play (Standard)',
      description: 'Points based on total strokes vs par; lower is better',
      rules: [
        { stat: 'Eagle', points: '+4', condition: 'Per hole' },
        { stat: 'Birdie', points: '+3', condition: 'Per hole' },
        { stat: 'Par', points: '+0.5', condition: 'Per hole' },
        { stat: 'Bogey', points: '-1', condition: 'Per hole' },
        { stat: 'Double+', points: '-2', condition: 'Per hole' },
        { stat: 'Missed Cut', points: '-5', condition: 'Per event' },
      ],
    },
    {
      id: 'dfs-points',
      name: 'DFS Points',
      description: 'Fantasy-style scoring with position bonuses',
      rules: [
        { stat: 'Eagle', points: '+8', condition: 'Per hole' },
        { stat: 'Birdie', points: '+3', condition: 'Per hole' },
        { stat: 'Par', points: '+0.5', condition: 'Per hole' },
        { stat: 'Bogey', points: '-0.5', condition: 'Per hole' },
        { stat: 'Top 10 Finish', points: '+5', condition: 'Bonus' },
        { stat: 'Win', points: '+10', condition: 'Bonus' },
      ],
    },
  ],
  [Sport.NFL]: [
    {
      id: 'nfl-standard',
      name: 'NFL Standard',
      description: 'Classic fantasy scoring with rushing, passing, and receiving',
      rules: [
        { stat: 'Passing TD', points: '+4', condition: 'Per TD' },
        { stat: 'Rushing TD', points: '+6', condition: 'Per TD' },
        { stat: 'Receiving TD', points: '+6', condition: 'Per TD' },
        { stat: 'Passing Yard', points: '+0.04', condition: 'Per yard' },
        { stat: 'Rushing Yard', points: '+0.1', condition: 'Per yard' },
        { stat: 'Interception', points: '-2', condition: 'Per INT' },
      ],
    },
    {
      id: 'nfl-ppr',
      name: 'NFL PPR',
      description: 'Points per reception added to standard scoring',
      rules: [
        { stat: 'Reception', points: '+1', condition: 'Per catch' },
        { stat: 'Passing TD', points: '+4', condition: 'Per TD' },
        { stat: 'Rushing TD', points: '+6', condition: 'Per TD' },
        { stat: 'Receiving TD', points: '+6', condition: 'Per TD' },
        { stat: 'Passing Yard', points: '+0.04', condition: 'Per yard' },
        { stat: 'Fumble', points: '-2', condition: 'Per fumble lost' },
      ],
    },
  ],
};

const defaultTemplates = [
  {
    id: 'generic-standard',
    name: 'Standard Scoring',
    description: 'Balanced point system for general competition',
    rules: [
      { stat: 'Win', points: '+10', condition: 'Per event' },
      { stat: 'Top 5', points: '+5', condition: 'Per event' },
      { stat: 'Top 10', points: '+3', condition: 'Per event' },
      { stat: 'Participation', points: '+1', condition: 'Per event' },
    ],
  },
  {
    id: 'generic-weighted',
    name: 'Weighted Position',
    description: 'Higher finish = exponentially more points',
    rules: [
      { stat: '1st Place', points: '+25', condition: 'Per event' },
      { stat: '2nd Place', points: '+18', condition: 'Per event' },
      { stat: '3rd Place', points: '+15', condition: 'Per event' },
      { stat: 'Top 10', points: '+5', condition: 'Per event' },
    ],
  },
];

const wizardSchema = z.object({
  leagueId: z.string().min(1, 'Select a league'),
  sport: z.string().min(1, 'Select a sport'),
  eventId: z.string().min(1, 'Select an event'),
  duration: z.enum(['single', 'season']),
  selectionType: z.string().min(1, 'Select a contest type'),
  scoringTemplateId: z.string().min(1, 'Select a scoring template'),
  customize: z.boolean(),
  draftMode: z.enum(['live', 'async']),
  secondsPerPick: z.number().min(15).max(300),
  draftDate: z.string(),
  maxEntries: z.number().min(1).max(10),
  entryDeadline: z.string(),
  rosterSize: z.number().min(1).max(20),
});

type WizardForm = z.infer<typeof wizardSchema>;

const selectionTypeMap = {
  'snake-draft': 'SNAKE_DRAFT',
  tiered: 'TIERED',
  budget: 'BUDGET_PICK',
  open: 'OPEN_SELECTION',
  pickem: 'PICK_EM',
  bracket: 'BRACKET_PICK_EM',
} as const;

function getScoringEngine(selectionType: WizardForm['selectionType'], sport: string) {
  if (selectionType === 'bracket') return 'BRACKET' as const;
  if (sport === Sport.GOLF) return 'STROKE_PLAY' as const;
  if (sport === Sport.NFL || sport === Sport.NBA) return 'STAT_ACCUMULATION' as const;
  return 'POSITION' as const;
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
                  : 'border border-muted-foreground/30 text-muted-foreground'
            )}
          >
            {i < current ? <Check className="h-4 w-4" /> : i + 1}
          </div>
          {i < total - 1 && (
            <div
              className={cn(
                'mx-1 h-0.5 w-6',
                i < current ? 'bg-primary' : 'bg-muted-foreground/30'
              )}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function Step1SportEvent({
  form,
  leagues,
}: {
  form: ReturnType<typeof useForm<WizardForm>>;
  leagues: Array<{ id: string; name: string; role?: string }>;
}) {
  const leagueId = form.watch('leagueId');
  const sport = form.watch('sport');
  const eventId = form.watch('eventId');
  const events = sport ? (EVENTS_BY_SPORT[sport] ?? []) : [];

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Select League</h3>
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
              }}
              className={cn(
                'flex flex-col items-center gap-2 rounded-lg border-2 p-4 transition-colors hover:border-primary/50',
                sport === s.id
                  ? 'border-primary bg-primary/5'
                  : 'border-transparent bg-muted/50'
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

      {sport && (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold">Select Event</h3>
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
                    : 'border-transparent bg-muted/50'
                )}
              >
                <div
                  className={cn(
                    'mt-0.5 h-4 w-4 shrink-0 rounded-full border-2',
                    eventId === event.id
                      ? 'border-primary bg-primary'
                      : 'border-muted-foreground/40'
                  )}
                />
                <div>
                  <p className="font-medium">{event.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {event.venue} &middot; {event.dates} &middot; Field: {event.field}
                  </p>
                </div>
              </button>
            ))}
            <button
              type="button"
              onClick={() => form.setValue('eventId', 'custom', { shouldValidate: true })}
              className={cn(
                'flex w-full items-center gap-3 rounded-lg border-2 border-dashed p-4 text-left transition-colors hover:border-primary/50',
                eventId === 'custom'
                  ? 'border-primary bg-primary/5'
                  : 'border-muted-foreground/30'
              )}
            >
              <span className="text-lg">+</span>
              <span className="text-sm font-medium text-muted-foreground">Create custom event</span>
            </button>
          </div>
          {form.formState.errors.eventId && (
            <p className="text-sm text-destructive">{form.formState.errors.eventId.message}</p>
          )}
        </div>
      )}
    </div>
  );
}

function Step2ContestType({
  form,
}: {
  form: ReturnType<typeof useForm<WizardForm>>;
}) {
  const duration = form.watch('duration');
  const selectionType = form.watch('selectionType');
  const sport = form.watch('sport');
  const bracketSports: string[] = [Sport.NCAA_BASKETBALL, Sport.NBA];

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Contest Duration</h3>
        <div className="space-y-3">
          {[
            { value: 'single' as const, label: 'Single Event', desc: 'One tournament, race, or playoff round' },
            { value: 'season' as const, label: 'Season Long', desc: 'Spans the full competition season' },
          ].map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => form.setValue('duration', opt.value, { shouldValidate: true })}
              className={cn(
                'flex w-full items-center gap-3 rounded-lg border-2 p-4 text-left transition-colors hover:border-primary/50',
                duration === opt.value
                  ? 'border-primary bg-primary/5'
                  : 'border-transparent bg-muted/50'
              )}
            >
              <div
                className={cn(
                  'h-4 w-4 shrink-0 rounded-full border-2',
                  duration === opt.value
                    ? 'border-primary bg-primary'
                    : 'border-muted-foreground/40'
                )}
              />
              <div>
                <p className="font-medium">{opt.label}</p>
                <p className="text-sm text-muted-foreground">{opt.desc}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Selection Type</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          {SELECTION_TYPES.filter(
            (t) => !t.requiresBracket || bracketSports.includes(sport)
          ).map((type) => (
            <button
              key={type.id}
              type="button"
              onClick={() => form.setValue('selectionType', type.id, { shouldValidate: true })}
              className={cn(
                'flex flex-col items-start gap-1 rounded-lg border-2 p-4 text-left transition-colors hover:border-primary/50',
                selectionType === type.id
                  ? 'border-primary bg-primary/5'
                  : 'border-transparent bg-muted/50'
              )}
            >
              <div className="flex items-center gap-2">
                <span className="text-xl">{type.emoji}</span>
                <span className="font-medium">{type.name}</span>
              </div>
              <p className="text-sm text-muted-foreground">{type.description}</p>
            </button>
          ))}
        </div>
        {form.formState.errors.selectionType && (
          <p className="text-sm text-destructive">{form.formState.errors.selectionType.message}</p>
        )}
      </div>
    </div>
  );
}

function Step3ScoringRules({
  form,
}: {
  form: ReturnType<typeof useForm<WizardForm>>;
}) {
  const sport = form.watch('sport');
  const scoringTemplateId = form.watch('scoringTemplateId');
  const customize = form.watch('customize');
  const templates = SCORING_TEMPLATES[sport] ?? defaultTemplates;
  const selectedTemplate = templates.find((t) => t.id === scoringTemplateId);

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Scoring Template</h3>
        <div className="space-y-2">
          {templates.map((tmpl) => (
            <button
              key={tmpl.id}
              type="button"
              onClick={() => form.setValue('scoringTemplateId', tmpl.id, { shouldValidate: true })}
              className={cn(
                'flex w-full items-start gap-3 rounded-lg border-2 p-4 text-left transition-colors hover:border-primary/50',
                scoringTemplateId === tmpl.id
                  ? 'border-primary bg-primary/5'
                  : 'border-transparent bg-muted/50'
              )}
            >
              <div
                className={cn(
                  'mt-0.5 h-4 w-4 shrink-0 rounded-full border-2',
                  scoringTemplateId === tmpl.id
                    ? 'border-primary bg-primary'
                    : 'border-muted-foreground/40'
                )}
              />
              <div>
                <p className="font-medium">{tmpl.name}</p>
                <p className="text-sm text-muted-foreground">{tmpl.description}</p>
              </div>
            </button>
          ))}
        </div>
        {form.formState.errors.scoringTemplateId && (
          <p className="text-sm text-destructive">{form.formState.errors.scoringTemplateId.message}</p>
        )}
      </div>

      {selectedTemplate && (
        <div className="space-y-4">
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-4 py-2 text-left font-medium">Stat</th>
                  <th className="px-4 py-2 text-left font-medium">Points</th>
                  <th className="px-4 py-2 text-left font-medium">Condition</th>
                </tr>
              </thead>
              <tbody>
                {selectedTemplate.rules.map((rule, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="px-4 py-2">{rule.stat}</td>
                    <td className="px-4 py-2 font-mono">{rule.points}</td>
                    <td className="px-4 py-2 text-muted-foreground">{rule.condition}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => form.setValue('customize', !customize)}
              className={cn(
                'relative h-6 w-11 rounded-full transition-colors',
                customize ? 'bg-primary' : 'bg-muted-foreground/30'
              )}
            >
              <span
                className={cn(
                  'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform',
                  customize ? 'translate-x-5' : 'translate-x-0.5'
                )}
              />
            </button>
            <span className="text-sm font-medium">Customize scoring rules</span>
          </div>

          {customize && (
            <Card>
              <CardContent className="p-4">
                <p className="text-sm text-muted-foreground">
                  Custom rule editing will be available in a future update. The selected template rules will be used as-is.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

function Step4DraftConfig() {
  return (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold">Draft Configuration</h3>
      <div className="space-y-4">
        <div className="space-y-2">
          <Label>Draft Mode</Label>
          <div className="flex gap-2">
            <div className="flex-1 rounded-lg border-2 border-primary bg-primary/5 p-3 text-center text-sm font-medium">
              LIVE
            </div>
            <div className="flex-1 rounded-lg border-2 border-transparent bg-muted/50 p-3 text-center text-sm font-medium text-muted-foreground">
              ASYNC
            </div>
          </div>
        </div>
        <div className="space-y-2">
          <Label>Seconds Per Pick</Label>
          <div className="flex items-center gap-4">
            <input
              type="range"
              min={15}
              max={300}
              defaultValue={90}
              className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-muted-foreground/20 accent-primary"
              disabled
            />
            <span className="w-12 text-right text-sm font-mono">90s</span>
          </div>
        </div>
        <div className="space-y-2">
          <Label>Draft Date</Label>
          <Input type="date" defaultValue="2026-04-07" disabled />
        </div>
      </div>
    </div>
  );
}

function Step5Participants() {
  return (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold">Participant Pool</h3>
      <Card>
        <CardContent className="flex items-center gap-3 p-6">
          <Users className="h-8 w-8 text-primary" />
          <div>
            <p className="font-medium">Full field selected</p>
            <p className="text-sm text-muted-foreground">90 participants available for this event</p>
          </div>
        </CardContent>
      </Card>
      <p className="text-sm text-muted-foreground">
        Participant pool customization (include/exclude specific players) will be available in a future update.
      </p>
    </div>
  );
}

function Step6EntrySettings({
  form,
}: {
  form: ReturnType<typeof useForm<WizardForm>>;
}) {
  return (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold">Entry Settings</h3>
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="maxEntries">Max Entries Per Member</Label>
          <Controller
            name="maxEntries"
            control={form.control}
            render={({ field }) => (
              <Input
                id="maxEntries"
                type="number"
                min={1}
                max={10}
                {...field}
                onChange={(e) => field.onChange(Number(e.target.value))}
              />
            )}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="entryDeadline">Entry Deadline</Label>
          <Controller
            name="entryDeadline"
            control={form.control}
            render={({ field }) => (
              <Input id="entryDeadline" type="date" {...field} />
            )}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="rosterSize">Roster Size</Label>
          <Controller
            name="rosterSize"
            control={form.control}
            render={({ field }) => (
              <Input
                id="rosterSize"
                type="number"
                min={1}
                max={20}
                {...field}
                onChange={(e) => field.onChange(Number(e.target.value))}
              />
            )}
          />
        </div>
      </div>
    </div>
  );
}

function Step7Review({
  form,
}: {
  form: ReturnType<typeof useForm<WizardForm>>;
}) {
  const values = form.getValues();
  const sportObj = SPORTS.find((s) => s.id === values.sport);
  const events = values.sport ? (EVENTS_BY_SPORT[values.sport] ?? []) : [];
  const event = events.find((e) => e.id === values.eventId);
  const templates = SCORING_TEMPLATES[values.sport] ?? defaultTemplates;
  const template = templates.find((t) => t.id === values.scoringTemplateId);
  const selType = SELECTION_TYPES.find((t) => t.id === values.selectionType);

  const items = [
    { label: 'Sport', value: sportObj ? `${sportObj.emoji} ${sportObj.name}` : '-' },
    { label: 'Event', value: event?.name ?? (values.eventId === 'custom' ? 'Custom Event' : '-') },
    { label: 'Duration', value: values.duration === 'single' ? 'Single Event' : 'Season Long' },
    { label: 'Selection Type', value: selType?.name ?? '-' },
    { label: 'Scoring', value: template?.name ?? '-' },
    { label: 'Draft Mode', value: values.draftMode === 'live' ? 'Live' : 'Async' },
    { label: 'Max Entries', value: String(values.maxEntries) },
    { label: 'Entry Deadline', value: values.entryDeadline || '-' },
    { label: 'Roster Size', value: String(values.rosterSize) },
  ];

  return (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold">Review & Create</h3>
      <Card>
        <CardContent className="divide-y p-0">
          {items.map((item) => (
            <div key={item.label} className="flex items-center justify-between px-4 py-3">
              <span className="text-sm text-muted-foreground">{item.label}</span>
              <span className="text-sm font-medium">{item.value}</span>
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
  const { data: leagueResponse } = useQuery({
    queryKey: ['my-leagues', 'contest-create'],
    queryFn: async () => {
      const { data, error } = await listLeagues({ client });
      if (error) throw error;
      return data;
    },
  });
  const commissionerLeagues = (leagueResponse?.leagues ?? []).filter(
    (league) => league.role === 'owner' || league.role === 'commissioner',
  );

  const form = useForm<WizardForm>({
    resolver: zodResolver(wizardSchema),
    defaultValues: {
      leagueId: '',
      sport: '',
      eventId: '',
      duration: 'single',
      selectionType: '',
      scoringTemplateId: '',
      customize: false,
      draftMode: 'live',
      secondsPerPick: 90,
      draftDate: '2026-04-07',
      maxEntries: 1,
      entryDeadline: '2026-04-08',
      rosterSize: 4,
    },
    mode: 'onChange',
  });

  const stepValidation: Record<number, (keyof WizardForm)[]> = {
    0: ['leagueId', 'sport', 'eventId'],
    1: ['duration', 'selectionType'],
    2: ['scoringTemplateId'],
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
      const selectedEvent = (EVENTS_BY_SPORT[values.sport] ?? []).find((event) => event.id === values.eventId);
      const { data: result, error } = await createContest({
        client,
        path: { id: values.leagueId },
        body: {
          name: selectedEvent?.name ?? `${values.sport} Contest`,
          contestType: 'SINGLE_EVENT',
          selectionType: selectionTypeMap[values.selectionType as keyof typeof selectionTypeMap],
          scoringEngine: getScoringEngine(values.selectionType, values.sport),
          scoringTemplateKey: values.scoringTemplateId,
          startsAt: values.draftDate ? new Date(`${values.draftDate}T12:00:00.000Z`).toISOString() : undefined,
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
            Step {step + 1} of {STEPS.length} &mdash; {STEPS[step].label}
          </p>
        </div>
        <StepIndicator current={step} total={STEPS.length} />
      </div>

      <Card>
        <CardContent className="p-6">
          {step === 0 && <Step1SportEvent form={form} leagues={commissionerLeagues} />}
          {step === 1 && <Step2ContestType form={form} />}
          {step === 2 && <Step3ScoringRules form={form} />}
          {step === 3 && <Step4DraftConfig />}
          {step === 4 && <Step5Participants />}
          {step === 5 && <Step6EntrySettings form={form} />}
          {step === 6 && <Step7Review form={form} />}
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
