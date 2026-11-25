import { describe, expect, it } from 'vitest';
import { LIMITS } from '../src/core/config';
import { calculateCrc32, extractZipEntryBounded, inspectZipCentralDirectory } from '../src/core/zip-security';

interface ZipFixtureEntry {
  name: string;
  data?: Uint8Array<ArrayBuffer>;
  method?: 0 | 8;
  descriptor?: 'signed' | 'unsigned';
  declaredSize?: number;
  declaredCrc?: number;
  directory?: boolean;
}

async function deflateRaw(input: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const stream = new CompressionStream('deflate-raw');
  const writer = stream.writable.getWriter();
  await writer.write(input);
  await writer.close();
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}

function concat(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

async function makeZip(fixtures: ZipFixtureEntry[]): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let localOffset = 0;

  for (const fixture of fixtures) {
    const name = encoder.encode(fixture.name);
    const plain = fixture.directory ? new Uint8Array() : (fixture.data ?? encoder.encode('hello'));
    const method = fixture.directory ? 0 : (fixture.method ?? 0);
    const compressed = method === 8 ? await deflateRaw(plain) : plain;
    const actualCrc = calculateCrc32(plain);
    const declaredCrc = fixture.declaredCrc ?? actualCrc;
    const declaredSize = fixture.declaredSize ?? plain.byteLength;
    const descriptor = fixture.descriptor;
    const flags = 0x0800 | (descriptor ? 0x0008 : 0);
    const descriptorBytes = descriptor ? (descriptor === 'signed' ? 16 : 12) : 0;

    const local = new Uint8Array(30 + name.length + compressed.length + descriptorBytes);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, flags, true);
    localView.setUint16(8, method, true);
    localView.setUint32(14, descriptor ? 0 : declaredCrc, true);
    localView.setUint32(18, descriptor ? 0 : compressed.length, true);
    localView.setUint32(22, descriptor ? 0 : declaredSize, true);
    localView.setUint16(26, name.length, true);
    localView.setUint16(28, 0, true);
    local.set(name, 30);
    local.set(compressed, 30 + name.length);
    if (descriptor) {
      const offset = 30 + name.length + compressed.length;
      let pointer = offset;
      if (descriptor === 'signed') {
        localView.setUint32(pointer, 0x08074b50, true);
        pointer += 4;
      }
      localView.setUint32(pointer, declaredCrc, true);
      localView.setUint32(pointer + 4, compressed.length, true);
      localView.setUint32(pointer + 8, declaredSize, true);
    }
    localParts.push(local);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, flags, true);
    centralView.setUint16(10, method, true);
    centralView.setUint32(16, declaredCrc, true);
    centralView.setUint32(20, compressed.length, true);
    centralView.setUint32(24, declaredSize, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint16(30, 0, true);
    centralView.setUint16(32, 0, true);
    centralView.setUint16(34, 0, true);
    centralView.setUint32(38, fixture.directory ? 0x10 : 0, true);
    centralView.setUint32(42, localOffset, true);
    central.set(name, 46);
    centralParts.push(central);
    localOffset += local.length;
  }

  const locals = concat(localParts);
  const central = concat(centralParts);
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(8, fixtures.length, true);
  eocdView.setUint16(10, fixtures.length, true);
  eocdView.setUint32(12, central.length, true);
  eocdView.setUint32(16, locals.length, true);
  return concat([locals, central, eocd]).buffer;
}

