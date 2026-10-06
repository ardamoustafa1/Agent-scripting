import i18next, { type i18n as I18nInstance } from 'i18next';
import { initReactI18next } from 'react-i18next';

import { en } from './locales/en.js';
import { tr } from './locales/tr.js';

export const SUPPORTED_LOCALES = ['tr', 'en'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: SupportedLocale = 'tr';

export const resources = {
  tr: { translation: tr },
  en: { translation: en },
} as const;

export function isSupportedLocale(value: string): value is SupportedLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/** Picks the first supported locale from a preference list (e.g. navigator.languages). */
export function negotiateLocale(preferences: readonly string[]): SupportedLocale {
  for (const preference of preferences) {
    const base = preference.toLowerCase().split('-')[0] ?? '';
    if (isSupportedLocale(base)) return base;
  }
  return DEFAULT_LOCALE;
}

/** Flattens a nested catalog to dotted keys, e.g. "common.theme.label". */
export function flattenKeys(catalog: object, prefix = ''): string[] {
  return Object.entries(catalog).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === 'object' && value !== null
      ? flattenKeys(value as object, path)
      : [path];
  });
}

/** Creates an isolated i18next instance wired to react-i18next. */
export type { I18nInstance };

export async function createI18n(locale: SupportedLocale = DEFAULT_LOCALE): Promise<I18nInstance> {
  const instance = i18next.createInstance();
  await instance.use(initReactI18next).init({
    resources,
    lng: locale,
    fallbackLng: DEFAULT_LOCALE,
    supportedLngs: [...SUPPORTED_LOCALES],
    interpolation: { escapeValue: false }, // React escapes output.
    returnNull: false,
  });
  return instance;
}
