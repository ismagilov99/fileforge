import { LIMITS, type ImageOutput } from '../core/config';
import { downloadBlob } from '../core/download';
import { formatBytes } from '../core/validation';
import { isAbortError, toUserMessage } from '../core/errors';
import { prepareImageFiles, convertImageBatch, type ImageProgress } from '../engines/images';
import { state } from './state';
import {
  $,
  makeFileRow,
  makeRemoveButton,
  resetProgress,
  setProgress,
  setupDropzone,
  toast,
  getOutputName,
  setupNamePreview,
} from './dom';
import { beginOperation, finishOperation, isBusy } from './operation';
import { saveOperation } from './history-panel';

const imagePreviewUrls = new Map<string, string>();

function revokeRemovedImagePreviews(): void {
  const activeIds = new Set(state.images.map((item) => item.id));
  for (const [id, url] of imagePreviewUrls) {
    if (!activeIds.has(id)) {
      URL.revokeObjectURL(url);
      imagePreviewUrls.delete(id);
    }
  }
}

function renderImages(): void {
  revokeRemovedImagePreviews();
  const list = $('imageList');
  list.replaceChildren();
  for (const item of state.images) {
    const row = makeFileRow(item.displayName, item.file.size, '▧');
    const image = document.createElement('img');
    image.className = 'file-thumb';
    const url = imagePreviewUrls.get(item.id) ?? URL.createObjectURL(item.file);
    imagePreviewUrls.set(item.id, url);
    image.src = url;
    image.alt = '';
    image.loading = 'lazy';
    row.prepend(image);
    row.append(
      makeRemoveButton(item.displayName, () => {
        if (isBusy() || state.imagePreparing) return;
        state.images = state.images.filter((entry) => entry.id !== item.id);
        renderImages();
      }),
    );
    list.append(row);
  }

  const bytes = state.images.reduce((sum, item) => sum + item.file.size, 0);
  const imageSummary = state.images.length
    ? `${state.images.length} файлов · ${formatBytes(bytes)} из ${formatBytes(LIMITS.image.maxTotalBytes)}`
    : 'Пока ничего не добавлено';
  $('imageCount').textContent = state.imagePreparing
    ? `${imageSummary} · проверка новой группы…`
    : imageSummary;
  $('imageList').setAttribute('aria-busy', String(state.imagePreparing));
  $('imagePrepareCancel').hidden = !state.imagePreparing;
  $('imageClear').toggleAttribute('disabled', !state.images.length || isBusy() || state.imagePreparing);
  $('imageSettings').hidden = !state.images.length;
  $('imageRun').toggleAttribute('disabled', !state.images.length || isBusy() || state.imagePreparing);
  $('imageFiles').toggleAttribute('disabled', isBusy() || state.imagePreparing);
  updateImageQualityVisibility();
}

async function addImages(files: File[]): Promise<void> {
  if (isBusy()) {
    toast('Дождись завершения текущей операции.', 'warning');
    return;
  }
  if (state.imagePreparing) {
    toast('Проверка предыдущей группы изображений ещё выполняется.', 'warning');
    return;
  }
  state.imagePreparing = true;
  const controller = new AbortController();
  state.imagePrepareAbort = controller;
  renderImages();
  try {
    const result = await prepareImageFiles(files, state.images, controller.signal);
    state.images.push(...result.accepted);
    for (const rejected of result.rejected.slice(0, 5)) {
      toast(`${rejected.name}: ${rejected.reason}`, 'warning');
    }
    if (result.rejected.length > 5)
      toast(`Ещё отклонено изображений: ${result.rejected.length - 5}.`, 'warning');
    if (result.accepted.length) toast(`Добавлено изображений: ${result.accepted.length}.`, 'success');
  } catch (error) {
    if (isAbortError(error)) toast('Проверка изображений отменена. Новая группа не добавлена.', 'warning');
    else toast(toUserMessage(error), 'error');
  } finally {
    state.imagePrepareAbort = null;
    state.imagePreparing = false;
    renderImages();
  }
}

