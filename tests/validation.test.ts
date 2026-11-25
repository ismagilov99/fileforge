import { describe, expect, it } from 'vitest';
import {
  measureText,
  validateBatch,
  validateFileName,
  validateFileSize,
  validateTextBytes,
  validateImageInputType,
} from '../src/core/validation';

describe('input validation', () => {
  it('accepts a well-formed Unicode filename', () => {
    const file = new File(['x'], 'Отчёт 你好.txt');
    expect(() => validateFileName(file)).not.toThrow();
  });

  it('rejects control characters in filenames', () => {
    const file = new File(['x'], 'bad\nname.txt');
    expect(() => validateFileName(file)).toThrow();
  });

  it('rejects bidirectional control characters in input filenames', () => {
    expect(() => validateFileName(new File(['x'], 'report\u202Etxt.exe'))).toThrow();
  });

  it('rejects an individual file over its byte limit', () => {
    const file = new File(['12345'], 'five.txt');
    expect(() => validateFileSize(file, 4)).toThrow(/превышает лимит/i);
  });

  it('rejects non-finite or unsafe file sizes from hostile File-like objects', () => {
    const invalid = { name: 'bad.txt', size: Number.POSITIVE_INFINITY } as File;
    expect(() => validateFileSize(invalid, 100)).toThrow(/не удалось определить размер/i);
  });

  it('checks both count and aggregate file limits', () => {
    const files = [new File(['123'], 'a.txt'), new File(['45'], 'b.txt')];
    expect(() => validateBatch(files, 1, 10, 10)).toThrow(/не более 1/i);
    expect(() => validateBatch(files, 2, 10, 4)).toThrow(/общий размер/i);
  });

  it('rejects a PNG payload disguised with a JPG extension', () => {
    const file = new File(['not a real image'], 'photo.jpg');
    expect(() => validateImageInputType('png', file)).toThrow(/не соответствует фактическому формату/i);
  });

  it('measures UTF-8 bytes and Unicode code points without changing the source', () => {
    expect(measureText('Aé😀')).toEqual({ bytes: 7, codePoints: 3, wellFormed: true });
    expect(measureText('x\uD800')).toEqual({ bytes: 4, codePoints: 2, wellFormed: false });
  });

  it('rejects path separators in incoming filenames', () => {
    expect(() => validateFileName(new File(['x'], 'folder\\note.txt'))).toThrow();
  });

  it('rejects malformed UTF-16 instead of exporting a replacement character', () => {
    expect(() => validateTextBytes('x\uD800y')).toThrow(/Unicode-последовательность/i);
  });
});
