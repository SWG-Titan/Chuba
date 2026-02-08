import fs from 'fs';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('stf-writer');

/**
 * STF (String Table File) Writer for Star Wars Galaxies
 *
 * Based on LocalizedStringTable.cpp and LocalizedString.cpp
 *
 * File Format (little-endian):
 *   - Magic: 0xABCD (2 bytes, uint16 LE)
 *   - Version: (1 byte) - 0 or 1
 *   - nextUniqueId: (4 bytes, uint32 LE)
 *   - Entry count: (4 bytes, uint32 LE)
 *   - String entries (numEntries times):
 *       - id: (4 bytes, uint32)
 *       - crc/sourceCrc: (4 bytes, uint32) - v0: time, v1: sourceCrc
 *       - charLen: (4 bytes, uint32) - character count, not bytes
 *       - string: (charLen * 2 bytes) - UTF-16LE
 *   - Name map entries (numEntries times):
 *       - id: (4 bytes, uint32)
 *       - nameLen: (4 bytes, uint32)
 *       - name: (nameLen bytes) - ASCII
 */
class STFWriter {
    constructor() {
        this.strings = new Map();      // id -> string value
        this.nameMap = new Map();      // name -> id
        this.version = 1;
        this.nextUniqueId = 0;
    }

    /**
     * Set the version/flags value
     * @param {number} version - Version number
     * @returns {STFWriter} this
     */
    setVersion(version) {
        this.version = version;
        return this;
    }

    /**
     * Add a string entry
     * @param {string} name - String key name (ASCII)
     * @param {string} value - String value (UTF-16LE compatible)
     * @param {number} [id] - Optional specific ID, auto-assigned if not provided
     * @returns {STFWriter} this
     */
    add(name, value, id = null) {
        if (id === null) {
            id = this.nextUniqueId++;
        } else {
            if (id >= this.nextUniqueId) {
                this.nextUniqueId = id + 1;
            }
        }

        this.strings.set(id, value);
        this.nameMap.set(name, id);
        return this;
    }

    /**
     * Add multiple string entries from an object
     * @param {Object} entries - Object with name -> value pairs
     * @returns {STFWriter} this
     */
    addAll(entries) {
        for (const [name, value] of Object.entries(entries)) {
            this.add(name, value);
        }
        return this;
    }

    /**
     * Remove a string entry by name
     * @param {string} name - String key name
     * @returns {boolean} true if removed
     */
    remove(name) {
        const id = this.nameMap.get(name);
        if (id === undefined) return false;

        this.strings.delete(id);
        this.nameMap.delete(name);
        return true;
    }

    /**
     * Check if a name exists
     * @param {string} name - String key name
     * @returns {boolean}
     */
    has(name) {
        return this.nameMap.has(name);
    }

    /**
     * Get a string value by name
     * @param {string} name - String key name
     * @returns {string|undefined}
     */
    get(name) {
        const id = this.nameMap.get(name);
        if (id === undefined) return undefined;
        return this.strings.get(id);
    }

    /**
     * Get the number of entries
     * @returns {number}
     */
    get size() {
        return this.strings.size;
    }

    /**
     * Clear all entries
     * @returns {STFWriter} this
     */
    clear() {
        this.strings.clear();
        this.nameMap.clear();
        this.nextUniqueId = 0;
        return this;
    }

    /**
     * Calculate the total buffer size needed
     * @returns {number} Size in bytes
     */
    calculateBufferSize() {
        // Header: magic(2) + version(1) + nextUniqueId(4) + count(4) = 11 bytes
        let size = 11;

        // String entries
        for (const [id, str] of this.strings) {
            // id(4) + crc(4) + charLen(4) + string(charLen * 2)
            size += 12 + (str.length * 2);
        }

        // Name map entries
        for (const [name, id] of this.nameMap) {
            // id(4) + nameLen(4) + name(nameLen)
            size += 8 + name.length;
        }

        return size;
    }

