import { Direction, Tooltip as RadixTooltip } from 'radix-ui';
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { I18nextProvider } from 'react-i18next';

import { type I18nInstance } from '@verbis/i18n';

import { accessibleBrand, validateLogoUrl, type TenantBrand } from './brand.js';
import { type Theme } from './theme.js';

const PortalContext = createContext<HTMLElement | null>(null);
export const usePortalContainer = (): HTMLElement | null => useContext(PortalContext);
export interface UiProviderProps {
  readonly children: ReactNode;
  readonly i18n: I18nInstance;
  readonly theme?: Theme;
  readonly direction?: 'ltr' | 'rtl';
  readonly brand?: TenantBrand;
}
/** Each provider owns its theme AND portal surface; multiple tenants may coexist safely. */
export function UiProvider({
  children,
  i18n,
  theme = 'system',
  direction = 'ltr',
  brand,
}: UiProviderProps) {
  const surface = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = surface.current;
    if (!root) return;
    const owned = new Set<HTMLElement>();
    const synchronize = (element: HTMLElement) => {
      if (element.getAttribute('aria-hidden') === 'true') {
        if (
          !element.inert &&
          (element.matches('button,input,select,textarea,a[href],[tabindex]') ||
            element.querySelector('button,input,select,textarea,a[href],[tabindex]'))
        ) {
          element.inert = true;
          owned.add(element);
        }
      } else if (owned.delete(element)) {
        element.inert = false;
      }
    };
    // Radix hides background content from assistive technology. Native inert also removes
    // its controls from keyboard navigation while the modal portal owns focus.
    const observer = new MutationObserver((changes) => {
      for (const change of changes)
        if (change.target instanceof HTMLElement) synchronize(change.target);
    });
    observer.observe(root, { subtree: true, attributes: true, attributeFilter: ['aria-hidden'] });
    for (const element of root.querySelectorAll<HTMLElement>('[aria-hidden="true"]'))
      synchronize(element);
    return () => {
      observer.disconnect();
      for (const element of owned) element.inert = false;
    };
  }, []);
  const [portal, setPortal] = useState<HTMLDivElement | null>(null);
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const change = () => {
      setDark(query.matches);
    };
    change();
    query.addEventListener('change', change);
    return () => {
      query.removeEventListener('change', change);
    };
  }, []);
  const colors =
    brand === undefined
      ? undefined
      : accessibleBrand(brand.primaryColor, theme === 'system' ? (dark ? 'dark' : 'light') : theme);
  const style =
    colors === undefined
      ? undefined
      : ({
          '--vb-color-primary': colors.primary,
          '--vb-color-primary-contrast': colors.foreground,
          '--vb-color-focus': colors.focus,
        } as CSSProperties);
  return (
    <I18nextProvider i18n={i18n}>
      <Direction.Provider dir={direction}>
        <PortalContext.Provider value={portal}>
          <RadixTooltip.Provider delayDuration={350}>
            <div
              ref={surface}
              className="vb-theme"
              data-theme={theme}
              dir={direction}
              style={style}
            >
              {children}
              <div ref={setPortal} data-vb-portals="" />
            </div>
          </RadixTooltip.Provider>
        </PortalContext.Provider>
      </Direction.Provider>
    </I18nextProvider>
  );
}
export function BrandLogo({ brand }: { readonly brand: TenantBrand }) {
  return brand.logoUrl === undefined ? (
    <span className="vb-brand-name">{brand.name}</span>
  ) : (
    <img className="vb-brand-logo" src={validateLogoUrl(brand.logoUrl)} alt={brand.name} />
  );
}
