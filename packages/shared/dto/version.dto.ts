import { z } from 'zod';
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
  environment: z.string().describe('Runtime environment name such as development, qa, staging, or production.'),
  buildTimeUtc: DateTimeSchema.nullable().describe('UTC build timestamp supplied by CI, when available.'),
  gitRef: z.string().nullable().describe('Git branch or ref name supplied by CI, when available.'),
  service: VersionComponentSchema.describe('Core API service version metadata.'),
  runtime: z.object({
    nodeVersion: z.string().describe('Node.js runtime version running the service.'),
  }).describe('Non-secret runtime metadata useful during operational debugging.'),
}).describe('Public service version metadata for deployment and stale-release diagnostics.');
export type ServiceVersionResponse = z.infer<typeof ServiceVersionResponseSchema>;
