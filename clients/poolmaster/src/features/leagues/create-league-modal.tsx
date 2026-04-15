import * as Dialog from '@radix-ui/react-dialog';
import { useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createLeague } from '@/lib/api';
import { buildLeaguePath, setRecentLeagueCode } from './league-routing';

const LEAGUE_CODE_PATTERN = /^[A-Z0-9]{3,16}$/;
const WIZARD_STEP_DETAILS = 'details';
const WIZARD_STEP_REVIEW = 'review';

const createLeagueFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'League name is required')
    .max(100, 'League name must be 100 characters or fewer'),
  leagueCode: z
    .string()
    .trim()
    .regex(
      LEAGUE_CODE_PATTERN,
      'League code must be 3 to 16 uppercase letters or numbers.',
    ),
  description: z
    .string()
    .trim()
    .max(500, 'Description must be 500 characters or fewer')
    .optional(),
});

type CreateLeagueFormValues = z.infer<typeof createLeagueFormSchema>;

export function suggestLeagueCode(name: string) {
  return name.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);
}

function normalizeLeagueCode(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);
}

function extractErrorMessage(error: unknown): string {
  if (!error || typeof error !== 'object') {
    return 'We could not create your league. Please try again.';
  }

  const candidate = error as {
    error?: { message?: unknown };
    message?: unknown;
  };

  if (typeof candidate.error?.message === 'string') {
    return candidate.error.message;
  }

  if (typeof candidate.message === 'string') {
    return candidate.message;
  }

  return 'We could not create your league. Please try again.';
}

type CreateLeagueModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (leagueCode: string) => void;
};

