/** The small print closing a landing page: whom it is not affiliated with. */
export function LandingDisclaimer({ children, testId }: { children: string; testId: string }) {
  return <p className="text-xs text-muted-foreground" data-testid={testId}>{children}</p>;
}
