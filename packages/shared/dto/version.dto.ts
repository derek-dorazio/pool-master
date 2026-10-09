import { z } from 'zod';
import { registerSchema } from './schema-registry';
import { DateTimeSchema } from './common.dto';

export const VersionComponentSchema = z.object({
  name: z.string().describe('Package or runtime component name.'),
  version: z.string().describe('Semantic package version or deployment version label.'),
  gitSha: z.string().nullable().describe('Git SHA for this component build, when supplied by CI.'),
  buildNumber: z.string().nullable().describe('CI build or run number for this component build, when supplied by CI.'),
}).describe('Version metadata for one deployed component.');
export type VersionComponent = z.infer<typeof VersionComponentSchema>;

export const ServiceVersionResponseSchema = z.object({
  schemaVersion: z.literal(1).describe('Version metadata response schema version.'),
  environment: z.string().describe('Runtime environment name: development, test, ci, qa, staging, or prod.'),
  buildTimeUtc: DateTimeSchema.nullable().describe('UTC time this build was made, from version-info.json.'),
  gitRef: z.string().nullable().describe('Git branch or ref name supplied by CI, when available.'),
  service: VersionComponentSchema.describe('Core API service version metadata.'),
  runtime: z.object({
    nodeVersion: z.string().describe('Node.js runtime version running the service.'),
  }).describe('Non-secret runtime metadata useful during operational debugging.'),
}).describe('Public service version metadata for deployment and stale-release diagnostics.');
export type ServiceVersionResponse = z.infer<typeof ServiceVersionResponseSchema>;

registerSchema('VersionComponent', VersionComponentSchema);
registerSchema('ServiceVersionResponse', ServiceVersionResponseSchema);
