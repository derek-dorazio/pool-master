export function readCookie(name: string) {
  if (typeof document === 'undefined') {
    return null;
  }

  for (const cookie of document.cookie.split(';')) {
    const trimmed = cookie.trim();
    if (!trimmed.startsWith(`${name}=`)) {
      continue;
    }

    const rawValue = trimmed.slice(name.length + 1);
    return rawValue ? decodeURIComponent(rawValue) : null;
  }

  return null;
}
