import { RuntimeProblem } from '@verbis/core-runtime';

import { TenantApprovalSchema, type PluginManifest, type TenantApproval } from './protocol.js';

export function checkApproval(
  input: unknown,
  tenantId: string,
  manifest: PluginManifest,
  now = Date.now(),
): TenantApproval {
  const approval = TenantApprovalSchema.parse(input),
    url = new URL(approval.bundleUrl);
  if (
    !approval.enabled ||
    approval.tenantId !== tenantId ||
    approval.type !== manifest.type ||
    approval.version !== manifest.version ||
    approval.integrity !== manifest.integrity ||
    approval.expiresAt <= now
  )
    throw new RuntimeProblem('VERBIS_PLUGIN_NOT_APPROVED');
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    !approval.approvedOrigins.includes(url.origin)
  )
    throw new RuntimeProblem('VERBIS_PLUGIN_BUNDLE_ORIGIN');
  return approval;
}
export async function verifyBundle(bytes: Uint8Array, integrity: string): Promise<void> {
  const match = /^sha(256|384|512)-([A-Za-z0-9+/]+={0,2})$/.exec(integrity);
  if (!match) throw new RuntimeProblem('VERBIS_PLUGIN_INTEGRITY');
  const digest = new Uint8Array(
    await crypto.subtle.digest(`SHA-${match[1]}`, new Uint8Array(bytes).buffer),
  );
  let binary = '';
  for (const byte of digest) binary += String.fromCharCode(byte);
  if (btoa(binary) !== match[2]) throw new RuntimeProblem('VERBIS_PLUGIN_INTEGRITY');
}
export async function loadBundle(approval: TenantApproval, signal: AbortSignal): Promise<string> {
  const response = await fetch(approval.bundleUrl, {
    signal,
    credentials: 'omit',
    redirect: 'error',
    cache: 'no-store',
    mode: 'cors',
  });
  if (!response.ok || !response.body) throw new RuntimeProblem('VERBIS_PLUGIN_BUNDLE_FETCH');
  if (
    !/^(application|text)\/(javascript|ecmascript)(;|$)/i.test(
      response.headers.get('content-type') ?? '',
    )
  )
    throw new RuntimeProblem('VERBIS_PLUGIN_BUNDLE_TYPE');
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [],
    limit = 1024 * 1024;
  let size = 0;
  try {
    let result = await reader.read();
    while (!result.done) {
      size += result.value.length;
      if (size > limit) throw new RuntimeProblem('VERBIS_PLUGIN_BUNDLE_SIZE');
      chunks.push(result.value);
      result = await reader.read();
    }
  } finally {
    await reader.cancel();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  await verifyBundle(bytes, approval.integrity);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:application/javascript;base64,${btoa(binary)}`;
}
export function sandboxDocument(bundle: string): string {
  if (!/^data:application\/javascript;base64,[A-Za-z0-9+/=]+$/.test(bundle))
    throw new RuntimeProblem('VERBIS_PLUGIN_BUNDLE_TYPE');
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}' 'strict-dynamic'; script-src-attr 'none'; style-src 'nonce-${nonce}'; style-src-attr 'none'; require-trusted-types-for 'script'; trusted-types 'none'; img-src 'none'; connect-src 'none'; font-src 'none'; media-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script nonce="${nonce}" type="module" src="${bundle}"></script></body></html>`;
}

interface TrustedPolicy {
  createHTML(input: string): unknown;
}
interface TrustedFactory {
  createPolicy(name: string, rules: { createHTML(input: string): string }): TrustedPolicy;
}
let sandboxPolicy: TrustedPolicy | undefined;
let authorizedDocument: string | undefined;
/** Only documents produced locally after bundle integrity verification reach this policy. */
export function trustedSandboxDocument(bundle: string): string {
  const html = sandboxDocument(bundle);
  const factory = (globalThis as typeof globalThis & { trustedTypes?: TrustedFactory })
    .trustedTypes;
  if (!factory) return html;
  sandboxPolicy ??= factory.createPolicy('verbis-plugin', {
    createHTML(input) {
      if (input !== authorizedDocument) throw new RuntimeProblem('VERBIS_PLUGIN_DOCUMENT');
      return input;
    },
  });
  authorizedDocument = html;
  try {
    // Preserve the TrustedHTML object; React's srcDoc type currently accepts only string.
    return sandboxPolicy.createHTML(html) as string;
  } finally {
    authorizedDocument = undefined;
  }
}
