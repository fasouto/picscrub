import { describe, it, expect } from 'vitest';
import { crc32, crc32Png } from '../../src/binary/crc32';

describe('crc32', () => {
  it('should calculate CRC32 for empty data', () => {
    const data = new Uint8Array([]);
    expect(crc32(data)).toBe(0);
  });

  it('should calculate CRC32 for ASCII string', () => {
    // CRC32 of "123456789" should be 0xCBF43926
    const data = new Uint8Array([0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39]);
    expect(crc32(data)).toBe(0xcbf43926);
  });

  it('should calculate CRC32 for binary data', () => {
    const data = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04]);
    expect(crc32(data)).toBe(0x515ad3cc);
  });

  it('should produce different results for different data', () => {
    const data1 = new Uint8Array([1, 2, 3]);
    const data2 = new Uint8Array([1, 2, 4]);
    expect(crc32(data1)).not.toBe(crc32(data2));
  });
});

describe('crc32Png', () => {
  it('should calculate CRC for PNG chunk (type + data)', () => {
    // PNG IHDR chunk CRC calculation
    const chunkType = new Uint8Array([0x49, 0x48, 0x44, 0x52]); // IHDR
    const chunkData = new Uint8Array([
      0x00, 0x00, 0x00, 0x01, // width = 1
      0x00, 0x00, 0x00, 0x01, // height = 1
      0x08, // bit depth = 8
      0x02, // color type = RGB
      0x00, // compression = deflate
      0x00, // filter = adaptive
      0x00, // interlace = none
    ]);

    expect(crc32Png(chunkType, chunkData)).toBe(0x907753de);
  });
});

