import { YearReviewStatus } from '@poolmaster/shared/domain';
import { useState } from 'react';
import { sendYearReview } from '@/lib/api';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import { Alert, Button, ConfirmDialog } from '@/features/shared/ui';
import { useYearReviewQuery } from './use-championship-query';

/**
 * "Your 2026 year in review is ready to send" for the commissioner (#872, plan Q6), on league home
 * and Championships from 1 January until it is sent. Sending emails every squad's owners, once,
 * so it asks first. Nothing shows for a member, a year with nothing counted, or once it is sent.
 */
export function YearReviewBanner({ isCommissioner, leagueId }: { isCommissioner: boolean; leagueId: string }) {
  const [isConfirming, setIsConfirming] = useState(false);
  const reviewQuery = useYearReviewQuery(leagueId, isCommissioner);
  const sendMutation = useInvalidatingMutation({
    mutationFn: async (year: number) => {
      const response = await sendYearReview({ path: { id: leagueId, year } });
      if (!response.data?.yearReview) {
        throwApiError(response.error, 'Send year in review response is missing data.');
      }
      return response.data.yearReview;
    },
    onSuccess: () => setIsConfirming(false),
    invalidates: [QueryKeys.championship.yearReview(leagueId)],
  });
  const review = reviewQuery.data;

  if (sendMutation.isSuccess) {
    return (
      <Alert data-testid="year-review-sent" tone="success">
        {`The ${sendMutation.data.year} year in review is on its way to every squad that placed.`}
      </Alert>
    );
  }
  if (review?.status !== YearReviewStatus.READY) {
    return null;
  }
  const close = () => {
    if (!sendMutation.isPending) {
      sendMutation.reset();
      setIsConfirming(false);
    }
  };

  return (
    <>
      <Alert
        action={(
          <Button data-testid="year-review-send" onClick={() => setIsConfirming(true)} size="sm" type="button">
            {`Send the ${review.year} year in review`}
          </Button>
        )}
        data-testid="year-review-ready"
        title={`Your ${review.year} year in review is ready to send`}
      >
        {`Each squad's owners get an email with their squad's ${review.year}: its championship place, contest medals, cups and trophies.`}
      </Alert>
      <ConfirmDialog
        confirmLabel="Send"
        description={`Every squad that placed in ${review.year} gets its year by email. It can be sent once.`}
        isPending={sendMutation.isPending}
        onCancel={close}
        onConfirm={() => sendMutation.mutate(review.year)}
        onOpenChange={(open) => (open ? setIsConfirming(true) : close())}
        open={isConfirming}
        pendingLabel="Sending..."
        testId="year-review-dialog"
        title={`Send the ${review.year} year in review?`}
      >
        {sendMutation.isError ? (
          <Alert tone="danger">{extractErrorMessage(sendMutation.error, { fallback: 'We could not send the year in review.' })}</Alert>
        ) : null}
      </ConfirmDialog>
    </>
  );
}
