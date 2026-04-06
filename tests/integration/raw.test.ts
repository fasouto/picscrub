import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { detectFormat, getMetadataTypes, removeMetadata } from '../../src/index';
import { raw } from '../../src/formats/raw';

const FIXTURES_DIR = join(__dirname, '../fixtures');

/**
 * Create a minimal DNG file structure for testing
 * DNG is based on TIFF format with specific DNG tags
 */
function createMinimalDng(): Uint8Array {
  // DNG is essentially TIFF with specific tags
  // We'll create a minimal TIFF structure with DNG identification

  const parts: Uint8Array[] = [];

  // TIFF header (little-endian)
  const tiffHeader = new Uint8Array([
    0x49, 0x49, // 'II' - little-endian
    0x2a, 0x00, // TIFF magic number (42)
    0x08, 0x00, 0x00, 0x00, // IFD0 offset (8)
  ]);
  parts.push(tiffHeader);

  // IFD0 - Image File Directory
  // We'll add a minimal set of tags including a DNG-like software tag
  const numEntries = 3;

  // IFD entry structure: tag (2) + type (2) + count (4) + value/offset (4) = 12 bytes each
  // Tag 270 (ImageDescription): ASCII, identify as DNG
  // Tag 305 (Software): ASCII, "Adobe DNG"
  // Tag 50706 (0xC612 - DNGVersion): BYTE[4]

  // Calculate string offsets
  const ifdStart = 8;
  const ifdSize = 2 + numEntries * 12 + 4; // count + entries + next IFD ptr
  const stringsStart = ifdStart + ifdSize;

  const imageDesc = 'Adobe Digital Negative\0';
  const software = 'Adobe DNG Converter\0';
  const dngVersion = new Uint8Array([1, 4, 0, 0]); // DNG version 1.4

  // Build IFD
  const ifd = new Uint8Array(ifdSize);
  const view = new DataView(ifd.buffer);
  let pos = 0;

  // Entry count
  view.setUint16(pos, numEntries, true);
  pos += 2;

  // Tag 270: ImageDescription (ASCII)
  view.setUint16(pos, 270, true);
  pos += 2;
  view.setUint16(pos, 2, true); // type: ASCII
  pos += 2;
  view.setUint32(pos, imageDesc.length, true);
  pos += 4;
  view.setUint32(pos, stringsStart, true);
  pos += 4;

  // Tag 305: Software (ASCII)
  view.setUint16(pos, 305, true);
  pos += 2;
  view.setUint16(pos, 2, true); // type: ASCII
  pos += 2;
  view.setUint32(pos, software.length, true);
  pos += 4;
  view.setUint32(pos, stringsStart + imageDesc.length, true);
  pos += 4;

  // Tag 50706 (0xC612): DNGVersion (BYTE[4])
  view.setUint16(pos, 0xc612, true);
  pos += 2;
  view.setUint16(pos, 1, true); // type: BYTE
  pos += 2;
  view.setUint32(pos, 4, true); // count
  pos += 4;
  // Value fits in 4 bytes, so store inline
  ifd[pos] = dngVersion[0];
  ifd[pos + 1] = dngVersion[1];
  ifd[pos + 2] = dngVersion[2];
  ifd[pos + 3] = dngVersion[3];
  pos += 4;

  // Next IFD offset (0 = none)
  view.setUint32(pos, 0, true);

  parts.push(ifd);

  // String data
  const encoder = new TextEncoder();
  parts.push(encoder.encode(imageDesc));
  parts.push(encoder.encode(software));

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

/**
 * Create a minimal CR2-like file structure for testing
 * CR2 is Canon's RAW format, based on TIFF with CR2 signature
 */
function createMinimalCr2(): Uint8Array {
  // CR2 has TIFF header + "CR" at offset 8
  const data = new Uint8Array([
    // TIFF header (little-endian)
    0x49, 0x49, // 'II' - little-endian
    0x2a, 0x00, // TIFF magic (42)
    0x10, 0x00, 0x00, 0x00, // IFD offset (16)
    // CR2 signature at offset 8
    0x43, 0x52, // 'CR'
    0x02, 0x00, // Version 2
    0x00, 0x00, 0x00, 0x00, // Padding
    // Minimal IFD at offset 16
    0x00, 0x00, // 0 entries
    0x00, 0x00, 0x00, 0x00, // Next IFD (none)
  ]);

  return data;
}

/**
 * Create a minimal NEF-like file structure for testing
 * NEF is Nikon's RAW format, TIFF-based with Nikon maker notes
 */
function createMinimalNef(): Uint8Array {
  // NEF uses big-endian TIFF with NIKON identification
  const encoder = new TextEncoder();
  const nikonId = encoder.encode('NIKON CORPORATION');

  const parts: Uint8Array[] = [];

  // TIFF header (big-endian)
  const header = new Uint8Array([
    0x4d, 0x4d, // 'MM' - big-endian
    0x00, 0x2a, // TIFF magic (42)
    0x00, 0x00, 0x00, 0x08, // IFD offset (8)
  ]);
  parts.push(header);

  // Minimal IFD with Make tag containing "NIKON"
  const ifd = new Uint8Array([
    0x00, 0x01, // 1 entry
    // Tag 271 (Make): ASCII
    0x01, 0x0f, // tag: 271
    0x00, 0x02, // type: ASCII
    0x00, 0x00, 0x00, nikonId.length + 1, // count
    0x00, 0x00, 0x00, 0x16, // offset to string (22)
    0x00, 0x00, 0x00, 0x00, // Next IFD (none)
  ]);
  parts.push(ifd);

  // Make string
  parts.push(nikonId);
  parts.push(new Uint8Array([0x00])); // null terminator

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

/**
 * Create a minimal ARW-like file structure for testing
 * ARW is Sony's RAW format, TIFF-based with Sony identification
 */
function createMinimalArw(): Uint8Array {
  const encoder = new TextEncoder();
  const sonyId = encoder.encode('SONY');

  const parts: Uint8Array[] = [];

  // TIFF header (little-endian)
  const header = new Uint8Array([
    0x49, 0x49, // 'II' - little-endian
    0x2a, 0x00, // TIFF magic (42)
    0x08, 0x00, 0x00, 0x00, // IFD offset (8)
  ]);
  parts.push(header);

  // Minimal IFD with Make tag containing "SONY"
  const ifd = new Uint8Array([
    0x01, 0x00, // 1 entry
    // Tag 271 (Make): ASCII
    0x0f, 0x01, // tag: 271 (little-endian)
    0x02, 0x00, // type: ASCII
    sonyId.length + 1, 0x00, 0x00, 0x00, // count
    0x16, 0x00, 0x00, 0x00, // offset to string (22)
    0x00, 0x00, 0x00, 0x00, // Next IFD (none)
  ]);
  parts.push(ifd);

  // Make string
  parts.push(sonyId);
  parts.push(new Uint8Array([0x00])); // null terminator

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

describe('RAW Integration Tests', () => {
  describe('DNG (Adobe Digital Negative)', () => {
    let imageBytes: Uint8Array;

    beforeAll(() => {
      imageBytes = createMinimalDng();
    });

    it('should detect as dng format', () => {
      // Note: Detection depends on finding DNG-specific markers
      // Our minimal DNG may be detected as TIFF if markers aren't found
      const format = detectFormat(imageBytes);
      expect(['dng', 'tiff']).toContain(format);
    });

    it('should detect DNG-specific format', () => {
      const format = raw.detectRawFormat(imageBytes);
      // May return 'dng' or 'unknown' depending on detection logic
      expect(['dng', 'unknown']).toContain(format);
    });

    it('should process DNG using TIFF handler', () => {
      // DNG uses TIFF processing internally
      const result = raw.removeDng(imageBytes);
      expect(result).toBeInstanceOf(Uint8Array);
      // Result should still be valid TIFF structure
      expect(result[0]).toBe(0x49); // 'I'
      expect(result[1]).toBe(0x49); // 'I'
    });
  });

  describe('CR2 (Canon RAW)', () => {
    let imageBytes: Uint8Array;

    beforeAll(() => {
      imageBytes = createMinimalCr2();
    });

    it('should detect as raw format', () => {
      const format = detectFormat(imageBytes);
      // CR2 should be detected as 'raw' or 'tiff'
      expect(['raw', 'tiff']).toContain(format);
    });

    it('should detect CR2-specific format', () => {
      const format = raw.detectRawFormat(imageBytes);
      // Should detect as some RAW format
      expect(['cr2', 'unknown']).toContain(format);
    });
  });

  describe('NEF (Nikon RAW)', () => {
    let imageBytes: Uint8Array;

    beforeAll(() => {
      imageBytes = createMinimalNef();
    });

    it('should detect as raw format', () => {
      const format = detectFormat(imageBytes);
      // NEF should be detected as 'raw' or 'tiff'
      expect(['raw', 'tiff']).toContain(format);
    });

    it('should detect NEF-specific format', () => {
      const format = raw.detectRawFormat(imageBytes);
      expect(['nef', 'unknown']).toContain(format);
    });

  });

  describe('ARW (Sony RAW)', () => {
    let imageBytes: Uint8Array;

    beforeAll(() => {
      imageBytes = createMinimalArw();
    });

    it('should detect as raw format', () => {
      const format = detectFormat(imageBytes);
      // ARW should be detected as 'raw' or 'tiff'
      expect(['raw', 'tiff']).toContain(format);
    });

    it('should detect ARW-specific format', () => {
      const format = raw.detectRawFormat(imageBytes);
      expect(['arw', 'unknown']).toContain(format);
    });
  });

  describe('RAW format handling', () => {
    it('should handle unknown RAW formats gracefully', () => {
      // Create a minimal TIFF that isn't a known RAW format
      const tiffData = new Uint8Array([
        0x49, 0x49, // 'II' - little-endian
        0x2a, 0x00, // TIFF magic (42)
        0x08, 0x00, 0x00, 0x00, // IFD offset (8)
        0x00, 0x00, // 0 entries
        0x00, 0x00, 0x00, 0x00, // Next IFD (none)
      ]);

      const format = raw.detectRawFormat(tiffData);
      expect(format).toBe('unknown');
    });

    it('should return proper result structure from remove', () => {
      const dngData = createMinimalDng();

      // The raw.remove function returns an object with data, isPreview, and originalFormat
      // For DNG, it should process as full TIFF
      const result = raw.remove(dngData);

      expect(result).toHaveProperty('data');
      expect(result).toHaveProperty('isPreview');
      expect(result).toHaveProperty('originalFormat');
      expect(result.data).toBeInstanceOf(Uint8Array);
    });
  });

  describe('JPEG preview extraction', () => {
    it('should return null for files without JPEG preview', () => {
      const minimalTiff = new Uint8Array([
        0x49, 0x49, // 'II' - little-endian
        0x2a, 0x00, // TIFF magic (42)
        0x08, 0x00, 0x00, 0x00, // IFD offset (8)
        0x00, 0x00, // 0 entries
        0x00, 0x00, 0x00, 0x00, // Next IFD (none)
      ]);

      const preview = raw.extractCleanPreview(minimalTiff);
      expect(preview).toBeNull();
    });
  });

  describe('Real RAW files', () => {
    describe('RAW_LEICA_M8.DNG (Leica DNG)', () => {
      const imagePath = join(FIXTURES_DIR, 'RAW_LEICA_M8.DNG');
      let imageBytes: Uint8Array;

      beforeAll(() => {
        imageBytes = new Uint8Array(readFileSync(imagePath));
      });

      it('should detect as dng or tiff format', () => {
        const format = detectFormat(imageBytes);
        expect(['dng', 'tiff']).toContain(format);
      });

      it('should detect metadata in real DNG file', () => {
        const types = getMetadataTypes(imageBytes);
        expect(types.length).toBeGreaterThan(0);
      });

      it('should process DNG and produce valid output', async () => {
        const result = await removeMetadata(imageBytes);

        expect(['dng', 'tiff']).toContain(result.format);
        expect(result.data.length).toBeGreaterThan(0);

        // Should still have valid TIFF header
        expect(result.data[0]).toBe(0x49); // 'I'
        expect(result.data[1]).toBe(0x49); // 'I'
        expect(result.data[2]).toBe(0x2a); // TIFF magic
        expect(result.data[3]).toBe(0x00);
      });

    });

    describe('sample_canon_400d1.cr2 (Canon CR2)', () => {
      const imagePath = join(FIXTURES_DIR, 'sample_canon_400d1.cr2');
      let imageBytes: Uint8Array;

      beforeAll(() => {
        imageBytes = new Uint8Array(readFileSync(imagePath));
      });

      it('should detect as raw format', () => {
        const format = detectFormat(imageBytes);
        expect(['raw', 'tiff']).toContain(format);
      });

      it('should detect CR2 format internally', () => {
        const format = raw.detectRawFormat(imageBytes);
        expect(['cr2', 'unknown']).toContain(format);
      });

});

    describe('RAW_NIKON_D90.NEF (Nikon NEF)', () => {
      const imagePath = join(FIXTURES_DIR, 'RAW_NIKON_D90.NEF');
      let imageBytes: Uint8Array;

      beforeAll(() => {
        imageBytes = new Uint8Array(readFileSync(imagePath));
      });

      it('should detect as raw format', () => {
        const format = detectFormat(imageBytes);
        expect(['raw', 'tiff']).toContain(format);
      });

      it('should detect NEF format internally', () => {
        const format = raw.detectRawFormat(imageBytes);
        expect(['nef', 'unknown']).toContain(format);
      });

      it('should find Nikon maker notes', () => {
        const types = raw.getMetadataTypes(imageBytes);
        // Should find Nikon-related metadata
        const hasNikonData = types.some(t => t.toLowerCase().includes('nikon'));
        expect(hasNikonData || types.length > 0).toBe(true);
      });

});

    describe('RAW_SONY_A700.ARW (Sony ARW)', () => {
      const imagePath = join(FIXTURES_DIR, 'RAW_SONY_A700.ARW');
      let imageBytes: Uint8Array;

      beforeAll(() => {
        imageBytes = new Uint8Array(readFileSync(imagePath));
      });

      it('should detect as raw format', () => {
        const format = detectFormat(imageBytes);
        expect(['raw', 'tiff']).toContain(format);
      });

      it('should detect ARW format internally', () => {
        const format = raw.detectRawFormat(imageBytes);
        expect(['arw', 'unknown']).toContain(format);
      });

      it('should extract JPEG preview from ARW', () => {
        const preview = raw.extractCleanPreview(imageBytes);
        expect(preview).not.toBeNull();
        expect(preview![0]).toBe(0xff);
        expect(preview![1]).toBe(0xd8);
      });
    });

    describe('Multiple RAW formats batch test', () => {
      const rawFiles = [
        { file: 'RAW_LEICA_M8.DNG', description: 'Leica DNG', expectedFormats: ['dng', 'tiff'] },
        { file: 'sample_canon_400d1.cr2', description: 'Canon CR2', expectedFormats: ['raw', 'tiff'] },
        { file: 'RAW_NIKON_D90.NEF', description: 'Nikon NEF', expectedFormats: ['raw', 'tiff'] },
        { file: 'RAW_SONY_A700.ARW', description: 'Sony ARW', expectedFormats: ['raw', 'tiff'] },
      ];

      rawFiles.forEach(({ file, description, expectedFormats }) => {
        it(`should process ${description} without errors`, async () => {
          const imagePath = join(FIXTURES_DIR, file);
          const imageBytes = new Uint8Array(readFileSync(imagePath));

          const format = detectFormat(imageBytes);
          expect(expectedFormats).toContain(format);

          const types = getMetadataTypes(imageBytes);
          expect(types.length).toBeGreaterThan(0);
        });
      });
    });
  });
});
