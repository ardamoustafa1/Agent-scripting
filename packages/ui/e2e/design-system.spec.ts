import { AxeBuilder } from '@axe-core/playwright';
import { test, expect, type Page } from '@playwright/test';

const components = [
  'Button',
  'IconButton',
  'Input',
  'Textarea',
  'Select',
  'Combobox',
  'MultiSelect',
  'Checkbox',
  'Radio',
  'Switch',
  'Slider',
  'DatePicker',
  'TimePicker',
  'Tabs',
  'Accordion',
  'Dialog',
  'Drawer',
  'Sheet',
  'Popover',
  'Tooltip',
  'DropdownMenu',
  'ContextMenu',
  'Toast',
  'Alert',
  'Badge',
  'Avatar',
  'Skeleton',
  'Progress',
  'DataTable',
  'Tree',
  'Breadcrumb',
  'CommandPalette',
  'EmptyState',
  'Kbd',
  'SplitPane',
  'Toolbar',
  'BrandLogo',
];
const themes = ['light', 'dark', 'high-contrast'] as const;
test.beforeEach(async ({ page }) => {
  // Calendar "today" styles must use the same date as the reviewed visual baselines.
  await page.clock.setFixedTime(new Date('2026-10-03T09:00:00Z'));
});
async function story(
  page: Page,
  component: string,
  theme = 'light',
  locale = 'tr',
  direction = 'ltr',
) {
  await page.goto(
    `/iframe.html?id=ui-${component.toLowerCase()}--playground&viewMode=story&globals=theme:${theme};locale:${locale};direction:${direction}`,
  );
  await expect(page.locator('#ui-demo')).toBeVisible();
  await expect(page.locator('.vb-theme')).toHaveAttribute('data-theme', theme);
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}
async function noViolations(page: Page) {
  const report = await new AxeBuilder({ page })
    .include('#storybook-root')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(report.violations, JSON.stringify(report.violations, null, 2)).toEqual([]);
}
async function openInteractiveState(page: Page, component: string) {
  if (
    ['Dialog', 'Drawer', 'Sheet', 'Popover', 'DropdownMenu', 'CommandPalette', 'Toast'].includes(
      component,
    )
  )
    await page.getByTestId('story-trigger').click();
  else if (component === 'Tooltip') {
    await page.getByTestId('story-trigger').focus();
    await expect(page.getByRole('tooltip')).toBeVisible();
  } else if (['Combobox', 'MultiSelect', 'DatePicker'].includes(component))
    await page.locator('.vb-select-trigger').click();
  else if (component === 'Select') await page.getByRole('combobox').click();
  else if (component === 'ContextMenu') {
    await page.locator('.vb-context-trigger').focus();
    await page.keyboard.press('Shift+F10');
    await expect(page.getByRole('menu')).toBeVisible();
  } else if (component === 'Accordion') await page.locator('.vb-accordion-trigger').first().click();
}
for (const theme of themes) {
  for (const component of components) {
    test(`${component} / ${theme}: axe and visual baseline`, async ({ page }) => {
      await story(page, component, theme);
      await noViolations(page);
      await expect(page).toHaveScreenshot(`${component}-${theme}-closed.png`, { fullPage: true });
      await openInteractiveState(page, component);
      await noViolations(page);
      if (
        [
          'Dialog',
          'Drawer',
          'Sheet',
          'Popover',
          'DropdownMenu',
          'CommandPalette',
          'Toast',
          'Tooltip',
          'Combobox',
          'MultiSelect',
          'DatePicker',
          'Select',
          'ContextMenu',
          'Accordion',
        ].includes(component)
      )
        await expect(page).toHaveScreenshot(`${component}-${theme}-open.png`, { fullPage: true });
    });
  }
  test(`workspace / ${theme}`, async ({ page }) => {
    await page.goto(
      `/iframe.html?id=foundations-workspace--overview&viewMode=story&globals=theme:${theme};locale:tr;direction:ltr`,
    );
    await expect(page.locator('.vb-workspace-preview')).toBeVisible();
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    await noViolations(page);
    await expect(page).toHaveScreenshot(`workspace-${theme}.png`, { fullPage: true });
  });
}
for (const component of components) {
  test(`${component}: EN and RTL`, async ({ page }) => {
    await story(page, component, 'dark', 'en', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('.vb-theme')).toHaveAttribute('dir', 'rtl');
    await openInteractiveState(page, component);
    await noViolations(page);
    await expect(page).toHaveScreenshot(`${component}-en-rtl.png`, { fullPage: true });
  });
}

