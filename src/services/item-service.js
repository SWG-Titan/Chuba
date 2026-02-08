import { config } from '../config/index.js';
import { getLocalDb } from '../database/local-db.js';
import { createLogger } from '../utils/logger.js';
import { parseMasterItemDirectory, getItemType, formatItemForDb } from '../parsers/master-item-parser.js';
import { loadAllItemStats, getStatsForItem, getStatsCacheSummary } from '../parsers/item-stats-parser.js';
import { trackError } from './error-tracker.js';

const logger = createLogger('item-service');

/**
 * Cached master items data
 */
let masterItemsCache = null;
let statsLoaded = false;

/**
 * Load item stats from disk
 * @param {string} statsPath - Path to item stats directory
 * @returns {Object} Stats summary
 */
export function loadItemStats(statsPath = config.item?.statsPath) {
  if (!statsPath) {
    logger.warn('Item stats path not configured');
    return { loaded: false, error: 'Path not configured' };
  }

  logger.info({ statsPath }, 'Loading item stats');
  const result = loadAllItemStats(statsPath);
  statsLoaded = true;

  return {
    loaded: true,
    itemStats: result.itemStats.size,
    armorStats: result.armorStats.size,
    weaponStats: result.weaponStats.size,
  };
}

/**
 * Load master items from disk
 * @param {string} itemPath - Path to master_item directory
 * @returns {Object} Loaded items data
 */
export function loadMasterItems(itemPath = config.item?.masterItemPath) {
  if (!itemPath) {
    logger.warn('Master item path not configured');
    return { loaded: false, items: [], error: 'Path not configured' };
  }

  logger.info({ itemPath }, 'Loading master items');
  masterItemsCache = parseMasterItemDirectory(itemPath);

  // Also load stats if not loaded yet
  if (!statsLoaded && config.item?.statsPath) {
    loadItemStats(config.item.statsPath);
  }

  return masterItemsCache;
}

/**
 * Get cached master items
 * @returns {Object|null} Cached items or null
 */
export function getMasterItemsCache() {
  return masterItemsCache;
}

/**
 * Sync master items to database
 * @param {Object} options - Sync options
 * @returns {Object} Sync statistics
 */
export function syncMasterItems(options = {}) {
  const { itemPath = config.item?.masterItemPath } = options;

  logger.info({ itemPath }, 'Starting master item sync');

  const stats = {
    found: 0,
    added: 0,
    updated: 0,
    unchanged: 0,
    errors: 0,
    errorDetails: [],
  };

  // Load from disk
  const data = loadMasterItems(itemPath);

  if (!data.loaded) {
    logger.error({ error: data.error }, 'Failed to load master items');
    const errorInfo = {
      message: data.error || 'Failed to load master items',
      file: itemPath,
      details: 'Directory could not be loaded',
    };
    stats.errorDetails.push(errorInfo);
    trackError('item', errorInfo);
    return stats;
  }

  stats.found = data.items.length;
  const db = getLocalDb();

  // Use transaction for better performance
  const insertStmt = db.prepare(`
    INSERT OR REPLACE INTO items (
      template_name, name, type, category, item_type,
      unique_item, required_level, required_skill, creation_objvars,
      charges, tier, value, scripts, version,
      can_reverse_engineer, string_name, string_detail, comments, raw_data,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `);

  const insertMany = db.transaction((items) => {
    for (const rawItem of items) {
      try {
        const item = formatItemForDb(rawItem);

        // Skip items without template_name
        if (!item.template_name) {
          continue;
        }

        insertStmt.run(
          item.template_name,
          item.name,
          item.type,
          item.category,
          item.item_type,
          item.unique_item,
          item.required_level,
          item.required_skill,
          item.creation_objvars,
          item.charges,
          item.tier,
          item.value,
          item.scripts,
          item.version,
          item.can_reverse_engineer,
          item.string_name,
          item.string_detail,
          item.comments,
          item.raw_data
        );
        stats.added++;
      } catch (error) {
        logger.error({ error: error.message, template: rawItem.template_name }, 'Failed to insert item');
        stats.errors++;
        const errorInfo = {
          message: error.message,
          file: rawItem.template_name || 'unknown',
          details: `Category: ${rawItem._category}`,
        };
        stats.errorDetails.push(errorInfo);
        trackError('item', errorInfo);
      }
    }
  });

  insertMany(data.items);

  // Sync column visibility settings
  if (data.columns && data.columns.length > 0) {
    syncColumnSettings(data.columns);
  }

  // Trim error details in response
  if (stats.errorDetails.length > 50) {
    stats.errorDetails = stats.errorDetails.slice(0, 50);
    stats.errorDetails.push({ message: `... and ${stats.errors - 50} more errors` });
  }

  logger.info({ ...stats, errorDetails: undefined }, 'Master item sync completed');
  return stats;
}

