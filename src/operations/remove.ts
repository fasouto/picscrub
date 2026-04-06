import { SupportedFormat, RemoveOptions, RemoveResult } from '../types.js';
import { InvalidFormatError, UnsupportedFormatError } from '../errors.js';
import { detectFormat } from '../detect.js';

import { jpeg } from '../formats/jpeg.js';
import { png } from '../formats/png.js';
import { webp } from '../formats/webp.js';
import { gif } from '../formats/gif.js';
import { svg } from '../formats/svg.js';
import { tiff } from '../formats/tiff.js';
import { heic } from '../formats/heic.js';
import { raw } from '../formats/raw.js';

/**
 * Format handler interface
 */
interface FormatHandler {
  remove: (data: Uint8Array, options: RemoveOptions) => Uint8Array;
  getMetadataTypes: (data: Uint8Array) => string[];
}

/**
 * Format handlers registry
 */
const handlers: Record<SupportedFormat, FormatHandler | null> = {
  jpeg,
  png,
  webp,
  gif,
  svg,
  tiff,
  heic,
  dng: {
    remove: (data, options) => raw.removeDng(data, options),
    getMetadataTypes: raw.getMetadataTypes,
  },
  raw: {
    remove: (data, options) => raw.remove(data, options).data,
    getMetadataTypes: raw.getMetadataTypes,
  },
  unknown: null,
};

/**
 * Normalize input to Uint8Array
 */
function normalizeInput(input: Uint8Array | ArrayBuffer | string): Uint8Array {
  if (typeof input === 'string') {
    if (input.startsWith('data:')) {
      const commaIndex = input.indexOf(',');
      if (commaIndex === -1) {
        throw new InvalidFormatError('Invalid data URL format');
      }
      const base64Data = input.slice(commaIndex + 1);
      const binaryString = atob(base64Data);
      const data = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        data[i] = binaryString.charCodeAt(i);
      }
      return data;
    }
    throw new InvalidFormatError('String input must be a data URL');
  }
  if (input instanceof ArrayBuffer) {
    return new Uint8Array(input);
  }
  if (input instanceof Uint8Array) {
    return input;
  }
  throw new InvalidFormatError('Input must be Uint8Array, ArrayBuffer, or data URL string');
}

/**
 * Core removal logic shared between sync and async APIs
 */
function processRemoval(data: Uint8Array, options: RemoveOptions): RemoveResult {
  const format = detectFormat(data);

  if (format === 'unknown') {
    throw new UnsupportedFormatError('unknown');
  }

  const handler = handlers[format];
  if (!handler) {
    throw new UnsupportedFormatError(format);
  }

  // Get metadata types before and after removal to compute what was actually removed
  const metadataBefore = handler.getMetadataTypes(data);

  // Remove metadata
  const cleanedData = handler.remove(data, options);

  const metadataAfter = handler.getMetadataTypes(cleanedData);
  const afterSet = new Set(metadataAfter);
  const removedMetadata = metadataBefore.filter(type => !afterSet.has(type));

  // Detect if output format differs from input (e.g., RAW -> JPEG preview)
  let outputFormat: SupportedFormat | undefined;
  if (format === 'raw') {
    const detectedOutput = detectFormat(cleanedData);
    if (detectedOutput !== 'raw' && detectedOutput !== 'unknown') {
      outputFormat = detectedOutput;
    }
  }

  const result: RemoveResult = {
    data: cleanedData,
    format,
    originalSize: data.length,
    cleanedSize: cleanedData.length,
    removedMetadata,
  };
  if (outputFormat) {
    result.outputFormat = outputFormat;
  }
  return result;
}

/**
 * Remove metadata from an image
 *
 * @param input - Image data as Uint8Array, ArrayBuffer, or base64 data URL
 * @param options - Options for metadata removal
 * @returns Result containing cleaned image and metadata
 *
 * @example
 * ```typescript
 * // From file input
 * const file = input.files[0];
 * const buffer = await file.arrayBuffer();
 * const result = await removeMetadata(new Uint8Array(buffer));
 *
 * // With options
 * const result = await removeMetadata(imageBytes, {
 *   preserveOrientation: true,
 *   preserveColorProfile: true,
 * });
 *
 * // Download cleaned image
 * const blob = new Blob([result.data], { type: 'image/jpeg' });
 * ```
 */
// eslint-disable-next-line @typescript-eslint/require-await
export async function removeMetadata(
  input: Uint8Array | ArrayBuffer | string,
  options: RemoveOptions = {}
): Promise<RemoveResult> {
  const data = normalizeInput(input);
  return processRemoval(data, options);
}

/**
 * Remove metadata from an image (sync version)
 */
export function removeMetadataSync(
  input: Uint8Array | ArrayBuffer,
  options: RemoveOptions = {}
): RemoveResult {
  const data = input instanceof ArrayBuffer ? new Uint8Array(input) : input;
  return processRemoval(data, options);
}

/**
 * Get metadata types present in an image without removing them
 */
export function getMetadataTypes(input: Uint8Array | ArrayBuffer): string[] {
  const data = input instanceof ArrayBuffer ? new Uint8Array(input) : input;
  const format = detectFormat(data);

  if (format === 'unknown') {
    return [];
  }

  const handler = handlers[format];
  if (!handler) {
    return [];
  }

  return handler.getMetadataTypes(data);
}

/**
 * Check if a format is supported
 */
export function isFormatSupported(format: SupportedFormat): boolean {
  return handlers[format] !== null;
}

/**
 * Get all supported formats
 */
export function getSupportedFormats(): SupportedFormat[] {
  return Object.entries(handlers)
    .filter(([_, handler]) => handler !== null)
    .map(([format]) => format as SupportedFormat);
}
