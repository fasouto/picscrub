import { RemoveOptions } from '../types.js';
import { CorruptedFileError } from '../errors.js';
import * as buffer from '../binary/buffer.js';
import * as dataview from '../binary/dataview.js';
import { FILE_SIGNATURES } from '../signatures.js';

/**
 * JPEG marker constants
 */
const MARKERS = {
  SOI: 0xffd8, // Start of Image
  EOI: 0xffd9, // End of Image
  SOS: 0xffda, // Start of Scan (image data follows)
  APP0: 0xffe0, // JFIF
  APP1: 0xffe1, // EXIF, XMP
  APP2: 0xffe2, // ICC Profile
  APP13: 0xffed, // IPTC/Photoshop
  APP14: 0xffee, // Adobe
  COM: 0xfffe, // Comment
} as const;

/**
 * Metadata signatures within APP segments
 */
const METADATA_SIGNATURES = {
  EXIF: buffer.fromAscii('Exif\x00\x00'),
  XMP: buffer.fromAscii('http://ns.adobe.com/xap/1.0/\x00'),
  XMP_EXT: buffer.fromAscii('http://ns.adobe.com/xmp/extension/\x00'),
  ICC: buffer.fromAscii('ICC_PROFILE\x00'),
  IPTC: buffer.fromAscii('Photoshop 3.0\x008BIM'),
  ADOBE: buffer.fromAscii('Adobe'),
} as const;

/**
 * JPEG segment structure
 */
interface JpegSegment {
  marker: number;
  data: Uint8Array;
  offset: number;
}

/**
 * Parse JPEG into segments
 */
function parseSegments(data: Uint8Array): JpegSegment[] {
  if (!buffer.startsWith(data, FILE_SIGNATURES.JPEG)) {
    throw new CorruptedFileError('Invalid JPEG: missing SOI marker');
  }

  const segments: JpegSegment[] = [];
  let offset = 2; // Skip SOI

  while (offset < data.length - 1) {
    // Find next marker (0xFF followed by non-zero, non-0xFF)
    if (data[offset] !== 0xff) {
      throw new CorruptedFileError('Invalid JPEG: expected marker', offset);
    }

    // Skip padding 0xFF bytes
    while (offset < data.length && data[offset] === 0xff) {
      offset++;
    }

    if (offset >= data.length) {
      break;
    }

    const markerType = data[offset]!;
    offset++;

    // EOI has no length
    if (markerType === 0xd9) {
      segments.push({
        marker: 0xffd9,
        data: new Uint8Array(0),
        offset: offset - 2,
      });
      break;
    }

    // SOS: rest of file is image data (with possible EOI at end)
    if (markerType === 0xda) {
      const sosStart = offset - 2;
      // Find EOI at end
      let sosEnd = data.length;
      for (let i = data.length - 2; i > offset; i--) {
        if (data[i] === 0xff && data[i + 1] === 0xd9) {
          sosEnd = i;
          break;
        }
      }
      segments.push({
        marker: 0xffda,
        data: data.slice(sosStart, sosEnd),
        offset: sosStart,
      });
      // Add EOI if found
      if (sosEnd < data.length) {
        segments.push({
          marker: 0xffd9,
          data: new Uint8Array(0),
          offset: sosEnd,
        });
      }
      break;
    }

    // RST markers (0xD0-0xD7) have no length
    if (markerType >= 0xd0 && markerType <= 0xd7) {
      segments.push({
        marker: 0xff00 | markerType,
        data: new Uint8Array(0),
        offset: offset - 2,
      });
      continue;
    }

    // Read segment length
    if (offset + 2 > data.length) {
      throw new CorruptedFileError('Invalid JPEG: truncated segment', offset);
    }

    const length = dataview.readUint16BE(data, offset);
    if (length < 2) {
      throw new CorruptedFileError('Invalid JPEG: segment length too small', offset);
    }

    const segmentEnd = offset + length;
    if (segmentEnd > data.length) {
      throw new CorruptedFileError('Invalid JPEG: segment extends beyond file', offset);
    }

    segments.push({
      marker: 0xff00 | markerType,
      data: data.slice(offset - 2, segmentEnd),
      offset: offset - 2,
    });

    offset = segmentEnd;
  }

  return segments;
}

