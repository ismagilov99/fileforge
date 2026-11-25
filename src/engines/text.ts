import { LIMITS, type TextFormat, type MergeFormat } from '../core/config';
import { FileForgeError } from '../core/errors';
import { validateTextBytes } from '../core/validation';
import { getFileExtension, isWellFormedUnicode } from '../core/file-names';

export interface GeneratedFile {
  blob: Blob;
  extension: string;
  mime: string;
}

export interface MergeInput {
  name: string;
  content: string;
  size: number;
  sourceArchive?: string;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character]!,
  );
}

function escapeXml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&apos;',
      })[character]!,
  );
}

function utf8Length(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }
  return bytes;
}

function estimateJsonStringBytes(value: string): number {
  let bytes = 2; // Opening and closing quotes.
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    if (
      character === '"' ||
      character === '\\' ||
      codePoint === 0x08 ||
      codePoint === 0x09 ||
      codePoint === 0x0a ||
      codePoint === 0x0c ||
      codePoint === 0x0d
    ) {
      bytes += 2;
    } else if (codePoint < 0x20) {
      bytes += 6;
    } else {
      bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
    }
  }
  return bytes;
}

function estimateEscapedBytes(value: string, format: 'html' | 'xml'): number {
  let bytes = 0;
  for (const character of value) {
    if (character === '&') bytes += 5;
    else if (character === '<' || character === '>') bytes += 4;
    else if (character === '"') bytes += 6;
    else if (character === "'") bytes += format === 'html' ? 5 : 6;
    else bytes += utf8Length(character);
  }
  return bytes;
}

const TEXT_FORMATS: ReadonlySet<string> = new Set(['txt', 'md', 'html', 'json', 'csv', 'xml']);
const MERGE_FORMATS: ReadonlySet<string> = new Set(['txt', 'md', 'html', 'json']);

function assertTextFormat(format: unknown): asserts format is TextFormat {
  if (typeof format !== 'string' || !TEXT_FORMATS.has(format)) {
    throw new FileForgeError('TEXT_FORMAT_UNSUPPORTED', 'Выбран неподдерживаемый формат текстового файла.');
  }
}

function assertMergeFormat(format: unknown): asserts format is MergeFormat {
  if (typeof format !== 'string' || !MERGE_FORMATS.has(format)) {
    throw new FileForgeError(
      'MERGE_FORMAT_UNSUPPORTED',
      'Выбран неподдерживаемый формат объединения файлов.',
    );
  }
}

function assertOutputSize(bytes: number, limit = LIMITS.text.maxOutputBytes): void {
  if (!Number.isSafeInteger(bytes) || bytes > limit) {
    throw new Error(
      `Подготовленный файл превысит лимит результата ${Math.round(limit / 1024 / 1024)} МБ. Уменьши содержимое или выбери более компактный формат.`,
    );
  }
}

function estimateTextExportBytes(text: string, format: TextFormat): number {
  switch (format) {
    case 'txt':
    case 'md':
      return utf8Length(text);
    case 'html': {
      const wrapper =
        '<!doctype html>\n<html lang="ru">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<style>body{margin:2rem auto;padding:0 1rem;max-width:72rem;font:16px/1.65 system-ui,sans-serif;color:#202124}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}</style>\n</head>\n<body>\n<pre>\n</pre>\n</body>\n</html>';
      return utf8Length(wrapper) + estimateEscapedBytes(text, 'html');
    }
    case 'json':
      return estimateJsonStringBytes(text);
    case 'csv': {
      let quotes = 0;
      for (const character of text) if (character === '"') quotes += 1;
      return utf8Length(text) + 2 + quotes;
    }
    case 'xml': {
      const wrapper = '<?xml version="1.0" encoding="UTF-8"?>\n<document></document>';
      return utf8Length(wrapper) + estimateEscapedBytes(text, 'xml');
    }
    default:
      throw new FileForgeError('TEXT_FORMAT_UNSUPPORTED', 'Выбран неподдерживаемый формат текстового файла.');
  }
}

function makeGeneratedFile(content: string, mime: string, extension: string): GeneratedFile {
  const blob = new Blob([content], { type: mime });
  assertOutputSize(blob.size);
  return { blob, extension, mime };
}

