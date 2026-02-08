/**
 * IFF (Interchange File Format) Reader for Star Wars Galaxies
 * 
 * IFF files are hierarchical binary files organized into FORMs and CHUNKs.
 * 
 * Structure:
 *   - Each block has: TAG (4 bytes) + LENGTH (4 bytes, big-endian) + DATA
 *   - FORM blocks contain nested blocks (LENGTH includes child data + 4-byte form name)
 *   - CHUNK blocks contain raw data
 * 
 * Usage:
 *   const iff = new IFFReader();
 *   await iff.load('path/to/file.iff');
 *   iff.enterForm('DTII');       // Enter a form
 *   iff.enterChunk('COLS');      // Enter a chunk
 *   const value = iff.readInt32(); // Read data
 */

class IFFReader {
    constructor() {
        this.data = null;
        this.view = null;
        this.offset = 0;
        this.stack = [];      // Stack of {start, length, end, tag}
        this.inChunk = false;
    }

    // ======================================================================
    // File Loading
    // ======================================================================

    /**
     * Load IFF file from path (Node.js)
     * @param {string} filePath
     * @returns {Promise<IFFReader>}
     */
    async load(filePath) {
        const fs = require('fs').promises;
        const buffer = await fs.readFile(filePath);
        return this.parse(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
    }

    /**
     * Load IFF file from File object (Browser)
     * @param {File} file
     * @returns {Promise<IFFReader>}
     */
    async loadBrowser(file) {
        const arrayBuffer = await file.arrayBuffer();
        return this.parse(arrayBuffer);
    }

    /**
     * Parse IFF from ArrayBuffer
     * @param {ArrayBuffer} buffer
     * @returns {IFFReader}
     */
    parse(buffer) {
        this.data = new Uint8Array(buffer);
        this.view = new DataView(buffer);
        this.offset = 0;
        this.stack = [];
        this.inChunk = false;

        // Initialize with root block
        const rootTag = this.readTag(0);
        const rootLength = this.view.getUint32(4, false); // Big-endian
        
        this.stack.push({
            start: 0,
            length: rootLength + 8, // Include header
            end: rootLength + 8,
            tag: rootTag
        });

        return this;
    }

    // ======================================================================
    // Tag Helpers
    // ======================================================================

    /**
     * Convert 4-byte tag to string
     * @param {number} offset
     * @returns {string}
     */
    readTag(offset) {
        return String.fromCharCode(
            this.data[offset],
            this.data[offset + 1],
            this.data[offset + 2],
            this.data[offset + 3]
        );
    }

    /**
     * Convert string to 4-byte tag value
     * @param {string} str
     * @returns {number}
     */
    static tagFromString(str) {
        return (str.charCodeAt(0) << 24) |
               (str.charCodeAt(1) << 16) |
               (str.charCodeAt(2) << 8) |
               str.charCodeAt(3);
    }

    /**
     * Check if current block is a FORM
     * @returns {boolean}
     */
    isForm() {
        const tag = this.readTag(this.offset);
        return tag === 'FORM';
    }

    /**
     * Get current block name
     * @returns {string}
     */
    getCurrentName() {
        if (this.isForm()) {
            // For FORMs, the name is after FORM tag + length
            return this.readTag(this.offset + 8);
        } else {
            return this.readTag(this.offset);
        }
    }

    /**
     * Get current block length
     * @returns {number}
     */
    getCurrentLength() {
        return this.view.getUint32(this.offset + 4, false);
    }

    // ======================================================================
    // Navigation
    // ======================================================================

    /**
     * Enter a FORM block
     * @param {string} name - Expected form name (4 chars)
     * @param {boolean} [optional=false] - Return false instead of throwing if not found
     * @returns {boolean}
     */
    enterForm(name, optional = false) {
        if (this.inChunk) {
            throw new Error('Cannot enter form while in chunk');
        }

        const tag = this.readTag(this.offset);
        if (tag !== 'FORM') {
            if (optional) return false;
            throw new Error(`Expected FORM, got ${tag}`);
        }

        const length = this.view.getUint32(this.offset + 4, false);
        const formName = this.readTag(this.offset + 8);

        if (name && formName !== name) {
            if (optional) return false;
            throw new Error(`Expected form ${name}, got ${formName}`);
        }

        this.stack.push({
            start: this.offset,
            length: length + 8,
            end: this.offset + length + 8,
            tag: formName
        });

        this.offset += 12; // Skip FORM + length + form name
        return true;
    }

    /**
     * Exit current FORM block
     * @param {string} [name] - Verify form name
     */
    exitForm(name) {
        if (this.inChunk) {
            throw new Error('Cannot exit form while in chunk');
        }

        const current = this.stack.pop();
        if (name && current.tag !== name) {
            throw new Error(`Expected to exit form ${name}, but in ${current.tag}`);
        }

        this.offset = current.end;
    }

    /**
     * Enter a CHUNK block
     * @param {string} name - Expected chunk name (4 chars)
     * @param {boolean} [optional=false] - Return false instead of throwing if not found
     * @returns {boolean}
     */
    enterChunk(name, optional = false) {
        if (this.inChunk) {
            throw new Error('Already in a chunk');
        }

        const tag = this.readTag(this.offset);
        if (tag === 'FORM') {
            if (optional) return false;
            throw new Error(`Expected chunk ${name}, got FORM`);
        }

        if (name && tag !== name) {
            if (optional) return false;
            throw new Error(`Expected chunk ${name}, got ${tag}`);
        }

        const length = this.view.getUint32(this.offset + 4, false);

        this.stack.push({
            start: this.offset,
            length: length + 8,
            end: this.offset + length + 8,
            tag: tag,
            dataStart: this.offset + 8,
            dataEnd: this.offset + 8 + length
        });

        this.offset += 8; // Skip tag + length
        this.inChunk = true;
        return true;
    }

    /**
     * Exit current CHUNK block
     * @param {string} [name] - Verify chunk name
     */
    exitChunk(name) {
        if (!this.inChunk) {
            throw new Error('Not in a chunk');
        }

        const current = this.stack.pop();
        if (name && current.tag !== name) {
            throw new Error(`Expected to exit chunk ${name}, but in ${current.tag}`);
        }

        this.offset = current.end;
        this.inChunk = false;
    }

    /**
     * Check if at end of current block
     * @returns {boolean}
     */
    atEndOfBlock() {
        if (this.stack.length === 0) return true;
        const current = this.stack[this.stack.length - 1];
        return this.offset >= current.end;
    }

    /**
     * Get remaining bytes in current block
     * @returns {number}
     */
    getRemainingBytes() {
        if (this.stack.length === 0) return 0;
        const current = this.stack[this.stack.length - 1];
        if (this.inChunk) {
            return current.dataEnd - this.offset;
        }
        return current.end - this.offset;
    }

    /**
     * Seek within current form to find a specific block
     * @param {string} name - Block name to find
     * @returns {boolean}
     */
    seekForm(name) {
        const savedOffset = this.offset;
        
        while (!this.atEndOfBlock()) {
            const tag = this.readTag(this.offset);
            if (tag === 'FORM') {
                const formName = this.readTag(this.offset + 8);
                if (formName === name) {
                    return true;
                }
            }
            // Skip this block
            const length = this.view.getUint32(this.offset + 4, false);
            this.offset += 8 + length;
        }

        this.offset = savedOffset;
        return false;
    }

    /**
     * Seek within current form to find a specific chunk
     * @param {string} name - Chunk name to find
     * @returns {boolean}
     */
    seekChunk(name) {
        const savedOffset = this.offset;
        
        while (!this.atEndOfBlock()) {
            const tag = this.readTag(this.offset);
            if (tag !== 'FORM' && tag === name) {
                return true;
            }
            // Skip this block
            const length = this.view.getUint32(this.offset + 4, false);
            this.offset += 8 + length;
        }

        this.offset = savedOffset;
        return false;
    }

    // ======================================================================
    // Data Reading
    // ======================================================================

    readInt8() {
        const value = this.view.getInt8(this.offset);
        this.offset += 1;
        return value;
    }

    readUint8() {
        const value = this.view.getUint8(this.offset);
        this.offset += 1;
        return value;
    }

    readInt16(littleEndian = true) {
        const value = this.view.getInt16(this.offset, littleEndian);
        this.offset += 2;
        return value;
    }

    readUint16(littleEndian = true) {
        const value = this.view.getUint16(this.offset, littleEndian);
        this.offset += 2;
        return value;
    }

    readInt32(littleEndian = true) {
        const value = this.view.getInt32(this.offset, littleEndian);
        this.offset += 4;
        return value;
    }

    readUint32(littleEndian = true) {
        const value = this.view.getUint32(this.offset, littleEndian);
        this.offset += 4;
        return value;
    }

    readFloat(littleEndian = true) {
        const value = this.view.getFloat32(this.offset, littleEndian);
        this.offset += 4;
        return value;
    }

    readDouble(littleEndian = true) {
        const value = this.view.getFloat64(this.offset, littleEndian);
        this.offset += 8;
        return value;
    }

    /**
     * Read null-terminated string
     * @returns {string}
     */
    readString() {
        let end = this.offset;
        while (this.data[end] !== 0 && end < this.data.length) {
            end++;
        }
        const str = new TextDecoder('utf-8').decode(this.data.slice(this.offset, end));
        this.offset = end + 1; // Skip null terminator
        return str;
    }

    /**
     * Read fixed-length string
     * @param {number} length
     * @returns {string}
     */
    readFixedString(length) {
        const bytes = this.data.slice(this.offset, this.offset + length);
        this.offset += length;
        // Remove null padding
        let end = bytes.indexOf(0);
        if (end === -1) end = length;
        return new TextDecoder('utf-8').decode(bytes.slice(0, end));
    }

    /**
     * Read bytes
     * @param {number} length
     * @returns {Uint8Array}
     */
    readBytes(length) {
        const bytes = this.data.slice(this.offset, this.offset + length);
        this.offset += length;
        return bytes;
    }

    /**
     * Skip bytes
     * @param {number} length
     */
    skip(length) {
        this.offset += length;
    }

    // ======================================================================
    // Tree Walking
    // ======================================================================

    /**
     * Get the IFF structure as a tree object
     * @returns {Object}
     */
    toTree() {
        const savedOffset = this.offset;
        const savedStack = [...this.stack];
        const savedInChunk = this.inChunk;

        this.offset = 0;
        this.stack = [];
        this.inChunk = false;

        const tree = this._parseBlock();

        this.offset = savedOffset;
        this.stack = savedStack;
        this.inChunk = savedInChunk;

        return tree;
    }

    _parseBlock() {
        const tag = this.readTag(this.offset);
        const length = this.view.getUint32(this.offset + 4, false);

        if (tag === 'FORM') {
            const formName = this.readTag(this.offset + 8);
            const children = [];
            
            let childOffset = this.offset + 12;
            const endOffset = this.offset + 8 + length;

            while (childOffset < endOffset) {
                this.offset = childOffset;
                const child = this._parseBlock();
                children.push(child);
                childOffset = this.offset;
            }

            this.offset = endOffset;

            return {
                type: 'FORM',
                name: formName,
                length: length,
                children: children
            };
        } else {
            // Chunk
            const dataStart = this.offset + 8;
            this.offset = this.offset + 8 + length;

            return {
                type: 'CHUNK',
                name: tag,
                length: length,
                dataOffset: dataStart
            };
        }
    }
}

// ======================================================================
// Export
// ======================================================================

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { IFFReader };
}
