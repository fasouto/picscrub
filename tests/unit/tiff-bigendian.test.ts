import { describe, it, expect } from 'vitest';
import { tiff } from '../../src/formats/tiff';
import { detectFormat } from '../../src/detect';

/**
 * Write 16-bit big-endian
 */
function writeUint16BE(value: number): number[] {
  return [(value >> 8) & 0xff, value & 0xff];
}

/**
 * Write 32-bit big-endian
 */
function writeUint32BE(value: number): number[] {
  return [(value >> 24) & 0xff, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

/**
 * Create a big-endian (MM) TIFF with metadata tags
 */
function createBigEndianTiff(opts: { withMetadata: boolean }): Uint8Array {
  const parts: number[] = [];

  // TIFF Header (big-endian)
  parts.push(0x4d, 0x4d); // "MM" - big-endian
  parts.push(...writeUint16BE(42)); // Magic number
  parts.push(...writeUint32BE(8)); // Offset to first IFD

  const metaTags = opts.withMetadata
    ? [
        { tag: 270, value: 'Secret description' }, // ImageDescription
        { tag: 271, value: 'CameraCorp' }, // Make
        { tag: 305, value: 'EditSoft 3.0' }, // Software
        { tag: 315, value: 'John Doe' }, // Artist
      ]
    : [];

  const requiredEntries = 5;
  const numEntries = requiredEntries + metaTags.length;
  parts.push(...writeUint16BE(numEntries));

  // Calculate where string data starts
  let stringOffset = 8 + 2 + numEntries * 12 + 4;
  const stringData: number[] = [];

  function addShortEntry(tag: number, value: number): void {
    parts.push(...writeUint16BE(tag));
    parts.push(...writeUint16BE(3)); // SHORT
    parts.push(...writeUint32BE(1));
    parts.push(...writeUint16BE(value));
    parts.push(0, 0); // padding
  }

  function addLongEntry(tag: number, value: number): void {
    parts.push(...writeUint16BE(tag));
    parts.push(...writeUint16BE(4)); // LONG
    parts.push(...writeUint32BE(1));
    parts.push(...writeUint32BE(value));
  }

  function addAsciiEntry(tag: number, str: string): void {
    const len = str.length + 1; // include null terminator
    parts.push(...writeUint16BE(tag));
    parts.push(...writeUint16BE(2)); // ASCII
    parts.push(...writeUint32BE(len));
    if (len <= 4) {
      for (let i = 0; i < str.length; i++) parts.push(str.charCodeAt(i));
      parts.push(0);
      for (let i = len; i < 4; i++) parts.push(0);
    } else {
      parts.push(...writeUint32BE(stringOffset));
      for (let i = 0; i < str.length; i++) stringData.push(str.charCodeAt(i));
      stringData.push(0);
      stringOffset += len;
    }
  }

  // Required image tags
  addLongEntry(256, 1); // ImageWidth
  addLongEntry(257, 1); // ImageLength
  addShortEntry(258, 8); // BitsPerSample
  addShortEntry(259, 1); // Compression = none
  addShortEntry(262, 1); // PhotometricInterpretation

  // Metadata tags
  for (const { tag, value } of metaTags) {
    addAsciiEntry(tag, value);
  }

  // Next IFD pointer (none)
  parts.push(...writeUint32BE(0));

  // String data
  parts.push(...stringData);

  return new Uint8Array(parts);
}

describe('Big-endian TIFF', () => {
  it('should detect big-endian TIFF format', () => {
    const data = createBigEndianTiff({ withMetadata: false });
    expect(detectFormat(data)).toBe('tiff');
  });

  it('should parse big-endian TIFF header', () => {
    const data = createBigEndianTiff({ withMetadata: true });
    const header = tiff.parseHeader(data);

    expect(header.littleEndian).toBe(false);
    expect(header.ifdOffset).toBe(8);
  });

  it('should parse big-endian IFD entries', () => {
    const data = createBigEndianTiff({ withMetadata: true });
    const header = tiff.parseHeader(data);
    const ifd = tiff.parseIfd(data, header.ifdOffset, header.littleEndian);

    // 5 required + 4 metadata = 9 entries
    expect(ifd.entries.length).toBe(9);

    // Check that metadata tags are present
    const tags = ifd.entries.map(e => e.tag);
    expect(tags).toContain(270); // ImageDescription
    expect(tags).toContain(271); // Make
    expect(tags).toContain(305); // Software
    expect(tags).toContain(315); // Artist
  });

  it('should detect metadata in big-endian TIFF', () => {
    const data = createBigEndianTiff({ withMetadata: true });
    const types = tiff.getMetadataTypes(data);

    expect(types).toContain('ImageDescription');
    expect(types).toContain('Make');
    expect(types).toContain('Software');
    expect(types).toContain('Artist');
  });

  it('should remove metadata from big-endian TIFF', () => {
    const data = createBigEndianTiff({ withMetadata: true });
    const result = tiff.remove(data);

    // Should still be valid big-endian TIFF
    expect(result[0]).toBe(0x4d); // M
    expect(result[1]).toBe(0x4d); // M

    // Metadata should be gone
    const remainingTypes = tiff.getMetadataTypes(result);
    expect(remainingTypes).not.toContain('ImageDescription');
    expect(remainingTypes).not.toContain('Make');
    expect(remainingTypes).not.toContain('Software');
    expect(remainingTypes).not.toContain('Artist');
  });

  it('should preserve image tags in big-endian TIFF', () => {
    const data = createBigEndianTiff({ withMetadata: true });
    const result = tiff.remove(data);

    const header = tiff.parseHeader(result);
    const ifd = tiff.parseIfd(result, header.ifdOffset, header.littleEndian);

    // Should still have the 5 required tags
    const tags = ifd.entries.map(e => e.tag);
    expect(tags).toContain(256); // ImageWidth
    expect(tags).toContain(257); // ImageLength
    expect(tags).toContain(258); // BitsPerSample
    expect(tags).toContain(259); // Compression
    expect(tags).toContain(262); // PhotometricInterpretation
  });

  it('should not modify big-endian TIFF without metadata', () => {
    const data = createBigEndianTiff({ withMetadata: false });
    const result = tiff.remove(data);

    // Should be identical (just a copy)
    expect(result).toEqual(data);
  });
});
