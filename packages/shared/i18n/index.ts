import i18next from 'i18next';

import notifications from './locales/en/notifications.json';
import emails from './locales/en/emails.json';
import activity from './locales/en/activity.json';

// Server-side initialization — synchronous, preloaded
export async function initI18n() {
  await i18next.init({
    lng: 'en',
    fallbackLng: 'en',
    ns: ['notifications', 'emails', 'activity'],
    defaultNS: 'notifications',
    resources: {
      en: {
        notifications,
        emails,
        activity,
      },
    },
    interpolation: { escapeValue: false },
  });
  return i18next;
}

export { i18next };

export function t(key: string, options?: Record<string, unknown>): string {
  return i18next.t(key, options);
}
