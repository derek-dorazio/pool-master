/**
 * Notification service configuration — reads from environment variables.
 */

export interface NotificationConfig {
  port: number;

  // Email
  emailProvider: 'smtp' | 'ses';
  smtpHost: string;
  smtpPort: number;
  smtpFrom: string;

  // SES
  awsEndpoint?: string;
  awsRegion: string;
  sesFromEmail: string;

  // Push — APNs
  apnsBaseUrl: string;
  apnsKeyId: string;
  apnsTeamId: string;
  apnsBundleId: string;

  // Push — FCM
  fcmBaseUrl: string;
  fcmProjectId: string;
}

export function loadConfig(): NotificationConfig {
  return {
    port: intEnv('NOTIFICATION_SERVICE_PORT', 3004),

    emailProvider: (env('EMAIL_PROVIDER', 'smtp') as 'smtp' | 'ses'),
    smtpHost: env('SMTP_HOST', 'localhost'),
    smtpPort: intEnv('SMTP_PORT', 1025),
    smtpFrom: env('SMTP_FROM', 'noreply@poolmaster.local'),

    awsEndpoint: process.env.AWS_ENDPOINT,
    awsRegion: env('AWS_REGION', 'us-east-1'),
    sesFromEmail: env('SES_FROM_EMAIL', 'noreply@poolmaster.local'),

    apnsBaseUrl: env('APNS_BASE_URL', 'http://localhost:3099'),
    apnsKeyId: env('APNS_KEY_ID', 'dev-key'),
    apnsTeamId: env('APNS_TEAM_ID', 'dev-team'),
    apnsBundleId: env('APNS_BUNDLE_ID', 'com.poolmaster.dev'),

    fcmBaseUrl: env('FCM_BASE_URL', 'http://localhost:3099'),
    fcmProjectId: env('FCM_PROJECT_ID', 'poolmaster-dev'),
  };
}

function env(key: string, defaultValue: string): string {
  return process.env[key] ?? defaultValue;
}

function intEnv(key: string, defaultValue: number): number {
  const val = process.env[key];
  return val ? parseInt(val, 10) : defaultValue;
}
