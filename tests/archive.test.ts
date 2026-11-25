import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { autoSortFolder, createArchive, type ArchiveItem } from '../src/engines/archive';
import { LIMITS } from '../src/core/config';

function asItem(name: string, contents: string, folder = ''): ArchiveItem {
  const file = new File([contents], name, { type: 'text/plain' });
  return { id: `${folder}/${name}`, file, name, folder };
}

describe('ZIP creation', () => {
  it('sorts files using only their basename when parent folders contain dots', () => {
    expect(autoSortFolder('folder.with.dots/image.png')).toBe('Images');
    expect(autoSortFolder('folder.with.dots/Dockerfile')).toBe('Code');
    expect(autoSortFolder('folder.with.dots/Makefile')).toBe('Code');
  });

  it('creates a readable archive with file data and an explicit empty folder', async () => {
    const blob = await createArchive(
      [asItem('note.txt', 'hello', 'Docs')],
      ['Docs', 'Empty'],
      new AbortController().signal,
      () => undefined,
    );
    expect(blob.type).toBe('application/zip');
    const zip = await JSZip.loadAsync(blob, { checkCRC32: true });
    expect(await zip.file('Docs/note.txt')?.async('string')).toBe('hello');
    expect(zip.files['Empty/']?.dir).toBe(true);
  });

  it('creates distinct names for duplicate files in one folder', async () => {
    const blob = await createArchive(
      [asItem('report.txt', 'one', 'Docs'), asItem('report.txt', 'two', 'Docs')],
      ['Docs'],
      new AbortController().signal,
      () => undefined,
    );
    const zip = await JSZip.loadAsync(blob, { checkCRC32: true });
    expect(await zip.file('Docs/report.txt')?.async('string')).toBe('one');
    expect(await zip.file('Docs/report (1).txt')?.async('string')).toBe('two');
  });

  it('renames a root file that collides with an explicit directory', async () => {
    const blob = await createArchive(
      [asItem('Docs', 'root file'), { ...asItem('report.txt', 'nested file'), folder: 'Docs' }],
      ['Docs'],
      new AbortController().signal,
      () => undefined,
    );
    const zip = await JSZip.loadAsync(blob, { checkCRC32: true });
    expect(await zip.file('Docs (1)')?.async('string')).toBe('root file');
    expect(await zip.file('Docs/report.txt')?.async('string')).toBe('nested file');
  });

  it('creates unique paths for repeated files in different folders without collapsing directories', async () => {
    const blob = await createArchive(
      [
        { ...asItem('report.txt', 'one'), folder: 'Docs' },
        { ...asItem('report.txt', 'two'), folder: 'Images' },
      ],
      ['Docs', 'Images'],
      new AbortController().signal,
      () => undefined,
    );
    const zip = await JSZip.loadAsync(blob, { checkCRC32: true });
    expect(await zip.file('Docs/report.txt')?.async('string')).toBe('one');
    expect(await zip.file('Images/report.txt')?.async('string')).toBe('two');
  });

  it('uses deterministic ZIP timestamps', async () => {
    const blob = await createArchive(
      [asItem('note.txt', 'hello')],
      [],
      new AbortController().signal,
      () => undefined,
    );
    const zip = await JSZip.loadAsync(blob, { checkCRC32: true });
    expect(zip.file('note.txt')?.date.getFullYear()).toBe(1980);
  });

  it('stops when the user cancels after file staging and before compression', async () => {
    const controller = new AbortController();
    await expect(
      createArchive([asItem('a.txt', 'one'), asItem('b.txt', 'two')], [], controller.signal, () =>
        controller.abort(),
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects an already-aborted operation before work starts', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      createArchive([asItem('a.txt', 'x')], [], controller.signal, () => undefined),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects more than the allowed number of empty folders', async () => {
    const folders = Array.from({ length: LIMITS.archive.maxFolders + 1 }, (_, index) => `folder-${index}`);
    await expect(
      createArchive([asItem('a.txt', 'x')], folders, new AbortController().signal, () => undefined),
    ).rejects.toThrow(new RegExp(`${LIMITS.archive.maxFolders} папок`, 'i'));
  });

  it('counts file-assigned folders together with explicitly created folders', async () => {
    const folders = Array.from({ length: LIMITS.archive.maxFolders }, (_, index) => `folder-${index}`);
    const item = { ...asItem('a.txt', 'x'), folder: 'auto-category' };
    await expect(
      createArchive([item], folders, new AbortController().signal, () => undefined),
    ).rejects.toThrow(new RegExp(`${LIMITS.archive.maxFolders} уникальных папок`, 'i'));
  });

  it('rejects an empty archive request', async () => {
    await expect(createArchive([], [], new AbortController().signal, () => undefined)).rejects.toThrow(
      /добавь файлы/i,
    );
  });
});
