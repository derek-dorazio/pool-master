import { ContestStatus } from '@poolmaster/shared/domain';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { Lock } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { z } from 'zod';
import {
  updateContest,
  updateContestConfiguration,
  type ContestDto,
  type ContestManagementDetailDto,
  type SportEventDto,
} from '@/lib/api';
import { ApiError, extractErrorMessage, throwApiError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import { buildLeagueAdminContestPath } from '@/features/leagues/league-routing';
import { useLeagueContext } from '@/features/leagues/use-league-context';
import {
  formatDateDisplay,
  FormField,
  FormPage,
  Input,
  LoadingState,
} from '@/features/shared/ui';
import { CONTEST_RELEASE_CODE_MESSAGES } from './contest-release-messages';
import { formatSelectionTypeName } from './contest-rules';
import { ContestRulesFields } from './contest-rules-fields';
import { parseContestRules, toContestRulesValues, type ContestRulesValues } from './contest-rules-form';
import { sportEventQueryOptions } from './use-contest-schedule';
import { useLeagueContestsQuery } from './use-league-contests-query';
import { useManagedContestQuery } from './use-managed-contest-query';

const editContestFormSchema = z.object({
  contestName: z.string().trim().min(1, 'Contest name is required.'),
  countedScores: z.string(),
  maxEntriesPerTeam: z.string(),
  picksPerTier: z.string(),
  unlimitedEntries: z.boolean(),
});

type EditContestFormValues = z.infer<typeof editContestFormSchema>;

function FixedValue({ children, label }: { children: string; label: string }) {
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">{label}</div>
      <div className="flex items-center justify-between gap-2 rounded-xl bg-muted/40 px-3 py-2.5 text-sm">
        <span>{children}</span>
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <Lock aria-hidden size={13} />
          Fixed
        </span>
      </div>
    </div>
  );
}

/**
 * The edit form for one contest that is not open yet. Mount it with `key={contest.id}` so the
 * draft is built once and a background refetch never overwrites what is being typed
 * (rules/react-ui-rules.md §5).
 */
