import type { ErrorInfo, ReactNode } from 'react';
import { Component } from 'react';
import { Button, StatusPage } from '@/features/shared/ui';
import { logger } from '@/lib/logger';

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
        <StatusPage
          action={(
            <Button onClick={this.handleReload} type="button">
              Reload
            </Button>
          )}
          body="Reload to try again."
          kind="error"
          testId="error-boundary"
          title="Something went wrong"
        />
      );
    }

    return this.props.children;
  }
}
