import { LIMITS } from './config';
import { sanitizeArchivePath } from './file-names';
import { FileForgeError } from './errors';
import { calculateCrc32 } from './crc32';
export { calculateCrc32 } from './crc32';

export interface ZipEntryMetadata {
  name: string;
  compressedSize: number;
  uncompressedSize: number;
  isDirectory: boolean;
  compressionMethod: number;
  crc32: number;
  dataOffset: number;
}

interface ZipRecordRange {
  start: number;
  end: number;
  name: string;
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const DATA_DESCRIPTOR_SIGNATURE = 0x08074b50;
const MAX_EOCD_SEARCH = 65_557;
const MAX_ZIP_NAME_BYTES = 4_096;

function requireRange(view: DataView, offset: number, length: number, message: string): void {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length < 0 ||
    offset + length > view.byteLength
  ) {
    throw new FileForgeError('ZIP_TRUNCATED', message);
  }
}

function verifyExtraFields(view: DataView, offset: number, length: number): void {
  const end = offset + length;
  requireRange(view, offset, length, 'Дополнительные поля ZIP выходят за границы записи.');
  let position = offset;
  while (position < end) {
    requireRange(view, position, 4, 'Дополнительное поле ZIP повреждено.');
    const headerId = view.getUint16(position, true);
    const dataLength = view.getUint16(position + 2, true);
    requireRange(view, position + 4, dataLength, 'Дополнительное поле ZIP обрезано.');
    if (headerId === 0x0001) {
      throw new FileForgeError(
        'ZIP64_UNSUPPORTED',
        'ZIP64 пока не поддерживается. Используйте обычный ZIP-архив.',
      );
    }
    position += 4 + dataLength;
  }
  if (position !== end)
    throw new FileForgeError('ZIP_EXTRA_SIZE', 'Размер дополнительных полей ZIP некорректен.');
}

function decodeEntryName(bytes: Uint8Array, flags: number): string {
  try {
    if ((flags & 0x0800) !== 0 || bytes.every((byte) => byte < 0x80)) {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    }
  } catch {
    // The error below gives a stable user-facing explanation.
  }
  throw new FileForgeError(
    'ZIP_FILENAME_ENCODING',
    'В ZIP есть имя файла в неподдерживаемой кодировке. Пересоздай архив с UTF-8.',
  );
}

function verifyDataDescriptor(
  view: DataView,
  offset: number,
  centralCrc: number,
  compressedSize: number,
  uncompressedSize: number,
): number {
  // The optional signature is ambiguous when the CRC itself equals the signature.
  // Validate both legal layouts instead of assuming that the first word is a marker.
  const matches = (descriptorOffset: number): boolean => {
    if (descriptorOffset + 12 > view.byteLength) return false;
    return (
      view.getUint32(descriptorOffset, true) === centralCrc &&
      view.getUint32(descriptorOffset + 4, true) === compressedSize &&
      view.getUint32(descriptorOffset + 8, true) === uncompressedSize
    );
  };
  const hasSignature =
    offset + 4 <= view.byteLength &&
    view.getUint32(offset, true) === DATA_DESCRIPTOR_SIGNATURE &&
    matches(offset + 4);
  // Prefer the signed layout when both interpretations are mathematically
  // possible (notably when the CRC value equals the optional signature).
  if (hasSignature) return 16;
  if (matches(offset)) return 12;
  throw new FileForgeError(
    'ZIP_DESCRIPTOR_MISMATCH',
    'Дескриптор ZIP отсутствует, обрезан или не совпадает с центральной записью. Архив отклонён.',
  );
}

/**
 * Performs a bounded, non-extracting inspection of a conventional ZIP archive.
 * ZIP64, encrypted, multi-volume and unsupported compression methods fail closed.
 */
