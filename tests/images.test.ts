import { describe, expect, it } from 'vitest';
import { prepareImageFiles } from '../src/engines/images';
import { LIMITS } from '../src/core/config';
import { calculateCrc32 } from '../src/core/zip-security';
import { readImageDimensions } from '../src/core/validation';

function pngFile(name: string, marker: number): File {
  const bytes = new Uint8Array(34);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13, false);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, 2, false);
  view.setUint32(20, 2, false);
  bytes.set([8, 2, 0, 0, 0], 24);
  view.setUint32(29, calculateCrc32(bytes.subarray(12, 29)), false);
  bytes[33] = marker;
  return new File([bytes], name, { type: 'image/png' });
}

describe('image preparation and duplicate detection', () => {
  it('uses content hashes rather than equal names and sizes to detect duplicates', async () => {
    const first = pngFile('same.png', 1);
    const second = pngFile('same.png', 2);
    expect(first.size).toBe(second.size);
    const result = await prepareImageFiles([first, second], []);
    expect(result.accepted).toHaveLength(2);
    expect(result.rejected).toHaveLength(0);
  });

  it('rejects exact duplicate content even when filenames differ', async () => {
    const first = pngFile('one.png', 1);
    const second = new File([await first.arrayBuffer()], 'renamed.png', { type: 'image/png' });
    const result = await prepareImageFiles([first, second], []);
    expect(result.accepted).toHaveLength(1);
    expect(result.rejected[0]?.reason).toMatch(/уже добавлено/i);
  });

  it('aborts image preparation atomically when its signal is cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(prepareImageFiles([pngFile('cancel.png', 1)], [], controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('rejects a PNG signature without a valid IHDR chunk before decode', async () => {
    const malformed = new Uint8Array(33);
    malformed.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const view = new DataView(malformed.buffer);
    view.setUint32(8, 13, false);
    malformed.set([0x49, 0x44, 0x41, 0x54], 12); // IDAT where IHDR is required.
    view.setUint32(16, 2, false);
    view.setUint32(20, 2, false);
    const file = new File([malformed], 'malformed.png', { type: 'image/png' });
    const result = await prepareImageFiles([file], []);
    expect(result.accepted).toHaveLength(0);
    expect(result.rejected[0]?.reason).toMatch(/IHDR/i);
  });

  it('rejects a PNG with a corrupted IHDR CRC before decoding', async () => {
    const source = new Uint8Array(await pngFile('crc.png', 1).arrayBuffer());
    source[29] = source[29]! ^ 0xff;
    const malformed = new File([source], 'crc.png', { type: 'image/png' });
    const result = await prepareImageFiles([malformed], []);
    expect(result.accepted).toHaveLength(0);
    expect(result.rejected[0]?.reason).toMatch(/контрольная сумма/i);
  });

  it('rejects a batch larger than the hard input count before iterating it', async () => {
    const files = Array.from({ length: LIMITS.image.maxFiles + 1 }, (_, index) =>
      pngFile(`image-${index}.png`, index),
    );
    await expect(prepareImageFiles(files, [])).rejects.toThrow(
      new RegExp(`не более ${LIMITS.image.maxFiles} изображений`, 'i'),
    );
  });

  it('rejects a PNG payload with a JPEG extension before decoding', async () => {
    const source = pngFile('photo.jpg', 1);
    const result = await prepareImageFiles([source], []);
    expect(result.accepted).toHaveLength(0);
    expect(result.rejected[0]?.reason).toMatch(/не соответствует фактическому формату/i);
  });
});

