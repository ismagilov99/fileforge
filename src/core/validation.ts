import DOMPurify from 'dompurify';
import { IMAGE_INPUT_EXTENSIONS, LIMITS, TEXT_EXTENSIONS } from './config';
import { FileForgeError } from './errors';
import { calculateCrc32 } from './crc32';
import { getFileExtension, isWellFormedUnicode } from './file-names';

export type DetectedFileType = 'png' | 'jpeg' | 'gif' | 'bmp' | 'webp' | 'svg' | 'zip' | 'text' | 'unknown';

const SIGNATURES: Array<{
  type: DetectedFileType;
  bytes: number[];
  offset?: number;
  extra?: { offset: number; bytes: number[] };
}> = [
  { type: 'png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { type: 'jpeg', bytes: [0xff, 0xd8, 0xff] },
  { type: 'gif', bytes: [0x47, 0x49, 0x46, 0x38] },
  { type: 'bmp', bytes: [0x42, 0x4d] },
  { type: 'webp', bytes: [0x52, 0x49, 0x46, 0x46], extra: { offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] } },
  { type: 'zip', bytes: [0x50, 0x4b, 0x03, 0x04] },
];

function matches(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

export async function detectFileType(file: File): Promise<DetectedFileType> {
  const header = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  for (const signature of SIGNATURES) {
    if (
      matches(header, signature.bytes, signature.offset ?? 0) &&
      (!signature.extra || matches(header, signature.extra.bytes, signature.extra.offset))
    ) {
      return signature.type;
    }
  }

  const extension = getFileExtension(file.name);
  if (extension === 'svg' || file.type === 'image/svg+xml') {
    const head = await file.slice(0, Math.min(file.size, 4096)).text();
    if (/<svg(?:\s|>)/i.test(head) || /<\?xml[\s\S]*?<svg(?:\s|>)/i.test(head)) return 'svg';
    return 'unknown';
  }

  if (TEXT_EXTENSIONS.has(extension) || file.type.startsWith('text/')) return 'text';
  return 'unknown';
}

export function validateFileSize(file: File, maxBytes: number): void {
  if (!Number.isSafeInteger(file.size) || file.size < 0) {
    throw new FileForgeError('INVALID_FILE_SIZE', `Не удалось определить размер файла «${file.name}».`);
  }
  if (file.size > maxBytes) {
    throw new FileForgeError(
      'FILE_TOO_LARGE',
      `Файл «${file.name}» превышает лимит ${formatBytes(maxBytes)}.`,
    );
  }
}

export function validateFileName(file: File): void {
  if (
    !file.name ||
    file.name.length > 255 ||
    !isWellFormedUnicode(file.name) ||
    /[\\/\u0000-\u001f\u007f\u0080-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/i.test(file.name)
  ) {
    throw new FileForgeError('INVALID_FILE_NAME', 'У файла некорректное или слишком длинное имя.');
  }
}

export function validateBatch(files: File[], maxFiles: number, maxEach: number, maxTotal: number): void {
  if (files.length === 0) throw new FileForgeError('EMPTY_BATCH', 'Сначала добавьте хотя бы один файл.');
  if (files.length > maxFiles)
    throw new FileForgeError(
      'TOO_MANY_FILES',
      `Можно добавить не более ${maxFiles} файлов за одну операцию.`,
    );
  let total = 0;
  for (const file of files) {
    validateFileName(file);
    validateFileSize(file, maxEach);
    total += file.size;
    if (!Number.isSafeInteger(total) || total > maxTotal) {
      throw new FileForgeError(
        'BATCH_TOO_LARGE',
        `Общий размер файлов превышает лимит ${formatBytes(maxTotal)}.`,
      );
    }
  }
}

export function sanitizeSvg(source: string): string {
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(source)) {
    throw new FileForgeError(
      'SVG_DTD_FORBIDDEN',
      'SVG с DTD или пользовательскими сущностями не поддерживается.',
    );
  }
  if (typeof DOMPurify?.sanitize !== 'function') {
    throw new FileForgeError(
      'SANITIZER_UNAVAILABLE',
      'Защитный модуль SVG недоступен. SVG не обработан. Обновите страницу и попробуйте ещё раз.',
    );
  }

  const clean = DOMPurify.sanitize(source, {
    USE_PROFILES: { svg: true, svgFilters: false },
    FORBID_TAGS: [
      'script',
      'foreignObject',
      'iframe',
      'embed',
      'object',
      'audio',
      'video',
      'style',
      'image',
      'use',
      'a',
      'feImage',
      'animate',
      'animateTransform',
      'animateMotion',
      'set',
      'discard',
    ],
    FORBID_ATTR: [
      'style',
      'href',
      'xlink:href',
      'src',
      'onload',
      'onerror',
      'onclick',
      'onmouseover',
      'onfocus',
      'xml:base',
    ],
    ALLOW_DATA_ATTR: false,
    SANITIZE_NAMED_PROPS: true,
  });

  const parsed = new DOMParser().parseFromString(clean, 'image/svg+xml');
  const root = parsed.documentElement;
  if (parsed.querySelector('parsererror') || root.localName.toLowerCase() !== 'svg') {
    throw new FileForgeError('SVG_PARSE_ERROR', 'SVG имеет некорректную XML-структуру или корневой элемент.');
  }

  // SVG supports URL-bearing presentation attributes. Permit only local fragments
  // so the exported image cannot make network requests or reference external files.
  for (const element of Array.from(parsed.querySelectorAll('*'))) {
    for (const attribute of Array.from(element.attributes)) {
      const references = Array.from(attribute.value.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi));
      if (references.some((match) => !/^#[\w:.-]+$/.test((match[2] ?? '').trim()))) {
        throw new FileForgeError(
          'SVG_EXTERNAL_REFERENCE',
          'SVG содержит внешнюю ссылку на ресурс. Такие ссылки запрещены.',
        );
      }
    }
  }

  return new XMLSerializer().serializeToString(parsed);
}

export function readSvgDimensions(source: string): ImageDimensions {
  const document = new DOMParser().parseFromString(source, 'image/svg+xml');
  if (document.querySelector('parsererror') || document.documentElement.localName.toLowerCase() !== 'svg') {
    throw new FileForgeError('SVG_PARSE_ERROR', 'SVG содержит некорректную XML-структуру.');
  }
  const root = document.documentElement;
  const parseLength = (value: string | null): number | null => {
    if (!value) return null;
    const match = value.trim().match(/^([0-9]+(?:\.[0-9]+)?)(?:px)?$/i);
    if (!match) return null;
    const numeric = Number(match[1]);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
  };
  const viewBoxParts = root
    .getAttribute('viewBox')
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  const viewBoxValid =
    viewBoxParts?.length === 4 &&
    viewBoxParts.every(Number.isFinite) &&
    viewBoxParts[2]! > 0 &&
    viewBoxParts[3]! > 0;
  const width = parseLength(root.getAttribute('width')) ?? (viewBoxValid ? viewBoxParts![2]! : null);
  const height = parseLength(root.getAttribute('height')) ?? (viewBoxValid ? viewBoxParts![3]! : null);
  if (!width || !height) {
    throw new FileForgeError(
      'SVG_SIZE_MISSING',
      'В SVG должны быть заданы положительные width/height или корректный viewBox.',
    );
  }
  return validDimensions(Math.ceil(width), Math.ceil(height));
}

export function validateImageInputType(type: DetectedFileType, file: File): void {
  const extension = getFileExtension(file.name);
  const expectedType: Record<string, DetectedFileType> = {
    png: 'png',
    jpg: 'jpeg',
    jpeg: 'jpeg',
    gif: 'gif',
    bmp: 'bmp',
    webp: 'webp',
    svg: 'svg',
  };
  if (!IMAGE_INPUT_EXTENSIONS.has(extension) || expectedType[extension] !== type) {
    throw new FileForgeError(
      'IMAGE_TYPE_EXTENSION_MISMATCH',
      `Расширение файла «${file.name}» не соответствует фактическому формату содержимого (${type}). Переименуй файл в соответствии с форматом или выбери оригинал.`,
    );
  }
}

export interface TextMetrics {
  bytes: number;
  codePoints: number;
  wellFormed: boolean;
}

/**
 * Counts UTF-8 bytes and Unicode scalar values in one pass without allocating
 * a Blob, TextEncoder buffer or Array.from() copy on every textarea keystroke.
 * Lone surrogates are counted as the three-byte U+FFFD replacement for display,
 * but `wellFormed` remains false and export validation rejects the input.
 */
export function measureText(text: string): TextMetrics {
  let bytes = 0;
  let codePoints = 0;
  let wellFormed = true;

  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    codePoints += 1;

    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
        wellFormed = false;
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      bytes += 3;
      wellFormed = false;
    } else if (code <= 0x7f) {
      bytes += 1;
    } else if (code <= 0x7ff) {
      bytes += 2;
    } else {
      bytes += 3;
    }
  }

  return { bytes, codePoints, wellFormed };
}

