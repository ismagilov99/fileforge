import { createId } from '../src/core/ids';
import { describe, expect, it, vi } from 'vitest';
import {
  automaticBase,
  getFileExtension,
  normalizeOutputFilename,
  sanitizeArchivePath,
  sanitizePathSegment,
} from '../src/core/file-names';

describe('safe output names', () => {
  it('adds the chosen extension automatically', () => {
    expect(normalizeOutputFilename('мой отчёт', 'txt', 'fileforge-text').filename).toBe('мой отчёт.txt');
  });

  it('replaces a conflicting extension', () => {
    const result = normalizeOutputFilename('report.pdf', 'json', 'fallback');
    expect(result.filename).toBe('report.json');
    expect(result.warnings.join(' ')).toContain('Расширение заменено');
  });

  it('removes path separators and reserved Windows device names', () => {
    expect(sanitizePathSegment('../../CON', 'fallback').filename).not.toContain('/');
    expect(sanitizePathSegment('CON', 'fallback').filename).toBe('_CON');
  });

  it('keeps legitimate Unicode file names', () => {
    expect(normalizeOutputFilename('Мой файл 你好', 'md', 'fallback').filename).toBe('Мой файл 你好.md');
  });

  it('preserves version-like dotted names rather than mistaking them for extensions', () => {
    expect(normalizeOutputFilename('report.v2', 'zip', 'fallback').filename).toBe('report.v2.zip');
  });

  it('resolves extensions from the basename, not dots in parent folders', () => {
    expect(getFileExtension('folder.with.dots/notes.txt')).toBe('txt');
    expect(getFileExtension('folder.with.dots/Dockerfile')).toBe('dockerfile');
    expect(getFileExtension('folder.with.dots/Makefile')).toBe('makefile');
    expect(getFileExtension('.gitignore')).toBe('gitignore');
    expect(getFileExtension('folder/file')).toBe('file');
  });

  it('preserves legitimate dotfiles and normalizes decomposed Unicode', () => {
    expect(sanitizePathSegment('.gitignore').filename).toBe('.gitignore');
    expect(sanitizePathSegment('e\u0301').filename).toBe('é');
    expect(sanitizePathSegment('COM¹.txt').filename).toBe('_COM¹.txt');
  });

  it('creates stable timestamped automatic names', () => {
    const date = new Date(2026, 10, 24, 9, 8, 7, 6);
    expect(automaticBase('fileforge-text', date)).toBe('fileforge-text-20261124-090807-006');
  });

  it('rejects traversal paths in imported archives', () => {
    expect(() => sanitizeArchivePath('../secret.txt')).toThrow();
    expect(() => sanitizeArchivePath('/absolute.txt')).toThrow();
    expect(sanitizeArchivePath('folder/file.txt')).toBe('folder/file.txt');
    expect(sanitizeArchivePath('.gitignore')).toBe('.gitignore');
    expect(sanitizeArchivePath('folder/e\u0301.txt')).toBe('folder/é.txt');
  });
});

describe('createId', () => {
  it('creates distinct non-empty identifiers for bookkeeping', () => {
    const first = createId('test');
    const second = createId('test');
    expect(first.length).toBeGreaterThan(0);
    expect(second.length).toBeGreaterThan(0);
    expect(first).not.toBe(second);
  });

  it('uses a distinct documented fallback when crypto.randomUUID is unavailable', () => {
    vi.stubGlobal('crypto', undefined);
    try {
      const first = createId('fallback test');
      const second = createId('fallback test');
      expect(first).toMatch(/^fallbacktest-/);
      expect(second).not.toBe(first);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
