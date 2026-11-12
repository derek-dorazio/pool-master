import type { Decorator, Preview } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useLayoutEffect } from 'react';
import { MemoryRouter } from 'react-router';
import '../src/styles/globals.css';

type Scheme = 'light' | 'dark';

/** Light or dark, the way the app sets it: `data-color-scheme` on the root element (#1471). */
function ColorSchemeFrame({ scheme, children }: { scheme: Scheme; children: React.ReactNode }) {
  useLayoutEffect(() => {
    document.documentElement.dataset['colorScheme'] = scheme;
  }, [scheme]);
  return <div className="min-h-screen bg-background p-4 text-foreground">{children}</div>;
}

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

const withAppFrame: Decorator = (Story, context) => (
  <QueryClientProvider client={queryClient}>
    <MemoryRouter>
      <ColorSchemeFrame scheme={context.globals['scheme'] === 'dark' ? 'dark' : 'light'}>
        <Story />
      </ColorSchemeFrame>
    </MemoryRouter>
  </QueryClientProvider>
);

const preview: Preview = {
  decorators: [withAppFrame],
  globalTypes: {
    scheme: {
      description: 'Light or dark',
      toolbar: {
        title: 'Appearance',
        icon: 'mirror',
        items: [
          { value: 'light', title: 'Light' },
          { value: 'dark', title: 'Dark' },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { scheme: 'light', viewport: { value: 'phone', isRotated: false } },
  parameters: {
    layout: 'fullscreen',
    controls: { expanded: true },
    // The two widths every screen is checked at (rules/ux-rules.md): a phone and a laptop.
    viewport: {
      options: {
        phone: { name: 'Phone 390', styles: { width: '390px', height: '844px' }, type: 'mobile' },
        desktop: { name: 'Desktop 1280', styles: { width: '1280px', height: '800px' }, type: 'desktop' },
      },
    },
  },
};

export default preview;
