import * as Dialog from '@radix-ui/react-dialog';
import { useRef } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createLeague } from '@/lib/api';
import { buildLeaguePath, setRecentLeagueCode } from './league-routing';

const LEAGUE_CODE_PATTERN = /^[A-Z0-9]{3,16}$/;

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
  const normalized = name.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);
  return normalized;
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

export function CreateLeagueModal({
  isOpen,
  onClose,
  onCreated,
}: CreateLeagueModalProps) {
  const queryClient = useQueryClient();
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

  const createLeagueMutation = useMutation({
    mutationFn: async (values: CreateLeagueFormValues) => {
      const response = await createLeague({
        body: {
          name: values.name,
          leagueCode: values.leagueCode,
          ...(values.description ? { description: values.description } : {}),
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
      form.reset();
      onCreated(league.leagueCode);
    },
  });

  function handleClose() {
    if (createLeagueMutation.isPending) {
      return;
    }

    form.reset();
    createLeagueMutation.reset();
    hasEditedLeagueCodeRef.current = false;
    onClose();
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
          className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 rounded-[2rem] border border-border bg-card p-6 shadow-2xl"
          data-testid="create-league-modal"
        >
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <span className="inline-flex rounded-full border border-border px-3 py-1 text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
              Commissioner setup
            </span>
            <div>
              <Dialog.Title className="text-2xl font-semibold tracking-tight">
                Create your league
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-muted-foreground">
                Start with the essentials now. You can configure invites, contests, and the rest of
                your league setup after creation.
              </Dialog.Description>
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

        <form className="mt-6 space-y-5" onSubmit={form.handleSubmit(handleSubmit)}>
          <label className="block space-y-2">
            <span className="text-sm font-medium">League name</span>
            <input
              className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm outline-none transition focus:border-primary"
              data-testid="create-league-name"
              disabled={createLeagueMutation.isPending}
              {...registeredName}
              onBlur={(event) => {
                registeredName.onBlur(event);
                if (!hasEditedLeagueCodeRef.current) {
                  const suggestedCode = suggestLeagueCode(event.target.value);
                  if (suggestedCode) {
                    form.setValue('leagueCode', suggestedCode, {
                      shouldDirty: false,
                      shouldValidate: true,
                    });
                  }
                }
              }}
              placeholder="Big Dawgs"
              type="text"
            />
            {form.formState.errors.name ? (
              <span className="text-sm text-destructive">{form.formState.errors.name.message}</span>
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
              onBlur={() => {
                if (!hasEditedLeagueCodeRef.current) {
                  const suggestedCode = suggestLeagueCode(form.getValues('name'));
                  if (suggestedCode) {
                    form.setValue('leagueCode', suggestedCode, {
                      shouldDirty: false,
                      shouldValidate: true,
                    });
                  }
                }
              }}
              placeholder="BIGDAWGS"
              type="text"
              value={form.watch('leagueCode')}
            />
            <p className="text-xs text-muted-foreground">
              Private leagues use this bookmarkable home route: <code>/league/&lt;leagueCode&gt;</code>
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

          <div className="rounded-[1.5rem] border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
            This first release creates a private, invite-led league by default. Member invites and
            join management will come next.
          </div>

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
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function buildCreateLeagueDestination(leagueCode: string) {
  return buildLeaguePath(leagueCode);
}
