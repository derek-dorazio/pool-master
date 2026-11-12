import { useEffect, useState, type RefObject } from 'react';

/** Whether `target` has scrolled out of view: false until the browser says so, and always false without an IntersectionObserver. */
export function useScrolledPast(target: RefObject<HTMLElement | null>): boolean {
  const [isPast, setIsPast] = useState(false);
  useEffect(() => {
    const element = target.current;
    if (!element || typeof IntersectionObserver === 'undefined') {
      return undefined;
    }
    const observer = new IntersectionObserver(([entry]) => setIsPast(!entry.isIntersecting));
    observer.observe(element);
    return () => observer.disconnect();
  }, [target]);
  return isPast;
}
