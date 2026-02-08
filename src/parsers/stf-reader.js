import fs from 'fs';

/**
 * STF (String Table File) Reader for Star Wars Galaxies
 *
 * Supports two formats:
 * 1. Binary STF files (.stf) - Original SWG format
 * 2. Tab-delimited text files (.tab) - Simple key\tvalue format
 *
 * Binary STF File Format (little-endian):
 *   1. Magic: 0xABCD (2 bytes, uint16 LE)
 *   2. Version: 1 byte (0 or 1)
 *   3. nextUniqueId: 4 bytes (uint32 LE)
 *   4. num_entries: 4 bytes (uint32 LE)
 *   5. String entries (num_entries times):
 *      - id: 4 bytes (uint32)
 *      - crc/sourceCrc: 4 bytes (uint32) - v0: time, v1: sourceCrc
 *      - buflen: 4 bytes (character count, not bytes)
 *      - string: buflen * 2 bytes (UTF-16LE)
 *   6. Name map entries (num_entries times):
 *      - id: 4 bytes (uint32)
 *      - buflen: 4 bytes (byte count)
 *      - name: buflen bytes (ASCII)
 *
 * Tab-delimited Format:
 *   Each line: key<TAB>value
 *
 * Usage:
 *   import { STFReader, loadSTF } from './stf-reader.js';
 *   const stf = await loadSTF('path/to/file.stf');  // or .tab
 *   const value = stf.get('string_name');    // Get value by name
 *   const value2 = stf.getById(123);         // Get value by ID
 *   const name = stf.getNameById(123);       // Get name/key by ID
 */

class STFReader {
    constructor() {
        this.strings = new Map();        // id -> string value
        this.nameMap = new Map();        // name -> id
        this.reverseNameMap = new Map(); // id -> name
        this.version = 0;
        this.nextUniqueId = 0;
    }

