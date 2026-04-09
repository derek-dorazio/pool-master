import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';

interface ChannelToggleProps {
  checked: boolean;
  locked?: boolean;
  disabled?: boolean;
  disabledTooltip?: string;
  onToggle: (checked: boolean) => void;
  ariaLabel: string;
}

export function ChannelToggle({
  checked,
  locked,
  disabled,
  disabledTooltip,
  onToggle,
  ariaLabel,
}: ChannelToggleProps) {
  const isDisabled = locked || disabled;

  return (
    <div className="flex items-center justify-center" title={disabled ? disabledTooltip : undefined}>
      <Checkbox
        checked={checked}
        onCheckedChange={(val) => {
          if (!isDisabled) onToggle(val === true);
        }}
        disabled={isDisabled}
        aria-label={ariaLabel}
        aria-disabled={isDisabled}
        className={cn(locked && 'opacity-70')}
      />
      {locked && (
        <span className="ml-1 text-xs text-muted-foreground" aria-hidden="true">
          🔒
        </span>
      )}
    </div>
  );
}