function updateImageQualityVisibility(): void {
  const format = ($('imageFormat') as HTMLSelectElement).value;
  $('qualityField').hidden = format === 'png';
}

function showImageFailures(failures: Array<{ name: string; message: string }>): void {
  const target = $('imageFailures');
  target.replaceChildren();
  if (!failures.length) {
    target.hidden = true;
    return;
  }
  const heading = document.createElement('strong');
  heading.textContent = `Не удалось обработать: ${failures.length}`;
  const list = document.createElement('ul');
  for (const failure of failures.slice(0, 8)) {
    const item = document.createElement('li');
    item.textContent = `${failure.name}: ${failure.message}`;
    list.append(item);
  }
  target.append(heading, list);
  if (failures.length > 8) {
    const remaining = document.createElement('p');
    remaining.textContent = `Других ошибок: ${failures.length - 8}.`;
    target.append(remaining);
  }
  target.hidden = false;
}

async function runImageConversion(): Promise<void> {
  if (state.imagePreparing) {
    toast('Сначала дождись завершения проверки добавленных изображений.', 'warning');
    return;
  }
  if (!state.images.length || !beginOperation('images')) return;
  const controller = new AbortController();
  state.activeAbort = controller;
  const failures: Array<{ name: string; message: string }> = [];
  try {
    const format = ($('imageFormat') as HTMLSelectElement).value as ImageOutput;
    const quality = Number(($('imageQuality') as HTMLInputElement).value) / 100;
    const filename = getOutputName('imageOutputName', 'fileforge-images', 'zip');
    $('imageCancel').hidden = false;
    $('imageProgress').hidden = false;
    const result = await convertImageBatch(
      state.images,
      format,
      quality,
      controller.signal,
      (progress: ImageProgress) =>
        setProgress(
          'image',
          progress.percent,
          progress.currentName ? `Обработка: ${progress.currentName}` : 'Упаковка результатов…',
          progress.outputBytes
            ? `Подготовлено ${formatBytes(progress.outputBytes)}${progress.scaled ? ' · изображение уменьшено до безопасного размера' : ''}`
            : '',
        ),
      (error) => failures.push(error),
    );
    showImageFailures(result.failures.length ? result.failures : failures);
    downloadBlob(result.blob, filename);
    saveOperation('image', filename, format.toUpperCase(), result.blob.size, result.successes);
    toast(
      `Готово: ${result.successes} изображений сохранено в ${filename}.`,
      result.failures.length ? 'warning' : 'success',
    );
  } catch (error) {
    showImageFailures(failures);
    if (isAbortError(error)) toast('Обработка отменена. Файл не создан.', 'warning');
    else toast(toUserMessage(error), 'error');
  } finally {
    $('imageCancel').hidden = true;
    finishOperation('images');
    window.setTimeout(() => resetProgress('image'), 1800);
    renderImages();
  }
}

export function revokeImagePreviews(): void {
  for (const url of imagePreviewUrls.values()) URL.revokeObjectURL(url);
  imagePreviewUrls.clear();
}

export function initImages(): void {
  setupDropzone('imageDrop', 'imageFiles', addImages);
  $('imageClear').addEventListener('click', () => {
    if (isBusy() || state.imagePreparing) return;
    state.images = [];
    renderImages();
    $('imageFailures').hidden = true;
  });
  $('imageFormat').addEventListener('change', updateImageQualityVisibility);
  $('imageQuality').addEventListener('input', () => {
    $('qualityValue').textContent = `${($('imageQuality') as HTMLInputElement).value}%`;
  });
  $('imageRun').addEventListener('click', () => void runImageConversion());
  $('imageCancel').addEventListener('click', () => state.activeAbort?.abort());
  $('imagePrepareCancel').addEventListener('click', () => state.imagePrepareAbort?.abort());
  setupNamePreview('imageOutputName', 'imageOutputPreview', 'fileforge-images', () => 'zip');
  renderImages();
}
