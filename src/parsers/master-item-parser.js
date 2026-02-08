import fs from 'fs';
import path from 'path';
import { createLogger } from '../utils/logger.js';
import { trackError } from '../services/error-tracker.js';

const logger = createLogger('master-item-parser');

/**
 * Known columns from master_item files:
 * name, template_name, type, unique, required_level, required_skill,
 * creation_objvars, charges, tier, value, scripts, version,
 * can_reverse_engineer, string_name, string_detail, comments
 */

/**
 * Parse master_item datatable files
 * @param {string} dirPath - Path to master_item directory
 * @returns {Object} Parsed items organized by category
 */
export function parseMasterItemDirectory(dirPath) {
  const result = {
    items: [],
    byTemplate: new Map(),
    byCategory: new Map(),
    categories: [],
    columns: new Set(),
    loaded: false,
    error: null,
  };

  try {
    if (!fs.existsSync(dirPath)) {
      logger.warn({ dirPath }, 'Master item directory not found');
      result.error = 'Directory not found';
      return result;
    }

    const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.tab'));
    logger.info({ dirPath, fileCount: files.length }, 'Found master item files');

    for (const file of files) {
      const filePath = path.join(dirPath, file);
      const category = path.basename(file, '.tab');

      try {
        const { items, columns } = parseMasterItemFile(filePath, category);

        // Collect all unique columns
        columns.forEach(col => result.columns.add(col));

        if (items.length > 0) {
          result.categories.push(category);
          result.byCategory.set(category, items);

          for (const item of items) {
            result.items.push(item);
            if (item.template_name) {
              result.byTemplate.set(item.template_name, item);
            }
          }
        }

        logger.debug({ file, itemCount: items.length }, 'Parsed master item file');
      } catch (error) {
        logger.error({ error: error.message, file }, 'Failed to parse master item file');
        trackError('item', {
          message: error.message,
          file: filePath,
          details: error.stack,
        });
      }
    }

    result.loaded = true;
    result.columns = Array.from(result.columns);

    logger.info({
      itemCount: result.items.length,
      categoryCount: result.categories.length,
      columnCount: result.columns.length,
    }, 'Loaded master items');

  } catch (error) {
    logger.error({ error: error.message, dirPath }, 'Failed to load master item directory');
    result.error = error.message;
    trackError('item', {
      message: error.message,
      file: dirPath,
      details: error.stack,
    });
  }

  return result;
}

/**
 * Parse a single master_item TAB file
 * Each row is one item, columns are tab-separated
 * @param {string} filePath - Path to the file
 * @param {string} category - Category name (filename without extension)
 * @returns {Object} { items: Array, columns: Array }
 */
export function parseMasterItemFile(filePath, category) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n').filter(line => line.trim());

  if (lines.length < 1) {
    return { items: [], columns: [] };
  }

  // First line is column headers
  const headers = lines[0].split('\t').map(h => h.trim().toLowerCase().replace(/\s+/g, '_'));

  // Second line might be type definitions (s, i, b, f, h, p, etc.)
  // Skip it if it looks like type definitions
  let dataStart = 1;
  if (lines[1]) {
    const secondLine = lines[1].split('\t');
    const looksLikeTypes = secondLine.every(val => {
      const trimmed = val.trim().toLowerCase();
      return trimmed === '' || /^[sibfhp\[\]]+$/i.test(trimmed);
    });
    if (looksLikeTypes && secondLine.length === headers.length) {
      dataStart = 2;
    }
  }

  const items = [];

  for (let i = dataStart; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    const values = line.split('\t');
    const item = {
      _category: category,
      _row_index: i,
    };

    // Map all columns to item properties
    for (let j = 0; j < headers.length; j++) {
      const header = headers[j];
      const value = values[j]?.trim() || '';

      // Store all values, even empty ones
      item[header] = value;
    }

    // Only add items that have a template_name or name
    if (item.template_name || item.name) {
      items.push(item);
    }
  }

  return { items, columns: headers };
}

/**
 * Type enum from master_item:
 * weapon=1, armor=2, item=3, storyteller=4, object=5
 */
const TYPE_ENUM = {
  '1': 'WEAPON',
  '2': 'ARMOR',
  '3': 'ITEM',
  '4': 'STORYTELLER',
  '5': 'OBJECT',
  'weapon': 'WEAPON',
  'armor': 'ARMOR',
  'item': 'ITEM',
  'storyteller': 'STORYTELLER',
  'object': 'OBJECT',
};

/**
 * Get item type from type enum value
 * @param {string} typeValue - Type enum value (1-5 or name)
 * @returns {string} Item type
 */
export function getItemTypeFromEnum(typeValue) {
  if (!typeValue) return 'ITEM';
  const normalized = String(typeValue).toLowerCase().trim();
  return TYPE_ENUM[normalized] || 'ITEM';
}

/**
 * Get item type from category name (legacy fallback)
 * @param {string} category - Category name
 * @returns {string} Item type
 * @deprecated Use getItemTypeFromEnum instead
 */
