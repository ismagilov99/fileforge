import JSZip from 'jszip';
import { IMAGE_OUTPUTS, LIMITS } from '../core/config';
import { sanitizePathSegment } from '../core/file-names';

interface WorkerImageInput {
  id: string;
  name: string;
  blob: Blob;
}

interface ConvertMessage {
  type: 'convert';
  id: string;
  files: WorkerImageInput[];
  format: 'png' | 'jpeg' | 'webp';
  quality: number;
}

interface CancelMessage {
  type: 'cancel';
  id: string;
}
type IncomingMessage = ConvertMessage | CancelMessage;

const cancelled = new Set<string>();
const scope = self as unknown as {
  postMessage(message: unknown): void;
  addEventListener(type: string, listener: (event: MessageEvent<IncomingMessage>) => void): void;
};

function uniqueName(requested: string, used: Set<string>): string {
  const dot = requested.lastIndexOf('.');
  const base = dot > 0 ? requested.slice(0, dot) : requested;
  const extension = dot > 0 ? requested.slice(dot) : '';
  let candidate = requested;
  let suffix = 1;
  while (used.has(candidate.toLocaleLowerCase('en-US'))) {
    candidate = `${base} (${suffix})${extension}`;
    suffix += 1;
  }
  used.add(candidate.toLocaleLowerCase('en-US'));
  return candidate;
}

function throwIfCancelled(id: string): void {
  if (cancelled.has(id)) throw new DOMException('Операция отменена.', 'AbortError');
}

async function convertOne(
  input: WorkerImageInput,
  format: ConvertMessage['format'],
  quality: number,
): Promise<{ blob: Blob; scaled: boolean }> {
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas === 'undefined') {
    throw new Error(
      'Этот браузер не поддерживает безопасную обработку изображений в фоновом потоке. Обновите браузер.',
    );
  }

  const bitmap = await createImageBitmap(input.blob);
  let canvas: OffscreenCanvas | undefined;
  try {
    const originalWidth = bitmap.width;
    const originalHeight = bitmap.height;
    if (
      !originalWidth ||
      !originalHeight ||
      !Number.isSafeInteger(originalWidth) ||
      !Number.isSafeInteger(originalHeight)
    ) {
      throw new Error(`Не удалось безопасно определить размеры изображения «${input.name}».`);
    }
    if (
      originalWidth > LIMITS.image.maxInputDimension ||
      originalHeight > LIMITS.image.maxInputDimension ||
      originalWidth * originalHeight > LIMITS.image.maxPixels
    ) {
      throw new Error(`Изображение «${input.name}» превышает безопасный лимит декодирования.`);
    }

    const maxDimension = LIMITS.image.maxDimension;
    const maxPixels = LIMITS.image.maxPixels;
    const scale = Math.min(
      1,
      maxDimension / originalWidth,
      maxDimension / originalHeight,
      Math.sqrt(maxPixels / (originalWidth * originalHeight)),
    );
    const width = Math.max(1, Math.floor(originalWidth * scale));
    const height = Math.max(1, Math.floor(originalHeight * scale));
    canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d', { alpha: format !== 'jpeg' });
    if (!context) throw new Error('Не удалось создать контекст Canvas.');
    if (format === 'jpeg') {
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, width, height);
    }
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, width, height);

    const expectedMime = format === 'jpeg' ? 'image/jpeg' : `image/${format}`;
    const result = await canvas.convertToBlob({
      type: expectedMime,
      quality: format === 'png' ? undefined : quality,
    });
    if (result.size === 0) throw new Error(`Кодировщик вернул пустой результат для «${input.name}».`);
    if (result.type !== expectedMime) {
      throw new Error(`Браузер не поддержал кодирование ${format.toUpperCase()}. Результат не сохранён.`);
    }
    return { blob: result, scaled: scale < 1 };
  } finally {
    bitmap.close();
    // Release the canvas backing store promptly instead of waiting for GC.
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
}

