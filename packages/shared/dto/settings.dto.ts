/**
 * Settings DTOs (#450) — the root-admin view of every settings group under
 * /api/v1/platform/settings.
 *
 * Each group's payload is typed by its own schema through a union discriminated on `key`, so
 * the generated SDK knows that an `EMAIL_CONFIG` group carries an `EmailConfig`. A group added
 * to core-api's settings registry is added to `SettingsGroupKeySchema` and to the three unions
 * here; a unit test fails until it is.
 */
import { z } from 'zod';
import { DateTimeSchema } from './common.dto';
import { BudgetPricingConfigSchema, EmailConfigSchema, IngestionScheduleConfigSchema } from './config.dto';
import { registerSchema } from './schema-registry';

export const SettingsGroupKeySchema = z.enum([
  'INGESTION_SCHEDULE_CONFIG',
  'EMAIL_CONFIG',
  'BUDGET_PRICING_CONFIG',
]).describe('The stored key of a settings group.');
export type SettingsGroupKey = z.infer<typeof SettingsGroupKeySchema>;

export const SettingsActorSchema = z.object({
  id: z.string().uuid().describe('The user id of the root admin who made the change.'),
  name: z.string().describe('The admin\'s full name, for display.'),
}).describe('The root admin who saved a settings change.');
export type SettingsActor = z.infer<typeof SettingsActorSchema>;

const groupFields = {
  title: z.string().describe('Short display name of the group.'),
  description: z.string().describe('What the group controls.'),
  source: z.enum(['stored', 'defaults']).describe(
    '`stored` when a saved value is in use; `defaults` when nothing is saved or the saved value is invalid.',
  ),
  updatedAt: DateTimeSchema.nullable().describe(
    'When the stored value was last saved, or null when nothing is stored. Send it back as `expectedUpdatedAt` on the next save.',
  ),
  updatedBy: SettingsActorSchema.nullable().describe('Who last saved the stored value, when known.'),
};

export const SettingsGroupSchema = z.discriminatedUnion('key', [
  z.object({
    key: z.literal('INGESTION_SCHEDULE_CONFIG'),
    ...groupFields,
    value: IngestionScheduleConfigSchema.describe('The value in use.'),
    defaults: IngestionScheduleConfigSchema.describe('The value a reset would store.'),
  }),
  z.object({
    key: z.literal('EMAIL_CONFIG'),
    ...groupFields,
    value: EmailConfigSchema.describe('The value in use.'),
    defaults: EmailConfigSchema.describe('The value a reset would store.'),
  }),
  z.object({
    key: z.literal('BUDGET_PRICING_CONFIG'),
    ...groupFields,
    value: BudgetPricingConfigSchema.describe('The value in use.'),
    defaults: BudgetPricingConfigSchema.describe('The value a reset would store.'),
  }),
]).describe('One settings group: its current value, its defaults, and who last changed it.');
export type SettingsGroup = z.infer<typeof SettingsGroupSchema>;

export const SettingsGroupListSchema = z.object({
  groups: z.array(SettingsGroupSchema).describe('Every settings group, in registry order.'),
}).describe('Every settings group the platform has.');
export type SettingsGroupList = z.infer<typeof SettingsGroupListSchema>;

/**
 * The ingestion schedule as a request carries it. The stored schema defaults `scheduledSports`,
 * and a default inside a `oneOf` is ignored by the request validator (Ajv strict mode refuses
 * it), so a save must send the field: a save is a whole value anyway.
 */
const IngestionScheduleConfigValueSchema = IngestionScheduleConfigSchema.extend({
  scheduledSports: IngestionScheduleConfigSchema.shape.scheduledSports.removeDefault().describe(
    'Sports that scheduled ingestion is allowed to run automatically.',
  ),
});

const expectedUpdatedAt = DateTimeSchema.nullable().describe(
  'The `updatedAt` the admin last read (null when nothing was stored). If another save has landed since, the update is refused with 409 SETTINGS_CONFLICT.',
);

export const SettingsGroupUpdateRequestSchema = z.discriminatedUnion('key', [
  z.object({
    key: z.literal('INGESTION_SCHEDULE_CONFIG'),
    value: IngestionScheduleConfigValueSchema.describe('The whole new value.'),
    expectedUpdatedAt,
  }),
  z.object({
    key: z.literal('EMAIL_CONFIG'),
    value: EmailConfigSchema.describe('The whole new value.'),
    expectedUpdatedAt,
  }),
  z.object({
    key: z.literal('BUDGET_PRICING_CONFIG'),
    value: BudgetPricingConfigSchema.describe('The whole new value.'),
    expectedUpdatedAt,
  }),
]).describe('A whole new value for one settings group. `key` must match the path.');
export type SettingsGroupUpdateRequest = z.infer<typeof SettingsGroupUpdateRequestSchema>;

const changeFields = {
  id: z.string().uuid(),
  changedAt: DateTimeSchema,
  changedBy: SettingsActorSchema.nullable().describe('Who saved it, when known.'),
};
const previousValueNote = 'The stored value before the save; null when the save created the first stored value.';
const newValueNote = 'The value the save stored.';

export const SettingsChangeSchema = z.discriminatedUnion('key', [
  z.object({
    key: z.literal('INGESTION_SCHEDULE_CONFIG'),
    ...changeFields,
    previousValue: IngestionScheduleConfigSchema.nullable().describe(previousValueNote),
    newValue: IngestionScheduleConfigSchema.describe(newValueNote),
  }),
  z.object({
    key: z.literal('EMAIL_CONFIG'),
    ...changeFields,
    previousValue: EmailConfigSchema.nullable().describe(previousValueNote),
    newValue: EmailConfigSchema.describe(newValueNote),
  }),
  z.object({
    key: z.literal('BUDGET_PRICING_CONFIG'),
    ...changeFields,
    previousValue: BudgetPricingConfigSchema.nullable().describe(previousValueNote),
    newValue: BudgetPricingConfigSchema.describe(newValueNote),
  }),
]).describe('One saved change to a settings group, each value typed by the group\'s own schema.');
export type SettingsChange = z.infer<typeof SettingsChangeSchema>;

export const SETTINGS_HISTORY_LIMIT = 20;

export const SettingsChangeListSchema = z.object({
  changes: z.array(SettingsChangeSchema).describe(
    `The group's most recent changes, newest first, at most ${SETTINGS_HISTORY_LIMIT}.`,
  ),
}).describe('Recent changes to one settings group.');
export type SettingsChangeList = z.infer<typeof SettingsChangeListSchema>;

registerSchema('SettingsGroupKey', SettingsGroupKeySchema);
registerSchema('SettingsActor', SettingsActorSchema);
registerSchema('SettingsGroup', SettingsGroupSchema);
registerSchema('SettingsGroupList', SettingsGroupListSchema);
registerSchema('SettingsGroupUpdateRequest', SettingsGroupUpdateRequestSchema);
registerSchema('SettingsChange', SettingsChangeSchema);
registerSchema('SettingsChangeList', SettingsChangeListSchema);
