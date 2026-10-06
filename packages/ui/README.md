# Verbis UI

Token temelli kurumsal React 18 tasarım sistemi. Mevcut AppShell, SelectField, StatusBadge, THEMES/useTheme APIleri korunur. Yeni UiProvider birden fazla tenant/theme için bağımsız portal konteynerleri kullanır. Storybook 8.6.18 ve ona uyumlu Vite 6.4.3 yalnız bu pakette sabitlenmiştir; uygulamaların Vite sürümleri değişmez.

## Kullanım

```tsx
import { createI18n } from '@verbis/i18n';
import { UiProvider, Button, Input } from '@verbis/ui';
import '@verbis/ui/fonts.css';
import '@verbis/ui/tokens.css';

const i18n = await createI18n(); // TR varsayılan, EN desteklenir.

<UiProvider
  i18n={i18n}
  theme="dark"
  direction="ltr"
  brand={{ name: 'Verbis', primaryColor: '#20243d', logoUrl: '/assets/logo.svg' }}
>
  <Input label={i18n.t('ui.sample.name')} />
  <Button>{i18n.t('ui.sample.action')}</Button>
</UiProvider>;
```

Fontlar Fontsource üzerinden uygulamayla birlikte self-host edilir; CDN/Google Fonts isteği yoktur. fonts.css isteğe bağlıdır; tokens.css font fallbacklerini içerir. Logo HTTPS veya root-relative URL olmalıdır. Tenant renkleri altı haneli hex olmalıdır. accessibleBrand sRGB/WCAG relative luminance hesabıyla her tema yüzeyine karşı minimum 4.5:1 metin kontrastı sağlayana kadar rengi ayarlar, ardından siyah/beyaz foreground seçer. Focus ≥3:1; high-contrast kullanıcı temasında tenant rengi yerini yüksek kontrast paletine bırakır. Tenant branding kaydetme ve audit uygulama servisinin sorumluluğudur; provider yalnız render eder.

## Token sözleşmesi

CSS `--vb-*` ile `baseTokens`, `themeTokens` ve `token(name)` TS exportları aynı değerleri taşır. Nötr skala, marka/semantik soft yüzeyler, Inter Variable/JetBrains Mono, modüler tipografi, 4px spacing, radius, gölgeler, duration/easing ve z-index katmanları vardır. CSS/TS parity ve kontrast testleri token driftini yakalar. prefers-reduced-motion animasyon/geçişleri durdurur; forced-colors native sistem vurgusunu korur. Tema: system, light, dark, high-contrast. Layoutlar logical CSS properties kullanır; UiProvider direction Radix yönünü ve Tree/DataTable davranışını değiştirir.

## Bileşen APIleri

| Grup          | Exportlar                                                                                                                         |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Aksiyon       | Button (variant/size/loading/icons), IconButton (zorunlu label)                                                                   |
| Form          | Input, Textarea, Select, Combobox, MultiSelect, Checkbox, Radio, Switch, Slider, DatePicker, TimePicker                           |
| Açılır alan   | Tabs, Accordion, Dialog, Sheet / Drawer, Popover, Tooltip, DropdownMenu, ContextMenu, CommandPalette                              |
| Bildirim      | ToastProvider, Toast, ToastAction, Alert, Badge, Avatar, Skeleton, Progress                                                       |
| Veri / layout | DataTable, Tree, Breadcrumb, EmptyState, Kbd, SplitPane, Toolbar + ToolbarButton/Link/Separator/ToggleGroup/ToggleItem, BrandLogo |

Radix olmayan native input/textarea/time input semantik HTML kullanır. DatePicker Radix Popover + React DayPicker 9 ile klavye takvimini sağlar; takvim locale TR/EN, min/max ve yön desteğine sahiptir. Combobox Radix Popover + cmdk search/list keyboard davranışını kullanır. MultiSelect searchable checkbox panelidir: filtreleme mevcut seçimleri silmez; çoklu seçim ve checkbox durumu screen readera açıkça bildirilir. Select seçenekleri boş string value kullanmamalıdır (Radix placeholder ayrımı).

Dialog/Sheet title ve description zorunludur; Escape, focus trap ve focus return Radix üzerinden sağlanır. Popover label, Toolbar label, Tree label, IconButton label gibi erişilebilir isimler caller tarafından çevrilmiş verilmelidir. ContextMenu sağ tık yanında Shift+F10/ContextMenu/Enter/Space ile açılır. CommandPalette Cmd/Ctrl+K destekler, metin alanında yazılan kısayolu yutmaz; bir sayfada tek shortcut owner kullanın. Toastu ToastProvider içine yerleştirin; aksiyonun accessible altTextini ToastActiona verin.

