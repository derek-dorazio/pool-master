export const settingsKeys = {
  all: ['settings'] as const,
  profile: () => [...settingsKeys.all, 'profile'] as const,
  linkedAccounts: () => [...settingsKeys.all, 'linked-accounts'] as const,
  preferences: () => [...settingsKeys.all, 'preferences'] as const,
  consent: () => [...settingsKeys.all, 'consent'] as const,
  dataExport: () => [...settingsKeys.all, 'data-export'] as const,
};
