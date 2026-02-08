/**
 * DataTable Reader for Star Wars Galaxies
 * 
 * DataTables are IFF files with tag 'DTII' containing tabular data.
 * 
 * Structure:
 *   FORM DTII
 *     FORM 0000 or 0001
 *       CHUNK COLS - Column names (count + null-terminated strings)
 *       CHUNK TYPE - Column types (integers for v0000, strings for v0001)
 *       CHUNK ROWS - Row data (count + cell data)
 * 
 * Column Types (v0001 format strings):
 *   'i' = int
 *   'f' = float
 *   's' = string
 *   'h' = hash string (CRC)
 *   'e[enum1,enum2,...]' = enum
 *   'b' = bool
 *   'v[flags]' = bit vector
 *   'p' = packed objvars
 *   'c' = comment (ignored)
 * 
 * Usage:
 *   const dt = new DataTableReader();
 *   await dt.load('datatables/item/armor.iff');
 *   
 *   // Access data
 *   console.log(dt.getColumnNames());
 *   console.log(dt.getRow(0));
 *   console.log(dt.getValue(0, 'itemName'));
 *   
 *   // Search
 *   const row = dt.findRow('template', 'object/armor/composite_helmet.iff');
 */

const { IFFReader } = require('./iff-reader.js');

// Column data types
const DataType = {
    INT: 0,
    FLOAT: 1,
    STRING: 2,
    HASH_STRING: 3,
    ENUM: 4,
    BOOL: 5,
    BIT_VECTOR: 6,
    PACKED_OBJVARS: 7,
    COMMENT: 8,
    UNKNOWN: -1
};

class DataTableReader {
    constructor() {
        this.columns = [];      // Column names
        this.types = [];        // Column types {type, format, enumValues?}
        this.rows = [];         // Array of row arrays
        this.columnIndex = {};  // name -> index map
        this.version = 0;
    }

    // ======================================================================
    // Loading
    // ======================================================================

    /**
     * Load DataTable from file (Node.js)
     * @param {string} filePath
     * @returns {Promise<DataTableReader>}
     */
    async load(filePath) {
        const iff = new IFFReader();
        await iff.load(filePath);
        return this.parseIFF(iff);
    }

    /**
     * Load DataTable from File object (Browser)
     * @param {File} file
     * @returns {Promise<DataTableReader>}
     */
    async loadBrowser(file) {
        const iff = new IFFReader();
        await iff.loadBrowser(file);
        return this.parseIFF(iff);
    }

    /**
     * Parse from IFFReader
     * @param {IFFReader} iff
     * @returns {DataTableReader}
     */
    parseIFF(iff) {
        this.columns = [];
        this.types = [];
        this.rows = [];
        this.columnIndex = {};

        // Enter DTII form
        iff.enterForm('DTII');

        // Check version
        const versionTag = iff.getCurrentName();
        if (versionTag === '0000') {
            this.version = 0;
            this._loadVersion0000(iff);
        } else if (versionTag === '0001') {
            this.version = 1;
            this._loadVersion0001(iff);
        } else {
            throw new Error(`Unknown DataTable version: ${versionTag}`);
        }

        // Build column index
        this.columns.forEach((name, index) => {
            this.columnIndex[name] = index;
        });

        return this;
    }

    /**
     * Load version 0000 format
     * @private
     */
    _loadVersion0000(iff) {
        iff.enterForm('0000');

        // Read columns
        iff.enterChunk('COLS');
        const numCols = iff.readInt32();
        for (let i = 0; i < numCols; i++) {
            this.columns.push(iff.readString());
        }
        iff.exitChunk('COLS');

        // Read types (v0000 uses integers)
        iff.enterChunk('TYPE');
        for (let i = 0; i < numCols; i++) {
            const typeInt = iff.readInt32();
            this.types.push(this._parseTypeInt(typeInt));
        }
        iff.exitChunk('TYPE');

        // Read rows
        iff.enterChunk('ROWS');
        const numRows = iff.readInt32();
        for (let row = 0; row < numRows; row++) {
            const rowData = [];
            for (let col = 0; col < numCols; col++) {
                rowData.push(this._readCell(iff, col));
            }
            this.rows.push(rowData);
        }
        iff.exitChunk('ROWS');

        iff.exitForm('0000');
    }

