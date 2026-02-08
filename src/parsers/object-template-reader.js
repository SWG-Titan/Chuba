/**
 * Shared Object Template Reader for Star Wars Galaxies
 * 
 * Object templates are IFF files that define game objects (items, creatures, etc.)
 * They have a hierarchical structure with base templates and parameters.
 * 
 * Common template tags:
 *   SHOT - SharedObjectTemplate
 *   SBMK - SharedBuildingObjectTemplate
 *   SBOT - SharedBattlefieldMarkerObjectTemplate
 *   SCNC - SharedConstructionContractObjectTemplate
 *   SCOT - SharedCreatureObjectTemplate
 *   SDSC - SharedDraftSchematicObjectTemplate
 *   SFOT - SharedFactoryObjectTemplate
 *   SGOT - SharedGroupObjectTemplate
 *   SIOT - SharedInstallationObjectTemplate
 *   SITO - SharedIntangibleObjectTemplate
 *   SJED - SharedJediManagerObjectTemplate
 *   SMLE - SharedMissionListEntryObjectTemplate
 *   SMOT - SharedMissionObjectTemplate
 *   SMSO - SharedPlayerObjectTemplate
 *   SPLY - SharedPlayerQuestObjectTemplate
 *   SRCR - SharedResourceContainerObjectTemplate
 *   SSHP - SharedShipObjectTemplate
 *   STAT - SharedStaticObjectTemplate
 *   STOT - SharedTangibleObjectTemplate
 *   SUNI - SharedUniverseObjectTemplate
 *   SVOT - SharedVehicleObjectTemplate
 *   SWOT - SharedWeaponObjectTemplate
 * 
 * Usage:
 *   const template = new ObjectTemplateReader();
 *   await template.load('object/tangible/armor/composite_helmet.iff');
 *   console.log(template.get('objectName'));
 *   console.log(template.get('appearanceFilename'));
 */

const { IFFReader } = require('./iff-reader.js');

// Parameter types
const ParamType = {
    NONE: 0,
    INT: 1,
    FLOAT: 2,
    BOOL: 3,
    STRING: 4,
    STRING_ID: 5,
    VECTOR: 6,
    DYNAMIC_VAR: 7,
    TEMPLATE: 8,
    OBJVAR: 9,
    ENUM: 10,
    STRUCT: 11,
    TRIGGER_VOLUME: 12
};

class ObjectTemplateReader {
    constructor() {
        this.templateTag = '';
        this.version = 0;
        this.baseTemplate = '';
        this.params = {};
        this.iff = null;
    }

    // ======================================================================
    // Loading
    // ======================================================================

    /**
     * Load template from file (Node.js)
     * @param {string} filePath
     * @returns {Promise<ObjectTemplateReader>}
     */
    async load(filePath) {
        this.iff = new IFFReader();
        await this.iff.load(filePath);
        return this._parse();
    }

    /**
     * Load template from File object (Browser)
     * @param {File} file
     * @returns {Promise<ObjectTemplateReader>}
     */
    async loadBrowser(file) {
        this.iff = new IFFReader();
        await this.iff.loadBrowser(file);
        return this._parse();
    }

    /**
     * Parse the IFF structure
     * @private
     */
    _parse() {
        this.params = {};
        
        // Get the top-level template tag
        this.templateTag = this.iff.getCurrentName();
        
        // Enter the template form
        this.iff.enterForm(this.templateTag);

        // Check for derived template (DERV tag)
        let versionTag = this.iff.getCurrentName();
        
        if (versionTag === 'DERV') {
            // This template derives from another
            this.iff.enterForm('DERV');
            this.iff.enterChunk();
            this.baseTemplate = this.iff.readString();
            this.iff.exitChunk();
            this.iff.exitForm('DERV');
            
            versionTag = this.iff.getCurrentName();
        }

        // Now we should be at the version form
        this.version = this._parseVersionTag(versionTag);
        
        this.iff.enterForm(versionTag);

        // Read parameter count
        this.iff.enterChunk();
        const paramCount = this.iff.readInt32();
        this.iff.exitChunk();

        // Read each parameter
        for (let i = 0; i < paramCount; i++) {
            this._readParameter();
        }

        this.iff.exitForm(versionTag);
        this.iff.exitForm(this.templateTag);

        return this;
    }

