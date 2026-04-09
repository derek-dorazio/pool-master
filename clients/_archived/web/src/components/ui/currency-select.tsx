import * as React from 'react';
import { Select } from '@/components/ui/select';
import { getCurrencySymbol } from '@/lib/format-currency';

interface CurrencyOption {
  code: string;
  name: string;
}

const CURRENCIES: CurrencyOption[] = [
  { code: 'USD', name: 'US Dollar' },
  { code: 'GBP', name: 'British Pound' },
  { code: 'EUR', name: 'Euro' },
  { code: 'CAD', name: 'Canadian Dollar' },
  { code: 'AUD', name: 'Australian Dollar' },
  { code: 'JPY', name: 'Japanese Yen' },
  { code: 'CHF', name: 'Swiss Franc' },
  { code: 'SEK', name: 'Swedish Krona' },
  { code: 'NOK', name: 'Norwegian Krone' },
  { code: 'DKK', name: 'Danish Krone' },
  { code: 'NZD', name: 'New Zealand Dollar' },
  { code: 'MXN', name: 'Mexican Peso' },
  { code: 'BRL', name: 'Brazilian Real' },
];

export interface CurrencySelectProps
  extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'onChange'> {
  value: string;
  onValueChange: (currency: string) => void;
}

const CurrencySelect = React.forwardRef<HTMLSelectElement, CurrencySelectProps>(
  ({ value, onValueChange, ...props }, ref) => {
    return (
      <Select
        ref={ref}
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        {...props}
      >
        {CURRENCIES.map((c) => (
          <option key={c.code} value={c.code}>
            {getCurrencySymbol(c.code)} {c.code} — {c.name}
          </option>
        ))}
      </Select>
    );
  },
);
CurrencySelect.displayName = 'CurrencySelect';

export { CurrencySelect, CURRENCIES };
