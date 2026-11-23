import { enumLabel } from '@poolmaster/shared/display-strings';
import { EmailTemplateStatus } from '@poolmaster/shared/domain';
import { Chip, type ChipProps } from '@/features/shared/ui';

const EMAIL_STATUS_TONES: Record<EmailTemplateStatus, ChipProps['tone']> = {
  [EmailTemplateStatus.ON]: 'success',
  [EmailTemplateStatus.OFF]: 'neutral',
  [EmailTemplateStatus.ALWAYS_ON]: 'info',
};

export function EmailStatusChip({ status }: { status: EmailTemplateStatus }) {
  return <Chip tone={EMAIL_STATUS_TONES[status]}>{enumLabel('EmailTemplateStatus', status)}</Chip>;
}
