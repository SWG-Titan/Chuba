import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { config } from '../config/index.js';
import { getLocalDb } from '../database/local-db.js';
import { createLogger } from '../utils/logger.js';
import { parseTPFFile, isResourceIngredient, isTemplateIngredient, parseTPFStringRefs } from '../parsers/tpf-parser.js';
import { parseTABFile } from '../parsers/tab-parser.js';
import { resolveStringRef } from '../parsers/stf-parser.js';
import { trackError } from './error-tracker.js';

const logger = createLogger('schematic-service');

/**
 * Schematic file extension
 */
const SCHEMATIC_EXTENSION = '.tpf';

/**
 * Crafting datatable cache
 */
let craftingDataCache = null;

/**
 * Load crafting datatables (weapon_schematics.tab, etc.)
 * @param {string} datatablePath - Path to crafting datatables directory
 */
export function loadCraftingDatatables(datatablePath) {
  try {
    const weaponSchematicsPath = path.join(datatablePath, 'weapon_schematics.tab');

    if (fs.existsSync(weaponSchematicsPath)) {
      const data = parseTABFile(weaponSchematicsPath);
      craftingDataCache = {
        weapons: data,
        loaded: true,
        path: datatablePath,
      };
      logger.info({
        path: datatablePath,
        weaponCount: data.rows.length
      }, 'Loaded crafting datatables');
    } else {
      logger.warn({ path: weaponSchematicsPath }, 'Weapon schematics datatable not found');
      craftingDataCache = { loaded: false };
    }
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to load crafting datatables');
    craftingDataCache = { loaded: false };
  }
}

/**
 * Get crafting data for a schematic from datatables
 * @param {string} schematicName - Schematic name/identifier
 * @returns {Object|null} Crafting data with stat weights
 */
export function getCraftingDataForSchematic(schematicName) {
  if (!craftingDataCache?.loaded) return null;

  // Try to match by name
  return craftingDataCache.weapons?.byKey.get(schematicName) || null;
}

/**
 * Recursively find all schematic files
 * @param {string} dirPath - Directory path
 * @returns {string[]} Array of file paths
 */
export function findSchematicFiles(dirPath) {
  const files = [];

  try {
    if (!fs.existsSync(dirPath)) {
      logger.warn({ dirPath }, 'Schematic directory does not exist');
      return files;
    }

    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        files.push(...findSchematicFiles(fullPath));
      } else if (entry.isFile() && entry.name.endsWith(SCHEMATIC_EXTENSION)) {
        files.push(fullPath);
      }
    }
  } catch (error) {
    logger.error({ error: error.message, dirPath }, 'Error scanning schematic directory');
  }

  return files;
}

/**
 * Parse a single schematic file and resolve strings
 * @param {string} filePath - Path to schematic file
 * @param {string} stringsPath - Path to string files
 * @param {string} serverBasePath - Server base path for resolving relative paths
 * @param {string} sharedBasePath - Shared base path for resolving shared templates
 * @returns {Object|null} Parsed schematic data
 */
