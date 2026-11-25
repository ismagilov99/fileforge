import type { ImageOutput, MergeFormat, TextFormat } from '../core/config';
import { requestWorker, type WorkerProgress } from '../core/worker-client';
import type { ArchiveItem, ArchiveProgress } from './archive';
import type { GeneratedFile, MergeInput } from './text';
import type { MergePreparationResult } from './merge';

export function exportTextInWorker(
  text: string,
  format: TextFormat,
  signal: AbortSignal,
  onProgress?: (progress: WorkerProgress) => void,
): Promise<GeneratedFile> {
  return requestWorker(
    () =>
      new Worker(new URL('../workers/export.worker.ts', import.meta.url), {
        type: 'module',
        name: 'fileforge-export-worker',
      }),
    { type: 'text', text, format },
    signal,
    onProgress,
  );
}

export function prepareMergeInWorker(files: File[], signal: AbortSignal): Promise<MergePreparationResult> {
  return requestWorker(
    () =>
      new Worker(new URL('../workers/merge-import.worker.ts', import.meta.url), {
        type: 'module',
        name: 'fileforge-merge-import-worker',
      }),
    { type: 'prepare', files },
    signal,
  );
}

export function mergeFilesInWorker(
  files: MergeInput[],
  format: MergeFormat,
  includeNames: boolean,
  signal: AbortSignal,
  onProgress?: (progress: WorkerProgress) => void,
): Promise<GeneratedFile> {
  return requestWorker(
    () =>
      new Worker(new URL('../workers/export.worker.ts', import.meta.url), {
        type: 'module',
        name: 'fileforge-merge-worker',
      }),
    { type: 'merge', files, format, includeNames },
    signal,
    onProgress,
  );
}

export function createArchiveInWorker(
  files: ArchiveItem[],
  folders: string[],
  signal: AbortSignal,
  onProgress?: (progress: ArchiveProgress) => void,
): Promise<Blob> {
  return requestWorker(
    () =>
      new Worker(new URL('../workers/archive.worker.ts', import.meta.url), {
        type: 'module',
        name: 'fileforge-archive-worker',
      }),
    { type: 'create', files, folders },
    signal,
    (progress) => onProgress?.({ percent: progress.percent, current: 0, total: files.length }),
  );
}

export type { ImageOutput };
