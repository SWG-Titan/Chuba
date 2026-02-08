import fs from 'fs';
import path from 'path';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('tab-parser');

/**
 * Parse a TAB (datatable) file
 * SWG datatables use tab-separated values with a specific header format
 * @param {string} filePath - Path to the .tab file
 * @returns {Object} Parsed datatable with columns and rows
 */
export function parseTABFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return parseTABContent(content);
  } catch (error) {
    logger.error({ error: error.message, filePath }, 'Failed to parse TAB file');
    return { columns: [], rows: [], byKey: new Map() };
  }
}

/**
 * Parse TAB content string
 * @param {string} content - TAB file content
 * @returns {Object} Parsed datatable
 */
export function parseTABContent(content) {
  const lines = content.split('\n').filter(line => line.trim());

  if (lines.length === 0) {
    return { columns: [], rows: [], byKey: new Map() };
  }

  // SWG tab files can have different formats:
  // 1. Standard: column headers on first line, types on second, data follows
  // 2. Inline: data rows with type prefixes (like weapon_schematics.tab)

  // Detect format based on first line
  const firstLine = lines[0];

  if (firstLine.startsWith('weapon\t') || firstLine.startsWith('slot\t') || firstLine.startsWith('armor\t')) {
    // Inline format (weapon_schematics.tab style)
    return parseInlineFormat(lines);
  } else {
    // Standard format
    return parseStandardFormat(lines);
  }
}

/**
 * Parse standard tab format with header rows
 */
function parseStandardFormat(lines) {
  const columns = lines[0].split('\t').map(col => col.trim());
  const types = lines.length > 1 ? lines[1].split('\t').map(t => t.trim()) : [];

  const rows = [];
  const byKey = new Map();

  for (let i = 2; i < lines.length; i++) {
    const values = lines[i].split('\t');
    const row = {};

    for (let j = 0; j < columns.length; j++) {
      const col = columns[j];
      const value = values[j]?.trim() || '';
      row[col] = parseValue(value, types[j]);
    }

    rows.push(row);

    // Index by first column value
    if (columns[0] && row[columns[0]]) {
      byKey.set(row[columns[0]], row);
    }
  }

  return { columns, rows, byKey };
}

/**
 * Parse inline format (weapon_schematics.tab style)
 * Format: row_type \t values...
 * weapon rows contain schematic data
 * slot rows contain ingredient data
 */
function parseInlineFormat(lines) {
  const schematics = [];
  const byKey = new Map();
  let currentSchematic = null;

  for (const line of lines) {
    const parts = line.split('\t');
    const rowType = parts[0]?.trim();

    if (rowType === 'weapon' || rowType === 'armor' || rowType === 'item') {
      // Main schematic row
      currentSchematic = parseSchematicRow(parts);
      if (currentSchematic) {
        schematics.push(currentSchematic);
        byKey.set(currentSchematic.name, currentSchematic);
      }
    } else if (rowType === 'slot' && currentSchematic) {
      // Slot/ingredient row
      const slot = parseSlotRow(parts);
      if (slot) {
        currentSchematic.slots.push(slot);
      }
    }
  }

  return {
    columns: ['name', 'script', 'complexity', 'type', 'slots', 'craftedTemplate', 'schematicTemplate'],
    rows: schematics,
    byKey
  };
}

/**
 * Parse a weapon/armor/item schematic row
 * Based on weapon_schematics.tab format
 */
