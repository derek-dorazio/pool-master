import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Check, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';

const sports = [
  { id: 'nfl', name: 'NFL', emoji: '\u{1F3C8}' },
  { id: 'nba', name: 'NBA', emoji: '\u{1F3C0}' },
  { id: 'ncaa', name: 'NCAA Basketball', emoji: '\u{1F3C0}' },
  { id: 'golf', name: 'Golf', emoji: '\u{26F3}' },
  { id: 'f1', name: 'F1', emoji: '\u{1F3CE}\uFE0F' },
  { id: 'tennis', name: 'Tennis', emoji: '\u{1F3BE}' },
  { id: 'soccer', name: 'Soccer', emoji: '\u{26BD}' },
  { id: 'nascar', name: 'NASCAR', emoji: '\u{1F3C1}' },
  { id: 'horse-racing', name: 'Horse Racing', emoji: '\u{1F40E}' },
] as const;

type SportId = typeof sports[number]['id'];

const scoringTemplates: Record<string, Array<{ id: string; name: string; description: string }>> = {
  nfl: [
    { id: 'nfl-standard', name: 'Standard', description: 'Traditional scoring with TDs, FGs, and yardage bonuses.' },
    { id: 'nfl-ppr', name: 'PPR', description: 'Points per reception format for more balanced scoring.' },
    { id: 'nfl-half-ppr', name: 'Half PPR', description: 'Half point per reception — the middle ground.' },
  ],
  nba: [
    { id: 'nba-standard', name: 'Standard', description: 'Points, rebounds, assists, steals, and blocks.' },
    { id: 'nba-dfs', name: 'DFS Points', description: 'Daily fantasy-style scoring with all major categories.' },
  ],
  ncaa: [
    { id: 'ncaa-bracket', name: 'Bracket Challenge', description: 'Pick the winners for each round of the tournament.' },
    { id: 'ncaa-confidence', name: 'Confidence Pool', description: 'Rank your confidence in each pick for bonus points.' },
  ],
  golf: [
    { id: 'golf-stroke', name: 'Stroke Play', description: 'Total strokes relative to par determine the winner.' },
    { id: 'golf-dfs', name: 'DFS Points', description: 'Fantasy points based on birdies, eagles, and placement.' },
  ],
  f1: [
    { id: 'f1-standard', name: 'Standard', description: 'Points based on race finishing position.' },
    { id: 'f1-constructor', name: 'Constructor Style', description: 'Score both drivers and constructors.' },
  ],
  tennis: [
    { id: 'tennis-match', name: 'Match Picks', description: 'Pick winners for each match in the draw.' },
    { id: 'tennis-fantasy', name: 'Fantasy Points', description: 'Points per ace, winner, and match won.' },
  ],
  soccer: [
    { id: 'soccer-standard', name: 'Standard', description: 'Goals, assists, clean sheets, and saves.' },
    { id: 'soccer-match', name: 'Match Picks', description: 'Predict match outcomes for points.' },
  ],
  nascar: [
    { id: 'nascar-standard', name: 'Standard', description: 'Points based on race finishing position.' },
    { id: 'nascar-stage', name: 'Stage Points', description: 'Earn points at each stage and the finish.' },
  ],
  'horse-racing': [
    { id: 'horse-standard', name: 'Standard', description: 'Pick winners, exactas, and trifectas for points.' },
    { id: 'horse-pari', name: 'Pari-Mutuel Style', description: 'Points based on payout odds of your picks.' },
  ],
};

const formSchema = z.object({
  name: z.string().min(3, 'Name must be at least 3 characters').max(60, 'Name must be 60 characters or less'),
  sport: z.string().min(1, 'Please select a sport'),
  description: z.string().max(500, 'Description must be 500 characters or less').optional().or(z.literal('')),
  invitePolicy: z.enum(['open', 'invite-only', 'approval']),
  visibility: z.enum(['public', 'private']),
  scoringTemplate: z.string().optional().or(z.literal('')),
});

type FormValues = z.infer<typeof formSchema>;

const steps = ['Basics', 'Access', 'Scoring', 'Review'];

function StepIndicator({ currentStep }: { currentStep: number }) {
  return (
    <div className="flex items-center justify-center mb-8">
      {steps.map((label, i) => (
        <div key={label} className="flex items-center">
          <div className="flex flex-col items-center">
            <div
              className={cn(
                'flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium transition-colors',
                i < currentStep
                  ? 'bg-primary text-primary-foreground'
                  : i === currentStep
                    ? 'bg-primary text-primary-foreground ring-2 ring-primary ring-offset-2'
                    : 'bg-muted text-muted-foreground',
              )}
            >
              {i < currentStep ? (
                <Check className="h-4 w-4" />
              ) : (
                i + 1
              )}
            </div>
            <span
              className={cn(
                'mt-1.5 text-xs',
                i <= currentStep ? 'text-foreground font-medium' : 'text-muted-foreground',
              )}
            >
              {label}
            </span>
          </div>
          {i < steps.length - 1 && (
            <div
              className={cn(
                'mx-2 h-0.5 w-12 transition-colors',
                i < currentStep ? 'bg-primary' : 'bg-muted',
              )}
            />
          )}
        </div>
      ))}
    </div>
  );
}