/**
 * Sync column settings to database
 * @param {Array} columns - Column names from parsed data
 */
function syncColumnSettings(columns) {
  const db = getLocalDb();

  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO item_column_settings (column_name, display_name, visible, sort_order)
    VALUES (?, ?, 1, ?)
  `);

  columns.forEach((col, index) => {
    const displayName = col.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    insertStmt.run(col, displayName, index);
  });
}

/**
 * Get all items with pagination and filtering
 * @param {Object} options - Query options
 * @returns {Object} Items and metadata
 */
export function getItems(options = {}) {
  const {
    category,
    itemType,
    search,
    minTier,
    maxTier,
    sortBy = 'name',
    sortOrder = 'ASC',
    limit = 50,
    offset = 0,
    includeHidden = false,
  } = options;

  const db = getLocalDb();
  const params = [];
  let whereClause = includeHidden ? '1=1' : 'hidden = 0';

  if (category) {
    whereClause += ' AND category = ?';
    params.push(category);
  }

  if (itemType) {
    whereClause += ' AND item_type = ?';
    params.push(itemType);
  }

  if (search) {
    whereClause += ' AND (name LIKE ? OR template_name LIKE ? OR string_name LIKE ?)';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  if (minTier !== undefined) {
    whereClause += ' AND tier >= ?';
    params.push(minTier);
  }

  if (maxTier !== undefined) {
    whereClause += ' AND tier <= ?';
    params.push(maxTier);
  }

  // Validate sort column
  const validSortColumns = ['name', 'string_name', 'template_name', 'tier', 'required_level', 'value', 'category', 'item_type', 'type'];
  const safeSort = validSortColumns.includes(sortBy) ? sortBy : 'name';
  const safeOrder = sortOrder.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';

  // Get total count
  const countResult = db.prepare(`SELECT COUNT(*) as count FROM items WHERE ${whereClause}`).get(...params);
  const total = countResult?.count || 0;

  // Get items
  const items = db.prepare(`
    SELECT * FROM items 
    WHERE ${whereClause}
    ORDER BY ${safeSort} ${safeOrder}
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  return {
    items: items.map(formatItemResponse),
    total,
    limit,
    offset,
    hasMore: offset + items.length < total,
  };
}

/**
 * Get a single item by template
 * @param {string} template - Item template path
 * @returns {Object|null} Item or null
 */
export function getItemByTemplate(template) {
  const db = getLocalDb();
  const item = db.prepare('SELECT * FROM items WHERE template_name = ?').get(template);
  return item ? formatItemResponseWithStats(item) : null;
}

/**
 * Get item display name by template (for quick lookups)
 * @param {string} template - Item template path (e.g., "item_axkva_min_key_04_01")
 * @returns {string|null} Display name or null
 */
export function getItemDisplayName(template) {
  if (!template) return null;
  const db = getLocalDb();
  // Try exact match first
  let item = db.prepare('SELECT string_name, name FROM items WHERE template_name = ?').get(template);
  // If not found, try with object/ prefix variations
  if (!item && !template.startsWith('object/')) {
    item = db.prepare('SELECT string_name, name FROM items WHERE template_name LIKE ?').get(`%${template}%`);
  }
  if (item) {
    return item.string_name || item.name || null;
  }
  return null;
}

/**
 * Get item by ID with full stats
 * @param {number} id - Item ID
 * @returns {Object|null} Item or null
 */
export function getItemById(id) {
  const db = getLocalDb();
  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(id);
  return item ? formatItemResponseWithStats(item) : null;
}

/**
 * Search items by name
 * @param {string} query - Search query
 * @param {number} limit - Max results
 * @returns {Array} Matching items
 */
export function searchItems(query, limit = 50) {
  const db = getLocalDb();
  const items = db.prepare(`
    SELECT * FROM items
    WHERE (name LIKE ? OR template_name LIKE ? OR string_name LIKE ?) AND hidden = 0
    ORDER BY 
      CASE WHEN name LIKE ? THEN 0 ELSE 1 END,
      name
    LIMIT ?
  `).all(`%${query}%`, `%${query}%`, `%${query}%`, `${query}%`, limit);

  return items.map(formatItemResponse);
}

