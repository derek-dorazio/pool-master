/**
 * jsdom does no layout, so every width and scroll offset reads 0. This stands in for a phone:
 * any element whose classes include `overflow-x-auto` is a scrolling row `rowWidth` wide, and
 * each of its children is a tab `tabWidth` wide laid end to end. The row's `scrollLeft` keeps
 * what is written to it, clamped as a browser clamps it. `setLayout` changes the sizes, as a
 * loading font or a longer label would; `restore` undoes the stand-in.
 */
export function installScrollRowLayout(initial: { rowWidth: number; tabWidth: number }) {
  let { rowWidth, tabWidth } = initial;
  const scrollLefts = new WeakMap<HTMLElement, number>();
  const isRow = (element: HTMLElement) => element.classList.contains('overflow-x-auto');
  const tabIndex = (element: HTMLElement) =>
    element.parentElement && isRow(element.parentElement)
      ? Array.from(element.parentElement.children).indexOf(element)
      : -1;
  const maxScroll = (row: HTMLElement) => Math.max(0, row.children.length * tabWidth - rowWidth);

  const stubs: Record<string, PropertyDescriptor> = {
    clientWidth: { get(this: HTMLElement) { return isRow(this) ? rowWidth : 0; } },
    offsetLeft: { get(this: HTMLElement) { return Math.max(0, tabIndex(this)) * tabWidth; } },
    offsetWidth: { get(this: HTMLElement) { return tabIndex(this) >= 0 ? tabWidth : 0; } },
    scrollLeft: {
      get(this: HTMLElement) { return scrollLefts.get(this) ?? 0; },
      set(this: HTMLElement, value: number) {
        scrollLefts.set(this, Math.min(maxScroll(this), Math.max(0, value)));
      },
    },
    scrollWidth: { get(this: HTMLElement) { return isRow(this) ? this.children.length * tabWidth : 0; } },
  };

  // Only what HTMLElement.prototype itself defined; the rest is inherited from Element.prototype
  // and comes back once the override is deleted.
  const originals = Object.fromEntries(
    Object.keys(stubs).map((name) => [name, Object.getOwnPropertyDescriptor(HTMLElement.prototype, name)]),
  );
  for (const [name, descriptor] of Object.entries(stubs)) {
    Object.defineProperty(HTMLElement.prototype, name, { ...descriptor, configurable: true });
  }

  const restore = () => {
    for (const [name, original] of Object.entries(originals)) {
      if (original) Object.defineProperty(HTMLElement.prototype, name, original);
      else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name];
    }
  };
  const setLayout = (next: { rowWidth: number; tabWidth: number }) => {
    ({ rowWidth, tabWidth } = next);
  };
  return { restore, setLayout };
}
