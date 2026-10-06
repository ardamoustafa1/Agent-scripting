/**
 * Browser apps that may start a login, and their public origins (AUTH_APP_ORIGINS). Callback and
 * post-logout URLs are always built from this allow-list, never from request headers, so a
 * forged Host header cannot redirect codes or assertions elsewhere.
 */
export class AppOrigins {
  constructor(
    private readonly origins: Readonly<Record<string, string>>,
    private readonly pathPrefix: string,
  ) {}

  apps(): string[] {
    return Object.keys(this.origins).sort();
  }

  has(app: string): boolean {
    return Object.hasOwn(this.origins, app);
  }

  /** Concrete origin of `app` for a tenant (`{tenant}` replaced by the slug). */
  originFor(app: string, tenantSlug: string): string | undefined {
    const template = Object.hasOwn(this.origins, app) ? this.origins[app] : undefined;
    return template?.replace('{tenant}', tenantSlug);
  }

  /** Public URL of an API route as the browser reaches it through the app's `/api` proxy. */
  publicUrl(app: string, tenantSlug: string, path: string): string | undefined {
    const origin = this.originFor(app, tenantSlug);
    return origin === undefined ? undefined : `${origin}${this.pathPrefix}${path}`;
  }

  /** Which app (and tenant, for `{tenant}` origins) an exact browser origin belongs to. */
  match(origin: string): { app: string; tenantSlug?: string } | undefined {
    for (const [app, template] of Object.entries(this.origins)) {
      if (!template.includes('{tenant}')) {
        if (template === origin) return { app };
        continue;
      }
      const [prefix = '', suffix = ''] = template.split('{tenant}');
      if (origin.startsWith(prefix) && origin.endsWith(suffix)) {
        const slug = origin.slice(prefix.length, origin.length - suffix.length);
        if (/^[a-z0-9][a-z0-9-]{0,62}$/.test(slug)) return { app, tenantSlug: slug };
      }
    }
    return undefined;
  }

  /** Tenant slug from a Host header when origins are tenant-templated (`{tenant}.admin.example`). */
  tenantFromHost(host: string | undefined, scheme: 'http' | 'https'): string | undefined {
    if (host === undefined) return undefined;
    return this.match(`${scheme}://${host}`)?.tenantSlug;
  }
}

/** A post-login return path: same-origin, absolute path only (no `//`, no scheme, no backslash). */
export function safeReturnPath(value: unknown): string {
  if (typeof value !== 'string' || value.length > 512) return '/';
  if (!/^\/(?![/\\])[A-Za-z0-9\-._~!$&'()*+,;=:@/%]*$/.test(value)) return '/';
  return value;
}
