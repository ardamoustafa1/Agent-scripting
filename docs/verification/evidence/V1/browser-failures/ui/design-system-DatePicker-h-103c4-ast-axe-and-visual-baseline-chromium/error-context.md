# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: design-system.spec.ts >> DatePicker / high-contrast: axe and visual baseline
- Location: e2e/design-system.spec.ts:88:5

# Error details

```
Error: expect(page).toHaveScreenshot(expected) failed

  26 pixels (ratio 0.01 of all image pixels) are different.

  Snapshot: DatePicker-high-contrast-open.png

Call log:
  - Expect "toHaveScreenshot(DatePicker-high-contrast-open.png)" with timeout 5000ms
    - verifying given screenshot expectation
  - taking page screenshot
    - disabled all CSS animations
  - waiting for fonts to load...
  - fonts loaded
  - 26 pixels (ratio 0.01 of all image pixels) are different.
  - waiting 100ms before taking screenshot
  - taking page screenshot
    - disabled all CSS animations
  - waiting for fonts to load...
  - fonts loaded
  - captured a stable screenshot
  - 26 pixels (ratio 0.01 of all image pixels) are different.

```

# Page snapshot

```yaml
- generic [ref=e3]:
  - main [ref=e4]:
    - generic [ref=e5]:
      - generic [ref=e6]:
        - heading "DatePicker" [level=1] [ref=e7]
        - paragraph [ref=e8]: Ekibinizi, yönlendirmeyi ve tercihlerinizi yönetin.
      - region "DatePicker" [ref=e9]:
        - generic [ref=e10]:
          - generic [ref=e11]: Tarih
          - button "Tarih" [expanded] [ref=e12] [cursor=pointer]:
            - generic [ref=e13]: 1 Eki 2026
  - dialog "Tarih" [ref=e17]:
    - generic [ref=e19]:
      - navigation "Navigation bar" [ref=e20]:
        - button "Önceki ay" [active] [ref=e21] [cursor=pointer]
        - button "Sonraki ay" [ref=e24] [cursor=pointer]
      - generic [ref=e27]:
        - status [ref=e29]: Ekim 2026
        - grid "Ekim 2026" [ref=e30]:
          - rowgroup [aria-hidden] [ref=e31]:
            - row [ref=e32]:
              - columnheader [ref=e33]: Pt
              - columnheader [ref=e34]: Sa
              - columnheader [ref=e35]: Ça
              - columnheader [ref=e36]: Pe
              - columnheader [ref=e37]: Cu
              - columnheader [ref=e38]: Ct
              - columnheader [ref=e39]: Pz
          - rowgroup [ref=e40]:
            - row [ref=e41]:
              - gridcell [selected] [ref=e42]:
                - button "1 Ekim 2026 Perşembe, selected" [ref=e43] [cursor=pointer]: "1"
              - gridcell [ref=e44]:
                - button "2 Ekim 2026 Cuma" [ref=e45] [cursor=pointer]: "2"
              - gridcell [ref=e46]:
                - button "3 Ekim 2026 Cumartesi" [ref=e47] [cursor=pointer]: "3"
              - gridcell [ref=e48]:
                - button "Today, 4 Ekim 2026 Pazar" [ref=e49] [cursor=pointer]: "4"
            - row [ref=e50]:
              - gridcell [ref=e51]:
                - button "5 Ekim 2026 Pazartesi" [ref=e52] [cursor=pointer]: "5"
              - gridcell [ref=e53]:
                - button "6 Ekim 2026 Salı" [ref=e54] [cursor=pointer]: "6"
              - gridcell [ref=e55]:
                - button "7 Ekim 2026 Çarşamba" [ref=e56] [cursor=pointer]: "7"
              - gridcell [ref=e57]:
                - button "8 Ekim 2026 Perşembe" [ref=e58] [cursor=pointer]: "8"
              - gridcell [ref=e59]:
                - button "9 Ekim 2026 Cuma" [ref=e60] [cursor=pointer]: "9"
              - gridcell [ref=e61]:
                - button "10 Ekim 2026 Cumartesi" [ref=e62] [cursor=pointer]: "10"
              - gridcell [ref=e63]:
                - button "11 Ekim 2026 Pazar" [ref=e64] [cursor=pointer]: "11"
            - row [ref=e65]:
              - gridcell [ref=e66]:
                - button "12 Ekim 2026 Pazartesi" [ref=e67] [cursor=pointer]: "12"
              - gridcell [ref=e68]:
                - button "13 Ekim 2026 Salı" [ref=e69] [cursor=pointer]: "13"
              - gridcell [ref=e70]:
                - button "14 Ekim 2026 Çarşamba" [ref=e71] [cursor=pointer]: "14"
              - gridcell [ref=e72]:
                - button "15 Ekim 2026 Perşembe" [ref=e73] [cursor=pointer]: "15"
              - gridcell [ref=e74]:
                - button "16 Ekim 2026 Cuma" [ref=e75] [cursor=pointer]: "16"
              - gridcell [ref=e76]:
                - button "17 Ekim 2026 Cumartesi" [ref=e77] [cursor=pointer]: "17"
              - gridcell [ref=e78]:
                - button "18 Ekim 2026 Pazar" [ref=e79] [cursor=pointer]: "18"
            - row [ref=e80]:
              - gridcell [ref=e81]:
                - button "19 Ekim 2026 Pazartesi" [ref=e82] [cursor=pointer]: "19"
              - gridcell [ref=e83]:
                - button "20 Ekim 2026 Salı" [ref=e84] [cursor=pointer]: "20"
              - gridcell [ref=e85]:
                - button "21 Ekim 2026 Çarşamba" [ref=e86] [cursor=pointer]: "21"
              - gridcell [ref=e87]:
                - button "22 Ekim 2026 Perşembe" [ref=e88] [cursor=pointer]: "22"
              - gridcell [ref=e89]:
                - button "23 Ekim 2026 Cuma" [ref=e90] [cursor=pointer]: "23"
              - gridcell [ref=e91]:
                - button "24 Ekim 2026 Cumartesi" [ref=e92] [cursor=pointer]: "24"
              - gridcell [ref=e93]:
                - button "25 Ekim 2026 Pazar" [ref=e94] [cursor=pointer]: "25"
            - row [ref=e95]:
              - gridcell [ref=e96]:
                - button "26 Ekim 2026 Pazartesi" [ref=e97] [cursor=pointer]: "26"
              - gridcell [ref=e98]:
                - button "27 Ekim 2026 Salı" [ref=e99] [cursor=pointer]: "27"
              - gridcell [ref=e100]:
                - button "28 Ekim 2026 Çarşamba" [ref=e101] [cursor=pointer]: "28"
              - gridcell [ref=e102]:
                - button "29 Ekim 2026 Perşembe" [ref=e103] [cursor=pointer]: "29"
              - gridcell [ref=e104]:
                - button "30 Ekim 2026 Cuma" [ref=e105] [cursor=pointer]: "30"
              - gridcell [ref=e106]:
                - button "31 Ekim 2026 Cumartesi" [ref=e107] [cursor=pointer]: "31"
```