describe('image header preflight', () => {
  function makeBmp(pixelOffset = 54): File {
    const bytes = new Uint8Array(58);
    bytes.set([0x42, 0x4d]);
    const view = new DataView(bytes.buffer);
    view.setUint32(2, bytes.byteLength, true);
    view.setUint32(10, pixelOffset, true);
    view.setUint32(14, 40, true);
    view.setInt32(18, 1, true);
    view.setInt32(22, 1, true);
    view.setUint16(26, 1, true);
    view.setUint16(28, 24, true);
    view.setUint32(34, 4, true);
    return new File([bytes], 'pixel.bmp', { type: 'image/bmp' });
  }

  function makeWebp(chunkSize = 10): File {
    const bytes = new Uint8Array(30);
    bytes.set([...Buffer.from('RIFF')], 0);
    bytes.set([...Buffer.from('WEBP')], 8);
    bytes.set([...Buffer.from('VP8X')], 12);
    const view = new DataView(bytes.buffer);
    view.setUint32(4, bytes.byteLength - 8, true);
    view.setUint32(16, chunkSize, true);
    return new File([bytes], 'pixel.webp', { type: 'image/webp' });
  }

  function makeJpeg(components = 1, segmentLength = 8 + components * 3): File {
    const bytes = new Uint8Array(4 + segmentLength + 2);
    bytes.set([0xff, 0xd8, 0xff, 0xc0]);
    const view = new DataView(bytes.buffer);
    view.setUint16(4, segmentLength, false);
    bytes[6] = 8;
    bytes[7] = 0;
    bytes[8] = 1;
    bytes[9] = 0;
    bytes[10] = 2;
    bytes[11] = components;
    bytes[bytes.length - 2] = 0xff;
    bytes[bytes.length - 1] = 0xd9;
    return new File([bytes], 'pixel.jpg', { type: 'image/jpeg' });
  }

  it('allows the full original 8,192 × 8,192 image canvas area during header preflight', async () => {
    const bytes = new Uint8Array(33);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    const view = new DataView(bytes.buffer);
    view.setUint32(8, 13, false);
    bytes.set([0x49, 0x48, 0x44, 0x52], 12);
    view.setUint32(16, 8192, false);
    view.setUint32(20, 8192, false);
    bytes.set([8, 2, 0, 0, 0], 24);
    view.setUint32(29, calculateCrc32(bytes.subarray(12, 29)), false);
    const image = new File([bytes], 'full-canvas.png', { type: 'image/png' });
    await expect(readImageDimensions(image, 'png')).resolves.toEqual({ width: 8192, height: 8192 });
  });

  it('continues to reject source images beyond the separate 65,535 px resource preflight guard', async () => {
    const bytes = new Uint8Array(33);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    const view = new DataView(bytes.buffer);
    view.setUint32(8, 13, false);
    bytes.set([0x49, 0x48, 0x44, 0x52], 12);
    view.setUint32(16, 65_536, false);
    view.setUint32(20, 1, false);
    bytes.set([8, 2, 0, 0, 0], 24);
    view.setUint32(29, calculateCrc32(bytes.subarray(12, 29)), false);
    const image = new File([bytes], 'over-dimension.png', { type: 'image/png' });
    await expect(readImageDimensions(image, 'png')).rejects.toThrow(/безопасный лимит декодирования/i);
  });

  it('accepts a bounded standard BMP header and a valid pixel offset', async () => {
    await expect(readImageDimensions(makeBmp(), 'bmp')).resolves.toEqual({ width: 1, height: 1 });
  });

  it('rejects a BMP pixel offset that points into the DIB header', async () => {
    await expect(readImageDimensions(makeBmp(53), 'bmp')).rejects.toThrow(/смещение пиксельных данных/i);
  });

  it('accepts a WebP VP8X chunk with its exact ten-byte header', async () => {
    await expect(readImageDimensions(makeWebp(), 'webp')).resolves.toEqual({ width: 1, height: 1 });
  });

  it('rejects a malformed WebP VP8X chunk size', async () => {
    await expect(readImageDimensions(makeWebp(9), 'webp')).rejects.toThrow(/VP8X/i);
  });

  it('accepts a structurally consistent JPEG SOF component table', async () => {
    await expect(readImageDimensions(makeJpeg(1), 'jpeg')).resolves.toEqual({ width: 2, height: 1 });
  });

  it('rejects a JPEG SOF component count inconsistent with its segment length', async () => {
    await expect(readImageDimensions(makeJpeg(2, 11), 'jpeg')).rejects.toThrow(/структура компонентов/i);
  });
});
