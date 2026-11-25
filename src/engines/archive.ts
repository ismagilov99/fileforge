import JSZip from 'jszip';
import { LIMITS } from '../core/config';
import { validateBatch } from '../core/validation';
import { getFileExtension, sanitizePathSegment } from '../core/file-names';

export interface ArchiveItem {
  id: string;
  file: File;
  name: string;
  folder: string;
}

export interface ArchiveProgress {
  percent: number;
  current: number;
  total: number;
}

export function validateArchiveBatch(current: ArchiveItem[], incoming: File[]): void {
  const currentFiles = current.map((item) => item.file);
  validateBatch(
    [...currentFiles, ...incoming],
    LIMITS.archive.maxFiles,
    LIMITS.archive.maxFileBytes,
    LIMITS.archive.maxTotalBytes,
  );
}

export function autoSortFolder(fileName: string): string {
  const extension = getFileExtension(fileName);
  const categories: Record<string, string[]> = {
    Images: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico', 'avif'],
    Documents: ['txt', 'md', 'pdf', 'doc', 'docx', 'rtf', 'odt', 'html', 'htm', 'csv', 'xlsx', 'pptx'],
    Code: [
      'js',
      'mjs',
      'ts',
      'tsx',
      'jsx',
      'py',
      'java',
      'c',
      'cpp',
      'h',
      'css',
      'json',
      'xml',
      'yaml',
      'yml',
      'sql',
      'sh',
      'go',
      'rs',
      'php',
      'rb',
      'dockerfile',
      'makefile',
      'gitignore',
      'env',
      'conf',
    ],
    Audio: ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac'],
    Video: ['mp4', 'mkv', 'mov', 'webm', 'avi'],
  };
  for (const [folder, extensions] of Object.entries(categories))
    if (extensions.includes(extension)) return folder;
  return 'Other';
}

function makeUniquePath(path: string, usedFiles: Set<string>, usedDirectories: Set<string>): string {
  const slash = path.lastIndexOf('/');
  const folder = slash >= 0 ? path.slice(0, slash + 1) : '';
  const name = slash >= 0 ? path.slice(slash + 1) : path;
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : '';
  const canonical = (value: string) => value.toLocaleLowerCase('en-US');

  const conflicts = (candidate: string): boolean => {
    const key = canonical(candidate);
    if (usedFiles.has(key) || usedDirectories.has(key)) return true;
    const segments = key.split('/');
    for (let depth = 1; depth < segments.length; depth += 1) {
      if (usedFiles.has(segments.slice(0, depth).join('/'))) return true;
    }
    // A file cannot occupy a path which is already needed as a directory, nor
    // can it become an ancestor of a previously registered descendant. The
    // latter matters if nested folders are enabled by a future UI revision.
    for (const existing of usedFiles) {
      if (existing.startsWith(`${key}/`)) return true;
    }
    for (const directory of usedDirectories) {
      if (directory.startsWith(`${key}/`)) return true;
    }
    return false;
  };

  let candidate = path;
  let number = 1;
  while (conflicts(candidate)) {
    candidate = `${folder}${base} (${number})${extension}`;
    number += 1;
    if (number > 10_000) throw new Error('Не удалось подобрать уникальное имя файла для ZIP.');
  }
  usedFiles.add(canonical(candidate));
  return candidate;
}

