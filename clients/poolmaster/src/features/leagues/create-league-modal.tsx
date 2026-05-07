import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { createLeague } from "@/lib/api";
import { getLogger } from "@/lib/logger";
import {
  Button,
  FormField,
  Input,
  Modal,
  Textarea,
  Tile,
} from "@/features/shared/ui";
import { buildLeaguePath, setRecentLeagueCode } from "./league-routing";
import { syncLeagueCaches } from "./league-cache";
import { extractErrorMessage } from '@/lib/errors';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';

const LEAGUE_CODE_PATTERN = /^[A-Z0-9]{3,16}$/;
const WIZARD_STEP_DETAILS = "details";
const WIZARD_STEP_REVIEW = "review";

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
      "League code must be 3 to 16 uppercase letters or numbers.",
    ),
  description: z
    .string()
    .trim()
    .max(500, "Description must be 500 characters or fewer")
    .optional(),
});

type CreateLeagueFormValues = z.infer<typeof createLeagueFormSchema>;

export function suggestLeagueCode(name: string) {
  return name
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 16);
}

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
};

export function CreateLeagueModal({
  isOpen,
  onClose,
  onCreated,
}: CreateLeagueModalProps) {
  const logger = getLogger().child({
    feature: "create-league-modal",
  });
  const queryClient = useQueryClient();
  const [step, setStep] = useState<
    typeof WIZARD_STEP_DETAILS | typeof WIZARD_STEP_REVIEW
  >(WIZARD_STEP_DETAILS);
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
  const description = form.watch("description");
  const name = form.watch("name");

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

      if (!response.data?.league?.leagueCode) {
        throw (
          response.error ??
          new Error("League creation response is missing data.")
        );
      }

      return response.data.league;
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
    onSuccess: async (league) => {
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
      setRecentLeagueCode(league.leagueCode);
      hasEditedLeagueCodeRef.current = false;
      setStep(WIZARD_STEP_DETAILS);
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

      if (error instanceof Error) {
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

    setStep(WIZARD_STEP_DETAILS);
    form.reset();
    createLeagueMutation.reset();
    hasEditedLeagueCodeRef.current = false;
    onClose();
  }

  async function handleNextStep() {
    seedLeagueCodeFromName(form.getValues("name"));
    const isValid = await form.trigger(["name", "leagueCode", "description"]);
    if (isValid) {
      logger.info(
        {
          action: "league.create.reviewReady",
          data: {
            leagueCode: form.getValues("leagueCode"),
            hasDescription: Boolean(form.getValues("description")?.trim()),
          },
        },
        "League create flow advanced to review step",
      );
      setStep(WIZARD_STEP_REVIEW);
    } else {
      logger.warn(
        {
          action: "league.create.reviewBlocked",
          data: {
            hasNameError: Boolean(form.formState.errors.name),
            hasLeagueCodeError: Boolean(form.formState.errors.leagueCode),
            hasDescriptionError: Boolean(form.formState.errors.description),
          },
        },
        "League create flow could not advance to review",
      );
    }
  }

  async function handleSubmit(values: CreateLeagueFormValues) {
    try {
      await createLeagueMutation.mutateAsync(values);
    } catch {
      // Mutation state drives the error UI for expected create failures.
    }
  }

  if (!isOpen) {
    return null;
  }

  return (
    <Modal
      closeLabel="Close create league modal"
      description={
        <>
          Create a private league with a bookmarkable league code, then review
          the details before you launch.
        </>
      }
      descriptionId="create-league-modal-description"
      isCloseDisabled={createLeagueMutation.isPending}
      onClose={handleClose}
      onOpenChange={() => undefined}
      open={isOpen}
      size="md"
      testId="create-league-modal"
      title="Create your league"
      titleId="create-league-modal-title"
    >
      <div className="space-y-3">
        <span className="inline-flex rounded-full border border-border px-3 py-1 text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
          Commissioner setup
        </span>
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
          <span
            className={`rounded-full border px-3 py-1 ${
              step === WIZARD_STEP_DETAILS
                ? "border-primary bg-primary/10 text-foreground"
                : "border-border"
            }`}
          >
            1 Details
          </span>
          <span
            className={`rounded-full border px-3 py-1 ${
              step === WIZARD_STEP_REVIEW
                ? "border-primary bg-primary/10 text-foreground"
                : "border-border"
            }`}
          >
            2 Review
          </span>
        </div>
      </div>

      <form
        className="mt-6 space-y-5"
        onSubmit={form.handleSubmit(handleSubmit)}
      >
        {step === WIZARD_STEP_DETAILS ? (
          <>
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
                  registeredName.onBlur(event);
                  seedLeagueCodeFromName(event.target.value);
                }}
                placeholder="Big Dawgs"
                type="text"
              />
            </FormField>

            <FormField
              error={form.formState.errors.leagueCode?.message}
              helperText="Suggested from the league name, but fully editable before you create."
              id="create-league-code"
              label="League code"
              labelAddon="Used in your league URL"
            >
              <Input
                className="font-mono uppercase"
                data-testid="create-league-code"
                disabled={createLeagueMutation.isPending}
                id="create-league-code"
                onChange={(event) => {
                  hasEditedLeagueCodeRef.current = true;
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

            <FormField
              error={form.formState.errors.description?.message}
              helperText="Optional. You can update league details after creation."
              id="create-league-description"
              label="Description"
            >
              <Textarea
                data-testid="create-league-description"
                disabled={createLeagueMutation.isPending}
                id="create-league-description"
                {...registeredDescription}
                placeholder="Weekend pool for the neighborhood group chat."
              />
            </FormField>
          </>
        ) : (
          <section className="space-y-4">
            <Tile padding="sm" radius="lg" variant="subtle">
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
                  <div className="mt-1 text-sm text-foreground">
                    {description}
                  </div>
                </div>
              ) : null}
            </Tile>

            <Tile
              className="bg-muted/30 text-sm text-muted-foreground"
              padding="sm"
              radius="lg"
            >
              This first release creates a private, invite-led league by
              default. After the league is created, you&apos;ll invite members
              from league home using email invites or shareable invite links.
              <div className="mt-3 rounded-2xl border border-border bg-background px-3 py-2 text-xs text-foreground">
                Members do not join by league code alone. Invitations drive the
                current join flow.
              </div>
            </Tile>
          </section>
        )}

        {createLeagueMutation.isError ? (
          <div
            className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            role="alert"
          >
            {extractErrorMessage(createLeagueMutation.error, { fallback: 'We could not create your league. Please try again.' })}
          </div>
        ) : null}

        <div className="flex flex-wrap justify-end gap-3">
          <Button
            disabled={createLeagueMutation.isPending}
            onClick={handleClose}
            type="button"
            variant="secondary"
          >
            Cancel
          </Button>

          {step === WIZARD_STEP_DETAILS ? (
            <Button
              data-testid="create-league-next"
              disabled={createLeagueMutation.isPending}
              onClick={() => {
                void handleNextStep();
              }}
              type="button"
            >
              Next
            </Button>
          ) : (
            <>
              <Button
                data-testid="create-league-back"
                disabled={createLeagueMutation.isPending}
                onClick={() => setStep(WIZARD_STEP_DETAILS)}
                type="button"
                variant="secondary"
              >
                Back
              </Button>
              <Button
                data-testid="create-league-submit"
                disabled={createLeagueMutation.isPending}
                isLoading={createLeagueMutation.isPending}
                type="submit"
              >
                {createLeagueMutation.isPending
                  ? "Creating league..."
                  : "Create league"}
              </Button>
            </>
          )}
        </div>
      </form>
    </Modal>
  );
}

export function buildCreateLeagueDestination(leagueCode: string) {
  return buildLeaguePath(leagueCode);
}
