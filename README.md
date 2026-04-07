<div align="center">

# PicScrub

**Strip hidden metadata from images before sharing.**
GPS coordinates, device info, timestamps, thumbnails. Gone.
Fast, lossless, zero dependencies.

[![npm version](https://img.shields.io/npm/v/picscrub)](https://www.npmjs.com/package/picscrub)
[![bundle size](https://img.shields.io/bundlephobia/minzip/picscrub)](https://bundlephobia.com/package/picscrub)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

[Try it online at picscrub.com](https://picscrub.com) · no install needed, runs in your browser.

</div>

---

## Install

```bash
npm install picscrub
```

## Usage

```typescript
import { removeMetadata } from 'picscrub';

const result = await removeMetadata(imageBytes);

console.log(result.format);          // 'jpeg'
console.log(result.removedMetadata); // ['EXIF', 'XMP', 'ICC Profile']
console.log(result.cleanedSize);     // smaller than result.originalSize

// result.data is a clean Uint8Array ready to use
```

### With options

```typescript
const result = await removeMetadata(imageBytes, {
  preserveOrientation: true,   // keep EXIF rotation
  preserveColorProfile: true,  // keep ICC profile
  preserveCopyright: true,     // keep copyright notice
});
```

### Node.js file API

```typescript
import { processFile } from 'picscrub/node';

await processFile('photo.jpg');                          // creates photo-clean.jpg
await processFile('photo.jpg', { inPlace: true });       // overwrites original
await processFile('photo.jpg', { outputPath: 'out.jpg' });
```

### CLI

```bash
npx picscrub photo.jpg           # creates photo-clean.jpg
npx picscrub *.jpg               # batch process
npx picscrub -i photo.jpg        # overwrite original
npx picscrub -o clean.jpg photo.jpg
```

<details>
<summary>All CLI flags</summary>

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

</details>

## Supported Formats

| Format | What gets removed |
|--------|-------------------|
| **JPEG** | EXIF, XMP, IPTC, ICC Profile, Comments, Adobe |
| **PNG** | tEXt, iTXt, zTXt, eXIf, iCCP |
| **WebP** | EXIF, XMP, ICCP |
| **GIF** | Comments, XMP, Application Extensions |
| **SVG** | metadata, RDF, comments, editor namespaces |
| **TIFF** | EXIF, GPS, XMP, ICC Profile |
| **HEIC** | EXIF, GPS, Thumbnails, MakerNotes \* |
| **DNG** | Full TIFF-based metadata |
| **RAW** | Extracts clean JPEG preview \*\* |

All formats are lossless. Pixel data is never touched.
\*HEIC overwrites metadata with zeros rather than removing it (file size stays the same).
\*\*Proprietary RAW formats (CR2, NEF, ARW) return the cleaned embedded JPEG preview.

## API Reference

### `removeMetadata(input, options?)`

Accepts `Uint8Array`, `ArrayBuffer`, or base64 data URL. Returns:

```typescript
interface RemoveResult {
  data: Uint8Array;          // cleaned image
  format: SupportedFormat;   // detected format
  originalSize: number;      // before (bytes)
  cleanedSize: number;       // after (bytes)
  removedMetadata: string[]; // what was actually removed
}
```

### `detectFormat(data)` / `getMetadataTypes(data)`

```typescript
import { detectFormat, getMetadataTypes } from 'picscrub';

detectFormat(imageBytes);      // 'jpeg' | 'png' | 'webp' | ... | 'unknown'
getMetadataTypes(imageBytes);  // ['EXIF', 'XMP', 'ICC Profile']
```

### Format-specific handlers

```typescript
import { jpeg, png, webp, gif, svg, tiff, heic, raw } from 'picscrub';

const cleaned = jpeg.remove(jpegBytes, { preserveOrientation: true });
```

<details>
<summary>Preserve options by format</summary>

| Option | JPEG | PNG | WebP | TIFF | SVG |
|--------|------|-----|------|------|-----|
| `preserveOrientation` | Yes | - | - | Yes | - |
| `preserveColorProfile` | Yes | Yes | Yes | Yes | - |
| `preserveCopyright` | Yes | - | - | Yes | - |
| `preserveTitle` | - | - | - | - | Yes |
| `preserveDescription` | - | - | - | - | Yes |

</details>

## Known Limitations

<details>
<summary>TIFF</summary>

- Multi-page TIFFs: only the first IFD is processed
- Tiled images may not preserve all tile offsets correctly
- Test with your specific TIFF files before production use

</details>

<details>
<summary>HEIC</summary>

- Metadata is overwritten with zeros, not removed. File size stays the same
- Image data (HEVC stream) is completely preserved
- Embedded thumbnails are destroyed (overwritten with pattern data)
- This approach ensures file structure integrity without complex offset recalculation

</details>

<details>
<summary>RAW formats</summary>

| Format | Handling | Output |
|--------|----------|--------|
| **DNG** | Full TIFF-based processing | Clean DNG file |
| **CR2** (Canon) | JPEG preview extraction | Clean JPEG |
| **NEF** (Nikon) | JPEG preview extraction | Clean JPEG |
| **ARW** (Sony) | JPEG preview extraction | Clean JPEG |

Proprietary formats (CR2, NEF, ARW) return the cleaned embedded JPEG preview. Original RAW sensor data is not preserved. Use for sharing previews, not for archiving.

</details>

## How It Works

PicScrub operates directly on binary file structures. No re-encoding, no quality loss.

| Format | Technique |
|--------|-----------|
| JPEG | Removes APP1–APP14 segments |
| PNG | Filters metadata chunks (tEXt, iTXt, zTXt, eXIf) |
| WebP | Removes EXIF/XMP chunks, updates VP8X header |
| GIF | Removes comment and application extension blocks |
| SVG | Regex-based removal of metadata elements and editor attributes |
| TIFF | Filters IFD entries, zeros out removed data |
| HEIC | Overwrites EXIF/thumbnails with zeros |

## Browser Support

Chrome 89+ · Firefox 89+ · Safari 15+ · Edge 89+

## Acknowledgments

Modernized fork of [exif-library](https://github.com/hMatoba/exif-library) by [@hMatoba](https://github.com/hMatoba), with added support for GIF, SVG, TIFF, HEIC, DNG/RAW, TypeScript strict mode, and comprehensive metadata removal.

## License

[MIT](LICENSE)