/**
 * Get item categories with counts
 * @returns {Array} Categories
 */
export function getItemCategories() {
  const db = getLocalDb();
  return db.prepare(`
    SELECT category, item_type, COUNT(*) as count
    FROM items
    WHERE hidden = 0
    GROUP BY category, item_type
    ORDER BY item_type, category
  `).all();
}

/**
 * Get item types with counts
 * @returns {Array} Item types
 */
export function getItemTypes() {
  const db = getLocalDb();
  return db.prepare(`
    SELECT item_type, COUNT(*) as count
    FROM items
    WHERE hidden = 0
    GROUP BY item_type
    ORDER BY count DESC
  `).all();
}

/**
 * Get item statistics
 * @returns {Object} Stats
 */
export function getItemStats() {
  const db = getLocalDb();

  const total = db.prepare('SELECT COUNT(*) as count FROM items WHERE hidden = 0').get();
  const byType = db.prepare(`
    SELECT item_type, COUNT(*) as count
    FROM items
    WHERE hidden = 0
    GROUP BY item_type
  `).all();
  const tierRange = db.prepare(`
    SELECT MIN(tier) as min_tier, MAX(tier) as max_tier
    FROM items WHERE tier > 0 AND hidden = 0
  `).get();

  return {
    total: total?.count || 0,
    byType: byType.reduce((acc, t) => { acc[t.item_type] = t.count; return acc; }, {}),
    tierRange: {
      min: tierRange?.min_tier || 0,
      max: tierRange?.max_tier || 0,
    },
  };
}

/**
 * Get column visibility settings
 * @returns {Array} Column settings
 */
export function getColumnSettings() {
  const db = getLocalDb();
  return db.prepare(`
    SELECT * FROM item_column_settings
    ORDER BY sort_order, column_name
  `).all();
}

/**
 * Update column visibility
 * @param {string} columnName - Column name
 * @param {boolean} visible - Whether column is visible
 * @returns {Object} Result
 */
export function setColumnVisibility(columnName, visible) {
  const db = getLocalDb();
  db.prepare(`
    UPDATE item_column_settings SET visible = ? WHERE column_name = ?
  `).run(visible ? 1 : 0, columnName);
  return { success: true, columnName, visible };
}

/**
 * Update multiple column settings
 * @param {Array} settings - Array of { column_name, visible, sort_order }
 * @returns {Object} Result
 */
export function updateColumnSettings(settings) {
  const db = getLocalDb();

  const updateStmt = db.prepare(`
    UPDATE item_column_settings 
    SET visible = ?, sort_order = ?, display_name = ?
    WHERE column_name = ?
  `);

  const updateMany = db.transaction((items) => {
    for (const setting of items) {
      updateStmt.run(
        setting.visible ? 1 : 0,
        setting.sort_order || 0,
        setting.display_name || setting.column_name,
        setting.column_name
      );
    }
  });

  updateMany(settings);
  return { success: true, updated: settings.length };
}

/**
 * Hide/unhide items by category or type
 * @param {Object} options - Filter options
 * @param {boolean} hidden - Whether to hide or unhide
 * @returns {Object} Result with count
 */
export function setItemsHidden(options, hidden) {
  const db = getLocalDb();
  const { category, itemType, templatePattern } = options;

  let sql = 'UPDATE items SET hidden = ? WHERE 1=1';
  const params = [hidden ? 1 : 0];

  if (category) {
    sql += ' AND category = ?';
    params.push(category);
  }

  if (itemType) {
    sql += ' AND item_type = ?';
    params.push(itemType);
  }

  if (templatePattern) {
    sql += ' AND template_name LIKE ?';
    params.push(`%${templatePattern}%`);
  }

  const result = db.prepare(sql).run(...params);
  return { success: true, affected: result.changes };
}

/**
 * Get type label from enum value
 */
function getTypeLabel(typeValue) {
  const labels = {
    'WEAPON': 'Weapon',
    'ARMOR': 'Armor',
    'ITEM': 'Item',
    'STORYTELLER': 'Storyteller',
    'OBJECT': 'Object',
  };
  return labels[typeValue] || typeValue || 'Unknown';
}

/**
 * Format item for API response (basic)
 * @param {Object} item - Raw item from database
 * @returns {Object} Formatted item
 */
