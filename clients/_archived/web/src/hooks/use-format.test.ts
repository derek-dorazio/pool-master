import { renderHook } from '@/test-utils';
import { useFormat } from './use-format';

describe('useFormat', () => {
  it('formats whole numbers with locale grouping', () => {
    const { result } = renderHook(() => useFormat());

    const formatted = result.current.number(1234567);
    expect(formatted).toBe('1,234,567');
  });

  it('formats decimals with specified precision', () => {
    const { result } = renderHook(() => useFormat());

    const formatted = result.current.decimal(3.14159, 2);
    expect(formatted).toBe('3.14');
  });

  it('formats percent values', () => {
    const { result } = renderHook(() => useFormat());

    const formatted = result.current.percent(0.753, 1);
    expect(formatted).toBe('75.3%');
  });

  it('formats ordinals correctly', () => {
    const { result } = renderHook(() => useFormat());

    expect(result.current.ordinal(1)).toBe('1st');
    expect(result.current.ordinal(2)).toBe('2nd');
    expect(result.current.ordinal(3)).toBe('3rd');
    expect(result.current.ordinal(4)).toBe('4th');
    expect(result.current.ordinal(11)).toBe('11th');
    expect(result.current.ordinal(12)).toBe('12th');
    expect(result.current.ordinal(13)).toBe('13th');
    expect(result.current.ordinal(21)).toBe('21st');
  });

  it('formats compact numbers', () => {
    const { result } = renderHook(() => useFormat());

    const formatted = result.current.compact(1500);
    expect(formatted).toBe('1.5K');
  });

  it('formats currency from cents', () => {
    const { result } = renderHook(() => useFormat());

    const formatted = result.current.currency(5000, 'USD');
    expect(formatted).toBe('$50.00');
  });
});
