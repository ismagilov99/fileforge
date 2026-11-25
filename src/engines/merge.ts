import { LIMITS, TEXT_EXTENSIONS, type MergeFormat } from '../core/config';
import { FileForgeError } from '../core/errors';
import { extractZipEntryBounded, inspectZipCentralDirectory } from '../core/zip-security';
import { validateFileName } from '../core/validation';
import { getFileExtension } from '../core/file-names';
import { mergeTextFiles, type MergeInput, type GeneratedFile } from './text';

export interface MergePreparationResult {
  files: MergeInput[];
  skipped: Array<{ name: string; reason: string }>;
  skippedCount: number;
  totalInputBytes: number;
}

function decodeUtf8(buffer: ArrayBuffer | Uint8Array, name: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer);
  } catch {
    throw new FileForgeError(
      'INVALID_UTF8',
      `Файл «${name}» не является корректным UTF-8. Его содержимое не было изменено или сохранено.`,
    );
  }
}

function addSkipped(
  details: Array<{ name: string; reason: string }>,
  item: { name: string; reason: string },
): void {
  if (details.length < LIMITS.merge.maxSkippedDetails) details.push(item);
}

function validateRawInputBatch(files: File[]): void {
  let total = 0;
  for (const file of files) {
    if (!Number.isSafeInteger(file.size) || file.size < 0) {
      throw new FileForgeError('MERGE_INVALID_SIZE', `Не удалось определить размер файла «${file.name}».`);
    }
    total += file.size;
    if (!Number.isSafeInteger(total) || total > LIMITS.merge.maxTotalInputBytes) {
      throw new FileForgeError(
        'MERGE_INPUT_TOO_LARGE',
        `Суммарный размер выбранных исходных файлов превышает ${LIMITS.merge.maxTotalInputBytes / 1024 / 1024} МБ. Уменьши набор файлов перед импортом.`,
      );
    }
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('Операция отменена.', 'AbortError');
}

export async function prepareMergeFiles(files: File[], signal: AbortSignal): Promise<MergePreparationResult> {
  if (!files.length) throw new FileForgeError('MERGE_EMPTY', 'Добавь текстовые файлы или ZIP-архив.');
  if (files.length > LIMITS.merge.maxFiles)
    throw new FileForgeError(
      'MERGE_COUNT',
      `Можно выбрать не более ${LIMITS.merge.maxFiles} исходных файлов.`,
    );
  validateRawInputBatch(files);

  const prepared: MergeInput[] = [];
  const skipped: Array<{ name: string; reason: string }> = [];
  let skippedCount = 0;
  const recordSkipped = (item: { name: string; reason: string }) => {
    skippedCount += 1;
    addSkipped(skipped, item);
  };
  let totalInputBytes = 0;

  for (const file of files) {
    throwIfAborted(signal);
    validateFileName(file);
    const extension = getFileExtension(file.name);
    if (extension === 'zip') {
      if (file.size > LIMITS.merge.maxZipBytes) {
        recordSkipped({
          name: file.name,
          reason: `ZIP превышает лимит ${LIMITS.merge.maxZipBytes / 1024 / 1024} МБ.`,
        });
        continue;
      }
      try {
        const buffer = await file.arrayBuffer();
        const entries = inspectZipCentralDirectory(buffer);
        const filesInZip = entries.filter((entry) => !entry.isDirectory);
        const supportedTextEntries = filesInZip.filter((entry) =>
          TEXT_EXTENSIONS.has(getFileExtension(entry.name)),
        );
        if (prepared.length + supportedTextEntries.length > LIMITS.merge.maxFiles) {
          throw new FileForgeError(
            'MERGE_COUNT',
            `С учётом ZIP количество поддерживаемых текстовых файлов превысит лимит ${LIMITS.merge.maxFiles}.`,
          );
        }

        // Treat one ZIP as an atomic input: do not leave partially imported files behind
        // if a later entry fails validation, decompression, UTF-8 decoding or CRC checks.
        const candidateFiles: MergeInput[] = [];
        const candidateSkipped: Array<{ name: string; reason: string }> = [];
        let candidateSkippedCount = 0;
        let candidateBytes = 0;
        for (const entry of filesInZip) {
          throwIfAborted(signal);
          const entryExtension = getFileExtension(entry.name);
          if (!TEXT_EXTENSIONS.has(entryExtension)) {
            candidateSkippedCount += 1;
            addSkipped(candidateSkipped, {
              name: `${file.name} → ${entry.name}`,
              reason: 'Формат не входит в список поддерживаемых текстовых файлов.',
            });
            continue;
          }
          const content = await extractZipEntryBounded(buffer, entry, LIMITS.merge.maxEntryBytes, signal);
          throwIfAborted(signal);
          const decoded = decodeUtf8(content, entry.name);
          candidateBytes += content.byteLength;
          if (
            !Number.isSafeInteger(candidateBytes) ||
            totalInputBytes + candidateBytes > LIMITS.merge.maxTotalUncompressedBytes
          ) {
            throw new FileForgeError(
              'MERGE_TOTAL_TOO_LARGE',
              `Общий объём распакованного текста превысил ${LIMITS.merge.maxTotalUncompressedBytes / 1024 / 1024} МБ.`,
            );
          }
          candidateFiles.push({
            name: entry.name,
            content: decoded,
            size: content.byteLength,
            sourceArchive: file.name,
          });
        }
        if (prepared.length + candidateFiles.length > LIMITS.merge.maxFiles) {
          throw new FileForgeError(
            'MERGE_COUNT',
            `С учётом ZIP количество текстовых файлов превысит лимит ${LIMITS.merge.maxFiles}.`,
          );
        }
        totalInputBytes += candidateBytes;
        prepared.push(...candidateFiles);
        skippedCount += candidateSkippedCount;
        for (const item of candidateSkipped) addSkipped(skipped, item);
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') throw error;
        throw new FileForgeError(
          'ZIP_REJECTED',
          `Архив «${file.name}» отклонён: ${error instanceof Error ? error.message : 'ошибка проверки'}`,
        );
      }
      continue;
    }

    if (!TEXT_EXTENSIONS.has(extension)) {
      recordSkipped({ name: file.name, reason: 'Формат не поддерживается для склейки.' });
      continue;
    }
    if (file.size > LIMITS.merge.maxDirectFileBytes) {
      recordSkipped({
        name: file.name,
        reason: `Текстовый файл превышает лимит ${LIMITS.merge.maxDirectFileBytes / 1024 / 1024} МБ.`,
      });
      continue;
    }
    const buffer = await file.arrayBuffer();
    const content = decodeUtf8(buffer, file.name);
    // TextDecoder preserves the source UTF-8 byte sequence (BOM included);
    // using the input buffer size avoids allocating a second Blob just to count bytes.
    const actualBytes = buffer.byteLength;
    totalInputBytes += actualBytes;
    if (totalInputBytes > LIMITS.merge.maxTotalUncompressedBytes) {
      throw new FileForgeError(
        'MERGE_TOTAL_TOO_LARGE',
        `Общий объём выбранного текста превысил ${LIMITS.merge.maxTotalUncompressedBytes / 1024 / 1024} МБ.`,
      );
    }
    prepared.push({ name: file.name, content, size: actualBytes });
    if (prepared.length > LIMITS.merge.maxFiles)
      throw new FileForgeError(
        'MERGE_COUNT',
        `Можно объединить не более ${LIMITS.merge.maxFiles} текстовых файлов.`,
      );
  }

  if (!prepared.length)
    throw new FileForgeError(
      'MERGE_NO_TEXT',
      'Не найдено поддерживаемых текстовых файлов. Проверь выбранные файлы и содержимое ZIP.',
    );
  return { files: prepared, skipped, skippedCount, totalInputBytes };
}

export async function prepareMergeBatch(files: File[], signal: AbortSignal): Promise<MergePreparationResult> {
  if (!files.length) throw new FileForgeError('MERGE_EMPTY', 'Добавь текстовые файлы или ZIP-архив.');
  if (files.length > LIMITS.merge.maxFiles) {
    throw new FileForgeError(
      'MERGE_INPUT_COUNT',
      `За один раз можно проверить не более ${LIMITS.merge.maxFiles} исходных файлов.`,
    );
  }
  validateRawInputBatch(files);

  const prepared: MergeInput[] = [];
  const skipped: Array<{ name: string; reason: string }> = [];
  let skippedCount = 0;
  const recordSkipped = (item: { name: string; reason: string }) => {
    skippedCount += 1;
    addSkipped(skipped, item);
  };
  let totalInputBytes = 0;

  for (const file of files) {
    throwIfAborted(signal);
    try {
      const result = await prepareMergeFiles([file], signal);
      if (prepared.length + result.files.length > LIMITS.merge.maxFiles) {
        recordSkipped({
          name: file.name,
          reason: `Добавление превысит лимит ${LIMITS.merge.maxFiles} текстовых файлов.`,
        });
        continue;
      }
      if (totalInputBytes + result.totalInputBytes > LIMITS.merge.maxTotalUncompressedBytes) {
        recordSkipped({
          name: file.name,
          reason: `Добавление превысит общий лимит ${LIMITS.merge.maxTotalUncompressedBytes / 1024 / 1024} МБ.`,
        });
        continue;
      }
      prepared.push(...result.files);
      skippedCount += result.skippedCount;
      for (const item of result.skipped) addSkipped(skipped, item);
      totalInputBytes += result.totalInputBytes;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      recordSkipped({ name: file.name, reason: error instanceof Error ? error.message : 'Файл отклонён.' });
    }
  }

  if (!prepared.length) {
    throw new FileForgeError(
      'MERGE_NO_TEXT',
      'Не удалось добавить поддерживаемые текстовые файлы. Проверь формат, кодировку и лимиты.',
    );
  }
  return { files: prepared, skipped, skippedCount, totalInputBytes };
}

export function buildMergedOutput(
  files: MergeInput[],
  format: MergeFormat,
  includeNames: boolean,
): GeneratedFile {
  return mergeTextFiles(files, format, includeNames);
}