    /**
     * Parse version tag like '0010' to integer 10
     * @private
     */
    _parseVersionTag(tag) {
        // Convert tag like '0010' to integer
        let version = 0;
        for (let i = 0; i < 4; i++) {
            const c = tag.charCodeAt(i);
            if (c >= 48 && c <= 57) { // '0' - '9'
                version = version * 10 + (c - 48);
            }
        }
        return version;
    }

    /**
     * Read a single parameter
     * @private
     */
    _readParameter() {
        this.iff.enterChunk();
        
        const paramName = this.iff.readString();
        const value = this._readParamValue();
        
        this.params[paramName] = value;
        
        this.iff.exitChunk();
    }

    /**
     * Read a parameter value based on its type
     * @private
     */
    _readParamValue() {
        // Read the parameter type marker
        const typeMarker = this.iff.readUint8();
        
        switch (typeMarker) {
            case 0x00: // None/Simple
                return this._readSimpleValue();
            
            case 0x01: // Weighted list
                return this._readWeightedList();
            
            case 0x02: // Random range
                return this._readRandomRange();
            
            case 0x03: // Die roll
                return this._readDieRoll();
            
            default:
                // Try to read as simple value
                this.iff.skip(-1);
                return this._readSimpleValue();
        }
    }

    /**
     * Read a simple (non-complex) value
     * @private
     */
    _readSimpleValue() {
        const dataType = this.iff.readUint8();
        
        switch (dataType) {
            case ParamType.INT:
                return { type: 'int', value: this.iff.readInt32() };
            
            case ParamType.FLOAT:
                return { type: 'float', value: this.iff.readFloat() };
            
            case ParamType.BOOL:
                return { type: 'bool', value: this.iff.readUint8() !== 0 };
            
            case ParamType.STRING:
                return { type: 'string', value: this.iff.readString() };
            
            case ParamType.STRING_ID:
                return this._readStringId();
            
            case ParamType.VECTOR:
                return {
                    type: 'vector',
                    value: {
                        x: this.iff.readFloat(),
                        y: this.iff.readFloat(),
                        z: this.iff.readFloat()
                    }
                };
            
            case ParamType.ENUM:
                return { type: 'enum', value: this.iff.readInt32() };
            
            case ParamType.TEMPLATE:
                return { type: 'template', value: this.iff.readString() };
            
            case ParamType.TRIGGER_VOLUME:
                return this._readTriggerVolume();
            
            default:
                // Unknown type, try reading as string
                return { type: 'unknown', dataType: dataType, value: null };
        }
    }

    /**
     * Read a StringId (table + index or table + string)
     * @private
     */
    _readStringId() {
        const table = this.iff.readString();
        const index = this.iff.readInt32();
        
        // Some StringIds also have text
        let text = '';
        if (this.iff.getRemainingBytes() > 0) {
            // Check if there's a string following
            const peek = this.iff.readUint8();
            this.iff.skip(-1);
            if (peek > 0 && peek < 128) {
                text = this.iff.readString();
            }
        }
        
        return {
            type: 'stringId',
            value: {
                table: table,
                index: index,
                text: text
            }
        };
    }

    /**
     * Read a trigger volume definition
     * @private
     */
    _readTriggerVolume() {
        return {
            type: 'triggerVolume',
            value: {
                name: this.iff.readString(),
                radius: this.iff.readFloat()
            }
        };
    }

    /**
     * Read a weighted list of values
     * @private
     */
    _readWeightedList() {
        const count = this.iff.readInt32();
        const items = [];
        
        for (let i = 0; i < count; i++) {
            const weight = this.iff.readInt32();
            const value = this._readSimpleValue();
            items.push({ weight, value });
        }
        
        return { type: 'weightedList', items };
    }

