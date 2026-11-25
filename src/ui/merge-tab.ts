import { LIMITS } from '../core/config';
import { mergeFilesInWorker, prepareMergeInWorker } from '../engines/background';
import { formatBytes } from '../core/validation';
import { downloadBlob } from '../core/download';
import { toUserMessage, isAbortError } from '../core/errors';
import { state } from './state';
import {
  $,
  getOutputName,
  makeFileRow,
  makeRemoveButton,
  resetProgress,
  setIndeterminateProgress,
  setupDropzone,
  setupNamePreview,
  toast,
} from './dom';
import { beginOperation, finishOperation, isBusy } from './operation';
import { saveOperation } from './history-panel';

function renderMerge(): void {
  const list = $('mergeList');
  list.replaceChildren();
  state.merge.forEach((item, index) => {
    const row = makeFileRow(item.name, item.size, '≡');
    const controls = document.createElement('div');
    controls.className = 'file-row-controls';
    const up = document.createElement('button');
    up.className = 'move-button';
    up.type = 'button';
    up.textContent = '↑';
    up.disabled = index === 0 || isBusy();
    up.setAttribute('aria-label', `Переместить ${item.name} выше`);
    up.addEventListener('click', () => {
      if (isBusy() || index === 0) return;
      [state.merge[index - 1], state.merge[index]] = [state.merge[index]!, state.merge[index - 1]!];
      renderMerge();
    });
    const down = document.createElement('button');
    down.className = 'move-button';
    down.type = 'button';
    down.textContent = '↓';
    down.disabled = index === state.merge.length - 1 || isBusy();
    down.setAttribute('aria-label', `Переместить ${item.name} ниже`);
    down.addEventListener('click', () => {
      if (isBusy() || index === state.merge.length - 1) return;
      [state.merge[index], state.merge[index + 1]] = [state.merge[index + 1]!, state.merge[index]!];
      renderMerge();
    });
    controls.append(
      up,
      down,
      makeRemoveButton(item.name, () => {
        if (isBusy()) return;
        state.merge.splice(index, 1);
        renderMerge();
      }),
    );
    row.append(controls);
    list.append(row);
  });

  const bytes = state.merge.reduce((sum, item) => sum + item.size, 0);
  const mergeSummary = state.merge.length
    ? `${state.merge.length} текстовых файлов · ${formatBytes(bytes)} из ${formatBytes(LIMITS.merge.maxTotalUncompressedBytes)}`
    : 'Пока ничего не добавлено';
  $('mergeStats').textContent = state.mergePreparing
    ? `${mergeSummary} · проверка новой группы…`
    : mergeSummary;
  list.setAttribute('aria-busy', String(state.mergePreparing));
  $('mergeClear').toggleAttribute('disabled', !state.merge.length || isBusy() || state.mergePreparing);
  $('mergeSettings').hidden = !state.merge.length;
  $('mergeFiles').toggleAttribute('disabled', isBusy() || state.mergePreparing);
  $('mergeRun').toggleAttribute('disabled', !state.merge.length || isBusy() || state.mergePreparing);

  const notice = $('mergeSkipped');
  notice.hidden = state.mergeSkippedCount === 0;
  notice.replaceChildren();
  if (state.mergeSkippedCount) {
    const title = document.createElement('strong');
    title.textContent = `Не добавлено элементов: ${state.mergeSkippedCount}`;
    const details = document.createElement('ul');
    for (const skipped of state.mergeSkipped.slice(0, 8)) {
      const item = document.createElement('li');
      item.textContent = `${skipped.name}: ${skipped.reason}`;
      details.append(item);
    }
    notice.append(title, details);
    if (state.mergeSkippedCount > Math.min(8, state.mergeSkipped.length)) {
      const remaining = document.createElement('p');
      remaining.textContent = `Других пропусков: ${state.mergeSkippedCount - Math.min(8, state.mergeSkipped.length)}. Подробности ограничены, чтобы не перегружать интерфейс.`;
      notice.append(remaining);
    }
  }
}