export function parseSchematicFile(filePath, stringsPath = null, serverBasePath = null, sharedBasePath = null) {
  try {
    const schematic = parseTPFFile(filePath);
    if (!schematic) return null;

    // Generate file hash for change detection
    const content = fs.readFileSync(filePath);
    schematic.file_hash = crypto.createHash('md5').update(content).digest('hex');

    logger.debug({
      schematic_id: schematic.schematic_id,
      crafted_object_template: schematic.crafted_object_template,
      filePath
    }, 'Parsing schematic file');

    // Resolve schematic name from craftedObjectTemplate (the tangible object being crafted)
    // The craftedObjectTemplate points to the .iff file, we need to read its shared .tpf for objectName
    if (stringsPath && schematic.crafted_object_template) {
      logger.debug({
        crafted_object_template: schematic.crafted_object_template,
        stringsPath,
        serverBasePath,
        sharedBasePath
      }, 'Attempting to resolve schematic name from crafted object template');

      const resolvedStrings = resolveCraftedObjectStrings(schematic.crafted_object_template, stringsPath, sharedBasePath);
      if (resolvedStrings) {
        logger.debug({
          schematic_id: schematic.schematic_id,
          resolvedName: resolvedStrings.name,
          crafted_object_template: schematic.crafted_object_template
        }, 'Successfully resolved schematic name from crafted object');
        schematic.schematic_name = resolvedStrings.name;
        schematic.schematic_description = resolvedStrings.description;
      } else {
        logger.warn({
          schematic_id: schematic.schematic_id,
          crafted_object_template: schematic.crafted_object_template
        }, 'Failed to resolve schematic name from crafted object, using schematic_id as fallback');
      }
    }

    // Resolve slot names and ingredient names from string files
    if (stringsPath && schematic.slots) {
      for (const slot of schematic.slots) {
        // Resolve slot name
        if (slot.name_file && slot.name_key) {
          slot.slot_name = resolveStringRef(slot.name_file, slot.name_key, stringsPath);
        }

        // Resolve ingredient names for each option
        if (slot.options && slot.options.length > 0) {
          for (const option of slot.options) {
            if (option.ingredients && option.ingredients.length > 0) {
              for (const ingredient of option.ingredients) {
                // Resolve ingredient name from string file
                if (ingredient.name_file && ingredient.name_key) {
                  ingredient.resolved_name = resolveStringRef(ingredient.name_file, ingredient.name_key, stringsPath);
                }

                // If ingredient is a template (.iff), read its TPF for objectName
                if (isTemplateIngredient(option.ingredient_type) && ingredient.ingredient && serverBasePath) {
                  const ingredientStrings = resolveTemplateIngredientStrings(
                    ingredient.ingredient,
                    stringsPath,
                    serverBasePath
                  );
                  if (ingredientStrings) {
                    ingredient.resolved_name = ingredientStrings.name || ingredient.resolved_name;
                    ingredient.resolved_description = ingredientStrings.description;
                  }
                }
              }
            }
          }
        }

        // Also resolve for the primary ingredient if directly on slot
        if (slot.resource_class && isTemplateIngredient(slot.ingredient_type) && serverBasePath) {
          const ingredientStrings = resolveTemplateIngredientStrings(
            slot.resource_class,
            stringsPath,
            serverBasePath
          );
          if (ingredientStrings) {
            slot.ingredient_name = ingredientStrings.name;
            slot.ingredient_description = ingredientStrings.description;
          }
        }
      }
    }

    // Try to get additional crafting data from datatables
    const craftingData = getCraftingDataForSchematic(schematic.schematic_id);
    if (craftingData) {
      schematic.crafting_data = craftingData;

      // Merge slot data with datatable info
      if (craftingData.slots) {
        mergeSlotData(schematic.slots, craftingData.slots);
      }
    }

    return schematic;
  } catch (error) {
    logger.error({ error: error.message, filePath }, 'Failed to parse schematic file');
    return null;
  }
}

/**
 * Resolve the display name and description from a craftedObjectTemplate path
 * craftedObjectTemplate is like "object/tangible/dice/eqp_chance_cube.iff"
 * We need to find the shared .tpf: sys.shared/.../object/tangible/dice/shared_eqp_chance_cube.tpf
 * Then read objectName and detailedDescription string refs from it
 *
 * @param {string} craftedObjectTemplate - Path like "object/tangible/dice/eqp_chance_cube.iff"
 * @param {string} stringsPath - Path to string files
 * @param {string} sharedBasePath - Shared base path (sys.shared/compiled/game)
 * @returns {Object|null} { name, description } or null
 */
