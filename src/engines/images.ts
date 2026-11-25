import { createId } from '../core/ids';
import {
  detectFileType,
  readImageDimensions,
  readSvgDimensions,
  sanitizeSvg,
  validateBatch,
  validateImageInputType,
} from '../core/validation';
import { IMAGE_OUTPUTS, LIMITS, type ImageOutput } from '../core/config';
import { FileForgeError } from '../core/errors';

export interface SelectedImage {
  id: string;
  file: File;
  displayName: string;
  sourceType: string;
  sha256?: string;
}

export interface ImageProgress {
  current: number;
  total: number;
  percent: number;
  currentName?: string;
  scaled?: boolean;
  outputBytes?: number;
}

export interface ImageBatchResult {
  blob: Blob;
  successes: number;
  failures: Array<{ name: string; message: string }>;
}

interface WorkerReply {
  type: string;
  id: string;
  blob?: Blob;
  successes?: number;
  failures?: Array<{ name: string; message: string }>;
  percent?: number;
  current?: number;
  total?: number;
  currentName?: string;
  scaled?: boolean;
  outputBytes?: number;
  name?: string;
  message?: string;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Проверка отменена.', 'AbortError');
}

async function sha256File(file: File, signal?: AbortSignal): Promise<string | undefined> {
  // SubtleCrypto requires a full in-memory buffer. For larger images, skip
  // duplicate detection rather than doubling peak memory merely for a hint.
  throwIfAborted(signal);
  if (file.size > 8 * 1024 * 1024 || !globalThis.crypto?.subtle) return undefined;
  try {
    const bytes = await file.arrayBuffer();
    throwIfAborted(signal);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    throwIfAborted(signal);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  } catch {
    if (signal?.aborted) throw new DOMException('Проверка отменена.', 'AbortError');
    // Hashing is an optional duplicate-detection enhancement, never a reason to
    // reject an otherwise valid image or compare files by weak metadata.
    return undefined;
  }
}

export async function prepareImageFiles(
  files: File[],
  existing: SelectedImage[],
  signal?: AbortSignal,
): Promise<{
  accepted: SelectedImage[];
  rejected: Array<{ name: string; reason: string }>;
}> {
  if (files.length > LIMITS.image.maxFiles) {
    throw new FileForgeError(
      'IMAGE_INPUT_COUNT',
      `За один раз можно проверить не более ${LIMITS.image.maxFiles} изображений.`,
    );
  }
  if (existing.length > LIMITS.image.maxFiles) {
    throw new FileForgeError(
      'IMAGE_STATE_INVALID',
      'Текущий список изображений превышает установленный лимит. Очисти список и повтори попытку.',
    );
  }
  const accepted: SelectedImage[] = [];
  const rejected: Array<{ name: string; reason: string }> = [];
  const currentBytes = existing.reduce((sum, item) => sum + item.file.size, 0);
  let incomingBytes = 0;
  const knownHashes = new Set(
    existing.map((item) => item.sha256).filter((value): value is string => Boolean(value)),
  );

  for (const file of files) {
    throwIfAborted(signal);
    try {
      if (existing.length + accepted.length >= LIMITS.image.maxFiles) {
        throw new FileForgeError('IMAGE_COUNT_LIMIT', `Лимит — ${LIMITS.image.maxFiles} изображений.`);
      }
      validateBatch([file], 1, LIMITS.image.maxFileBytes, LIMITS.image.maxTotalBytes);
      if (currentBytes + incomingBytes + file.size > LIMITS.image.maxTotalBytes) {
        throw new FileForgeError(
          'IMAGE_TOTAL_LIMIT',
          `Общий размер изображений превышает лимит ${LIMITS.image.maxTotalBytes / 1024 / 1024} МБ.`,
        );
      }

      const detected = await detectFileType(file);
      throwIfAborted(signal);
      validateImageInputType(detected, file);

      let safeFile = file;
      if (detected === 'svg') {
        if (file.size > LIMITS.image.maxSvgBytes)
          throw new FileForgeError(
            'SVG_TOO_LARGE',
            `SVG превышает лимит ${LIMITS.image.maxSvgBytes / 1024 / 1024} МБ.`,
          );
        let source: string;
        try {
          source = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
        } catch {
          throw new FileForgeError(
            'SVG_INVALID_UTF8',
            'SVG должен быть корректным UTF-8. Исходные байты не были изменены.',
          );
        }
        throwIfAborted(signal);
        const clean = sanitizeSvg(source);
        readSvgDimensions(clean);
        safeFile = new File([clean], file.name, { type: 'image/svg+xml', lastModified: file.lastModified });
      } else {
        await readImageDimensions(file, detected);
        throwIfAborted(signal);
      }

      validateBatch([safeFile], 1, LIMITS.image.maxFileBytes, LIMITS.image.maxTotalBytes);
      if (currentBytes + incomingBytes + safeFile.size > LIMITS.image.maxTotalBytes) {
        throw new FileForgeError(
          'IMAGE_TOTAL_LIMIT',
          'После безопасной подготовки общий размер изображений превысит установленный лимит.',
        );
      }

      const hash = await sha256File(safeFile, signal);
      throwIfAborted(signal);
      if (hash && knownHashes.has(hash)) {
        throw new FileForgeError('DUPLICATE_IMAGE', 'Точное содержимое этого изображения уже добавлено.');
      }
      if (hash) knownHashes.add(hash);
      accepted.push({
        id: createId('image'),
        file: safeFile,
        displayName: file.name,
        sourceType: detected,
        ...(hash ? { sha256: hash } : {}),
      });
      incomingBytes += safeFile.size;
    } catch (error) {
      if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
        throw new DOMException('Проверка отменена.', 'AbortError');
      }
      rejected.push({ name: file.name, reason: error instanceof Error ? error.message : 'Файл отклонён.' });
    }
  }
  return { accepted, rejected };
}

