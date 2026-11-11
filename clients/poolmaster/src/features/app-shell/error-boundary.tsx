import type { ErrorInfo, ReactNode } from 'react';
import { Component } from 'react';
import { Button, Heading, Text } from '@/features/shared/ui';
import { logger } from '@/lib/logger';
import { PRODUCT_NAME } from '@poolmaster/shared/domain';

type ErrorBoundaryProps = {
  children: ReactNode;
};

type ErrorBoundaryState = {
  hasError: boolean;
};

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = {
    hasError: false,
  };

  static getDerivedStateFromError() {
    return {
      hasError: true,
    };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    logger.fatal(
      {
        action: 'app.errorBoundary.caught',
        err: error,
        data: {
          componentStack: errorInfo.componentStack || null,
        },
      },
      'Unhandled render error',
    );
  }

  private handleReload = () => {
    window.location.reload();
  };

  override render() {
    if (this.state.hasError) {
      return (
        <section className="rounded-4xl border border-destructive/30 bg-card p-8 shadow-sm">
          <Text tone="danger" variant="label">Application Error</Text>
          <div className="mt-4 space-y-4">
            <div className="space-y-3">
              <Heading level={2} tone="inherit" variant="page">
                {PRODUCT_NAME} hit an unexpected problem.
              </Heading>
              <Text as="p" className="max-w-2xl leading-7" size="base" variant="meta">
                Try reloading the page. If the problem keeps happening, try again later.
              </Text>
            </div>
            <Button
              className="inline-flex rounded-full bg-primary px-5 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
              onClick={this.handleReload}
              type="button"
            >
              Reload page
            </Button>
          </div>
        </section>
      );
    }

    return this.props.children;
  }
}