export function Component() {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(0);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: '',
      sport: '',
      description: '',
      invitePolicy: 'invite-only',
      visibility: 'private',
      scoringTemplate: '',
    },
    mode: 'onChange',
  });

  const { register, control, watch, trigger, formState: { errors } } = form;
  const values = watch();

  const sportObj = sports.find((s) => s.id === values.sport);
  const templates = values.sport ? (scoringTemplates[values.sport] ?? []) : [];

  async function handleNext() {
    let valid = true;
    if (currentStep === 0) {
      valid = await trigger(['name', 'sport', 'description']);
    }
    if (valid && currentStep < steps.length - 1) {
      setCurrentStep((s) => s + 1);
    }
  }

  function handleBack() {
    if (currentStep > 0) {
      setCurrentStep((s) => s - 1);
    }
  }

  function handleCreate() {
    toast({ title: 'League created!', description: `${values.name} is ready to go.` });
    navigate('/leagues/mock-id');
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <h1 className="text-3xl font-bold text-center">Create League</h1>

      <StepIndicator currentStep={currentStep} />

      {/* Step 1 — Basics */}
      {currentStep === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>League Basics</CardTitle>
            <CardDescription>Give your league a name and choose a sport.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="name">League Name</Label>
              <Input
                id="name"
                placeholder="e.g., Sunday Night Picks"
                {...register('name')}
              />
              {errors.name && (
                <p className="text-sm text-destructive">{errors.name.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label>Sport</Label>
              <Controller
                name="sport"
                control={control}
                render={({ field }) => (
                  <div className="grid grid-cols-3 gap-2">
                    {sports.map((sport) => (
                      <button
                        key={sport.id}
                        type="button"
                        onClick={() => {
                          field.onChange(sport.id);
                          form.setValue('scoringTemplate', '');
                        }}
                        className={cn(
                          'flex flex-col items-center gap-1 rounded-lg border p-3 text-sm transition-colors hover:bg-accent',
                          field.value === sport.id
                            ? 'border-primary bg-primary/5 ring-1 ring-primary'
                            : 'border-input',
                        )}
                      >
                        <span className="text-2xl">{sport.emoji}</span>
                        <span className="font-medium">{sport.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              />
              {errors.sport && (
                <p className="text-sm text-destructive">{errors.sport.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description (optional)</Label>
              <Textarea
                id="description"
                placeholder="What's this league about?"
                rows={3}
                {...register('description')}
              />
              {errors.description && (
                <p className="text-sm text-destructive">{errors.description.message}</p>
              )}
              <p className="text-xs text-muted-foreground">
                {(values.description ?? '').length}/500 characters
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 2 — Access & Visibility */}
      {currentStep === 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Access & Visibility</CardTitle>
            <CardDescription>Control who can find and join your league.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-3">
              <Label>Invite Policy</Label>
              <Controller
                name="invitePolicy"
                control={control}
                render={({ field }) => (
                  <div className="space-y-2">
                    {[
                      { value: 'open' as const, label: 'Open', desc: 'Anyone can join without approval.' },
                      { value: 'invite-only' as const, label: 'Invite Only', desc: 'Members need an invite link or code to join.' },
                      { value: 'approval' as const, label: 'Approval Required', desc: 'Join requests must be approved by a commissioner.' },
                    ].map((option) => (
                      <label
                        key={option.value}
                        className={cn(
                          'flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors hover:bg-accent',
                          field.value === option.value
                            ? 'border-primary bg-primary/5'
                            : 'border-input',
                        )}
                      >
                        <input
                          type="radio"
                          className="mt-1"
                          checked={field.value === option.value}
                          onChange={() => field.onChange(option.value)}
                        />
                        <div>
                          <div className="font-medium text-sm">{option.label}</div>
                          <div className="text-xs text-muted-foreground">{option.desc}</div>
                        </div>
                      </label>
                    ))}
                  </div>
                )}
              />
            </div>

            <div className="space-y-3">
              <Label>Visibility</Label>
              <Controller
                name="visibility"
                control={control}
                render={({ field }) => (
                  <div className="space-y-2">
                    {[
                      { value: 'public' as const, label: 'Public', desc: 'League appears in search and discovery pages.' },
                      { value: 'private' as const, label: 'Private', desc: 'Hidden from search. Only accessible via direct link.' },
                    ].map((option) => (
                      <label
                        key={option.value}
                        className={cn(
                          'flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors hover:bg-accent',
                          field.value === option.value
                            ? 'border-primary bg-primary/5'
                            : 'border-input',
                        )}
                      >
                        <input
                          type="radio"
                          className="mt-1"
                          checked={field.value === option.value}
                          onChange={() => field.onChange(option.value)}
                        />
                        <div>
                          <div className="font-medium text-sm">{option.label}</div>
                          <div className="text-xs text-muted-foreground">{option.desc}</div>
                        </div>
                      </label>
                    ))}
                  </div>
                )}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 3 — Scoring Template */}
      {currentStep === 2 && (
        <Card>
          <CardHeader>
            <CardTitle>Scoring Template</CardTitle>
            <CardDescription>
              Choose a default scoring template for {sportObj?.name ?? 'your sport'}.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Controller
              name="scoringTemplate"
              control={control}
              render={({ field }) => (
                <>
                  {templates.map((tpl) => (
                    <label
                      key={tpl.id}
                      className={cn(
                        'flex items-start gap-3 rounded-lg border p-4 cursor-pointer transition-colors hover:bg-accent',
                        field.value === tpl.id
                          ? 'border-primary bg-primary/5'
                          : 'border-input',
                      )}
                    >
                      <input
                        type="radio"
                        className="mt-0.5"
                        checked={field.value === tpl.id}
                        onChange={() => field.onChange(tpl.id)}
                      />
                      <div>
                        <div className="font-medium">{tpl.name}</div>
                        <div className="text-sm text-muted-foreground">{tpl.description}</div>
                      </div>
                    </label>
                  ))}
                  <label
                    className={cn(
                      'flex items-start gap-3 rounded-lg border border-dashed p-4 cursor-pointer transition-colors hover:bg-accent',
                      field.value === 'skip'
                        ? 'border-primary bg-primary/5'
                        : 'border-input',
                    )}
                  >
                    <input
                      type="radio"
                      className="mt-0.5"
                      checked={field.value === 'skip'}
                      onChange={() => field.onChange('skip')}
                    />
                    <div>
                      <div className="font-medium">Skip</div>
                      <div className="text-sm text-muted-foreground">
                        I'll configure scoring per contest.
                      </div>
                    </div>
                  </label>
                </>
              )}
            />
          </CardContent>
        </Card>
      )}

      {/* Step 4 — Review */}
      {currentStep === 3 && (
        <Card>
          <CardHeader>
            <CardTitle>Review & Create</CardTitle>
            <CardDescription>Make sure everything looks good.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border divide-y">
              <div className="flex items-center justify-between p-3">
                <div>
                  <div className="text-xs text-muted-foreground">League Name</div>
                  <div className="font-medium">{values.name}</div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setCurrentStep(0)}>
                  Edit
                </Button>
              </div>
              <div className="flex items-center justify-between p-3">
                <div>
                  <div className="text-xs text-muted-foreground">Sport</div>
                  <div className="font-medium">
                    {sportObj ? `${sportObj.emoji} ${sportObj.name}` : 'Not selected'}
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setCurrentStep(0)}>
                  Edit
                </Button>
              </div>
              {values.description && (
                <div className="flex items-center justify-between p-3">
                  <div>
                    <div className="text-xs text-muted-foreground">Description</div>
                    <div className="font-medium text-sm">{values.description}</div>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => setCurrentStep(0)}>
                    Edit
                  </Button>
                </div>
              )}
              <div className="flex items-center justify-between p-3">
                <div>
                  <div className="text-xs text-muted-foreground">Invite Policy</div>
                  <div className="font-medium capitalize">{values.invitePolicy.replace('-', ' ')}</div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setCurrentStep(1)}>
                  Edit
                </Button>
              </div>
              <div className="flex items-center justify-between p-3">
                <div>
                  <div className="text-xs text-muted-foreground">Visibility</div>
                  <div className="font-medium capitalize">{values.visibility}</div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setCurrentStep(1)}>
                  Edit
                </Button>
              </div>
              <div className="flex items-center justify-between p-3">
                <div>
                  <div className="text-xs text-muted-foreground">Scoring Template</div>
                  <div className="font-medium">
                    {values.scoringTemplate === 'skip' || !values.scoringTemplate
                      ? 'Configure per contest'
                      : templates.find((t) => t.id === values.scoringTemplate)?.name ?? 'None'}
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setCurrentStep(2)}>
                  Edit
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Navigation buttons */}
      <div className="flex justify-between">
        <Button
          variant="outline"
          onClick={handleBack}
          disabled={currentStep === 0}
        >
          <ChevronLeft className="h-4 w-4 mr-1" />
          Back
        </Button>
        {currentStep < steps.length - 1 ? (
          <Button onClick={handleNext}>
            Next
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        ) : (
          <Button onClick={handleCreate}>
            Create League
          </Button>
        )}
      </div>
    </div>
  );
}
