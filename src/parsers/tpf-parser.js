import fs from 'fs';
import path from 'path';
import { createLogger } from '../utils/logger.js';
import { trackError } from '../services/error-tracker.js';

const logger = createLogger('tpf-parser');

/**
 * Parse a TPF (Template Property File) schematic file
 * @param {string} filePath - Path to the .tpf file
 * @returns {Object|null} Parsed schematic data
 */
export function parseTPFFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      const errorInfo = {
        message: 'File does not exist',
        file: filePath,
        details: 'The specified TPF file was not found',
      };
      trackError('schematic', errorInfo);
      logger.error(errorInfo, 'TPF file not found');
      return null;
    }

    const content = fs.readFileSync(filePath, 'utf8');

    if (!content || content.trim().length === 0) {
      const errorInfo = {
        message: 'File is empty',
        file: filePath,
        details: 'The TPF file has no content',
      };
      trackError('schematic', errorInfo);
      logger.error(errorInfo, 'Empty TPF file');
      return null;
    }

    const result = parseTPFContent(content, filePath);

    if (!result) {
      const errorInfo = {
        message: 'Parser returned null',
        file: filePath,
        details: 'TPF content could not be parsed',
      };
      trackError('schematic', errorInfo);
      logger.error(errorInfo, 'TPF parse failed');
    }

    return result;
  } catch (error) {
    const errorInfo = {
      message: error.message,
      file: filePath,
      details: error.stack,
    };
    trackError('schematic', errorInfo);
    logger.error({ error: error.message, filePath }, 'Failed to read TPF file');
    return null;
  }
}

/**
 * Parse TPF content string
 * @param {string} content - TPF file content
 * @param {string} filePath - Original file path for ID generation
 * @returns {Object} Parsed schematic data
 */
export function parseTPFContent(content, filePath) {
  const schematic = {
    schematic_id: generateSchematicId(filePath),
    file_path: filePath,
    base_template: null,
    category: null,
    crafted_object_template: null,
    complexity: 0,
    volume: 0,
    xp_type: null,
    shared_template: null,
    manufacture_scripts: [],
    skill_commands: [],
    items_per_container: 0,
    slots: [],
  };

  const lines = content.split('\n');
  let inSlots = false;
  let slotDepth = 0;
  let currentSlot = null;
  let slotBuffer = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Skip empty lines and comments
    if (!line || line.startsWith('//')) continue;

    // Parse @base directive
    if (line.startsWith('@base')) {
      schematic.base_template = line.replace('@base', '').trim();
      continue;
    }

    // Skip @class directives
    if (line.startsWith('@class')) continue;

    // Parse key = value pairs
    const equalsIndex = line.indexOf('=');
    if (equalsIndex > 0 && !inSlots) {
      const key = line.substring(0, equalsIndex).trim();
      const value = line.substring(equalsIndex + 1).trim();

      switch (key) {
        case 'category':
          schematic.category = parseCategoryValue(value);
          break;
        case 'craftedObjectTemplate':
          schematic.crafted_object_template = parseStringValue(value);
          break;
        case 'complexity':
          schematic.complexity = parseInt(value, 10) || 0;
          break;
        case 'volume':
          schematic.volume = parseInt(value, 10) || 0;
          break;
        case 'itemsPerContainer':
          schematic.items_per_container = parseInt(value, 10) || 0;
          break;
        case 'sharedTemplate':
          schematic.shared_template = parseStringValue(value);
          break;
        case 'manufactureScripts':
          schematic.manufacture_scripts = parseArrayValue(value);
          break;
        case 'skillCommands':
          schematic.skill_commands = parseArrayValue(value);
          break;
        case 'xpPoints':
          schematic.xp_type = parseXPType(value);
          break;
        case 'slots':
          inSlots = true;
          slotBuffer = value;
          slotDepth = countBrackets(value);
          continue;
      }
    }

    // Continue collecting slots data
    if (inSlots) {
      slotBuffer += '\n' + line;
      slotDepth += countBrackets(line);

      if (slotDepth <= 0) {
        schematic.slots = parseSlotsArray(slotBuffer);
        inSlots = false;
        slotBuffer = '';
      }
    }
  }

  return schematic;
}

/**
 * Count bracket depth change in a line
 */
function countBrackets(line) {
  let depth = 0;
  for (const char of line) {
    if (char === '[') depth++;
    if (char === ']') depth--;
  }
  return depth;
}

/**
 * Parse category enum value (e.g., CT_weapon -> weapon)
 */
function parseCategoryValue(value) {
  if (value.startsWith('CT_')) {
    return value.substring(3);
  }
  return value;
}

/**
 * Parse quoted string value
 */
