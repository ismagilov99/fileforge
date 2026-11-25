import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('main view has no automatically detectable serious accessibility violations', async ({ page }) => {
  await page.goto('/');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter((violation) =>
    ['critical', 'serious'].includes(violation.impact ?? ''),
  );
  expect(serious, serious.map((item) => `${item.id}: ${item.help}`).join('\n')).toEqual([]);
});

test('tabs work with keyboard arrow navigation', async ({ page }) => {
  await page.goto('/');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const imagesTab = page.getByRole('tab', { name: 'Изображения' });
  await imagesTab.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Текст в файл' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel', { name: /Текст в файл/ })).toBeVisible();
});

test('all feature panels have no automatically detectable serious accessibility violations', async ({
  page,
}) => {
  await page.goto('/');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const tabs = ['Изображения', 'Текст в файл', 'Архиватор', 'Объединение'];
  for (const name of tabs) {
    await page.getByRole('tab', { name }).click();
    const results = await new AxeBuilder({ page }).analyze();
    const serious = results.violations.filter((violation) =>
      ['critical', 'serious'].includes(violation.impact ?? ''),
    );
    expect(serious, `${name}: ${serious.map((item) => `${item.id}: ${item.help}`).join('\n')}`).toEqual([]);
  }
});

test('refuses to initialize inside a framed page', async ({ page }) => {
  await page.route('**/frame-probe.html', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: '<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Frame probe</title></head><body><iframe title="embedded FileForge" src="/"></iframe></body></html>',
    }),
  );
  await page.goto('/frame-probe.html');
  const embeddedApp = page.frameLocator('iframe').locator('#app');
  await expect(embeddedApp).toContainText('нельзя открыть внутри встроенного окна');
});