DataTable TanStack Table 8 + Virtual 3 kullanır: stable getRowId zorunlu, global filtre, çoklu sıralama (Shift+click), mouse/touch/klavye kolon resize, ölçülen sanal satırlar ve sticky header sağlar. Resize ArrowLeft/Right =16px, Home=varsayılan. Her scroll region etiketlidir. Screen reader tüm dataset erişimi için “Tüm satırları göster” düğmesini kullanabilir; `virtualized={false}` doğrudan tüm satırları render eder. Editör/action içeren hücrelerde virtualization modunda görünür satırlar dışındaki tab durakları render edilmez; tüm satır modu bu kısıtı kaldırır. Table modeline gelen data arrayini immutable güncelleyin.

Tree ArrowUp/Down/Home/End, yön duyarlı ArrowLeft/Right, Enter/Space seçimi ve karakter type-ahead sağlar. Parent için double-click expand/collapse; stable, benzersiz id zorunlu. SplitPane resizable-panels 2 native separator keyboard davranışını kullanır. UI state değişimleri domain mutation/audit yerine geçmez; kayıt işlemlerini uygulama servisleri yapar.

## Storybook ve test komutları

Güncel doğrulama sonuçları `docs/verification/` raporlarında ve komut loglarında tutulur. Bu bölüm test komutlarını ve kabul yöntemini açıklar. Her bileşen için Playground, ayrıca Workspace ve erişilebilir Branding hikâyeleri bulunur. Toolbar theme/light-dark-high-contrast, TR/EN ve LTR/RTL değiştirir. a11y addon aktiftir, kurallar devre dışı bırakılmamıştır.

```sh
pnpm install --frozen-lockfile
pnpm --filter @verbis/i18n build
pnpm --filter @verbis/ui storybook
pnpm --filter @verbis/ui storybook:build

# Yalnız talep edildiğinde çalıştırılacak kontroller:
pnpm test:ui
pnpm test:ui --typecheck
pnpm --filter @verbis/ui exec playwright install chromium
pnpm test:ui --visual --update-snapshots  # İlk baseline; çıktıları insan incelemesiyle onayla.
pnpm test:ui --typecheck --visual        # Onaylı baselinea karşı zero-diff + axe.
```

Playwright tüm bileşen hikâyelerini üç temada, açık/kapalı overlay durumlarında; EN/RTL ve Workspace kompozisyonunu kontrol eder. WCAG A/AA/2.1/2.2 axe violations dizisinin boş olması zorunlu; screenshot tolerance sıfırdır. Ayrıca focus trap/return, klavye select/search/tree, tablo sort/filter/resize/virtualization ve reduced motion testleri vardır. Görsel referanslar sürümlenir; tasarım değişikliklerinde axe/klavye kontrolleri ve görsel inceleme sonrası güncellenir, ardından normal kıyas çalıştırılır. Test commandı install/prepare sırasında otomatik tetiklenmez.

Kaynaklar: [Radix Primitives](https://www.radix-ui.com/primitives/docs/overview/introduction), [Storybook 8 a11y](https://storybook.js.org/docs/8/writing-tests/accessibility-testing), [TanStack Table 8 column sizing](https://tanstack.com/table/v8/docs/guide/column-sizing), [DayPicker](https://daypicker.dev/docs/styling).

## Ortak ürün kimliği

`AccessLayout({ appName, children })` Designer/Admin/Agent için aynı Script Atlas giriş kompozisyonunu sunar. Uygulama kimlik doğrulama işlemlerini ve form stateini yönetir; layout yalnız marka, dil ve hareket kontrolünü üstlenir. `ScriptAtlas({ paused })` kendi gradient kimliklerini üretir, WebGL gerektirmez. Çeviriler `common.access` altındadır.

`vb-brand-surface` marka alanlarını theme-aware `brand-bg/text/muted/border/accent` tokenlarına bağlar. Açık ve koyu uygulamalarda lacivert marka alanı, buz mavisi vurgu, okunabilir nötr yüzeyler ve 8px kontrol köşeleri kullanılır. High-contrast temada marka tokenları siyah/beyaz/sarıdır; tenant aksiyon renkleri UiProvider kontrast denetimine tabi olmaya devam eder. Bu sınıf yalnız marka alanında kullanılmalı; ana içerik/portal yüzeyleri kendi theme ve tenant renklerini korur.
