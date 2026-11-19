import { EmailTemplateStatus } from '@poolmaster/shared/domain';
import { Chip, type ChipProps } from '@/features/shared/ui';
import { EMAIL_STATUS_LABELS } from './system-email-labels';

const EMAIL_STATUS_TONES: Record<EmailTemplateStatus, ChipProps['tone']> = {
  [EmailTemplateStatus.ON]: 'success',
  [EmailTemplateStatus.OFF]: 'neutral',
  [EmailTemplateStatus.ALWAYS_ON]: 'info',
};

export function EmailStatusChip({ status }: { status: EmailTemplateStatus }) {
  return <Chip tone={EMAIL_STATUS_TONES[status]}>{EMAIL_STATUS_LABELS[status]}</Chip>;
}
