/**
 * SWG File Format Parsers
 * 
 * Collection of JavaScript parsers for Star Wars Galaxies file formats.
 * 
 * Includes:
 *   - STFReader: String Table Files (.stf)
 *   - IFFReader: Interchange File Format (.iff)
 *   - DataTableReader: DataTable files (.iff with DTII tag)
 *   - ObjectTemplateReader: Object Template files (.iff)
 * 
 * Usage:
 *   const swg = require('./swg-parsers');
 *   
 *   // Read string table
 *   const stf = await swg.loadSTF('string/en/obj_armor.stf');
 *   console.log(stf.get('armor_composite_helmet'));
 *   
 *   // Read datatable
 *   const dt = await swg.loadDataTable('datatables/item/armor.iff');
 *   console.log(dt.getRow(0));
 *   
 *   // Read object template
 *   const tmpl = await swg.loadObjectTemplate('object/tangible/armor/composite.iff');
 *   console.log(tmpl.get('objectName'));
 */

const { STFReader, } = require('./stf-reader.js');
const { IFFReader } = require('./iff-reader.js');
const { DataTableReader, loadDataTable, DataType } = require('./datatable-reader.js');
const { ObjectTemplateReader, loadObjectTemplate, ParamType } = require('./object-template-reader.js');

module.exports = {
    // STF
    STFReader,
    
    // IFF
    IFFReader,
    
    // DataTable
    DataTableReader,
    loadDataTable,
    DataType,
    
    // Object Template
    ObjectTemplateReader,
    loadObjectTemplate,
    ParamType
};
