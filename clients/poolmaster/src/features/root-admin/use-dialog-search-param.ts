import { useSearchParams } from 'react-router';

/**
 * Which row's dialog is open, kept in the address under `param` (#1883), so a link can open one
 * and Back closes it. Opening or closing replaces the entry rather than adding one.
 */
export function useDialogSearchParam(param: string): [string | null, (id: string | null) => void] {
  const [searchParams, setSearchParams] = useSearchParams();
  const setOpenId = (id: string | null) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (id === null) next.delete(param);
      else next.set(param, id);
      return next;
    }, { replace: true });
  };
  return [searchParams.get(param), setOpenId];
}
