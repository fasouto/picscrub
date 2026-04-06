import { describe, it, expect } from 'vitest';
import { webp } from '../../src/formats/webp';
import { detectFormat } from '../../src/detect';
import * as buffer from '../../src/binary/buffer';
import * as dataview from '../../src/binary/dataview';

/**
 * Build a WebP file from chunks
 */
function buildWebp(chunks: { fourcc: string; data: Uint8Array }[]): Uint8Array {
  let contentSize = 4; // "WEBP"
  for (const chunk of chunks) {
    const padding = chunk.data.length % 2;
    contentSize += 8 + chunk.data.length + padding;
  }

  const result = new Uint8Array(8 + contentSize);
  result.set(buffer.fromAscii('RIFF'), 0);
  dataview.writeUint32LE(result, 4, contentSize);
  result.set(buffer.fromAscii('WEBP'), 8);

  let offset = 12;
  for (const chunk of chunks) {
    result.set(buffer.fromAscii(chunk.fourcc), offset);
    offset += 4;
    dataview.writeUint32LE(result, offset, chunk.data.length);
    offset += 4;
    result.set(chunk.data, offset);
    offset += chunk.data.length;
    if (chunk.data.length % 2 === 1) {
      result[offset] = 0;
      offset += 1;
    }
  }

  return result;
}

/**
 * Create a minimal VP8 (lossy) chunk with given dimensions
 */
function createVp8Chunk(width: number, height: number): Uint8Array {
  // VP8 bitstream header: frame tag (3 bytes) + start code + dimensions
  const data = new Uint8Array(10);
  // Frame tag: keyframe, version 0, show_frame=1
  data[0] = 0x9d;
  data[1] = 0x01;
  data[2] = 0x2a;
  // Width (16-bit LE, upper 2 bits = horizontal scale)
  data[3] = width & 0xff;
  data[4] = (width >> 8) & 0x3f;
  // Height (16-bit LE, upper 2 bits = vertical scale)
  data[5] = height & 0xff;
  data[6] = (height >> 8) & 0x3f;
  return data;
}

/**
 * Create a minimal VP8L (lossless) chunk with given dimensions and alpha flag
 */
function createVp8LChunk(width: number, height: number, hasAlpha: boolean): Uint8Array {
  const data = new Uint8Array(5);
  // Signature byte
  data[0] = 0x2f;
  // Width and height packed into 4 bytes (14 bits each + 1 bit alpha)
  const wm1 = width - 1;
  const hm1 = height - 1;
  data[1] = wm1 & 0xff;
  data[2] = ((wm1 >> 8) & 0x3f) | ((hm1 & 0x03) << 6);
  data[3] = (hm1 >> 2) & 0xff;
  data[4] = ((hm1 >> 10) & 0x0f) | (hasAlpha ? 0x10 : 0x00);
  return data;
}

describe('WebP VP8 (lossy) format', () => {
  it('should detect simple VP8 WebP', () => {
    const vp8 = createVp8Chunk(100, 80);
    const data = buildWebp([{ fourcc: 'VP8 ', data: vp8 }]);
    expect(detectFormat(data)).toBe('webp');
  });

  it('should parse and process VP8 WebP without VP8X', () => {
    const vp8 = createVp8Chunk(320, 240);
    const data = buildWebp([{ fourcc: 'VP8 ', data: vp8 }]);
    const result = webp.remove(data);

    // Should still be valid WebP
    expect(result[0]).toBe(0x52); // R
    expect(result[8]).toBe(0x57); // W
  });

  it('should remove EXIF from VP8 WebP and recreate VP8X with correct dimensions', () => {
    const vp8 = createVp8Chunk(640, 480);
    const exifData = buffer.fromAscii('Exif\x00\x00MM\x00*\x00\x00\x00\x08');
    const vp8x = new Uint8Array(10);
    vp8x[0] = 0x08; // EXIF flag
    // 640-1 = 639 = 0x27F
    vp8x[4] = 0x7f;
    vp8x[5] = 0x02;
    vp8x[6] = 0x00;
    // 480-1 = 479 = 0x1DF
    vp8x[7] = 0xdf;
    vp8x[8] = 0x01;
    vp8x[9] = 0x00;

    const data = buildWebp([
      { fourcc: 'VP8X', data: vp8x },
      { fourcc: 'VP8 ', data: vp8 },
      { fourcc: 'EXIF', data: exifData },
    ]);

    const result = webp.remove(data);
    const types = webp.getMetadataTypes(result);
    expect(types).not.toContain('EXIF');
  });
});

