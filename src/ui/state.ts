import type { SelectedImage } from '../engines/images';
import type { ArchiveItem } from '../engines/archive';
import type { MergeInput } from '../engines/text';
import { loadHistory, type HistoryEntry } from '../core/history';

export type OperationKind = 'images' | 'archive' | 'text' | 'merge';

export interface AppState {
  images: SelectedImage[];
  archive: ArchiveItem[];
  archiveFolders: string[];
  merge: MergeInput[];
  mergeSkipped: Array<{ name: string; reason: string }>;
  mergeSkippedCount: number;
  history: HistoryEntry[];
  activeAbort: AbortController | null;
  activeOperation: OperationKind | null;
  imagePreparing: boolean;
  imagePrepareAbort: AbortController | null;
  mergePreparing: boolean;
  mergePrepareAbort: AbortController | null;
  theme: 'dark' | 'light' | 'space';
}

export const state: AppState = {
  images: [],
  archive: [],
  archiveFolders: [],
  merge: [],
  mergeSkipped: [],
  mergeSkippedCount: 0,
  history: loadHistory(),
  activeAbort: null,
  activeOperation: null,
  imagePreparing: false,
  imagePrepareAbort: null,
  mergePreparing: false,
  mergePrepareAbort: null,
  theme: 'dark',
};
