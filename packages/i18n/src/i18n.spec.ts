import { describe, expect, it } from 'vitest';

import { createI18n, flattenKeys, negotiateLocale, resources } from './i18n.js';

describe('catalogs', () => {
  it('translates every lowercase script lifecycle state returned by the API', async () => {
    for (const locale of ['tr', 'en'] as const) {
      const i18n = await createI18n(locale);
      for (const state of ['draft', 'in_review', 'approved', 'published', 'retired']) {
        const key = `designer.workspace.status.${state}`;
        expect(i18n.t(key)).not.toBe(key);
      }
    }
  });
  it('provides concise role descriptions and translated SIEM format headers', async () => {
    const i18n = await createI18n('en');
    expect(i18n.t('adminWorkspace.description')).toBe('Description');
    expect(i18n.t('adminWorkspace.format')).toBe('Format');
    await i18n.changeLanguage('tr');
    expect(i18n.t('adminWorkspace.description')).toBe('Açıklama');
    expect(i18n.t('adminWorkspace.format')).toBe('Biçim');
  });
  it('tr and en define exactly the same keys (CLAUDE.md rule 5)', () => {
    expect(flattenKeys(resources.tr.translation).sort()).toEqual(
      flattenKeys(resources.en.translation).sort(),
    );
  });

  // T-03: key parity alone missed ~20 Turkish values left in English. Identical tr/en values are
  // allowed only for product/vendor names, acronyms, symbols and words that are the same in Turkish.
  it('translates every Turkish value that is not a name, acronym or symbol', () => {
    const allowed = new Set([
      ...[
        'Verbis',
        'Verbis Studio',
        'VERBIS STUDIO',
        'VERBIS / INSIGHTS',
        'V',
        'English',
        'Türkçe',
      ],
      ...['Amazon Connect', 'Avaya AACC', 'Avaya AES', 'Avaya Aura (AES)', 'Cisco', 'Five9'],
      ...['Avaya Aura Contact Center', 'Avaya Experience Platform', 'Genesys Cloud'],
      ...['Genesys Engage', 'NICE CXone', 'Kafka', 'Syslog', 'Syslog (RFC 5424)', 'Webhook'],
      ...['WhatsApp', 'SMS', 'Video', 'OIDC', 'SAML', 'CEF', 'JSON', 'PII', 'VDN', 'Platform API'],
      ...['Connector', 'Script', 'Platform', 'Port', 'Test', 'Tablet · 768', '01 — 03'],
      ...['Alt + ←', 'Ctrl + /', 'Enter', 'K', 'ms', 'p', 's', '×', '→', '⇧', '⌘', '⌘K'],
      ...['⌘ / Ctrl K', 'v{{number}}', '{{current}} / {{total}}', '{{key}}@{{version}}'],
      ...['{{name}}', '{{name}} · v{{version}}', '{{value}} ms ·'],
    ]);
    const read = (tree: unknown, key: string) =>
      key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], tree);
    const untranslated = flattenKeys(resources.tr.translation).filter((key) => {
      const value = read(resources.tr.translation, key);
      return value === read(resources.en.translation, key) && !allowed.has(String(value));
    });
    expect(untranslated).toEqual([]);
  });

  it('has no empty translations', () => {
    for (const { translation } of Object.values(resources)) {
      const values = JSON.stringify(translation);
      expect(values).not.toContain('""');
    }
  });
});

describe('negotiateLocale', () => {
  it('picks the first supported base language', () => {
    expect(negotiateLocale(['de-DE', 'en-US', 'tr'])).toBe('en');
    expect(negotiateLocale(['TR-tr'])).toBe('tr');
  });

  it('falls back to Turkish', () => {
    expect(negotiateLocale([])).toBe('tr');
    expect(negotiateLocale(['fr'])).toBe('tr');
  });
});

describe('createI18n', () => {
  it('translates in the requested locale and falls back', async () => {
    const i18n = await createI18n('en');
    expect(i18n.t('common.theme.label')).toBe('Theme');
    await i18n.changeLanguage('tr');
    expect(i18n.t('common.theme.label')).toBe('Tema');
  });

  it('defaults to Turkish', async () => {
    const i18n = await createI18n();
    expect(i18n.language).toBe('tr');
  });
});