export function validateTextBytes(text: string): number {
  const metrics = measureText(text);
  // Blob/TextEncoder replace unpaired UTF-16 surrogates with U+FFFD. Reject them
  // instead of silently changing the user's original text.
  if (!metrics.wellFormed) {
    throw new FileForgeError(
      'TEXT_INVALID_UNICODE',
      'Текст содержит некорректную Unicode-последовательность. Она не была изменена. Исправь символ или выбери другой источник текста.',
    );
  }
  if (metrics.bytes > LIMITS.text.maxBytes) {
    throw new FileForgeError(
      'TEXT_TOO_LARGE',
      `Текст занимает ${formatBytes(metrics.bytes)}. Лимит — ${formatBytes(LIMITS.text.maxBytes)}.`,
    );
  }
  return metrics.bytes;
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Б';
  const units = ['Б', 'КБ', 'МБ', 'ГБ'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export function isLikelyTextExtension(fileName: string): boolean {
  const ext = getFileExtension(fileName);
  return TEXT_EXTENSIONS.has(ext);
}

export interface ImageDimensions {
  width: number;
  height: number;
}

function validDimensions(width: number, height: number): ImageDimensions {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    throw new FileForgeError(
      'IMAGE_DIMENSIONS_INVALID',
      'Не удалось безопасно определить размеры изображения.',
    );
  }
  if (
    width > LIMITS.image.maxInputDimension ||
    height > LIMITS.image.maxInputDimension ||
    width * height > LIMITS.image.maxPixels
  ) {
    throw new FileForgeError(
      'IMAGE_PIXEL_LIMIT',
      `Изображение превышает безопасный лимит декодирования: ${LIMITS.image.maxInputDimension.toLocaleString('ru-RU')} пикселей по стороне и ${formatBytes(LIMITS.image.maxPixels * 4)} памяти пикселей в оценочном RGBA-представлении.`,
    );
  }
  return { width, height };
}

export async function readImageDimensions(file: File, type: DetectedFileType): Promise<ImageDimensions> {
  if (type === 'png') {
    const raw = new Uint8Array(await file.slice(0, 33).arrayBuffer());
    if (raw.byteLength < 33) throw new FileForgeError('PNG_HEADER_TRUNCATED', 'Заголовок PNG повреждён.');
    const bytes = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    if (bytes.getUint32(8, false) !== 13 || bytes.getUint32(12, false) !== 0x49484452) {
      throw new FileForgeError(
        'PNG_IHDR_INVALID',
        'Первый блок PNG не является корректным IHDR. Файл отклонён до декодирования.',
      );
    }
    const actualCrc = calculateCrc32(raw.subarray(12, 29));
    if (actualCrc !== bytes.getUint32(29, false)) {
      throw new FileForgeError(
        'PNG_IHDR_CRC',
        'Контрольная сумма заголовка PNG не совпадает. Файл отклонён до декодирования.',
      );
    }
    return validDimensions(bytes.getUint32(16, false), bytes.getUint32(20, false));
  }

  if (type === 'gif') {
    const raw = new Uint8Array(await file.slice(0, 13).arrayBuffer());
    if (raw.byteLength < 13) throw new FileForgeError('GIF_HEADER_TRUNCATED', 'Заголовок GIF повреждён.');
    const signature = new TextDecoder('ascii').decode(raw.subarray(0, 6));
    if (signature !== 'GIF87a' && signature !== 'GIF89a') {
      throw new FileForgeError('GIF_HEADER_INVALID', 'Заголовок GIF имеет неподдерживаемую сигнатуру.');
    }
    const bytes = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    return validDimensions(bytes.getUint16(6, true), bytes.getUint16(8, true));
  }

  if (type === 'bmp') {
    const bytes = new DataView(await file.slice(0, 54).arrayBuffer());
    if (file.size < 54 || bytes.byteLength < 54)
      throw new FileForgeError('BMP_HEADER_TRUNCATED', 'Заголовок BMP повреждён.');
    const headerSize = bytes.getUint32(14, true);
    const supportedHeaders = new Set([40, 52, 56, 108, 124]);
    if (!supportedHeaders.has(headerSize)) {
      throw new FileForgeError(
        'BMP_HEADER_UNSUPPORTED',
        'Поддерживаются стандартные BMP DIB-заголовки размером 40, 52, 56, 108 или 124 байта.',
      );
    }
    const metadataEnd = 14 + headerSize;
    if (metadataEnd > file.size) {
      throw new FileForgeError('BMP_HEADER_TRUNCATED', 'DIB-заголовок BMP выходит за границы файла.');
    }
    const pixelOffset = bytes.getUint32(10, true);
    if (pixelOffset < metadataEnd || pixelOffset > file.size) {
      throw new FileForgeError(
        'BMP_PIXEL_OFFSET',
        'Смещение пиксельных данных BMP находится вне допустимой области файла.',
      );
    }
    const width = bytes.getInt32(18, true);
    const rawHeight = bytes.getInt32(22, true);
    return validDimensions(width, Math.abs(rawHeight));
  }

  if (type === 'webp') {
    const bytes = new Uint8Array(await file.slice(0, 64).arrayBuffer());
    if (file.size < 20 || bytes.length < 16)
      throw new FileForgeError('WEBP_HEADER_TRUNCATED', 'Заголовок WebP повреждён.');
    const webpView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const riffSize = webpView.getUint32(4, true);
    if (riffSize + 8 !== file.size) {
      throw new FileForgeError(
        'WEBP_RIFF_SIZE',
        'Размер RIFF в заголовке WebP не совпадает с размером файла. Файл отклонён.',
      );
    }
    const chunkSize = webpView.getUint32(16, true);
    if (chunkSize > file.size - 20) {
      throw new FileForgeError(
        'WEBP_CHUNK_SIZE',
        'Размер первого изображения WebP выходит за границы файла.',
      );
    }
    const ascii = (offset: number, value: string) =>
      value.split('').every((char, index) => bytes[offset + index] === char.charCodeAt(0));
    if (bytes.length >= 30 && ascii(12, 'VP8X')) {
      if (chunkSize !== 10)
        throw new FileForgeError('WEBP_VP8X_SIZE', 'Расширенный заголовок VP8X имеет неверный размер.');
      const width = 1 + bytes[24]! + (bytes[25]! << 8) + (bytes[26]! << 16);
      const height = 1 + bytes[27]! + (bytes[28]! << 8) + (bytes[29]! << 16);
      return validDimensions(width, height);
    }
    if (bytes.length >= 25 && ascii(12, 'VP8L') && chunkSize >= 5 && bytes[20] === 0x2f) {
      const width = 1 + (((bytes[22]! & 0x3f) << 8) | bytes[21]!);
      const height = 1 + (((bytes[24]! & 0x0f) << 10) | (bytes[23]! << 2) | ((bytes[22]! & 0xc0) >> 6));
      return validDimensions(width, height);
    }
    if (
      bytes.length >= 30 &&
      ascii(12, 'VP8 ') &&
      chunkSize >= 10 &&
      bytes[23] === 0x9d &&
      bytes[24] === 0x01 &&
      bytes[25] === 0x2a
    ) {
      const width = (bytes[26]! | (bytes[27]! << 8)) & 0x3fff;
      const height = (bytes[28]! | (bytes[29]! << 8)) & 0x3fff;
      return validDimensions(width, height);
    }
    throw new FileForgeError(
      'WEBP_HEADER_UNSUPPORTED',
      'Не удалось прочитать размеры WebP. Файл отклонён до декодирования.',
    );
  }

  if (type === 'jpeg') {
    const bytes = new Uint8Array(await file.slice(0, Math.min(file.size, 1024 * 1024)).arrayBuffer());
    let offset = 2;
    const sof = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
    while (offset + 4 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      while (bytes[offset] === 0xff) offset += 1;
      const marker = bytes[offset]!;
      offset += 1;
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) break;
      const segmentLength = (bytes[offset]! << 8) | bytes[offset + 1]!;
      if (segmentLength < 2 || offset + segmentLength > bytes.length) break;
      if (sof.has(marker)) {
        if (segmentLength < 8) {
          throw new FileForgeError('JPEG_FRAME_INVALID', 'Заголовок кадра JPEG слишком короткий.');
        }
        const components = bytes[offset + 7]!;
        if (components < 1 || components > 4 || segmentLength !== 8 + components * 3) {
          throw new FileForgeError('JPEG_FRAME_INVALID', 'Структура компонентов кадра JPEG некорректна.');
        }
        const height = (bytes[offset + 3]! << 8) | bytes[offset + 4]!;
        const width = (bytes[offset + 5]! << 8) | bytes[offset + 6]!;
        return validDimensions(width, height);
      }
      offset += segmentLength;
    }
    throw new FileForgeError(
      'JPEG_DIMENSIONS_MISSING',
      'Не удалось прочитать размеры JPEG в первом мегабайте файла. Файл отклонён до декодирования.',
    );
  }

  if (type === 'svg') {
    if (file.size > LIMITS.image.maxSvgBytes)
      throw new FileForgeError(
        'SVG_TOO_LARGE',
        `SVG превышает лимит ${formatBytes(LIMITS.image.maxSvgBytes)}.`,
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
    return readSvgDimensions(sanitizeSvg(source));
  }

  throw new FileForgeError(
    'IMAGE_DIMENSIONS_UNSUPPORTED',
    'Не удалось безопасно определить размер этого изображения.',
  );
}
