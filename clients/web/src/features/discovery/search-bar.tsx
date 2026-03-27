import { useState, useEffect, useRef } from 'react';
import { Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: (value: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  size?: 'sm' | 'lg';
}

export function SearchBar({ value, onChange, onSubmit, placeholder, autoFocus, size = 'sm' }: SearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  // Cmd+K shortcut
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onSubmit?.(value); }}
      className="relative"
    >
      <Search className={`absolute left-3 text-muted-foreground ${size === 'lg' ? 'top-3.5 h-5 w-5' : 'top-2.5 h-4 w-4'}`} />
      <Input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? 'Search...'}
        autoFocus={autoFocus}
        className={`${size === 'lg' ? 'pl-11 pr-20 h-12 text-base' : 'pl-9 pr-16 h-9'}`}
      />
      <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
        {value && (
          <button type="button" onClick={() => onChange('')} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        )}
        <kbd className="hidden sm:inline-flex h-5 items-center rounded border bg-muted px-1.5 text-[10px] text-muted-foreground">
          {navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}K
        </kbd>
      </div>
    </form>
  );
}
