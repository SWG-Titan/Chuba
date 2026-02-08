/**
 * @deprecated This module is deprecated. Use stf-reader.js directly instead.
 * This file provides caching and helper functions on top of stf-reader.js.
 */
import fs from 'fs';
import path from 'path';
import { createLogger } from '../utils/logger.js';
import { STFReader, loadSTF, loadSTFSync } from './stf-reader.js';

const logger = createLogger('stf-parser');

/**
 * STF (String Table File) cache
 * Key: file path, Value: STFReader instance
 */
const stfCache = new Map();

/**
 * Parse an STF (String Table File) file using STFReader
 * @deprecated Use loadSTF from stf-reader.js instead
 * @param {string} filePath - Path to the .stf file
 * @returns {Promise<STFReader>} STFReader instance
 */
export async function parseSTFFile(filePath) {
  if (stfCache.has(filePath)) {
    return stfCache.get(filePath);
  }

  const reader = new STFReader();

  try {
    if (!fs.existsSync(filePath)) {
      logger.debug({ filePath }, 'STF file not found');
      return reader;
    }

    await reader.load(filePath);
    stfCache.set(filePath, reader);
    logger.debug({ filePath, count: reader.size }, 'Parsed STF file');
  } catch (error) {
    logger.error({ error: error.message, filePath }, 'Failed to parse STF file');
  }

  return reader;
}

/**
 * Parse an STF file synchronously
 * @deprecated Use loadSTFSync from stf-reader.js instead
 * @param {string} filePath - Path to the .stf file
 * @returns {STFReader} STFReader instance
 */
export function parseSTFFileSync(filePath) {
  if (stfCache.has(filePath)) {
    return stfCache.get(filePath);
  }

  const reader = new STFReader();

  try {
    if (!fs.existsSync(filePath)) {
      logger.debug({ filePath }, 'STF file not found');
      return reader;
    }

    reader.loadSync(filePath);
    stfCache.set(filePath, reader);
    logger.debug({ filePath, count: reader.size }, 'Parsed STF file');
  } catch (error) {
    logger.error({ error: error.message, filePath }, 'Failed to parse STF file');
  }

  return reader;
}

/**
 * Resolve a string reference like "@item_n:armor_segment"
 * @param {string} file - String file reference
 * @param {string} key - String key name
 * @param {string} basePath - Base path to string files
 * @returns {string} Resolved string or key as fallback
 */
export function resolveStringRef(file, key, basePath) {
  if (!file || key === undefined || key === null) return key || 'Unknown';

  const cleanFile = String(file).replace(/"/g, '').replace(/@/g, '').trim();
  const cleanKey = String(key).replace(/"/g, '').trim();

  const filePath = path.join(basePath, `${cleanFile}.tab`);
  const reader = parseSTFFileSync(filePath);

  const value = reader.get(cleanKey);
  if (value !== undefined) {
    return value;
  }

  return cleanKey;
}

/**
 * Resolve a string reference asynchronously
 */
export async function resolveStringRefAsync(file, key, basePath) {
  if (!file || key === undefined || key === null) return key || 'Unknown';

  const cleanFile = String(file).replace(/"/g, '').replace(/@/g, '').trim();
  const cleanKey = String(key).replace(/"/g, '').trim();

  const filePath = path.join(basePath, `${cleanFile}.tab`);
  const reader = await parseSTFFile(filePath);

  const value = reader.get(cleanKey);
  if (value !== undefined) {
    return value;
  }

  return cleanKey;
}

/**
 * Ensure STFReader is loaded (no-op, kept for API compatibility)
 * @deprecated No longer needed
 */
export async function ensureSTFReaderLoaded() {
  // No-op - STFReader is imported from stf-reader.js
}

/**
 * Clear the STF cache
 */
export function clearSTFCache() {
  stfCache.clear();
  logger.debug('STF cache cleared');
}

/**
 * Get cache statistics
 */
export function getSTFCacheStats() {
  let totalStrings = 0;
  for (const reader of stfCache.values()) {
    totalStrings += reader.size;
  }
  return {
    filesLoaded: stfCache.size,
    totalStrings,
  };
}

// Re-export STFReader from stf-reader.js
export { STFReader };

