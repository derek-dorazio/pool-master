import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createLeague } from '@/lib/api';
import { LeagueVisibility } from '@poolmaster/shared/domain';
import { buildLeaguePath, setRecentLeagueCode } from './league-routing';

const leagueVisibilitySchema = z.enum([LeagueVisibility.PRIVATE, LeagueVisibility.PUBLIC]);

const createLeagueFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'League name is required')
    .max(100, 'League name must be 100 characters or fewer'),
  visibility: leagueVisibilitySchema,
});

type CreateLeagueFormValues = z.infer<typeof createLeagueFormSchema>;

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

export function CreateLeagueModal({
  isOpen,
  onClose,
  onCreated,
}: CreateLeagueModalProps) {
  const queryClient = useQueryClient();
  const form = useForm<CreateLeagueFormValues>({
    resolver: zodResolver(createLeagueFormSchema),
    defaultValues: {
      name: '',
      visibility: LeagueVisibility.PRIVATE,
    },
  });

  const createLeagueMutation = useMutation({
    mutationFn: async (values: CreateLeagueFormValues) => {
      const response = await createLeague({
        body: {
          name: values.name,
          visibility: values.visibility,
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
      form.reset();
      onCreated(league.leagueCode);
    },
  });

  function handleClose() {
    form.reset();
    createLeagueMutation.reset();
    onClose();
  }

  async function handleSubmit(values: CreateLeagueFormValues) {
    await createLeagueMutation.mutateAsync(values);
  }

  if (!isOpen) {
    return null;
  }

  return (
    <div
      aria-labelledby="create-league-modal-title"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 px-4 py-6 backdrop-blur-sm"
      data-testid="create-league-modal"
      role="dialog"
    >
      <div className="w-full max-w-xl rounded-[2rem] border border-border bg-card p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <span className="inline-flex rounded-full border border-border px-3 py-1 text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
              Commissioner setup
            </span>
            <div>
              <h2 className="text-2xl font-semibold tracking-tight" id="create-league-modal-title">
                Create your league
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Start with the essentials now. You can configure invites, contests, and the rest of
                your league setup after creation.
              </p>
            </div>
          </div>

          <button
            aria-label="Close create league modal"
            className="rounded-2xl border border-border px-3 py-2 text-sm font-medium text-muted-foreground transition hover:bg-muted/50"
            onClick={handleClose}
            type="button"
          >
            Close
          </button>
        </div>

        <form className="mt-6 space-y-5" onSubmit={form.handleSubmit(handleSubmit)}>
          <label className="block space-y-2">
            <span className="text-sm font-medium">League name</span>
            <input
              className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm outline-none transition focus:border-primary"
              {...form.register('name')}
              data-testid="create-league-name"
              placeholder="Big Dawgs"
              type="text"
            />
            {form.formState.errors.name ? (
              <span className="text-sm text-destructive">{form.formState.errors.name.message}</span>
            ) : null}
          </label>

          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">Visibility</legend>
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                {
                  value: LeagueVisibility.PRIVATE,
                  label: 'Private',
                  description: 'Best default for invite-only office pools.',
                },
                {
                  value: LeagueVisibility.PUBLIC,
                  label: 'Public',
                  description: 'Visible openly for broader community participation.',
                },
              ].map((option) => (
                <label
                  className="cursor-pointer rounded-[1.5rem] border border-border bg-background p-4 transition has-[:checked]:border-primary has-[:checked]:bg-primary/5"
                  key={option.value}
                >
                  <input
                    className="sr-only"
                    type="radio"
                    value={option.value}
                    {...form.register('visibility')}
                  />
                  <div className="text-sm font-semibold">{option.label}</div>
                  <div className="mt-2 text-xs text-muted-foreground">{option.description}</div>
                </label>
              ))}
            </div>
            {form.formState.errors.visibility ? (
              <span className="text-sm text-destructive">
                {form.formState.errors.visibility.message}
              </span>
            ) : null}
          </fieldset>

          {createLeagueMutation.isError ? (
            <div className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {extractErrorMessage(createLeagueMutation.error)}
            </div>
          ) : null}

          <div className="flex flex-wrap justify-end gap-3">
            <button
              className="rounded-2xl border border-border px-4 py-3 text-sm font-medium"
              onClick={handleClose}
              type="button"
            >
              Cancel
            </button>
            <button
              className="rounded-2xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-70"
              data-testid="create-league-submit"
              disabled={createLeagueMutation.isPending}
              type="submit"
            >
              {createLeagueMutation.isPending ? 'Creating league...' : 'Create league'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function buildCreateLeagueDestination(leagueCode: string) {
  return buildLeaguePath(leagueCode);
}