async function run(message: ConvertMessage): Promise<void> {
  if (
    !Array.isArray(message.files) ||
    message.files.length === 0 ||
    message.files.length > LIMITS.image.maxFiles
  ) {
    throw new Error(`Количество изображений должно быть от 1 до ${LIMITS.image.maxFiles}.`);
  }
  if (!IMAGE_OUTPUTS.includes(message.format)) throw new Error('Неподдерживаемый формат результата.');
  if (!Number.isFinite(message.quality) || message.quality < 0.1 || message.quality > 1) {
    throw new Error('Качество изображения должно находиться в диапазоне 10–100%.');
  }
  let sourceBytes = 0;
  for (const input of message.files) {
    if (
      !input ||
      typeof input.name !== 'string' ||
      !(input.blob instanceof Blob) ||
      !Number.isSafeInteger(input.blob.size) ||
      input.blob.size < 0 ||
      input.blob.size > LIMITS.image.maxFileBytes
    ) {
      throw new Error('В фоновый обработчик передан некорректный файл.');
    }
    sourceBytes += input.blob.size;
    if (!Number.isSafeInteger(sourceBytes) || sourceBytes > LIMITS.image.maxTotalBytes) {
      throw new Error(
        `Суммарный размер исходных изображений превышает ${LIMITS.image.maxTotalBytes / 1024 / 1024} МБ.`,
      );
    }
  }

  const zip = new JSZip();
  const usedNames = new Set<string>();
  const failures: Array<{ name: string; message: string }> = [];
  let completedBytes = 0;

  for (let index = 0; index < message.files.length; index += 1) {
    throwIfCancelled(message.id);
    const input = message.files[index]!;
    try {
      const converted = await convertOne(input, message.format, message.quality);
      const extension = message.format === 'jpeg' ? 'jpg' : message.format;
      if (converted.blob.size > LIMITS.image.maxOutputFileBytes) {
        throw new Error(
          `Результат «${input.name}» превышает лимит ${LIMITS.image.maxOutputFileBytes / 1024 / 1024} МБ на один файл.`,
        );
      }
      if (completedBytes + converted.blob.size > LIMITS.image.maxOutputBytes) {
        throw new Error(
          `Суммарный размер результатов превысит лимит ${LIMITS.image.maxOutputBytes / 1024 / 1024} МБ. Сократи набор файлов или выбери другой формат.`,
        );
      }
      const oldExtension =
        input.name.lastIndexOf('.') > 0 ? input.name.slice(input.name.lastIndexOf('.')) : '';
      const base = oldExtension ? input.name.slice(0, -oldExtension.length) : input.name;
      const safeBase = sanitizePathSegment(base, 'image').filename;
      const outputName = uniqueName(`${safeBase}.${extension}`, usedNames);
      zip.file(outputName, converted.blob, { date: new Date('1980-01-01T00:00:00.000Z') });
      completedBytes += converted.blob.size;
      scope.postMessage({
        type: 'progress',
        id: message.id,
        current: index + 1,
        total: message.files.length,
        outputBytes: completedBytes,
        scaled: converted.scaled,
        currentName: input.name,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      failures.push({
        name: input.name,
        message: error instanceof Error ? error.message : 'Неизвестная ошибка',
      });
      scope.postMessage({
        type: 'item-error',
        id: message.id,
        name: input.name,
        message: failures.at(-1)!.message,
      });
    }
  }

  throwIfCancelled(message.id);
  if (usedNames.size === 0) throw new Error('Ни одно изображение не удалось преобразовать. ZIP не создан.');

  const blob = await zip.generateAsync(
    { type: 'blob', compression: 'STORE', streamFiles: true, mimeType: 'application/zip' },
    (metadata) => {
      throwIfCancelled(message.id);
      scope.postMessage({ type: 'zip-progress', id: message.id, percent: metadata.percent });
    },
  );
  throwIfCancelled(message.id);
  if (blob.type !== 'application/zip' || blob.size > LIMITS.image.maxOutputBytes) {
    throw new Error('ZIP-результат не прошёл проверку типа или превысил лимит размера.');
  }
  scope.postMessage({ type: 'complete', id: message.id, blob, successes: usedNames.size, failures });
}

scope.addEventListener('message', (event: MessageEvent<IncomingMessage>) => {
  const message = event.data;
  if (message.type === 'cancel') {
    cancelled.add(message.id);
    return;
  }
  cancelled.delete(message.id);
  void run(message)
    .catch((error: unknown) => {
      const aborted = error instanceof DOMException && error.name === 'AbortError';
      scope.postMessage({
        type: aborted ? 'cancelled' : 'failure',
        id: message.id,
        message: error instanceof Error ? error.message : 'Неизвестная ошибка обработки.',
      });
    })
    .finally(() => cancelled.delete(message.id));
});