describe('ZIP central directory preflight and bounded extraction', () => {
  it('accepts and extracts a stored UTF-8 archive with a valid CRC32', async () => {
    const archive = await makeZip([{ name: 'note.txt', data: new TextEncoder().encode('hello') }]);
    const [entry] = inspectZipCentralDirectory(archive);
    expect(entry).toMatchObject({
      name: 'note.txt',
      compressedSize: 5,
      uncompressedSize: 5,
      isDirectory: false,
    });
    const result = await extractZipEntryBounded(archive, entry!, 1024);
    expect(new TextDecoder().decode(result)).toBe('hello');
  });

  it('extracts an actual DEFLATE-compressed entry', async () => {
    const text = 'DEFLATE browser archive '.repeat(200);
    const archive = await makeZip([
      { name: 'compressed.txt', data: new TextEncoder().encode(text), method: 8 },
    ]);
    const [entry] = inspectZipCentralDirectory(archive);
    expect(entry!.compressionMethod).toBe(8);
    const result = await extractZipEntryBounded(archive, entry!, 20_000);
    expect(new TextDecoder().decode(result)).toBe(text);
  });

  it('rejects actual decompressed output that exceeds the declared size', async () => {
    const plain = new TextEncoder().encode('x'.repeat(10_000));
    const archive = await makeZip([{ name: 'dishonest.txt', data: plain, method: 8, declaredSize: 10 }]);
    const [entry] = inspectZipCentralDirectory(archive);
    await expect(extractZipEntryBounded(archive, entry!, 20_000)).rejects.toThrow(
      /фактический|распакованный размер/i,
    );
  });

  it('rejects a STORE size mismatch during preflight, before extraction can copy data', async () => {
    const archive = await makeZip([
      {
        name: 'dishonest-stored.txt',
        data: new TextEncoder().encode('payload'),
        method: 0,
        declaredSize: 0,
      },
    ]);
    expect(() => inspectZipCentralDirectory(archive)).toThrow(/размер несжатой ZIP-записи/i);
  });

  it('rejects forged STORE metadata before allocating the claimed compressed copy', async () => {
    const archive = new ArrayBuffer(8);
    const forgedEntry = {
      name: 'dishonest.bin',
      compressedSize: LIMITS.merge.maxZipBytes,
      uncompressedSize: 0,
      isDirectory: false,
      compressionMethod: 0,
      crc32: 0,
      dataOffset: 0,
    };
    await expect(extractZipEntryBounded(archive, forgedEntry, 0)).rejects.toThrow(
      /размер несжатой записи.*некорректен/i,
    );
  });

  it('accepts signed and unsigned data descriptors', async () => {
    for (const descriptor of ['signed', 'unsigned'] as const) {
      const archive = await makeZip([
        { name: `${descriptor}.txt`, data: new TextEncoder().encode('hello'), descriptor },
      ]);
      const [entry] = inspectZipCentralDirectory(archive);
      const result = await extractZipEntryBounded(archive, entry!, 1024);
      expect(new TextDecoder().decode(result)).toBe('hello');
    }
  });

  it('rejects directory records with non-zero CRC', async () => {
    const archive = await makeZip([{ name: 'folder/', directory: true, declaredCrc: 1 }]);
    expect(() => inspectZipCentralDirectory(archive)).toThrow(
      /папки.*некорректный размер, CRC или метод сжатия/i,
    );
  });

  it('rejects forged directory metadata passed directly to the bounded extractor', async () => {
    const forgedDirectory = {
      name: 'folder/',
      compressedSize: 0,
      uncompressedSize: 0,
      isDirectory: true,
      compressionMethod: 0,
      crc32: 1,
      dataOffset: 0,
    };
    await expect(extractZipEntryBounded(new ArrayBuffer(0), forgedDirectory, 0)).rejects.toThrow(
      /папки.*некорректный размер, CRC или метод сжатия/i,
    );
  });

  it('rejects path traversal and absolute paths', async () => {
    for (const name of ['../note.txt', '/absolute.txt', 'C:/absolute.txt']) {
      await expect(
        Promise.resolve().then(async () => inspectZipCentralDirectory(await makeZip([{ name }]))),
      ).rejects.toThrow();
    }
  });

  it('rejects more than the configured number of explicit directory entries', async () => {
    const archive = await makeZip(
      Array.from({ length: LIMITS.merge.maxFolders + 1 }, (_, index) => ({
        name: `folder-${index}/`,
        directory: true,
      })),
    );
    expect(() => inspectZipCentralDirectory(archive)).toThrow(
      new RegExp(`более ${LIMITS.merge.maxFolders} записей папок`, 'i'),
    );
  });

  it('accepts exactly the configured number of explicit directory entries', async () => {
    const archive = await makeZip(
      Array.from({ length: LIMITS.merge.maxFolders }, (_, index) => ({
        name: `folder-${index}/`,
        directory: true,
      })),
    );
    const entries = inspectZipCentralDirectory(archive);
    expect(entries).toHaveLength(LIMITS.merge.maxFolders);
    expect(entries.every((entry) => entry.isDirectory)).toBe(true);
  });

  it('rejects the first file entry above the configured merge count', async () => {
    const archive = await makeZip(
      Array.from({ length: LIMITS.merge.maxFiles + 1 }, (_, index) => ({
        name: `file-${index}.txt`,
        data: new Uint8Array([index & 0xff]),
      })),
    );
    expect(() => inspectZipCentralDirectory(archive)).toThrow(
      new RegExp(`более ${LIMITS.merge.maxFiles} файлов`, 'i'),
    );
  });

  it('rejects duplicate and case-colliding paths', async () => {
    const archive = await makeZip([{ name: 'note.txt' }, { name: 'NOTE.TXT' }]);
    expect(() => inspectZipCentralDirectory(archive)).toThrow(/повторяется путь/i);
  });

  it('rejects file-first ancestor collisions', async () => {
    const archive = await makeZip([{ name: 'folder/child.txt' }, { name: 'folder' }]);
    expect(() => inspectZipCentralDirectory(archive)).toThrow(/конфликт|используется как файл и папка/i);
  });

  it('allows an explicit directory entry together with its children in either order', async () => {
    const first = await makeZip([{ name: 'folder/child.txt' }, { name: 'folder/', directory: true }]);
    const second = await makeZip([{ name: 'folder/', directory: true }, { name: 'folder/child.txt' }]);
    expect(inspectZipCentralDirectory(first)).toHaveLength(2);
    expect(inspectZipCentralDirectory(second)).toHaveLength(2);
  });

  it('rejects suspicious declared compression ratios before extraction', async () => {
    const archive = await makeZip([
      {
        name: 'bomb.txt',
        data: new TextEncoder().encode('x'.repeat(20_000)),
        method: 8,
        declaredSize: 20_000,
      },
    ]);
    expect(() => inspectZipCentralDirectory(archive)).toThrow(/коэффициент сжатия/i);
  });

  it('rejects CRC mismatch after extraction', async () => {
    const archive = await makeZip([
      { name: 'note.txt', data: new TextEncoder().encode('hello'), declaredCrc: 1 },
    ]);
    const [entry] = inspectZipCentralDirectory(archive);
    await expect(extractZipEntryBounded(archive, entry!, 1024)).rejects.toThrow(/контрольная сумма/i);
  });

  it('rejects truncated archives', async () => {
    expect(() => inspectZipCentralDirectory(new ArrayBuffer(12))).toThrow();
    const archive = await makeZip([{ name: 'note.txt' }]);
    expect(() => inspectZipCentralDirectory(archive.slice(0, -10))).toThrow();
  });

  it('honors an AbortSignal during extraction', async () => {
    const archive = await makeZip([{ name: 'note.txt', data: new TextEncoder().encode('hello'), method: 8 }]);
    const [entry] = inspectZipCentralDirectory(archive);
    const controller = new AbortController();
    controller.abort();
    await expect(extractZipEntryBounded(archive, entry!, 1024, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
});