export async function createArchive(
  files: ArchiveItem[],
  folders: string[],
  signal: AbortSignal,
  onProgress: (progress: ArchiveProgress) => void,
): Promise<Blob> {
  if (!files.length) throw new Error('Добавь файлы в архив.');
  validateBatch(
    files.map((item) => item.file),
    LIMITS.archive.maxFiles,
    LIMITS.archive.maxFileBytes,
    LIMITS.archive.maxTotalBytes,
  );
  if (folders.length > LIMITS.archive.maxFolders)
    throw new Error(`В ZIP можно создать не более ${LIMITS.archive.maxFolders} папок.`);
  const zip = new JSZip();
  const usedFiles = new Set<string>();
  const usedDirectories = new Set<string>();
  const normalizedFolders = new Map<string, string>();
  const zipDate = new Date('1980-01-01T00:00:00.000Z');

  for (const folder of folders) {
    if (typeof folder !== 'string' || folder.length > 255)
      throw new Error('Название папки некорректно или слишком длинное.');
    const safeFolder = sanitizePathSegment(folder, 'folder').filename;
    const key = safeFolder.toLocaleLowerCase('en-US');
    if (!normalizedFolders.has(key)) normalizedFolders.set(key, safeFolder);
  }
  for (const item of files) {
    if (item.folder) {
      const safeFolder = sanitizePathSegment(item.folder, 'folder').filename;
      const key = safeFolder.toLocaleLowerCase('en-US');
      if (!normalizedFolders.has(key)) normalizedFolders.set(key, safeFolder);
    }
  }
  if (normalizedFolders.size > LIMITS.archive.maxFolders) {
    throw new Error(
      `В ZIP можно создать не более ${LIMITS.archive.maxFolders} уникальных папок, включая папки, назначенные файлам.`,
    );
  }

  // Reserve explicit folders before file paths so a same-named root file is
  // renamed deterministically instead of creating an ambiguous ZIP tree.
  for (const [key, folder] of normalizedFolders) {
    if (signal.aborted) throw new DOMException('Операция отменена.', 'AbortError');
    if (usedFiles.has(key)) throw new Error(`Конфликт имени папки «${folder}» в архиве.`);
    usedDirectories.add(key);
    zip.file(`${folder}/`, null, { dir: true, date: zipDate });
  }

  let processed = 0;
  const alreadyCompressed = new Set([
    '7z',
    'aac',
    'avif',
    'avi',
    'bmp',
    'bz2',
    'flac',
    'gif',
    'gz',
    'heic',
    'jpeg',
    'jpg',
    'm4a',
    'mkv',
    'mov',
    'mp3',
    'mp4',
    'pdf',
    'png',
    'rar',
    'webm',
    'webp',
    'xz',
    'zip',
  ]);

  for (const item of files) {
    if (signal.aborted) throw new DOMException('Операция отменена.', 'AbortError');
    const safeFileName = sanitizePathSegment(item.name, 'file').filename;
    const safeFolder = item.folder ? sanitizePathSegment(item.folder, 'folder').filename : '';
    const folderPrefix = safeFolder
      ? `${normalizedFolders.get(safeFolder.toLocaleLowerCase('en-US')) ?? safeFolder}/`
      : '';
    const path = makeUniquePath(`${folderPrefix}${safeFileName}`, usedFiles, usedDirectories);
    const extension = getFileExtension(safeFileName);
    zip.file(path, item.file, {
      binary: true,
      date: zipDate,
      compression: alreadyCompressed.has(extension) ? 'STORE' : 'DEFLATE',
      compressionOptions: { level: 6 },
    });
    processed += 1;
    onProgress({ percent: (processed / files.length) * 20, current: processed, total: files.length });
  }

  if (signal.aborted) throw new DOMException('Операция отменена.', 'AbortError');
  const blob = await zip.generateAsync(
    {
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
      streamFiles: true,
      mimeType: 'application/zip',
    },
    (metadata) => {
      if (signal.aborted) throw new DOMException('Операция отменена.', 'AbortError');
      onProgress({ percent: 20 + metadata.percent * 0.8, current: files.length, total: files.length });
    },
  );
  if (blob.type !== 'application/zip' || blob.size < 22)
    throw new Error('ZIP-библиотека вернула некорректный архив.');
  if (blob.size > LIMITS.archive.maxOutputBytes)
    throw new Error(
      `Созданный архив превышает лимит результата ${LIMITS.archive.maxOutputBytes / 1024 / 1024} МБ. Уменьши набор файлов.`,
    );
  return blob;
}
