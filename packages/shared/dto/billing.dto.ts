/**
 * Billing DTOs (#987): a contest's entry cap and the expansions its commissioners can choose,
 * and the requests that expand it (plans/payments.md §4, §5). Commissioners and root admins
 * only: members never see prices.
 */
import { z } from 'zod';
import { registerSchema } from './schema-registry';

const EntriesPerContestSchema = z.number().int().min(1).max(100_000);

export const ContestExpansionOfferSchema = z.object({
  entriesPerContest: EntriesPerContestSchema.describe('The band: the most entries the contest takes once expanded to it.'),
  priceCents: z.number().int().min(0).describe(
    'What it costs, in US cents: the band\'s price on the league\'s plan, less the price of the band the contest already bought. Charged only while payments are on.',
  ),
}).describe('One band a contest can be expanded to.');
export type ContestExpansionOffer = z.infer<typeof ContestExpansionOfferSchema>;

export const ContestExpansionResponseSchema = z.object({
  entriesPerContest: EntriesPerContestSchema.nullable().describe(
    'The most entries the contest takes now, drafts included: the higher of its plan\'s cap and its expansion. Null for no limit.',
  ),
  entryCount: z.number().int().min(0).describe('Entries the contest holds now, drafts included: what the cap counts.'),
  expandedTo: EntriesPerContestSchema.nullable().describe('The band the contest was expanded to, or null when it never was.'),
  expandable: z.boolean().describe('Whether the contest can be expanded: from its creation, a draft included, until it stops taking entries.'),
  paymentsEnabled: z.boolean().describe('Whether expansions are charged. While off, expanding is free.'),
  offers: z.array(ContestExpansionOfferSchema).describe(
    'The bands above the contest\'s cap on its league\'s plan, smallest first. Empty once it can no longer be expanded.',
  ),
}).describe('A contest\'s entry cap, and the expansions its commissioners can choose.');
export type ContestExpansionResponse = z.infer<typeof ContestExpansionResponseSchema>;

export const ExpandContestRequestSchema = z.object({
  entriesPerContest: EntriesPerContestSchema.describe('One of the offered bands.'),
}).describe('Expand a contest to one of its offered bands.');
export type ExpandContestRequest = z.infer<typeof ExpandContestRequestSchema>;

export const GrantContestExpansionRequestSchema = z.object({
  entriesPerContest: EntriesPerContestSchema.describe('Any number of entries above the contest\'s cap.'),
  reason: z.string().trim().min(1).max(200).describe('Why it is given free; shown in the league\'s payment history.'),
}).describe('A root admin gives a contest an expansion free, with a reason.');
export type GrantContestExpansionRequest = z.infer<typeof GrantContestExpansionRequestSchema>;

registerSchema('ContestExpansionOffer', ContestExpansionOfferSchema);
registerSchema('ContestExpansionResponse', ContestExpansionResponseSchema);
registerSchema('ExpandContestRequest', ExpandContestRequestSchema);
registerSchema('GrantContestExpansionRequest', GrantContestExpansionRequestSchema);
