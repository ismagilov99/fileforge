import { expect, test, type Download } from '@playwright/test';
import JSZip from 'jszip';
import { readFile } from 'node:fs/promises';

const utf8 = (value: string) => Buffer.from(value, 'utf8');

async function downloadedText(download: Download): Promise<string> {
  const path = await download.path();
  if (!path) throw new Error('Браузер не сохранил временный файл скачивания.');
  return readFile(path, 'utf8');
}

test.describe('FileForge user journeys', () => {
  test('exports exact TXT bytes and supports a dotted custom filename', async ({ page }) => {
    await page.goto('/');
    const source = 'Привет.\n\n<script>alert("x")</script>\n  trailing spaces  ';
    await page.getByRole('tab', { name: 'Текст в файл' }).click();
    await page.locator('#textInput').fill(source);
    await page.locator('#panel-text').getByLabel('Имя файла').fill('report.v2');
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Скачать TXT' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('report.v2.txt');
    expect(await downloadedText(download)).toBe(source);
  });

  test('uses the exact automatic name shown in the preview', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('tab', { name: 'Текст в файл' }).click();
    await page.locator('#textInput').fill('preview name consistency');
    const preview = page.locator('#textOutputPreview');
    const suggested = (await preview.textContent())?.replace(/^Автоматическое имя: /, '').trim();
    expect(suggested).toMatch(/^fileforge-text-\d{8}-\d{6}-\d{3}\.txt$/);
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Скачать TXT' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(suggested);
  });

  test('refreshes automatic filename preview when the output format changes', async ({ page }) => {
    await page.goto('/');
    const preview = page.locator('#textOutputPreview');
    await page.getByRole('tab', { name: 'Текст в файл' }).click();
    await expect(preview).toContainText('.txt');
    await page.locator('#panel-text').getByLabel('Формат').selectOption('json');
    await expect(preview).toContainText('.json');
    await page.locator('#panel-text').getByLabel('Формат').selectOption('md');
    await expect(preview).toContainText('.md');
  });

  test('exports HTML with user text escaped and no FileForge/date metadata', async ({ page }) => {
    await page.goto('/');
    const source = '<script>alert("not executable")</script>';
    await page.getByRole('tab', { name: 'Текст в файл' }).click();
    await page.locator('#textInput').fill(source);
    await page.locator('#panel-text').getByLabel('Формат').selectOption('html');
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Скачать HTML' }).click();
    const content = await downloadedText(await downloadPromise);
    expect(content).toContain('&lt;script&gt;');
    expect(content).not.toContain('<script>');
    expect(content).not.toMatch(/Создано в FileForge|202\d-\d\d-\d\dT/);
  });

  test('warns about spreadsheet formula evaluation without silently changing CSV data', async ({ page }) => {
    await page.goto('/');
    const source = '=HYPERLINK("https://example.invalid","open")';
    await page.getByRole('tab', { name: 'Текст в файл' }).click();
    await page.locator('#textInput').fill(source);
    await page.locator('#panel-text').getByLabel('Формат').selectOption('csv');
    await expect(page.locator('#textOutputPreview')).toContainText('.csv');
    await expect(page.locator('#textFormatHint')).toContainText('могут интерпретировать значения');
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Скачать CSV' }).click();
    const output = await downloadedText(await downloadPromise);
    expect(output).toBe(`"${source.replace(/"/g, '""')}"`);
  });

  test('merges two text files in deterministic order through a worker', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('tab', { name: 'Объединение' }).click();
    await page.locator('#mergeFiles').setInputFiles([
      { name: 'first.txt', mimeType: 'text/plain', buffer: utf8('FIRST') },
      { name: 'second.txt', mimeType: 'text/plain', buffer: utf8('SECOND') },
    ]);
    await expect(page.locator('#mergeStats')).toContainText('2 текстовых файлов');
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Объединить и скачать' }).click();
    const output = await downloadedText(await downloadPromise);
    expect(output).toBe('FIRST\n\nSECOND');
  });

  test('imports DEFLATE ZIP entries in a worker and merges their text', async ({ page }) => {
    const supportsRawDeflate = await page.evaluate(() => {
      try {
        return typeof DecompressionStream !== 'undefined' && Boolean(new DecompressionStream('deflate-raw'));
      } catch {
        return false;
      }
    });
    test.skip(!supportsRawDeflate, 'This browser does not support DecompressionStream(deflate-raw).');
    const zip = new JSZip();
    zip.file('folder/from-zip.txt', 'FROM ZIP');
    const archive = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });
    await page.goto('/');
    await page.getByRole('tab', { name: 'Объединение' }).click();
    await page
      .locator('#mergeFiles')
      .setInputFiles({ name: 'source.zip', mimeType: 'application/zip', buffer: archive });
    await expect(page.locator('#mergeStats')).toContainText('1 текстовых файлов', { timeout: 15_000 });
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Объединить и скачать' }).click();
    expect(await downloadedText(await downloadPromise)).toBe('FROM ZIP');
  });

  test('creates a ZIP containing selected files and an explicit empty folder', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('tab', { name: 'Архиватор' }).click();
    await page
      .locator('#archiveFiles')
      .setInputFiles([{ name: 'note.txt', mimeType: 'text/plain', buffer: utf8('ARCHIVE BODY') }]);
    await page.locator('#folderName').fill('Empty folder');
    await page.getByRole('button', { name: 'Добавить папку' }).click();
    await page.locator('#archiveOutputName').fill('backup.v3');
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Создать и скачать ZIP' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('backup.v3.zip');
    const path = await download.path();
    if (!path) throw new Error('Не получен путь скачанного ZIP.');
    const zip = await JSZip.loadAsync(await readFile(path));
    expect(await zip.file('note.txt')?.async('string')).toBe('ARCHIVE BODY');
    expect(zip.files['Empty folder/']?.dir).toBe(true);
  });

  test('converts a valid PNG in a dedicated worker and returns a real PNG inside ZIP', async ({ page }) => {
    const supportsWorkerCanvas = await page.evaluate(() => {
      try {
        return (
          typeof Worker !== 'undefined' &&
          typeof createImageBitmap === 'function' &&
          typeof OffscreenCanvas !== 'undefined' &&
          typeof OffscreenCanvas.prototype.convertToBlob === 'function'
        );
      } catch {
        return false;
      }
    });
    test.skip(!supportsWorkerCanvas, 'This browser does not expose the required image worker APIs.');
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP4z8DwHwAFAAH/VscvDQAAAABJRU5ErkJggg==',
      'base64',
    );
    await page.goto('/');
    await page
      .locator('#imageFiles')
      .setInputFiles({ name: 'pixel.png', mimeType: 'image/png', buffer: png });
    await expect(page.locator('#imageCount')).toContainText('1 файлов');
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Конвертировать и скачать ZIP' }).click();
    const path = await (await downloadPromise).path();
    if (!path) throw new Error('Не получен путь скачанного ZIP.');
    const zip = await JSZip.loadAsync(await readFile(path));
    const output = await zip.file('pixel.png')?.async('nodebuffer');
    expect(output).toBeTruthy();
    expect(Buffer.from(output!).subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
  });

  test('keeps the layout within narrow viewports without horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto('/');
    const dimensions = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      content: document.documentElement.scrollWidth,
    }));
    expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport + 1);
  });

  test('cancels a pending text worker without creating a download', async ({ page }) => {
    await page.addInitScript(() => {
      class DeferredWorker extends EventTarget {
        postMessage(_message: unknown): void {
          /* Intentionally remains pending until terminated. */
        }
        terminate(): void {
          /* WorkerClient owns cancellation and cleanup. */
        }
      }
      Object.defineProperty(window, 'Worker', { configurable: true, writable: true, value: DeferredWorker });
    });
    await page.goto('/');
    await page.getByRole('tab', { name: 'Текст в файл' }).click();
    await page.locator('#textInput').fill('cancel me');
    await page.getByRole('button', { name: 'Скачать TXT' }).click();
    await expect(page.locator('#textCancel')).toBeVisible();
    await page.locator('#textCancel').click();
    await expect(page.locator('#toastRegion')).toContainText('Создание файла отменено.');
    await expect(page.locator('#globalTaskStatus')).toBeHidden();
    await expect(page.locator('#downloadFallbacks')).toBeEmpty();
  });

  test('offers a manual download link after creating an output', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('tab', { name: 'Текст в файл' }).click();
    await page.locator('#textInput').fill('download link check');
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Скачать TXT' }).click();
    await downloadPromise;
    await expect(page.locator('#downloadFallbacks')).toContainText('Скачать fileforge-text-');
  });
});