function assertXmlCharacters(value: string): void {
  // XML 1.0 legal characters. Invalid C0 controls cannot be represented losslessly.
  const invalid = /[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/u;
  if (invalid.test(value))
    throw new Error(
      'Текст содержит управляющие символы, запрещённые XML 1.0. Выбери TXT, MD или JSON, чтобы сохранить их без потерь.',
    );
}

function csvField(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export function convertText(text: string, format: TextFormat): GeneratedFile {
  assertTextFormat(format);
  if (typeof text !== 'string') {
    throw new FileForgeError('TEXT_INPUT_INVALID', 'Входное содержимое должно быть текстовой строкой.');
  }
  validateTextBytes(text);
  assertOutputSize(estimateTextExportBytes(text, format));
  switch (format) {
    case 'txt':
      return makeGeneratedFile(text, 'text/plain;charset=utf-8', 'txt');
    case 'md':
      return makeGeneratedFile(text, 'text/markdown;charset=utf-8', 'md');
    case 'html': {
      const html = `<!doctype html>\n<html lang="ru">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<style>body{margin:2rem auto;padding:0 1rem;max-width:72rem;font:16px/1.65 system-ui,sans-serif;color:#202124}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}</style>\n</head>\n<body>\n<pre>${escapeHtml(text)}</pre>\n</body>\n</html>`;
      return makeGeneratedFile(html, 'text/html;charset=utf-8', 'html');
    }
    case 'json':
      return makeGeneratedFile(JSON.stringify(text), 'application/json;charset=utf-8', 'json');
    case 'csv':
      return makeGeneratedFile(csvField(text), 'text/csv;charset=utf-8', 'csv');
    case 'xml':
      assertXmlCharacters(text);
      return makeGeneratedFile(
        `<?xml version="1.0" encoding="UTF-8"?>\n<document>${escapeXml(text)}</document>`,
        'application/xml;charset=utf-8',
        'xml',
      );
  }
}

function detectLanguage(fileName: string): string {
  const extension = getFileExtension(fileName);
  const languages: Record<string, string> = {
    js: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    ts: 'typescript',
    tsx: 'tsx',
    jsx: 'jsx',
    dockerfile: 'dockerfile',
    makefile: 'makefile',
    py: 'python',
    html: 'html',
    htm: 'html',
    css: 'css',
    json: 'json',
    csv: 'csv',
    xml: 'xml',
    sql: 'sql',
    sh: 'bash',
    yaml: 'yaml',
    yml: 'yaml',
    toml: 'toml',
    ini: 'ini',
    go: 'go',
    rs: 'rust',
    java: 'java',
    php: 'php',
    rb: 'ruby',
    c: 'c',
    cpp: 'cpp',
    swift: 'swift',
    kt: 'kotlin',
  };
  return languages[extension] ?? '';
}

function escapeMarkdownHeading(value: string): string {
  return value
    .replace(/[&<>]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[character]!)
    .replace(/[\\`*_{}[\]()#+.!|>~-]/g, '\\$&')
    .replace(/[\r\n]+/g, ' ');
}

function escapeMarkdownFence(content: string): string {
  let longestFence = 0;
  let currentRun = 0;
  for (const character of content) {
    if (character === '`') {
      currentRun += 1;
      if (currentRun > longestFence) longestFence = currentRun;
    } else {
      currentRun = 0;
    }
  }
  return '`'.repeat(Math.max(3, longestFence + 1));
}

export function mergeTextFiles(
  files: MergeInput[],
  format: MergeFormat,
  includeNames: boolean,
): GeneratedFile {
  assertMergeFormat(format);
  if (!Array.isArray(files) || files.length === 0) {
    throw new FileForgeError('MERGE_EMPTY', 'Нет текстовых файлов для объединения.');
  }
  if (files.length > LIMITS.merge.maxFiles) {
    throw new FileForgeError(
      'MERGE_COUNT',
      `Можно объединить не более ${LIMITS.merge.maxFiles} текстовых файлов.`,
    );
  }
  if (typeof includeNames !== 'boolean') {
    throw new FileForgeError(
      'MERGE_OPTION_INVALID',
      'Параметр добавления имён файлов имеет некорректное значение.',
    );
  }

  // Treat messages received by the export Worker as untrusted runtime data.
  // TypeScript types do not validate structured-clone messages or modified UI state.
  let totalBytes = 0;
  for (const file of files) {
    if (
      !file ||
      typeof file !== 'object' ||
      typeof file.name !== 'string' ||
      typeof file.content !== 'string' ||
      !isWellFormedUnicode(file.content) ||
      !isWellFormedUnicode(file.name)
    ) {
      throw new FileForgeError(
        'MERGE_INVALID_INPUT',
        'Имя или содержимое одного из файлов некорректно. Результат не создан.',
      );
    }
    const contentBytes = utf8Length(file.content);
    if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size !== contentBytes) {
      throw new FileForgeError(
        'MERGE_SIZE_MISMATCH',
        `Размер текстового файла «${file.name}» не совпадает с фактическим содержимым.`,
      );
    }
    if (contentBytes > LIMITS.merge.maxEntryBytes) {
      throw new FileForgeError(
        'MERGE_ENTRY_TOO_LARGE',
        `Текстовый файл «${file.name}» превышает лимит ${LIMITS.merge.maxEntryBytes / 1024 / 1024} МБ.`,
      );
    }
    totalBytes += contentBytes;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > LIMITS.merge.maxTotalUncompressedBytes) {
      throw new FileForgeError(
        'MERGE_TOTAL_TOO_LARGE',
        `Общий объём исходного текста превышает лимит ${LIMITS.merge.maxTotalUncompressedBytes / 1024 / 1024} МБ.`,
      );
    }
  }

  // Estimate the encoded output before allocating the potentially expanded result string.
  // This matters for escaped HTML/XML/JSON and for Markdown fences around backtick-heavy text.
  let estimatedOutputBytes = 0;
  switch (format) {
    case 'txt':
      estimatedOutputBytes =
        totalBytes +
        Math.max(0, files.length - 1) * 2 +
        (includeNames ? files.reduce((sum, file) => sum + utf8Length(file.name) + 1, 0) : 0);
      break;
    case 'md':
      estimatedOutputBytes = Math.max(0, files.length - 1) * 2;
      for (const file of files) {
        if (!includeNames) {
          estimatedOutputBytes += utf8Length(file.content);
          continue;
        }
        const fence = escapeMarkdownFence(file.content);
        const language = detectLanguage(file.name);
        const heading = escapeMarkdownHeading(file.name);
        estimatedOutputBytes +=
          utf8Length(`## ${heading}\n\n${fence}${language}\n`) +
          utf8Length(file.content) +
          1 +
          utf8Length(fence);
      }
      break;
    case 'html': {
      estimatedOutputBytes =
        utf8Length(
          '<!doctype html>\n<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:2rem auto;padding:0 1rem;max-width:72rem;font:16px/1.65 system-ui,sans-serif;color:#202124}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}section+section{border-top:1px solid #ddd;margin-top:2rem;padding-top:2rem}</style></head><body></body></html>',
        ) + Math.max(0, files.length - 1);
      for (const file of files) {
        estimatedOutputBytes +=
          utf8Length('<section>') +
          utf8Length('</section>') +
          utf8Length('<pre>') +
          utf8Length('</pre>') +
          estimateEscapedBytes(file.content, 'html') +
          (includeNames
            ? utf8Length('<h2>') + estimateEscapedBytes(file.name, 'html') + utf8Length('</h2>')
            : 0);
      }
      break;
    }
    case 'json':
      estimatedOutputBytes = 2; // Opening and closing array brackets.
      if (files.length) estimatedOutputBytes += 4 + 2; // [\n  ...\n]
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index]!;
        if (index > 0) estimatedOutputBytes += 4; // Comma, newline and two indentation spaces.
        if (includeNames) {
          estimatedOutputBytes +=
            utf8Length('{\n    "name": ') +
            estimateJsonStringBytes(file.name) +
            utf8Length(',\n    "content": ') +
            estimateJsonStringBytes(file.content) +
            utf8Length('\n  }');
        } else {
          estimatedOutputBytes += estimateJsonStringBytes(file.content);
        }
      }
      break;
  }
  assertOutputSize(estimatedOutputBytes, LIMITS.merge.maxOutputBytes);

  let content: string;
  let mime: string;
  switch (format) {
    case 'txt':
      content = files
        .map((file) => (includeNames ? `${file.name}\n${file.content}` : file.content))
        .join('\n\n');
      mime = 'text/plain;charset=utf-8';
      break;
    case 'md':
      content = files
        .map((file) => {
          if (!includeNames) return file.content;
          const fence = escapeMarkdownFence(file.content);
          const language = detectLanguage(file.name);
          return `## ${escapeMarkdownHeading(file.name)}\n\n${fence}${language}\n${file.content}\n${fence}`;
        })
        .join('\n\n');
      mime = 'text/markdown;charset=utf-8';
      break;
    case 'html': {
      content = `<!doctype html>\n<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:2rem auto;padding:0 1rem;max-width:72rem;font:16px/1.65 system-ui,sans-serif;color:#202124}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}section+section{border-top:1px solid #ddd;margin-top:2rem;padding-top:2rem}</style></head><body>${files.map((file) => `<section>${includeNames ? `<h2>${escapeHtml(file.name)}</h2>` : ''}<pre>${escapeHtml(file.content)}</pre></section>`).join('\n')}</body></html>`;
      mime = 'text/html;charset=utf-8';
      break;
    }
    case 'json':
      content = JSON.stringify(
        includeNames
          ? files.map((file) => ({ name: file.name, content: file.content }))
          : files.map((file) => file.content),
        null,
        2,
      );
      mime = 'application/json;charset=utf-8';
      break;
    default:
      throw new FileForgeError(
        'MERGE_FORMAT_UNSUPPORTED',
        'Выбран неподдерживаемый формат объединения файлов.',
      );
  }

  const blob = new Blob([content], { type: mime });
  if (blob.size > LIMITS.merge.maxOutputBytes)
    throw new Error(
      `Результат превышает лимит ${LIMITS.merge.maxOutputBytes / 1024 / 1024} МБ. Измени набор файлов или формат.`,
    );
  return { blob, extension: format === 'html' ? 'html' : format, mime };
}
