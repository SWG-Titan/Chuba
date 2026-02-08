/**
 * Test script to parse schematic files
 * Usage: node src/test-parser.js [schematic-path]
 */

import fs from 'fs';
import path from 'path';
import { parseTPFFile, parseTPFContent } from './parsers/tpf-parser.js';
import { parseTABFile } from './parsers/tab-parser.js';

const testSchematicPath = process.argv[2] || 'D:/titan/dsrc/sku.0/sys.server/compiled/game/object/draft_schematic/weapon/carbine_blaster_cdef.tpf';
const testDatatablePath = 'D:/titan/dsrc/sku.0/sys.server/compiled/game/datatables/crafting/weapon_schematics.tab';

console.log('=== Schematic Parser Test ===\n');

// Test TPF parsing
if (fs.existsSync(testSchematicPath)) {
  console.log(`Parsing TPF: ${testSchematicPath}`);
  const schematic = parseTPFFile(testSchematicPath);

  if (schematic) {
    console.log('\nSchematic ID:', schematic.schematic_id);
    console.log('Category:', schematic.category);
    console.log('Complexity:', schematic.complexity);
    console.log('Crafted Template:', schematic.crafted_object_template);
    console.log('Slots:');

    for (const slot of schematic.slots) {
      console.log(`  [${slot.slot_index}] ${slot.slot_name || slot.name_key}`);
      console.log(`      Resource: ${slot.resource_class}`);
      console.log(`      Quantity: ${slot.quantity}`);
      console.log(`      Type: ${slot.ingredient_type}`);
    }
  } else {
    console.log('Failed to parse schematic');
  }
} else {
  console.log(`Schematic file not found: ${testSchematicPath}`);
}

console.log('\n=== Datatable Parser Test ===\n');

// Test TAB parsing
if (fs.existsSync(testDatatablePath)) {
  console.log(`Parsing TAB: ${testDatatablePath}`);
  const data = parseTABFile(testDatatablePath);

  console.log(`Found ${data.rows.length} schematics`);

  // Show first few
  console.log('\nFirst 3 schematics:');
  for (let i = 0; i < Math.min(3, data.rows.length); i++) {
    const row = data.rows[i];
    console.log(`  ${row.name || 'Unknown'}`);
    console.log(`    Type: ${row.type}`);
    console.log(`    Complexity: ${row.complexity}`);
    console.log(`    Slots: ${row.slots?.length || 0}`);
    if (row.slots) {
      for (const slot of row.slots) {
        console.log(`      - ${slot.name_key}: ${slot.ingredient} x${slot.count}`);
      }
    }
  }
} else {
  console.log(`Datatable file not found: ${testDatatablePath}`);
}

console.log('\n=== Test Complete ===');

