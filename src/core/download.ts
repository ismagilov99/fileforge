import { isWellFormedUnicode } from './file-names';

interface DownloadRecord {
  url: string;
  timer: number;
  element: HTMLElement;
}

const downloads = new Set<DownloadRecord>();
const MAX_VISIBLE_DOWNLOADS = 3;
const URL_LIFETIME_MS = 5 * 60 * 1000;

function removeDownload(record: DownloadRecord): void {
  window.clearTimeout(record.timer);
  record.element.remove();
  URL.revokeObjectURL(record.url);
  downloads.delete(record);
}

/**
 * Starts a browser download and leaves a visible user-activated fallback link.
 * This is useful on mobile browsers that defer or suppress synthetic downloads.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  // Empty text files are valid outputs; only the Blob identity and safe basename are required.
  if (!(blob instanceof Blob)) throw new Error('Результат не является корректным файлом.');
  if (
    typeof filename !== 'string' ||
    filename.length < 1 ||
    filename.length > 255 ||
    !isWellFormedUnicode(filename) ||
    filename.normalize('NFC') !== filename ||
    /[\\/\u0000-\u001f\u007f\u0080-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/.test(filename) ||
    /[. ]$/.test(filename) ||
    filename === '.' ||
    filename === '..'
  ) {
    throw new Error('Имя результата не прошло проверку безопасности. Файл не скачан.');
  }
  const url = URL.createObjectURL(blob);
  const region = document.getElementById('downloadFallbacks');
  const card = document.createElement('div');
  card.className = 'download-fallback';

  const description = document.createElement('span');
  description.textContent = 'Если скачивание не началось автоматически:';
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  link.textContent = `Скачать ${filename}`;
  link.setAttribute('aria-label', `Скачать файл ${filename}`);
  card.append(description, link);

  const hiddenTrigger = document.createElement('a');
  hiddenTrigger.href = url;
  hiddenTrigger.download = filename;
  hiddenTrigger.rel = 'noopener';
  hiddenTrigger.hidden = true;
  document.body.append(hiddenTrigger);
  try {
    hiddenTrigger.click();
  } catch {
    // A visible link below remains available when a browser blocks a scripted click.
  } finally {
    hiddenTrigger.remove();
  }

  if (region) {
    while (downloads.size >= MAX_VISIBLE_DOWNLOADS) {
      const oldest = downloads.values().next().value as DownloadRecord | undefined;
      if (!oldest) break;
      removeDownload(oldest);
    }
    region.prepend(card);
  }

  const record: DownloadRecord = {
    url,
    element: card,
    timer: window.setTimeout(() => removeDownload(record), URL_LIFETIME_MS),
  };
  downloads.add(record);
}

export function revokeDownloads(): void {
  for (const record of Array.from(downloads)) removeDownload(record);
}
