import { describe, it, expect } from 'vitest';
import { jpeg } from '../../src/formats/jpeg';
import * as buffer from '../../src/binary/buffer';
import * as dataview from '../../src/binary/dataview';

/**
 * Create a JPEG with EXIF containing orientation and copyright tags
 */
function createJpegWithExif(opts: {
  orientation?: number;
  copyright?: string;
}): Uint8Array {
  const parts: Uint8Array[] = [];

  // SOI
  parts.push(new Uint8Array([0xff, 0xd8]));

  // APP0 (JFIF)
  parts.push(
    new Uint8Array([
      0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00,
      0x01, 0x00, 0x00,
    ])
  );

  // Build EXIF APP1 with big-endian TIFF
  const entries: Uint8Array[] = [];
  const extraParts: Uint8Array[] = [];
  let entryCount = 0;

  if (opts.orientation != null) entryCount++;
  if (opts.copyright != null) entryCount++;

  // Extra data offset: TIFF header (8) + count (2) + entries (12*n) + next IFD (4)
  let extraOffset = 8 + 2 + entryCount * 12 + 4;

  // Orientation tag (0x0112, SHORT)
  if (opts.orientation != null) {
    const entry = new Uint8Array(12);
    entry[0] = 0x01;
    entry[1] = 0x12;
    entry[2] = 0x00;
    entry[3] = 0x03; // SHORT
    entry[4] = 0x00;
    entry[5] = 0x00;
    entry[6] = 0x00;
    entry[7] = 0x01;
    entry[8] = (opts.orientation >> 8) & 0xff;
    entry[9] = opts.orientation & 0xff;
    entries.push(entry);
  }

  // Copyright tag (0x8298, ASCII)
  if (opts.copyright != null) {
    const copyrightBytes = buffer.fromAscii(opts.copyright + '\x00');
    const entry = new Uint8Array(12);
    entry[0] = 0x82;
    entry[1] = 0x98;
    entry[2] = 0x00;
    entry[3] = 0x02; // ASCII
    entry[4] = (copyrightBytes.length >> 24) & 0xff;
    entry[5] = (copyrightBytes.length >> 16) & 0xff;
    entry[6] = (copyrightBytes.length >> 8) & 0xff;
    entry[7] = copyrightBytes.length & 0xff;

    if (copyrightBytes.length <= 4) {
      entry.set(copyrightBytes, 8);
    } else {
      entry[8] = (extraOffset >> 24) & 0xff;
      entry[9] = (extraOffset >> 16) & 0xff;
      entry[10] = (extraOffset >> 8) & 0xff;
      entry[11] = extraOffset & 0xff;
      extraParts.push(copyrightBytes);
      extraOffset += copyrightBytes.length;
    }
    entries.push(entry);
  }

  const tiffHeader = new Uint8Array([
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08,
  ]);
  const ifdCount = new Uint8Array([(entryCount >> 8) & 0xff, entryCount & 0xff]);
  const nextIfd = new Uint8Array([0x00, 0x00, 0x00, 0x00]);
  const exifId = buffer.fromAscii('Exif\x00\x00');
  const exifContent = buffer.concat(exifId, tiffHeader, ifdCount, ...entries, nextIfd, ...extraParts);

  const app1 = new Uint8Array(4 + exifContent.length);
  app1[0] = 0xff;
  app1[1] = 0xe1;
  dataview.writeUint16BE(app1, 2, exifContent.length + 2);
  app1.set(exifContent, 4);
  parts.push(app1);

  // DQT
  parts.push(new Uint8Array([0xff, 0xdb, 0x00, 0x43, 0x00, ...new Array(64).fill(0x10)]));

  // SOF0
  parts.push(
    new Uint8Array([0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00])
  );

  // SOS + scan data + EOI
  parts.push(
    new Uint8Array([0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x7b, 0xff, 0xd9])
  );

  return buffer.concat(...parts);
}

describe('JPEG preserveCopyright', () => {
  it('should strip copyright by default', () => {
    const input = createJpegWithExif({ copyright: 'John Doe 2024' });
    const result = jpeg.remove(input);

    const ascii = buffer.toAscii(result);
    expect(ascii).not.toContain('John Doe');
  });

  it('should preserve copyright when option is set', () => {
    const input = createJpegWithExif({ copyright: 'John Doe 2024' });
    const result = jpeg.remove(input, { preserveCopyright: true });

    const ascii = buffer.toAscii(result);
    expect(ascii).toContain('John Doe 2024');
  });

  it('should preserve both orientation and copyright together', () => {
    const input = createJpegWithExif({ orientation: 6, copyright: 'Jane Smith' });
    const result = jpeg.remove(input, { preserveOrientation: true, preserveCopyright: true });

    const ascii = buffer.toAscii(result);
    expect(ascii).toContain('Jane Smith');

    // Verify EXIF still present with orientation
    const types = jpeg.getMetadataTypes(result);
    expect(types).toContain('EXIF');
  });

  it('should preserve copyright but strip other EXIF data', () => {
    const input = createJpegWithExif({ orientation: 3, copyright: 'Test Corp' });
    const result = jpeg.remove(input, { preserveCopyright: true });

    const ascii = buffer.toAscii(result);
    expect(ascii).toContain('Test Corp');
  });
});