export function inspectZipCentralDirectory(buffer: ArrayBuffer): ZipEntryMetadata[] {
  if (buffer.byteLength > LIMITS.merge.maxZipBytes) {
    throw new FileForgeError('ZIP_INPUT_TOO_LARGE', 'ZIP превышает установленный лимит исходного архива.');
  }
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const searchStart = Math.max(0, bytes.length - MAX_EOCD_SEARCH);
  let eocdOffset = -1;

  for (let offset = bytes.length - 22; offset >= searchStart; offset -= 1) {
    if (offset < 0) break;
    if (view.getUint32(offset, true) === EOCD_SIGNATURE) {
      const commentLength = view.getUint16(offset + 20, true);
      if (offset + 22 + commentLength === bytes.length) {
        eocdOffset = offset;
        break;
      }
    }
  }

  if (eocdOffset < 0)
    throw new FileForgeError(
      'ZIP_EOCD_MISSING',
      'В ZIP не найдена корректная центральная директория. Архив отклонён.',
    );
  requireRange(view, eocdOffset, 22, 'ZIP имеет повреждённый заголовок.');

  const diskNumber = view.getUint16(eocdOffset + 4, true);
  const centralDisk = view.getUint16(eocdOffset + 6, true);
  const entriesOnDisk = view.getUint16(eocdOffset + 8, true);
  const totalEntries = view.getUint16(eocdOffset + 10, true);
  const centralSize = view.getUint32(eocdOffset + 12, true);
  const centralOffset = view.getUint32(eocdOffset + 16, true);

  if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== totalEntries) {
    throw new FileForgeError('ZIP_MULTIDISK', 'Многотомные ZIP-архивы не поддерживаются.');
  }
  if (totalEntries === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new FileForgeError(
      'ZIP64_UNSUPPORTED',
      'ZIP64 пока не поддерживается. Используйте обычный ZIP-архив.',
    );
  }
  if (totalEntries > LIMITS.merge.maxFiles + LIMITS.merge.maxFolders) {
    throw new FileForgeError(
      'ZIP_TOO_MANY_ENTRIES',
      `В архиве слишком много элементов. Максимум — ${LIMITS.merge.maxFiles} файлов и ${LIMITS.merge.maxFolders} папок.`,
    );
  }
  if (centralOffset + centralSize !== eocdOffset) {
    throw new FileForgeError(
      'ZIP_CENTRAL_RANGE',
      'Центральная директория ZIP имеет неверное расположение или размер.',
    );
  }

  const entries: ZipEntryMetadata[] = [];
  const names = new Set<string>();
  const localRanges: ZipRecordRange[] = [];
  let position = centralOffset;
  let totalUncompressed = 0;
  let filesCount = 0;
  let directoryCount = 0;

  for (let index = 0; index < totalEntries; index += 1) {
    requireRange(view, position, 46, 'Центральная директория ZIP обрезана.');
    if (view.getUint32(position, true) !== CENTRAL_SIGNATURE) {
      throw new FileForgeError('ZIP_CENTRAL_SIGNATURE', 'Неверная сигнатура записи центральной директории.');
    }

    const versionMadeBy = view.getUint16(position + 4, true);
    const flags = view.getUint16(position + 8, true);
    const compressionMethod = view.getUint16(position + 10, true);
    const crc32 = view.getUint32(position + 16, true);
    const compressedSize = view.getUint32(position + 20, true);
    const uncompressedSize = view.getUint32(position + 24, true);
    const nameLength = view.getUint16(position + 28, true);
    const extraLength = view.getUint16(position + 30, true);
    const commentLength = view.getUint16(position + 32, true);
    const diskStart = view.getUint16(position + 34, true);
    const externalAttributes = view.getUint32(position + 38, true);
    const localHeaderOffset = view.getUint32(position + 42, true);
    const variableLength = nameLength + extraLength + commentLength;

    if (nameLength < 1 || nameLength > MAX_ZIP_NAME_BYTES) {
      throw new FileForgeError(
        'ZIP_NAME_LENGTH',
        'В ZIP обнаружено пустое или чрезмерно длинное имя записи.',
      );
    }
    requireRange(
      view,
      position + 46,
      variableLength,
      'Запись ZIP выходит за границы центральной директории.',
    );
    verifyExtraFields(view, position + 46 + nameLength, extraLength);
    if (diskStart !== 0)
      throw new FileForgeError('ZIP_MULTIDISK_ENTRY', 'Запись ZIP ссылается на другой том архива.');
    if ((flags & 0x0001) !== 0 || (flags & 0x0040) !== 0 || (flags & 0x2000) !== 0) {
      throw new FileForgeError(
        'ZIP_ENCRYPTED',
        'Зашифрованные или использующие маскирование заголовков ZIP-записи не поддерживаются.',
      );
    }
    if (compressionMethod !== 0 && compressionMethod !== 8) {
      throw new FileForgeError(
        'ZIP_COMPRESSION_UNSUPPORTED',
        `Метод сжатия ZIP (${compressionMethod}) не поддерживается.`,
      );
    }
    // STORE has no compression layer: its compressed and uncompressed sizes
    // must be identical. Reject a dishonest central directory during preflight
    // rather than allowing extraction to allocate a copy based on compressedSize.
    if (compressionMethod === 0 && compressedSize !== uncompressedSize) {
      throw new FileForgeError(
        'ZIP_STORED_SIZE',
        'Размер несжатой ZIP-записи не совпадает с размером исходных данных. Архив отклонён.',
      );
    }
    const supportedFlags = (compressionMethod === 8 ? 0x0006 : 0) | 0x0008 | 0x0800;
    if ((flags & ~supportedFlags) !== 0) {
      throw new FileForgeError(
        'ZIP_FLAGS_UNSUPPORTED',
        'ZIP использует неподдерживаемые параметры записи. Архив отклонён.',
      );
    }
    if (
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      localHeaderOffset === 0xffffffff
    ) {
      throw new FileForgeError('ZIP64_UNSUPPORTED', 'ZIP64 пока не поддерживается.');
    }
    if (localHeaderOffset >= centralOffset)
      throw new FileForgeError(
        'ZIP_LOCAL_RANGE',
        'Локальная запись ZIP пересекается с центральной директорией.',
      );
    requireRange(view, localHeaderOffset, 30, 'Локальный заголовок ZIP повреждён.');
    if (view.getUint32(localHeaderOffset, true) !== LOCAL_SIGNATURE) {
      throw new FileForgeError('ZIP_LOCAL_SIGNATURE', 'В ZIP обнаружен повреждённый локальный заголовок.');
    }

    const localFlags = view.getUint16(localHeaderOffset + 6, true);
    const localMethod = view.getUint16(localHeaderOffset + 8, true);
    const localCrc = view.getUint32(localHeaderOffset + 14, true);
    const localCompressedSize = view.getUint32(localHeaderOffset + 18, true);
    const localUncompressedSize = view.getUint32(localHeaderOffset + 22, true);
    const localNameLength = view.getUint16(localHeaderOffset + 26, true);
    const localExtraLength = view.getUint16(localHeaderOffset + 28, true);
    const localExtraOffset = localHeaderOffset + 30 + localNameLength;
    const dataOffset = localExtraOffset + localExtraLength;
    verifyExtraFields(view, localExtraOffset, localExtraLength);
    requireRange(
      view,
      localHeaderOffset + 30,
      localNameLength + localExtraLength + compressedSize,
      'Данные ZIP-записи выходят за границы файла.',
    );

    const rawNameBytes = bytes.slice(position + 46, position + 46 + nameLength);
    const localNameBytes = bytes.slice(localHeaderOffset + 30, localHeaderOffset + 30 + localNameLength);
    if (
      localFlags !== flags ||
      localMethod !== compressionMethod ||
      localNameBytes.length !== rawNameBytes.length ||
      localNameBytes.some((byte, byteIndex) => byte !== rawNameBytes[byteIndex])
    ) {
      throw new FileForgeError(
        'ZIP_HEADER_MISMATCH',
        'Локальный и центральный заголовки ZIP не совпадают. Архив отклонён.',
      );
    }

    const rawName = decodeEntryName(rawNameBytes, flags);
    const unixPlatform = versionMadeBy >>> 8 === 3;
    const unixMode = (externalAttributes >>> 16) & 0xffff;
    const unixType = unixMode & 0xf000;
    if ((externalAttributes & 0x0400) !== 0) {
      throw new FileForgeError('ZIP_REPARSE_POINT', `Reparse point в ZIP не поддерживается: «${rawName}».`);
    }
    if (unixPlatform && unixType === 0xa000) {
      throw new FileForgeError('ZIP_SYMLINK', `Символические ссылки в ZIP не поддерживаются: «${rawName}».`);
    }
    if (unixPlatform && unixType !== 0 && unixType !== 0x8000 && unixType !== 0x4000) {
      throw new FileForgeError(
        'ZIP_SPECIAL_FILE',
        `Специальный тип файла в ZIP не поддерживается: «${rawName}».`,
      );
    }
    const isDirectory =
      rawName.endsWith('/') ||
      rawName.endsWith('\\') ||
      (externalAttributes & 0x10) !== 0 ||
      (unixPlatform && unixType === 0x4000);
    const safeName = sanitizeArchivePath(rawName);
    const normalizedRawName = rawName.replace(/\\/g, '/').replace(/\/+$/g, '');
    if (safeName !== normalizedRawName.normalize('NFC')) {
      throw new FileForgeError(
        'ZIP_UNSAFE_NAME',
        `Имя «${rawName}» содержит недопустимые символы или путь. Архив отклонён.`,
      );
    }
    if (!safeName) throw new FileForgeError('ZIP_EMPTY_PATH', 'В ZIP обнаружена запись без имени.');
    const canonicalName = safeName.toLocaleLowerCase('en-US');
    if (names.has(`path:${canonicalName}`)) {
      throw new FileForgeError('ZIP_DUPLICATE_PATH', `В ZIP повторяется путь «${safeName}».`);
    }
    const segments = canonicalName.split('/');
    for (let depth = 1; depth < segments.length; depth += 1) {
      const ancestor = segments.slice(0, depth).join('/');
      if (names.has(`file:${ancestor}`)) {
        throw new FileForgeError(
          'ZIP_PATH_COLLISION',
          `Путь «${safeName}» конфликтует с файлом «${ancestor}».`,
        );
      }
    }
    if (
      !isDirectory &&
      (names.has(`directory:${canonicalName}`) ||
        names.has(`directory-prefix:${canonicalName}/`) ||
        names.has(`descendant:${canonicalName}`))
    ) {
      throw new FileForgeError(
        'ZIP_PATH_COLLISION',
        `Путь «${safeName}» одновременно используется как файл и папка.`,
      );
    }
    if (isDirectory && names.has(`file:${canonicalName}`)) {
      throw new FileForgeError(
        'ZIP_PATH_COLLISION',
        `Путь «${safeName}» одновременно используется как файл и папка.`,
      );
    }
    names.add(`path:${canonicalName}`);
    names.add(`${isDirectory ? 'directory' : 'file'}:${canonicalName}`);
    if (isDirectory) names.add(`directory-prefix:${canonicalName}/`);
    // Record every ancestor that has a descendant. A later file entry at that
    // ancestor would otherwise collide with an earlier path such as a/b.txt.
    for (let depth = 1; depth < segments.length; depth += 1) {
      names.add(`descendant:${segments.slice(0, depth).join('/')}`);
    }

    const hasDescriptor = (flags & 0x0008) !== 0;
    if (hasDescriptor) {
      if (
        (localCrc !== 0 && localCrc !== crc32) ||
        (localCompressedSize !== 0 && localCompressedSize !== compressedSize) ||
        (localUncompressedSize !== 0 && localUncompressedSize !== uncompressedSize)
      ) {
        throw new FileForgeError(
          'ZIP_LOCAL_SIZE_MISMATCH',
          `Локальные размеры записи «${safeName}» не совпадают с центральными.`,
        );
      }
    } else if (
      localCrc !== crc32 ||
      localCompressedSize !== compressedSize ||
      localUncompressedSize !== uncompressedSize
    ) {
      throw new FileForgeError(
        'ZIP_LOCAL_SIZE_MISMATCH',
        `Локальные размеры записи «${safeName}» не совпадают с центральными.`,
      );
    }

    let recordEnd = dataOffset + compressedSize;
    if (recordEnd > centralOffset)
      throw new FileForgeError(
        'ZIP_DATA_OVERLAP',
        'Данные ZIP-записи пересекаются с центральной директорией.',
      );
    if (hasDescriptor)
      recordEnd += verifyDataDescriptor(view, recordEnd, crc32, compressedSize, uncompressedSize);
    if (recordEnd > centralOffset)
      throw new FileForgeError('ZIP_DESCRIPTOR_RANGE', 'Дескриптор ZIP выходит за границы области данных.');
    localRanges.push({ start: localHeaderOffset, end: recordEnd, name: safeName });

    if (isDirectory) {
      directoryCount += 1;
      if (directoryCount > LIMITS.merge.maxFolders) {
        throw new FileForgeError(
          'ZIP_TOO_MANY_DIRECTORIES',
          `В архиве более ${LIMITS.merge.maxFolders} записей папок. Уменьши структуру архива.`,
        );
      }
    }
    if (
      isDirectory &&
      (compressedSize !== 0 || uncompressedSize !== 0 || crc32 !== 0 || compressionMethod !== 0)
    ) {
      throw new FileForgeError(
        'ZIP_DIRECTORY_DATA',
        `Запись папки «${safeName}» содержит некорректный размер, CRC или метод сжатия.`,
      );
    }
    if (!isDirectory) {
      filesCount += 1;
      if (filesCount > LIMITS.merge.maxFiles) {
        throw new FileForgeError('ZIP_TOO_MANY_FILES', `В архиве более ${LIMITS.merge.maxFiles} файлов.`);
      }
      if (uncompressedSize > LIMITS.merge.maxEntryBytes) {
        throw new FileForgeError(
          'ZIP_ENTRY_TOO_LARGE',
          `Запись «${safeName}» превышает лимит распаковки ${LIMITS.merge.maxEntryBytes / 1024 / 1024} МБ.`,
        );
      }
      totalUncompressed += uncompressedSize;
      if (
        !Number.isSafeInteger(totalUncompressed) ||
        totalUncompressed > LIMITS.merge.maxTotalUncompressedBytes
      ) {
        throw new FileForgeError(
          'ZIP_EXPANSION_TOO_LARGE',
          'Суммарный распакованный размер ZIP превышает установленный лимит.',
        );
      }
      if (uncompressedSize > 0) {
        const ratio = compressedSize === 0 ? Number.POSITIVE_INFINITY : uncompressedSize / compressedSize;
        if (ratio > LIMITS.merge.maxCompressionRatio) {
          throw new FileForgeError(
            'ZIP_RATIO_TOO_HIGH',
            `Запись «${safeName}» имеет подозрительно высокий коэффициент сжатия.`,
          );
        }
      }
    }

    entries.push({
      name: safeName,
      compressedSize,
      uncompressedSize,
      isDirectory,
      compressionMethod,
      crc32,
      dataOffset,
    });
    position += 46 + variableLength;
  }

  if (position !== centralOffset + centralSize) {
    throw new FileForgeError(
      'ZIP_CENTRAL_SIZE_MISMATCH',
      'Размер центральной директории ZIP не совпадает с её содержимым.',
    );
  }
  if (filesCount > LIMITS.merge.maxFiles) {
    throw new FileForgeError('ZIP_TOO_MANY_FILES', `В архиве более ${LIMITS.merge.maxFiles} файлов.`);
  }

  localRanges.sort((left, right) => left.start - right.start);
  for (let index = 1; index < localRanges.length; index += 1) {
    const previous = localRanges[index - 1]!;
    const current = localRanges[index]!;
    if (current.start < previous.end) {
      throw new FileForgeError(
        'ZIP_OVERLAPPING_ENTRIES',
        `Записи «${previous.name}» и «${current.name}» пересекаются в архиве.`,
      );
    }
  }

  return entries;
}

