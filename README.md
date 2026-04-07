# PicScrub

> Remove EXIF, GPS, and other metadata from images. Fast, lossless, zero dependencies.

**[Try it online at picscrub.com](https://picscrub.com)** — no install needed, runs in your browser.

[![npm version](https://badge.fury.io/js/picscrub.svg)](https://badge.fury.io/js/picscrub)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Why PicScrub?

When you share photos online, they often contain hidden metadata that reveals:
- **GPS coordinates** - Exact location where the photo was taken
- **Device information** - Camera model, serial numbers
- **Timestamps** - When the photo was taken
- **Personal info** - Author name, copyright, comments
- **Thumbnails** - Embedded preview images that may contain edited-out content

PicScrub removes all this metadata through direct binary manipulation, without re-encoding the image.

## Features

- **9 formats** - JPEG, PNG, WebP, GIF, SVG, TIFF, HEIC, DNG, RAW
- **Fast** - Binary manipulation, no re-encoding
- **Lossless** - Preserves image quality perfectly
- **Tree-shakeable** - Import only what you need (~50KB core)
- **TypeScript** - Full type definitions included
- **Zero dependencies** - No external runtime dependencies

## Installation

```bash
npm install picscrub
```

## Quick Start

```typescript
import { removeMetadata } from 'picscrub';

// From file input
const fileInput = document.querySelector('input[type="file"]');
fileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  const buffer = await file.arrayBuffer();

  const result = await removeMetadata(new Uint8Array(buffer));

  console.log(`Format: ${result.format}`);
  console.log(`Removed: ${result.removedMetadata.join(', ')}`);
  console.log(`Size: ${result.originalSize} -> ${result.cleanedSize} bytes`);

  // Download cleaned image
  const blob = new Blob([result.data], { type: `image/${result.format}` });
  const url = URL.createObjectURL(blob);
  // ... use url for download or display
});
```

## Node.js / CLI

### File API

Process image files directly on disk:

```typescript
import { processFile } from 'picscrub/node';

// Creates photo-clean.jpg alongside the original
const result = await processFile('photo.jpg');

// Overwrite the original
await processFile('photo.jpg', { inPlace: true });

// Custom output path
await processFile('photo.jpg', { outputPath: 'clean/photo.jpg' });

// Custom suffix
await processFile('photo.jpg', { suffix: '-stripped' });

// With preserve options
await processFile('photo.jpg', {
  preserveOrientation: true,
  preserveColorProfile: true,
});
```

### CLI

```bash
# Process files (creates *-clean.* versions)
npx picscrub photo.jpg

# Process multiple files
npx picscrub *.jpg

# Overwrite originals
npx picscrub -i photo.jpg

# Custom output
npx picscrub -o clean.jpg photo.jpg

# Preserve orientation
npx picscrub --preserve-orientation photo.jpg
```

Options:

| Flag | Description |
|------|-------------|
| `-i, --in-place` | Overwrite original files |
| `-o, --output <path>` | Output file (single file only) |
| `-s, --suffix <suffix>` | Output suffix (default: "-clean") |
| `--preserve-orientation` | Keep EXIF orientation tag |
| `--preserve-color-profile` | Keep ICC color profile |
| `--preserve-copyright` | Keep copyright notice |
| `-q, --quiet` | Suppress output |
| `-h, --help` | Show help |
| `-v, --version` | Show version |

## API Reference

### `removeMetadata(input, options?)`

Remove metadata from an image.

```typescript
const result = await removeMetadata(imageBytes, {
  preserveOrientation: true,   // Keep EXIF orientation (rotation)
  preserveColorProfile: true,  // Keep ICC color profile
  preserveCopyright: true,     // Keep copyright notice
  preserveTitle: true,         // SVG: Keep <title>
  preserveDescription: true,   // SVG: Keep <desc>
});
```

**Returns:**

```typescript
interface RemoveResult {
  data: Uint8Array;          // Cleaned image
  format: SupportedFormat;   // Detected format
  originalSize: number;      // Before (bytes)
  cleanedSize: number;       // After (bytes)
  removedMetadata: string[]; // What was removed
}
```

### `detectFormat(data)`

Detect image format from binary data.

```typescript
import { detectFormat } from 'picscrub';

const format = detectFormat(imageBytes);
// 'jpeg' | 'png' | 'webp' | 'gif' | 'svg' | 'tiff' | 'heic' | 'dng' | 'raw' | 'unknown'
```

### `getMetadataTypes(data)`

Get list of metadata types without removing them.

```typescript
import { getMetadataTypes } from 'picscrub';

const types = getMetadataTypes(imageBytes);
// ['EXIF', 'XMP', 'ICC Profile', 'GPS']
```

## Supported Formats

| Format | Metadata Removed | Quality Impact |
|--------|------------------|----------------|
| **JPEG** | EXIF, XMP, IPTC, ICC Profile, Comments, Adobe | None |
| **PNG** | tEXt, iTXt, zTXt, eXIf, iCCP | None |
| **WebP** | EXIF, XMP, ICCP | None |
| **GIF** | Comments, XMP, Application Extensions | None |
| **SVG** | metadata, RDF, comments, editor namespaces | None |
| **TIFF** | EXIF, GPS, XMP, ICC Profile | None |
| **HEIC** | EXIF, GPS, Thumbnails, MakerNotes | None* |
| **DNG** | Full TIFF-based metadata | None |
| **RAW** | Extracts clean JPEG preview | Preview only |

*HEIC uses lossless anonymization - metadata is overwritten with zeros rather than removed.

## Known Limitations

### TIFF Format

- Basic TIFF files are fully supported
- Complex TIFF structures may have limitations:
  - **Multi-page TIFFs**: Only the first IFD is processed
  - **Tiled images**: May not preserve all tile offsets correctly
  - **Complex offset chains**: Files with multiple IFDs and intricate offset dependencies may not process correctly
- **Recommendation**: Test with your specific TIFF files before production use

### HEIC Format

- Uses "lossless anonymization" approach for safety
- **Metadata is overwritten with zeros**, not removed
- File size remains the same (metadata bytes become zeros)
- Image data (HEVC stream) is completely preserved
- Embedded thumbnails are destroyed (overwritten with pattern data)
- This approach ensures file structure integrity without complex offset recalculation

### RAW Formats

| Format | Handling | Output |
|--------|----------|--------|
| **DNG** | Full TIFF-based processing | Clean DNG file |
| **CR2** (Canon) | JPEG preview extraction | Clean JPEG |
| **NEF** (Nikon) | JPEG preview extraction | Clean JPEG |
| **ARW** (Sony) | JPEG preview extraction | Clean JPEG |

- **DNG**: Fully supported using TIFF processing (DNG is TIFF-based)
- **Proprietary formats** (CR2, NEF, ARW): Returns cleaned embedded JPEG preview
  - Original RAW sensor data is not preserved in output
  - Full-resolution JPEG is extracted from the embedded preview
  - Use this for sharing previews, not for archiving RAW files

## How It Works

PicScrub operates directly on the binary structure of image files:

- **JPEG**: Removes APP1-APP14 segments (EXIF, XMP, IPTC, ICC, Comments)
- **PNG**: Filters out text chunks (tEXt, iTXt, zTXt) and EXIF chunks
- **WebP**: Removes EXIF/XMP chunks and updates VP8X header
- **GIF**: Removes comment and application extension blocks
- **SVG**: Regex-based parsing, removes metadata elements and editor attributes
- **TIFF**: Filters IFD entries to remove metadata tags
- **HEIC**: Overwrites EXIF/thumbnails with zeros (preserves structure)

No image re-encoding occurs - pixel data is never touched.

## Advanced Usage

### Format-Specific Handlers

```typescript
import { jpeg, png, webp, gif, svg, tiff, heic, raw } from 'picscrub';

// Use format-specific handlers directly
const cleaned = jpeg.remove(jpegBytes, { preserveOrientation: true });
```

### File Signatures

```typescript
import { FILE_SIGNATURES } from 'picscrub';

// Access magic bytes for format detection
console.log(FILE_SIGNATURES.JPEG); // Uint8Array([0xff, 0xd8, 0xff])
console.log(FILE_SIGNATURES.PNG);  // Uint8Array([0x89, 0x50, ...])
```

### Binary Utilities

```typescript
import { buffer, dataview, crc32 } from 'picscrub';

// Low-level binary operations
const data = buffer.concat(header, body, footer);
const value = dataview.readUint32BE(data, offset);
const checksum = crc32(data);
```

## Browser Support

- Chrome 89+
- Firefox 89+
- Safari 15+
- Edge 89+

Requires `TextEncoder`, `TextDecoder`, and `Uint8Array` support.

## Security Considerations

- Input validation prevents buffer overflow attacks
- No `eval()` or `new Function()` used
- Safe for use with user-uploaded content

## Acknowledgments

This project is a modernized fork of [exif-library](https://github.com/hMatoba/exif-library) by [@hMatoba](https://github.com/hMatoba). The original library provided excellent JPEG/PNG/WebP EXIF handling that served as the foundation.

**What's new:**
- Modern TypedArray-based binary handling (no string manipulation)
- Added GIF, SVG, TIFF, HEIC, and DNG/RAW support
- Complete metadata removal (XMP, IPTC, ICC profiles, comments)
- Lossless HEIC anonymization
- TypeScript strict mode with full type definitions
- Comprehensive test suite


## License

MIT - see [LICENSE](LICENSE) for details.
