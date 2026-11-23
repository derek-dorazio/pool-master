import { createColumnHelper } from '@tanstack/react-table';
import { EmailTemplateStatusOrder, LEAGUE_PLANS, type EmailTemplateStatus } from '@poolmaster/shared/domain';
import { enumLabel } from '@poolmaster/shared/display-strings';
import type { SystemEmailDto } from '@/lib/api';
import { EmailStatusChip } from './email-status-chip';
import { EMAIL_AUDIENCE_LABELS, EMAIL_STATUS_LABELS, EmailAudienceOrder, type EmailAudience, EVERY_PLAN, planText, SYSTEM_EMAIL_LABELS } from './system-email-labels';

const PLAN_OPTIONS = [
  { value: EVERY_PLAN, label: planText(null) },
  ...LEAGUE_PLANS.map((plan) => ({ value: plan, label: enumLabel('LeaguePlan', plan) })),
];

const columnHelper = createColumnHelper<SystemEmailDto>();

/** The Notifications page's Emails grid (#1872): every column typed and explained behind its (i). */
export const systemEmailColumns = [
  columnHelper.accessor((email) => SYSTEM_EMAIL_LABELS[email.templateKey].name, {
    id: 'email',
    header: 'Email',
    meta: { info: 'The system email. ⤢ opens it: preview its latest send, send yourself a copy, or switch it on or off.', type: { kind: 'text' } },
  }),
  columnHelper.accessor((email) => SYSTEM_EMAIL_LABELS[email.templateKey].audience, {
    id: 'audience',
    header: 'Audience',
    meta: { info: 'Who gets it.', type: { kind: 'enum', order: EmailAudienceOrder, label: (audience) => EMAIL_AUDIENCE_LABELS[audience as EmailAudience] } },
    cell: ({ getValue }) => EMAIL_AUDIENCE_LABELS[getValue()],
  }),
  columnHelper.accessor((email) => SYSTEM_EMAIL_LABELS[email.templateKey].when, {
    id: 'when',
    header: 'When',
    meta: { info: 'What sends it.', type: { kind: 'text' } },
  }),
  columnHelper.accessor((email) => email.planStartsAt ?? EVERY_PLAN, {
    id: 'plan',
    header: 'Plan',
    meta: {
      info: 'The lowest league plan that gets it, under the current plan settings; every plan above it gets it too. Every plan: account, membership and root admin email.',
      type: { kind: 'enum', values: PLAN_OPTIONS },
    },
    cell: ({ row }) => planText(row.original.planStartsAt),
  }),
  columnHelper.accessor('status', {
    header: 'Status',
    meta: {
      info: 'On or Off by the email\'s own switch. Always on: an account email or the test email, which only "Send system email" in Email settings stops.',
      type: { kind: 'enum', order: EmailTemplateStatusOrder, label: (status) => EMAIL_STATUS_LABELS[status as EmailTemplateStatus] },
    },
    cell: ({ getValue }) => <EmailStatusChip status={getValue()} />,
  }),
  columnHelper.accessor('sentLast30Days', {
    header: 'Sent (30 days)',
    meta: { info: 'How many went out in the last 30 days: accepted by the email provider, whether or not they were delivered.', type: { kind: 'number' } },
  }),
];