/**
 * Check if a segment is EXIF APP1
 */
function isExifSegment(segment: JpegSegment): boolean {
  if (segment.marker !== MARKERS.APP1) {
    return false;
  }
  // Skip marker (2) + length (2) = 4 bytes
  if (segment.data.length < 10) {
    return false;
  }
  return buffer.matchesAt(segment.data, 4, METADATA_SIGNATURES.EXIF);
}

/**
 * Check if a segment is XMP APP1
 */
function isXmpSegment(segment: JpegSegment): boolean {
  if (segment.marker !== MARKERS.APP1) {
    return false;
  }
  if (segment.data.length < 35) {
    return false;
  }
  return (
    buffer.matchesAt(segment.data, 4, METADATA_SIGNATURES.XMP) ||
    buffer.matchesAt(segment.data, 4, METADATA_SIGNATURES.XMP_EXT)
  );
}

/**
 * Check if a segment is ICC Profile APP2
 */
function isIccSegment(segment: JpegSegment): boolean {
  if (segment.marker !== MARKERS.APP2) {
    return false;
  }
  if (segment.data.length < 18) {
    return false;
  }
  return buffer.matchesAt(segment.data, 4, METADATA_SIGNATURES.ICC);
}

/**
 * Check if a segment is IPTC APP13
 */
function isIptcSegment(segment: JpegSegment): boolean {
  if (segment.marker !== MARKERS.APP13) {
    return false;
  }
  if (segment.data.length < 20) {
    return false;
  }
  // Check for "Photoshop 3.0" or just IPTC data
  return buffer.matchesAt(segment.data, 4, buffer.fromAscii('Photoshop'));
}

/**
 * Check if a segment is Adobe APP14
 */
function isAdobeSegment(segment: JpegSegment): boolean {
  if (segment.marker !== MARKERS.APP14) {
    return false;
  }
  if (segment.data.length < 9) {
    return false;
  }
  return buffer.matchesAt(segment.data, 4, METADATA_SIGNATURES.ADOBE);
}

/**
 * Check if a segment is a Comment
 */
function isCommentSegment(segment: JpegSegment): boolean {
  return segment.marker === MARKERS.COM;
}

/**
 * Extract orientation from EXIF segment
 */
function getOrientationFromExif(segment: JpegSegment): number | null {
  if (!isExifSegment(segment)) {
    return null;
  }

  try {
    // EXIF data starts at offset 10 (marker + length + "Exif\0\0")
    const exifStart = 10;
    if (segment.data.length < exifStart + 8) {
      return null;
    }

    // Check byte order
    const byteOrder = buffer.toAscii(segment.data, exifStart, 2);
    const littleEndian = byteOrder === 'II';

    // Skip to IFD0
    const ifdOffset = dataview.readUint32(segment.data, exifStart + 4, littleEndian);
    const ifdStart = exifStart + ifdOffset;

    if (ifdStart + 2 > segment.data.length) {
      return null;
    }

    const numEntries = dataview.readUint16(segment.data, ifdStart, littleEndian);

    // Search for orientation tag (0x0112)
    for (let i = 0; i < numEntries; i++) {
      const entryOffset = ifdStart + 2 + i * 12;
      if (entryOffset + 12 > segment.data.length) {
        break;
      }

      const tag = dataview.readUint16(segment.data, entryOffset, littleEndian);
      if (tag === 0x0112) {
        // Orientation tag
        const value = dataview.readUint16(segment.data, entryOffset + 8, littleEndian);
        return value;
      }
    }
  } catch {
    return null;
  }

  return null;
}

/**
 * Extract copyright string from EXIF segment
 */
