interface LogoProps {
  size?: number;
  className?: string;
}

export function Logo({ size = 24, className }: LogoProps) {
  return (
    <img src="/favicon.svg" alt="Ultimate Pool Manager" width={size} height={size} className={className} />
  );
}