function parseStringValue(value) {
  const match = value.match(/"([^"]+)"/);
  return match ? match[1] : value.replace(/"/g, '');
}

/**
 * Parse array value like ["item1", "item2"]
 */
function parseArrayValue(value) {
  const items = [];
  const matches = value.matchAll(/"([^"]+)"/g);
  for (const match of matches) {
    items.push(match[1]);
  }
  return items;
}

/**
 * Parse XP type from xpPoints array
 */
function parseXPType(value) {
  const match = value.match(/type\s*=\s*(\w+)/);
  return match ? match[1] : null;
}

/**
 * Parse the slots array from TPF format
 * @param {string} slotsStr - Raw slots string
 * @returns {Array} Parsed slots
 */
function parseSlotsArray(slotsStr) {
  const slots = [];

  // Find each slot block (starts with [ and has optional=)
  const slotRegex = /\[\s*optional\s*=\s*(true|false)\s*,\s*name\s*=\s*"([^"]+)"\s*"([^"]+)"\s*,\s*options\s*=\s*\[([\s\S]*?)\]\s*,\s*optionalSkillCommand\s*=\s*"([^"]*)"\s*,\s*complexity\s*=\s*(\d+)\s*,\s*appearance\s*=\s*"([^"]*)"\s*\]/g;

  let match;
  let slotIndex = 0;

  while ((match = slotRegex.exec(slotsStr)) !== null) {
    const slot = {
      slot_index: slotIndex++,
      optional: match[1] === 'true',
      name_file: match[2],
      name_key: match[3],
      slot_name: match[3], // Will be resolved from string file later
      options: parseSlotOptions(match[4]),
      optional_skill_command: match[5] || null,
      complexity: parseInt(match[6], 10) || 0,
      appearance: match[7] || null,
    };

    // Extract primary ingredient info from first option
    if (slot.options.length > 0) {
      const primaryOption = slot.options[0];
      if (primaryOption.ingredients.length > 0) {
        const primaryIngredient = primaryOption.ingredients[0];
        slot.resource_class = primaryIngredient.ingredient;
        slot.quantity = primaryIngredient.count;
        slot.ingredient_type = primaryOption.ingredient_type;
      }
    }

    slots.push(slot);
  }

  // Fallback: simpler parsing if regex didn't match
  if (slots.length === 0) {
    return parseSlotsFallback(slotsStr);
  }

  return slots;
}

/**
 * Parse slot options array
 */
function parseSlotOptions(optionsStr) {
  const options = [];

  // Match each option block
  const optionRegex = /\[\s*ingredientType\s*=\s*(\w+)\s*,\s*ingredients\s*=\s*\[([\s\S]*?)\]\s*,\s*complexity\s*=\s*(\d+)\s*,\s*skillCommand\s*=\s*"([^"]*)"\s*\]/g;

  let match;
  while ((match = optionRegex.exec(optionsStr)) !== null) {
    const option = {
      ingredient_type: match[1],
      ingredients: parseIngredients(match[2]),
      complexity: parseInt(match[3], 10) || 0,
      skill_command: match[4] || 'unskilled',
    };
    options.push(option);
  }

  return options;
}

/**
 * Parse ingredients array
 */
function parseIngredients(ingredientsStr) {
  const ingredients = [];

  // Match each ingredient: [name="file" "key", ingredient="resource_class", count=N]
  const ingredientRegex = /\[\s*name\s*=\s*"([^"]+)"\s*"([^"]+)"\s*,\s*ingredient\s*=\s*"([^"]+)"\s*,\s*count\s*=\s*(\d+)\s*\]/g;

  let match;
  while ((match = ingredientRegex.exec(ingredientsStr)) !== null) {
    ingredients.push({
      name_file: match[1],
      name_key: match[2],
      ingredient: match[3],
      count: parseInt(match[4], 10) || 1,
    });
  }

  return ingredients;
}

/**
 * Fallback slot parser for simpler format
 */