function getCopyrightFromExif(segment: JpegSegment): string | null {
  if (!isExifSegment(segment)) {
    return null;
  }

  try {
    const exifStart = 10;
    if (segment.data.length < exifStart + 8) {
      return null;
    }

    const byteOrder = buffer.toAscii(segment.data, exifStart, 2);
    const littleEndian = byteOrder === 'II';

    const ifdOffset = dataview.readUint32(segment.data, exifStart + 4, littleEndian);
    const ifdStart = exifStart + ifdOffset;

    if (ifdStart + 2 > segment.data.length) {
      return null;
    }

    const numEntries = dataview.readUint16(segment.data, ifdStart, littleEndian);

    for (let i = 0; i < numEntries; i++) {
      const entryOffset = ifdStart + 2 + i * 12;
      if (entryOffset + 12 > segment.data.length) {
        break;
      }

      const tag = dataview.readUint16(segment.data, entryOffset, littleEndian);
      if (tag === 0x8298) {
        // Copyright tag - type ASCII
        const count = dataview.readUint32(segment.data, entryOffset + 4, littleEndian);
        let valueStart: number;
        if (count <= 4) {
          valueStart = entryOffset + 8;
        } else {
          valueStart = exifStart + dataview.readUint32(segment.data, entryOffset + 8, littleEndian);
        }
        if (valueStart + count > segment.data.length) {
          return null;
        }
        // Trim null terminator
        const end = segment.data[valueStart + count - 1] === 0 ? count - 1 : count;
        return buffer.toAscii(segment.data, valueStart, end);
      }
    }
  } catch {
    return null;
  }

  return null;
}

/**
 * Create minimal EXIF segment with preserved tags (orientation and/or copyright)
 */
function createPreservedExif(orientation: number | null, copyright: string | null): Uint8Array {
  const entries: Uint8Array[] = [];
  const extraData: Uint8Array[] = [];
  let entryCount = 0;

  // Calculate where extra data starts (after IFD entries + next IFD pointer)
  // We'll calculate this after counting entries
  const calcExtraOffset = (count: number) => 8 + 2 + count * 12 + 4; // TIFF header + count + entries + next IFD

  // Build entries list first to count them
  if (orientation !== null) entryCount++;
  if (copyright !== null) entryCount++;

  let extraOffset = calcExtraOffset(entryCount);

  // Orientation entry (tag 0x0112, SHORT)
  if (orientation !== null) {
    const entry = new Uint8Array(12);
    entry[0] = 0x01;
    entry[1] = 0x12; // tag
    entry[2] = 0x00;
    entry[3] = 0x03; // SHORT
    entry[4] = 0x00;
    entry[5] = 0x00;
    entry[6] = 0x00;
    entry[7] = 0x01; // count
    entry[8] = (orientation >> 8) & 0xff;
    entry[9] = orientation & 0xff;
    entries.push(entry);
  }

  // Copyright entry (tag 0x8298, ASCII)
  if (copyright !== null) {
    const copyrightBytes = buffer.fromAscii(copyright + '\x00');
    const entry = new Uint8Array(12);
    entry[0] = 0x82;
    entry[1] = 0x98; // tag
    entry[2] = 0x00;
    entry[3] = 0x02; // ASCII
    // count (big-endian)
    entry[4] = (copyrightBytes.length >> 24) & 0xff;
    entry[5] = (copyrightBytes.length >> 16) & 0xff;
    entry[6] = (copyrightBytes.length >> 8) & 0xff;
    entry[7] = copyrightBytes.length & 0xff;

    if (copyrightBytes.length <= 4) {
      entry.set(copyrightBytes, 8);
    } else {
      // Offset to extra data (big-endian)
      entry[8] = (extraOffset >> 24) & 0xff;
      entry[9] = (extraOffset >> 16) & 0xff;
      entry[10] = (extraOffset >> 8) & 0xff;
      entry[11] = extraOffset & 0xff;
      extraData.push(copyrightBytes);
      extraOffset += copyrightBytes.length;
    }
    entries.push(entry);
  }

  const tiffHeader = new Uint8Array([
    0x4d, 0x4d, // MM (big-endian)
    0x00, 0x2a, // TIFF magic
    0x00, 0x00, 0x00, 0x08, // IFD0 offset
  ]);

  const ifdCount = new Uint8Array([(entryCount >> 8) & 0xff, entryCount & 0xff]);
  const nextIfd = new Uint8Array([0x00, 0x00, 0x00, 0x00]);

  const exifId = buffer.fromAscii('Exif\x00\x00');
  const content = buffer.concat(exifId, tiffHeader, ifdCount, ...entries, nextIfd, ...extraData);
  const length = content.length + 2;

  const segment = new Uint8Array(length + 2);
  segment[0] = 0xff;
  segment[1] = 0xe1;
  dataview.writeUint16BE(segment, 2, length);
  segment.set(content, 4);

  return segment;
}

