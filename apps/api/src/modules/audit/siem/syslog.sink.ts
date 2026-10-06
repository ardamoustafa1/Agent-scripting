import { connect, type ConnectionOptions, type TLSSocket } from 'node:tls';

import { octetFrame, toSyslog, type SyslogOptions } from '../core/formats.js';

import type { SiemSink, SyslogConfig } from './sink.js';
import type { StoredAuditRow } from '../core/audit-event.js';

export type TlsConnector = (options: ConnectionOptions) => TLSSocket;

/**
 * Syslog over TLS (RFC 5425): TLS 1.2+, certificate verification always on, octet-counted frames.
 * A batch counts as delivered when every frame was flushed to the kernel and the socket did not
 * error; the transport has no application ack, so the cursor gives at-least-once semantics.
 */
export class SyslogTlsSink implements SiemSink {
  #socket: TLSSocket | undefined;

  constructor(
    private readonly config: SyslogConfig,
    private readonly options: Pick<SyslogOptions, 'format' | 'productVersion'>,
    private readonly connector: TlsConnector = connect,
  ) {}

  #connect(): Promise<TLSSocket> {
    if (this.#socket !== undefined && !this.#socket.destroyed) return Promise.resolve(this.#socket);
    return new Promise((resolve, reject) => {
      const socket = this.connector({
        host: this.config.host,
        port: this.config.port,
        servername: this.config.servername ?? this.config.host,
        minVersion: 'TLSv1.2',
        rejectUnauthorized: true,
        ...(this.config.caPem === undefined ? {} : { ca: this.config.caPem }),
      });
      const timer = setTimeout(() => {
        socket.destroy(new Error('syslog connect timeout'));
      }, this.config.timeoutMs);
      socket.once('secureConnect', () => {
        clearTimeout(timer);
        this.#socket = socket;
        resolve(socket);
      });
      socket.once('error', (error: Error) => {
        clearTimeout(timer);
        this.#socket = undefined;
        reject(error);
      });
    });
  }

  async deliver(rows: readonly StoredAuditRow[]): Promise<void> {
    if (rows.length === 0) return;
    const socket = await this.#connect();
    const format: SyslogOptions = {
      facility: this.config.facility,
      hostname: this.config.hostname,
      appName: this.config.appName,
      enterpriseId: this.config.enterpriseId,
      format: this.options.format,
      productVersion: this.options.productVersion,
    };
    const payload = Buffer.concat(rows.map((row) => octetFrame(toSyslog(row, format))));
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => {
        this.#socket = undefined;
        reject(error);
      };
      socket.once('error', onError);
      socket.write(payload, (error) => {
        socket.off('error', onError);
        if (error === null || error === undefined) resolve();
        else onError(error);
      });
    });
  }

  async close(): Promise<void> {
    const socket = this.#socket;
    this.#socket = undefined;
    if (socket === undefined) return;
    await new Promise<void>((resolve) => {
      socket.end(() => {
        resolve();
      });
    });
  }
}
