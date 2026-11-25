import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { prepareMergeBatch, prepareMergeFiles } from '../src/engines/merge';
import { LIMITS } from '../src/core/config';

async function makeZip(entries: Array<{ name: string; data: string | Uint8Array }>): Promise<File> {
  const zip = new JSZip();
  for (const entry of entries) zip.file(entry.name, entry.data);
  const bytes = await zip.generateAsync({ type: 'arraybuffer', streamFiles: true, compression: 'DEFLATE' });
  return new File([bytes], 'input.zip', { type: 'application/zip' });
}

describe('ZIP text merge integration', () => {
  it('extracts supported UTF-8 text entries in archive order', async () => {
    const file = await makeZip([
      { name: 'first.txt', data: 'Первая строка' },
      { name: 'folder/second.md', data: '# Вторая строка' },
    ]);
    const result = await prepareMergeFiles([file], new AbortController().signal);
    expect(result.files.map((entry) => entry.name)).toEqual(['first.txt', 'folder/second.md']);
    expect(result.files.map((entry) => entry.content)).toEqual(['Первая строка', '# Вторая строка']);
  });

  it('recognizes supported extensionless filenames inside dotted ZIP folders', async () => {
    const file = await makeZip([
      { name: 'folder.with.dots/Dockerfile', data: 'FROM scratch' },
      { name: 'folder.with.dots/Makefile', data: 'all:' },
    ]);
    const result = await prepareMergeFiles([file], new AbortController().signal);
    expect(result.files.map((entry) => entry.name)).toEqual([
      'folder.with.dots/Dockerfile',
      'folder.with.dots/Makefile',
    ]);
    expect(result.skippedCount).toBe(0);
  });

  it('counts only supported text entries toward the merged-file limit', async () => {
    const directFiles = Array.from(
      { length: LIMITS.merge.maxFiles - 1 },
      (_, index) => new File([`content-${index}`], `direct-${index}.txt`, { type: 'text/plain' }),
    );
    const archive = await makeZip([
      { name: 'ignored.png', data: new Uint8Array([1, 2, 3]) },
      { name: 'included.txt', data: 'included' },
    ]);
    const zipFile = new File([archive], 'one.zip', { type: 'application/zip' });
    const result = await prepareMergeFiles([...directFiles, zipFile], new AbortController().signal);
    expect(result.files).toHaveLength(LIMITS.merge.maxFiles);
    expect(result.files.at(-1)?.name).toBe('included.txt');
    expect(result.skippedCount).toBe(1);
  });

  it('preserves a UTF-8 BOM in direct text files', async () => {
    const file = new File(['\uFEFFbody'], 'bom.txt', { type: 'text/plain' });
    const result = await prepareMergeFiles([file], new AbortController().signal);
    expect(result.files[0]?.content).toBe('\uFEFFbody');
  });

  it('preserves a UTF-8 BOM in text entries imported from ZIP', async () => {
    const file = await makeZip([{ name: 'bom.txt', data: '\uFEFFbody' }]);
    const result = await prepareMergeFiles([file], new AbortController().signal);
    expect(result.files[0]?.content).toBe('\uFEFFbody');
  });

  it('preserves dotfiles and normalizes decomposed Unicode ZIP names', async () => {
    const file = await makeZip([
      { name: '.gitignore', data: '*.log' },
      { name: 'folder/e\u0301.txt', data: 'unicode name' },
    ]);
    const result = await prepareMergeFiles([file], new AbortController().signal);
    expect(result.files.map((entry) => entry.name)).toEqual(['.gitignore', 'folder/é.txt']);
  });

  it('rejects a batch whose compressed input bytes exceed the aggregate limit before reading archives', async () => {
    const makeLargeInput = (name: string, size: number) =>
      ({
        name,
        size,
        arrayBuffer: async () => {
          throw new Error('must not read an over-limit input');
        },
      }) as unknown as File;
    const first = makeLargeInput('first.zip', LIMITS.merge.maxTotalInputBytes);
    const second = makeLargeInput('second.zip', 1);
    await expect(prepareMergeBatch([first, second], new AbortController().signal)).rejects.toThrow(
      /суммарный размер выбранных исходных файлов/i,
    );
  });

  it('caps skipped-entry details while preserving the exact total skip count', async () => {
    const makeUnsupportedZip = (prefix: string) =>
      makeZip([
        ...Array.from({ length: 49 }, (_, index) => ({
          name: `${prefix}/image-${index}.png`,
          data: new Uint8Array([1, 2, 3]),
        })),
        { name: `${prefix}/keep.txt`, data: 'kept' },
      ]);
    const files = [
      await makeUnsupportedZip('one'),
      await makeUnsupportedZip('two'),
      await makeUnsupportedZip('three'),
      new File(['extra'], 'extra.txt', { type: 'text/plain' }),
    ];
    const result = await prepareMergeBatch(files, new AbortController().signal);
    expect(result.files.map((item) => item.name)).toEqual([
      'one/keep.txt',
      'two/keep.txt',
      'three/keep.txt',
      'extra.txt',
    ]);
    expect(result.skippedCount).toBe(147);
    expect(result.skipped).toHaveLength(LIMITS.merge.maxSkippedDetails);
  });

  it('rejects the ZIP as a whole when a later text entry contains invalid UTF-8', async () => {
    const file = await makeZip([
      { name: 'first.txt', data: 'valid text' },
      { name: 'second.txt', data: new Uint8Array([0xff, 0xfe, 0xfd]) },
    ]);
    await expect(prepareMergeFiles([file], new AbortController().signal)).rejects.toThrow(
      /ZIP отклонён|UTF-8/i,
    );
  });

  it('reports unsupported entries without extracting them', async () => {
    const file = await makeZip([
      { name: 'note.txt', data: 'text' },
      { name: 'image.png', data: new Uint8Array([1, 2, 3, 4]) },
    ]);
    const result = await prepareMergeFiles([file], new AbortController().signal);
    expect(result.files).toHaveLength(1);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]?.name).toContain('image.png');
  });
});