    /**
     * Load file from path (Node.js) - auto-detects format by extension
     * @param {string} filePath - Path to the .stf or .tab file
     * @returns {Promise<STFReader>} this
     */
    async load(filePath) {
        if (filePath.toLowerCase().endsWith('.tab')) {
            const content = await fs.promises.readFile(filePath, 'utf-8');
            this.parseTab(content);
        } else {
            const buffer = await fs.promises.readFile(filePath);
            this.parse(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
        }
        return this;
    }

    /**
     * Load file synchronously (Node.js) - auto-detects format by extension
     * @param {string} filePath - Path to the .stf or .tab file
     * @returns {STFReader} this
     */
    loadSync(filePath) {
        if (filePath.toLowerCase().endsWith('.tab')) {
            const content = fs.readFileSync(filePath, 'utf-8');
            this.parseTab(content);
        } else {
            const buffer = fs.readFileSync(filePath);
            this.parse(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
        }
        return this;
    }

    /**
     * Load STF file from File object (Browser)
     * @param {File} file - File object from input element
     * @returns {Promise<STFReader>} this
     */
    async loadBrowser(file) {
        if (file.name.toLowerCase().endsWith('.tab')) {
            const content = await file.text();
            this.parseTab(content);
        } else {
            const arrayBuffer = await file.arrayBuffer();
            this.parse(arrayBuffer);
        }
        return this;
    }

    /**
     * Parse tab-delimited string data
     * @param {string} content - Tab-delimited text content
     * @returns {STFReader} this
     */
    parseTab(content) {
        this.strings.clear();
        this.nameMap.clear();
        this.reverseNameMap.clear();
        this.version = 0;
        this.nextUniqueId = 0;

        const lines = content.split(/\r?\n/);
        let id = 0;

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue; // Skip empty lines and comments

            const tabIndex = trimmed.indexOf('\t');
            if (tabIndex === -1) continue; // Skip lines without tab

            const key = trimmed.substring(0, tabIndex);
            const value = trimmed.substring(tabIndex + 1);

            this.strings.set(id, value);
            this.nameMap.set(key, id);
            this.reverseNameMap.set(id, key);
            id++;
        }

        this.nextUniqueId = id;
        return this;
    }

    /**
     * Parse STF data from ArrayBuffer
     * @param {ArrayBuffer} buffer - Raw STF file data
     * @returns {STFReader} this
     */
    parse(buffer) {
        this.strings.clear();
        this.nameMap.clear();
        this.reverseNameMap.clear();

        const view = new DataView(buffer);
        let offset = 0;

        // 1. Read magic (2 bytes)
        const magic = view.getUint16(offset, true);
        offset += 2;

        if (magic !== 0xABCD) {
            throw new Error(`Invalid STF magic: 0x${magic.toString(16).toUpperCase()}, expected 0xABCD`);
        }

        // 2. Read version (1 byte)
        this.version = view.getUint8(offset);
        offset += 1;

        if (this.version !== 0 && this.version !== 1) {
            throw new Error(`Unsupported STF version: ${this.version}`);
        }

        // 3. Read nextUniqueId (4 bytes)
        this.nextUniqueId = view.getUint32(offset, true);
        offset += 4;

        // 4. Read entry count (4 bytes)
        const numEntries = view.getUint32(offset, true);
        offset += 4;

        // 5. Read string entries
        for (let i = 0; i < numEntries; i++) {
            // id (4 bytes)
            const id = view.getUint32(offset, true);
            offset += 4;

            // crc/time (4 bytes) - skip
            offset += 4;

            // buflen (4 bytes) - CHARACTER count, not bytes
            const charLen = view.getUint32(offset, true);
            offset += 4;

            // string (charLen * 2 bytes) - UTF-16LE
            let str = '';
            if (charLen > 0) {
                const byteLen = charLen * 2;
                const strBytes = new Uint8Array(buffer, offset, byteLen);
                str = new TextDecoder('utf-16le').decode(strBytes);
                offset += byteLen;
            }

            this.strings.set(id, str);
        }

        // 6. Read name map entries
        for (let i = 0; i < numEntries; i++) {
            // id (4 bytes)
            const id = view.getUint32(offset, true);
            offset += 4;

            // buflen (4 bytes) - BYTE count
            const nameLen = view.getUint32(offset, true);
            offset += 4;

            // name (nameLen bytes) - ASCII
            let name = '';
            if (nameLen > 0) {
                const nameBytes = new Uint8Array(buffer, offset, nameLen);
                name = new TextDecoder('ascii').decode(nameBytes);
                offset += nameLen;
            }

            this.nameMap.set(name, id);
            this.reverseNameMap.set(id, name);
        }

        return this;
    }

    /**
     * Get string value by name (key)
     * @param {string} name - The string name/key
     * @returns {string|undefined} The string value or undefined
     */
    get(name) {
        const id = this.nameMap.get(name);
        if (id === undefined) return undefined;
        return this.strings.get(id);
    }

    /**
     * Get string value by ID
     * @param {number} id - The string ID
     * @returns {string|undefined} The string value or undefined
     */
    getById(id) {
        return this.strings.get(id);
    }

    /**
     * Get ID by name
     * @param {string} name - The string name/key
     * @returns {number|undefined} The ID or undefined
     */
    getId(name) {
        return this.nameMap.get(name);
    }

    /**
     * Get name/key by ID
     * @param {number} id - The string ID
     * @returns {string|undefined} The name or undefined
     */
    getName(id) {
        return this.reverseNameMap.get(id);
    }

    /**
     * Get name/key by ID (alias for getName)
     * @param {number} id - The string ID
     * @returns {string|undefined} The name or undefined
     */
    getNameById(id) {
        return this.reverseNameMap.get(id);
    }

    /**
     * Check if a name exists
     * @param {string} name - The string name/key
     * @returns {boolean}
     */
    has(name) {
        return this.nameMap.has(name);
    }

    /**
     * Check if an ID exists
     * @param {number} id - The string ID
     * @returns {boolean}
     */
    hasId(id) {
        return this.strings.has(id);
    }

    /**
     * Get all names (keys)
     * @returns {string[]}
     */
    getNames() {
        return Array.from(this.nameMap.keys());
    }

    /**
     * Get all IDs
     * @returns {number[]}
     */
    getIds() {
        return Array.from(this.strings.keys());
    }

    /**
     * Get entry count
     * @returns {number}
     */
    get size() {
        return this.strings.size;
    }

    /**
     * Iterate over all entries as [name, value] pairs
     * @yields {[string, string]}
     */
    *entries() {
        for (const [name, id] of this.nameMap) {
            yield [name, this.strings.get(id)];
        }
    }

    /**
     * Iterate over all entries as [id, name, value] tuples
     * @yields {[number, string, string]}
     */
    *entriesWithId() {
        for (const [name, id] of this.nameMap) {
            yield [id, name, this.strings.get(id)];
        }
    }

    /**
     * Get all entries as object {name: value}
     * @returns {Object}
     */
    toObject() {
        const obj = {};
        for (const [name, value] of this.entries()) {
            obj[name] = value;
        }
        return obj;
    }

    /**
     * Get all entries as array [{id, name, value}, ...]
     * @returns {Array<{id: number, name: string, value: string}>}
     */
    toArray() {
        return Array.from(this.entriesWithId(), ([id, name, value]) => ({ id, name, value }));
    }

    /**
     * Export to JSON
     * @returns {string}
     */
    toJSON() {
        return JSON.stringify(this.toObject(), null, 2);
    }

    /**
     * Search for entries by partial name match
     * @param {string} pattern - Substring to search for
     * @param {boolean} [caseInsensitive=true] - Case insensitive search
     * @returns {Array<{name: string, value: string}>}
     */
    search(pattern, caseInsensitive = true) {
        const results = [];
        const searchPattern = caseInsensitive ? pattern.toLowerCase() : pattern;

        for (const [name, value] of this.entries()) {
            const compareName = caseInsensitive ? name.toLowerCase() : name;
            if (compareName.includes(searchPattern)) {
                results.push({ name, value });
            }
        }
        return results;
    }
}

// ======================================================================
// Convenience functions
// ======================================================================

/**
 * Load STF file asynchronously
 * @param {string} filePath - Path to the .stf file
 * @returns {Promise<STFReader>} STFReader instance
 */
export async function loadSTF(filePath) {
    const reader = new STFReader();
    await reader.load(filePath);
    return reader;
}

/**
 * Load STF file synchronously
 * @param {string} filePath - Path to the .stf file
 * @returns {STFReader} STFReader instance
 */
export function loadSTFSync(filePath) {
    const reader = new STFReader();
    reader.loadSync(filePath);
    return reader;
}

// ======================================================================
// Export
// ======================================================================

export { STFReader };