function parseSchematicRow(parts) {
  if (parts.length < 10) return null;

  // Column mapping (approximate based on observed data):
  // 0: type (weapon/armor/item)
  // 1: name/id
  // 2: manufacture script
  // 3: xp amount
  // 4: xp type
  // 5: slot count
  // 6: skill required
  // 7: skill level
  // 8: crafted object template
  // 9: shared template
  // 10+: various stats

  const schematic = {
    type: parts[0]?.trim(),
    name: parts[1]?.trim(),
    manufacture_script: parts[2]?.trim(),
    xp_amount: parseInt(parts[3], 10) || 0,
    xp_type: parts[4]?.trim(),
    slot_count: parseInt(parts[5], 10) || 0,
    skill_required: parts[6]?.trim(),
    skill_level: parseInt(parts[7], 10) || 0,
    crafted_template: parts[8]?.trim(),
    shared_template: parts[9]?.trim(),
    complexity: parseInt(parts[10], 10) || 0,
    slots: [],
    raw_data: parts,
  };

  // Extract stat weights if present (varies by schematic type)
  // These are typically in the later columns
  schematic.stats = extractStatWeights(parts);

  // Extract schematic file path from end
  for (let i = parts.length - 1; i >= 0; i--) {
    const val = parts[i]?.trim();
    if (val && val.includes('object/draft_schematic/')) {
      schematic.schematic_template = val;
      break;
    }
  }

  return schematic;
}

/**
 * Parse a slot/ingredient row
 */
function parseSlotRow(parts) {
  if (parts.length < 5) return null;

  // Slot row format:
  // 0: "slot"
  // 1: empty or type indicator
  // 2: ingredient type (resource/template) and index
  // 3: slot name key
  // 4: resource class or template path
  // 5: count

  const slot = {
    slot_type: parts[2]?.trim(), // resource or template
    slot_index: parseInt(parts[2]?.match(/\d+/)?.[0], 10) || 0,
    name_key: parts[3]?.trim(),
    ingredient: parts[4]?.trim(),
    count: parseInt(parts[5], 10) || 1,
    is_resource: parts[2]?.includes('resource'),
    is_template: parts[2]?.includes('template'),
  };

  return slot;
}

/**
 * Extract stat weights from schematic row
 * Different schematics have different stat columns
 */
function extractStatWeights(parts) {
  const stats = {
    // Damage stats
    minDamage: null,
    maxDamage: null,
    // Armor stats
    kinetic: null,
    energy: null,
    // Speed stats
    attackSpeed: null,
    // Durability
    hitPoints: null,
    // Other
    elementalType: null,
    elementalValue: null,
  };

  // Look for numeric values that might be stat weights
  // This is heuristic - actual positions vary by schematic type
  for (let i = 10; i < parts.length && i < 40; i++) {
    const val = parts[i]?.trim();
    const num = parseInt(val, 10);

    // Skip non-numeric and template paths
    if (isNaN(num) || val.includes('/')) continue;

    // Map based on position (this is approximate)
    // Would need schema definition for exact mapping
  }

  return stats;
}

/**
 * Parse a value based on its type hint
 */
function parseValue(value, type) {
  if (!value) return null;

  switch (type?.toLowerCase()) {
    case 'i':
    case 'int':
    case 'integer':
      return parseInt(value, 10) || 0;
    case 'f':
    case 'float':
      return parseFloat(value) || 0;
    case 'b':
    case 'bool':
    case 'boolean':
      return value.toLowerCase() === 'true' || value === '1';
    default:
      return value;
  }
}

/**
 * Load and parse weapon schematics datatable
 * @param {string} filePath - Path to weapon_schematics.tab
 * @returns {Map<string, Object>} Map of schematic name to data
 */
export function loadWeaponSchematics(filePath) {
  const data = parseTABFile(filePath);
  return data.byKey;
}

/**
 * Get crafting data for a specific schematic
 * @param {Map} schematics - Loaded schematics map
 * @param {string} schematicPath - Schematic template path
 * @returns {Object|null} Schematic data with slots
 */
export function getSchematicCraftingData(schematics, schematicPath) {
  // Try to find by full path or name
  for (const [key, schematic] of schematics) {
    if (schematic.schematic_template === schematicPath ||
        schematic.crafted_template?.includes(schematicPath) ||
        key === schematicPath) {
      return schematic;
    }
  }
  return null;
}