    /**
     * Read a random range
     * @private
     */
    _readRandomRange() {
        const dataType = this.iff.readUint8();
        
        if (dataType === ParamType.INT) {
            return {
                type: 'randomRangeInt',
                min: this.iff.readInt32(),
                max: this.iff.readInt32()
            };
        } else if (dataType === ParamType.FLOAT) {
            return {
                type: 'randomRangeFloat',
                min: this.iff.readFloat(),
                max: this.iff.readFloat()
            };
        }
        
        return { type: 'randomRange', dataType };
    }

    /**
     * Read a die roll
     * @private
     */
    _readDieRoll() {
        return {
            type: 'dieRoll',
            numDice: this.iff.readInt32(),
            dieSides: this.iff.readInt32(),
            base: this.iff.readInt32()
        };
    }

    // ======================================================================
    // Data Access
    // ======================================================================

    /**
     * Get a parameter value
     * @param {string} name - Parameter name
     * @returns {*} The value, or undefined if not found
     */
    get(name) {
        const param = this.params[name];
        if (!param) return undefined;
        return param.value;
    }

    /**
     * Get a parameter with full type info
     * @param {string} name
     * @returns {Object} {type, value}
     */
    getParam(name) {
        return this.params[name];
    }

    /**
     * Get string value (extracts value from StringId if needed)
     * @param {string} name
     * @returns {string}
     */
    getString(name) {
        const param = this.params[name];
        if (!param) return '';
        
        if (param.type === 'string') {
            return param.value;
        } else if (param.type === 'stringId') {
            // Return table:index format for StringId
            return `@${param.value.table}:${param.value.index}`;
        }
        return String(param.value);
    }

    /**
     * Get integer value
     * @param {string} name
     * @returns {number}
     */
    getInt(name) {
        const param = this.params[name];
        if (!param) return 0;
        
        if (typeof param.value === 'number') {
            return Math.floor(param.value);
        }
        return 0;
    }

    /**
     * Get float value
     * @param {string} name
     * @returns {number}
     */
    getFloat(name) {
        const param = this.params[name];
        if (!param) return 0;
        
        if (typeof param.value === 'number') {
            return param.value;
        }
        return 0;
    }

    /**
     * Get boolean value
     * @param {string} name
     * @returns {boolean}
     */
    getBool(name) {
        const param = this.params[name];
        if (!param) return false;
        return Boolean(param.value);
    }

    /**
     * Check if parameter exists
     * @param {string} name
     * @returns {boolean}
     */
    has(name) {
        return name in this.params;
    }

    /**
     * Get all parameter names
     * @returns {string[]}
     */
    getParamNames() {
        return Object.keys(this.params);
    }

    /**
     * Get the template type tag
     * @returns {string}
     */
    getTemplateTag() {
        return this.templateTag;
    }

    /**
     * Get the base template path (if derived)
     * @returns {string}
     */
    getBaseTemplate() {
        return this.baseTemplate;
    }

    /**
     * Get template version
     * @returns {number}
     */
    getVersion() {
        return this.version;
    }

    // ======================================================================
    // Export
    // ======================================================================

    /**
     * Convert to plain object
     * @returns {Object}
     */
    toObject() {
        const result = {
            templateTag: this.templateTag,
            version: this.version,
            baseTemplate: this.baseTemplate || null,
            params: {}
        };
        
        for (const [name, param] of Object.entries(this.params)) {
            result.params[name] = param;
        }
        
        return result;
    }

    /**
     * Convert to JSON
     * @returns {string}
     */
    toJSON() {
        return JSON.stringify(this.toObject(), null, 2);
    }
}

// ======================================================================
// Convenience function
// ======================================================================

async function loadObjectTemplate(filePath) {
    const template = new ObjectTemplateReader();
    await template.load(filePath);
    return template;
}

// ======================================================================
// Export
// ======================================================================

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ObjectTemplateReader, loadObjectTemplate, ParamType };
}