export function getItemType(category) {
  if (!category) return 'ITEM';

  const lowerCategory = category.toLowerCase();

  // Weapon types
  if (lowerCategory.includes('weapon') ||
      lowerCategory.includes('rifle') ||
      lowerCategory.includes('pistol') ||
      lowerCategory.includes('carbine') ||
      lowerCategory.includes('sword') ||
      lowerCategory.includes('knife') ||
      lowerCategory.includes('polearm') ||
      lowerCategory.includes('heavy') ||
      lowerCategory.includes('launcher') ||
      lowerCategory.includes('lightsaber') ||
      lowerCategory.includes('melee')) {
    return 'WEAPON';
  }

  // Armor types
  if (lowerCategory.includes('armor') ||
      lowerCategory.includes('helmet') ||
      lowerCategory.includes('chest') ||
      lowerCategory.includes('legs') ||
      lowerCategory.includes('boots') ||
      lowerCategory.includes('gloves') ||
      lowerCategory.includes('bracer')) {
    return 'ARMOR';
  }

  // Clothing
  if (lowerCategory.includes('clothing') ||
      lowerCategory.includes('wearable') ||
      lowerCategory.includes('shirt') ||
      lowerCategory.includes('pants') ||
      lowerCategory.includes('robe') ||
      lowerCategory.includes('jacket') ||
      lowerCategory.includes('dress')) {
    return 'CLOTHING';
  }

  // Droid
  if (lowerCategory.includes('droid')) {
    return 'DROID';
  }

  // Vehicle
  if (lowerCategory.includes('vehicle') ||
      lowerCategory.includes('speeder') ||
      lowerCategory.includes('swoop')) {
    return 'VEHICLE';
  }

  // Deed
  if (lowerCategory.includes('deed')) {
    return 'DEED';
  }

  // Consumable
  if (lowerCategory.includes('food') ||
      lowerCategory.includes('drink') ||
      lowerCategory.includes('medicine') ||
      lowerCategory.includes('spice') ||
      lowerCategory.includes('stim') ||
      lowerCategory.includes('consumable')) {
    return 'CONSUMABLE';
  }

  // Component
  if (lowerCategory.includes('component') ||
      lowerCategory.includes('crafting') ||
      lowerCategory.includes('resource')) {
    return 'COMPONENT';
  }

  // Furniture/Housing
  if (lowerCategory.includes('furniture') ||
      lowerCategory.includes('house') ||
      lowerCategory.includes('structure')) {
    return 'FURNITURE';
  }

  // Jewelry
  if (lowerCategory.includes('jewelry') ||
      lowerCategory.includes('ring') ||
      lowerCategory.includes('necklace') ||
      lowerCategory.includes('bracelet')) {
    return 'JEWELRY';
  }

  // Tool
  if (lowerCategory.includes('tool') ||
      lowerCategory.includes('survey')) {
    return 'TOOL';
  }

  // Instrument
  if (lowerCategory.includes('instrument') ||
      lowerCategory.includes('music')) {
    return 'INSTRUMENT';
  }

  // Container
  if (lowerCategory.includes('container') ||
      lowerCategory.includes('backpack') ||
      lowerCategory.includes('chest') ||
      lowerCategory.includes('crate')) {
    return 'CONTAINER';
  }

  // Schematic
  if (lowerCategory.includes('schematic')) {
    return 'SCHEMATIC';
  }

  // Loot
  if (lowerCategory.includes('loot') ||
      lowerCategory.includes('junk') ||
      lowerCategory.includes('treasure')) {
    return 'LOOT';
  }

  return 'MISC';
}

/**
 * Format item for database storage
 * Extracts known fields and stores rest as JSON
 * @param {Object} item - Raw parsed item
 * @returns {Object} Formatted item for DB
 */
export function formatItemForDb(item) {
  // Known columns mapping
  const formatted = {
    // Core fields
    name: item.name || null,
    template_name: item.template_name || null,
    type: item.type || null,
    category: item._category || null,
    item_type: null, // Set below based on type enum

    // Numeric fields
    unique_item: item.unique === '1' || item.unique === 'true' ? 1 : 0,
    required_level: parseInt(item.required_level, 10) || 0,
    charges: parseInt(item.charges, 10) || 0,
    tier: parseInt(item.tier, 10) || 0,
    value: parseInt(item.value, 10) || 0,
    version: parseInt(item.version, 10) || 0,
    can_reverse_engineer: item.can_reverse_engineer === '1' || item.can_reverse_engineer === 'true' ? 1 : 0,

    // Text fields
    required_skill: item.required_skill || null,
    creation_objvars: item.creation_objvars || null,
    scripts: item.scripts || null,
    string_name: item.string_name || null,
    string_detail: item.string_detail || null,
    comments: item.comments || null,
  };

  // Use type enum for item_type (weapon=1, armor=2, item=3, storyteller=4, object=5)
  formatted.item_type = getItemTypeFromEnum(item.type);

  // Store all other columns as raw_data JSON
  const knownColumns = [
    'name', 'template_name', 'type', 'unique', 'required_level',
    'required_skill', 'creation_objvars', 'charges', 'tier', 'value',
    'scripts', 'version', 'can_reverse_engineer', 'string_name',
    'string_detail', 'comments', '_category', '_row_index'
  ];

  const rawData = {};
  for (const [key, value] of Object.entries(item)) {
    if (!knownColumns.includes(key) && value && value !== '') {
      rawData[key] = value;
    }
  }

  formatted.raw_data = Object.keys(rawData).length > 0 ? JSON.stringify(rawData) : null;

  return formatted;
}

