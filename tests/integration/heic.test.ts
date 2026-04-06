import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { detectFormat, getMetadataTypes, removeMetadata } from '../../src/index';
import { heic } from '../../src/formats/heic';

const FIXTURES_DIR = join(__dirname, '../fixtures');

/**
 * Create a minimal valid HEIC file structure for testing
 * HEIC uses ISOBMFF (ISO Base Media File Format)
 */
function createMinimalHeic(options: { withExif?: boolean } = {}): Uint8Array {
  const parts: Uint8Array[] = [];

  // ftyp box - file type declaration
  // Box structure: [size (4)] [type (4)] [major_brand (4)] [minor_version (4)] [compatible_brands...]
  const ftypData = new Uint8Array([
    0x00, 0x00, 0x00, 0x18, // size: 24 bytes
    0x66, 0x74, 0x79, 0x70, // type: 'ftyp'
    0x68, 0x65, 0x69, 0x63, // major brand: 'heic'
    0x00, 0x00, 0x00, 0x00, // minor version: 0
    0x6d, 0x69, 0x66, 0x31, // compatible brand: 'mif1'
    0x68, 0x65, 0x69, 0x63, // compatible brand: 'heic'
  ]);
  parts.push(ftypData);

  // meta box - metadata container
  // For testing, we create a minimal meta box with optional EXIF
  if (options.withExif) {
    // Create meta box with iprp/ipco containing Exif
    // meta box header
    const metaHeader = new Uint8Array([
      0x00, 0x00, 0x00, 0x00, // size (will be filled)
      0x6d, 0x65, 0x74, 0x61, // type: 'meta'
      0x00, 0x00, 0x00, 0x00, // version + flags (fullbox)
    ]);

    // hdlr box (handler - required in meta)
    const hdlrBox = new Uint8Array([
      0x00, 0x00, 0x00, 0x21, // size: 33 bytes
      0x68, 0x64, 0x6c, 0x72, // type: 'hdlr'
      0x00, 0x00, 0x00, 0x00, // version + flags
      0x00, 0x00, 0x00, 0x00, // pre_defined
      0x70, 0x69, 0x63, 0x74, // handler_type: 'pict'
      0x00, 0x00, 0x00, 0x00, // reserved
      0x00, 0x00, 0x00, 0x00, // reserved
      0x00, 0x00, 0x00, 0x00, // reserved
      0x00, // null terminator for name
    ]);

    // iprp box with ipco containing Exif
    const exifContent = new TextEncoder().encode('Exif\x00\x00II*\x00\x08\x00\x00\x00');
    const exifBox = new Uint8Array(8 + exifContent.length);
    // Size
    exifBox[0] = 0x00;
    exifBox[1] = 0x00;
    exifBox[2] = 0x00;
    exifBox[3] = 8 + exifContent.length;
    // Type: 'Exif'
    exifBox[4] = 0x45;
    exifBox[5] = 0x78;
    exifBox[6] = 0x69;
    exifBox[7] = 0x66;
    exifBox.set(exifContent, 8);

    // ipco box containing exif
    const ipcoSize = 8 + exifBox.length;
    const ipcoBox = new Uint8Array(ipcoSize);
    ipcoBox[0] = (ipcoSize >> 24) & 0xff;
    ipcoBox[1] = (ipcoSize >> 16) & 0xff;
    ipcoBox[2] = (ipcoSize >> 8) & 0xff;
    ipcoBox[3] = ipcoSize & 0xff;
    ipcoBox[4] = 0x69; // 'i'
    ipcoBox[5] = 0x70; // 'p'
    ipcoBox[6] = 0x63; // 'c'
    ipcoBox[7] = 0x6f; // 'o'
    ipcoBox.set(exifBox, 8);

    // iprp box containing ipco
    const iprpSize = 8 + ipcoBox.length;
    const iprpBox = new Uint8Array(iprpSize);
    iprpBox[0] = (iprpSize >> 24) & 0xff;
    iprpBox[1] = (iprpSize >> 16) & 0xff;
    iprpBox[2] = (iprpSize >> 8) & 0xff;
    iprpBox[3] = iprpSize & 0xff;
    iprpBox[4] = 0x69; // 'i'
    iprpBox[5] = 0x70; // 'p'
    iprpBox[6] = 0x72; // 'r'
    iprpBox[7] = 0x70; // 'p'
    iprpBox.set(ipcoBox, 8);

    // Calculate meta box size
    const metaContentSize = 4 + hdlrBox.length + iprpBox.length; // 4 for fullbox header
    const metaSize = 8 + metaContentSize;
    metaHeader[0] = (metaSize >> 24) & 0xff;
    metaHeader[1] = (metaSize >> 16) & 0xff;
    metaHeader[2] = (metaSize >> 8) & 0xff;
    metaHeader[3] = metaSize & 0xff;

    parts.push(metaHeader);
    parts.push(hdlrBox);
    parts.push(iprpBox);
  } else {
    // Minimal meta box without EXIF
    const metaBox = new Uint8Array([
      0x00, 0x00, 0x00, 0x2d, // size: 45 bytes
      0x6d, 0x65, 0x74, 0x61, // type: 'meta'
      0x00, 0x00, 0x00, 0x00, // version + flags
      // hdlr box
      0x00, 0x00, 0x00, 0x21, // size: 33 bytes
      0x68, 0x64, 0x6c, 0x72, // type: 'hdlr'
      0x00, 0x00, 0x00, 0x00, // version + flags
      0x00, 0x00, 0x00, 0x00, // pre_defined
      0x70, 0x69, 0x63, 0x74, // handler_type: 'pict'
      0x00, 0x00, 0x00, 0x00, // reserved
      0x00, 0x00, 0x00, 0x00, // reserved
      0x00, 0x00, 0x00, 0x00, // reserved
      0x00, // null terminator for name
    ]);
    parts.push(metaBox);
  }

  // mdat box - minimal media data (empty for testing)
  const mdatBox = new Uint8Array([
    0x00, 0x00, 0x00, 0x08, // size: 8 bytes (header only)
    0x6d, 0x64, 0x61, 0x74, // type: 'mdat'
  ]);
  parts.push(mdatBox);

  // Combine all parts
  const totalSize = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(totalSize);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }

  return result;
}

