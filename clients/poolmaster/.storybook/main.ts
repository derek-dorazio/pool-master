import type { StorybookConfig } from '@storybook/react-vite';

/**
 * The component gallery (#1615): one story file per shared component and composite, beside its
 * test (`button.stories.tsx` next to `button.test.tsx`), so example content stays out of
 * application code (rules/testing-rules.md §1B). Dev-only: nothing in `src` imports a story, so
 * the app bundle never carries one. `npm run gallery` serves it; `npm run gallery:build` writes
 * the static copy CI builds and `scripts/publish-gallery.mjs` publishes.
 */
const config: StorybookConfig = {
  stories: ['../src/**/*.stories.tsx'],
  framework: { name: '@storybook/react-vite', options: {} },
  core: { disableTelemetry: true, disableWhatsNewNotifications: true },
  // Storybook reads the app's vite.config.ts. Its index.html plugin needs the app's own page, so
  // it is dropped here; the aliases and the React plugin are what the gallery needs. The app's
  // public folder (email and link preview images) is left out: no shared component uses it.
  viteFinal(viteConfig) {
    return {
      ...viteConfig,
      publicDir: false,
      plugins: (viteConfig.plugins ?? []).filter(
        (plugin) => !(plugin && typeof plugin === 'object' && 'name' in plugin
          && plugin.name === 'product-name-in-index-html'),
      ),
    };
  },
};

export default config;
