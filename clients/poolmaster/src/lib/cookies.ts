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

export function writeCookie(name: string, value: string, options?: { maxAgeSeconds?: number }) {
  if (typeof document === 'undefined') {
    return;
  }

  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'SameSite=Lax'];
  if (options?.maxAgeSeconds !== undefined) {
    parts.push(`Max-Age=${options.maxAgeSeconds}`);
  }
  if (window.location.protocol === 'https:') {
    parts.push('Secure');
  }
  document.cookie = parts.join('; ');
}

export function clearCookie(name: string) {
  writeCookie(name, '', { maxAgeSeconds: 0 });
}
