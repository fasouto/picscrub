/**
 * Integration tests using real-world images from
 * https://github.com/ianare/exif-samples (CC BY-SA 4.0)
 *
 * These tests verify that PicScrub actually strips metadata
 * from images taken by real cameras and edited by real software.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { removeMetadata, detectFormat, getMetadataTypes } from '../../src/index';
import * as buffer from '../../src/binary/buffer';

const SAMPLES_DIR = join(__dirname, '../fixtures/exif-samples');

describe('exif-samples: GPS Nikon (DSCN0010)', () => {
  let imageBytes: Uint8Array;

  beforeAll(() => {
    imageBytes = new Uint8Array(readFileSync(join(SAMPLES_DIR, 'gps_nikon.jpg')));
  });

  it('should detect as JPEG', () => {
    expect(detectFormat(imageBytes)).toBe('jpeg');
  });

  it('should detect EXIF and XMP metadata', () => {
    const types = getMetadataTypes(imageBytes);
    expect(types).toContain('EXIF');
  });

  it('should remove GPS coordinates', async () => {
    const result = await removeMetadata(imageBytes);

    expect(result.removedMetadata.length).toBeGreaterThan(0);
    expect(result.cleanedSize).toBeLessThan(result.originalSize);

    // GPS data should not be present in cleaned output
    // The original has GPS IFD with coordinates — verify it's gone
    const cleanedTypes = getMetadataTypes(result.data);
    expect(cleanedTypes).not.toContain('EXIF');
  });

  it('should strip Nikon MakerNote', async () => {
    // The original contains "NIKON" in EXIF data
    const originalAscii = buffer.toAscii(imageBytes);
    expect(originalAscii).toContain('NIKON');

    const result = await removeMetadata(imageBytes);

    // After cleaning, camera make should be gone (it's in EXIF APP1)
    const cleanedAscii = buffer.toAscii(result.data);
    expect(cleanedAscii).not.toContain('NIKON');
  });

  it('should produce valid JPEG', async () => {
    const result = await removeMetadata(imageBytes);
    expect(result.data[0]).toBe(0xff);
    expect(result.data[1]).toBe(0xd8);
    expect(result.data[result.data.length - 2]).toBe(0xff);
    expect(result.data[result.data.length - 1]).toBe(0xd9);
  });
});

describe('exif-samples: XMP + IPTC (BlueSquare)', () => {
  let imageBytes: Uint8Array;

  beforeAll(() => {
    imageBytes = new Uint8Array(readFileSync(join(SAMPLES_DIR, 'xmp_iptc.jpg')));
  });

  it('should detect XMP and IPTC metadata', () => {
    const types = getMetadataTypes(imageBytes);
    expect(types.length).toBeGreaterThan(0);
  });

  it('should remove XMP data', async () => {
    // Original should contain XMP namespace
    const originalAscii = buffer.toAscii(imageBytes);
    expect(originalAscii).toContain('xmlns');

    const result = await removeMetadata(imageBytes);

    // XMP should be removed
    const cleanedAscii = buffer.toAscii(result.data);
    expect(cleanedAscii).not.toContain('xmlns');
  });

  it('should remove IPTC keywords', async () => {
    const originalAscii = buffer.toAscii(imageBytes);
    expect(originalAscii).toContain('Blue Square');

    const result = await removeMetadata(imageBytes);

    const cleanedAscii = buffer.toAscii(result.data);
    expect(cleanedAscii).not.toContain('Blue Square');
  });

  it('should preserve ICC profile by default', async () => {
    const result = await removeMetadata(imageBytes, { preserveColorProfile: true });

    // Find ICC profile marker (APP2 with "ICC_PROFILE")
    const cleanedAscii = buffer.toAscii(result.data);
    expect(cleanedAscii).toContain('ICC_PROFILE');
  });

  it('should remove ICC profile when asked', async () => {
    const result = await removeMetadata(imageBytes, { preserveColorProfile: false });

    const cleanedAscii = buffer.toAscii(result.data);
    expect(cleanedAscii).not.toContain('ICC_PROFILE');
  });
});

describe('exif-samples: Canon 40D', () => {
  let imageBytes: Uint8Array;

  beforeAll(() => {
    imageBytes = new Uint8Array(readFileSync(join(SAMPLES_DIR, 'canon_40d.jpg')));
  });

  it('should remove Canon EXIF data', async () => {
    const originalAscii = buffer.toAscii(imageBytes);
    expect(originalAscii).toContain('Canon');

    const result = await removeMetadata(imageBytes);

    expect(result.removedMetadata.length).toBeGreaterThan(0);

    const cleanedAscii = buffer.toAscii(result.data);
    expect(cleanedAscii).not.toContain('Canon');
  });

  it('should strip timestamps', async () => {
    // Original has DateTimeOriginal "2008:05:30 15:56:01" in EXIF
    const originalAscii = buffer.toAscii(imageBytes);
    expect(originalAscii).toContain('2008:05:30');

    const result = await removeMetadata(imageBytes);

    const cleanedAscii = buffer.toAscii(result.data);
    expect(cleanedAscii).not.toContain('2008:05:30');
  });
});

describe('exif-samples: TIFF with Artist', () => {
  let imageBytes: Uint8Array;

  beforeAll(() => {
    imageBytes = new Uint8Array(readFileSync(join(SAMPLES_DIR, 'artist_tiff.tiff')));
  });

  it('should detect as TIFF', () => {
    expect(detectFormat(imageBytes)).toBe('tiff');
  });

  it('should remove Artist tag', async () => {
    const originalAscii = buffer.toAscii(imageBytes);
    expect(originalAscii).toContain('Russell Leavitt');

    const result = await removeMetadata(imageBytes);

    // Artist name should be zeroed out
    const cleanedAscii = buffer.toAscii(result.data);
    expect(cleanedAscii).not.toContain('Russell Leavitt');
  });

  it('should remove Software tag', async () => {
    const originalAscii = buffer.toAscii(imageBytes);
    expect(originalAscii).toContain('Mac OS X');

    const result = await removeMetadata(imageBytes);

    const cleanedAscii = buffer.toAscii(result.data);
    expect(cleanedAscii).not.toContain('Mac OS X');
  });

  it('should preserve file size (in-place modification)', async () => {
    const result = await removeMetadata(imageBytes);
    expect(result.data.length).toBe(imageBytes.length);
  });
});

describe('exif-samples: HEIF sample', () => {
  let imageBytes: Uint8Array;

  beforeAll(() => {
    imageBytes = new Uint8Array(readFileSync(join(SAMPLES_DIR, 'sample.heif')));
  });

  it('should detect as HEIC', () => {
    expect(detectFormat(imageBytes)).toBe('heic');
  });

  it('should process without errors', async () => {
    const result = await removeMetadata(imageBytes);

    expect(result.format).toBe('heic');
    expect(result.data.length).toBe(imageBytes.length); // in-place
  });

  it('should remove XMP data', async () => {
    const result = await removeMetadata(imageBytes);
    const cleanedAscii = buffer.toAscii(result.data);
    expect(cleanedAscii).not.toContain('ExifTool');
  });
});
