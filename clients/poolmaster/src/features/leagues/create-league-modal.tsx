import { useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { createLeague } from "@/lib/api";
import { getLogger } from "@/lib/logger";
import {
  FormField,
  FormModal,
  Input,
  Textarea,
  WebAddressBox,
} from "@/features/shared/ui";
import { buildLeagueWebAddress, rememberRecentLeagueCode } from "./league-routing";
import { suggestLeagueCode } from "./create-league-form";
import { seedLeagueContext, syncLeagueCaches } from "./league-cache";
import { ApiError, hasErrorCode, throwApiError } from '@/lib/errors';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';

const LEAGUE_CODE_PATTERN = /^[A-Z0-9]{3,16}$/;

const createLeagueFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "League name is required")
    .max(100, "League name must be 100 characters or fewer"),
  leagueCode: z
    .string()
    .trim()
    .regex(
      LEAGUE_CODE_PATTERN,
      "Use 3 to 16 letters or numbers.",
    ),
  description: z
    .string()
    .trim()
    .max(500, "Description must be 500 characters or fewer")
    .optional(),
});

type CreateLeagueFormValues = z.infer<typeof createLeagueFormSchema>;

function normalizeLeagueCode(value: string) {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 16);
}

type CreateLeagueModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (leagueCode: string) => void;
  /** What comes once the league exists, when the league is a step on the way to it (#1008): the dialog's one line. */
  nextStep?: string;
};

export function CreateLeagueModal({
  isOpen,
  onClose,
  onCreated,
  nextStep,
}: CreateLeagueModalProps) {
  const logger = getLogger().child({
    feature: "create-league-modal",
  });
  const queryClient = useQueryClient();
  const hasEditedLeagueCodeRef = useRef(false);
  const form = useForm<CreateLeagueFormValues>({
    resolver: zodResolver(createLeagueFormSchema),
    defaultValues: {
      name: "",
      leagueCode: "",
      description: "",
    },
  });
  const registeredName = form.register("name");
  const registeredDescription = form.register("description");
  const leagueCode = form.watch("leagueCode");

  function seedLeagueCodeFromName(nameValue: string) {
    if (hasEditedLeagueCodeRef.current) {
      return;
    }

    const suggestedCode = suggestLeagueCode(nameValue);
    if (suggestedCode) {
      form.setValue("leagueCode", suggestedCode, {
        shouldDirty: false,
        shouldValidate: true,
      });
    }
  }

  const createLeagueMutation = useInvalidatingMutation({
    mutationFn: async (values: CreateLeagueFormValues) => {
      const response = await createLeague({
        body: {
          name: values.name,
          leagueCode: values.leagueCode,
          ...(values.description?.trim()
            ? { description: values.description.trim() }
            : {}),
        },
      });

      if (!response.data?.league.leagueCode) {
        throwApiError(response.error, "League creation response is missing data.");
      }

      // #215 — the whole league context, not just the league. Creating a league also creates
      // the creator's COMMISSIONER membership, so the 201 carries the same shape the two
      // league reads carry and the page we are about to navigate to needs no second fetch.
      return response.data;
    },
    onMutate: (values) => {
      logger.debug(
        {
          action: "league.create.started",
          data: {
            leagueCode: values.leagueCode,
            hasDescription: Boolean(values.description?.trim()),
          },
        },
        "Starting league creation flow",
      );
    },
    onSuccess: (context) => {
      const league = context.league;
      logger.info(
        {
          action: "league.create.succeeded",
          data: {
            leagueCode: league.leagueCode,
          },
        },
        "Created league successfully",
      );
      syncLeagueCaches(queryClient, league);
      // The new league's page reads this cache on arrival and now finds it populated.
      seedLeagueContext(queryClient, context);
      rememberRecentLeagueCode(league.leagueCode);
      hasEditedLeagueCodeRef.current = false;
      form.reset();
      onCreated(league.leagueCode);
    },
    invalidates: [],
    onError: (error, values) => {
      const payload = {
        action: "league.create.failed",
        data: {
          leagueCode: values.leagueCode,
          hasDescription: Boolean(values.description?.trim()),
        },
        err: error,
      };

      // ApiError wraps every SDK rejection (see throwApiError) so it is
      // always `instanceof Error`; check for it explicitly rather than
      // `error instanceof Error` to keep distinguishing an expected API
      // rejection from a genuine unexpected exception.
      if (!(error instanceof ApiError)) {
        logger.error(payload, "League creation failed unexpectedly");
      } else {
        logger.warn(payload, "League creation was rejected");
      }
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
    try {
      await createLeagueMutation.mutateAsync(values);
    } catch {
      // Mutation state drives the error UI for expected create failures.
    }
  }

  const isTakenAddress =
    hasErrorCode(createLeagueMutation.error, "LEAGUE_CODE_CONFLICT") ||
    hasErrorCode(createLeagueMutation.error, "LEAGUE_CODE_RESERVED");
  const leagueCodeError = form.formState.errors.leagueCode?.message
    ?? (isTakenAddress ? "That web address is taken. Try another." : undefined);

  if (!isOpen) {
    return null;
  }

  return (
    <FormModal
      description={nextStep ? `Then you'll set up ${nextStep}.` : undefined}
      error={createLeagueMutation.isError && !isTakenAddress ? createLeagueMutation.error : null}
      errorFallback="We could not create your league. Please try again."
      errorTitle="League not created"
      isPending={createLeagueMutation.isPending}
      onCancel={handleClose}
      onOpenChange={(open) => {
        if (!open) handleClose();
      }}
      onSave={() => void form.handleSubmit(handleSubmit)()}
      open={isOpen}
      pendingLabel="Creating..."
      saveLabel="Create league"
      saveTestId="create-league-submit"
      testId="create-league-modal"
      title="Create your league"
    >
      <div className="space-y-5">
        <FormField
          error={form.formState.errors.name?.message}
          id="create-league-name"
          label="League name"
        >
          <Input
            data-testid="create-league-name"
            disabled={createLeagueMutation.isPending}
            id="create-league-name"
            {...registeredName}
            onBlur={(event) => {
              void registeredName.onBlur(event);
              seedLeagueCodeFromName(event.target.value);
            }}
            placeholder="Big Dawgs"
            type="text"
          />
        </FormField>

        <div className="space-y-3">
          <FormField
            error={leagueCodeError}
            help="Your league's address on the site, suggested from its name. Letters and numbers only. It can't be changed after the league is created."
            id="create-league-code"
            label="League web address"
          >
            <Input
              className="font-mono uppercase"
              data-testid="create-league-code"
              disabled={createLeagueMutation.isPending}
              id="create-league-code"
              onChange={(event) => {
                hasEditedLeagueCodeRef.current = true;
                if (isTakenAddress) createLeagueMutation.reset();
                form.setValue(
                  "leagueCode",
                  normalizeLeagueCode(event.target.value),
                  {
                    shouldDirty: true,
                    shouldValidate: true,
                  },
                );
              }}
              placeholder="BIGDAWGS"
              type="text"
              value={leagueCode}
            />
          </FormField>
          {leagueCode ? (
            <WebAddressBox isLive={false} testId="create-league-address" url={buildLeagueWebAddress(leagueCode)} />
          ) : null}
        </div>

        <FormField
          error={form.formState.errors.description?.message}
          id="create-league-description"
          label="Description"
          optional
        >
          <Textarea
            data-testid="create-league-description"
            disabled={createLeagueMutation.isPending}
            id="create-league-description"
            {...registeredDescription}
            placeholder="Weekend pool for the neighborhood group chat."
          />
        </FormField>
      </div>
    </FormModal>
  );
}
