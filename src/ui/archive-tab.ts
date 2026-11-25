import { createId } from '../core/ids';
import { LIMITS } from '../core/config';
import { validateFileName, validateFileSize, formatBytes } from '../core/validation';
import { sanitizePathSegment } from '../core/file-names';
import { downloadBlob } from '../core/download';
import { toUserMessage, isAbortError } from '../core/errors';
import { autoSortFolder } from '../engines/archive';
import { createArchiveInWorker } from '../engines/background';
import { state } from './state';
import {
  $,
  getOutputName,
  makeFileRow,
  makeRemoveButton,
  resetProgress,
  setProgress,
  setupDropzone,
  setupNamePreview,
  toast,
} from './dom';
import { beginOperation, finishOperation, isBusy } from './operation';
import { saveOperation } from './history-panel';

function folderNames(): string[] {
  return Array.from(
    new Set([...state.archiveFolders, ...state.archive.map((item) => item.folder).filter(Boolean)]),
  );
}

function renderArchive(): void {
  const list = $('archiveList');
  list.replaceChildren();
  const folders = folderNames();

  for (const item of state.archive) {
    const row = makeFileRow(item.name, item.file.size, '▤');
    const controls = document.createElement('div');
    controls.className = 'file-row-controls';
    const select = document.createElement('select');
    select.className = 'compact-select';
    select.setAttribute('aria-label', `Папка для ${item.name}`);
    const rootOption = document.createElement('option');
    rootOption.value = '';
    rootOption.textContent = 'Корень архива';
    select.append(rootOption);
    for (const folder of folders) {
      const option = document.createElement('option');
      option.value = folder;
      option.textContent = folder;
      select.append(option);
    }
    select.value = item.folder;
    select.addEventListener('change', () => {
      if (isBusy()) return;
      item.folder = select.value;
      renderArchiveStats();
    });
    controls.append(
      select,
      makeRemoveButton(item.name, () => {
        if (isBusy()) return;
        state.archive = state.archive.filter((entry) => entry.id !== item.id);
        renderArchive();
      }),
    );
    row.append(controls);
    list.append(row);
  }

  const totalBytes = state.archive.reduce((sum, item) => sum + item.file.size, 0);
  $('archiveStats').textContent = state.archive.length
    ? `${state.archive.length} файлов · ${formatBytes(totalBytes)} из ${formatBytes(LIMITS.archive.maxTotalBytes)} · ${folders.length} папок`
    : 'Пока ничего не добавлено';
  $('archiveClear').toggleAttribute('disabled', !state.archive.length || isBusy());
  $('archiveSort').toggleAttribute('disabled', !state.archive.length || isBusy());
  $('archiveTools').hidden = !state.archive.length;
  $('archiveSettings').hidden = !state.archive.length;
  $('archiveRun').toggleAttribute('disabled', isBusy() || !state.archive.length);
  $('archiveFiles').toggleAttribute('disabled', isBusy());
}

function renderArchiveStats(): void {
  const folders = folderNames();
  const totalBytes = state.archive.reduce((sum, item) => sum + item.file.size, 0);
  $('archiveStats').textContent =
    `${state.archive.length} файлов · ${formatBytes(totalBytes)} из ${formatBytes(LIMITS.archive.maxTotalBytes)} · ${folders.length} папок`;
}

function addArchiveFiles(files: File[]): void {
  if (isBusy()) {
    toast('Дождись завершения текущей операции.', 'warning');
    return;
  }
  if (files.length > LIMITS.archive.maxFiles) {
    toast(`За один раз можно выбрать не более ${LIMITS.archive.maxFiles} файлов.`, 'warning');
    return;
  }
  const rejected: string[] = [];
  for (const file of files) {
    try {
      if (state.archive.length >= LIMITS.archive.maxFiles)
        throw new Error(`Лимит — ${LIMITS.archive.maxFiles} файлов.`);
      validateFileName(file);
      validateFileSize(file, LIMITS.archive.maxFileBytes);
      const total = state.archive.reduce((sum, item) => sum + item.file.size, 0) + file.size;
      if (total > LIMITS.archive.maxTotalBytes)
        throw new Error(
          `Общий размер выбранных файлов превысит ${formatBytes(LIMITS.archive.maxTotalBytes)}.`,
        );
      state.archive.push({ id: createId('archive'), file, name: file.name, folder: '' });
    } catch (error) {
      rejected.push(`${file.name}: ${toUserMessage(error)}`);
    }
  }
  renderArchive();
  if (state.archive.length) toast(`В архиве файлов: ${state.archive.length}.`, 'success');
  rejected.slice(0, 4).forEach((message) => {
    toast(message, 'warning');
  });
  if (rejected.length > 4) toast(`Ещё отклонено файлов: ${rejected.length - 4}.`, 'warning');
}

