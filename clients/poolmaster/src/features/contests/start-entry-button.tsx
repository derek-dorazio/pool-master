import { useNavigate } from 'react-router';
import { enterContest } from '@/lib/api';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { buildLeagueContestEntryPath } from '@/features/leagues/league-routing';
import { Button, Notice } from '@/features/shared/ui';
import { entryWriteKeys } from './use-contest-entries';

function refusal(error: Error | null) {
  return extractErrorMessage(error, { fallback: 'We could not start an entry right now.' });
}

/**
 * Make your picks / Create another entry (#1739): starts a new entry for the viewer's team and
 * opens its pick screen at once, so the button never lands on the contest page. A refusal, such
 * as the team's entry limit, shows beneath it and the viewer stays where they are.
 */
export function StartEntryButton({
  contestId,
  label,
  leagueCode,
  size,
  testId,
  variant,
}: {
  contestId: string;
  label: string;
  leagueCode: string;
  size?: 'sm';
  testId: string;
  /** `secondary` beside another action, such as Add entry beside Edit picks on League Home. */
  variant?: 'secondary';
}) {
  const navigate = useNavigate();
  const startEntry = useInvalidatingMutation({
    mutationFn: async () => {
      const response = await enterContest({ path: { contestId } });
      if (!response.data?.entry) {
        throwApiError(response.error, 'Contest entry creation response is missing data.');
      }
      return response.data.entry;
    },
    onSuccess: (entry) => {
      void navigate(buildLeagueContestEntryPath(leagueCode, contestId, entry.id));
    },
    invalidates: entryWriteKeys(contestId),
  });

  return (
    <div className="flex flex-col items-start gap-2">
      <Button
        data-testid={testId}
        isLoading={startEntry.isPending}
        // The mutation's own error state shows a refusal.
        onClick={() => void startEntry.mutateAsync().catch(() => undefined)}
        size={size}
        variant={variant}
      >
        {label}
      </Button>
      {startEntry.isError ? (
        <Notice data-testid={`${testId}-error`} tone="danger">
          {refusal(startEntry.error)}
        </Notice>
      ) : null}
    </div>
  );
}