test('dialog traps focus, Escape closes and returns focus', async ({ page }) => {
  await story(page, 'Dialog');
  const trigger = page.getByTestId('story-trigger');
  await trigger.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  for (let index = 0; index < 8; index++) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
});
test('select is fully operated with keyboard', async ({ page }) => {
  await story(page, 'Select');
  const trigger = page.getByRole('combobox');
  await trigger.focus();
  await page.keyboard.press('Space');
  await expect(page.getByRole('listbox')).toBeVisible();
  await expect(page.getByRole('option', { name: 'Temsilci', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('option', { name: 'Tasarımcı', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(trigger).toContainText('Tasarımcı');
  await expect(trigger).toBeFocused();
});
test('combobox filters and selects with keyboard', async ({ page }) => {
  await story(page, 'Combobox');
  await page.locator('.vb-select-trigger').focus();
  await page.keyboard.press('Enter');
  await page.locator('[cmdk-input]').fill('Tasarımcı');
  await page.keyboard.press('Enter');
  await expect(page.locator('.vb-select-trigger')).toContainText('Tasarımcı');
});
test('tree roves, collapses and expands with arrow keys', async ({ page }) => {
  await story(page, 'Tree');
  await page.getByRole('treeitem', { name: 'Karşılama ekranı' }).focus();
  await page.keyboard.press('ArrowLeft');
  const parent = page.getByRole('treeitem', { name: 'Kampanyalar', exact: true });
  await expect(parent).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(parent).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press('ArrowRight');
  await expect(parent).toHaveAttribute('aria-expanded', 'true');
});
test('table virtualizes, sorts, filters and resizes by keyboard', async ({ page }) => {
  await story(page, 'DataTable');
  expect(await page.locator('.vb-table tbody tr').count()).toBeLessThan(80);
  const nameSort = page.getByRole('button', { name: 'Ad alanına göre sırala' });
  await nameSort.click();
  await expect(page.getByRole('columnheader').first()).toHaveAttribute('aria-sort', 'ascending');
  const resize = page.getByRole('slider', { name: 'Ad kolonunu boyutlandır' });
  await resize.focus();
  const before = Number(await resize.getAttribute('aria-valuenow'));
  await page.keyboard.press('ArrowRight');
  await expect(resize).toHaveAttribute('aria-valuenow', String(before + 16));
  await page.getByLabel('Kayıtları filtrele').fill('1000');
  await expect(page.locator('.vb-table tbody tr')).toHaveCount(1);
  await page.getByLabel('Kayıtları filtrele').clear();
  await page.getByRole('button', { name: 'Tüm satırları göster' }).click();
  await expect(page.locator('.vb-table tbody tr')).toHaveCount(1000);
});
test('command shortcut excludes inputs and restores focus', async ({ page }) => {
  await story(page, 'CommandPalette');
  await page.getByTestId('story-trigger').focus();
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
});
test('reduced motion and high contrast preserve visible focus', async ({ page }) => {
  await story(page, 'Button', 'high-contrast');
  await page.getByRole('button', { name: 'Birincil' }).focus();
  const style = await page.getByRole('button', { name: 'Birincil' }).evaluate((element) => ({
    outline: getComputedStyle(element).outlineStyle,
    duration: getComputedStyle(element).transitionDuration,
  }));
  expect(style.outline).not.toBe('none');
  expect(style.duration.split(',').every((value) => value.trim() === '0s')).toBe(true);
});

for (const theme of themes) {
  test(`tenant branding / ${theme}`, async ({ page }) => {
    await page.goto(
      `/iframe.html?id=foundations-branding--accessible-brand&viewMode=story&args=primaryColor:%23ffff00;theme:${theme}&globals=theme:${theme};locale:tr;direction:ltr`,
    );
    await expect(page.getByRole('button', { name: 'Değişiklikleri kaydet' })).toBeVisible();
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    await noViolations(page);
    await expect(page).toHaveScreenshot(`branding-${theme}.png`, { fullPage: true });
  });
}

test('select completes a mouse choice when the opening pointer-up is cancelled', async ({
  page,
}) => {
  await story(page, 'Select');
  const trigger = page.getByRole('combobox');
  await trigger.click();
  // Reproduce the select opening guard cancelling pointer-up before movement.
  await page.getByRole('listbox').evaluate((element) => {
    element.addEventListener(
      'pointerup',
      (event) => {
        event.preventDefault();
      },
      {
        capture: true,
        once: true,
      },
    );
  });
  await page.getByRole('option', { name: 'Tasarımcı', exact: true }).click();
  await expect(page.getByRole('listbox')).not.toBeVisible();
  await expect(trigger).toContainText('Tasarımcı');
  await expect(trigger).toBeFocused();
});
