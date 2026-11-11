/**
 * jsdom has no `ResizeObserver`; every browser the app supports does. This stand-in records what
 * each observer watches, and `resizeAll` calls every observer watching something, as a browser
 * does when a watched element changes size (a font loads, a label grows).
 */
const observers = new Set<StandInResizeObserver>();

class StandInResizeObserver {
  private readonly targets = new Set<Element>();

  constructor(private readonly callback: ResizeObserverCallback) {}

  observe(target: Element) {
    this.targets.add(target);
    observers.add(this);
  }

  unobserve(target: Element) {
    this.targets.delete(target);
  }

  disconnect() {
    this.targets.clear();
    observers.delete(this);
  }

  notify() {
    if (this.targets.size > 0) this.callback([], this);
  }
}

export function installResizeObserver() {
  globalThis.ResizeObserver = StandInResizeObserver;
}

export function resizeAll() {
  for (const observer of observers) observer.notify();
}