/**
 * Should this segment be kept based on options?
 */
function shouldKeepSegment(segment: JpegSegment, options: RemoveOptions): boolean {
  // Always keep non-metadata segments
  if (segment.marker === MARKERS.SOS || segment.marker === MARKERS.EOI) {
    return true;
  }

  // Keep JFIF (APP0)
  if (segment.marker === MARKERS.APP0) {
    return true;
  }

  // Check metadata segments
  if (isExifSegment(segment)) {
    return false; // Always remove, but may recreate with orientation
  }

  if (isXmpSegment(segment)) {
    return false;
  }

  if (isIccSegment(segment)) {
    return options.preserveColorProfile === true;
  }

  if (isIptcSegment(segment)) {
    return false;
  }

  if (isAdobeSegment(segment)) {
    return false;
  }

  if (isCommentSegment(segment)) {
    return false;
  }

  // Unknown APP segments: remove for safety (may contain metadata)
  if (segment.marker >= MARKERS.APP0 && segment.marker <= 0xffef) {
    return false;
  }

  return true;
}

/**
 * Remove metadata from JPEG image
 */
export function remove(data: Uint8Array, options: RemoveOptions = {}): Uint8Array {
  const segments = parseSegments(data);
  const removedMetadata: string[] = [];
  let orientation: number | null = null;
  let copyright: string | null = null;

  // Extract values to preserve from EXIF before stripping
  for (const segment of segments) {
    if (isExifSegment(segment)) {
      if (options.preserveOrientation === true && orientation === null) {
        orientation = getOrientationFromExif(segment);
      }
      if (options.preserveCopyright === true && copyright === null) {
        copyright = getCopyrightFromExif(segment);
      }
    }
  }

  // Filter segments
  const keptSegments: Uint8Array[] = [FILE_SIGNATURES.JPEG_SOI];
  let insertedPreserved = false;

  for (const segment of segments) {
    if (shouldKeepSegment(segment, options)) {
      if (segment.marker === MARKERS.SOS) {
        // Before SOS, insert preserved EXIF tags if needed
        if ((orientation !== null || copyright !== null) && !insertedPreserved) {
          keptSegments.push(createPreservedExif(orientation, copyright));
          insertedPreserved = true;
        }
      }

      if (segment.data.length > 0) {
        keptSegments.push(segment.data);
      } else if (segment.marker === MARKERS.EOI) {
        keptSegments.push(new Uint8Array([0xff, 0xd9]));
      }
    } else {
      // Track what was removed
      if (isExifSegment(segment)) {
        removedMetadata.push('EXIF');
      } else if (isXmpSegment(segment)) {
        removedMetadata.push('XMP');
      } else if (isIccSegment(segment)) {
        removedMetadata.push('ICC Profile');
      } else if (isIptcSegment(segment)) {
        removedMetadata.push('IPTC');
      } else if (isAdobeSegment(segment)) {
        removedMetadata.push('Adobe');
      } else if (isCommentSegment(segment)) {
        removedMetadata.push('Comment');
      }
    }
  }

  return buffer.concat(...keptSegments);
}

/**
 * Get list of metadata types present in the image
 */
export function getMetadataTypes(data: Uint8Array): string[] {
  const segments = parseSegments(data);
  const types: string[] = [];

  for (const segment of segments) {
    if (isExifSegment(segment)) {
      types.push('EXIF');
    } else if (isXmpSegment(segment)) {
      types.push('XMP');
    } else if (isIccSegment(segment)) {
      types.push('ICC Profile');
    } else if (isIptcSegment(segment)) {
      types.push('IPTC');
    } else if (isAdobeSegment(segment)) {
      types.push('Adobe');
    } else if (isCommentSegment(segment)) {
      types.push('Comment');
    }
  }

  return [...new Set(types)]; // Deduplicate
}

export const jpeg = {
  remove,
  getMetadataTypes,
  parseSegments,
};

export default jpeg;
