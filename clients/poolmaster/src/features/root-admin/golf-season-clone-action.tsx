import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminCloneGolfSeason } from '@/lib/api';
import { Button, ConfirmationModal } from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import type { AdminGetGolfSeasonResponses } from '@/lib/api';

type GolfSeason = AdminGetGolfSeasonResponses[200]['season'];

/**
 * plans/124 §6.3 / §4.2a — "Clone to next year": copies this season's tournament
 * calendar forward one year (fresh empty shells, dates shifted — never last
 * year's field / tiers / scores / provider link). The count comes straight from
 * the already-loaded `adminGetGolfSeason`, so no preview call is needed. On
 * success, navigates to the new season's Home.
 */
export function GolfSeasonCloneAction({ season }: { season: GolfSeason }) {
  const logger = getLogger().child({ feature: 'golf-season-clone-action' });
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const targetYear = season.year + 1;

  const cloneMutation = useInvalidatingMutation({
    mutationFn: async () => {
      const response = await adminCloneGolfSeason({
        path: { seasonId: season.id },
        // targetYear omitted -> backend defaults to the source season's year + 1.
        body: {},
      });
      if (!response.data?.season) {
        throw response.error ?? new Error('Clone season response is missing data.');
      }
      return response.data;
    },
    invalidates: [
      QueryKeys.rootAdmin.golf.seasons(),
      QueryKeys.rootAdmin.golf.seasons(season.sportLeagueId),
      // The destination Season Home is the same route, so its param-independent
      // tournaments query won't refetch on its own — invalidate it so the new
      // season's calendar shows the cloned shells without a hard reload.
      QueryKeys.rootAdmin.golf.tournaments,
    ],
    onSuccess: (data) => {
      logger.info(
        {
          action: 'golf.season.clone',
          data: { sourceSeasonId: season.id, targetSeasonId: data.season.id },
        },
        'Cloned golf season',
      );
      setOpen(false);
      navigate(`/manage/golf/seasons/${data.season.id}`);
    },
    onError: (error) => {
      logger.warn(
        { action: 'golf.season.clone.failed', err: error },
        'Golf season clone was rejected',
      );
    },
  });

  return (
    <>
      <Button
        data-testid="root-admin-golf-season-home-clone"
        onClick={() => setOpen(true)}
        size="sm"
        variant="secondary"
      >
        Clone to next year
      </Button>

      <ConfirmationModal
        confirmLabel="Clone season"
        confirmTestId="root-admin-golf-season-home-clone-confirm"
        description={`${season.tournamentCount} tournament${
          season.tournamentCount === 1 ? '' : 's'
        } will be copied to a new ${targetYear} season, dates shifted one year forward. The field, tiers, prices, scores, and provider link of each tournament are not copied, and this does not change the current season.`}
        errorMessage={
          cloneMutation.isError
            ? extractErrorMessage(cloneMutation.error, {
                codeMessages: {
                  SEASON_YEAR_ALREADY_EXISTS: `This tour already has a ${targetYear} season.`,
                },
                fallback: 'We could not clone this season.',
              })
            : undefined
        }
        isPending={cloneMutation.isPending}
        onCancel={() => setOpen(false)}
        onConfirm={() => cloneMutation.mutate()}
        onOpenChange={(next) => !next && setOpen(false)}
        open={open}
        testId="root-admin-golf-season-home-clone-modal"
        title={`Clone to ${targetYear}`}
      />
    </>
  );
}