function resolveCraftedObjectStrings(craftedObjectTemplate, stringsPath, sharedBasePath) {
  if (!craftedObjectTemplate || !sharedBasePath) return null;

  try {
    // Remove .iff extension and convert to .tpf path
    // "object/tangible/dice/eqp_chance_cube.iff" -> "object/tangible/dice/eqp_chance_cube"
    let templatePath = craftedObjectTemplate;
    if (templatePath.endsWith('.iff')) {
      templatePath = templatePath.slice(0, -4);
    }

    // Get directory and filename parts
    const lastSlash = templatePath.lastIndexOf('/');
    const dir = lastSlash >= 0 ? templatePath.substring(0, lastSlash) : '';
    const basename = lastSlash >= 0 ? templatePath.substring(lastSlash + 1) : templatePath;

    // Shared templates have "shared_" prepended to the filename
    const sharedFilename = `shared_${basename}.tpf`;
    const sharedRelativePath = dir ? `${dir}/${sharedFilename}` : sharedFilename;

    logger.debug({
      craftedObjectTemplate,
      dir,
      basename,
      sharedFilename,
      sharedRelativePath
    }, 'Resolving crafted object strings');

    // Try to find the shared TPF
    const sharedPath = path.join(sharedBasePath, sharedRelativePath);

    if (!fs.existsSync(sharedPath)) {
      logger.debug({ sharedPath }, 'Shared TPF not found for crafted object');
      return null;
    }

    logger.debug({ sharedPath }, 'Found shared TPF for crafted object');

    // Read the shared template TPF for objectName and detailedDescription
    const stringRefs = parseTPFStringRefs(sharedPath);

    if (!stringRefs) {
      logger.debug({ craftedObjectTemplate, sharedPath }, 'No string refs found in shared TPF');
      return null;
    }

    const result = { name: null, description: null };

    // Resolve object name
    if (stringRefs.objectNameFile && stringRefs.objectNameKey) {
      result.name = resolveStringRef(stringRefs.objectNameFile, stringRefs.objectNameKey, stringsPath);
    }

    // Resolve detailed description
    if (stringRefs.detailedDescFile && stringRefs.detailedDescKey) {
      result.description = resolveStringRef(stringRefs.detailedDescFile, stringRefs.detailedDescKey, stringsPath);
    }

    logger.info({
      craftedObjectTemplate,
      sharedPath,
      stringRefs,
      resolvedName: result.name,
      resolvedDesc: result.description ? result.description.substring(0, 50) + '...' : null
    }, 'Resolved crafted object strings');

    return result.name ? result : null;
  } catch (error) {
    logger.debug({ error: error.message, craftedObjectTemplate }, 'Failed to resolve crafted object strings');
    return null;
  }
}

/**
 * Resolve schematic name from sharedTemplate path
 * The sharedTemplate points to a shared object TPF that has objectName string refs
 * @param {string} sharedTemplate - Shared template path (e.g., "object/draft_schematic/...")
 * @param {string} stringsPath - Path to string files
 * @param {string} serverBasePath - Server base path
 * @param {string} sharedBasePath - Shared base path (sys.shared)
 * @returns {string|null} Resolved schematic name
 */
