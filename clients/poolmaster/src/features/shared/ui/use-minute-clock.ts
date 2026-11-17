import { useEffect, useState } from "react";

const CLOCK_TICK_MS = 60_000;

/** The current time, refreshed every minute so a countdown keeps moving. */
export function useMinuteClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), CLOCK_TICK_MS);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}