async function addMergeFiles(files: File[]): Promise<void> {
  if (isBusy()) {
    toast('Дождись завершения текущей операции.', 'warning');
    return;
  }
  if (state.mergePreparing) {
    toast('Проверка предыдущей группы файлов ещё выполняется.', 'warning');
    return;
  }
  if (files.length > LIMITS.merge.maxFiles) {
    toast(`За один раз можно выбрать не более ${LIMITS.merge.maxFiles} исходных файлов.`, 'warning');
    return;
  }

  state.mergePreparing = true;
  renderMerge();
  const controller = new AbortController();
  state.mergePrepareAbort = controller;
  $('mergePrepareCancel').hidden = false;
  try {
    const result = await prepareMergeInWorker(files, controller.signal);
    const availableSlots = Math.max(0, LIMITS.merge.maxFiles - state.merge.length);
    const acceptedFiles = result.files.slice(0, availableSlots);
    const overflowFiles = result.files.slice(availableSlots);
    let runningBytes = state.merge.reduce((sum, item) => sum + item.size, 0);
    const withinTotalLimit = [] as typeof acceptedFiles;
    let additionalSkippedCount = 0;
    for (const item of acceptedFiles) {
      if (runningBytes + item.size > LIMITS.merge.maxTotalUncompressedBytes) {
        result.skipped.push({
          name: item.name,
          reason: 'Добавление превысит общий лимит распакованного текста.',
        });
        additionalSkippedCount += 1;
        continue;
      }
      withinTotalLimit.push(item);
      runningBytes += item.size;
    }
    result.skipped.push(
      ...overflowFiles.map((item) => ({
        name: item.name,
        reason: `Превышен лимит ${LIMITS.merge.maxFiles} текстовых файлов.`,
      })),
    );
    additionalSkippedCount += overflowFiles.length;
    state.merge.push(...withinTotalLimit);
    const remainingDetailSlots = Math.max(0, LIMITS.merge.maxSkippedDetails - state.mergeSkipped.length);
    state.mergeSkipped.push(...result.skipped.slice(0, remainingDetailSlots));
    const currentSkippedCount = result.skippedCount + additionalSkippedCount;
    state.mergeSkippedCount += currentSkippedCount;
    if (withinTotalLimit.length) toast(`Добавлено текстовых файлов: ${withinTotalLimit.length}.`, 'success');
    if (currentSkippedCount)
      toast(`Есть пропуски: ${currentSkippedCount}. Подробности показаны под списком.`, 'warning');
  } catch (error) {
    if (isAbortError(error)) toast('Проверка и импорт файлов отменены.', 'warning');
    else toast(toUserMessage(error), 'error');
  } finally {
    state.mergePrepareAbort = null;
    state.mergePreparing = false;
    $('mergePrepareCancel').hidden = true;
    renderMerge();
  }
}

async function runMerge(): Promise<void> {
  if (state.mergePreparing) {
    toast('Сначала дождись завершения проверки и импорта файлов.', 'warning');
    return;
  }
  if (!state.merge.length || !beginOperation('merge')) return;
  const controller = new AbortController();
  state.activeAbort = controller;
  try {
    const format = ($('mergeFormat') as HTMLSelectElement).value as 'txt' | 'md' | 'html' | 'json';
    const includeNames = ($('mergeIncludeNames') as HTMLInputElement).checked;
    const filename = getOutputName('mergeOutputName', 'fileforge-merged', format);
    $('mergeCancel').hidden = false;
    setIndeterminateProgress('merge', 'Объединение в фоновом потоке…');
    const result = await mergeFilesInWorker(state.merge, format, includeNames, controller.signal);
    if (!(result.blob instanceof Blob) || result.extension !== format || result.blob.type !== result.mime) {
      throw new Error('Фоновый обработчик вернул результат с некорректным типом или расширением.');
    }
    if (result.blob.size > LIMITS.merge.maxOutputBytes) {
      throw new Error('Результат превысил установленный лимит. Файл не сохранён.');
    }
    downloadBlob(result.blob, filename);
    saveOperation('merge', filename, format.toUpperCase(), result.blob.size, state.merge.length);
    toast(`Результат ${filename} подготовлен.`, 'success');
  } catch (error) {
    if (isAbortError(error)) toast('Объединение отменено.', 'warning');
    else toast(toUserMessage(error), 'error');
  } finally {
    $('mergeCancel').hidden = true;
    finishOperation('merge');
    window.setTimeout(() => resetProgress('merge'), 1200);
    renderMerge();
  }
}

export function initMerge(): void {
  setupDropzone('mergeDrop', 'mergeFiles', addMergeFiles);
  $('mergeClear').addEventListener('click', () => {
    if (isBusy() || state.mergePreparing) return;
    state.merge = [];
    state.mergeSkipped = [];
    state.mergeSkippedCount = 0;
    renderMerge();
  });
  $('mergeRun').addEventListener('click', () => void runMerge());
  $('mergeCancel').addEventListener('click', () => state.activeAbort?.abort());
  $('mergePrepareCancel').addEventListener('click', () => state.mergePrepareAbort?.abort());
  setupNamePreview(
    'mergeOutputName',
    'mergeOutputPreview',
    'fileforge-merged',
    () => ($('mergeFormat') as HTMLSelectElement).value,
    ['mergeFormat'],
  );
  renderMerge();
}