    /**
     * Build the STF binary data
     * @returns {ArrayBuffer} The STF file data
     */
    build() {
        const bufferSize = this.calculateBufferSize();
        const buffer = new ArrayBuffer(bufferSize);
        const view = new DataView(buffer);
        const uint8 = new Uint8Array(buffer);
        let offset = 0;

        // Build ordered arrays for consistent iteration
        const entries = [];
        for (const [name, id] of this.nameMap) {
            entries.push({ id, name, value: this.strings.get(id) });
        }
        // Sort by ID for deterministic output
        entries.sort((a, b) => a.id - b.id);

        const numEntries = entries.length;

        // 1. Write magic (2 bytes)
        view.setUint16(offset, 0xABCD, true);
        offset += 2;

        // 2. Write version (1 byte)
        view.setUint8(offset, this.version);
        offset += 1;

        // 3. Write nextUniqueId (4 bytes)
        view.setUint32(offset, this.nextUniqueId, true);
        offset += 4;

        // 4. Write entry count (4 bytes)
        view.setUint32(offset, numEntries, true);
        offset += 4;

        // 5. Write string entries
        for (const entry of entries) {
            // id (4 bytes)
            view.setUint32(offset, entry.id, true);
            offset += 4;

            // crc/time (4 bytes) - write 0
            view.setUint32(offset, 0, true);
            offset += 4;

            // charLen (4 bytes)
            const charLen = entry.value.length;
            view.setUint32(offset, charLen, true);
            offset += 4;

            // string (charLen * 2 bytes) - UTF-16LE
            if (charLen > 0) {
                const encoded = encodeUTF16LE(entry.value);
                uint8.set(encoded, offset);
                offset += encoded.length;
            }
        }

        // 6. Write name map entries
        for (const entry of entries) {
            // id (4 bytes)
            view.setUint32(offset, entry.id, true);
            offset += 4;

            // nameLen (4 bytes)
            const nameLen = entry.name.length;
            view.setUint32(offset, nameLen, true);
            offset += 4;

            // name (nameLen bytes) - ASCII
            if (nameLen > 0) {
                const encoded = new TextEncoder().encode(entry.name);
                uint8.set(encoded, offset);
                offset += nameLen;
            }
        }

        return buffer;
    }

    /**
     * Save STF file to path (Node.js)
     * @param {string} filePath - Path to save the .stf file
     * @returns {Promise<void>}
     */
    async save(filePath) {
        const buffer = this.build();
        await fs.promises.writeFile(filePath, Buffer.from(buffer));
        logger.debug({ filePath, count: this.size }, 'Saved STF file');
    }

    /**
     * Save STF file synchronously
     * @param {string} filePath - Path to save the .stf file
     */
    saveSync(filePath) {
        const buffer = this.build();
        fs.writeFileSync(filePath, Buffer.from(buffer));
        logger.debug({ filePath, count: this.size }, 'Saved STF file');
    }

    /**
     * Get all entries as an iterator
     * @yields {[string, string]} [name, value] pairs
     */
    *entries() {
        for (const [name, id] of this.nameMap) {
            yield [name, this.strings.get(id)];
        }
    }

    /**
     * Convert to plain object
     * @returns {Object} Object with name -> value pairs
     */
    toObject() {
        const obj = {};
        for (const [name, value] of this.entries()) {
            obj[name] = value;
        }
        return obj;
    }
}

/**
 * Encode a string as UTF-16LE bytes
 * @param {string} str - String to encode
 * @returns {Uint8Array} UTF-16LE encoded bytes
 */
function encodeUTF16LE(str) {
    const bytes = new Uint8Array(str.length * 2);
    for (let i = 0; i < str.length; i++) {
        const code = str.charCodeAt(i);
        bytes[i * 2] = code & 0xFF;
        bytes[i * 2 + 1] = (code >> 8) & 0xFF;
    }
    return bytes;
}

/**
 * Create a new STFWriter instance
 * @returns {STFWriter}
 */
export function createSTFWriter() {
    return new STFWriter();
}

/**
 * Create an STF file from an object of name -> value pairs
 * @param {Object} entries - Object with name -> value pairs
 * @param {string} filePath - Path to save the .stf file
 * @param {Object} [options] - Options
 * @param {number} [options.version=1] - Version number
 * @returns {Promise<void>}
 */
export async function writeSTFFile(entries, filePath, options = {}) {
    const writer = new STFWriter();

    if (options.version !== undefined) {
        writer.setVersion(options.version);
    }

    writer.addAll(entries);
    await writer.save(filePath);
}

/**
 * Create an STF file synchronously
 * @param {Object} entries - Object with name -> value pairs
 * @param {string} filePath - Path to save the .stf file
 * @param {Object} [options] - Options
 * @param {number} [options.version=1] - Version number
 */
export function writeSTFFileSync(entries, filePath, options = {}) {
    const writer = new STFWriter();

    if (options.version !== undefined) {
        writer.setVersion(options.version);
    }

    writer.addAll(entries);
    writer.saveSync(filePath);
}

/**
 * Build STF data in memory without writing to file
 * @param {Object} entries - Object with name -> value pairs
 * @param {Object} [options] - Options
 * @param {number} [options.version=1] - Version number
 * @returns {ArrayBuffer} The STF file data
 */
export function buildSTFBuffer(entries, options = {}) {
    const writer = new STFWriter();

    if (options.version !== undefined) {
        writer.setVersion(options.version);
    }

    writer.addAll(entries);
    return writer.build();
}

export { STFWriter };