export function convertImageBatch(
  files: SelectedImage[],
  format: ImageOutput,
  quality: number,
  signal: AbortSignal,
  onProgress: (progress: ImageProgress) => void,
  onItemError: (error: { name: string; message: string }) => void,
): Promise<ImageBatchResult> {
  if (!files.length)
    return Promise.reject(new FileForgeError('EMPTY_IMAGE_LIST', 'Добавь хотя бы одно изображение.'));
  if (!IMAGE_OUTPUTS.includes(format))
    return Promise.reject(
      new FileForgeError('IMAGE_OUTPUT_UNSUPPORTED', 'Выбран неподдерживаемый формат результата.'),
    );
  if (!Number.isFinite(quality) || quality < 0.1 || quality > 1) {
    return Promise.reject(
      new FileForgeError('IMAGE_QUALITY_INVALID', 'Качество должно быть числом от 10 до 100 процентов.'),
    );
  }
  try {
    validateBatch(
      files.map((item) => item.file),
      LIMITS.image.maxFiles,
      LIMITS.image.maxFileBytes,
      LIMITS.image.maxTotalBytes,
    );
  } catch (error) {
    return Promise.reject(error);
  }
  if (typeof Worker === 'undefined')
    return Promise.reject(
      new FileForgeError(
        'WORKER_UNAVAILABLE',
        'Этот браузер не поддерживает фоновую обработку. Обнови браузер.',
      ),
    );

  return new Promise((resolve, reject) => {
    const id = createId('image');
    const worker = new Worker(new URL('../workers/image.worker.ts', import.meta.url), {
      type: 'module',
      name: 'fileforge-image-worker',
    });
    let settled = false;
    const timeout = window.setTimeout(
      () => {
        finish(() =>
          reject(
            new FileForgeError(
              'IMAGE_WORKER_TIMEOUT',
              'Обработка изображений заняла слишком много времени. Операция остановлена.',
            ),
          ),
        );
      },
      10 * 60 * 1000,
    );
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
      worker.terminate();
      try {
        callback();
      } catch (error) {
        reject(error instanceof Error ? error : new Error('Ошибка завершения обработки изображения.'));
      }
    };
    const abort = () => {
      try {
        worker.postMessage({ type: 'cancel', id });
      } catch {
        /* The worker may already have stopped. */
      }
      finish(() => reject(new DOMException('Операция отменена.', 'AbortError')));
    };
    if (signal.aborted) {
      finish(() => reject(new DOMException('Операция отменена.', 'AbortError')));
      return;
    }
    signal.addEventListener('abort', abort, { once: true });
    worker.addEventListener('error', (event) =>
      finish(() => reject(new Error(`Фоновый обработчик остановился: ${event.message}`))),
    );
    worker.addEventListener('messageerror', () =>
      finish(() => reject(new Error('Не удалось безопасно прочитать ответ фонового обработчика.'))),
    );
    worker.addEventListener('message', (event: MessageEvent<WorkerReply>) => {
      const reply = event.data;
      if (reply.id !== id) return;
      if (reply.type === 'progress') {
        try {
          onProgress({
            current: reply.current ?? 0,
            total: reply.total ?? files.length,
            percent: Math.round(((reply.current ?? 0) / (reply.total ?? files.length)) * 90),
            currentName: reply.currentName,
            scaled: reply.scaled,
            outputBytes: reply.outputBytes,
          });
        } catch (error) {
          finish(() => reject(error instanceof Error ? error : new Error('Ошибка обновления прогресса.')));
        }
      } else if (reply.type === 'zip-progress') {
        try {
          onProgress({
            current: files.length,
            total: files.length,
            percent: 90 + Math.round((reply.percent ?? 0) / 10),
          });
        } catch (error) {
          finish(() => reject(error instanceof Error ? error : new Error('Ошибка обновления прогресса.')));
        }
      } else if (reply.type === 'item-error') {
        try {
          onItemError({ name: reply.name ?? '', message: reply.message ?? 'Ошибка изображения.' });
        } catch (error) {
          finish(() =>
            reject(error instanceof Error ? error : new Error('Ошибка отображения результата обработки.')),
          );
        }
      } else if (reply.type === 'complete') {
        finish(() => {
          if (reply.blob?.type !== 'application/zip') {
            reject(new Error('Фоновый обработчик вернул некорректный результат.'));
            return;
          }
          onProgress({ current: files.length, total: files.length, percent: 100 });
          resolve({ blob: reply.blob, successes: reply.successes ?? 0, failures: reply.failures ?? [] });
        });
      } else if (reply.type === 'cancelled') {
        finish(() => reject(new DOMException('Операция отменена.', 'AbortError')));
      } else if (reply.type === 'failure') {
        finish(() => reject(new Error(reply.message ?? 'Не удалось обработать изображения.')));
      }
    });

    try {
      worker.postMessage({
        type: 'convert',
        id,
        files: files.map((item) => ({ id: item.id, name: item.displayName, blob: item.file })),
        format,
        quality,
      });
    } catch (error) {
      finish(() =>
        reject(
          error instanceof Error ? error : new Error('Не удалось передать изображения в фоновый обработчик.'),
        ),
      );
    }
  });
}
