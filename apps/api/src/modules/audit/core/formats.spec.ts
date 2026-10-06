import { describe, expect, it } from 'vitest';

import { storedRow } from './audit-event.spec.js';
import {
  cefSeverity,
  csvCell,
  csvHeader,
  csvRow,
  octetFrame,
  toCef,
  toSyslog,
  toWireEvent,
} from './formats.js';

const row = storedRow({
  action: 'audit.export.created',
  targetName: 'a,"b"',
  reason: '=HYPERLINK("x")',
  outcome: 'denied',
});

describe('CSV export', () => {
  it('escapes RFC 4180 and neutralizes spreadsheet formulas', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(csvCell('line\nbreak')).toBe('"line\nbreak"');
    for (const danger of ['=1+1', '+1', '-1', '@SUM(A1)', '\tx', '\rx'])
      expect(csvCell(danger).startsWith("'") || csvCell(danger).startsWith(`"'`)).toBe(true);
    expect(csvCell(null)).toBe('');
    expect(csvCell({ a: 1 })).toBe('"{""a"":1}"');
  });

  it('writes a header and one CRLF-terminated row per event', () => {
    expect(csvHeader()).toMatch(/^seq,id,occurredAt,.*,hash\r\n$/);
    const line = csvRow(row);
    expect(line.endsWith('\r\n')).toBe(true);
    expect(line).toContain(`'=HYPERLINK`);
    expect(line).toContain('"a,""b"""');
  });
});

describe('wire event', () => {
  it('never contains actor PII (ip, displayName, userAgent)', () => {
    const wire = toWireEvent(
      storedRow({ actor: { ip: '1.2.3.4', displayName: 'Ayşe', userAgent: 'UA', sessionId: 's' } }),
    );
    expect(JSON.stringify(wire)).not.toMatch(/1\.2\.3\.4|Ayşe|"UA"/);
    expect(wire['actor']).toEqual({ type: 'user', id: 'u-1', sessionId: 's' });
  });
});

describe('CEF', () => {
  it('escapes header pipes and extension equals/newlines', () => {
    const cef = toCef(storedRow({ action: 'x.y', reason: 'a=b\nc', actorId: 'pi|pe' }), '1.0|x');
    expect(cef.startsWith('CEF:0|Verbis|Verbis Platform|1.0\\|x|x.y|x.y|3|')).toBe(true);
    expect(cef).toContain('reason=a\\=b\\nc');
    expect(cef).toContain('suser=pi|pe');
    expect([cefSeverity('success'), cefSeverity('failure'), cefSeverity('denied')]).toEqual([
      3, 5, 7,
    ]);
  });
});

describe('syslog RFC 5424', () => {
  const options = {
    facility: 13,
    hostname: 'verbis audit',
    appName: 'verbis',
    enterpriseId: 32473,
    format: 'rfc5424',
    productVersion: '1',
  } as const;

  it('has PRI, version, timestamp, sanitized header fields and escaped SD', () => {
    const msg = toSyslog(storedRow({ targetId: 'a"b]c\\d' }), options);
    // facility 13 * 8 + severity 6 (success)
    expect(
      msg.startsWith(
        '<110>1 2026-10-01T10:00:00.125Z verbis_audit verbis - script.version.published [verbis@32473 ',
      ),
    ).toBe(true);
    expect(msg).toContain('resource="ScriptVersion/a\\"b\\]c\\\\d"');
    expect(msg).toContain('﻿');
  });

  it('maps outcomes to severities and supports CEF/JSON payloads', () => {
    expect(toSyslog(row, options).startsWith('<108>1 ')).toBe(true); // denied → warning
    expect(toSyslog(row, { ...options, format: 'cef' })).toContain('CEF:0|');
    expect(toSyslog(row, { ...options, format: 'json' })).toContain('"seq":"1"');
    expect(() => toSyslog(row, { ...options, facility: 24 })).toThrow(RangeError);
  });

  it('frames with octet counting (RFC 5425), counting UTF-8 bytes', () => {
    expect(octetFrame('ğ').toString('utf8')).toBe('2 ğ');
  });
});