    /**
     * Load version 0001 format
     * @private
     */
    _loadVersion0001(iff) {
        iff.enterForm('0001');

        // Read columns
        iff.enterChunk('COLS');
        const numCols = iff.readInt32();
        for (let i = 0; i < numCols; i++) {
            this.columns.push(iff.readString());
        }
        iff.exitChunk('COLS');

        // Read types (v0001 uses format strings)
        iff.enterChunk('TYPE');
        for (let i = 0; i < numCols; i++) {
            const typeStr = iff.readString();
            this.types.push(this._parseTypeString(typeStr));
        }
        iff.exitChunk('TYPE');

        // Read rows
        iff.enterChunk('ROWS');
        const numRows = iff.readInt32();
        for (let row = 0; row < numRows; row++) {
            const rowData = [];
            for (let col = 0; col < numCols; col++) {
                rowData.push(this._readCell(iff, col));
            }
            this.rows.push(rowData);
        }
        iff.exitChunk('ROWS');

        iff.exitForm('0001');
    }

    /**
     * Parse v0000 integer type
     * @private
     */
    _parseTypeInt(typeInt) {
        switch (typeInt) {
            case 0: return { type: DataType.INT, format: 'i' };
            case 1: return { type: DataType.FLOAT, format: 'f' };
            case 2: return { type: DataType.STRING, format: 's' };
            default: return { type: DataType.UNKNOWN, format: '?' };
        }
    }

