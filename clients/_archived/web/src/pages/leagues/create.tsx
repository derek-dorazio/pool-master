import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Check, ChevronLeft, ChevronRight } from 'lucide-react';
import { InvitePolicy } from '@poolmaster/shared/domain';
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
import { client, createLeague } from '@/lib/api';

const formSchema = z.object({
  name: z.string().min(3, 'Name must be at least 3 characters').max(60, 'Name must be 60 characters or less'),
  description: z.string().max(500, 'Description must be 500 characters or less').optional().or(z.literal('')),
  invitePolicy: z.enum([InvitePolicy.OPEN, InvitePolicy.LINK_INVITE, InvitePolicy.COMMISSIONER_ONLY]),
  visibility: z.enum(['public', 'private']),
});

type FormValues = z.infer<typeof formSchema>;

const steps = ['Basics', 'Access', 'Review'];

const invitePolicyOptions = [
  {
    value: InvitePolicy.OPEN,
    label: 'Open',
    desc: 'Anyone can join directly from discovery.',
  },
  {
    value: InvitePolicy.LINK_INVITE,
    label: 'Invite Link',
    desc: 'Members need an invite link or code to join.',
  },
  {
    value: InvitePolicy.COMMISSIONER_ONLY,
    label: 'Commissioner Only',
    desc: 'Only the commissioner can add members.',
  },
] as const;

const visibilityOptions = [
  {
    value: 'public' as const,
    label: 'Public',
    desc: 'League appears in search and discovery pages.',
  },
  {
    value: 'private' as const,
    label: 'Private',
    desc: 'Hidden from search. Only accessible via direct link.',
  },
] as const;

function getErrorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return 'Failed to create league. Please try again.';
}

function getInvitePolicyLabel(policy: FormValues['invitePolicy']): string {
  return invitePolicyOptions.find((option) => option.value === policy)?.label ?? policy;
}

function getVisibilityLabel(visibility: FormValues['visibility']): string {
  return visibilityOptions.find((option) => option.value === visibility)?.label ?? visibility;
}

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
      description: '',
      invitePolicy: InvitePolicy.LINK_INVITE,
      visibility: 'private',
    },
    mode: 'onChange',
  });

  const { register, control, watch, trigger, formState: { errors } } = form;
  const values = watch();
  const createLeagueMutation = useMutation({
    mutationFn: async () => {
      const submittedName = values.name;
      const { data, error } = await createLeague({
        client,
        body: {
          name: submittedName,
          description: values.description,
          visibility: values.visibility === 'public' ? 'PUBLIC' : 'PRIVATE',
          settings: {
            invitePolicy: values.invitePolicy,
          },
        },
      });

      if (error) {
        throw error;
      }

      if (!data?.league?.id) {
        throw new Error('Missing league id in create league response.');
      }

      return {
        leagueId: data.league.id,
        leagueName: submittedName,
      };
    },
    onSuccess: ({ leagueId, leagueName }) => {
      toast({ title: 'League created!', description: `${leagueName} is ready to go.` });
      navigate(`/leagues/${leagueId}`);
    },
    onError: (error) => {
      toast({ title: 'Error', description: getErrorMessage(error) });
    },
  });

  async function handleNext() {
    let valid = true;
    if (currentStep === 0) {
      valid = await trigger(['name', 'description']);
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

  return (
    <div className="max-w-2xl mx-auto space-y-6" data-testid="league-create-page">
      <h1 className="text-3xl font-bold text-center">Create League</h1>

      <StepIndicator currentStep={currentStep} />

      {/* Step 1 — Basics */}
      {currentStep === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>League Basics</CardTitle>
            <CardDescription>Give your league a name and description.</CardDescription>
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
                    {invitePolicyOptions.map((option) => (
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
                    {visibilityOptions.map((option) => (
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

      {/* Step 3 — Review */}
      {currentStep === 2 && (
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
                  <div className="font-medium">{getInvitePolicyLabel(values.invitePolicy)}</div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setCurrentStep(1)}>
                  Edit
                </Button>
              </div>
              <div className="flex items-center justify-between p-3">
                <div>
                  <div className="text-xs text-muted-foreground">Visibility</div>
                  <div className="font-medium">{getVisibilityLabel(values.visibility)}</div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setCurrentStep(1)}>
                  Edit
                </Button>
              </div>
              <div className="p-3">
                <div className="text-xs text-muted-foreground">Scoring</div>
                <div className="font-medium text-sm">
                  Scoring will be configured per contest.
                </div>
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
          <Button
            onClick={() => createLeagueMutation.mutate()}
            disabled={createLeagueMutation.isPending}
            data-testid="league-create-submit"
          >
            {createLeagueMutation.isPending ? 'Creating League...' : 'Create League'}
          </Button>
        )}
      </div>

      {createLeagueMutation.isError && (
        <p className="text-sm text-destructive text-center" data-testid="league-create-error">
          {getErrorMessage(createLeagueMutation.error)}
        </p>
      )}
    </div>
  );
}