function resolveSchematicName(sharedTemplate, stringsPath, serverBasePath, sharedBasePath = null) {
  if (!sharedTemplate) return null;

  try {
    // Convert sharedTemplate path to full path
    // sharedTemplate is like "object/draft_schematic/armor/armor_segment_composite"
    // The shared file will be "object/draft_schematic/armor/shared_armor_segment_composite.tpf"
    let tpfPath = null;

    logger.debug({ sharedTemplate }, 'Resolving schematic name from shared template');

    // If it starts with "object/", it's a relative path
    if (sharedTemplate.startsWith('object/')) {
      // Get directory and filename parts using forward slash (template paths use forward slashes)
      const lastSlash = sharedTemplate.lastIndexOf('/');
      const dir = lastSlash >= 0 ? sharedTemplate.substring(0, lastSlash) : '';
      const basename = lastSlash >= 0 ? sharedTemplate.substring(lastSlash + 1) : sharedTemplate;

      // Shared templates have "shared_" prepended to the filename
      const sharedFilename = `shared_${basename}.tpf`;
      const sharedRelativePath = dir ? `${dir}/${sharedFilename}` : sharedFilename;

      logger.debug({ dir, basename, sharedFilename, sharedRelativePath }, 'Parsed template path components');

      // Try shared path first (sys.shared) - this is where shared templates usually are
      if (sharedBasePath) {
        const sharedPath = path.join(sharedBasePath, sharedRelativePath);
        logger.debug({ sharedPath, exists: fs.existsSync(sharedPath) }, 'Trying shared base path');
        if (fs.existsSync(sharedPath)) {
          tpfPath = sharedPath;
        }
      }

      // If not found in shared, try server path with shared_ prefix
      if (!tpfPath && serverBasePath) {
        const serverPath = path.join(serverBasePath, sharedRelativePath);
        logger.debug({ serverPath, exists: fs.existsSync(serverPath) }, 'Trying server base path');
        if (fs.existsSync(serverPath)) {
          tpfPath = serverPath;
        }
      }

      // If still not found, try deriving shared path from server path
      if (!tpfPath && serverBasePath) {
        const derivedSharedPath = serverBasePath.replace('sys.server', 'sys.shared');
        const derivedPath = path.join(derivedSharedPath, sharedRelativePath);
        logger.debug({ derivedPath, exists: fs.existsSync(derivedPath) }, 'Trying derived shared path');
        if (fs.existsSync(derivedPath)) {
          tpfPath = derivedPath;
        }
      }

      // Fallback: try without shared_ prefix (original behavior)
      if (!tpfPath) {
        logger.debug({ sharedTemplate }, 'Trying fallback without shared_ prefix');
        const originalPath = sharedTemplate + '.tpf';
        if (sharedBasePath) {
          const sharedPath = path.join(sharedBasePath, originalPath);
          logger.debug({ sharedPath, exists: fs.existsSync(sharedPath) }, 'Fallback: trying shared base path');
          if (fs.existsSync(sharedPath)) {
            tpfPath = sharedPath;
          }
        }
        if (!tpfPath && serverBasePath) {
          const serverPath = path.join(serverBasePath, originalPath);
          logger.debug({ serverPath, exists: fs.existsSync(serverPath) }, 'Fallback: trying server base path');
          if (fs.existsSync(serverPath)) {
            tpfPath = serverPath;
          }
        }
      }
    } else {
      tpfPath = sharedTemplate;
    }

    if (!tpfPath || !fs.existsSync(tpfPath)) {
      logger.warn({ sharedTemplate }, 'Shared template TPF not found after all attempts');
      return null;
    }

    logger.debug({ tpfPath }, 'Found shared template TPF');

    // Read the shared template TPF for objectName
    const stringRefs = parseTPFStringRefs(tpfPath);
    logger.debug({ stringRefs }, 'Parsed string refs from shared template');

    if (stringRefs && stringRefs.objectNameFile && stringRefs.objectNameKey) {
      const resolvedName = resolveStringRef(stringRefs.objectNameFile, stringRefs.objectNameKey, stringsPath);
      logger.info({
        sharedTemplate,
        tpfPath,
        objectNameFile: stringRefs.objectNameFile,
        objectNameKey: stringRefs.objectNameKey,
        resolvedName
      }, 'Resolved schematic name');
      return resolvedName;
    }

    logger.warn({ sharedTemplate, tpfPath, stringRefs }, 'No objectName found in shared template');
    return null;
  } catch (error) {
    logger.debug({ error: error.message, sharedTemplate }, 'Failed to resolve schematic name');
    return null;
  }
}

/**
 * Resolve ingredient name and description from template ingredient's TPF
 * @param {string} ingredientPath - Ingredient template path (e.g., "object/tangible/component/...")
 * @param {string} stringsPath - Path to string files
 * @param {string} serverBasePath - Server base path
 * @returns {Object|null} { name, description }
 */
