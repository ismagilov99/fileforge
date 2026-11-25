import { automaticBase, normalizeOutputFilename } from '../core/file-names';
import { formatBytes } from '../core/validation';
import type { OperationKind } from './state';

export const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Не найден элемент интерфейса: ${id}`);
  return element as T;
};

export function toast(message: string, type: 'success' | 'warning' | 'error' | 'info' = 'info'): void {
  const region = $('toastRegion');
  while (region.childElementCount >= 4) region.firstElementChild?.remove();
  const node = document.createElement('div');
  node.className = `toast toast-${type}`;
  node.setAttribute('role', type === 'error' ? 'alert' : 'status');
  node.textContent = message;
  region.append(node);
  window.setTimeout(() => node.remove(), 6500);
}

export function setProgress(prefix: string, percent: number, label: string, detail = ''): void {
  const bounded = Math.min(100, Math.max(0, percent));
  $(`${prefix}Progress`).hidden = false;
  $(`${prefix}ProgressBar`).style.width = `${bounded}%`;
  $(`${prefix}ProgressValue`).textContent = `${Math.round(bounded)}%`;
  $(`${prefix}ProgressLabel`).textContent = label;
  const track = document.getElementById(`${prefix}ProgressTrack`);
  track?.setAttribute('aria-valuenow', String(Math.round(bounded)));
  const detailElement = document.getElementById(`${prefix}ProgressDetail`);
  if (detailElement) detailElement.textContent = detail;
}

export function setIndeterminateProgress(prefix: string, label: string): void {
  $(`${prefix}Progress`).hidden = false;
  $(`${prefix}ProgressBar`).classList.add('indeterminate');
  $(`${prefix}ProgressValue`).textContent = '…';
  $(`${prefix}ProgressLabel`).textContent = label;
  const track = document.getElementById(`${prefix}ProgressTrack`);
  track?.removeAttribute('aria-valuenow');
}

export function resetProgress(prefix: string): void {
  const wrap = document.getElementById(`${prefix}Progress`);
  if (wrap) wrap.hidden = true;
  const bar = document.getElementById(`${prefix}ProgressBar`);
  if (bar) {
    bar.style.width = '0%';
    bar.classList.remove('indeterminate');
  }
  const value = document.getElementById(`${prefix}ProgressValue`);
  if (value) value.textContent = '0%';
  document.getElementById(`${prefix}ProgressTrack`)?.setAttribute('aria-valuenow', '0');
}

export function getOutputName(inputId: string, prefix: string, extension: string): string {
  const field = $(inputId) as HTMLInputElement;
  const currentAutomaticBase = field.dataset['automaticBase'] ?? automaticBase(prefix);
  const result = normalizeOutputFilename(field.value, extension, currentAutomaticBase);
  if (result.warnings.length) toast(result.warnings.join(' '), 'warning');

  // Keep the preview and the actual download name identical. After a result is
  // prepared, rotate the automatic suggestion for the next run.
  field.dataset['automaticBase'] = automaticBase(prefix);
  const previewId = field.dataset['namePreview'];
  const preview = previewId ? document.getElementById(previewId) : null;
  if (preview && !field.value.trim()) {
    const nextName = normalizeOutputFilename('', extension, field.dataset['automaticBase']).filename;
    preview.textContent = `Следующее автоматическое имя: ${nextName}`;
  }

  return result.filename;
}

export function setupNamePreview(
  inputId: string,
  previewId: string,
  prefix: string,
  extension: () => string,
  watchChangeIds: string[] = [],
): void {
  const input = $(inputId) as HTMLInputElement;
  const preview = $(previewId);
  input.dataset['namePreview'] = previewId;
  input.dataset['automaticBase'] ??= automaticBase(prefix);
  const update = () => {
    try {
      const ext = extension();
      const automatic = input.dataset['automaticBase'] ?? automaticBase(prefix);
      const result = normalizeOutputFilename(input.value, ext, automatic);
      preview.textContent = input.value.trim()
        ? `Будет сохранено как: ${result.filename}`
        : `Автоматическое имя: ${result.filename}`;
      preview.dataset['invalid'] = 'false';
    } catch {
      preview.textContent = 'Проверь имя файла.';
      preview.dataset['invalid'] = 'true';
    }
  };
  input.addEventListener('input', update);
  for (const id of watchChangeIds) $(id).addEventListener('change', update);
  update();
}

export function makeFileRow(name: string, size: number, suffix?: string): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'file-row';
  const icon = document.createElement('span');
  icon.className = 'file-row-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = suffix ?? '▧';
  const body = document.createElement('div');
  body.className = 'file-row-body';
  const title = document.createElement('strong');
  title.className = 'file-row-name';
  title.textContent = name;
  title.title = name;
  const meta = document.createElement('span');
  meta.className = 'file-row-meta';
  meta.textContent = formatBytes(size);
  body.append(title, meta);
  row.append(icon, body);
  return row;
}

export function makeRemoveButton(label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = 'remove-button';
  button.type = 'button';
  button.textContent = 'Удалить';
  button.setAttribute('aria-label', `Удалить ${label}`);
  button.addEventListener('click', onClick);
  return button;
}

export function setupDropzone(
  zoneId: string,
  inputId: string,
  onFiles: (files: File[]) => void | Promise<void>,
): void {
  const zone = $(zoneId);
  const input = $(inputId) as HTMLInputElement;
  input.addEventListener('change', () => {
    if (input.files?.length) void onFiles(Array.from(input.files));
    input.value = '';
  });
  for (const eventName of ['dragenter', 'dragover']) {
    zone.addEventListener(eventName, (event) => {
      event.preventDefault();
      zone.classList.add('is-dragging');
    });
  }
  for (const eventName of ['dragleave', 'dragend']) {
    zone.addEventListener(eventName, (event) => {
      event.preventDefault();
      const relatedTarget = (event as DragEvent).relatedTarget;
      if (!(relatedTarget instanceof Node) || !zone.contains(relatedTarget))
        zone.classList.remove('is-dragging');
    });
  }
  zone.addEventListener('drop', (event) => {
    event.preventDefault();
    zone.classList.remove('is-dragging');
    const files = Array.from((event as DragEvent).dataTransfer?.files ?? []);
    if (files.length) void onFiles(files);
  });
}

export function setBusyStatus(kind: OperationKind | null): void {
  const status = $('globalTaskStatus');
  status.hidden = kind === null;
  $('globalTaskStatusText').textContent =
    kind === null
      ? ''
      : (
          {
            images: 'Преобразование изображений…',
            archive: 'Создание ZIP-архива…',
            text: 'Подготовка текстового файла…',
            merge: 'Объединение документов…',
          } satisfies Record<OperationKind, string>
        )[kind];
  $('appMain')?.setAttribute('aria-busy', String(kind !== null));
}
