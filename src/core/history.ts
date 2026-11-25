import { createId } from './ids';
import { LIMITS } from './config';
import { isWellFormedUnicode } from './file-names';

export interface HistoryEntry {
  id: string;
  timestamp: number;
  operation: 'image' | 'text' | 'archive' | 'merge';
  filename: string;
  format: string;
  bytes: number;
  itemCount?: number;
}

export function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(LIMITS.history.storageKey);
    if (!raw || raw.length > LIMITS.history.maxSerializedChars) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const operations = new Set(['image', 'text', 'archive', 'merge']);
    return parsed
      .filter((entry): entry is HistoryEntry => {
        if (typeof entry !== 'object' || entry === null) return false;
        const item = entry as Record<string, unknown>;
        return (
          typeof item['id'] === 'string' &&
          item['id'].length <= 128 &&
          typeof item['timestamp'] === 'number' &&
          Number.isSafeInteger(item['timestamp']) &&
          item['timestamp'] > 0 &&
          Number.isFinite(new Date(item['timestamp']).getTime()) &&
          typeof item['operation'] === 'string' &&
          operations.has(item['operation']) &&
          typeof item['filename'] === 'string' &&
          item['filename'].length > 0 &&
          item['filename'].length <= 255 &&
          isWellFormedUnicode(item['filename']) &&
          !/[\\/\u0000-\u001f\u007f\u0080-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/.test(
            item['filename'],
          ) &&
          typeof item['format'] === 'string' &&
          item['format'].length > 0 &&
          item['format'].length <= 32 &&
          typeof item['bytes'] === 'number' &&
          Number.isSafeInteger(item['bytes']) &&
          item['bytes'] >= 0 &&
          (item['itemCount'] === undefined ||
            (typeof item['itemCount'] === 'number' &&
              Number.isSafeInteger(item['itemCount']) &&
              item['itemCount'] >= 0))
        );
      })
      .slice(0, LIMITS.history.maxItems);
  } catch {
    return [];
  }
}

export function saveHistory(entry: Omit<HistoryEntry, 'id' | 'timestamp'>): HistoryEntry[] {
  // localStorage and callers are outside the type system. Validate at runtime so
  // malformed values cannot throw from this optional feature or poison history.
  if (
    typeof entry !== 'object' ||
    entry === null ||
    typeof entry.filename !== 'string' ||
    !entry.filename ||
    entry.filename.length > 255 ||
    !isWellFormedUnicode(entry.filename) ||
    /[\\/\u0000-\u001f\u007f\u0080-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/.test(
      entry.filename,
    ) ||
    typeof entry.format !== 'string' ||
    !entry.format ||
    entry.format.length > 32 ||
    !['image', 'text', 'archive', 'merge'].includes(entry.operation) ||
    !Number.isSafeInteger(entry.bytes) ||
    entry.bytes < 0 ||
    (entry.itemCount !== undefined && (!Number.isSafeInteger(entry.itemCount) || entry.itemCount < 0))
  ) {
    return loadHistory();
  }
  const current = loadHistory();
  const next: HistoryEntry[] = [
    { ...entry, id: createId('history'), timestamp: Date.now() },
    ...current,
  ].slice(0, LIMITS.history.maxItems);
  try {
    const serialized = JSON.stringify(next);
    if (serialized.length <= LIMITS.history.maxSerializedChars) {
      localStorage.setItem(LIMITS.history.storageKey, serialized);
    }
  } catch {
    // History is optional. A quota/private-mode error must never block a file operation.
  }
  return next;
}

export function clearHistory(): void {
  try {
    localStorage.removeItem(LIMITS.history.storageKey);
  } catch {
    /* Optional feature. */
  }
}
