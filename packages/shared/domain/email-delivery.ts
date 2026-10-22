import { EmailMessageStatus } from './enums';

/** What an SES delivery event can make of a sent email (#844 slice 4). */
export type DeliveryOutcomeStatus =
  | typeof EmailMessageStatus.DELIVERED
  | typeof EmailMessageStatus.BOUNCED
  | typeof EmailMessageStatus.COMPLAINED
  | typeof EmailMessageStatus.FAILED;

/**
 * The statuses each delivery outcome may follow. SES reports arrive in any order and may repeat,
 * so an outcome only ever moves an email forward: a delivery follows the send; a bounce or a
 * complaint can come after a delivery; a rejection only follows the send. A report from any other
 * status changes nothing.
 */
export const DELIVERY_OUTCOME_FROM = {
  [EmailMessageStatus.DELIVERED]: [EmailMessageStatus.SENT],
  [EmailMessageStatus.BOUNCED]: [EmailMessageStatus.SENT, EmailMessageStatus.DELIVERED],
  [EmailMessageStatus.COMPLAINED]: [EmailMessageStatus.SENT, EmailMessageStatus.DELIVERED],
  [EmailMessageStatus.FAILED]: [EmailMessageStatus.SENT],
} as const satisfies Record<DeliveryOutcomeStatus, readonly EmailMessageStatus[]>;