    /**
     * Parse v0001 format string
     * @private
     */
    _parseTypeString(format) {
        if (!format || format.length === 0) {
            return { type: DataType.UNKNOWN, format: '' };
        }

        const firstChar = format[0].toLowerCase();

        switch (firstChar) {
            case 'i':
                return { type: DataType.INT, format: format };
            case 'f':
                return { type: DataType.FLOAT, format: format };
            case 's':
                return { type: DataType.STRING, format: format };
            case 'h':
                return { type: DataType.HASH_STRING, format: format };
            case 'e':
                // Parse enum values e[val1,val2,...]
                const enumMatch = format.match(/^e\[([^\]]*)\]/);
                const enumValues = enumMatch ? enumMatch[1].split(',') : [];
                return { type: DataType.ENUM, format: format, enumValues: enumValues };
            case 'b':
                return { type: DataType.BOOL, format: format };
            case 'v':
                return { type: DataType.BIT_VECTOR, format: format };
            case 'p':
                return { type: DataType.PACKED_OBJVARS, format: format };
            case 'c':
                return { type: DataType.COMMENT, format: format };
            default:
                return { type: DataType.UNKNOWN, format: format };
        }
    }

    /**
     * Read a cell value from IFF
     * @private
     */
    _readCell(iff, colIndex) {
        const typeInfo = this.types[colIndex];

        switch (typeInfo.type) {
            case DataType.INT:
            case DataType.HASH_STRING:
            case DataType.ENUM:
            case DataType.BOOL:
            case DataType.BIT_VECTOR:
                return iff.readInt32();

            case DataType.FLOAT:
                return iff.readFloat();

            case DataType.STRING:
            case DataType.PACKED_OBJVARS:
                return iff.readString();

            case DataType.COMMENT:
                // Comments are typically empty or skipped
                return iff.readString();

            default:
                // Try to read as string for unknown types
                return iff.readString();
        }
    }

    // ======================================================================
    // Data Access
    // ======================================================================

    /**
     * Get column names
     * @returns {string[]}
     */
    getColumnNames() {
        return [...this.columns];
    }

    /**
     * Get number of columns
     * @returns {number}
     */
    getNumColumns() {
        return this.columns.length;
    }

    /**
     * Get number of rows
     * @returns {number}
     */
    getNumRows() {
        return this.rows.length;
    }

    /**
     * Check if column exists
     * @param {string} columnName
     * @returns {boolean}
     */
    hasColumn(columnName) {
        return columnName in this.columnIndex;
    }

    /**
     * Get column index by name
     * @param {string} columnName
     * @returns {number} -1 if not found
     */
    getColumnIndex(columnName) {
        return this.columnIndex[columnName] ?? -1;
    }

    /**
     * Get column type info
     * @param {string|number} column - Column name or index
     * @returns {Object} {type, format, enumValues?}
     */
    getColumnType(column) {
        const index = typeof column === 'string' ? this.getColumnIndex(column) : column;
        return this.types[index];
    }

    /**
     * Get a row by index
     * @param {number} rowIndex
     * @returns {Object} Row as {columnName: value}
     */
    getRow(rowIndex) {
        if (rowIndex < 0 || rowIndex >= this.rows.length) {
            return null;
        }

        const row = this.rows[rowIndex];
        const result = {};
        this.columns.forEach((name, index) => {
            result[name] = row[index];
        });
        return result;
    }

    /**
     * Get a row as array
     * @param {number} rowIndex
     * @returns {Array}
     */
    getRowArray(rowIndex) {
        if (rowIndex < 0 || rowIndex >= this.rows.length) {
            return null;
        }
        return [...this.rows[rowIndex]];
    }

    /**
     * Get a cell value
     * @param {number} rowIndex
     * @param {string|number} column - Column name or index
     * @returns {*}
     */
    getValue(rowIndex, column) {
        if (rowIndex < 0 || rowIndex >= this.rows.length) {
            return undefined;
        }

        const colIndex = typeof column === 'string' ? this.getColumnIndex(column) : column;
        if (colIndex < 0 || colIndex >= this.columns.length) {
            return undefined;
        }

        return this.rows[rowIndex][colIndex];
    }

    /**
     * Get int value
     * @param {number} rowIndex
     * @param {string|number} column
     * @returns {number}
     */
    getInt(rowIndex, column) {
        const value = this.getValue(rowIndex, column);
        return typeof value === 'number' ? Math.floor(value) : parseInt(value) || 0;
    }

    /**
     * Get float value
     * @param {number} rowIndex
     * @param {string|number} column
     * @returns {number}
     */
    getFloat(rowIndex, column) {
        const value = this.getValue(rowIndex, column);
        return typeof value === 'number' ? value : parseFloat(value) || 0;
    }

    /**
     * Get string value
     * @param {number} rowIndex
     * @param {string|number} column
     * @returns {string}
     */
    getString(rowIndex, column) {
        const value = this.getValue(rowIndex, column);
        return value != null ? String(value) : '';
    }

    /**
     * Get bool value
     * @param {number} rowIndex
     * @param {string|number} column
     * @returns {boolean}
     */
    getBool(rowIndex, column) {
        const value = this.getValue(rowIndex, column);
        return Boolean(value);
    }

    // ======================================================================
    // Search
    // ======================================================================

    /**
     * Find first row where column equals value
     * @param {string|number} column
     * @param {*} value
     * @returns {number} Row index, or -1 if not found
     */
    findRow(column, value) {
        const colIndex = typeof column === 'string' ? this.getColumnIndex(column) : column;
        if (colIndex < 0) return -1;

        for (let i = 0; i < this.rows.length; i++) {
            if (this.rows[i][colIndex] === value) {
                return i;
            }
        }
        return -1;
    }

    /**
     * Find all rows where column equals value
     * @param {string|number} column
     * @param {*} value
     * @returns {number[]} Array of row indices
     */
    findAllRows(column, value) {
        const colIndex = typeof column === 'string' ? this.getColumnIndex(column) : column;
        if (colIndex < 0) return [];

        const results = [];
        for (let i = 0; i < this.rows.length; i++) {
            if (this.rows[i][colIndex] === value) {
                results.push(i);
            }
        }
        return results;
    }

    /**
     * Filter rows by predicate
     * @param {Function} predicate - (row, index) => boolean
     * @returns {Object[]} Array of matching rows as objects
     */
    filter(predicate) {
        const results = [];
        for (let i = 0; i < this.rows.length; i++) {
            const rowObj = this.getRow(i);
            if (predicate(rowObj, i)) {
                results.push(rowObj);
            }
        }
        return results;
    }

    // ======================================================================
    // Iteration
    // ======================================================================

    /**
     * Iterate over all rows
     * @yields {Object} Row as {columnName: value}
     */
    *[Symbol.iterator]() {
        for (let i = 0; i < this.rows.length; i++) {
            yield this.getRow(i);
        }
    }

    /**
     * Iterate with index
     * @yields {[number, Object]} [index, row]
     */
    *entries() {
        for (let i = 0; i < this.rows.length; i++) {
            yield [i, this.getRow(i)];
        }
    }

    // ======================================================================
    // Export
    // ======================================================================

    /**
     * Convert to array of objects
     * @returns {Object[]}
     */
    toArray() {
        return this.rows.map((_, i) => this.getRow(i));
    }

    /**
     * Convert to JSON string
     * @returns {string}
     */
    toJSON() {
        return JSON.stringify(this.toArray(), null, 2);
    }

    /**
     * Convert to CSV string
     * @param {string} [delimiter=',']
     * @returns {string}
     */
    toCSV(delimiter = ',') {
        const escape = (val) => {
            const str = String(val ?? '');
            if (str.includes(delimiter) || str.includes('"') || str.includes('\n')) {
                return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
        };

        const lines = [];
        lines.push(this.columns.map(escape).join(delimiter));
        
        for (const row of this.rows) {
            lines.push(row.map(escape).join(delimiter));
        }

        return lines.join('\n');
    }
}

// ======================================================================
// Convenience function
// ======================================================================

async function loadDataTable(filePath) {
    const dt = new DataTableReader();
    await dt.load(filePath);
    return dt;
}

// ======================================================================
// Export
// ======================================================================

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { DataTableReader, loadDataTable, DataType };
}