function resolveTemplateIngredientStrings(ingredientPath, stringsPath, serverBasePath) {
  if (!ingredientPath || !serverBasePath) return null;

  try {
    // Convert ingredient path to full TPF path
    let tpfPath = ingredientPath;

    // Handle .iff extension - remove it and add .tpf
    if (ingredientPath.endsWith('.iff')) {
      tpfPath = ingredientPath.slice(0, -4) + '.tpf';
    } else if (!ingredientPath.endsWith('.tpf')) {
      tpfPath = ingredientPath + '.tpf';
    }

    // If it starts with "object/", it's a relative server path
    if (tpfPath.startsWith('object/')) {
      tpfPath = path.join(serverBasePath, tpfPath);
    }

    // Read the ingredient TPF for objectName and detailedDescription
    const stringRefs = parseTPFStringRefs(tpfPath);
    if (!stringRefs) return null;

    const result = { name: null, description: null };

    if (stringRefs.objectNameFile && stringRefs.objectNameKey) {
      result.name = resolveStringRef(stringRefs.objectNameFile, stringRefs.objectNameKey, stringsPath);
    }

    if (stringRefs.detailedDescFile && stringRefs.detailedDescKey) {
      result.description = resolveStringRef(stringRefs.detailedDescFile, stringRefs.detailedDescKey, stringsPath);
    }

    return (result.name || result.description) ? result : null;
  } catch (error) {
    logger.debug({ error: error.message, ingredientPath }, 'Failed to resolve template ingredient strings');
    return null;
  }
}

/**
 * Merge TPF slot data with datatable slot data
 */
function mergeSlotData(tpfSlots, dtSlots) {
  // Match slots by index or name and merge additional data
  for (const dtSlot of dtSlots) {
    const tpfSlot = tpfSlots.find(s =>
      s.slot_index === dtSlot.slot_index ||
      s.name_key === dtSlot.name_key
    );

    if (tpfSlot) {
      // Merge datatable info into TPF slot
      if (dtSlot.ingredient && !tpfSlot.resource_class) {
        tpfSlot.resource_class = dtSlot.ingredient;
      }
      if (dtSlot.count && !tpfSlot.quantity) {
        tpfSlot.quantity = dtSlot.count;
      }
      tpfSlot.is_resource = dtSlot.is_resource ?? tpfSlot.is_resource;
    }
  }
}

/**
 * Sync schematics from disk to database
 * @param {Object} options - Sync options
 * @returns {Object} Sync statistics
 */
export function syncSchematics(options = {}) {
  const {
    schematicPath = config.schematic.sourcePath,
    stringsPath = config.schematic.stringsPath,
    datatablePath = config.schematic.datatablePath,
    serverBasePath = config.schematic.serverBasePath,
    sharedBasePath = config.schematic.sharedBasePath,
  } = options;

  logger.info({ schematicPath }, 'Starting schematic sync');

  // Load crafting datatables first
  if (datatablePath) {
    loadCraftingDatatables(datatablePath);
  }

  const stats = {
    found: 0,
    added: 0,
    updated: 0,
    unchanged: 0,
    errors: 0,
    errorDetails: [],
  };

  const files = findSchematicFiles(schematicPath);
  stats.found = files.length;

  for (const filePath of files) {
    try {
      const schematic = parseSchematicFile(filePath, stringsPath, serverBasePath, sharedBasePath);
      if (!schematic) {
        stats.errors++;
        const errorInfo = {
          message: 'Failed to parse schematic file (returned null)',
          file: filePath,
          details: 'Parser returned null - check file format',
        };
        stats.errorDetails.push(errorInfo);
        trackError('schematic', errorInfo);
        continue;
      }

      const result = upsertSchematic(schematic);
      stats[result.status]++;
    } catch (error) {
      logger.error({ error: error.message, filePath }, 'Error processing schematic');
      stats.errors++;
      const errorInfo = {
        message: error.message,
        file: filePath,
        details: error.stack,
      };
      stats.errorDetails.push(errorInfo);
      trackError('schematic', errorInfo);
    }
  }

  // Only keep first 50 error details in response to avoid huge payloads
  if (stats.errorDetails.length > 50) {
    stats.errorDetails = stats.errorDetails.slice(0, 50);
    stats.errorDetails.push({ message: `... and ${stats.errors - 50} more errors` });
  }

  logger.info({ ...stats, errorDetails: undefined }, 'Schematic sync completed');
  return stats;
}

