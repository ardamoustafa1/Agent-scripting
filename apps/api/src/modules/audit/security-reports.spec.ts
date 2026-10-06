import { describe, expect, it, vi } from 'vitest';

import { requestContext, systemContext } from '../../common/context/request-context.js';

import { AuditService } from './audit.service.js';
import { SecurityReportsController, CspReportSchema } from './security-reports.controller.js';

import type { NatsService } from '../../infra/nats/nats.service.js';
import type { OutboxWriter } from '../../infra/outbox/outbox.writer.js';

describe('CSP security reports', () => {
  it('records receipt without persisting URL credentials, path, query, referrer or policy nonce', async () => {
    const recordSecurityReport = vi.fn().mockResolvedValue(undefined);
    const controller = new SecurityReportsController({
      recordSecurityReport,
    } as unknown as AuditService);
    await requestContext.run(systemContext('report-test', 'test'), () =>
      controller.report(
        CspReportSchema.parse({
          'csp-report': {
            'document-uri':
              'https://user:secret@app.example.com/customer/pii?token=secret#fragment',
            'effective-directive': 'frame-ancestors',
            'blocked-uri': 'https://attacker.example/?token=secret',
            'original-policy': "script-src 'nonce-secret'",
            referrer: 'https://pii.example.com',
          },
        }),
      ),
    );
    expect(recordSecurityReport).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'untrusted-browser-report',
        documentOrigin: 'https://app.example.com',
        directive: 'frame-ancestors',
        disposition: 'enforce',
      }),
    );
    const serialized = JSON.stringify(recordSecurityReport.mock.calls);
    for (const forbidden of ['secret', 'pii', 'attacker', 'nonce', 'tenantId'])
      expect(serialized).not.toContain(forbidden);
  });
  it('fails the receipt when durable storage fails, and rejects unbounded or forged signal shapes', async () => {
    const controller = new SecurityReportsController({
      recordSecurityReport: vi.fn().mockRejectedValue(new Error('unavailable')),
    } as unknown as AuditService);
    const body = {
      'csp-report': { 'document-uri': 'opaque', 'effective-directive': 'frame-ancestors' },
    };
    await expect(
      requestContext.run(systemContext('report-test', 'test'), () =>
        controller.report(CspReportSchema.parse(body)),
      ),
    ).rejects.toThrow('unavailable');
    expect(
      CspReportSchema.safeParse({
        'csp-report': { ...body['csp-report'], 'document-uri': 'x'.repeat(2049) },
      }).success,
    ).toBe(false);
    expect(
      CspReportSchema.safeParse({
        'csp-report': { ...body['csp-report'], 'effective-directive': 'frame-ancestors\ninjected' },
      }).success,
    ).toBe(false);
  });
});

it('waits for a durable acknowledgement and fails closed without a security journal', async () => {
  const signal = {
    id: 'signal',
    occurredAt: new Date().toISOString(),
    correlationId: 'c',
    source: 'untrusted-browser-report' as const,
    action: 'security.csp.reported' as const,
    directive: 'frame-ancestors',
    disposition: 'enforce' as const,
    documentOrigin: 'opaque',
  };
  const outbox = {} as OutboxWriter;
  await expect(new AuditService(outbox).recordSecurityReport(signal)).rejects.toThrow(
    'Security journal is unavailable',
  );
  let acknowledge: (() => void) | undefined;
  const publish = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        acknowledge = resolve;
      }),
  );
  const service = new AuditService(outbox, undefined, undefined, {
    publish,
  } as unknown as NatsService);
  let committed = false;
  const receipt = service.recordSecurityReport(signal).then(() => {
    committed = true;
  });
  expect(committed).toBe(false);
  expect(publish).toHaveBeenCalledWith(
    'verbis.security.csp.reported.v1',
    new TextEncoder().encode(JSON.stringify(signal)),
    { msgId: 'signal', headers: {}, timeoutMs: 5000 },
  );
  acknowledge?.();
  await receipt;
  expect(committed).toBe(true);
});
it.each(['opaque', 'file:///etc/passwd'])(
  'does not claim an origin for %s and preserves report-only disposition',
  async (document) => {
    const recordSecurityReport = vi.fn().mockResolvedValue(undefined);
    const controller = new SecurityReportsController({
      recordSecurityReport,
    } as unknown as AuditService);
    await requestContext.run(systemContext('report-test', 'test'), () =>
      controller.report(
        CspReportSchema.parse({
          'csp-report': {
            'document-uri': document,
            'effective-directive': 'script-src',
            disposition: 'report',
          },
        }),
      ),
    );
    expect(recordSecurityReport).toHaveBeenCalledWith(
      expect.objectContaining({ documentOrigin: 'opaque', disposition: 'report' }),
    );
  },
);
