export interface NormalizedFilename {
  filename: string;
  changed: boolean;
  warnings: string[];
}

const INVALID_FILENAME_CHARS = /[\\/:*?"<>|\u0000-\u001F\u007F\u0080-\u009F]/g;
const BIDI_CONTROLS = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\..*)?$/i;
const MAX_SEGMENT_UTF8_BYTES = 180;
const UTF8_ENCODER = new TextEncoder();
const KNOWN_EXTENSIONS = new Set([
  'txt',
  'md',
  'markdown',
  'html',
  'htm',
  'json',
  'csv',
  'xml',
  'zip',
  'png',
  'jpg',
  'jpeg',
  'webp',
  'gif',
  'bmp',
  'svg',
  'avif',
  'ico',
  'pdf',
  'doc',
  'docx',
  'odt',
  'rtf',
  'xls',
  'xlsx',
  'ppt',
  'pptx',
  'js',
  'mjs',
  'cjs',
  'ts',
  'tsx',
  'jsx',
  'py',
  'css',
  'scss',
  'sql',
  'sh',
  'bash',
  'yaml',
  'yml',
  'toml',
  'ini',
  'log',
  'rb',
  'go',
  'rs',
  'java',
  'php',
  'c',
  'cpp',
  'h',
  'hpp',
  'swift',
  'kt',
  'kts',
  'bat',
  'ps1',
  'conf',
  'env',
  'vue',
  'svelte',
  'graphql',
  'gql',
  'proto',
  'diff',
  'patch',
  'mp3',
  'wav',
  'ogg',
  'flac',
  'm4a',
  'aac',
  'mp4',
  'mkv',
  'mov',
  'webm',
  'avi',
  '7z',
  'rar',
  'gz',
  'bz2',
  'xz',
]);

/**
 * Returns the extension (or a recognized extensionless basename) without
 * confusing dots in parent directory names with the file's suffix.
 * Dotfiles such as `.gitignore` are treated as having the extension `gitignore`.
 */
export function getFileExtension(fileName: string): string {
  const basename = fileName.replace(/\\/g, '/').split('/').pop() ?? '';
  if (!basename) return '';

  const lastDot = basename.lastIndexOf('.');
  if (lastDot === 0) return basename.length > 1 ? basename.slice(1).toLowerCase() : '';
  if (lastDot > 0) return lastDot < basename.length - 1 ? basename.slice(lastDot + 1).toLowerCase() : '';
  return basename.toLowerCase();
}

export function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function repairMalformedUnicode(value: string): string {
  let repaired = '';
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        repaired += value[index]! + value[index + 1]!;
        index += 1;
      } else {
        repaired += '_';
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      repaired += '_';
    } else {
      repaired += value[index]!;
    }
  }
  return repaired;
}

function truncateUtf8(value: string, maxBytes: number): string {
  let result = '';
  let bytes = 0;
  for (const character of value) {
    const size = UTF8_ENCODER.encode(character).byteLength;
    if (bytes + size > maxBytes) break;
    result += character;
    bytes += size;
  }
  return result;
}

export function sanitizePathSegment(input: string, fallback = 'file'): NormalizedFilename {
  const warnings: string[] = [];
  const original = input;
  let value = input.normalize('NFC');

  if (!isWellFormedUnicode(value)) {
    value = repairMalformedUnicode(value);
    warnings.push('Некорректные Unicode-последовательности в имени заменены на подчёркивание.');
  }

  const beforeInvalid = value;
  value = value.replace(INVALID_FILENAME_CHARS, '_');
  if (value !== beforeInvalid)
    warnings.push('Недопустимые для имени файла символы заменены на подчёркивание.');

  const beforeBidi = value;
  value = value.replace(BIDI_CONTROLS, '');
  if (value !== beforeBidi) warnings.push('Управляющие Unicode-символы направления текста удалены из имени.');

  value = value.replace(/[. ]+$/g, '').trim();
  if (!value || value === '.' || value === '..') {
    value = fallback;
    warnings.push('Пустое или недопустимое имя заменено безопасным значением.');
  }

  if (WINDOWS_RESERVED.test(value)) {
    value = `_${value}`;
    warnings.push('Зарезервированное системное имя изменено.');
  }

  const truncated = truncateUtf8(value, MAX_SEGMENT_UTF8_BYTES).replace(/[. ]+$/g, '');
  if (truncated !== value) {
    value = truncated || fallback;
    warnings.push(`Имя ограничено ${MAX_SEGMENT_UTF8_BYTES} байтами UTF-8.`);
  }

  return { filename: value, changed: value !== original, warnings: [...new Set(warnings)] };
}

export function normalizeOutputFilename(
  requestedName: string,
  extension: string,
  automaticBase: string,
): NormalizedFilename {
  const normalizedExtension = extension.replace(/^\./, '').toLowerCase();
  if (!/^[a-z0-9]{1,12}$/.test(normalizedExtension)) {
    throw new Error('Внутренняя ошибка: некорректное расширение результата.');
  }

  const source = requestedName.trim() || automaticBase;
  const safe = sanitizePathSegment(source, automaticBase);
  let base = safe.filename;
  const warnings = [...safe.warnings];
  const lastDot = base.lastIndexOf('.');

  // Only replace a suffix that looks like a known file extension. A dotted title
  // such as "report.v2" is a name, not an extension that should be discarded.
  if (lastDot > 0) {
    const typedExtension = base.slice(lastDot + 1).toLowerCase();
    if (typedExtension === normalizedExtension) {
      base = base.slice(0, lastDot);
    } else if (KNOWN_EXTENSIONS.has(typedExtension)) {
      base = base.slice(0, lastDot);
      warnings.push(`Расширение заменено на .${normalizedExtension}, поскольку выбран этот формат.`);
    }
  }

  const finalBase = sanitizePathSegment(base, automaticBase).filename;
  const filename = `${finalBase}.${normalizedExtension}`;
  return {
    filename,
    changed: filename !== `${source}.${normalizedExtension}`,
    warnings: [...new Set(warnings)],
  };
}

export function automaticBase(prefix: string, date = new Date()): string {
  const pad = (value: number, width = 2) => String(value).padStart(width, '0');
  return `${prefix}-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}-${pad(date.getMilliseconds(), 3)}`;
}

export function sanitizeArchivePath(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  if (normalized.startsWith('/') || /^[a-z]:/i.test(normalized)) {
    throw new Error('В архиве обнаружен абсолютный путь. Такой архив отклонён.');
  }
  const segments = normalized.split('/').filter(Boolean);
  if (segments.length > 32) throw new Error('Путь внутри ZIP слишком глубоко вложен.');
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    throw new Error('В архиве обнаружен путь с переходом в другую папку. Такой архив отклонён.');
  }
  const safe = segments.map((segment) => sanitizePathSegment(segment, 'file').filename).join('/');
  if (UTF8_ENCODER.encode(safe).byteLength > 1024) throw new Error('Путь внутри ZIP слишком длинный.');
  return safe;
}
