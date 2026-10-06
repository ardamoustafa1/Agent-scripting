import { randomBytes } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';

import { SignedXml } from 'xml-crypto';
import { encrypt } from 'xml-encryption';

import {
  generateSpCredential,
  type GeneratedCredential,
} from '../../src/modules/identity/saml/sp-credentials.js';

export interface AssertionOptions {
  readonly acsUrl: string;
  readonly audience: string;
  readonly inResponseTo?: string;
  readonly nameId?: string;
  readonly nameIdFormat?: string;
  readonly attributes?: Record<string, string[]>;
  readonly sign?: 'assertion' | 'response' | 'none';
  readonly encryptFor?: string;
  readonly issuer?: string;
  readonly notOnOrAfter?: Date;
  readonly assertionId?: string;
  readonly signingKey?: GeneratedCredential;
}

const NS =
  'xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"';
const esc = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

function sign(
  xml: string,
  key: GeneratedCredential,
  element: 'Assertion' | 'Response' | 'LogoutRequest',
): string {
  const signer = new SignedXml({
    privateKey: key.privateKey,
    publicCert: key.certificate,
    signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
    canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#',
  });
  const xpath = `//*[local-name(.)='${element}']`;
  signer.addReference({
    xpath,
    digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
    transforms: [
      'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
      'http://www.w3.org/2001/10/xml-exc-c14n#',
    ],
  });
  signer.computeSignature(xml, {
    location: { reference: `${xpath}/*[local-name(.)='Issuer']`, action: 'after' },
  });
  return signer.getSignedXml();
}

/** A SAML IdP for tests: signs (and optionally encrypts) responses with its own credential. */
export class MockSamlIdp {
  credential!: GeneratedCredential;
  readonly entityId = 'https://idp.example.test/saml';
  readonly ssoUrl = 'https://idp.example.test/sso';
  readonly sloUrl = 'https://idp.example.test/slo';

  async init(): Promise<void> {
    this.credential = await generateSpCredential('Mock IdP');
  }

  static requestId(location: string): string {
    const request = new URL(location).searchParams.get('SAMLRequest') ?? '';
    const xml = inflateRawSync(Buffer.from(request, 'base64')).toString('utf8');
    const id = /\sID="([^"]+)"/.exec(xml)?.[1];
    if (id === undefined) throw new Error('no request id');
    return id;
  }

  async response(options: AssertionOptions): Promise<string> {
    const now = new Date();
    const until = (options.notOnOrAfter ?? new Date(now.getTime() + 5 * 60_000)).toISOString();
    const issuer = options.issuer ?? this.entityId;
    const inResponseTo =
      options.inResponseTo === undefined ? '' : ` InResponseTo="${options.inResponseTo}"`;
    const attributes = Object.entries(options.attributes ?? {})
      .map(
        ([name, values]) =>
          `<saml:Attribute Name="${esc(name)}">${values.map((v) => `<saml:AttributeValue>${esc(v)}</saml:AttributeValue>`).join('')}</saml:Attribute>`,
      )
      .join('');
    let assertion =
      `<saml:Assertion ${NS} ID="${options.assertionId ?? `_a${randomBytes(8).toString('hex')}`}" Version="2.0" IssueInstant="${now.toISOString()}">` +
      `<saml:Issuer>${issuer}</saml:Issuer>` +
      `<saml:Subject><saml:NameID Format="${options.nameIdFormat ?? 'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent'}">${esc(options.nameId ?? 'nid-1')}</saml:NameID>` +
      `<saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData${inResponseTo} NotOnOrAfter="${until}" Recipient="${options.acsUrl}"/></saml:SubjectConfirmation></saml:Subject>` +
      `<saml:Conditions NotBefore="${new Date(now.getTime() - 60_000).toISOString()}" NotOnOrAfter="${until}"><saml:AudienceRestriction><saml:Audience>${options.audience}</saml:Audience></saml:AudienceRestriction></saml:Conditions>` +
      `<saml:AuthnStatement AuthnInstant="${now.toISOString()}" SessionIndex="_s1"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement>` +
      `<saml:AttributeStatement>${attributes}</saml:AttributeStatement>` +
      `</saml:Assertion>`;
    const key = options.signingKey ?? this.credential;
    if ((options.sign ?? 'assertion') === 'assertion')
      assertion = sign(assertion, key, 'Assertion');
    if (options.encryptFor !== undefined) {
      const encrypted = await new Promise<string>((resolve, reject) => {
        encrypt(
          assertion,
          {
            rsa_pub: options.encryptFor ?? '',
            pem: options.encryptFor ?? '',
            encryptionAlgorithm: 'http://www.w3.org/2009/xmlenc11#aes256-gcm',
            keyEncryptionAlgorithm: 'http://www.w3.org/2001/04/xmlenc#rsa-oaep-mgf1p',
          },
          (error: Error | null, result: string) => {
            if (error === null) resolve(result);
            else reject(error);
          },
        );
      });
      assertion = `<saml:EncryptedAssertion>${encrypted}</saml:EncryptedAssertion>`;
    }
    let response =
      `<samlp:Response ${NS} ID="_r${randomBytes(8).toString('hex')}" Version="2.0" IssueInstant="${now.toISOString()}" Destination="${options.acsUrl}"${inResponseTo}>` +
      `<saml:Issuer>${issuer}</saml:Issuer>` +
      `<samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>` +
      assertion +
      `</samlp:Response>`;
    if (options.sign === 'response') response = sign(response, key, 'Response');
    return Buffer.from(response).toString('base64');
  }

  logoutRequest(options: { destination: string; nameId: string; sessionIndex?: string }): string {
    const xml =
      `<samlp:LogoutRequest ${NS} ID="_l${randomBytes(8).toString('hex')}" Version="2.0" IssueInstant="${new Date().toISOString()}" Destination="${options.destination}">` +
      `<saml:Issuer>${this.entityId}</saml:Issuer>` +
      `<saml:NameID Format="urn:oasis:names:tc:SAML:2.0:nameid-format:persistent">${esc(options.nameId)}</saml:NameID>` +
      (options.sessionIndex === undefined
        ? ''
        : `<samlp:SessionIndex>${options.sessionIndex}</samlp:SessionIndex>`) +
      `</samlp:LogoutRequest>`;
    return Buffer.from(sign(xml, this.credential, 'LogoutRequest')).toString('base64');
  }
}
