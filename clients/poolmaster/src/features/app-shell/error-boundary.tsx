import type { ErrorInfo, ReactNode } from 'react';
import { Component } from 'react';
import { logger } from '@/lib/logger';

type ErrorBoundaryProps = {
  children: ReactNode;
};

type ErrorBoundaryState = {
  hasError: boolean;
};

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    hasError: false,
  };

  static getDerivedStateFromError() {
    return {
      hasError: true,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
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

  render() {
    if (this.state.hasError) {
      return (
        <section className="rounded-[2rem] border border-destructive/30 bg-card p-8 shadow-sm">
          <span className="text-xs font-medium uppercase tracking-[0.24em] text-destructive">
            Application Error
          </span>
          <div className="mt-4 space-y-4">
            <div className="space-y-3">
              <h2 className="text-3xl font-semibold tracking-tight">
                PoolMaster hit an unexpected problem.
              </h2>
              <p className="max-w-2xl text-base leading-7 text-muted-foreground">
                Try reloading the page. If the problem keeps happening, the browser and backend
                logs now have the failure details for investigation.
              </p>
            </div>
            <button
              className="inline-flex rounded-full bg-primary px-5 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
              onClick={this.handleReload}
              type="button"
            >
              Reload page
            </button>
          </div>
        </section>
      );
    }

    return this.props.children;
  }
}
