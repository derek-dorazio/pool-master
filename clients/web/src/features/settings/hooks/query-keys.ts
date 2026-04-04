export const settingsKeys = {
  all: ['settings'] as const,
  profile: () => [...settingsKeys.all, 'profile'] as const,
  linkedAccounts: () => [...settingsKeys.all, 'linked-accounts'] as const,
  preferences: () => [...settingsKeys.all, 'preferences'] as const,
  consent: () => [...settingsKeys.all, 'consent'] as const,
  dataExport: () => [...settingsKeys.all, 'data-export'] as const,
  accountDeletion: () => [...settingsKeys.all, 'account-deletion'] as const,
  activityLimit: () => [...settingsKeys.all, 'activity-limit'] as const,
  sessionReminder: () => [...settingsKeys.all, 'session-reminder'] as const,
  selfExclusion: () => [...settingsKeys.all, 'self-exclusion'] as const,
};
