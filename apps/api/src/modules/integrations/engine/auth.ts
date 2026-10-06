import { createHash, createHmac, randomBytes } from 'node:crypto';

import { z } from 'zod';

import { xmlEscape } from './protocols.js';
import { IntegrationError } from './transport.js';

import type { Auth, Policy, WireRequest } from './contracts.js';
import type { Transport } from './transport.js';

export type SecretReader = (ref: string) => Promise<{ value: string; version: number }>;
const PasswordSchema = z.strictObject({ username: z.string(), password: z.string() });
const ClientSchema = z.strictObject({
  clientId: z.string(),
  clientSecret: z.string(),
  username: z.string().optional(),
  password: z.string().optional(),
});
const CertificateSchema = z.strictObject({
  cert: z.string(),
  key: z.string(),
  ca: z.string().optional(),
});
const TokenSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.literal('Bearer').default('Bearer'),
  expires_in: z.number().positive().max(86400).default(60),
});
export class Authentication {
  private readonly tokens = new Map<string, { value: string; expires: number }>();
  private readonly pending = new Map<string, Promise<string>>();
  constructor(private readonly transport: Transport) {}
  async apply(
    tenant: string,
    auth: Auth,
    request: WireRequest,
    read: SecretReader,
    policy: Policy,
    origins: readonly string[],
    signal: AbortSignal,
  ): Promise<{ security: string; secrets: string[] }> {
    if (auth.type === 'none') return { security: '', secrets: [] };
    const secret = await read(auth.secretRef);
    const secrets = [secret.value];
    let security = '';
    switch (auth.type) {
      case 'apiKey':
        if (auth.placement === 'query') request.url.searchParams.set(auth.name, secret.value);
        else request.headers[auth.name] = secret.value;
        break;
      case 'basic': {
        const value = PasswordSchema.parse(JSON.parse(secret.value));
        secrets.push(value.username, value.password);
        request.headers['Authorization'] =
          `Basic ${Buffer.from(`${value.username}:${value.password}`).toString('base64')}`;
        break;
      }
      case 'bearer':
        request.headers['Authorization'] = `Bearer ${secret.value}`;
        break;
      case 'mtls':
        request.tls = CertificateSchema.parse(JSON.parse(secret.value));
        break;
      case 'hmac': {
        const timestamp = new Date().toISOString();
        const nonce = randomBytes(16).toString('hex');
        request.headers['X-Signature-Timestamp'] = timestamp;
        request.headers['X-Signature-Nonce'] = nonce;
        const canonical = [
          request.method,
          request.url.pathname + request.url.search,
          timestamp,
          nonce,
          createHash('sha256')
            .update(request.body ?? '')
            .digest('hex'),
        ].join('\n');
        request.headers[auth.header] = createHmac('sha256', secret.value)
          .update(canonical)
          .digest('base64');
        break;
      }
      case 'wsSecurity': {
        const value = PasswordSchema.parse(JSON.parse(secret.value));
        const nonce = randomBytes(16);
        const created = new Date().toISOString();
        const digest = createHash('sha1')
          .update(Buffer.concat([nonce, Buffer.from(created), Buffer.from(value.password)]))
          .digest('base64');
        security = `<wsse:Security xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd"><wsse:UsernameToken><wsse:Username>${xmlEscape(value.username)}</wsse:Username><wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest">${digest}</wsse:Password><wsse:Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">${nonce.toString('base64')}</wsse:Nonce><wsu:Created>${created}</wsu:Created></wsse:UsernameToken></wsse:Security>`;
        secrets.push(value.username, value.password);
        break;
      }
      case 'oauth2-client-credentials':
      case 'oauth2-password': {
        const key = createHash('sha256')
          .update(JSON.stringify([tenant, auth, secret.version]))
          .digest('hex');
        let token = this.tokens.get(key);
        if (!token || token.expires <= Date.now()) {
          let pending = this.pending.get(key);
          if (!pending) {
            pending = this.obtainToken(key, auth, secret.value, policy, origins, signal);
            this.pending.set(key, pending);
          }
          try {
            await pending;
          } finally {
            this.pending.delete(key);
          }
          token = this.tokens.get(key);
        }
        if (!token) throw new IntegrationError('OAUTH_TOKEN_INVALID');
        request.headers['Authorization'] = `Bearer ${token.value}`;
        secrets.push(token.value);
        break;
      }
    }
    if (request.headers['Authorization']) secrets.push(request.headers['Authorization']);
    return { security, secrets };
  }
  private async obtainToken(
    key: string,
    auth: Extract<Auth, { type: 'oauth2-client-credentials' | 'oauth2-password' }>,
    value: string,
    policy: Policy,
    origins: readonly string[],
    signal: AbortSignal,
  ): Promise<string> {
    const client = ClientSchema.parse(JSON.parse(value));
    const body = new URLSearchParams({
      grant_type: auth.type === 'oauth2-password' ? 'password' : 'client_credentials',
      client_id: client.clientId,
      client_secret: client.clientSecret,
    });
    if (auth.scope) body.set('scope', auth.scope);
    if (auth.type === 'oauth2-password') {
      if (!client.username || !client.password)
        throw new IntegrationError('OAUTH_CREDENTIAL_INVALID');
      body.set('username', client.username);
      body.set('password', client.password);
    }
    const response = await this.transport(
      {
        url: new URL(auth.tokenUrl),
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      },
      policy,
      origins,
      signal,
    );
    if (response.status !== 200) throw new IntegrationError('OAUTH_TOKEN_INVALID');
    const token = TokenSchema.parse(JSON.parse(response.body));
    if (this.tokens.size > 1000) this.tokens.clear();
    this.tokens.set(key, {
      value: token.access_token,
      expires: Date.now() + Math.max(0, token.expires_in * 1000 - 30000),
    });
    return token.access_token;
  }
  invalidate(_tenant: string): void {
    this.tokens.clear();
  }
}
