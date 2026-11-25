import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearHistory, loadHistory, saveHistory } from '../src/core/history';
import { LIMITS } from '../src/core/config';

class MemoryStorage {
  private readonly data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
}

const storage = new MemoryStorage();

beforeEach(() => {
  vi.stubGlobal('localStorage', storage);
  storage.removeItem(LIMITS.history.storageKey);
});

describe('operation history', () => {
  it('stores metadata without file contents', () => {
    const result = saveHistory({
      operation: 'text',
      filename: 'note.txt',
      format: 'TXT',
      bytes: 12,
      itemCount: 1,
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ filename: 'note.txt', format: 'TXT', bytes: 12, operation: 'text' });
    expect(JSON.stringify(result)).not.toContain('private document body');
  });

  it('keeps only the configured maximum number of items', () => {
    for (let index = 0; index < LIMITS.history.maxItems + 5; index += 1) {
      saveHistory({ operation: 'text', filename: `file-${index}.txt`, format: 'TXT', bytes: index });
    }
    expect(loadHistory()).toHaveLength(LIMITS.history.maxItems);
  });

  it('ignores malformed JSON and invalid records', () => {
    storage.setItem(LIMITS.history.storageKey, '{broken');
    expect(loadHistory()).toEqual([]);
    storage.setItem(
      LIMITS.history.storageKey,
      JSON.stringify([{ operation: 'image', filename: '', bytes: -1 }]),
    );
    expect(loadHistory()).toEqual([]);
  });

  it('rejects oversized local history payloads before JSON parsing', () => {
    storage.setItem(LIMITS.history.storageKey, ' '.repeat(LIMITS.history.maxSerializedChars + 1));
    expect(loadHistory()).toEqual([]);
  });

  it('rejects malformed caller data without throwing or storing it', () => {
    expect(() => saveHistory(null as unknown as Parameters<typeof saveHistory>[0])).not.toThrow();
    expect(() =>
      saveHistory({
        operation: 'text',
        filename: 'folder\\note.txt',
        format: 'TXT',
        bytes: 1,
      }),
    ).not.toThrow();
    expect(() =>
      saveHistory({
        operation: 'text',
        filename: 'note.txt',
        format: '',
        bytes: 1,
      }),
    ).not.toThrow();
    expect(loadHistory()).toEqual([]);
  });

  it('rejects bidi controls and malformed unicode in stored filenames', () => {
    storage.setItem(
      LIMITS.history.storageKey,
      JSON.stringify([
        {
          id: '1',
          timestamp: Date.now(),
          operation: 'text',
          filename: 'safe\u202Etxt',
          format: 'TXT',
          bytes: 1,
        },
        {
          id: '2',
          timestamp: Date.now(),
          operation: 'text',
          filename: 'bad\uD800name.txt',
          format: 'TXT',
          bytes: 1,
        },
      ]),
    );
    expect(loadHistory()).toEqual([]);
  });

  it('does not block file workflows when browser storage throws', () => {
    vi.stubGlobal('localStorage', {
      getItem() {
        throw new Error('storage blocked');
      },
      setItem() {
        throw new Error('quota exceeded');
      },
      removeItem() {
        throw new Error('storage blocked');
      },
    });
    expect(loadHistory()).toEqual([]);
    expect(() =>
      saveHistory({ operation: 'text', filename: 'note.txt', format: 'TXT', bytes: 1 }),
    ).not.toThrow();
    expect(() => clearHistory()).not.toThrow();
  });

  it('clears history safely', () => {
    saveHistory({ operation: 'archive', filename: 'backup.zip', format: 'ZIP', bytes: 1 });
    clearHistory();
    expect(loadHistory()).toEqual([]);
  });
});
