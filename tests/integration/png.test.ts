import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { removeMetadata, detectFormat, getMetadataTypes } from '../../src/index';

const FIXTURES_DIR = join(__dirname, '../fixtures');

describe('PNG Integration Tests', () => {
  describe('1.png', () => {
    const imagePath = join(FIXTURES_DIR, '1.png');
    let imageBytes: Uint8Array;

    beforeAll(() => {
      imageBytes = new Uint8Array(readFileSync(imagePath));
    });

    it('should detect as PNG format', () => {
      expect(detectFormat(imageBytes)).toBe('png');
    });

    it('should remove metadata and produce valid PNG', async () => {
      const result = await removeMetadata(imageBytes);

      expect(result.format).toBe('png');

      // Verify output is valid PNG (magic bytes)
      expect(result.data[0]).toBe(0x89);
      expect(result.data[1]).toBe(0x50); // P
      expect(result.data[2]).toBe(0x4e); // N
      expect(result.data[3]).toBe(0x47); // G
    });
  });

  describe('test.png', () => {
    const imagePath = join(FIXTURES_DIR, 'test.png');
    let imageBytes: Uint8Array;

    beforeAll(() => {
      imageBytes = new Uint8Array(readFileSync(imagePath));
    });

    it('should handle large PNG files', async () => {
      const result = await removeMetadata(imageBytes);

      expect(result.format).toBe('png');
      expect(result.data.length).toBeGreaterThan(0);

      // Verify PNG signature
      expect(result.data[0]).toBe(0x89);
      expect(result.data[1]).toBe(0x50);
    });
  });

  describe('1_with_metadata_changed.png', () => {
    const imagePath = join(FIXTURES_DIR, '1_with_metadata_changed.png');
    let imageBytes: Uint8Array;

    beforeAll(() => {
      imageBytes = new Uint8Array(readFileSync(imagePath));
    });

    it('should produce valid output after removal', async () => {
      const result = await removeMetadata(imageBytes);

      expect(result.format).toBe('png');

      // Cleaned file should be valid PNG
      expect(result.data[0]).toBe(0x89);

      // Should have IHDR chunk after signature
      const ihdrType = String.fromCharCode(
        result.data[12]!,
        result.data[13]!,
        result.data[14]!,
        result.data[15]!
      );
      expect(ihdrType).toBe('IHDR');
    });
  });
});