# Test source

```ts
  12  |   'Checkbox',
  13  |   'Radio',
  14  |   'Switch',
  15  |   'Slider',
  16  |   'DatePicker',
  17  |   'TimePicker',
  18  |   'Tabs',
  19  |   'Accordion',
  20  |   'Dialog',
  21  |   'Drawer',
  22  |   'Sheet',
  23  |   'Popover',
  24  |   'Tooltip',
  25  |   'DropdownMenu',
  26  |   'ContextMenu',
  27  |   'Toast',
  28  |   'Alert',
  29  |   'Badge',
  30  |   'Avatar',
  31  |   'Skeleton',
  32  |   'Progress',
  33  |   'DataTable',
  34  |   'Tree',
  35  |   'Breadcrumb',
  36  |   'CommandPalette',
  37  |   'EmptyState',
  38  |   'Kbd',
  39  |   'SplitPane',
  40  |   'Toolbar',
  41  |   'BrandLogo',
  42  | ];
  43  | const themes = ['light', 'dark', 'high-contrast'] as const;
  44  | async function story(
  45  |   page: Page,
  46  |   component: string,
  47  |   theme = 'light',
  48  |   locale = 'tr',
  49  |   direction = 'ltr',
  50  | ) {
  51  |   await page.goto(
  52  |     `/iframe.html?id=ui-${component.toLowerCase()}--playground&viewMode=story&globals=theme:${theme};locale:${locale};direction:${direction}`,
  53  |   );
  54  |   await expect(page.locator('#ui-demo')).toBeVisible();
  55  |   await expect(page.locator('.vb-theme')).toHaveAttribute('data-theme', theme);
  56  |   await page.evaluate(async () => {
  57  |     await document.fonts.ready;
  58  |   });
  59  | }
  60  | async function noViolations(page: Page) {
  61  |   const report = await new AxeBuilder({ page })
  62  |     .include('#storybook-root')
  63  |     .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
  64  |     .analyze();
  65  |   expect(report.violations, JSON.stringify(report.violations, null, 2)).toEqual([]);
  66  | }
  67  | async function openInteractiveState(page: Page, component: string) {
  68  |   if (
  69  |     ['Dialog', 'Drawer', 'Sheet', 'Popover', 'DropdownMenu', 'CommandPalette', 'Toast'].includes(
  70  |       component,
  71  |     )
  72  |   )
  73  |     await page.getByTestId('story-trigger').click();
  74  |   else if (component === 'Tooltip') {
  75  |     await page.getByTestId('story-trigger').focus();
  76  |     await expect(page.getByRole('tooltip')).toBeVisible();
  77  |   } else if (['Combobox', 'MultiSelect', 'DatePicker'].includes(component))
  78  |     await page.locator('.vb-select-trigger').click();
  79  |   else if (component === 'Select') await page.getByRole('combobox').click();
  80  |   else if (component === 'ContextMenu') {
  81  |     await page.locator('.vb-context-trigger').focus();
  82  |     await page.keyboard.press('Shift+F10');
  83  |     await expect(page.getByRole('menu')).toBeVisible();
  84  |   } else if (component === 'Accordion') await page.locator('.vb-accordion-trigger').first().click();
  85  | }
  86  | for (const theme of themes) {
  87  |   for (const component of components) {
  88  |     test(`${component} / ${theme}: axe and visual baseline`, async ({ page }) => {
  89  |       await story(page, component, theme);
  90  |       await noViolations(page);
  91  |       await expect(page).toHaveScreenshot(`${component}-${theme}-closed.png`, { fullPage: true });
  92  |       await openInteractiveState(page, component);
  93  |       await noViolations(page);
  94  |       if (
  95  |         [
  96  |           'Dialog',
  97  |           'Drawer',
  98  |           'Sheet',
  99  |           'Popover',
  100 |           'DropdownMenu',
  101 |           'CommandPalette',
  102 |           'Toast',
  103 |           'Tooltip',
  104 |           'Combobox',
  105 |           'MultiSelect',
  106 |           'DatePicker',
  107 |           'Select',
  108 |           'ContextMenu',
  109 |           'Accordion',
  110 |         ].includes(component)
  111 |       )
> 112 |         await expect(page).toHaveScreenshot(`${component}-${theme}-open.png`, { fullPage: true });
      |                            ^ Error: expect(page).toHaveScreenshot(expected) failed
  113 |     });
  114 |   }
  115 |   test(`workspace / ${theme}`, async ({ page }) => {
  116 |     await page.goto(
  117 |       `/iframe.html?id=foundations-workspace--overview&viewMode=story&globals=theme:${theme};locale:tr;direction:ltr`,
  118 |     );
  119 |     await expect(page.locator('.vb-workspace-preview')).toBeVisible();
  120 |     await page.evaluate(async () => {
  121 |       await document.fonts.ready;
  122 |     });
  123 |     await noViolations(page);
  124 |     await expect(page).toHaveScreenshot(`workspace-${theme}.png`, { fullPage: true });
  125 |   });
  126 | }
  127 | for (const component of components) {
  128 |   test(`${component}: EN and RTL`, async ({ page }) => {
  129 |     await story(page, component, 'dark', 'en', 'rtl');
  130 |     await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  131 |     await expect(page.locator('.vb-theme')).toHaveAttribute('dir', 'rtl');
  132 |     await openInteractiveState(page, component);
  133 |     await noViolations(page);
  134 |     await expect(page).toHaveScreenshot(`${component}-en-rtl.png`, { fullPage: true });
  135 |   });
  136 | }
  137 | 
  138 | test('dialog traps focus, Escape closes and returns focus', async ({ page }) => {
  139 |   await story(page, 'Dialog');
  140 |   const trigger = page.getByTestId('story-trigger');
  141 |   await trigger.focus();
  142 |   await page.keyboard.press('Enter');
  143 |   const dialog = page.getByRole('dialog');
  144 |   await expect(dialog).toBeVisible();
  145 |   for (let index = 0; index < 8; index++) {
  146 |     await page.keyboard.press('Tab');
  147 |     expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  148 |   }
  149 |   await page.keyboard.press('Escape');
  150 |   await expect(dialog).not.toBeVisible();
  151 |   await expect(trigger).toBeFocused();
  152 | });
  153 | test('select is fully operated with keyboard', async ({ page }) => {
  154 |   await story(page, 'Select');
  155 |   const trigger = page.getByRole('combobox');
  156 |   await trigger.focus();
  157 |   await page.keyboard.press('Space');
  158 |   await expect(page.getByRole('listbox')).toBeVisible();
  159 |   await expect(page.getByRole('option', { name: 'Temsilci', exact: true })).toBeFocused();
  160 |   await page.keyboard.press('ArrowDown');
  161 |   await expect(page.getByRole('option', { name: 'Tasarımcı', exact: true })).toBeFocused();
  162 |   await page.keyboard.press('Enter');
  163 |   await expect(trigger).toContainText('Tasarımcı');
  164 |   await expect(trigger).toBeFocused();
  165 | });
  166 | test('combobox filters and selects with keyboard', async ({ page }) => {
  167 |   await story(page, 'Combobox');
  168 |   await page.locator('.vb-select-trigger').focus();
  169 |   await page.keyboard.press('Enter');
  170 |   await page.locator('[cmdk-input]').fill('Tasarımcı');
  171 |   await page.keyboard.press('Enter');
  172 |   await expect(page.locator('.vb-select-trigger')).toContainText('Tasarımcı');
  173 | });
  174 | test('tree roves, collapses and expands with arrow keys', async ({ page }) => {
  175 |   await story(page, 'Tree');
  176 |   await page.getByRole('treeitem', { name: 'Karşılama ekranı' }).focus();
  177 |   await page.keyboard.press('ArrowLeft');
  178 |   const parent = page.getByRole('treeitem', { name: 'Kampanyalar', exact: true });
  179 |   await expect(parent).toBeFocused();
  180 |   await page.keyboard.press('ArrowLeft');
  181 |   await expect(parent).toHaveAttribute('aria-expanded', 'false');
  182 |   await page.keyboard.press('ArrowRight');
  183 |   await expect(parent).toHaveAttribute('aria-expanded', 'true');
  184 | });
  185 | test('table virtualizes, sorts, filters and resizes by keyboard', async ({ page }) => {
  186 |   await story(page, 'DataTable');
  187 |   expect(await page.locator('.vb-table tbody tr').count()).toBeLessThan(80);
  188 |   const nameSort = page.getByRole('button', { name: 'Ad alanına göre sırala' });
  189 |   await nameSort.click();
  190 |   await expect(page.getByRole('columnheader').first()).toHaveAttribute('aria-sort', 'ascending');
  191 |   const resize = page.getByRole('slider', { name: 'Ad kolonunu boyutlandır' });
  192 |   await resize.focus();
  193 |   const before = Number(await resize.getAttribute('aria-valuenow'));
  194 |   await page.keyboard.press('ArrowRight');
  195 |   await expect(resize).toHaveAttribute('aria-valuenow', String(before + 16));
  196 |   await page.getByLabel('Kayıtları filtrele').fill('1000');
  197 |   await expect(page.locator('.vb-table tbody tr')).toHaveCount(1);
  198 |   await page.getByLabel('Kayıtları filtrele').clear();
  199 |   await page.getByRole('button', { name: 'Tüm satırları göster' }).click();
  200 |   await expect(page.locator('.vb-table tbody tr')).toHaveCount(1000);
  201 | });
  202 | test('command shortcut excludes inputs and restores focus', async ({ page }) => {
  203 |   await story(page, 'CommandPalette');
  204 |   await page.getByTestId('story-trigger').focus();
  205 |   await page.keyboard.press('Control+k');
  206 |   await expect(page.getByRole('dialog')).toBeVisible();
  207 |   await page.keyboard.press('Escape');
  208 |   await expect(page.getByRole('dialog')).not.toBeVisible();
  209 | });
  210 | test('reduced motion and high contrast preserve visible focus', async ({ page }) => {
  211 |   await story(page, 'Button', 'high-contrast');
  212 |   await page.getByRole('button', { name: 'Birincil' }).focus();
```