async function runArchive(): Promise<void> {
  if (!state.archive.length || !beginOperation('archive')) return;
  const controller = new AbortController();
  state.activeAbort = controller;
  try {
    const filename = getOutputName('archiveOutputName', 'fileforge-archive', 'zip');
    $('archiveCancel').hidden = false;
    setProgress('archive', 0, 'Подготовка файлов…');
    const blob = await createArchiveInWorker(
      state.archive,
      state.archiveFolders,
      controller.signal,
      (progress) =>
        setProgress(
          'archive',
          progress.percent,
          progress.percent < 20 ? 'Добавление файлов…' : 'Формирование ZIP-архива…',
        ),
    );
    if (
      !(blob instanceof Blob) ||
      blob.type !== 'application/zip' ||
      blob.size < 22 ||
      blob.size > LIMITS.archive.maxOutputBytes
    ) {
      throw new Error('ZIP-результат не прошёл проверку типа или размера. Файл не сохранён.');
    }
    setProgress('archive', 100, 'Архив готов к скачиванию.');
    downloadBlob(blob, filename);
    saveOperation('archive', filename, 'ZIP', blob.size, state.archive.length);
    toast(`Архив ${filename} создан.`, 'success');
  } catch (error) {
    if (isAbortError(error)) toast('Создание архива отменено.', 'warning');
    else toast(toUserMessage(error), 'error');
  } finally {
    $('archiveCancel').hidden = true;
    finishOperation('archive');
    window.setTimeout(() => resetProgress('archive'), 1800);
    renderArchive();
  }
}

export function initArchive(): void {
  setupDropzone('archiveDrop', 'archiveFiles', addArchiveFiles);
  $('archiveClear').addEventListener('click', () => {
    if (isBusy()) return;
    state.archive = [];
    state.archiveFolders = [];
    renderArchive();
  });
  $('archiveSort').addEventListener('click', () => {
    if (isBusy()) return;
    state.archive.forEach((item) => {
      item.folder = autoSortFolder(item.name);
    });
    state.archiveFolders = Array.from(new Set(state.archive.map((item) => item.folder).filter(Boolean)));
    renderArchive();
    toast('Файлы распределены по категориям.', 'success');
  });
  $('folderForm').addEventListener('submit', (event) => {
    event.preventDefault();
    if (isBusy()) return;
    const input = $('folderName') as HTMLInputElement;
    const rawValue = input.value.trim();
    if (!rawValue) {
      toast('Введи название папки.', 'warning');
      return;
    }
    const normalized = sanitizePathSegment(rawValue, 'folder');
    const safe = normalized.filename.slice(0, 40).replace(/[. ]+$/g, '');
    if (!safe) {
      toast('Название папки недопустимо.', 'warning');
      return;
    }
    const existing = new Set(folderNames().map((folder) => folder.toLocaleLowerCase('ru-RU')));
    if (existing.size >= LIMITS.archive.maxFolders) {
      toast(
        `В ZIP можно создать не более ${LIMITS.archive.maxFolders} уникальных папок, включая папки, назначенные файлам.`,
        'warning',
      );
      return;
    }
    if (existing.has(safe.toLocaleLowerCase('ru-RU'))) {
      toast('Такая папка уже существует.', 'warning');
      return;
    }
    state.archiveFolders.push(safe);
    input.value = '';
    renderArchive();
    toast(`Папка «${safe}» добавлена.`, 'success');
  });
  $('archiveRun').addEventListener('click', () => void runArchive());
  $('archiveCancel').addEventListener('click', () => state.activeAbort?.abort());
  setupNamePreview('archiveOutputName', 'archiveOutputPreview', 'fileforge-archive', () => 'zip');
  renderArchive();
}