/**
 * Upsert a schematic into the database
 * @param {Object} schematic - Schematic data
 * @returns {Object} Result with status
 */
export function upsertSchematic(schematic) {
  const db = getLocalDb();

  const existing = db.prepare('SELECT * FROM schematics WHERE schematic_id = ?').get(schematic.schematic_id);

  if (existing) {
    if (existing.file_hash === schematic.file_hash) {
      return { status: 'unchanged', schematic_id: schematic.schematic_id };
    }

    // Update schematic
    db.prepare(`
      UPDATE schematics SET
        schematic_name = ?,
        complexity = ?,
        category = ?,
        crafting_station = ?,
        crafted_template = ?,
        file_path = ?,
        file_hash = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE schematic_id = ?
    `).run(
      schematic.schematic_name || schematic.schematic_id,
      schematic.complexity,
      schematic.category,
      schematic.crafting_station,
      schematic.crafted_object_template,
      schematic.file_path,
      schematic.file_hash,
      schematic.schematic_id
    );

    // Update slots
    updateSchematicSlots(schematic);

    return { status: 'updated', schematic_id: schematic.schematic_id };
  } else {
    // Insert new schematic
    db.prepare(`
      INSERT INTO schematics (
        schematic_id, schematic_name, complexity, category, 
        crafting_station, crafted_template, file_path, file_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      schematic.schematic_id,
      schematic.schematic_name || schematic.schematic_id,
      schematic.complexity,
      schematic.category,
      schematic.crafting_station,
      schematic.crafted_object_template,
      schematic.file_path,
      schematic.file_hash
    );

    // Insert slots
    updateSchematicSlots(schematic);

    return { status: 'added', schematic_id: schematic.schematic_id };
  }
}

/**
 * Update schematic slots and weights
 * @param {Object} schematic - Schematic data
 */
function updateSchematicSlots(schematic) {
  const db = getLocalDb();

  // Delete existing slots and weights
  db.prepare('DELETE FROM schematic_stat_weights WHERE schematic_id = ?').run(schematic.schematic_id);
  db.prepare('DELETE FROM schematic_slots WHERE schematic_id = ?').run(schematic.schematic_id);

  if (!schematic.slots || schematic.slots.length === 0) return;

  // Insert new slots
  const slotStmt = db.prepare(`
    INSERT INTO schematic_slots (
      schematic_id, slot_index, slot_name, resource_class, 
      quantity, optional, ingredient_type
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const weightStmt = db.prepare(`
    INSERT INTO schematic_stat_weights (schematic_id, slot_index, stat_name, weight)
    VALUES (?, ?, ?, ?)
  `);

  for (const slot of schematic.slots) {
    // Only insert resource slots (not component templates)
    const ingredientType = slot.ingredient_type || 'IT_resourceClass';
    const isResource = isResourceIngredient(ingredientType);

    slotStmt.run(
      schematic.schematic_id,
      slot.slot_index,
      slot.slot_name || slot.name_key || `Slot ${slot.slot_index + 1}`,
      slot.resource_class,
      slot.quantity || 1,
      slot.optional ? 1 : 0,
      ingredientType
    );

    // Insert weights if available
    if (slot.weights && isResource) {
      for (const [stat, weight] of Object.entries(slot.weights)) {
        if (weight > 0) {
          weightStmt.run(schematic.schematic_id, slot.slot_index, stat, weight);
        }
      }
    }
  }
}

/**
 * Get all schematics
 * @param {Object} options - Query options
 * @returns {Array} Schematics
 */
export function getAllSchematics(options = {}) {
  const db = getLocalDb();
  const { category, limit = 100, offset = 0 } = options;

  let sql = 'SELECT * FROM schematics';
  const params = [];

  if (category) {
    sql += ' WHERE category = ?';
    params.push(category);
  }

  sql += ' ORDER BY schematic_name LIMIT ? OFFSET ?';
  params.push(limit, offset);

  return db.prepare(sql).all(...params);
}

/**
 * Get a schematic by ID with slots and weights
 * @param {string} schematicId - Schematic ID
 * @returns {Object|null} Schematic with full details
 */
export function getSchematicById(schematicId) {
  const db = getLocalDb();

  const schematic = db.prepare('SELECT * FROM schematics WHERE schematic_id = ?').get(schematicId);
  if (!schematic) return null;

  // Get slots
  schematic.slots = db.prepare(`
    SELECT * FROM schematic_slots
    WHERE schematic_id = ?
    ORDER BY slot_index
  `).all(schematicId);

  // Get weights for each slot
  for (const slot of schematic.slots) {
    const weights = db.prepare(`
      SELECT stat_name, weight
      FROM schematic_stat_weights
      WHERE schematic_id = ? AND slot_index = ?
    `).all(schematicId, slot.slot_index);

    slot.weights = {};
    for (const w of weights) {
      slot.weights[w.stat_name] = w.weight;
    }
  }

  return schematic;
}

/**
 * Get schematic categories
 * @returns {Array} Categories with counts
 */
export function getSchematicCategories() {
  const db = getLocalDb();
  return db.prepare(`
    SELECT category, COUNT(*) as count
    FROM schematics
    WHERE category IS NOT NULL
    GROUP BY category
    ORDER BY category
  `).all();
}

/**
 * Search schematics by name
 * @param {string} query - Search query
 * @param {number} limit - Max results
 * @returns {Array} Matching schematics
 */
export function searchSchematics(query, limit = 50) {
  const db = getLocalDb();
  return db.prepare(`
    SELECT * FROM schematics
    WHERE schematic_name LIKE ? OR schematic_id LIKE ?
    ORDER BY schematic_name
    LIMIT ?
  `).all(`%${query}%`, `%${query}%`, limit);
}

/**
 * Get schematics that use a specific resource class
 * @param {string} resourceClass - Resource class name
 * @returns {Array} Schematics using this resource
 */
export function getSchematicsByResourceClass(resourceClass) {
  const db = getLocalDb();
  return db.prepare(`
    SELECT DISTINCT s.*, ss.slot_index, ss.slot_name, ss.quantity
    FROM schematics s
    JOIN schematic_slots ss ON s.schematic_id = ss.schematic_id
    WHERE ss.resource_class = ? OR ss.resource_class LIKE ?
    ORDER BY s.schematic_name
  `).all(resourceClass, `%${resourceClass}%`);
}

/**
 * Cache a template name in the database
 * @param {string} templatePath - Template path (relative, e.g., "object/draft_schematic/...")
 * @param {string} displayName - Resolved display name
 * @param {string} description - Resolved description (optional)
 * @param {string} stringFile - String file name (optional)
 * @param {string} stringKey - String key (optional)
 */
export function cacheTemplateName(templatePath, displayName, description = null, stringFile = null, stringKey = null) {
  const db = getLocalDb();
  db.prepare(`
    INSERT OR REPLACE INTO template_names (template_path, display_name, description, string_file, string_key)
    VALUES (?, ?, ?, ?, ?)
  `).run(templatePath, displayName, description, stringFile, stringKey);
}

/**
 * Get cached template name from database
 * @param {string} templatePath - Template path
 * @returns {Object|null} { display_name, description } or null
 */
export function getCachedTemplateName(templatePath) {
  const db = getLocalDb();
  return db.prepare('SELECT display_name, description FROM template_names WHERE template_path = ?').get(templatePath);
}

/**
 * Resolve and cache a template name
 * @param {string} templatePath - Template path (relative)
 * @param {string} stringsPath - Path to string files
 * @param {string} serverBasePath - Server base path
 * @param {string} sharedBasePath - Shared base path
 * @returns {string|null} Resolved display name
 */
/**
 * Resolve a .iff template path to a display name.
 * Converts to shared .tpf, reads objectName string ref, resolves via string files.
 * Used by API layer when template cache misses for ingredient slots.
 *
 * @param {string} iffPath - Template path (e.g., "object/tangible/component/foo.iff")
 * @returns {string|null} Resolved display name or null
 */
export function resolveIffDisplayName(iffPath) {
  if (!iffPath) return null;

  const stringsPath = config.schematic.stringsPath;
  const sharedBasePath = config.schematic.sharedBasePath;
  const serverBasePath = config.schematic.serverBasePath;

  // Try shared path first (resolveCraftedObjectStrings pattern)
  const shared = resolveCraftedObjectStrings(iffPath, stringsPath, sharedBasePath);
  if (shared?.name) return shared.name;

  // Try server path (resolveTemplateIngredientStrings pattern)
  const server = resolveTemplateIngredientStrings(iffPath, stringsPath, serverBasePath);
  if (server?.name) return server.name;

  return null;
}

export function resolveAndCacheTemplateName(templatePath, stringsPath, serverBasePath, sharedBasePath) {
  // Check cache first
  const cached = getCachedTemplateName(templatePath);
  if (cached && cached.display_name) {
    return cached.display_name;
  }

  // Resolve the name
  const resolvedName = resolveSchematicName(templatePath, stringsPath, serverBasePath, sharedBasePath);

  if (resolvedName) {
    cacheTemplateName(templatePath, resolvedName);
    return resolvedName;
  }

  return null;
}

/**
 * Bulk cache template names for all schematics
 * @param {Object} options - Options with paths
 * @returns {Object} Stats { cached, skipped, errors }
 */
export function cacheAllTemplateNames(options = {}) {
  const {
    schematicPath = config.schematic.sourcePath,
    stringsPath = config.schematic.stringsPath,
    sharedBasePath = config.schematic.sharedBasePath,
  } = options;

  const stats = { cached: 0, skipped: 0, errors: 0 };
  const files = findSchematicFiles(schematicPath);

  for (const filePath of files) {
    try {
      const schematic = parseTPFFile(filePath);
      if (!schematic || !schematic.crafted_object_template) {
        stats.skipped++;
        continue;
      }

      // Check if already cached using crafted_object_template as key
      const cached = getCachedTemplateName(schematic.crafted_object_template);
      if (cached && cached.display_name) {
        stats.skipped++;
        continue;
      }

      // Resolve name from crafted object template and cache
      const resolved = resolveCraftedObjectStrings(schematic.crafted_object_template, stringsPath, sharedBasePath);

      if (resolved && resolved.name) {
        cacheTemplateName(schematic.crafted_object_template, resolved.name, resolved.description);
        stats.cached++;
      } else {
        stats.skipped++;
      }
    } catch (error) {
      logger.debug({ error: error.message, filePath }, 'Error caching template name');
      stats.errors++;
    }
  }

  logger.info(stats, 'Template name caching completed');
  return stats;
}

/**
 * Get template name stats
 * @returns {Object} Stats about cached names
 */
export function getTemplateNameStats() {
  const db = getLocalDb();
  const total = db.prepare('SELECT COUNT(*) as count FROM template_names').get();
  const withNames = db.prepare('SELECT COUNT(*) as count FROM template_names WHERE display_name IS NOT NULL').get();
  return {
    total: total.count,
    withNames: withNames.count,
    withoutNames: total.count - withNames.count,
  };
}

