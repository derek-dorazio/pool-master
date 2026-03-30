import { useState } from 'react';
import { Button } from './button';

interface ConfirmDialogProps {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  title: string;
  description: string;
  confirmLabel?: string;
  variant?: 'default' | 'destructive';
}

export function ConfirmDialog({
  open,
  onConfirm,
  onCancel,
  title,
  description,
  confirmLabel,
  variant,
}: ConfirmDialogProps) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" onClick={onCancel} />
      <div className="relative z-50 w-full max-w-md rounded-lg border bg-card p-6 shadow-lg">
        <h3 className="text-lg font-semibold">{title}</h3>
        <p className="mt-2 text-sm text-muted-foreground">{description}</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button variant={variant ?? 'default'} onClick={onConfirm}>
            {confirmLabel ?? 'Confirm'}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function useConfirmDialog() {
  const [state, setState] = useState<{
    open: boolean;
    title: string;
    description: string;
    confirmLabel?: string;
    variant?: 'default' | 'destructive';
    resolve?: (v: boolean) => void;
  }>({ open: false, title: '', description: '' });

  const confirm = (
    title: string,
    description: string,
    options?: { confirmLabel?: string; variant?: 'default' | 'destructive' },
  ) =>
    new Promise<boolean>((resolve) => {
      setState({
        open: true,
        title,
        description,
        confirmLabel: options?.confirmLabel,
        variant: options?.variant,
        resolve,
      });
    });

  const onConfirm = () => {
    state.resolve?.(true);
    setState({ open: false, title: '', description: '' });
  };

  const onCancel = () => {
    state.resolve?.(false);
    setState({ open: false, title: '', description: '' });
  };

  return {
    open: state.open,
    title: state.title,
    description: state.description,
    confirmLabel: state.confirmLabel,
    variant: state.variant,
    confirm,
    onConfirm,
    onCancel,
  };
}
