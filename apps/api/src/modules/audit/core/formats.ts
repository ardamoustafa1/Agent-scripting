import type { StoredAuditRow } from './audit-event.js';

/**
 * Wire formats for export and SIEM. All values come from audit rows whose diffs are already
 * PII-masked; formatters still escape every field for their grammar.
 */

/** Public, PII-free projection used by JSON export, webhook and Kafka payloads. */
export function toWireEvent(row: StoredAuditRow): Record<string, unknown> {
  const actor = (row.actor ?? {}) as Record<string, unknown>;
  return {
    id: row.id,
    tenantId: row.tenantId,
    seq: row.seq.toString(),
    occurredAt: row.occurredAt.toISOString(),
    recordedAt: row.recordedAt.toISOString(),
    action: row.action,
    actor: {
      type: row.actorType,
      id: row.actorId,
      ...(typeof actor['sessionId'] === 'string' ? { sessionId: actor['sessionId'] } : {}),
    },
    resource: { type: row.targetType, id: row.targetId, name: row.targetName },
    outcome: row.outcome,
    reason: row.reason,
    diff: row.diff ?? null,
    correlationId: row.correlationId,
    interactionId: row.interactionId,
    metadata: row.metadata ?? {},
    prevHash: row.prevHash,
    hash: row.hash,
    hashVersion: row.hashVersion,
  };
}

// ─── CSV (RFC 4180 + spreadsheet formula-injection guard) ────────────────────
export const CSV_COLUMNS = [
  'seq',
  'id',
  'occurredAt',
  'recordedAt',
  'action',
  'actorType',
  'actorId',
  'resourceType',
  'resourceId',
  'resourceName',
  'outcome',
  'reason',
  'correlationId',
  'interactionId',
  'diff',
  'prevHash',
  'hash',
] as const;

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text = typeof value === 'string' ? value : JSON.stringify(value);
  // =, +, -, @, tab, CR at the start are interpreted as formulas by spreadsheet apps.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvHeader(): string {
  return `${CSV_COLUMNS.join(',')}\r\n`;
}

export function csvRow(row: StoredAuditRow): string {
  const cells = [
    row.seq.toString(),
    row.id,
    row.occurredAt.toISOString(),
    row.recordedAt.toISOString(),
    row.action,
    row.actorType,
    row.actorId,
    row.targetType,
    row.targetId,
    row.targetName,
    row.outcome,
    row.reason,
    row.correlationId,
    row.interactionId,
    row.diff ?? null,
    row.prevHash,
    row.hash,
  ];
  return `${cells.map(csvCell).join(',')}\r\n`;
}

// ─── CEF (ArcSight Common Event Format 0) ────────────────────────────────────
function cefHeader(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/[\r\n]+/g, ' ');
}

function cefExt(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/=/g, '\\=')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n');
}

export function cefSeverity(outcome: string): number {
  if (outcome === 'denied') return 7;
  if (outcome === 'failure') return 5;
  return 3;
}

export function toCef(row: StoredAuditRow, productVersion: string): string {
  const ext: [string, string][] = [
    ['rt', String(row.occurredAt.getTime())],
    ['suser', row.actorId],
    ['cs1Label', 'actorType'],
    ['cs1', row.actorType],
    ['cs2Label', 'tenantId'],
    ['cs2', row.tenantId],
    ['cs3Label', 'resource'],
    ['cs3', `${row.targetType}/${row.targetId}`],
    ['cs4Label', 'correlationId'],
    ['cs4', row.correlationId],
    ['cs5Label', 'hash'],
    ['cs5', row.hash],
    ['cn1Label', 'seq'],
    ['cn1', row.seq.toString()],
    ['outcome', row.outcome],
    ['externalId', row.id],
    ...(row.reason === null ? [] : ([['reason', row.reason]] as [string, string][])),
  ];
  const header = [
    'CEF:0',
    'Verbis',
    'Verbis Platform',
    cefHeader(productVersion),
    cefHeader(row.action),
    cefHeader(row.action),
    String(cefSeverity(row.outcome)),
  ].join('|');
  return `${header}|${ext.map(([k, v]) => `${k}=${cefExt(v)}`).join(' ')}`;
}

// ─── Syslog RFC 5424 (+ RFC 5425 octet counting for TLS) ─────────────────────
const NILVALUE = '-';

/** PRINTUSASCII, max length, no spaces (HOSTNAME, APP-NAME, MSGID, SD-NAME). */
function printable(value: string, max: number): string {
  const cleaned = value.replace(/[^\x21-\x7e]/g, '_').slice(0, max);
  return cleaned === '' ? NILVALUE : cleaned;
}

/** SD-PARAM value escaping: `"`, `\` and `]` (RFC 5424 §6.3.3). */
function sdValue(value: string): string {
  return value.replace(/[\\"\]]/g, (c) => `\\${c}`);
}

export interface SyslogOptions {
  readonly facility: number;
  readonly hostname: string;
  readonly appName: string;
  /** Private enterprise number for the SD-ID (`verbis@<pen>`). */
  readonly enterpriseId: number;
  readonly format: 'rfc5424' | 'cef' | 'json';
  readonly productVersion: string;
}

export function syslogSeverity(outcome: string): number {
  if (outcome === 'denied') return 4; // warning
  if (outcome === 'failure') return 3; // error
  return 6; // informational
}

export function toSyslog(row: StoredAuditRow, options: SyslogOptions): string {
  if (!Number.isInteger(options.facility) || options.facility < 0 || options.facility > 23) {
    throw new RangeError('syslog facility must be 0..23');
  }
  const pri = options.facility * 8 + syslogSeverity(row.outcome);
  const sdId = `verbis@${String(options.enterpriseId)}`;
  const params: [string, string][] = [
    ['tenant', row.tenantId],
    ['seq', row.seq.toString()],
    ['action', row.action],
    ['actorType', row.actorType],
    ['actor', row.actorId],
    ['resource', `${row.targetType}/${row.targetId}`],
    ['outcome', row.outcome],
    ['correlationId', row.correlationId],
    ['hash', row.hash],
  ];
  const sd = `[${sdId} ${params.map(([k, v]) => `${k}="${sdValue(v)}"`).join(' ')}]`;
  const msg =
    options.format === 'cef'
      ? toCef(row, options.productVersion)
      : options.format === 'json'
        ? JSON.stringify(toWireEvent(row))
        : `${row.action} ${row.outcome} by ${row.actorType}:${row.actorId}`;
  return [
    `<${String(pri)}>1`,
    row.recordedAt.toISOString(),
    printable(options.hostname, 255),
    printable(options.appName, 48),
    NILVALUE,
    printable(row.action, 32),
    sd,
    // BOM marks the MSG as UTF-8 (RFC 5424 §6.4).
    `\uFEFF${msg}`,
  ].join(' ');
}

/** RFC 5425 framing: `MSG-LEN SP SYSLOG-MSG`, length in octets. */
export function octetFrame(message: string): Buffer {
  const body = Buffer.from(message, 'utf8');
  return Buffer.concat([Buffer.from(`${String(body.length)} `, 'ascii'), body]);
}