/** Extracts one entry while counting actual output bytes before retaining them. */
export async function extractZipEntryBounded(
  archive: ArrayBuffer,
  entry: ZipEntryMetadata,
  maxOutputBytes: number,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  if (entry.isDirectory) {
    if (
      entry.compressedSize !== 0 ||
      entry.uncompressedSize !== 0 ||
      entry.compressionMethod !== 0 ||
      entry.crc32 !== 0
    ) {
      throw new FileForgeError(
        'ZIP_DIRECTORY_DATA',
        `Запись папки «${entry.name}» содержит некорректный размер, CRC или метод сжатия.`,
      );
    }
    return new Uint8Array();
  }
  if (archive.byteLength > LIMITS.merge.maxZipBytes) {
    throw new FileForgeError('ZIP_INPUT_TOO_LARGE', 'ZIP превышает установленный лимит исходного архива.');
  }
  if (
    !Number.isSafeInteger(maxOutputBytes) ||
    maxOutputBytes < 0 ||
    !Number.isSafeInteger(entry.uncompressedSize) ||
    entry.uncompressedSize < 0 ||
    !Number.isSafeInteger(entry.compressedSize) ||
    entry.compressedSize < 0 ||
    !Number.isSafeInteger(entry.dataOffset) ||
    entry.dataOffset < 0 ||
    !Number.isSafeInteger(entry.crc32) ||
    entry.crc32 < 0 ||
    entry.crc32 > 0xffff_ffff ||
    entry.uncompressedSize > maxOutputBytes ||
    entry.uncompressedSize > LIMITS.merge.maxEntryBytes
  ) {
    throw new FileForgeError('ZIP_ENTRY_LIMIT', `Запись «${entry.name}» превышает лимит распаковки.`);
  }
  if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) {
    throw new FileForgeError(
      'ZIP_COMPRESSION_UNSUPPORTED',
      `Метод сжатия ZIP (${entry.compressionMethod}) не поддерживается.`,
    );
  }
  // This check must precede creation of the copied output buffer below. A
  // malformed STORE entry may declare uncompressedSize=0 but compressedSize
  // close to the 100 MiB archive limit.
  if (entry.compressionMethod === 0 && entry.compressedSize !== entry.uncompressedSize) {
    throw new FileForgeError('ZIP_STORED_SIZE', `Размер несжатой записи «${entry.name}» некорректен.`);
  }
  const dataEnd = entry.dataOffset + entry.compressedSize;
  if (!Number.isSafeInteger(dataEnd) || dataEnd > archive.byteLength) {
    throw new FileForgeError('ZIP_DATA_RANGE', `Данные записи «${entry.name}» выходят за границы архива.`);
  }
  if (signal?.aborted) throw new DOMException('Операция отменена.', 'AbortError');

  const compressed = new Uint8Array(archive, entry.dataOffset, entry.compressedSize);
  let output: Uint8Array;
  if (entry.compressionMethod === 0) {
    output = compressed.slice();
  } else if (entry.compressionMethod === 8) {
    if (typeof DecompressionStream === 'undefined') {
      throw new FileForgeError(
        'ZIP_DECOMPRESSION_UNAVAILABLE',
        'Браузер не поддерживает безопасную потоковую распаковку ZIP. Обнови браузер.',
      );
    }
    let decompressor: DecompressionStream;
    try {
      decompressor = new DecompressionStream('deflate-raw');
    } catch {
      throw new FileForgeError(
        'ZIP_DEFLATE_UNAVAILABLE',
        'Браузер не поддерживает формат сжатия этого ZIP. Архив не распакован.',
      );
    }

    // Allocate once from the already bounded central-directory size. The stream
    // writes directly into this buffer, avoiding a second full-size copy of chunks.
    output = new Uint8Array(entry.uncompressedSize);
    // Feed the view directly to a one-chunk stream. This avoids snapshotting the
    // compressed entry into an intermediate Blob and keeps only the archive buffer
    // plus the bounded output buffer alive during extraction.
    const compressedStream = new ReadableStream<BufferSource>({
      start(controller) {
        if (compressed.byteLength > 0) controller.enqueue(compressed);
        controller.close();
      },
    });
    const stream = compressedStream.pipeThrough(decompressor);
    const reader = stream.getReader();
    let total = 0;
    try {
      while (true) {
        if (signal?.aborted) {
          await reader.cancel();
          throw new DOMException('Операция отменена.', 'AbortError');
        }
        const { value, done } = await reader.read();
        if (done) break;
        if (!value) continue;
        const nextTotal = total + value.byteLength;
        if (
          !Number.isSafeInteger(nextTotal) ||
          nextTotal > maxOutputBytes ||
          nextTotal > entry.uncompressedSize
        ) {
          await reader.cancel();
          throw new FileForgeError(
            'ZIP_DECOMPRESSION_LIMIT',
            `Реальный распакованный размер «${entry.name}» превышает разрешённый. Архив отклонён.`,
          );
        }
        output.set(value, total);
        total = nextTotal;
      }
    } catch (error) {
      try {
        await reader.cancel();
      } catch {
        /* Reader may already be closed. */
      }
      throw error;
    } finally {
      reader.releaseLock();
    }
    if (total !== entry.uncompressedSize) {
      throw new FileForgeError(
        'ZIP_SIZE_MISMATCH',
        `Фактический размер «${entry.name}» не совпадает с размером в ZIP.`,
      );
    }
  } else {
    throw new FileForgeError(
      'ZIP_COMPRESSION_UNSUPPORTED',
      `Метод сжатия ZIP (${entry.compressionMethod}) не поддерживается.`,
    );
  }

  if (calculateCrc32(output) !== entry.crc32) {
    throw new FileForgeError(
      'ZIP_CRC_MISMATCH',
      `Контрольная сумма «${entry.name}» не совпала. Запись повреждена.`,
    );
  }
  return output;
}
