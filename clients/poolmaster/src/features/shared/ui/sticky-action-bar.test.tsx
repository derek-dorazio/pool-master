import { act, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StickyActionBar } from './sticky-action-bar';

/** A stand-in IntersectionObserver whose callback the test fires, as the browser would on scroll. */
function stubIntersectionObserver() {
  const observers: { callback: IntersectionObserverCallback; disconnect: ReturnType<typeof vi.fn> }[] = [];
  vi.stubGlobal('IntersectionObserver', class {
    disconnect = vi.fn();
    constructor(callback: IntersectionObserverCallback) {
      observers.push({ callback, disconnect: this.disconnect });
    }
    observe() {}
  });
  return {
    observers,
    scroll(isIntersecting: boolean) {
      act(() => observers.forEach(({ callback }) => callback([{ isIntersecting } as IntersectionObserverEntry], {} as IntersectionObserver)));
    },
  };
}

function PageWithBar() {
  const hero = useRef<HTMLDivElement>(null);
  return (
    <>
      <div ref={hero}>Hero button</div>
      <StickyActionBar testId="bar" watch={hero}>
        <span>Start your league</span>
      </StickyActionBar>
    </>
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('StickyActionBar', () => {
  it('stays hidden while the hero button is on screen', () => {
    const observer = stubIntersectionObserver();
    render(<PageWithBar />);

    observer.scroll(true);
    expect(screen.queryByTestId('bar')).not.toBeInTheDocument();
  });

  it('shows at the bottom of a phone once the hero button scrolls away, and hides when it comes back', () => {
    const observer = stubIntersectionObserver();
    render(<PageWithBar />);

    observer.scroll(false);
    expect(screen.getByTestId('bar')).toHaveTextContent('Start your league');
    expect(screen.getByTestId('bar')).toHaveClass('fixed', 'bottom-0', 'md:hidden');

    observer.scroll(true);
    expect(screen.queryByTestId('bar')).not.toBeInTheDocument();
  });

  it('stops watching when the page goes away', () => {
    const observer = stubIntersectionObserver();
    const { unmount } = render(<PageWithBar />);

    unmount();
    expect(observer.observers[0]?.disconnect).toHaveBeenCalled();
  });

  it('never shows in a browser without IntersectionObserver', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    render(<PageWithBar />);

    expect(screen.queryByTestId('bar')).not.toBeInTheDocument();
  });
});