describe('WebP VP8L (lossless) format', () => {
  it('should detect simple VP8L WebP', () => {
    const vp8l = createVp8LChunk(200, 150, false);
    const data = buildWebp([{ fourcc: 'VP8L', data: vp8l }]);
    expect(detectFormat(data)).toBe('webp');
  });

  it('should parse and process VP8L WebP without VP8X', () => {
    const vp8l = createVp8LChunk(100, 100, false);
    const data = buildWebp([{ fourcc: 'VP8L', data: vp8l }]);
    const result = webp.remove(data);

    expect(result[0]).toBe(0x52); // R
    expect(result[8]).toBe(0x57); // W
  });

  it('should remove EXIF from VP8L WebP and recreate VP8X when ICCP present', () => {
    const vp8l = createVp8LChunk(800, 600, true);
    const exifData = buffer.fromAscii('Exif\x00\x00II*\x00\x08\x00\x00\x00');
    const iccpData = buffer.fromAscii('sRGB\x00\x00'); // minimal ICC stub
    const vp8x = new Uint8Array(10);
    vp8x[0] = (1 << 5) | (1 << 4) | (1 << 3); // ICC + Alpha + EXIF flags
    vp8x[4] = 799 & 0xff;
    vp8x[5] = (799 >> 8) & 0xff;
    vp8x[6] = 0;
    vp8x[7] = 599 & 0xff;
    vp8x[8] = (599 >> 8) & 0xff;
    vp8x[9] = 0;

    const data = buildWebp([
      { fourcc: 'VP8X', data: vp8x },
      { fourcc: 'ICCP', data: iccpData },
      { fourcc: 'VP8L', data: vp8l },
      { fourcc: 'EXIF', data: exifData },
    ]);

    const result = webp.remove(data, { preserveColorProfile: true });
    const types = webp.getMetadataTypes(result);
    expect(types).not.toContain('EXIF');
    expect(types).toContain('ICC Profile');

    // VP8X should exist because ICCP is preserved
    const chunks = webp.parseChunks(result);
    const newVp8x = chunks.find(c => c.fourcc === 'VP8X');
    expect(newVp8x).toBeDefined();
    // EXIF flag should be cleared
    expect(newVp8x!.data[0]! & (1 << 3)).toBe(0);
    // ICC flag should be set
    expect(newVp8x!.data[0]! & (1 << 5)).toBeTruthy();
  });

  it('should drop VP8X when only VP8L remains after EXIF removal', () => {
    const vp8l = createVp8LChunk(50, 50, true);
    const exifData = buffer.fromAscii('Exif\x00\x00');
    const vp8x = new Uint8Array(10);
    vp8x[0] = (1 << 3); // EXIF flag only
    vp8x[4] = 49;
    vp8x[7] = 49;

    const data = buildWebp([
      { fourcc: 'VP8X', data: vp8x },
      { fourcc: 'VP8L', data: vp8l },
      { fourcc: 'EXIF', data: exifData },
    ]);

    const result = webp.remove(data);
    const chunks = webp.parseChunks(result);

    // VP8X not needed when only VP8L remains (alpha is in VP8L bitstream)
    const hasVp8x = chunks.some(c => c.fourcc === 'VP8X');
    expect(hasVp8x).toBe(false);

    // VP8L should still be present
    const hasVp8l = chunks.some(c => c.fourcc === 'VP8L');
    expect(hasVp8l).toBe(true);
  });
});
