import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import common from '@/locales/en/common.json';
import auth from '@/locales/en/auth.json';
import dashboard from '@/locales/en/dashboard.json';
import leagues from '@/locales/en/leagues.json';
import contests from '@/locales/en/contests.json';
import settings from '@/locales/en/settings.json';

i18n.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: 'en',
  interpolation: {
    escapeValue: false,
  },
  resources: {
    en: {
      common,
      auth,
      dashboard,
      leagues,
      contests,
      settings,
    },
  },
  defaultNS: 'common',
  // Pluralisation: i18next uses the _plural suffix natively.
  // For keys like "points" / "points_plural", pass { count: N }
  // and i18next selects the correct form automatically.
  compatibilityJSON: 'v3',
});

export default i18n;
