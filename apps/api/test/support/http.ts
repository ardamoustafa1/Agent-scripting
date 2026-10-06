/** Cookie jar helpers for app.inject() responses. */
export function setCookies(headers: Record<string, unknown>): Record<string, string> {
  const raw = headers['set-cookie'];
  const list = Array.isArray(raw) ? (raw as string[]) : typeof raw === 'string' ? [raw] : [];
  const out: Record<string, string> = {};
  for (const line of list) {
    const [pair] = line.split(';');
    const index = pair?.indexOf('=') ?? -1;
    if (pair === undefined || index < 0) continue;
    out[pair.slice(0, index)] = pair.slice(index + 1);
  }
  return out;
}

export function rawSetCookies(headers: Record<string, unknown>): string[] {
  const raw = headers['set-cookie'];
  return Array.isArray(raw) ? (raw as string[]) : typeof raw === 'string' ? [raw] : [];
}

export function cookieHeader(cookies: Record<string, string>): string {
  return Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}