function EditContestForm({
  contest,
  event,
  leagueCode,
  leagueId,
  managedContest,
}: {
  contest: ContestDto;
  event: SportEventDto;
  leagueCode: string;
  leagueId: string;
  managedContest: ContestManagementDetailDto;
}) {
  const logger = getLogger().child({ feature: 'edit-contest-page' });
  const navigate = useNavigate();
  const contestPath = buildLeagueAdminContestPath(leagueCode, contest.id);
  const tierCount = managedContest.effectiveTiers.length;
  const [rulesError, setRulesError] = useState<string | null>(null);
  const form = useForm<EditContestFormValues>({
    resolver: zodResolver(editContestFormSchema),
    defaultValues: { contestName: contest.name, ...toContestRulesValues(managedContest.configuration) },
  });
  const values = form.watch();

  const saveMutation = useInvalidatingMutation({
    mutationFn: async (submitted: EditContestFormValues) => {
      const parsed = parseContestRules(submitted, tierCount);
      if (parsed.error !== null) {
        throw new Error(parsed.error);
      }
      // The rules go first: they are what the server validates, so a refusal lands before
      // anything is written. The rename after it can only be refused for a contest that is no
      // longer a draft, which the rules write has just checked.
      const configurationResponse = await updateContestConfiguration({
        path: { id: leagueId, contestId: contest.id },
        body: parsed.configuration,
      });
      if (!configurationResponse.data?.contest) {
        throwApiError(configurationResponse.error, 'Contest update response is missing data.');
      }
      const nameResponse = await updateContest({
        path: { contestId: contest.id },
        body: { name: submitted.contestName.trim() },
      });
      if (nameResponse.error) {
        throwApiError(nameResponse.error);
      }
    },
    onSuccess: () => {
      logger.info({ action: 'contest.save.succeeded', data: { leagueCode, contestId: contest.id } }, 'Saved contest');
      navigate(contestPath);
    },
    invalidates: [
      QueryKeys.contests.list({ leagueId }),
      QueryKeys.contests.detail(contest.id),
      QueryKeys.managedContests.all,
    ],
    onError: (error) => {
      const payload = { action: 'contest.save.failed', data: { leagueCode, contestId: contest.id }, err: error };
      if (error instanceof ApiError) {
        logger.warn(payload, 'Contest update was rejected');
      } else {
        logger.error(payload, 'Contest update failed unexpectedly');
      }
    },
  });

  const errorMessage = rulesError
    ?? form.formState.errors.contestName?.message
    ?? (saveMutation.isError
      ? extractErrorMessage(saveMutation.error, {
        codeMessages: CONTEST_RELEASE_CODE_MESSAGES,
        fallback: 'We could not save that contest. Please try again.',
      })
      : null);

  return (
    <FormPage
      cancelTo={contestPath}
      description="Event and format are fixed once the contest exists. To change them, delete this contest and create another."
      errorMessage={errorMessage}
      isPending={saveMutation.isPending}
      onSubmit={(submitEvent) => {
        setRulesError(null);
        void form.handleSubmit((submitted) => {
          const parsed = parseContestRules(submitted, tierCount);
          if (parsed.error !== null) {
            setRulesError(parsed.error);
            return;
          }
          saveMutation.mutate(submitted);
        })(submitEvent);
      }}
      pendingLabel="Saving..."
      submitLabel="Save"
      submitTestId="edit-contest-save"
      testId="edit-contest-page"
      title="Edit contest"
    >
      <FormField label="Contest name">
        <Input
          data-testid="contest-name"
          type="text"
          {...form.register('contestName')}
        />
      </FormField>
      <div className="grid gap-4 md:grid-cols-2">
        <FixedValue label="Event">{`${event.name} · ${formatDateDisplay(event.startDate)}`}</FixedValue>
        <FixedValue label="Format">{formatSelectionTypeName(contest.selectionType)}</FixedValue>
      </div>
      <div className="space-y-3">
        <h3 className="text-base font-semibold">Rules</h3>
        <ContestRulesFields
          onChange={(next: Partial<ContestRulesValues>) => {
            for (const [field, value] of Object.entries(next) as Array<[keyof ContestRulesValues, string | boolean]>) {
              form.setValue(field, value, { shouldDirty: true });
            }
          }}
          tierCount={tierCount}
          values={values}
        />
      </div>
    </FormPage>
  );
}

/**
 * Commissioner tools › Contests › one contest › Edit: name and rules, saved together. Only a
 * contest that is not open yet can change; once open, this page goes back to the contest page,
 * which says the settings are locked.
 */
export function EditContestPage() {
  const { leagueCode = '', contestId = '' } = useParams<{ leagueCode: string; contestId: string }>();
  // `CommissionerRouteGuard` has loaded the league and admitted the viewer before this renders.
  const { league } = useLeagueContext(leagueCode);
  const contestsQuery = useLeagueContestsQuery(league?.id ?? '');
  const managedContestQuery = useManagedContestQuery(league?.id, contestId);
  const contest = contestsQuery.data?.find((candidate) => candidate.id === contestId) ?? null;
  const eventQuery = useQuery(sportEventQueryOptions(contest?.sportEventId ?? ''));
  const contestPath = buildLeagueAdminContestPath(leagueCode, contestId);

  if (!league) {
    return null;
  }
  if (contestsQuery.isLoading || managedContestQuery.isLoading || eventQuery.isLoading) {
    return <LoadingState body="Loading contest..." testId="edit-contest-loading" />;
  }

  const managedContest = managedContestQuery.data;
  const event = eventQuery.data;
  // A missing contest, one already open, or a read that failed goes back to the contest page,
  // which says why.
  if (!contest || !managedContest || !event || contest.status !== ContestStatus.DRAFT || !league.isActive) {
    return <Navigate replace to={contestPath} />;
  }

  return (
    <EditContestForm
      contest={contest}
      event={event}
      key={contest.id}
      leagueCode={leagueCode}
      leagueId={league.id}
      managedContest={managedContest}
    />
  );
}