describe('HEIC Integration Tests', () => {
  describe('Minimal HEIC (with EXIF)', () => {
    let imageBytes: Uint8Array;

    beforeAll(() => {
      imageBytes = createMinimalHeic({ withExif: true });
    });

    it('should detect as heic format', () => {
      expect(detectFormat(imageBytes)).toBe('heic');
    });

    it('should detect EXIF metadata', () => {
      const types = getMetadataTypes(imageBytes);
      expect(types).toContain('EXIF');
    });

    it('should anonymize metadata (overwrite with zeros)', async () => {
      const result = await removeMetadata(imageBytes);

      expect(result.format).toBe('heic');
      // HEIC uses lossless anonymization - file size stays the same
      expect(result.cleanedSize).toBe(result.originalSize);

      // Verify the file still starts with valid HEIC structure
      expect(result.data[4]).toBe(0x66); // 'f' from 'ftyp'
      expect(result.data[5]).toBe(0x74); // 't'
      expect(result.data[6]).toBe(0x79); // 'y'
      expect(result.data[7]).toBe(0x70); // 'p'
    });

    it('should preserve image structure integrity', async () => {
      const result = await removeMetadata(imageBytes);

      // Should still be detectable as HEIC
      expect(detectFormat(result.data)).toBe('heic');

      // Major brand should still be 'heic'
      const brand = String.fromCharCode(
        result.data[8],
        result.data[9],
        result.data[10],
        result.data[11]
      );
      expect(brand).toBe('heic');
    });
  });

  describe('Minimal HEIC (without metadata)', () => {
    let imageBytes: Uint8Array;

    beforeAll(() => {
      imageBytes = createMinimalHeic({ withExif: false });
    });

    it('should detect as heic format', () => {
      expect(detectFormat(imageBytes)).toBe('heic');
    });

    it('should handle HEIC without metadata gracefully', async () => {
      const types = getMetadataTypes(imageBytes);
      // Should not contain EXIF (or empty array)
      expect(types.filter(t => t === 'EXIF').length).toBe(0);

      const result = await removeMetadata(imageBytes);
      expect(result.format).toBe('heic');
      // File should remain valid
      expect(detectFormat(result.data)).toBe('heic');
    });
  });

  describe('HEIC format detection edge cases', () => {
    it('should detect heic brand', () => {
      const heicData = createMinimalHeic();
      expect(detectFormat(heicData)).toBe('heic');
    });

    it('should not detect invalid data as HEIC', () => {
      const invalidData = new Uint8Array([0x00, 0x00, 0x00, 0x00]);
      expect(detectFormat(invalidData)).toBe('unknown');
    });

    it('should not detect JPEG as HEIC', () => {
      const jpegData = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
      expect(detectFormat(jpegData)).not.toBe('heic');
    });
  });

  describe('Real HEIC files', () => {
    describe('sewing-threads.heic (iPhone photo)', () => {
      const imagePath = join(FIXTURES_DIR, 'sewing-threads.heic');
      let imageBytes: Uint8Array;

      beforeAll(() => {
        imageBytes = new Uint8Array(readFileSync(imagePath));
      });

      it('should detect as heic format', () => {
        expect(detectFormat(imageBytes)).toBe('heic');
      });

      it('should detect metadata in real iPhone photo', () => {
        const types = getMetadataTypes(imageBytes);
        // Real iPhone photos typically have EXIF and thumbnails
        expect(types.length).toBeGreaterThan(0);
      });

      it('should anonymize metadata while preserving file structure', async () => {
        const result = await removeMetadata(imageBytes);

        expect(result.format).toBe('heic');
        // HEIC uses lossless anonymization - size stays the same
        expect(result.cleanedSize).toBe(result.originalSize);

        // Verify still valid HEIC
        expect(detectFormat(result.data)).toBe('heic');

        // ftyp should be preserved
        expect(result.data[4]).toBe(0x66); // 'f'
        expect(result.data[5]).toBe(0x74); // 't'
        expect(result.data[6]).toBe(0x79); // 'y'
        expect(result.data[7]).toBe(0x70); // 'p'
      });

    });

    describe('soundboard.heic (iPhone photo)', () => {
      const imagePath = join(FIXTURES_DIR, 'soundboard.heic');
      let imageBytes: Uint8Array;

      beforeAll(() => {
        imageBytes = new Uint8Array(readFileSync(imagePath));
      });

      it('should detect as heic format', () => {
        expect(detectFormat(imageBytes)).toBe('heic');
      });

      it('should detect metadata', () => {
        const types = getMetadataTypes(imageBytes);
        expect(types.length).toBeGreaterThan(0);
      });

      it('should process without errors', async () => {
        const result = await removeMetadata(imageBytes);

        expect(result.format).toBe('heic');
        expect(result.data.length).toBe(imageBytes.length);
        expect(detectFormat(result.data)).toBe('heic');
      });
    });

    describe('Multiple HEIC files', () => {
      const heicFiles = [
        { file: 'sewing-threads.heic', description: 'sewing threads photo' },
        { file: 'soundboard.heic', description: 'soundboard photo' },
      ];

      heicFiles.forEach(({ file, description }) => {
        it(`should process ${description} and maintain valid structure`, async () => {
          const imagePath = join(FIXTURES_DIR, file);
          const imageBytes = new Uint8Array(readFileSync(imagePath));

          const result = await removeMetadata(imageBytes);

          // Basic validity checks
          expect(result.format).toBe('heic');
          expect(result.data.length).toBeGreaterThan(0);

          // Should still be valid HEIC after processing
          expect(detectFormat(result.data)).toBe('heic');

          // File size should be preserved (lossless anonymization)
          expect(result.cleanedSize).toBe(result.originalSize);
        });
      });
    });
  });
});