function parseSlotsFallback(slotsStr) {
  const slots = [];

  // Simple regex to find resource/template ingredients
  const simpleRegex = /ingredient\s*=\s*"([^"]+)"\s*,\s*count\s*=\s*(\d+)/g;
  const typeRegex = /ingredientType\s*=\s*(\w+)/g;
  const nameRegex = /name\s*=\s*"([^"]+)"\s*"([^"]+)"/g;

  let match;
  let slotIndex = 0;

  // Find all ingredients
  const ingredients = [];
  while ((match = simpleRegex.exec(slotsStr)) !== null) {
    ingredients.push({
      ingredient: match[1],
      count: parseInt(match[2], 10),
    });
  }

  // Find all types
  const types = [];
  while ((match = typeRegex.exec(slotsStr)) !== null) {
    types.push(match[1]);
  }

  // Find all names
  const names = [];
  while ((match = nameRegex.exec(slotsStr)) !== null) {
    names.push({ file: match[1], key: match[2] });
  }

  // Combine into slots (ingredients come in pairs with names)
  for (let i = 0; i < ingredients.length; i++) {
    const nameInfo = names[i] || { file: '', key: `slot_${i}` };
    slots.push({
      slot_index: slotIndex++,
      optional: false,
      name_file: nameInfo.file,
      name_key: nameInfo.key,
      slot_name: nameInfo.key,
      resource_class: ingredients[i].ingredient,
      quantity: ingredients[i].count,
      ingredient_type: types[i] || 'IT_resourceClass',
      options: [],
    });
  }

  return slots;
}

/**
 * Generate schematic ID from file path
 */
function generateSchematicId(filePath) {
  // Extract relative path and convert to ID
  const match = filePath.match(/draft_schematic[\/\\](.+)\.tpf$/i);
  if (match) {
    return match[1].replace(/[\/\\]/g, '_').toLowerCase();
  }
  return path.basename(filePath, '.tpf').toLowerCase();
}

/**
 * Check if ingredient type is a resource (not a component/template)
 */
export function isResourceIngredient(ingredientType) {
  return ingredientType === 'IT_resourceClass' ||
         ingredientType === 'IT_resourceType';
}

/**
 * Check if ingredient type is a component template
 */
export function isTemplateIngredient(ingredientType) {
  return ingredientType === 'IT_template' ||
         ingredientType === 'IT_templateGeneric' ||
         ingredientType === 'IT_schematic' ||
         ingredientType === 'IT_schematicGeneric';
}

/**
 * Parse a TPF file to extract objectName, detailedDescription, and appearance string refs
 * Used for resolving ingredient names when ingredient is a template
 * @param {string} filePath - Path to the .tpf file
 * @returns {Object|null} { objectNameFile, objectNameKey, detailedDescFile, detailedDescKey, appearanceFilename }
 */
export function parseTPFStringRefs(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }

    const content = fs.readFileSync(filePath, 'utf8');

    const result = {
      objectNameFile: null,
      objectNameKey: null,
      detailedDescFile: null,
      detailedDescKey: null,
      appearanceFilename: null,
    };

    // Match objectName = "file" "key"
    const objectNameMatch = content.match(/objectName\s*=\s*"([^"]+)"\s*"([^"]+)"/);
    if (objectNameMatch) {
      result.objectNameFile = objectNameMatch[1];
      result.objectNameKey = objectNameMatch[2];
    }

    // Match detailedDescription = "file" "key"
    const detailMatch = content.match(/detailedDescription\s*=\s*"([^"]+)"\s*"([^"]+)"/);
    if (detailMatch) {
      result.detailedDescFile = detailMatch[1];
      result.detailedDescKey = detailMatch[2];
    }

    // Match appearanceFilename = "path"
    const appearanceMatch = content.match(/appearanceFilename\s*=\s*"([^"]+)"/);
    if (appearanceMatch) {
      result.appearanceFilename = appearanceMatch[1];
    }

    return result;
  } catch (error) {
    logger.debug({ error: error.message, filePath }, 'Failed to parse TPF string refs');
    return null;
  }
}

/**
 * Get the sharedTemplate path from a TPF file's base chain
 * Follows @base directives to find the shared template
 * @param {string} filePath - Path to the .tpf file
 * @param {string} basePath - Server base path for resolving relative paths
 * @returns {string|null} Path to the shared template
 */
export function getSharedTemplatePath(filePath, basePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }

    const content = fs.readFileSync(filePath, 'utf8');

    // Look for sharedTemplate = "path"
    const sharedMatch = content.match(/sharedTemplate\s*=\s*"([^"]+)"/);
    if (sharedMatch) {
      const templatePath = sharedMatch[1];
      // Convert relative path (object/...) to full path
      if (templatePath.startsWith('object/')) {
        return path.join(basePath, templatePath + '.tpf');
      }
      return templatePath;
    }

    // Check @base directive and follow it
    const baseMatch = content.match(/@base\s+(.+)/);
    if (baseMatch) {
      const baseTpf = baseMatch[1].trim();
      // Resolve relative to current file's directory
      const baseFilePath = path.join(path.dirname(filePath), baseTpf);
      return getSharedTemplatePath(baseFilePath, basePath);
    }

    return null;
  } catch (error) {
    logger.debug({ error: error.message, filePath }, 'Failed to get shared template path');
    return null;
  }
}

