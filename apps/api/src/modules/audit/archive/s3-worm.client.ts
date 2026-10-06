import { createHash, createHmac } from 'node:crypto';

/**
 * Minimal S3 client for WORM archives: PUT with Object Lock (COMPLIANCE mode, retain-until) and
 * GET for read-back verification. AWS Signature V4, path-style URLs (S3 and MinIO). Credentials
 * come from the secret store reference resolved by the worker, never from code.
 */
export interface S3WormConfig {
  readonly endpoint: string;
  readonly region: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly mode: 'COMPLIANCE' | 'GOVERNANCE';
}

export type HttpFetch = (url: string, init: RequestInit) => Promise<Response>;

const sha256 = (data: string | Uint8Array): string =>
  createHash('sha256').update(data).digest('hex');
const hmac = (key: string | Buffer, data: string): Buffer =>
  createHmac('sha256', key).update(data).digest();

/** RFC 3986 encoding as SigV4 requires (keeps `/` in paths). */
function uriEncode(value: string, keepSlash: boolean): string {
  return encodeURIComponent(value)
    .replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%2F/g, keepSlash ? '/' : '%2F');
}

export function amzDate(date: Date): { stamp: string; day: string } {
  const stamp = date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
  return { stamp, day: stamp.slice(0, 8) };
}

export interface SignedRequest {
  readonly url: string;
  readonly headers: Record<string, string>;
}

export function signS3Request(
  config: S3WormConfig,
  method: 'GET' | 'PUT',
  key: string,
  payloadHash: string,
  extraHeaders: Record<string, string>,
  now: Date,
): SignedRequest {
  const endpoint = new URL(config.endpoint);
  const path = `/${uriEncode(config.bucket, false)}/${uriEncode(key, true)}`;
  const { stamp, day } = amzDate(now);
  const headers: Record<string, string> = {
    host: endpoint.host,
    'x-amz-date': stamp,
    'x-amz-content-sha256': payloadHash,
    ...Object.fromEntries(
      Object.entries(extraHeaders).map(([k, v]) => [k.toLowerCase(), v.trim()]),
    ),
  };
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((name) => `${name}:${headers[name] ?? ''}\n`).join('');
  const signedHeaders = names.join(';');
  const canonicalRequest = [method, path, '', canonicalHeaders, signedHeaders, payloadHash].join(
    '\n',
  );
  const scope = `${day}/${config.region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', stamp, scope, sha256(canonicalRequest)].join('\n');
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${config.secretAccessKey}`, day), config.region), 's3'),
    'aws4_request',
  );
  const signature = createHmac('sha256', signingKey).update(toSign).digest('hex');
  return {
    url: `${endpoint.origin}${path}`,
    headers: {
      ...headers,
      authorization: `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  };
}

/** `host` is signed but set by the HTTP client itself. */
function withoutHost(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).filter(([name]) => name !== 'host'));
}

export class S3WormClient {
  constructor(
    private readonly config: S3WormConfig,
    private readonly fetcher: HttpFetch = fetch,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Uploads immutably; the bucket must have Object Lock enabled (fails otherwise). */
  async putLocked(
    key: string,
    body: Uint8Array,
    retainUntil: Date,
    contentType: string,
  ): Promise<void> {
    const md5 = createHash('md5').update(body).digest('base64');
    const signed = signS3Request(
      this.config,
      'PUT',
      key,
      sha256(body),
      {
        'content-type': contentType,
        'content-md5': md5,
        'x-amz-object-lock-mode': this.config.mode,
        'x-amz-object-lock-retain-until-date': retainUntil.toISOString(),
        // Never overwrite an existing archive object.
        'if-none-match': '*',
      },
      this.now(),
    );
    const headers = withoutHost(signed.headers);
    const response = await this.fetcher(signed.url, {
      method: 'PUT',
      headers,
      body,
      redirect: 'error',
    });
    if (!response.ok) throw new Error(`S3 PUT failed (${String(response.status)})`);
  }

  /** Reads an object back with its lock headers (verification after upload). */
  async get(
    key: string,
  ): Promise<{ body: Uint8Array; lockMode: string | null; retainUntil: string | null }> {
    const signed = signS3Request(this.config, 'GET', key, sha256(''), {}, this.now());
    const headers = withoutHost(signed.headers);
    const response = await this.fetcher(signed.url, { method: 'GET', headers, redirect: 'error' });
    if (!response.ok) throw new Error(`S3 GET failed (${String(response.status)})`);
    return {
      body: new Uint8Array(await response.arrayBuffer()),
      lockMode: response.headers.get('x-amz-object-lock-mode'),
      retainUntil: response.headers.get('x-amz-object-lock-retain-until-date'),
    };
  }
}
