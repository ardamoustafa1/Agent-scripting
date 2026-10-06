export const tenantId = '01928f3a-0000-7000-8000-0000000000ff';
export const campaignId = '01928f3a-0000-7000-8000-000000000001';
export const scriptId = '01928f3a-0000-7000-8000-000000000002';
export const sessionFixture = {
  user: { id: '01928f3a-0000-7000-8000-000000000003', tenantId, authMethod: 'sso' },
  session: { id: '01928f3a-0000-7000-8000-000000000004', expiresAt: '2030-01-01T00:00:00Z' },
  csrfToken: 'synthetic-csrf-only',
};
export const permissionFixture = {
  principal: { type: 'user', id: sessionFixture.user.id, tenantId },
  roles: ['script_designer'],
  rules: [
    ['read', 'Campaign'],
    ['create', 'Campaign'],
    ['read', 'Script'],
    ['create', 'Script'],
    ['read', 'Screen'],
    ['read', 'Integration'],
    ['read', 'Tenant'],
  ],
  separationOfDuties: true,
};
export const campaignFixture = {
  id: campaignId,
  name: 'Demo campaign',
  description: 'Synthetic fixture',
  status: 'draft',
  tags: ['service'],
  version: 1,
  channels: ['voice'],
  startsAt: null,
  endsAt: null,
  externalMappings: [{ platform: 'amazon-connect', kind: 'queue', externalId: 'fixture-queue' }],
  updatedAt: '2026-10-02T10:00:00Z',
  createdAt: '2026-10-02T10:00:00Z',
};
export const scriptFixture = {
  id: scriptId,
  name: 'Demo script',
  description: 'Synthetic fixture',
  status: 'draft',
  tags: ['service'],
  currentVersionId: null,
  updatedAt: '2026-10-02T10:00:00Z',
  createdAt: '2026-10-02T10:00:00Z',
};
export const pageFixture = (data: unknown[]) => ({
  data,
  page: { limit: 100, nextCursor: null, sort: '-createdAt' },
});
export function fixtureResponse(path: string): unknown {
  if (path === '/api/auth/session') return sessionFixture;
  if (path === '/api/v1/me/permissions') return permissionFixture;
  if (path.startsWith('/api/v1/campaigns?') || path === '/api/v1/campaigns')
    return pageFixture([campaignFixture]);
  if (path === `/api/v1/campaigns/${campaignId}`) return campaignFixture;
  if (path.startsWith('/api/v1/assignments?'))
    return pageFixture([
      {
        id: '01928f3a-0000-7000-8000-000000000005',
        scriptId,
        campaignId,
        priority: 10,
        effectiveFrom: null,
        effectiveTo: null,
        variants: [
          { key: 'control', weight: 5000 },
          { key: 'variant', weight: 5000 },
        ],
      },
    ]);
  if (path.startsWith('/api/v1/scripts?') || path === '/api/v1/scripts')
    return pageFixture([scriptFixture]);
  if (path === `/api/v1/scripts/${scriptId}`) return scriptFixture;
  if (path.startsWith(`/api/v1/scripts/${scriptId}/versions?`))
    return pageFixture([
      {
        id: '01928f3a-0000-7000-8000-000000000006',
        number: 1,
        state: 'draft',
        createdAt: '2026-10-02T10:00:00Z',
        createdBy: sessionFixture.user.id,
      },
    ]);
  if (path === `/api/v1/scripts/${scriptId}/versions/1`)
    return {
      document: {
        variables: [
          { key: 'customerName', type: 'string', scope: 'session', classification: 'pii' },
        ],
      },
    };
  if (path === '/api/v1/templates' || path === '/api/v1/shared-screens') return [];
  if (path.startsWith('/api/v1/data-sources?')) return pageFixture([]);
  return { code: 'VERBIS_NOT_FOUND' };
}
