import { pemBody } from './sp-credentials.js';

export interface SpMetadataInput {
  readonly entityId: string;
  readonly acsUrls: readonly string[];
  readonly sloUrls: readonly string[];
  readonly nameIdFormat: string;
  readonly signingCertificates: readonly string[];
  readonly encryptionCertificates: readonly string[];
  readonly authnRequestsSigned: boolean;
  readonly validUntil: Date;
}

const escape = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const keyDescriptor = (use: 'signing' | 'encryption', certificate: string) =>
  `<md:KeyDescriptor use="${use}"><ds:KeyInfo><ds:X509Data><ds:X509Certificate>${pemBody(certificate)}</ds:X509Certificate></ds:X509Data></ds:KeyInfo>${
    use === 'encryption'
      ? '<md:EncryptionMethod Algorithm="http://www.w3.org/2009/xmlenc11#aes256-gcm"/><md:EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes256-cbc"/>'
      : ''
  }</md:KeyDescriptor>`;

/**
 * SP metadata (SAML 2.0 metadata §2.4.4). Active and `next` certificates are both published so
 * IdPs can pick up a rotation ahead of time; every app origin has its own ACS endpoint.
 */
export function buildSpMetadata(input: SpMetadataInput): string {
  const parts = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" xmlns:ds="http://www.w3.org/2000/09/xmldsig#" entityID="${escape(input.entityId)}" validUntil="${input.validUntil.toISOString()}">`,
    `<md:SPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol" AuthnRequestsSigned="${String(input.authnRequestsSigned)}" WantAssertionsSigned="true">`,
    ...input.signingCertificates.map((cert) => keyDescriptor('signing', cert)),
    ...input.encryptionCertificates.map((cert) => keyDescriptor('encryption', cert)),
    ...input.sloUrls.flatMap((url) => [
      `<md:SingleLogoutService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="${escape(url)}"/>`,
      `<md:SingleLogoutService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="${escape(url)}"/>`,
    ]),
    `<md:NameIDFormat>${escape(input.nameIdFormat)}</md:NameIDFormat>`,
    ...input.acsUrls.map(
      (url, index) =>
        `<md:AssertionConsumerService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="${escape(url)}" index="${String(index)}"${index === 0 ? ' isDefault="true"' : ''}/>`,
    ),
    '</md:SPSSODescriptor>',
    '</md:EntityDescriptor>',
  ];
  return parts.join('');
}
