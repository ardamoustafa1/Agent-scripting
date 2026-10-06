/** Launch handles are issued by Verbis, never minted from CRM record or query parameters. */
export function marketplaceLaunchUrl(origin: string, code?: string): string {
  const url = new URL(origin);
  if (
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    url.pathname !== '/' ||
    url.search !== '' ||
    url.hash !== ''
  )
    throw new Error('Expected an HTTPS agent origin');
  if (code !== undefined && !/^[A-Za-z0-9_-]{43}$/.test(code))
    throw new Error('Invalid launch handle');
  return `${url.origin}/launch${code === undefined ? '' : `#code=${code}`}`;
}