function formatItemResponse(item) {
  if (!item) return null;

  const formatted = {
    id: item.id,
    templateName: item.template_name,
    // Use string_name as primary display name, fallback to name
    displayName: item.string_name || item.name || 'Unknown',
    name: item.name,
    type: item.type,
    typeLabel: getTypeLabel(item.item_type),
    category: item.category,
    itemType: item.item_type,
    unique: item.unique_item === 1,
    requiredLevel: item.required_level,
    requiredSkill: item.required_skill,
    creationObjvars: item.creation_objvars,
    charges: item.charges,
    tier: item.tier,
    value: item.value,
    scripts: item.scripts,
    version: item.version,
    canReverseEngineer: item.can_reverse_engineer === 1,
    stringName: item.string_name,
    stringDetail: item.string_detail,
    // Use string_detail as description
    description: item.string_detail || null,
    comments: item.comments,
    hidden: item.hidden === 1,
  };

  // Parse raw_data JSON if present
  if (item.raw_data) {
    try {
      formatted.additionalData = JSON.parse(item.raw_data);
    } catch (e) {
      formatted.additionalData = null;
    }
  }

  return formatted;
}

/**
 * Format item for API response with full stats from stats tables
 * @param {Object} item - Raw item from database
 * @returns {Object} Formatted item with stats
 */
function formatItemResponseWithStats(item) {
  if (!item) return null;

  // Get basic formatted response
  const formatted = formatItemResponse(item);

  // Try to load stats if not already loaded
  if (!statsLoaded && config.item?.statsPath) {
    loadItemStats(config.item.statsPath);
  }

  // Get stats for this item by name
  const itemName = item.name;
  if (itemName) {
    const stats = getStatsForItem(itemName);

    if (stats) {
      formatted.hasDetailedStats = true;

      // Item stats (consumables, buffs, etc.)
      if (stats.itemStats) {
        formatted.itemStats = {
          skillMods: stats.itemStats.skill_mods || [],
          attributeBonus: stats.itemStats.attribute_bonus,
          buffName: stats.itemStats.buff_name,
          coolDownGroup: stats.itemStats.cool_down_group,
          reuseTime: stats.itemStats.reuse_time,
          requiredLevelForEffect: stats.itemStats.required_level_for_effect,
          clientEffect: stats.itemStats.client_effect,
          clientAnimation: stats.itemStats.client_animation,
          color: stats.itemStats.color,
        };
      }

      // Armor stats
      if (stats.armorStats) {
        formatted.armorStats = {
          armorLevel: stats.armorStats.armor_level,
          armorCategory: stats.armorStats.armor_category,
          conditionMultiplier: stats.armorStats.condition_multiplier,
          protection: stats.armorStats.protection,
          sockets: stats.armorStats.sockets,
          hitPoints: stats.armorStats.hit_points,
          skillMods: stats.armorStats.skill_mods || [],
          attributeBonus: stats.armorStats.attribute_bonus,
          reactiveEffect: stats.armorStats.reactive_effect,
          buffName: stats.armorStats.buff_name,
          requiredLevelForEffect: stats.armorStats.required_level_for_effect,
          clientEffect: stats.armorStats.client_effect,
          color: stats.armorStats.color,
        };
      }

      // Weapon stats
      if (stats.weaponStats) {
        formatted.weaponStats = {
          volume: stats.weaponStats.volume,
          hitPoints: stats.weaponStats.hit_points,
          minDamage: stats.weaponStats.min_damage,
          maxDamage: stats.weaponStats.max_damage,
          accuracy: stats.weaponStats.accuracy,
          damageType: stats.weaponStats.damage_type,
          elementalType: stats.weaponStats.elemental_type,
          elementalDamage: stats.weaponStats.elemental_damage,
          attackSpeed: stats.weaponStats.attack_speed,
          woundChance: stats.weaponStats.wound_chance,
          specialAttackCost: stats.weaponStats.special_attack_cost,
          minRangeDistance: stats.weaponStats.min_range_distance,
          maxRangeDistance: stats.weaponStats.max_range_distance,
          skillMods: stats.weaponStats.skill_mods || [],
          procEffect: stats.weaponStats.proc_effect,
          tierGranted: stats.weaponStats.tier_granted,
          targetDps: stats.weaponStats.target_dps,
          actualDps: stats.weaponStats.actual_dps,
          calculatedDps: stats.weaponStats.calculated_dps,
        };
      }
    } else {
      formatted.hasDetailedStats = false;
    }
  }

  return formatted;
}

/**
 * Get stats cache summary for admin
 * @returns {Object} Stats counts
 */
export function getItemStatsSummary() {
  return getStatsCacheSummary();
}
