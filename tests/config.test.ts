import { describe, expect, it } from 'vitest';
import { LIMITS } from '../src/core/config';

describe('restored FileForge capacity profile', () => {
  it('restores the original image batch limits', () => {
    expect(LIMITS.image).toMatchObject({
      maxFiles: 150,
      maxFileBytes: 50 * 1024 * 1024,
      maxSvgBytes: 50 * 1024 * 1024,
      maxTotalBytes: 400 * 1024 * 1024,
      maxDimension: 8192,
      maxPixels: 8192 * 8192,
      maxInputDimension: 65_535,
      maxOutputFileBytes: 450 * 1024 * 1024,
    });
  });

  it('restores the original archive limits and permits header overhead', () => {
    expect(LIMITS.archive).toMatchObject({
      maxFiles: 150,
      maxFolders: 150,
      maxFileBytes: 50 * 1024 * 1024,
      maxTotalBytes: 400 * 1024 * 1024,
    });
    expect(LIMITS.archive.maxOutputBytes).toBeGreaterThan(LIMITS.archive.maxTotalBytes);
    // Creation and import share one folder limit; a future config edit must not
    // make the UI accept a structure that the importer later rejects.
    expect(LIMITS.archive.maxFolders).toBe(LIMITS.merge.maxFolders);
    expect(LIMITS.merge.maxFolders).toBe(150);
  });

  it('restores text and merge capacities from the original application', () => {
    expect(LIMITS.text.maxBytes).toBe(10 * 1024 * 1024);
    expect(LIMITS.text.maxOutputBytes).toBe(70 * 1024 * 1024);
    expect(LIMITS.merge.maxFiles).toBe(100);
    expect(LIMITS.merge.maxDirectFileBytes).toBe(50 * 1024 * 1024);
    expect(LIMITS.merge.maxZipBytes).toBe(100 * 1024 * 1024);
    expect(LIMITS.merge.maxEntryBytes).toBe(50 * 1024 * 1024);
    expect(LIMITS.merge.maxTotalInputBytes).toBe(400 * 1024 * 1024);
    expect(LIMITS.merge.maxTotalUncompressedBytes).toBe(400 * 1024 * 1024);
    expect(LIMITS.merge.maxOutputBytes).toBe(30 * 1024 * 1024);
  });

  it('keeps safety controls independent of the restored capacity values', () => {
    expect(LIMITS.merge.maxCompressionRatio).toBe(100);
    expect(LIMITS.history.maxItems).toBe(20);
    expect(LIMITS.history.maxSerializedChars).toBe(32 * 1024);
  });
});