export function CreateLeagueModal({ isOpen, onClose, onCreated }: CreateLeagueModalProps) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<typeof WIZARD_STEP_DETAILS | typeof WIZARD_STEP_REVIEW>(
    WIZARD_STEP_DETAILS,
  );
  const hasEditedLeagueCodeRef = useRef(false);
  const form = useForm<CreateLeagueFormValues>({
    resolver: zodResolver(createLeagueFormSchema),
    defaultValues: {
      name: '',
      leagueCode: '',
      description: '',
    },
  });
  const registeredName = form.register('name');
  const registeredDescription = form.register('description');
  const leagueCode = form.watch('leagueCode');
  const description = form.watch('description');
  const name = form.watch('name');

  function seedLeagueCodeFromName(nameValue: string) {
    if (hasEditedLeagueCodeRef.current) {
      return;
    }

    const suggestedCode = suggestLeagueCode(nameValue);
    if (suggestedCode) {
      form.setValue('leagueCode', suggestedCode, {
        shouldDirty: false,
        shouldValidate: true,
      });
    }
  }

  const createLeagueMutation = useMutation({
    mutationFn: async (values: CreateLeagueFormValues) => {
      const response = await createLeague({
        body: {
          name: values.name,
          leagueCode: values.leagueCode,
          ...(values.description?.trim() ? { description: values.description.trim() } : {}),
        },
      });

      if (!response.data?.league?.leagueCode) {
        throw response.error ?? new Error('League creation response is missing data.');
      }

      return response.data.league;
    },
    onSuccess: async (league) => {
      await queryClient.invalidateQueries({ queryKey: ['poolmaster', 'leagues'] });
      setRecentLeagueCode(league.leagueCode);
      hasEditedLeagueCodeRef.current = false;
      setStep(WIZARD_STEP_DETAILS);
      form.reset();
      onCreated(league.leagueCode);
    },
  });

  function handleClose() {
    if (createLeagueMutation.isPending) {
      return;
    }

    setStep(WIZARD_STEP_DETAILS);
    form.reset();
    createLeagueMutation.reset();
    hasEditedLeagueCodeRef.current = false;
    onClose();
  }

  async function handleNextStep() {
    seedLeagueCodeFromName(form.getValues('name'));
    const isValid = await form.trigger(['name', 'leagueCode', 'description']);
    if (isValid) {
      setStep(WIZARD_STEP_REVIEW);
    }
  }

  async function handleSubmit(values: CreateLeagueFormValues) {
    await createLeagueMutation.mutateAsync(values);
  }

  if (!isOpen) {
    return null;
  }

  return (
    <Dialog.Root
      onOpenChange={(open) => {
        if (!open) {
          handleClose();
        }
      }}
      open={isOpen}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-background/70 backdrop-blur-sm" />
        <Dialog.Content
          aria-describedby="create-league-modal-description"
          className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 rounded-[2rem] border border-border bg-card p-6 shadow-2xl"
          data-testid="create-league-modal"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-3">
              <span className="inline-flex rounded-full border border-border px-3 py-1 text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
                Commissioner setup
              </span>
              <div className="space-y-2">
                <Dialog.Title
                  className="text-2xl font-semibold tracking-tight"
                  id="create-league-modal-title"
                >
                  Create your league
                </Dialog.Title>
                <Dialog.Description
                  className="text-sm text-muted-foreground"
                  id="create-league-modal-description"
                >
                  Create a private league with a bookmarkable league code, then review the details
                  before you launch.
                </Dialog.Description>
              </div>
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
                <span
                  className={`rounded-full border px-3 py-1 ${
                    step === WIZARD_STEP_DETAILS
                      ? 'border-primary bg-primary/10 text-foreground'
                      : 'border-border'
                  }`}
                >
                  1 Details
                </span>
                <span
                  className={`rounded-full border px-3 py-1 ${
                    step === WIZARD_STEP_REVIEW
                      ? 'border-primary bg-primary/10 text-foreground'
                      : 'border-border'
                  }`}
                >
                  2 Review
                </span>
              </div>
            </div>

            <Dialog.Close asChild>
              <button
                aria-label="Close create league modal"
                className="rounded-2xl border border-border px-3 py-2 text-sm font-medium text-muted-foreground transition hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-70"
                disabled={createLeagueMutation.isPending}
                onClick={handleClose}
                type="button"
              >
                Close
              </button>
            </Dialog.Close>
          </div>

          <form
            className="mt-6 space-y-5"
            onSubmit={form.handleSubmit(handleSubmit)}
          >
            {step === WIZARD_STEP_DETAILS ? (
              <>
                <label className="block space-y-2">
                  <span className="text-sm font-medium">League name</span>
                  <input
                    className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm outline-none transition focus:border-primary"
                    data-testid="create-league-name"
                    disabled={createLeagueMutation.isPending}
                    {...registeredName}
                    onBlur={(event) => {
                      registeredName.onBlur(event);
                      seedLeagueCodeFromName(event.target.value);
                    }}
                    placeholder="Big Dawgs"
                    type="text"
                  />
                  {form.formState.errors.name ? (
                    <span className="text-sm text-destructive">
                      {form.formState.errors.name.message}
                    </span>
                  ) : null}
                </label>

                <label className="block space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium">League code</span>
                    <span className="text-xs text-muted-foreground">Used in your league URL</span>
                  </div>
                  <input
                    className="w-full rounded-2xl border border-border bg-background px-4 py-3 font-mono text-sm uppercase outline-none transition focus:border-primary"
                    data-testid="create-league-code"
                    disabled={createLeagueMutation.isPending}
                    onChange={(event) => {
                      hasEditedLeagueCodeRef.current = true;
                      form.setValue('leagueCode', normalizeLeagueCode(event.target.value), {
                        shouldDirty: true,
                        shouldValidate: true,
                      });
                    }}
                    placeholder="BIGDAWGS"
                    type="text"
                    value={leagueCode}
                  />
                  <p className="text-xs text-muted-foreground">
                    Suggested from the league name, but fully editable before you create.
                  </p>
                  {form.formState.errors.leagueCode ? (
                    <span className="text-sm text-destructive">
                      {form.formState.errors.leagueCode.message}
                    </span>
                  ) : null}
                </label>

                <label className="block space-y-2">
                  <span className="text-sm font-medium">Description</span>
                  <textarea
                    className="min-h-24 w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm outline-none transition focus:border-primary"
                    data-testid="create-league-description"
                    disabled={createLeagueMutation.isPending}
                    {...registeredDescription}
                    placeholder="Weekend pool for the neighborhood group chat."
                  />
                  <p className="text-xs text-muted-foreground">
                    Optional for now. You can refine the rest of your league setup after creation.
                  </p>
                  {form.formState.errors.description ? (
                    <span className="text-sm text-destructive">
                      {form.formState.errors.description.message}
                    </span>
                  ) : null}
                </label>
              </>
            ) : (
              <section className="space-y-4">
                <div className="rounded-[1.5rem] border border-border bg-background p-5">
                  <div className="text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
                    Review
                  </div>
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <div>
                      <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                        League name
                      </div>
                      <div className="mt-1 text-base font-medium">{name}</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                        League code
                      </div>
                      <div className="mt-1 font-mono text-base font-medium uppercase">
                        {leagueCode}
                      </div>
                    </div>
                  </div>
                  {description?.trim() ? (
                    <div className="mt-4">
                      <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                        Description
                      </div>
                      <div className="mt-1 text-sm text-foreground">{description}</div>
                    </div>
                  ) : null}
                </div>

                <div className="rounded-[1.5rem] border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
                  This first release creates a private, invite-led league by default. After the
                  league is created, you&apos;ll invite members from league home using email invites
                  or shareable invite links.
                  <div className="mt-3 rounded-2xl border border-border bg-background px-3 py-2 text-xs text-foreground">
                    Members do not join by league code alone. Invitations drive the current join
                    flow.
                  </div>
                </div>
              </section>
            )}

            {createLeagueMutation.isError ? (
              <div
                className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
                role="alert"
              >
                {extractErrorMessage(createLeagueMutation.error)}
              </div>
            ) : null}

            <div className="flex flex-wrap justify-end gap-3">
              <button
                className="rounded-2xl border border-border px-4 py-3 text-sm font-medium"
                disabled={createLeagueMutation.isPending}
                onClick={handleClose}
                type="button"
              >
                Cancel
              </button>

              {step === WIZARD_STEP_DETAILS ? (
                <button
                  className="rounded-2xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-70"
                  data-testid="create-league-next"
                  disabled={createLeagueMutation.isPending}
                  onClick={() => {
                    void handleNextStep();
                  }}
                  type="button"
                >
                  Next
                </button>
              ) : (
                <>
                  <button
                    className="rounded-2xl border border-border px-4 py-3 text-sm font-medium"
                    data-testid="create-league-back"
                    disabled={createLeagueMutation.isPending}
                    onClick={() => setStep(WIZARD_STEP_DETAILS)}
                    type="button"
                  >
                    Back
                  </button>
                  <button
                    className="rounded-2xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-70"
                    data-testid="create-league-submit"
                    disabled={createLeagueMutation.isPending}
                    type="submit"
                  >
                    {createLeagueMutation.isPending ? 'Creating league...' : 'Create league'}
                  </button>
                </>
              )}
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function buildCreateLeagueDestination(leagueCode: string) {
  return buildLeaguePath(leagueCode);
}
